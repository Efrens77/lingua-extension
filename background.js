// Lingua service worker: opens the side panel and owns persistent Full Page state.
import { translate } from "./core/translation/index.js";
import { LIMITS } from "./core/config.js";
import { MSG } from "./core/messages.js";

const PAGE_STATE_KEY = "translate.page-state";
const runs = new Map(); // tab id -> AbortController
const pageCache = new Map(); // current worker lifetime: tab + URL + source + target + text
const BATCH_MAX_CHARS = 400;

function enableSidePanelOnActionClick() {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("[Lingua] setPanelBehavior failed:", err));
}

async function getStates() {
  return (await chrome.storage.local.get(PAGE_STATE_KEY))[PAGE_STATE_KEY] ?? {};
}

async function getState(tabId) {
  return (await getStates())[String(tabId)] ?? null;
}

async function saveState(tabId, state) {
  const states = await getStates();
  states[String(tabId)] = state;
  await chrome.storage.local.set({ [PAGE_STATE_KEY]: states });
}

async function clearState(tabId) {
  const states = await getStates();
  delete states[String(tabId)];
  await chrome.storage.local.set({ [PAGE_STATE_KEY]: states });
}

function publish(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

async function sendToTab(tab, message) {
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (_) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/content.js"] });
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (_) {
      return { ok: false, reason: "unreachable" };
    }
  }
}

function cacheKey(tab, to, text) {
  return `${tab.id}\u0001${tab.url}\u0001auto\u0001${to}\u0001${text}`;
}

function makeBatches(entries) {
  const batches = [];
  let current = [];
  let length = 0;
  for (const entry of entries) {
    const marker = `\n\uE000LINGUA${current.length}\uE001\n`;
    if (current.length && length + marker.length + entry.text.length > BATCH_MAX_CHARS) {
      batches.push(current);
      current = [];
      length = 0;
    }
    current.push(entry);
    length += (current.length > 1 ? marker.length : 0) + entry.text.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

function joinBatch(entries) {
  return entries.map((entry, index) => index ? `\n\uE000LINGUA${index}\uE001\n${entry.text}` : entry.text).join("");
}

function splitBatch(text, expected) {
  const parts = text.split(/\n\uE000LINGUA\d+\uE001\n/);
  return parts.length === expected ? parts : null;
}

async function translateSegments(segments, tab, to, signal, onProgress) {
  const byText = new Map();
  for (const segment of segments) {
    const entry = byText.get(segment.text) ?? { text: segment.text, ids: [] };
    entry.ids.push(segment.id);
    byText.set(segment.text, entry);
  }
  const translated = new Map();
  let detectedFrom = null;
  let done = 0;
  const finish = (entry, text) => {
    translated.set(entry.text, text);
    done += entry.ids.length;
    onProgress(done, segments.length);
  };
  const pending = [];
  for (const entry of byText.values()) {
    const cached = pageCache.get(cacheKey(tab, to, entry.text));
    if (cached) finish(entry, cached.text);
    else pending.push(entry);
  }
  for (const batch of makeBatches(pending)) {
    const result = await translate({ text: joinBatch(batch), from: "auto", to, signal, concurrency: 1 });
    detectedFrom ??= result.detectedFrom;
    const pieces = splitBatch(result.text, batch.length);
    if (pieces) {
      batch.forEach((entry, index) => {
        pageCache.set(cacheKey(tab, to, entry.text), { text: pieces[index] });
        finish(entry, pieces[index]);
      });
    } else {
      // If a provider changes a delimiter, fall back safely to individual queued requests.
      for (const entry of batch) {
        const single = await translate({ text: entry.text, from: "auto", to, signal, concurrency: 1 });
        detectedFrom ??= single.detectedFrom;
        pageCache.set(cacheKey(tab, to, entry.text), { text: single.text });
        finish(entry, single.text);
      }
    }
  }
  return {
    translations: segments.map((segment) => ({ id: segment.id, text: translated.get(segment.text) })),
    detectedFrom,
  };
}

async function translatePage(tabId, to) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) throw new Error("This page can't be translated");
  runs.get(tabId)?.abort();
  const controller = new AbortController();
  runs.set(tabId, controller);
  publish({ type: MSG.PAGE_PROGRESS, tabId, percent: 0 });
  try {
    const collected = await sendToTab(tab, { type: MSG.GET_PAGE_SEGMENTS, maxChars: LIMITS.page });
    if (!collected?.ok || !collected.segments?.length) throw new Error("This page doesn't have readable text");
    const { translations, detectedFrom } = await translateSegments(
      collected.segments, tab, to, controller.signal,
      (done, total) => publish({ type: MSG.PAGE_PROGRESS, tabId, percent: Math.round((done / total) * 100) })
    );
    if (runs.get(tabId) !== controller) throw new DOMException("Aborted", "AbortError");
    const applied = await sendToTab(tab, { type: MSG.APPLY_PAGE_TRANSLATION, translations });
    if (!applied?.ok) throw new Error("Lingua couldn't update this page");
    const state = { url: tab.url, to, view: "translated", detectedFrom };
    await saveState(tabId, state);
    publish({ type: MSG.PAGE_STATE, tabId, state });
    return { ok: true, state };
  } catch (err) {
    if (err?.rateLimited) {
      publish({ type: MSG.PAGE_ERROR, tabId, message: err.message, rateLimited: true });
    }
    throw err;
  } finally {
    if (runs.get(tabId) === controller) runs.delete(tabId);
  }
}

async function restorePage(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const result = await sendToTab(tab, { type: MSG.RESTORE_PAGE_TEXT });
  await clearState(tabId);
  publish({ type: MSG.PAGE_STATE, tabId, state: { url: tab.url, view: "original" } });
  return result?.ok ? { ok: true } : { ok: false, reason: result?.reason };
}

chrome.runtime.onInstalled.addListener(enableSidePanelOnActionClick);
chrome.runtime.onStartup.addListener(enableSidePanelOnActionClick);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === MSG.TRANSLATE_PAGE) {
    if (!Number.isInteger(msg.tabId)) {
      sendResponse({ ok: false, reason: "restricted" });
      return;
    }
    translatePage(msg.tabId, msg.to).then(sendResponse, (err) => {
      console.error("[Lingua] page translation failed:", err);
      sendResponse({ ok: false, error: err.message, rateLimited: Boolean(err.rateLimited) });
    });
    return true;
  }
  if (msg?.type === MSG.RESTORE_PAGE) {
    if (!Number.isInteger(msg.tabId)) {
      sendResponse({ ok: false, reason: "restricted" });
      return;
    }
    restorePage(msg.tabId).then(sendResponse, (err) => {
      console.error("[Lingua] page restore failed:", err);
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }
  if (msg?.type === MSG.GET_PAGE_STATE) {
    if (!Number.isInteger(msg.tabId)) {
      sendResponse({ ok: false, reason: "restricted" });
      return;
    }
    getState(msg.tabId).then(
      (state) => sendResponse({ ok: true, state }),
      (err) => {
        console.error("[Lingua] page state lookup failed:", err);
        sendResponse({ ok: false, error: err.message });
      }
    );
    return true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete") return;
  setTimeout(async () => {
    try {
      const state = await getState(tabId);
      if (state?.view === "translated" && state.url === tab.url) translatePage(tabId, state.to).catch((err) => {
        console.error("[Lingua] page retranslation failed:", err);
      });
    } catch (err) {
      console.error("[Lingua] page retranslation lookup failed:", err);
    }
  }, 200);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  runs.get(tabId)?.abort();
  runs.delete(tabId);
  clearState(tabId).catch(() => {});
});

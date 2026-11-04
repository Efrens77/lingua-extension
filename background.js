// Lingua service worker: opens the side panel and owns persistent Full Page state.
import { translate } from "./core/translation/index.js";
import { LIMITS } from "./core/config.js";
import { MSG } from "./core/messages.js";

const PAGE_STATE_KEY = "translate.page-state";
const runs = new Map(); // tab id -> AbortController
const pageCache = new Map(); // current worker lifetime: tab + URL + source + target + text
const pageViewCache = new Map(); // metadata for text mappings retained by the content script
const BATCH_MAX_CHARS = 400;
let offscreenReady = null;

// Full Page narration deliberately lives in the service worker instead of the
// side panel (which is routinely hidden or destroyed) or an offscreen
// SpeechSynthesis document (whose events are not reliable for long text in
// Chrome). chrome.tts is an extension API, so Chrome owns the audible output
// after the side panel changes view or closes.
let narration = null;
let narrationTimer = null;
let narrationAdvanceTimer = null;
let narrationGeneration = 0;
let phraseAudioToken = null;

function narrationSnapshot(session = narration) {
  if (!session) return null;
  const complete = session.chunks.slice(0, session.index).reduce((sum, chunk) => sum + chunk.text.length, 0)
    + session.offset;
  const progress = session.totalChars ? Math.min(1, complete / session.totalChars) : 0;
  return {
    tabId: session.tabId, status: session.status, progress,
    elapsed: Math.round(session.duration * progress),
    elapsedMs: Math.round(session.duration * 1000 * progress),
    duration: session.duration, sessionId: session.sessionId,
    revision: session.revision || 0, willResume: Boolean(session.willResume), updatedAt: Date.now(),
  };
}

function publishNarration(session = narration) {
  const state = narrationSnapshot(session);
  if (state) publish({ type: MSG.READ_ALOUD_STATE, state });
}

function clearNarrationTimer() {
  clearTimeout(narrationTimer);
  clearTimeout(narrationAdvanceTimer);
  narrationTimer = null;
  narrationAdvanceTimer = null;
}

function estimateNarrationOffset(session) {
  if (!session?.chunkStartedAt || session.status !== "playing") return;
  const chunk = session.chunks[session.index];
  if (!chunk) return;
  const words = Math.max(1, chunk.text.trim().split(/\s+/).length);
  const expectedMs = words / 160 * 60000;
  const elapsed = Date.now() - session.chunkStartedAt;
  const estimated = Math.min(chunk.text.length, session.chunkStartOffset
    + Math.round(chunk.text.length * elapsed / expectedMs));
  // Browser word events can arrive late or with a lower charIndex than our
  // prior estimate. A checkpoint may only move forward within an utterance.
  session.offset = Math.max(session.offset, estimated);
}

function scheduleNarrationProgress(session, token) {
  clearNarrationTimer();
  narrationTimer = setTimeout(() => {
    if (narration !== session || narrationGeneration !== token || session.status !== "playing") return;
    estimateNarrationOffset(session);
    publishNarration(session);
    scheduleNarrationProgress(session, token);
  }, 250);
}

function stopNarration({ reset = false } = {}) {
  clearNarrationTimer();
  if (!narration) return;
  const session = narration;
  const wasPlaying = session.status === "playing" || session.status === "seeking";
  narrationGeneration++;
  if (!reset) estimateNarrationOffset(session);
  if (wasPlaying) chrome.tts.stop();
  session.status = reset ? "idle" : "paused";
  if (reset) { session.index = 0; session.offset = 0; session.revision = (session.revision || 0) + 1; }
  publishNarration(session);
}

function findNarrationPosition(session, seconds) {
  const ratio = Math.max(0, Math.min(1, Number(seconds || 0) / session.duration));
  const target = Math.round(session.totalChars * ratio);
  let used = 0;
  session.index = 0;
  session.offset = 0;
  for (const [index, chunk] of session.chunks.entries()) {
    if (used + chunk.text.length >= target) {
      session.index = index;
      session.offset = target - used;
      return;
    }
    used += chunk.text.length;
  }
  session.index = session.chunks.length;
}

function speakNarrationChunk() {
  const session = narration;
  if (!session || session.status !== "playing") return;
  if (session.index >= session.chunks.length) {
    clearNarrationTimer();
    session.status = "finished";
    session.offset = 0;
    publishNarration(session);
    return;
  }
  const chunk = session.chunks[session.index];
  const startOffset = session.offset;
  const token = ++narrationGeneration;
  session.chunkStartedAt = Date.now();
  session.chunkStartOffset = startOffset;
  chrome.tts.speak(chunk.text.slice(startOffset), {
    lang: session.language,
    enqueue: false,
    onEvent(event) {
      if (narration !== session || narrationGeneration !== token || session.status !== "playing") return;
      if (event.type === "word" && Number.isFinite(event.charIndex)) {
        session.offset = Math.max(session.offset, Math.min(chunk.text.length, startOffset + event.charIndex));
        publishNarration(session);
      } else if (event.type === "end") {
        clearNarrationTimer();
        session.index++;
        session.offset = 0;
        publishNarration(session);
        narrationAdvanceTimer = setTimeout(() => {
          narrationAdvanceTimer = null;
          speakNarrationChunk();
        }, chunk.pause || 120);
      } else if (event.type === "error") {
        clearNarrationTimer();
        session.status = "error";
        publishNarration(session);
      }
    },
  });
  scheduleNarrationProgress(session, token);
  publishNarration(session);
}

function normalizeNarrationChunks(chunks) {
  const result = [];
  for (const source of chunks || []) {
    const text = String(source?.text || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    // Chrome TTS can silently stop on a long utterance. Keep every request well
    // below that threshold, preferring sentence boundaries for natural speech.
    const sentences = text.match(/[^.!?。！？]+[.!?。！？]*|.+$/g) || [text];
    let current = "";
    for (const sentence of sentences) {
      const next = `${current} ${sentence}`.trim();
      if (next.length > 220 && current) {
        result.push({ text: current, pause: source.pause });
        current = sentence.trim();
      } else current = next;
      while (current.length > 260) {
        const cut = current.lastIndexOf(" ", 220);
        result.push({ text: current.slice(0, cut > 0 ? cut : 220).trim(), pause: source.pause });
        current = current.slice(cut > 0 ? cut + 1 : 220).trim();
      }
    }
    if (current) result.push({ text: current, pause: source.pause });
  }
  return result;
}

function narrationMatches(command) {
  return narration && (!Number.isInteger(command.tabId) || narration.tabId === command.tabId);
}

function handleReadAloudCommand(command = {}) {
  if (command.action === "state") return { ok: true, state: narrationSnapshot() };
  if (command.action === "start") {
    phraseAudioToken = null;
    chrome.tts.stop();
    stopNarration({ reset: true });
    const chunks = normalizeNarrationChunks(command.chunks);
    if (!Number.isInteger(command.tabId) || !chunks.length) return { ok: false, reason: "unavailable", state: narrationSnapshot() };
    narration = {
      tabId: command.tabId, chunks, language: String(command.language || "en"), index: 0, offset: 0,
      totalChars: chunks.reduce((sum, chunk) => sum + chunk.text.length, 0),
      duration: Math.max(1, Math.round(chunks.reduce((sum, chunk) => sum + chunk.text.split(/\s+/).length, 0) / 160 * 60)),
      status: "playing", sessionId: `${Date.now()}-${++narrationGeneration}`, revision: 0,
    };
    speakNarrationChunk();
    return { ok: true, state: narrationSnapshot() };
  }
  if (!narrationMatches(command)) return { ok: false, reason: "not-found", state: narrationSnapshot() };
  if (command.action === "pause" && narration.status === "playing") stopNarration();
  else if (command.action === "resume" && narration.status === "paused") {
    narration.status = "playing";
    speakNarrationChunk();
  } else if (command.action === "restart" || command.action === "reset") stopNarration({ reset: true });
  else if (command.action === "seek") {
    const resume = Boolean(command.resume);
    const wasPlaying = narration.status === "playing";
    narration.status = "seeking";
    narration.willResume = resume;
    publishNarration(narration);
    if (wasPlaying) { narrationGeneration++; clearNarrationTimer(); chrome.tts.stop(); }
    findNarrationPosition(narration, command.seconds);
    narration.revision = (narration.revision || 0) + 1;
    narration.status = resume ? "playing" : "paused";
    narration.willResume = false;
    publishNarration(narration);
    if (resume) speakNarrationChunk();
  }
  return { ok: true, state: narrationSnapshot() };
}

function publishPhraseAudio(state) {
  publish({ type: MSG.PHRASE_AUDIO_STATE, state });
}

function handlePhraseAudioCommand(command = {}) {
  if (command.action === "stop") {
    if (phraseAudioToken) chrome.tts.stop();
    phraseAudioToken = null;
    publishPhraseAudio({ status: "idle" });
    return { ok: true };
  }
  if (command.action !== "start" || !String(command.text || "").trim()) return { ok: false, reason: "unavailable" };
  if (narration?.status === "playing" || narration?.status === "seeking") return { ok: false, reason: "blocked" };
  const token = `${Date.now()}-${Math.random()}`;
  phraseAudioToken = token;
  chrome.tts.stop();
  chrome.tts.speak(String(command.text).slice(0, 12000), {
    lang: String(command.language || "en"),
    enqueue: false,
    onEvent(event) {
      if (phraseAudioToken !== token) return;
      if (event.type === "end" || event.type === "error" || event.type === "interrupted" || event.type === "cancelled") {
        phraseAudioToken = null;
        publishPhraseAudio({ status: "idle" });
      }
    },
  });
  publishPhraseAudio({ status: "playing" });
  return { ok: true };
}

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

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  offscreenReady ??= chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["DOM_PARSER"],
    justification: "Run Chrome's document-only on-device translation APIs.",
  }).finally(() => { offscreenReady = null; });
  await offscreenReady;
}

async function translateWithChromeDocument(request) {
  try {
    await ensureOffscreenDocument();
    return await chrome.runtime.sendMessage({ type: "lingua/chrome-translate", request });
  } catch (err) {
    console.warn("[Lingua] Chrome document translation unavailable:", err);
    return { ok: false, reason: "unavailable" };
  }
}

async function readAloudCommand(command) {
  return handleReadAloudCommand(command);
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

async function translateSegments(segments, tab, to, sourceLanguage, signal, onProgress) {
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
    const batchText = joinBatch(batch);
    const chromeResult = await translateWithChromeDocument({ text: batchText, from: sourceLanguage, to });
    const result = chromeResult.ok
      ? chromeResult
      : await translate({ text: batchText, from: sourceLanguage || "auto", to, signal, concurrency: 1, preferChrome: false });
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
        const chromeSingle = await translateWithChromeDocument({ text: entry.text, from: sourceLanguage, to });
        const single = chromeSingle.ok
          ? chromeSingle
          : await translate({ text: entry.text, from: sourceLanguage || "auto", to, signal, concurrency: 1, preferChrome: false });
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
      collected.segments, tab, to, collected.lang || "auto", controller.signal,
      (done, total) => publish({ type: MSG.PAGE_PROGRESS, tabId, percent: Math.round((done / total) * 100) })
    );
    if (runs.get(tabId) !== controller) throw new DOMException("Aborted", "AbortError");
    const applied = await sendToTab(tab, { type: MSG.APPLY_PAGE_TRANSLATION, translations });
    if (!applied?.ok) throw new Error("Lingua couldn't update this page");
    const state = { url: tab.url, to, view: "translated", detectedFrom };
    pageViewCache.set(tabId, state);
    await saveState(tabId, state);
    publish({ type: MSG.PAGE_STATE, tabId, state });
    return { ok: true, state };
  } catch (err) {
    if (err?.name !== "AbortError") {
      publish({
        type: MSG.PAGE_ERROR,
        tabId,
        message: err?.rateLimited
          ? "Translation service limit reached. Please wait a moment and try again."
          : "Translation is temporarily unavailable. Please try again shortly.",
        rateLimited: Boolean(err?.rateLimited),
      });
    }
    throw err;
  } finally {
    if (runs.get(tabId) === controller) runs.delete(tabId);
  }
}

async function restorePage(tabId) {
  runs.get(tabId)?.abort();
  const tab = await chrome.tabs.get(tabId);
  const result = await sendToTab(tab, { type: MSG.RESTORE_PAGE_TEXT });
  const previous = await getState(tabId);
  const state = { url: tab.url, view: "original" };
  if (previous?.to) state.to = previous.to;
  if (previous?.detectedFrom) state.detectedFrom = previous.detectedFrom;
  await saveState(tabId, state);
  publish({ type: MSG.PAGE_STATE, tabId, state });
  return result?.ok ? { ok: true } : { ok: false, reason: result?.reason };
}

async function setPageView(tabId, view) {
  if (view !== "translated") return restorePage(tabId);
  const tab = await chrome.tabs.get(tabId);
  const result = await sendToTab(tab, { type: MSG.SET_PAGE_TEXT_VIEW, view });
  if (!result?.ok || !result.changed) return { ok: false, reason: "unavailable" };
  const previous = await getState(tabId);
  const state = { ...previous, url: tab.url, view: "translated" };
  await saveState(tabId, state);
  publish({ type: MSG.PAGE_STATE, tabId, state });
  return { ok: true, state };
}

async function showCachedPage(tabId, to) {
  const tab = await chrome.tabs.get(tabId);
  const result = await sendToTab(tab, { type: MSG.SHOW_CACHED_PAGE });
  if (!result?.ok || !result.cached) return { ok: false, cached: false, reason: result?.reason || "unavailable" };
  const prior = pageViewCache.get(tabId) || await getState(tabId);
  const state = { url: tab.url, to: to || prior?.to, view: "translated", detectedFrom: prior?.detectedFrom };
  pageViewCache.set(tabId, state);
  await saveState(tabId, state);
  publish({ type: MSG.PAGE_STATE, tabId, state });
  return { ok: true, cached: true, state };
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
  if (msg?.type === MSG.SET_PAGE_VIEW) {
    if (!Number.isInteger(msg.tabId) || !["original", "translated"].includes(msg.view)) {
      sendResponse({ ok: false, reason: "restricted" });
      return;
    }
    setPageView(msg.tabId, msg.view).then(sendResponse, (err) => {
      console.error("[Lingua] page view switch failed:", err);
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }
  if (msg?.type === MSG.SHOW_CACHED_PAGE) {
    if (!Number.isInteger(msg.tabId)) { sendResponse({ ok: false, cached: false, reason: "restricted" }); return; }
    showCachedPage(msg.tabId, msg.to).then(sendResponse, (err) => {
      console.error("[Lingua] cached page view failed:", err);
      sendResponse({ ok: false, cached: false, error: err.message });
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
  if (msg?.type === MSG.READ_ALOUD_COMMAND) {
    readAloudCommand(msg.command).then(sendResponse, (err) => {
      console.error("[Lingua] read-aloud command failed:", err);
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }
  if (msg?.type === MSG.PHRASE_AUDIO_COMMAND) {
    try { sendResponse(handlePhraseAudioCommand(msg.command)); }
    catch (err) { console.error("[Lingua] phrase audio failed:", err); sendResponse({ ok: false, reason: "unavailable" }); }
  }
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "loading") return;
  readAloudCommand({ action: "reset", tabId }).catch(() => {});
  // A reload or navigation starts a new document. Keep target-language preference
  // in the side panel, but never carry translated-page or narration state over.
  clearState(tabId).catch((err) => console.error("[Lingua] couldn't clear page state on navigation:", err));
  pageViewCache.delete(tabId);
});

// Narration is tied to the page the user started it from. Leaving that tab is
// an explicit stop, rather than allowing speech from a background page to
// continue against a different webpage.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (narration?.tabId !== tabId) stopNarration({ reset: true });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  runs.get(tabId)?.abort();
  runs.delete(tabId);
  pageViewCache.delete(tabId);
  if (narration?.tabId === tabId) stopNarration({ reset: true });
  clearState(tabId).catch(() => {});
});

// Everything the side panel needs to know about the browser tab lives here, so feature
// tabs never touch chrome.tabs directly.
import { MSG } from "./messages.js";

const RESTRICTED =
  /^(chrome|chrome-extension|chrome-search|chrome-untrusted|edge|about|devtools|view-source):|^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i;

export function isReadable(url) {
  return Boolean(url) && !RESTRICTED.test(url);
}

export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ?? null;
}

async function ask(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

// Tabs that were open before the extension was installed don't have the content script yet.
async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content/content.js"] });
}

async function askWithInjectionFallback(tab, message) {
  if (!tab || !isReadable(tab.url)) return { ok: false, reason: "restricted" };
  try {
    return await ask(tab.id, message);
  } catch (_) {
    try {
      await injectContentScript(tab.id);
      return await ask(tab.id, message);
    } catch (_) {
      return { ok: false, reason: "unreachable" };
    }
  }
}

export function getPageText(tab) {
  return askWithInjectionFallback(tab, { type: MSG.GET_PAGE_TEXT });
}

export function getPageSegments(tab, maxChars) {
  return askWithInjectionFallback(tab, { type: MSG.GET_PAGE_SEGMENTS, maxChars });
}

export function applyPageTranslation(tab, translations) {
  return askWithInjectionFallback(tab, { type: MSG.APPLY_PAGE_TRANSLATION, translations });
}

export function restorePageText(tab) {
  return askWithInjectionFallback(tab, { type: MSG.RESTORE_PAGE_TEXT });
}

export function translatePage(tab, to) {
  if (!tab?.id || !isReadable(tab.url)) return Promise.resolve({ ok: false, reason: "restricted" });
  return chrome.runtime.sendMessage({ type: MSG.TRANSLATE_PAGE, tabId: tab?.id, to });
}

export function restorePage(tab) {
  if (!tab?.id || !isReadable(tab.url)) return Promise.resolve({ ok: false, reason: "restricted" });
  return chrome.runtime.sendMessage({ type: MSG.RESTORE_PAGE, tabId: tab?.id });
}

export function getPageState(tab) {
  if (!tab?.id || !isReadable(tab.url)) return Promise.resolve({ ok: false, reason: "restricted" });
  return chrome.runtime.sendMessage({ type: MSG.GET_PAGE_STATE, tabId: tab?.id });
}

export function watchPageState(cb) {
  const handler = (msg) => {
    if (msg?.type === MSG.PAGE_PROGRESS || msg?.type === MSG.PAGE_STATE || msg?.type === MSG.PAGE_ERROR) cb(msg);
  };
  chrome.runtime.onMessage.addListener(handler);
  return () => chrome.runtime.onMessage.removeListener(handler);
}

export function getSelectionText(tab) {
  return askWithInjectionFallback(tab, { type: MSG.GET_SELECTION });
}

/** cb(text, tab) fires whenever the user highlights something in the active tab. */
export function watchSelection(cb) {
  const handler = (msg, sender) => {
    if (msg?.type === MSG.SELECTION && sender.tab?.active) cb(msg.text ?? "", sender.tab);
  };
  chrome.runtime.onMessage.addListener(handler);
  return () => chrome.runtime.onMessage.removeListener(handler);
}

/** cb(tab) fires when the user switches tabs/windows or a tab finishes loading. */
export function watchActiveTab(cb) {
  const emit = async () => cb(await getActiveTab());
  const onUpdated = (_id, info, tab) => {
    if (info.status === "complete" && tab.active) emit();
  };
  chrome.tabs.onActivated.addListener(emit);
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.windows.onFocusChanged.addListener(emit);
  return () => {
    chrome.tabs.onActivated.removeListener(emit);
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.windows.onFocusChanged.removeListener(emit);
  };
}

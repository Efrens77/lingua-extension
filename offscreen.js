// Document context used by the service worker for Chrome's document-only AI APIs.
import { translateWithChrome } from "./core/translation/chrome.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "lingua/chrome-translate") return;
  translateWithChrome({ ...message.request, allowDownload: false }).then(sendResponse, (err) => {
    console.error("[Lingua] offscreen Chrome translation failed:", err);
    sendResponse({ ok: false, reason: "unavailable" });
  });
  return true;
});

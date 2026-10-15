// Lingua service worker.
// Its only job right now: open the side panel when the toolbar icon is clicked.
// A side panel (not a popup) is used because a popup closes the moment you click
// the page, which would make "highlight text to translate it" impossible.

function enableSidePanelOnActionClick() {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("[Lingua] setPanelBehavior failed:", err));
}

chrome.runtime.onInstalled.addListener(enableSidePanelOnActionClick);
chrome.runtime.onStartup.addListener(enableSidePanelOnActionClick);

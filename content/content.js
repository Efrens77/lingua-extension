// Lingua content script. Runs in every page.
//  1. Reports the user's highlighted text to the side panel.
//  2. Returns the page's readable text when the side panel asks for it.
//
// NOTE: content scripts can't use ES module imports, so the message names below
// are duplicated from core/messages.js. Keep the two in sync.
(() => {
  if (window.__linguaLoaded) return;
  window.__linguaLoaded = true;

  const MSG = {
    SELECTION: "lingua/selection-changed",
    GET_SELECTION: "lingua/get-selection",
    GET_PAGE_TEXT: "lingua/get-page-text",
    GET_PAGE_SEGMENTS: "lingua/get-page-segments",
    APPLY_PAGE_TRANSLATION: "lingua/apply-page-translation",
    RESTORE_PAGE_TEXT: "lingua/restore-page-text",
  };
  const MAX_PAGE_CHARS = 60000;

  // ---------- Selection ----------
  function readSelection() {
    const sel = window.getSelection();
    let text = sel ? sel.toString().trim() : "";
    if (!text) {
      // Text selected inside <input>/<textarea> isn't exposed by getSelection().
      const el = document.activeElement;
      if (el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && /^(text|search)$/i.test(el.type)))) {
        try {
          text = el.value.substring(el.selectionStart, el.selectionEnd).trim();
        } catch (_) { /* some input types throw */ }
      }
    }
    return text;
  }

  let lastSent = "";
  let timer = null;
  function reportSelection() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const text = readSelection();
      if (text === lastSent) return;
      lastSent = text;
      try {
        chrome.runtime.sendMessage({ type: MSG.SELECTION, text, url: location.href }).catch(() => {});
      } catch (_) { /* extension was reloaded; this script is stale */ }
    }, 250);
  }
  document.addEventListener("selectionchange", reportSelection);
  document.addEventListener("mouseup", reportSelection);
  document.addEventListener("keyup", reportSelection);

  // ---------- Page text ----------
  const BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dt,dd,pre,summary";
  const SKIP =
    'script,style,noscript,template,[aria-hidden="true"],pre,code,svg,' +
    'input,textarea,select,option,[contenteditable],[role="textbox"],[hidden]';
  let pageSegments = new Map();

  function isVisible(el) {
    return typeof el.checkVisibility === "function"
      ? el.checkVisibility({ checkVisibilityCSS: true })
      : el.getClientRects().length > 0;
  }

  function pickRoot() {
    // Full Page translates visible text across the page, including menus and controls.
    return document.body;
  }

  function extractPageText() {
    const root = pickRoot();
    const parts = [];
    for (const el of root.querySelectorAll(BLOCKS)) {
      if (el.querySelector(BLOCKS)) continue; // only leaf blocks, avoids duplicates
      if (el.closest(SKIP)) continue;
      if (!isVisible(el)) continue;
      const t = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (t.length < 2 || parts[parts.length - 1] === t) continue;
      parts.push(t);
    }
    let text = parts.join("\n");
    if (text.length < 200) text = (root.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
    if (text.length < 200) text = (document.body.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
    return text.slice(0, MAX_PAGE_CHARS);
  }

  // Page translation changes only Text nodes. Their containing elements (including links)
  // remain in place, so hrefs, event listeners, and normal page interaction are preserved.
  function restorePageText() {
    let restored = 0;
    for (const { node, original } of pageSegments.values()) {
      if (node.isConnected) {
        node.nodeValue = original;
        restored++;
      }
    }
    return restored;
  }

  function collectPageSegments(maxChars = 12000) {
    restorePageText();
    const root = pickRoot();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const segments = [];
    let used = 0;
    let id = 0;
    let node;

    while ((node = walker.nextNode()) && used < maxChars) {
      const parent = node.parentElement;
      const original = node.nodeValue || "";
      if (!parent || !original.trim() || parent.closest(SKIP) || !isVisible(parent)) continue;

      const text = original.slice(0, Math.max(0, maxChars - used));
      if (!text.trim()) continue;
      const segmentId = String(++id);
      pageSegments.set(segmentId, { node, original, source: text });
      segments.push({ id: segmentId, text });
      used += text.length;
    }

    return {
      ok: true,
      segments,
      title: document.title,
      url: location.href,
      lang: document.documentElement.lang || "",
      truncated: used >= maxChars,
    };
  }

  function applyPageTranslation(translations) {
    let applied = 0;
    for (const item of translations || []) {
      const entry = pageSegments.get(String(item?.id));
      if (!entry?.node?.isConnected || typeof item?.text !== "string") continue;
      // Do not overwrite a text node changed by the page while Lingua was translating.
      if (entry.node.nodeValue !== entry.original) continue;
      entry.node.nodeValue = item.text + entry.original.slice(entry.source.length);
      applied++;
    }
    return { ok: true, applied, total: pageSegments.size };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === MSG.GET_PAGE_TEXT) {
      sendResponse({
        ok: true,
        text: extractPageText(),
        title: document.title,
        url: location.href,
        lang: document.documentElement.lang || "",
      });
    } else if (msg?.type === MSG.GET_SELECTION) {
      sendResponse({ ok: true, text: readSelection() });
    } else if (msg?.type === MSG.GET_PAGE_SEGMENTS) {
      sendResponse(collectPageSegments(Number(msg.maxChars) || 12000));
    } else if (msg?.type === MSG.APPLY_PAGE_TRANSLATION) {
      sendResponse(applyPageTranslation(msg.translations));
    } else if (msg?.type === MSG.RESTORE_PAGE_TEXT) {
      sendResponse({ ok: true, restored: restorePageText() });
    }
    // Synchronous responses only, so no `return true`.
  });
})();

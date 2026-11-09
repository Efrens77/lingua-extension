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
    GET_READ_ALOUD_TEXT: "lingua/get-read-aloud-text",
    GET_PAGE_SEGMENTS: "lingua/get-page-segments",
    APPLY_PAGE_TRANSLATION: "lingua/apply-page-translation",
    RESTORE_PAGE_TEXT: "lingua/restore-page-text",
    SET_PAGE_TEXT_VIEW: "lingua/set-page-text-view",
    SHOW_CACHED_PAGE: "lingua/show-cached-page",
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
        chrome.runtime.sendMessage({
          type: MSG.SELECTION, text, url: location.href, lang: document.documentElement.lang || "",
        }).catch(() => {});
      } catch (_) { /* extension was reloaded; this script is stale */ }
    }, 250);
  }
  document.addEventListener("selectionchange", reportSelection);
  document.addEventListener("mouseup", reportSelection);
  document.addEventListener("keyup", reportSelection);

  // ---------- Page text ----------
  const ARTICLE_BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,blockquote,[class*='subtitle' i],[class*='subhead' i],[class*='deck' i],[class*='dek' i]";
  // Read Aloud focuses on editorial prose. Byline and publication metadata is
  // useful visually but interrupts narration, so exclude it independently of
  // the broader Full Page Translation collector.
  const NARRATION_METADATA = "time,[rel='author'],[itemprop='author'],[itemprop='datePublished'],[itemprop='dateModified'],[class*='byline' i],[class*='dateline' i],[class*='author' i],[class*='publish-date' i],[class*='publication-date' i],[data-testid*='author' i],[data-testid*='date' i]";
  // Translation intentionally has a very small exclusion list. It collects
  // visible text throughout the page, including navigation, sidebars, footer
  // copy, and visible sponsored/ad cards.
  const TRANSLATION_SKIP =
    'script,style,noscript,template,svg,canvas,iframe,object,embed,[aria-hidden="true"],[hidden],' +
    'input,textarea,select,option,[contenteditable],[role="textbox"],' +
    "[data-lingua-root],[data-lingua-ui],[id^='lingua-']";
  // Narration is deliberately much stricter than translation. These patterns
  // describe common non-editorial modules without relying on a particular site.
  const ARTICLE_SKIP = TRANSLATION_SKIP + ",nav,footer,aside,form,dialog,button,[role='navigation'],[role='toolbar'],[role='complementary'],[role='dialog']," +
    "[id*='cookie' i],[class*='cookie' i],[id*='consent' i],[class*='consent' i],[id*='privacy' i],[class*='privacy' i]," +
    "[id*='advert' i],[class*='advert' i],[class~='ad' i],[class^='ad-' i],[class*=' ad-' i],[data-ad],[data-advertisement]," +
    "[id*='sponsor' i],[class*='sponsor' i],[id*='promot' i],[class*='promot' i]," +
    "[id*='sidebar' i],[class*='sidebar' i],[id*='comment' i],[class*='comment' i]," +
    "[id*='related' i],[class*='related' i],[id*='recommend' i],[class*='recommend' i]," +
    "[id*='newsletter' i],[class*='newsletter' i],[class*='share' i],[class*='social' i]," +
    "figure,figcaption,picture,video,audio,[role='figure'],[class*='gallery' i]," +
    "table,caption,thead,tbody,tfoot,tr,td,th,[role='table'],[class*='chart' i],[class*='ticker' i]," +
    "[id*='paywall' i],[class*='paywall' i],[id*='signin' i],[class*='signin' i],[id*='login' i],[class*='login' i]," +
    "[class*='sr-only' i],[class*='visually-hidden' i],[class*='screen-reader' i]";
  let pageSegments = new Map();
  let pageView = "original";

  function isVisible(el) {
    return typeof el.checkVisibility === "function"
      ? el.checkVisibility({ checkVisibilityCSS: true })
      : el.getClientRects().length > 0;
  }

  function normalizedText(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/[\u200b-\u200d\ufeff]/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  function cleanNarrationText(value) {
    return normalizedText(value)
      // Decorative glyphs and control characters are commonly read as their
      // Unicode names. Keep punctuation that contributes to natural phrasing.
      .replace(/[•◦▪▫◆◇★☆→←↑↓✓✔✕✖]/g, " ")
      .replace(/[“”"]/g, "")
      .replace(/[^\p{L}\p{N}\s.,;:!?…'“”‘’"()\-—–/%&$#+=@]/gu, " ")
      .replace(/(^|\s)[.,;:!?…'“”‘’"()\-—–/%&$#+=@]{1,}(?=\s|$)/g, "$1")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/([!?.,;:]){3,}/g, "$1")
      .replace(/\s+/g, " ").trim();
  }

  function visibleTextLength(element) {
    return normalizedText(element.innerText).length;
  }

  function isNarrationMetadata(element) {
    return element.matches?.(NARRATION_METADATA) || Boolean(element.querySelector?.(NARRATION_METADATA));
  }

  function articleMetrics(element) {
    let bodyChars = 0;
    let paragraphs = 0;
    for (const paragraph of element.querySelectorAll("p,blockquote")) {
      if (paragraph.closest(ARTICLE_SKIP) || isNarrationMetadata(paragraph) || !isVisible(paragraph)) continue;
      const text = cleanNarrationText(paragraph.innerText);
      if (text.length >= 40) { bodyChars += text.length; paragraphs++; }
    }
    return { bodyChars, paragraphs, totalChars: visibleTextLength(element) };
  }

  function isEditorialRoot(element) {
    const metrics = articleMetrics(element);
    // This admits long-form stories while rejecting article-shaped navigation,
    // recommendation cards, and most sponsored cards.
    return (metrics.paragraphs >= 2 && metrics.bodyChars >= 180)
      || (metrics.paragraphs >= 1 && metrics.bodyChars >= 700);
  }

  function articleRoots() {
    const selector = "article,[role='article'],[itemprop='articleBody'],[class*='article-body' i],[class*='article-content' i],[class*='post-content' i],[class*='entry-content' i]";
    const candidates = [...document.querySelectorAll(selector)]
      .filter((element) => isVisible(element) && !element.closest(ARTICLE_SKIP) && isEditorialRoot(element));
    const semantic = candidates.filter((element) => element.matches("article,[role='article']"));
    const independent = (items, preferOuter) => items.filter((element) => !items.some((other) => other !== element
      && (preferOuter ? other.contains(element) : element.contains(other))));
    // A semantic <article> must win over its nested articleBody/content
    // wrapper. The old smallest-container rule selected that wrapper on some
    // publishers, omitting the headline/header or starting mid-article.
    const roots = semantic.length ? independent(semantic, true) : independent(candidates, false);
    if (roots.length) return roots;

    // Some publishers expose only a <main>. Use it as one ordered article-like
    // root after the semantic choices above have been exhausted.
    const mains = [...document.querySelectorAll("main,[role='main']")]
      .filter((element) => isVisible(element) && !element.closest(ARTICLE_SKIP));
    if (mains.length) return [mains.sort((a, b) => visibleTextLength(b) - visibleTextLength(a))[0]];
    return [document.body];
  }

  function belongsToNestedArticle(element, root, roots) {
    return roots.some((other) => other !== root && root.contains(other) && other.contains(element));
  }

  function articleTextBlocks(root, roots) {
    const seen = new Set();
    const blocks = [];
    for (const element of root.querySelectorAll(ARTICLE_BLOCKS)) {
      // A header inside a selected article commonly owns the headline and
      // byline; only reject headers when the body fallback is being used.
      if (element.closest(ARTICLE_SKIP) || belongsToNestedArticle(element, root, roots)
        || isNarrationMetadata(element) || (root === document.body && element.closest("header")) || !isVisible(element)) continue;
      // Only list containers are skipped for nested textual children. The old
      // generic nested-selector check could discard valid paragraphs/decks
      // wrapped with metadata or other inline article markup.
      if (element.tagName === "LI" && element.querySelector("p,blockquote,li")) continue;
      const text = cleanNarrationText(element.innerText);
      const key = text.toLocaleLowerCase();
      if (text.length < 2 || seen.has(key)) continue;
      seen.add(key);
      const type = element.matches("h1") ? "title"
        : element.matches("[class*='subtitle' i],[class*='subhead' i],[class*='deck' i],[class*='dek' i]") ? "deck"
          : /^H[2-6]$/.test(element.tagName) ? "heading"
        : element.tagName === "LI" ? "item"
        : "paragraph";
      blocks.push({
        type,
        text,
      });
    }
    return blocks;
  }

  function fallbackArticleBlocks(root, roots) {
    // Framework pages occasionally render prose in non-semantic <div>s. Only
    // use this fallback when ordinary paragraphs were absent, and group text by
    // its nearest visible block container to preserve page order.
    const blocks = [];
    const seen = new Set();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest(ARTICLE_SKIP) || isNarrationMetadata(parent)
        || belongsToNestedArticle(parent, root, roots) || !isVisible(parent)) continue;
      const holder = parent.closest("p,blockquote,div,section") || parent;
      if (!root.contains(holder) || holder.closest(ARTICLE_SKIP) || isNarrationMetadata(holder) || seen.has(holder)) continue;
      // Never use a layout wrapper as a fallback block: it would repeat every
      // descendant paragraph as one giant, disconnected snippet.
      if (holder.matches("div,section") && holder.querySelector("div,section")) continue;
      const text = cleanNarrationText(holder.innerText);
      if (text.length < 40) continue;
      seen.add(holder);
      blocks.push({ type: "paragraph", text });
    }
    return blocks;
  }

  function extractPageText() {
    return [...document.body.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dt,dd,summary,button,a")]
      .filter((element) => !element.closest(TRANSLATION_SKIP) && isVisible(element))
      .map((element) => normalizedText(element.innerText))
      .filter((text, index, values) => text.length > 1 && values.indexOf(text) === index)
      .join("\n").slice(0, MAX_PAGE_CHARS);
  }

  function extractReadAloudText() {
    const roots = articleRoots();
    const parts = [];
    for (const root of roots) {
      let articleParts = articleTextBlocks(root, roots);
      const bodyChars = articleParts.filter((item) => item.type === "paragraph" || item.type === "item")
        .reduce((sum, item) => sum + item.text.length, 0);
      if (bodyChars < 120) articleParts = fallbackArticleBlocks(root, roots);
      // A browser title is useful only when this article has no visible
      // headline. Do not prepend it to later articles on a multi-story page.
      if (!articleParts.some((item) => item.type === "title" || item.type === "heading") && parts.length === 0 && document.title) {
        articleParts.unshift({ type: "heading", text: cleanNarrationText(document.title) });
      }
      parts.push(...articleParts);
    }
    const blocks = [];
    let used = 0;
    for (const item of parts) {
      if (used >= MAX_PAGE_CHARS) break;
      const text = item.text.slice(0, MAX_PAGE_CHARS - used);
      if (text) blocks.push({ ...item, text });
      used += text.length;
    }
    return { text: blocks.map((item) => item.text).join("\n"), blocks };
  }

  function readableArticleSize() {
    return articleRoots().reduce((sum, root) => sum + articleMetrics(root).bodyChars, 0);
  }

  async function waitForArticleContent() {
    // A click can arrive while a publisher is hydrating the story body. Wait a
    // short, bounded interval only when the page still looks title-only.
    if (readableArticleSize() >= 180) return;
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timeout);
        resolve();
      };
      const observer = new MutationObserver(() => {
        if (readableArticleSize() >= 180) finish();
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      const timeout = setTimeout(finish, 1400);
    });
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
    pageView = "original";
    return restored;
  }

  function swapPageView(view) {
    if (view === pageView) return Promise.resolve({ ok: true, cached: pageSegments.size > 0, applied: 0 });
    if (!pageSegments.size) return Promise.resolve({ ok: true, cached: false, applied: 0 });
    const x = window.scrollX;
    const y = window.scrollY;
    return new Promise((resolve) => requestAnimationFrame(() => {
      let applied = 0;
      for (const entry of pageSegments.values()) {
        if (!entry.node?.isConnected) continue;
        const next = view === "translated" ? entry.translated : entry.original;
        if (typeof next !== "string" || entry.node.nodeValue === next) continue;
        entry.node.nodeValue = next;
        applied++;
      }
      pageView = view;
      requestAnimationFrame(() => {
        window.scrollTo(x, y);
        resolve({ ok: true, cached: view === "translated" && applied > 0, applied });
      });
    }));
  }

  function collectPageSegments(maxChars = 12000) {
    restorePageText();
    // A fresh collection belongs to the current document state. Keeping old
    // node references would let a later apply pass touch stale/detached text.
    pageSegments = new Map();
    const segments = [];
    const seenNodes = new Set();
    let used = 0;
    let id = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && used < maxChars) {
      if (seenNodes.has(node)) continue;
      seenNodes.add(node);
      const parent = node.parentElement;
      const original = node.nodeValue || "";
      const text = normalizedText(original);
      if (!parent || !text || parent.closest(TRANSLATION_SKIP) || !isVisible(parent)) continue;
      const source = original.slice(0, Math.max(0, maxChars - used));
      if (!source.trim()) continue;
      const segmentId = String(++id);
      pageSegments.set(segmentId, { node, original, source });
      segments.push({ id: segmentId, text: source });
      used += source.length;
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

  function preserveSegmentWhitespace(translated, source) {
    // Translation providers commonly trim each request. Because inline links
    // split a sentence into separate text nodes, preserve the source node's
    // boundary whitespace so adjacent translated nodes do not run together.
    const leading = source.match(/^\s+/u)?.[0] || "";
    const trailing = source.match(/\s+$/u)?.[0] || "";
    const text = String(translated || "").trim();
    return text ? leading + text + trailing : String(translated || "");
  }

  function applyPageTranslation(translations) {
    for (const item of translations || []) {
      const entry = pageSegments.get(String(item?.id));
      if (!entry?.node?.isConnected || typeof item?.text !== "string") continue;
      // Do not overwrite a text node changed by the page while Lingua was translating.
      if (entry.node.nodeValue !== entry.original) continue;
      entry.translated = preserveSegmentWhitespace(item.text, entry.source) + entry.original.slice(entry.source.length);
    }
    return swapPageView("translated").then((result) => ({ ...result, total: pageSegments.size }));
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
    } else if (msg?.type === MSG.GET_READ_ALOUD_TEXT) {
      waitForArticleContent().then(() => {
        sendResponse({ ok: true, ...extractReadAloudText(), lang: document.documentElement.lang || "" });
      }, () => sendResponse({ ok: false, reason: "unavailable" }));
      return true;
    } else if (msg?.type === MSG.GET_SELECTION) {
      sendResponse({ ok: true, text: readSelection(), lang: document.documentElement.lang || "" });
    } else if (msg?.type === MSG.GET_PAGE_SEGMENTS) {
      sendResponse(collectPageSegments(Number(msg.maxChars) || 12000));
    } else if (msg?.type === MSG.APPLY_PAGE_TRANSLATION) {
      applyPageTranslation(msg.translations).then(sendResponse);
      return true;
    } else if (msg?.type === MSG.RESTORE_PAGE_TEXT) {
      swapPageView("original").then((result) => sendResponse({ ...result, restored: result.applied }));
      return true;
    } else if (msg?.type === MSG.SET_PAGE_TEXT_VIEW) {
      swapPageView(msg.view).then(sendResponse);
      return true;
    } else if (msg?.type === MSG.SHOW_CACHED_PAGE) {
      swapPageView("translated").then(sendResponse);
      return true;
    }
    // Synchronous responses only, so no `return true`.
  });
})();

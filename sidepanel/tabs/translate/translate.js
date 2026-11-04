// Translate tab.
//  - Full page: reads the active tab's text automatically and translates it.
//  - Phrase:    translates whatever you highlight on the page (or type into the box).
// Everything browser-specific goes through ctx.bridge, everything translation-specific
// through ctx.translator, so this file is only UI + state.
import { LANGUAGES, AUTO_CODE, nameOf, isSupported } from "../../../core/languages.js";
import { LIMITS } from "../../../core/config.js";
import { ICONS } from "../../icons.js";

const PREFS_KEY = "translate.prefs";
const PHRASE_SESSION_KEY = "translate.phrase-session";
const RECENT_KEY = "translate.recent";
const MAX_RECENT = 5;
const TYPING_DELAY_MS = 600;

const HINTS = {
  page: "Lingua detects the page language and translates readable text in place. Switch back to Original text at any time.",
  phrase: "Highlight text on the page or type it below. Short passages work best here.",
};

const PAGE_PROBLEMS = {
  restricted:
    "Chrome doesn't let extensions read this kind of page (chrome:// pages, the Web Store). Open a regular website, or switch to Phrase and type your text.",
  unreachable:
    "Lingua couldn't read this page. Try reloading the tab. PDFs opened in Chrome's built-in viewer can't be read yet.",
  empty: "This page doesn't have any readable text.",
};

const TEMPLATE = `
  <section class="card mode-card">
    <h2 class="card-title">Translate mode</h2>
    <div class="segmented" role="radiogroup" aria-label="Translate mode">
      <button type="button" role="radio" data-mode="page">Full page</button>
      <button type="button" role="radio" data-mode="phrase">Phrase</button>
    </div>
    <p class="hint" data-el="hint"></p>
  </section>

  <div class="lang-row" data-el="langRow">
    <select data-el="from" aria-label="Translate from"></select>
    <button type="button" class="icon-btn round" data-el="swap" aria-label="Swap languages" title="Swap languages">${ICONS.swap}</button>
    <select data-el="to" aria-label="Translate to"></select>
  </div>

  <div class="page-view-toggle" data-el="pageViewToggle" role="group" aria-label="Page text view" hidden>
    <button type="button" data-el="originalView">Original text</button>
    <button type="button" data-el="translatedView">Translated text</button>
  </div>

  <section class="card source-card" data-el="sourceCard">
    <div class="card-head">
      <label class="field-label" for="tr-source">Original text</label>
      <span class="chip" data-el="detected" hidden></span>
      <span class="spacer"></span>
      <button type="button" class="icon-btn" data-el="refresh" aria-label="Re-read this page" title="Re-read this page">${ICONS.refresh}</button>
      <button type="button" class="icon-btn" data-el="clear" aria-label="Clear text" title="Clear text">${ICONS.clear}</button>
    </div>
    <p class="meta" data-el="pageMeta" hidden></p>
    <textarea id="tr-source" data-el="source" rows="6" spellcheck="false"></textarea>
    <div class="card-foot"><span class="count" data-el="count"></span></div>
  </section>

  <section class="card result-card" data-el="resultCard">
    <div class="result-text" data-el="resultText" tabindex="0"></div>
    <div class="status" data-el="status" role="status" aria-live="polite"></div>
    <div class="actions" data-el="actions" hidden>
      <button type="button" class="icon-btn" data-el="copy" aria-label="Copy translation" title="Copy translation">${ICONS.copy}</button>
      <button type="button" class="icon-btn" data-el="speak" aria-label="Listen to translation" title="Listen to translation">${ICONS.speaker}</button>
    </div>
  </section>
  <section class="page-read" data-el="pageRead" hidden>
    <button type="button" data-el="readAloud">Read aloud</button>
    <div class="page-read-controls" data-el="readControls" hidden>
      <button type="button" data-el="readStop">Stop</button>
      <button type="button" data-el="readRestart">Restart</button>
    </div>
    <div class="page-read-progress" data-el="readProgress" hidden>
      <span data-el="readElapsed">0:00</span>
      <input type="range" data-el="readSeek" min="0" max="1" step="0.1" value="0" aria-label="Reading progress" />
      <span data-el="readDuration">0:00</span>
    </div>
  </section>

  <section class="recent" data-el="recentSection" hidden>
    <h3 class="section-label">Recent translations</h3>
    <ul class="recent-list" data-el="recentList"></ul>
  </section>
`;

function loadStylesheet() {
  const href = new URL("./translate.css", import.meta.url).href;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.append(link);
}

function defaultTarget() {
  const code = (navigator.language || "en").split("-")[0];
  return code !== "en" && isSupported(code) ? code : "es";
}

function optionHtml(list, withAuto, i18n) {
  const auto = withAuto ? `<option value="${AUTO_CODE}">Detect language</option>` : "";
  return auto + list.map((l) => `<option value="${l.code}">${i18n.languageName(l.code, l.name)}</option>`).join("");
}

export default {
  async mount(root, ctx) {
    const { bridge, storage, translator, i18n } = ctx;
    loadStylesheet();
    root.innerHTML = TEMPLATE;

    const el = Object.fromEntries([...root.querySelectorAll("[data-el]")].map((n) => [n.dataset.el, n]));
    const modeButtons = [...root.querySelectorAll("[data-mode]")];

    function t(key) { return i18n.t(key); }
    function hintFor(mode) { return mode === "page" ? t("pageHint") : t("phraseHint"); }
    function localize() {
      root.querySelector(".card-title").textContent = t("translateMode");
      root.querySelector('[data-mode="page"]').textContent = t("fullPage");
      root.querySelector('[data-mode="phrase"]').textContent = t("phrase");
      el.from.setAttribute("aria-label", t("from"));
      el.to.setAttribute("aria-label", t("to"));
      el.swap.setAttribute("aria-label", t("from"));
      el.originalView.textContent = t("original");
      el.translatedView.textContent = t("translated");
      root.querySelector(".field-label").textContent = t("originalText");
      el.refresh.setAttribute("aria-label", t("refresh")); el.refresh.title = t("refresh");
      el.clear.setAttribute("aria-label", t("clear")); el.clear.title = t("clear");
      el.copy.setAttribute("aria-label", t("copy")); el.copy.title = t("copy");
      el.speak.setAttribute("aria-label", t("listen")); el.speak.title = t("listen");
      renderReadAloud();
      root.querySelector(".section-label").textContent = t("recent");
      el.hint.textContent = hintFor(state.mode);
      renderLanguageOptions();
      renderSource();
      setResult(state.result ? "done" : "empty");
    }

    const saved = await storage.get(PREFS_KEY, {});
    const savedPhrase = await storage.get(PHRASE_SESSION_KEY, {});
    const state = {
      mode: saved.mode === "phrase" ? "phrase" : "page",
      from: saved.from && (saved.from === AUTO_CODE || isSupported(saved.from)) ? saved.from : AUTO_CODE,
      to: saved.to && isSupported(saved.to) ? saved.to : defaultTarget(),
      text: { page: "", phrase: String(savedPhrase.text || "") },
      pageState: null,
      pageView: "original",
      pageMeta: null,
      detected: null,
      result: saved.mode === "phrase" ? String(savedPhrase.result || "") : "",
      lastKey: saved.mode === "phrase" ? String(savedPhrase.lastKey || "") : "",
      lastPageId: "",
      runId: 0,
      controller: null,
      active: false,
      recent: await storage.get(RECENT_KEY, []),
      pageReading: false, pageAudioBlocking: false, phraseSpeaking: false, readState: null, sliderPhase: "none", sliderPreview: 0, readWasPlaying: false, readCommandToken: 0, invalidReadSessions: new Set(), activeTabId: null, pageViewToken: 0,
      progressSessionId: "", progressRevision: -1, progressFloor: 0,
    };
    let runTimer = null;
    let recentTimer = null;
    let importToken = 0;

    const limit = () => (state.mode === "page" ? LIMITS.page : LIMITS.phrase);
    const persist = () => storage.set(PREFS_KEY, { mode: state.mode, from: state.from, to: state.to });
    const persistPhrase = () => {
      const next = {
        text: state.text.phrase, result: state.mode === "phrase" ? state.result : savedPhrase.result || "",
        lastKey: state.mode === "phrase" ? state.lastKey : savedPhrase.lastKey || "",
      };
      Object.assign(savedPhrase, next);
      return storage.set(PHRASE_SESSION_KEY, next);
    };

    // ---------- rendering ----------
    function syncSelects() {
      el.from.value = state.from;
      el.to.value = state.to;
    }

    function renderLanguageOptions() {
      el.from.innerHTML = optionHtml(LANGUAGES, true, i18n);
      el.to.innerHTML = optionHtml(LANGUAGES, false, i18n);
      syncSelects();
    }

    renderLanguageOptions();

    function renderPageControls() {
      const isPage = state.mode === "page";
      el.langRow.dataset.mode = isPage ? "page" : "phrase";
      el.from.hidden = isPage;
      el.swap.hidden = isPage;
      el.pageViewToggle.hidden = !isPage;
      el.translatedView.disabled = false;
      el.translatedView.setAttribute("aria-pressed", String(state.pageView === "translated"));
      el.originalView.setAttribute("aria-pressed", String(state.pageView === "original"));
    }

    function renderSource() {
      const isPage = state.mode === "page";
      const text = state.text[state.mode];
      el.source.readOnly = isPage;
      el.source.maxLength = limit();
      el.source.value = text;
      el.source.placeholder = isPage ? "" : "Highlight text on the page, or type here…";
      el.sourceCard.hidden = isPage;
      el.pageRead.hidden = !isPage;
      el.refresh.hidden = !isPage;
      el.clear.hidden = isPage || !text;
      el.count.textContent = `${text.length.toLocaleString()} / ${limit().toLocaleString()}`;

      const meta = isPage && state.pageMeta;
      el.pageMeta.hidden = !meta;
      if (meta) {
        el.pageMeta.textContent = meta.truncated
          ? `${meta.title || "This page"} · only the first ${LIMITS.page.toLocaleString()} characters are translated`
          : meta.title || "";
      }

      el.detected.hidden = !state.detected;
      if (state.detected) el.detected.textContent = `${t("detected")} ${i18n.languageName(state.detected, nameOf(state.detected))}`;
      renderPageControls();
    }

    // kind: empty | loading | done | error | notice
    function setResult(kind, message = "") {
      if (state.mode === "page") {
        el.resultCard.hidden = true;
        return;
      }
      el.resultCard.hidden = false;
      el.resultCard.dataset.kind = kind;
      const showText = kind === "done" || kind === "loading";
      el.resultText.textContent =
        kind === "empty" ? t("result")
        : kind === "notice" ? message
        : showText ? state.result
        : "";
      el.status.replaceChildren();
      if (kind === "loading") el.status.textContent = message;
      if (kind === "error") {
        const span = document.createElement("span");
        span.textContent = message;
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "link-btn";
        retry.textContent = "Try again";
        retry.addEventListener("click", () => run({ force: true }));
        el.status.append(span, retry);
      }
      el.actions.hidden = !(state.mode === "phrase" && kind === "done" && state.result);
    }

    function setPageProgress(percent = null, message = "") {
      el.resultCard.hidden = percent === null;
      if (percent === null) return;
      el.resultCard.dataset.kind = "loading";
      el.resultText.textContent = "";
      el.status.textContent = message || `${t("translating")} ${percent}%`;
      el.actions.hidden = true;
    }

    function showPageMessage(message) {
      setPageProgress(0, message);
    }

    function stopPageRead() {
      bridge.readAloudCommand({ action: "pause", tabId: state.activeTabId }).catch(() => {});
      if (state.readState?.status === "playing") state.readState = { ...state.readState, status: "paused" };
      state.pageReading = false;
      renderReadAloud();
    }

    function resetPageRead() {
      state.readCommandToken++;
      if (state.readState?.sessionId) state.invalidReadSessions.add(state.readState.sessionId);
      const tabId = state.activeTabId ?? Number(state.lastPageId.split("|")[0]);
      if (Number.isInteger(tabId)) bridge.readAloudCommand({ action: "reset", tabId }).catch(() => {});
      state.readState = state.readState ? { ...state.readState, status: "idle", elapsed: 0, elapsedMs: 0 } : null;
      state.progressFloor = 0;
      state.pageReading = false;
      state.pageAudioBlocking = false;
      state.sliderPhase = "none";
      renderReadAloud();
    }

    function time(value) {
      const seconds = Math.max(0, Math.floor(Number(value) || 0));
      return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
    }

    function checkpointElapsed(read) {
      return Math.max(0, Number.isFinite(Number(read?.elapsedMs))
        ? Number(read.elapsedMs) / 1000 : Number(read?.elapsed) || 0);
    }

    function setReadState(read, { allowRewind = false } = {}) {
      const incomingRevision = Number(read?.revision || 0);
      if (!allowRewind && read?.sessionId === state.progressSessionId && incomingRevision < state.progressRevision) return false;
      if (!allowRewind && read?.sessionId !== state.progressSessionId && state.readState?.updatedAt
        && Number(read?.updatedAt || 0) < Number(state.readState.updatedAt)) return false;
      const sessionChanged = read?.sessionId !== state.progressSessionId || Number(read?.revision || 0) !== state.progressRevision;
      const checkpoint = checkpointElapsed(read);
      if (sessionChanged || allowRewind) {
        state.progressSessionId = read?.sessionId || "";
        state.progressRevision = incomingRevision;
        state.progressFloor = checkpoint;
      } else {
        state.progressFloor = Math.max(state.progressFloor, checkpoint);
      }
      state.readState = read;
      return true;
    }

    function displayedElapsed(read) {
      if (!read) return 0;
      const checkpoint = checkpointElapsed(read);
      if (read.status !== "playing" || !read.updatedAt) return Math.max(state.progressFloor, checkpoint);
      const elapsed = checkpoint + Math.max(0, Date.now() - Number(read.updatedAt)) / 1000;
      const next = Math.min(Number(read.duration) || elapsed, Math.max(state.progressFloor, elapsed));
      state.progressFloor = next;
      return next;
    }

    function isPageAudioBlocking(read) {
      return read?.status === "playing" || (read?.status === "seeking" && read.willResume);
    }

    function renderReadAloud() {
      const read = state.readState;
      const visible = Boolean(read && ["playing", "paused", "seeking"].includes(read.status));
      el.readAloud.hidden = visible;
      el.readControls.hidden = !visible;
      el.readProgress.hidden = !visible;
      el.readAloud.textContent = t("readAloud"); el.readAloud.setAttribute("aria-label", t("readAloud"));
      const pageAudioActive = isPageAudioBlocking(read);
      el.speak.disabled = pageAudioActive;
      el.speak.title = pageAudioActive ? t("otherAudioBlocked") : t("listen");
      el.speak.setAttribute("aria-label", pageAudioActive ? t("otherAudioBlocked") : t("listen"));
      if (!visible) return;
      const paused = read.status === "paused";
      el.readStop.textContent = paused ? t("resumeReading") : t("stopReading");
      el.readStop.setAttribute("aria-label", paused ? t("resumeReading") : t("stopReading"));
      el.readRestart.textContent = t("restartReading"); el.readRestart.setAttribute("aria-label", t("restartReading"));
      el.readSeek.max = String(Math.max(1, read.duration || 1));
      const previewing = state.sliderPhase !== "none";
      const elapsed = displayedElapsed(read);
      if (!previewing) el.readSeek.value = String(elapsed.toFixed(1));
      el.readElapsed.textContent = time(previewing ? state.sliderPreview : elapsed);
      el.readDuration.textContent = time(read.duration);
    }

    function narrationChunks(blocks) {
      return (blocks || []).map((block) => ({
        text: String(block.text || "").replace(/[•—–-]{2,}/g, " ").replace(/\s+/g, " ").trim(),
        pause: ["title", "deck", "heading"].includes(block.type) ? 420 : block.type === "item" ? 240 : 180,
      })).filter((block) => block.text);
    }

    async function readPageAloud() {
      try {
        const tab = await bridge.getActiveTab();
        if (!isUsablePageTab(tab)) { showPageMessage(t("regularPage")); return; }
        state.activeTabId = tab.id;
        const res = await bridge.getReadAloudText(tab);
        const chunks = narrationChunks(res?.blocks);
        if (!res?.ok || !chunks.length) { showPageMessage(t("readAloudUnavailable")); return; }
        const language = state.pageView === "translated" ? state.to : (state.detected || res.lang || "en");
        // A previous benign status must not outlive a successful user request.
        setPageProgress();
        // Full Page owns Chrome's extension TTS queue. Clear Phrase audio
        // before starting it, never after narration has announced itself.
        if (state.phraseSpeaking) bridge.phraseAudioCommand({ action: "stop" }).catch(() => {});
        state.phraseSpeaking = false;
        window.dispatchEvent(new Event("lingua-page-audio-start"));
        const started = await bridge.readAloudCommand({ action: "start", tabId: tab.id, chunks, language });
        if (started?.ok) setPageProgress();
        else if (started?.reason !== "cancelled") showPageMessage(t("readAloudUnavailable"));
      } catch (error) {
        console.error("[Lingua] page read-aloud failed:", error);
        showPageMessage(t("readAloudUnavailable"));
      }
    }

    function isUsablePageTab(tab) {
      return Boolean(tab?.id) && bridge.isReadable(tab.url);
    }

    function renderRecent() {
      // Recents belong to Phrase mode; Full page translations are not saved as recents.
      el.recentSection.hidden = state.mode !== "phrase" || state.recent.length === 0;
      el.recentList.replaceChildren(
        ...state.recent.map((item) => {
          const li = document.createElement("li");
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "recent-item";
          const src = document.createElement("span");
          src.className = "r-src";
          src.textContent = item.src;
          const out = document.createElement("span");
          out.className = "r-out";
          out.textContent = item.out;
          btn.append(src, out);
          btn.addEventListener("click", () => {
            applyMode("phrase", { import: false });
            state.from = item.from;
            state.to = item.to;
            syncSelects();
            persist();
            setPhrase(item.src);
          });
          li.append(btn);
          return li;
        })
      );
    }

    // ---------- translating ----------
    function cancelRun() {
      state.controller?.abort();
      state.controller = null;
      state.runId++;
    }

    function scheduleRun(delay = 0) {
      clearTimeout(runTimer);
      runTimer = setTimeout(run, delay);
    }

    async function run({ force = false } = {}) {
      if (state.mode === "page") return runPageTranslation({ force });
      const text = state.text[state.mode].trim();
      if (!text) {
        cancelRun();
        state.result = "";
        state.lastKey = "";
        state.detected = null;
        renderSource();
        setResult("empty");
        return;
      }
      const key = [state.mode, state.from, state.to, text].join("\u0001");
      if (!force && key === state.lastKey && state.result) {
        renderSource();
        setResult("done");
        return;
      }

      cancelRun();
      const controller = new AbortController();
      state.controller = controller;
      const id = ++state.runId;
      setResult("loading", "Translating…");

      try {
        const res = await translator.translate({
          text,
          from: state.from,
          to: state.to,
          signal: controller.signal,
          allowChromeDownload: Boolean(navigator.userActivation?.isActive),
          onModelProgress: (percent) => {
            if (id === state.runId) el.status.textContent = `${t("downloading")} ${percent}%`;
          },
          onProgress: ({ done, total }) => {
            if (id === state.runId && total > 1) el.status.textContent = `Translating… ${done}/${total}`;
          },
        });
        if (id !== state.runId) return;
        state.result = res.text;
        state.lastKey = key;
        state.detected = state.from === AUTO_CODE ? res.detectedFrom : null;
        persistPhrase();
        renderSource();
        setResult("done");
        if (state.mode === "phrase") queueRecent(text, res.text);
      } catch (err) {
        if (err?.name === "AbortError" || id !== state.runId) return;
        state.result = "";
        state.lastKey = "";
        const offline = navigator.onLine === false;
        console.error("[Lingua] phrase translation failed:", err);
        setResult("error", offline ? "You're offline." : t("unavailable"));
      }
    }

    async function runPageTranslation({ force = false } = {}) {
      try {
        const tab = await bridge.getActiveTab();
        if (!isUsablePageTab(tab)) {
          showPageMessage(t("regularPage"));
          return;
        }
        state.lastPageId = `${tab.id}|${tab.url}`;
        state.activeTabId = tab.id;
        resetPageRead();
        setPageProgress(0);
        const res = await bridge.translatePage(tab, state.to);
        if (!res?.ok) {
          setPageProgress(0, res?.rateLimited
            ? t("limit")
            : t("unavailable"));
          return;
        }
        state.pageState = res.state;
        state.pageView = "translated";
        renderSource();
        setPageProgress();
      } catch (err) {
        setPageProgress();
        console.error("[Lingua] page translation failed:", err);
      }
    }

    async function setPageView(view) {
      if (state.mode !== "page") return;
      const token = ++state.pageViewToken;
      resetPageRead();
      try {
        const tab = await bridge.getActiveTab();
        if (!isUsablePageTab(tab) || `${tab.id}|${tab.url}` !== state.lastPageId) return;
        state.activeTabId = tab.id;
        const res = await bridge.setPageView(tab, view);
        if (token !== state.pageViewToken || state.mode !== "page") return;
        if (!res?.ok) {
          if (view === "translated") {
            runPageTranslation();
            return;
          }
          console.error("[Lingua] page restore failed:", res?.error || res?.reason);
          showPageMessage("Lingua couldn't restore this page. Try reloading it.");
          return;
        }
        state.pageState = view === "translated" ? res.state : null;
        state.pageView = view;
        renderSource();
        setPageProgress();
      } catch (err) {
        if (token !== state.pageViewToken) return;
        console.error("[Lingua] page restore failed:", err);
        showPageMessage("Lingua couldn't restore this page. Try reloading it.");
      }
    }

    function queueRecent(src, out) {
      clearTimeout(recentTimer);
      if (src.length > 300) return;
      const item = { src, out, from: state.from, to: state.to };
      recentTimer = setTimeout(() => {
        state.recent = [item, ...state.recent.filter((r) => !(r.src === src && r.to === item.to))].slice(0, MAX_RECENT);
        storage.set(RECENT_KEY, state.recent);
        renderRecent();
      }, 1500);
    }

    // ---------- importing text from the page ----------
    async function importPage() {
      const token = ++importToken;
      try {
        const tab = await bridge.getActiveTab();
        if (token !== importToken || state.mode !== "page") return;
        if (!isUsablePageTab(tab)) {
          state.lastPageId = "";
          state.pageState = null;
          state.pageView = "original";
          renderSource();
          showPageMessage(t("regularPage"));
          return;
        }
        const nextPageId = `${tab.id}|${tab.url}`;
        if (state.lastPageId && state.lastPageId !== nextPageId) {
          resetPageRead();
          state.pageState = null;
          state.pageView = "original";
        }
        const res = await bridge.getPageState(tab);
        if (token !== importToken || state.mode !== "page") return;
        const pageState = res?.ok && res.state && typeof res.state.url === "string" && typeof res.state.view === "string"
          ? res.state
          : null;
        state.lastPageId = nextPageId;
        state.activeTabId = tab.id;
        state.pageState = pageState?.url === tab.url && pageState.view === "translated" ? pageState : null;
        state.pageView = state.pageState ? "translated" : "original";
        renderSource();
        setPageProgress();
        // A newly active page always waits for an explicit Translated text click.
      } catch (err) {
        if (token !== importToken || state.mode !== "page") return;
        console.error("[Lingua] couldn't read page translation state:", err);
        showPageMessage("Lingua couldn't read this page. Try reloading it.");
      }
    }

    function setPhrase(text) {
      state.text.phrase = text.slice(0, LIMITS.phrase);
      state.result = "";
      state.lastKey = "";
      persistPhrase();
      renderSource();
      scheduleRun(0);
    }

    async function importSelection() {
      const tab = await bridge.getActiveTab();
      const res = await bridge.getSelectionText(tab);
      const text = res?.ok ? (res.text || "").trim() : "";
      if (text && state.mode === "phrase") setPhrase(text);
    }

    // ---------- mode ----------
    function applyMode(mode, { import: doImport = true } = {}) {
      if (state.mode === "phrase") persistPhrase();
      state.mode = mode;
      for (const b of modeButtons) b.setAttribute("aria-checked", String(b.dataset.mode === mode));
      el.hint.textContent = hintFor(mode);
      state.result = mode === "phrase" ? String(savedPhrase.result || "") : "";
      state.lastKey = mode === "phrase" ? String(savedPhrase.lastKey || "") : "";
      state.detected = null;
      persist();
      renderSource();
      // The Phrase speaker remains in this mounted view when users switch
      // modes, so immediately apply the existing Full Page ownership state.
      renderReadAloud();
      renderRecent();
      setResult(state.result ? "done" : "empty");
      if (!doImport) return;
      if (mode === "page") importPage();
      else if (!state.text.phrase) importSelection().finally(() => scheduleRun(0));
    }

    // ---------- events ----------
    for (const b of modeButtons) {
      b.addEventListener("click", () => {
        if (b.dataset.mode !== state.mode) applyMode(b.dataset.mode);
      });
    }

    el.from.addEventListener("change", () => {
      state.from = el.from.value;
      persist();
      scheduleRun(0);
    });
    el.to.addEventListener("change", () => {
      state.to = el.to.value;
      persist();
      if (state.mode === "page") {
        if (state.pageView === "translated") runPageTranslation();
        return;
      }
      scheduleRun(0);
    });
    el.translatedView.addEventListener("click", () => setPageView("translated"));
    el.originalView.addEventListener("click", () => setPageView("original"));
    el.readAloud.addEventListener("click", readPageAloud);
    el.readStop.addEventListener("click", () => {
      const action = state.readState?.status === "paused" ? "resume" : "pause";
      bridge.readAloudCommand({ action, tabId: state.activeTabId }).catch(() => {});
    });
    el.readRestart.addEventListener("click", resetPageRead);
    el.readSeek.addEventListener("pointerdown", () => {
      state.readWasPlaying = state.readState?.status === "playing";
    });
    el.readSeek.addEventListener("input", () => {
      if (state.sliderPhase === "none") state.readWasPlaying = state.readState?.status === "playing";
      state.sliderPhase = "dragging";
      state.sliderPreview = Number(el.readSeek.value);
      renderReadAloud();
    });
    el.readSeek.addEventListener("change", async () => {
      const resume = state.readWasPlaying;
      const seconds = Number(el.readSeek.value);
      const commandToken = ++state.readCommandToken;
      state.sliderPhase = "seeking";
      state.sliderPreview = seconds;
      renderReadAloud();
      try {
        const response = await bridge.readAloudCommand({ action: "seek", tabId: state.activeTabId, seconds, resume });
        if (commandToken === state.readCommandToken && response?.state?.tabId === state.activeTabId) {
          setReadState(response.state, { allowRewind: true });
        }
      } catch (error) {
        console.error("[Lingua] read-aloud seek failed:", error);
      } finally {
        if (commandToken === state.readCommandToken) {
          state.sliderPhase = "none";
          renderReadAloud();
        }
      }
    });
    el.swap.addEventListener("click", () => {
      const newTo = state.from === AUTO_CODE ? state.detected : state.from;
      if (!newTo || !isSupported(newTo)) {
        el.swap.animate([{ transform: "translateX(-3px)" }, { transform: "translateX(3px)" }, { transform: "none" }], { duration: 180 });
        return;
      }
      state.from = state.to;
      state.to = newTo;
      syncSelects();
      persist();
      scheduleRun(0);
    });

    el.source.addEventListener("input", () => {
      if (state.mode !== "phrase") return;
      state.text.phrase = el.source.value;
      state.result = "";
      state.lastKey = "";
      persistPhrase();
      el.clear.hidden = !el.source.value;
      el.count.textContent = `${el.source.value.length.toLocaleString()} / ${limit().toLocaleString()}`;
      scheduleRun(TYPING_DELAY_MS);
    });
    el.clear.addEventListener("click", () => {
      state.text.phrase = "";
      state.result = "";
      state.lastKey = "";
      persistPhrase();
      renderSource();
      scheduleRun(0);
      el.source.focus();
    });
    el.refresh.addEventListener("click", () => importPage());

    el.copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(state.result);
      el.copy.innerHTML = ICONS.check;
      setTimeout(() => (el.copy.innerHTML = ICONS.copy), 1200);
    });
    function setSpeaking(on) {
      state.phraseSpeaking = on;
      el.speak.innerHTML = on ? ICONS.stop : ICONS.speaker;
      el.speak.setAttribute("aria-label", on ? "Stop listening" : "Listen to translation");
    }
    el.speak.addEventListener("click", () => {
      if (el.speak.disabled) return;
      if (state.phraseSpeaking) {
        bridge.phraseAudioCommand({ action: "stop" }).catch(() => {});
        setSpeaking(false);
        return;
      }
      if (!state.result) return;
      // A paused Full Page session owns no active utterance and must remain
      // resumable.  Tell other side-panel audio owners to stop instead of
      // cancelling the browser-wide speech queue.
      window.dispatchEvent(new CustomEvent("lingua-side-audio-start", { detail: { owner: "phrase" } }));
      bridge.phraseAudioCommand({ action: "start", text: state.result, language: state.to })
        .then((result) => setSpeaking(Boolean(result?.ok)))
        .catch(() => setSpeaking(false));
    });
    window.addEventListener("lingua-side-audio-start", (event) => {
      if (event.detail?.owner === "phrase" || !state.phraseSpeaking) return;
      bridge.phraseAudioCommand({ action: "stop" }).catch(() => {});
      setSpeaking(false);
    });
    bridge.watchPhraseAudio((phraseState) => {
      if (phraseState?.status !== "playing") setSpeaking(false);
    });

    // Highlighted text on the page (Phrase mode only).
    bridge.watchSelection((text) => {
      if (!state.active || state.mode !== "phrase") return;
      const t = text.trim();
      if (t) setPhrase(t); // un-highlighting keeps the last phrase in place
    });

    // Tab switches / page loads.
    bridge.watchActiveTab(async (tab) => {
      if (!tab) return;
      if (state.activeTabId && tab.id !== state.activeTabId) {
        const previousUrl = state.lastPageId.includes("|")
          ? state.lastPageId.slice(state.lastPageId.indexOf("|") + 1) : "";
        if (previousUrl) {
          bridge.restorePage({ id: state.activeTabId, url: previousUrl })
            .catch((error) => console.error("[Lingua] couldn't restore the previous tab:", error));
        }
        resetPageRead();
        state.lastPageId = "";
        state.pageState = null;
        state.pageView = "original";
        state.readState = null;
        if (isUsablePageTab(tab)) {
          try { await bridge.restorePage(tab); }
          catch (error) { console.error("[Lingua] couldn't reset Full Page state for a new tab:", error); }
        }
      }
      if (!state.active) return;
      if (state.mode === "page") {
        importPage();
      } else if (!state.text.phrase) {
        importSelection();
      }
    });

    bridge.watchPageState((message) => {
      if (!state.active || state.mode !== "page") return;
      const tabId = Number(state.lastPageId.split("|")[0]);
      if (message.tabId !== tabId) return;
      if (message.type === "lingua/page-progress") {
        setPageProgress(message.percent);
      } else if (message.type === "lingua/page-state") {
        state.pageState = message.state?.view === "translated" ? message.state : null;
        state.pageView = state.pageState ? "translated" : "original";
        renderSource();
        setPageProgress();
      } else if (message.type === "lingua/page-error") {
        setPageProgress(0, message.message);
      }
    });
    bridge.watchReadAloud((readState) => {
      if (!readState || !state.activeTabId || readState.tabId !== state.activeTabId) return;
      if (state.invalidReadSessions.has(readState.sessionId)) return;
      // Boundary updates from the utterance that was running before a drag are
      // not allowed to overwrite the thumb the user is actively moving.
      if (state.sliderPhase !== "none"
        && readState.sessionId === state.readState?.sessionId) return;
      if (!setReadState(readState)) return;
      state.pageReading = readState.status === "playing";
      const blocking = isPageAudioBlocking(readState);
      if (blocking && !state.pageAudioBlocking) {
        // Other controls are disabled from this state update. Do not cancel the
        // shared speech queue here: this message is emitted by the narrator.
      }
      state.pageAudioBlocking = blocking;
      renderReadAloud();
      if (readState.status === "error") showPageMessage(t("readAloudUnavailable"));
    });

    // The service worker publishes state frequently, but this local paint loop
    // keeps the visible thumb smooth even when a platform TTS event is delayed.
    const progressRenderTimer = setInterval(() => {
      if (state.active && state.readState?.status === "playing" && state.sliderPhase === "none") renderReadAloud();
    }, 100);

    // ---------- initial paint ----------
    syncSelects();
    renderRecent();
    el.hint.textContent = hintFor(state.mode);
    for (const b of modeButtons) b.setAttribute("aria-checked", String(b.dataset.mode === state.mode));
    renderSource();
    setResult(state.result ? "done" : "empty");
    i18n.subscribe(localize);
    localize();

    return {
      activate() {
        state.active = true;
        if (state.mode === "page") {
          importPage().finally(() => bridge.readAloudCommand({ action: "state" }).catch(() => {}));
        }
        else if (!state.text.phrase) importSelection().finally(() => scheduleRun(0));
      },
      deactivate() {
        state.active = false;
        if (state.phraseSpeaking) {
          bridge.phraseAudioCommand({ action: "stop" }).catch(() => {});
          setSpeaking(false);
        }
      },
    };
  },
};

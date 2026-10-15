// Translate tab.
//  - Full page: reads the active tab's text automatically and translates it.
//  - Phrase:    translates whatever you highlight on the page (or type into the box).
// Everything browser-specific goes through ctx.bridge, everything translation-specific
// through ctx.translator, so this file is only UI + state.
import { LANGUAGES, AUTO_CODE, nameOf, isSupported } from "../../../core/languages.js";
import { LIMITS } from "../../../core/config.js";
import { ICONS } from "../../icons.js";

const PREFS_KEY = "translate.prefs";
const RECENT_KEY = "translate.recent";
const MAX_RECENT = 5;
const TYPING_DELAY_MS = 600;

const HINTS = {
  page: "Lingua reads the visible text on this page and translates it. Switch tabs and it follows you.",
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

  <div class="lang-row">
    <select data-el="from" aria-label="Translate from"></select>
    <button type="button" class="icon-btn round" data-el="swap" aria-label="Swap languages" title="Swap languages">${ICONS.swap}</button>
    <select data-el="to" aria-label="Translate to"></select>
  </div>

  <section class="card source-card">
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

function cutAtParagraph(text, limit) {
  if (text.length <= limit) return { text, truncated: false };
  const cut = text.lastIndexOf("\n", limit);
  return { text: text.slice(0, cut > limit * 0.5 ? cut : limit).trim(), truncated: true };
}

function optionHtml(list, withAuto) {
  const auto = withAuto ? `<option value="${AUTO_CODE}">Detect language</option>` : "";
  return auto + list.map((l) => `<option value="${l.code}">${l.name}</option>`).join("");
}

export default {
  async mount(root, ctx) {
    const { bridge, storage, translator } = ctx;
    loadStylesheet();
    root.innerHTML = TEMPLATE;

    const el = Object.fromEntries([...root.querySelectorAll("[data-el]")].map((n) => [n.dataset.el, n]));
    const modeButtons = [...root.querySelectorAll("[data-mode]")];

    const saved = await storage.get(PREFS_KEY, {});
    const state = {
      mode: saved.mode === "phrase" ? "phrase" : "page",
      from: saved.from && (saved.from === AUTO_CODE || isSupported(saved.from)) ? saved.from : AUTO_CODE,
      to: saved.to && isSupported(saved.to) ? saved.to : defaultTarget(),
      text: { page: "", phrase: "" },
      pageMeta: null,
      detected: null,
      result: "",
      lastKey: "",
      lastPageId: "",
      runId: 0,
      controller: null,
      active: false,
      recent: await storage.get(RECENT_KEY, []),
    };
    let runTimer = null;
    let recentTimer = null;
    let importToken = 0;

    const limit = () => (state.mode === "page" ? LIMITS.page : LIMITS.phrase);
    const persist = () => storage.set(PREFS_KEY, { mode: state.mode, from: state.from, to: state.to });

    // ---------- rendering ----------
    el.from.innerHTML = optionHtml(LANGUAGES, true);
    el.to.innerHTML = optionHtml(LANGUAGES, false);

    function syncSelects() {
      el.from.value = state.from;
      el.to.value = state.to;
    }

    function renderSource() {
      const isPage = state.mode === "page";
      const text = state.text[state.mode];
      el.source.readOnly = isPage;
      el.source.maxLength = limit();
      el.source.value = text;
      el.source.placeholder = isPage ? "" : "Highlight text on the page, or type here…";
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
      if (state.detected) el.detected.textContent = `Detected: ${nameOf(state.detected)}`;
    }

    // kind: empty | loading | done | error | notice
    function setResult(kind, message = "") {
      el.resultCard.dataset.kind = kind;
      const showText = kind === "done" || kind === "loading";
      el.resultText.textContent =
        kind === "empty" ? "The translation will appear here."
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
      el.actions.hidden = !(kind === "done" && state.result);
    }

    function renderRecent() {
      el.recentSection.hidden = state.recent.length === 0;
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
          onProgress: ({ done, total }) => {
            if (id === state.runId && total > 1) el.status.textContent = `Translating… ${done}/${total}`;
          },
        });
        if (id !== state.runId) return;
        state.result = res.text;
        state.lastKey = key;
        state.detected = state.from === AUTO_CODE ? res.detectedFrom : null;
        renderSource();
        setResult("done");
        if (state.mode === "phrase") queueRecent(text, res.text);
      } catch (err) {
        if (err?.name === "AbortError" || id !== state.runId) return;
        state.result = "";
        state.lastKey = "";
        const offline = navigator.onLine === false;
        setResult("error", offline ? "You're offline." : `Couldn't translate right now. ${err.message}`);
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
      cancelRun();
      setResult("loading", "Reading page…");
      const tab = await bridge.getActiveTab();
      const res = await bridge.getPageText(tab);
      if (token !== importToken || state.mode !== "page") return;

      if (!res?.ok) {
        state.text.page = "";
        state.pageMeta = null;
        state.result = "";
        state.lastPageId = "";
        renderSource();
        setResult("notice", PAGE_PROBLEMS[res?.reason] ?? PAGE_PROBLEMS.unreachable);
        return;
      }
      const { text, truncated } = cutAtParagraph((res.text || "").trim(), LIMITS.page);
      if (!text) {
        state.text.page = "";
        state.pageMeta = null;
        renderSource();
        setResult("notice", PAGE_PROBLEMS.empty);
        return;
      }
      state.lastPageId = `${tab.id}|${tab.url}`;
      state.text.page = text;
      state.pageMeta = { title: res.title, truncated };
      renderSource();
      scheduleRun(0);
    }

    function setPhrase(text) {
      state.text.phrase = text.slice(0, LIMITS.phrase);
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
      state.mode = mode;
      for (const b of modeButtons) b.setAttribute("aria-checked", String(b.dataset.mode === mode));
      el.hint.textContent = HINTS[mode];
      state.result = "";
      state.lastKey = "";
      state.detected = null;
      persist();
      renderSource();
      setResult("empty");
      if (!doImport) return;
      if (mode === "page") importPage();
      else importSelection().finally(() => scheduleRun(0));
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
      scheduleRun(0);
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
      el.clear.hidden = !el.source.value;
      el.count.textContent = `${el.source.value.length.toLocaleString()} / ${limit().toLocaleString()}`;
      scheduleRun(TYPING_DELAY_MS);
    });
    el.clear.addEventListener("click", () => {
      state.text.phrase = "";
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
      el.speak.innerHTML = on ? ICONS.stop : ICONS.speaker;
      el.speak.setAttribute("aria-label", on ? "Stop listening" : "Listen to translation");
    }
    el.speak.addEventListener("click", () => {
      const synth = window.speechSynthesis;
      if (synth.speaking) {
        synth.cancel();
        setSpeaking(false);
        return;
      }
      if (!state.result) return;
      const utterance = new SpeechSynthesisUtterance(state.result.slice(0, 3000));
      utterance.lang = state.to;
      utterance.onend = utterance.onerror = () => setSpeaking(false);
      synth.speak(utterance);
      setSpeaking(true);
    });

    // Highlighted text on the page (Phrase mode only).
    bridge.watchSelection((text) => {
      if (!state.active || state.mode !== "phrase") return;
      const t = text.trim();
      if (t) setPhrase(t); // un-highlighting keeps the last phrase in place
    });

    // Tab switches / page loads.
    bridge.watchActiveTab((tab) => {
      if (!state.active || !tab) return;
      if (state.mode === "page") {
        if (state.lastPageId !== `${tab.id}|${tab.url}`) importPage();
      } else {
        importSelection();
      }
    });

    // ---------- initial paint ----------
    syncSelects();
    renderRecent();
    el.hint.textContent = HINTS[state.mode];
    for (const b of modeButtons) b.setAttribute("aria-checked", String(b.dataset.mode === state.mode));
    renderSource();
    setResult("empty");

    return {
      activate() {
        state.active = true;
        if (state.mode === "page") importPage();
        else importSelection().finally(() => scheduleRun(0));
      },
      deactivate() {
        state.active = false;
        window.speechSynthesis?.cancel();
        setSpeaking(false);
      },
    };
  },
};

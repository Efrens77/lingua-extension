import { normalizeLanguage } from "../../../core/translation/chrome.js";
import { normalizeWord } from "../../../core/word.js";
import { ICONS } from "../../icons.js";

const SESSION_KEY = "definition.session";

const TEMPLATE = `
  <section class="card definition-intro">
    <label class="definition-label" for="definition-word" data-el="wordLabel">Word</label>
    <div class="definition-input-row">
      <input id="definition-word" data-el="word" type="text" autocomplete="off" spellcheck="false" />
      <button type="button" data-el="lookup">Look up</button>
    </div>
    <div class="definition-language-choice" data-el="languageChoice" hidden>
      <label for="definition-language" data-el="languagePrompt">Which language is this word?</label>
      <div class="definition-input-row">
        <select id="definition-language" data-el="language"></select>
        <button type="button" data-el="languageLookup">Look up</button>
      </div>
    </div>
  </section>
  <section class="card definition-result" data-el="result" aria-live="polite">
    <p class="definition-message" data-el="message"></p>
    <div data-el="content" hidden>
      <section class="definition-pronunciation">
        <div>
          <h1 class="definition-word" data-el="heading"></h1>
          <p class="definition-meta" data-el="meta"></p>
          <p class="definition-gloss" data-el="gloss" hidden></p>
          <p class="definition-field" data-el="phonetic" hidden></p>
        </div>
        <button type="button" class="definition-pronounce" data-el="pronounce" aria-pressed="false">
          ${ICONS.microphone}
        </button>
      </section>
      <div data-el="entries"></div>
      <section class="definition-synonym-section" data-el="synonymSection" hidden>
        <h3 data-el="synonymsTitle"></h3>
        <div class="definition-synonyms" data-el="synonyms"></div>
      </section>
      <p class="definition-attribution" data-el="attribution"></p>
      <p class="definition-attribution" data-el="audioAttribution"></p>
    </div>
  </section>
`;

function reliablePageLanguage(value) {
  const code = normalizeLanguage(value);
  return code && !["und", "mul", "zxx"].includes(code) ? code : null;
}

export default {
  async mount(root, ctx) {
    const { bridge, dictionary, pronunciation, i18n, translator, sidepanelSelection, storage } = ctx;
    const href = new URL("./definition.css", import.meta.url).href;
    if (!document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet"; link.href = href; document.head.append(link);
    }
    root.innerHTML = TEMPLATE;
    const el = Object.fromEntries([...root.querySelectorAll("[data-el]")].map((node) => [node.dataset.el, node]));
    const saved = await storage.get(SESSION_KEY, {});
    const state = {
      active: false, word: saved.word || "", pageLang: saved.pageLang || "", sourceLanguage: saved.sourceLanguage || "",
      result: saved.result || null, request: 0, manual: Boolean(saved.manual), audio: null, pageAudioActive: false, pageAudioStatus: "idle", pageAudioTabId: null,
      message: saved.message || "",
    };

    const t = (key) => i18n.t(key);
    const persist = () => storage.set(SESSION_KEY, {
      word: state.word, pageLang: state.pageLang, sourceLanguage: state.sourceLanguage,
      result: state.result, manual: state.manual, message: state.message,
    }).catch((error) => console.error("[Lingua] couldn't save Define state:", error));
    function localizeStatic() {
      el.wordLabel.textContent = t("definitionWord");
      el.word.placeholder = t("definitionWordPlaceholder");
      el.lookup.textContent = t("definitionLookup");
      el.languagePrompt.textContent = t("definitionChooseLanguage");
      el.languageLookup.textContent = t("definitionLookup");
      el.word.value = state.word;
      if (state.result) renderResult(state.result);
      else if (state.message) showMessage(state.message);
      else hideResult();
    }

    function hideResult() {
      stopPronunciation();
      el.result.hidden = true;
      el.content.hidden = true;
      el.message.textContent = "";
      state.message = "";
      persist();
    }

    function showMessage(message) {
      stopPronunciation();
      el.result.hidden = false;
      el.content.hidden = true;
      el.message.hidden = false;
      el.message.textContent = message;
      state.message = message;
      persist();
    }

    function hideLanguageChoice() {
      el.languageChoice.hidden = true;
      el.language.replaceChildren();
    }

    function showLanguageChoice(languages) {
      el.language.replaceChildren();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = t("definitionChooseLanguage");
      el.language.append(placeholder);
      for (const code of languages) {
        const option = document.createElement("option");
        option.value = code;
        option.textContent = i18n.languageName(code, code);
        el.language.append(option);
      }
      el.languageChoice.hidden = false;
      showMessage(t("definitionChooseLanguage"));
    }

    function renderResult(result) {
      el.result.hidden = false;
      el.message.hidden = true;
      el.content.hidden = false;
      el.heading.textContent = result.word;
      el.meta.textContent = t("detected") + " " + i18n.languageName(result.sourceLanguage, result.sourceLanguage);
      el.gloss.hidden = !result.gloss;
      el.gloss.textContent = result.gloss ? t("definitionTranslation") + ": " + result.gloss : "";
      el.phonetic.hidden = !result.phonetic;
      el.phonetic.textContent = result.phonetic ? t("definitionPhonetic") + ": /" + result.phonetic + "/" : "";
      el.pronounce.setAttribute("aria-label", t("pronouncePlay") + ": " + result.word);
      updatePronunciationAvailability();
      el.entries.replaceChildren();
      for (const entry of result.entries) {
        const section = document.createElement("section");
        section.className = "definition-entry";
        const part = document.createElement("h3");
        part.textContent = t(entry.partOfSpeech);
        const list = document.createElement("ol");
        for (const sense of entry.senses) {
          const item = document.createElement("li");
          item.append(sense.definition);
          if (sense.example) {
            const example = document.createElement("p");
            example.className = "definition-example";
            example.textContent = "“" + sense.example + "”";
            item.append(example);
            if (sense.exampleTranslation) {
              const translated = document.createElement("p");
              translated.className = "definition-example-translation";
              translated.textContent = "“" + sense.exampleTranslation + "”";
              item.append(translated);
            }
          }
          list.append(item);
        }
        section.append(part, list);
        el.entries.append(section);
      }
      el.synonyms.replaceChildren();
      el.synonymSection.hidden = !result.synonyms?.length;
      if (result.synonyms?.length) {
        el.synonymsTitle.textContent = t("definitionSynonyms");
        for (const synonym of result.synonyms) {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "definition-synonym";
          chip.textContent = synonym;
          chip.setAttribute("aria-label", t("definitionSynonymLookup") + ": " + synonym);
          chip.addEventListener("click", () => lookup(synonym, "", {
            manual: true, sourceLanguage: result.sourceLanguage,
          }));
          el.synonyms.append(chip);
        }
      }
      el.attribution.replaceChildren();
      for (const [index, attribution] of (result.attributions || []).entries()) {
        if (index) el.attribution.append(" · ");
        const source = document.createElement("a");
        source.href = attribution.url;
        source.target = "_blank";
        source.rel = "noopener";
        source.textContent = t("definitionSource") + ": " + attribution.name;
        el.attribution.append(source);
        if (attribution.license) {
          const license = document.createElement("a");
          license.href = attribution.licenseUrl;
          license.target = "_blank";
          license.rel = "license noopener";
          license.textContent = attribution.license;
          el.attribution.append(" · ", license);
        }
      }
      el.audioAttribution.replaceChildren();
      for (const [index, attribution] of (result.pronunciation?.attributions || []).entries()) {
        if (index) el.audioAttribution.append(" · ");
        const source = document.createElement("a");
        source.href = attribution.url; source.target = "_blank"; source.rel = "noopener";
        source.textContent = t("pronounceSource") + ": " + attribution.name
          + (attribution.author ? " (" + attribution.author + ")" : "");
        el.audioAttribution.append(source);
        if (attribution.license) {
          const license = document.createElement("a");
          license.href = attribution.licenseUrl || attribution.url; license.target = "_blank"; license.rel = "license noopener";
          license.textContent = attribution.license; el.audioAttribution.append(" · ", license);
        }
      }
      state.message = "";
      persist();
    }

    function stopPronunciation() {
      // Only stop audio owned by this tab. Calling global speechSynthesis.cancel()
      // with no local audio can also cancel Full Page's offscreen narration.
      state.audio?.pause?.();
      state.audio = null;
      el.pronounce?.setAttribute("aria-pressed", "false");
      if (state.result) el.pronounce?.setAttribute("aria-label", t("pronouncePlay") + ": " + state.result.word);
    }

    function updatePronunciationAvailability() {
      const blocked = state.pageAudioActive;
      el.pronounce.disabled = blocked;
      el.pronounce.title = blocked ? t("otherAudioBlocked") : "";
      if (blocked) el.pronounce.setAttribute("aria-label", t("otherAudioBlocked"));
      else if (state.result) el.pronounce.setAttribute("aria-label", t("pronouncePlay") + ": " + state.result.word);
    }

    function playPronunciation() {
      if (state.pageAudioActive) return;
      const result = state.result;
      if (!result) return;
      if (state.audio) { stopPronunciation(); return; }
      // A paused Full Page session is intentionally retained for Resume.  Only
      // replace audio owned by another side-panel feature.
      window.dispatchEvent(new CustomEvent("lingua-side-audio-start", { detail: { owner: "definition" } }));
      const fallback = () => {
        const started = pronunciation.speakText(result.word, result.sourceLanguage, {
          onEnd: stopPronunciation, onError: stopPronunciation,
        });
        if (!started) showMessage(t("pronounceNoAudio"));
        else {
          state.audio = { pause: pronunciation.stopSpeech };
          el.pronounce.setAttribute("aria-pressed", "true");
          el.pronounce.setAttribute("aria-label", t("pronounceStop") + ": " + result.word);
        }
      };
      if (!result.pronunciation?.audio?.url) { fallback(); return; }
      pronunciation.stopSpeech();
      const audio = new Audio(result.pronunciation.audio.url);
      audio.onended = stopPronunciation;
      audio.onerror = fallback;
      state.audio = audio;
      audio.play().catch(fallback);
      el.pronounce.setAttribute("aria-pressed", "true");
      el.pronounce.setAttribute("aria-label", t("pronounceStop") + ": " + result.word);
    }

    async function translateText(text, from, to) {
      if (!text || from === to) return text;
      const response = await translator.translate({ text, from, to, concurrency: 1, allowChromeDownload: false });
      return response.text;
    }

    async function prepareResult(raw, sourceLanguage) {
      const interfaceLanguage = i18n.resolvedLocale;
      const gloss = sourceLanguage === interfaceLanguage
        ? ""
        : await translateText(raw.word, sourceLanguage, interfaceLanguage);
      const entries = [];
      for (const entry of raw.entries) {
        const senses = [];
        for (const sense of entry.senses) {
          const definition = await translateText(sense.definition, "en", interfaceLanguage);
          const exampleTranslation = sense.example && sourceLanguage !== interfaceLanguage
            ? await translateText(sense.example, sourceLanguage, interfaceLanguage)
            : "";
          senses.push({ ...sense, definition, exampleTranslation });
        }
        entries.push({ ...entry, senses });
      }
      return { ...raw, sourceLanguage, gloss, entries };
    }

    async function detectSource(word, pageLang) {
      const declared = reliablePageLanguage(pageLang);
      if (declared) return declared;
      const detected = await translator.detectLanguageDetails(word, { allowDownload: false });
      return detected?.confidence >= 0.8 ? detected.code : null;
    }

    async function lookup(word, pageLang = "", { manual = false, sourceLanguage: forcedLanguage = "" } = {}) {
      const valid = normalizeWord(word);
      state.result = null;
      if (!valid) {
        showMessage(word.trim() ? t("definitionOneWord") : t("definitionEmpty"));
        return;
      }
      const request = ++state.request;
      state.word = valid;
      state.pageLang = pageLang;
      state.manual = manual;
      state.message = "";
      persist();
      el.word.value = valid;
      hideLanguageChoice();
      showMessage(t("definitionLoading"));
      try {
        let sourceLanguage = forcedLanguage || await detectSource(valid, pageLang);
        let raw = null;
        if (!sourceLanguage) {
          if (!manual) {
            if (request === state.request) showMessage(t("definitionLanguageUnknown"));
            return;
          }
          raw = await dictionary.lookupTypedDefinition({ word: valid });
          if (raw.ambiguous) {
            if (request === state.request) showLanguageChoice(raw.languages);
            return;
          }
          if (raw.notFound) {
            if (request === state.request) showMessage(t("definitionNotFound"));
            return;
          }
          sourceLanguage = raw.sourceLanguage;
        }
        raw ??= await dictionary.lookupDefinition({ word: valid, sourceLanguage });
        if (raw.notFound) {
          if (request === state.request) showMessage(t("definitionNotFound"));
          return;
        }
        const result = await prepareResult(raw, sourceLanguage);
        if (request !== state.request) return;
        state.sourceLanguage = sourceLanguage;
        state.result = result;
        state.message = "";
        renderResult(result);
        pronunciation.lookupPronunciation({ word: valid, sourceLanguage }).then((pronunciationResult) => {
          if (request !== state.request || state.result !== result) return;
          result.pronunciation = pronunciationResult;
          if (!result.phonetic && pronunciationResult.phonetic) result.phonetic = pronunciationResult.phonetic;
          renderResult(result);
        }).catch((error) => console.error("[Lingua] pronunciation lookup failed:", error));
      } catch (error) {
        if (request !== state.request) return;
        console.error("[Lingua] definition lookup failed:", error);
        showMessage(error?.rateLimited ? t("definitionRateLimit") : t("definitionUnavailable"));
      }
    }

    function useSelection(text, details = {}) {
      if (!state.active) return;
      const selected = String(text || "").trim();
      if (!selected) return;
      if (!normalizeWord(selected)) {
        state.result = null;
        el.word.value = selected;
        showMessage(t("definitionOneWord"));
        return;
      }
      lookup(selected, details.lang || "");
    }

    el.lookup.addEventListener("click", () => lookup(el.word.value, "", { manual: true }));
    el.languageLookup.addEventListener("click", () => {
      if (el.language.value) lookup(el.word.value, "", { manual: true, sourceLanguage: el.language.value });
    });
    el.word.addEventListener("input", () => {
      state.request++;
      state.result = null;
      state.word = "";
      state.manual = true;
      state.message = "";
      persist();
      hideLanguageChoice();
      const valid = normalizeWord(el.word.value);
      if (!el.word.value.trim()) hideResult();
      else if (!valid) showMessage(t("definitionOneWord"));
      else hideResult();
    });
    el.word.addEventListener("keydown", (event) => {
      if (event.key === "Enter") lookup(el.word.value, "", { manual: true });
    });
    el.pronounce.addEventListener("click", playPronunciation);
    window.addEventListener("lingua-page-audio-start", stopPronunciation);
    window.addEventListener("lingua-side-audio-start", (event) => {
      if (event.detail?.owner !== "definition") stopPronunciation();
    });
    bridge.watchReadAloud(async (readState) => {
      const tab = await bridge.getActiveTab().catch(() => null);
      if (!tab?.id || readState?.tabId !== tab.id) return;
      state.pageAudioTabId = readState.tabId;
      state.pageAudioStatus = readState.status;
      state.pageAudioActive = readState.status === "playing"
        || (readState.status === "seeking" && Boolean(readState.willResume));
      updatePronunciationAvailability();
    });
    bridge.watchSelection((text, _tab, details) => useSelection(text, details));
    document.addEventListener("selectionchange", () => {
      if (!state.active) return;
      const selection = document.getSelection();
      const anchor = selection?.anchorNode?.nodeType === Node.TEXT_NODE
        ? selection.anchorNode.parentElement : selection?.anchorNode;
      if (!anchor?.closest?.(".definition-word,.definition-gloss,.definition-entry li,.definition-example,.definition-example-translation")) return;
      const selected = selection?.toString().trim() || "";
      if (normalizeWord(selected)) lookup(selected, "", { manual: true });
    });
    i18n.subscribe(() => {
      localizeStatic();
      if (state.word) lookup(state.word, state.pageLang, { manual: state.manual });
    });
    localizeStatic();
    bridge.readAloudCommand({ action: "state" }).catch(() => {});

    return {
      async activate() {
        state.active = true;
        const panelSelection = sidepanelSelection.take();
        if (normalizeWord(panelSelection)) {
          lookup(panelSelection, "", { manual: true });
          return;
        }
        const tab = await bridge.getActiveTab();
        const selection = await bridge.getSelectionText(tab);
        useSelection(selection?.ok ? selection.text : "", selection || {});
      },
      deactivate() { state.active = false; stopPronunciation(); },
    };
  },
};

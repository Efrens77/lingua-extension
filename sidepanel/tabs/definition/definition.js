import { normalizeLanguage } from "../../../core/translation/chrome.js";

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
      <h1 class="definition-word" data-el="heading"></h1>
      <p class="definition-meta" data-el="meta"></p>
      <p class="definition-gloss" data-el="gloss" hidden></p>
      <p class="definition-field" data-el="phonetic" hidden></p>
      <div data-el="entries"></div>
      <p class="definition-attribution" data-el="attribution"></p>
    </div>
  </section>
`;

export function normalizeWord(value) {
  const word = String(value || "").trim().replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "");
  return /^[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*$/u.test(word) ? word : null;
}

function reliablePageLanguage(value) {
  const code = normalizeLanguage(value);
  return code && !["und", "mul", "zxx"].includes(code) ? code : null;
}

export default {
  async mount(root, ctx) {
    const { bridge, dictionary, i18n, translator } = ctx;
    const href = new URL("./definition.css", import.meta.url).href;
    if (!document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet"; link.href = href; document.head.append(link);
    }
    root.innerHTML = TEMPLATE;
    const el = Object.fromEntries([...root.querySelectorAll("[data-el]")].map((node) => [node.dataset.el, node]));
    const state = {
      active: false, word: "", pageLang: "", sourceLanguage: "", result: null, request: 0, manual: false,
    };

    const t = (key) => i18n.t(key);
    function localizeStatic() {
      el.wordLabel.textContent = t("definitionWord");
      el.word.placeholder = t("definitionWordPlaceholder");
      el.lookup.textContent = t("definitionLookup");
      el.languagePrompt.textContent = t("definitionChooseLanguage");
      el.languageLookup.textContent = t("definitionLookup");
      if (state.result) renderResult(state.result);
      else if (!state.word) hideResult();
    }

    function hideResult() {
      el.result.hidden = true;
      el.content.hidden = true;
      el.message.textContent = "";
    }

    function showMessage(message) {
      el.result.hidden = false;
      el.content.hidden = true;
      el.message.hidden = false;
      el.message.textContent = message;
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
      el.entries.replaceChildren();
      for (const entry of result.entries) {
        const section = document.createElement("section");
        section.className = "definition-entry";
        const part = document.createElement("h3");
        part.textContent = t(entry.partOfSpeech);
        const list = document.createElement("ol");
        for (const definition of entry.definitions) {
          const item = document.createElement("li");
          item.textContent = definition;
          list.append(item);
        }
        section.append(part, list);
        if (entry.example) {
          const exampleTitle = document.createElement("h4");
          exampleTitle.textContent = t("definitionExample");
          const example = document.createElement("p");
          example.className = "definition-example";
          example.textContent = "“" + entry.example + "”";
          section.append(exampleTitle, example);
          if (entry.exampleTranslation) {
            const translated = document.createElement("p");
            translated.className = "definition-example-translation";
            translated.textContent = "“" + entry.exampleTranslation + "”";
            section.append(translated);
          }
        }
        el.entries.append(section);
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
        const definitions = [];
        for (const definition of entry.definitions) {
          definitions.push(await translateText(definition, "en", interfaceLanguage));
        }
        const example = entry.example || "";
        const exampleTranslation = example && sourceLanguage !== interfaceLanguage
          ? await translateText(example, sourceLanguage, interfaceLanguage)
          : "";
        entries.push({ ...entry, definitions, example, exampleTranslation });
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
        renderResult(result);
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
      hideLanguageChoice();
      const valid = normalizeWord(el.word.value);
      if (!el.word.value.trim()) hideResult();
      else if (!valid) showMessage(t("definitionOneWord"));
      else hideResult();
    });
    el.word.addEventListener("keydown", (event) => {
      if (event.key === "Enter") lookup(el.word.value, "", { manual: true });
    });
    bridge.watchSelection((text, _tab, details) => useSelection(text, details));
    i18n.subscribe(() => {
      localizeStatic();
      if (state.word) lookup(state.word, state.pageLang, { manual: state.manual });
    });
    localizeStatic();

    return {
      async activate() {
        state.active = true;
        const tab = await bridge.getActiveTab();
        const selection = await bridge.getSelectionText(tab);
        useSelection(selection?.ok ? selection.text : "", selection || {});
      },
      deactivate() { state.active = false; },
    };
  },
};

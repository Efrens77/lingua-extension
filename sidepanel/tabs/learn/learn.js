import { ICONS } from "../../icons.js";

const PREFERENCES_KEY = "learn.preferences";
const MODES = ["translations", "vocabulary"];
const TEMPLATE = `<section class="learn-shell" aria-busy="true" data-el="shell"><div class="learn-mode-tabs" role="tablist" data-el="modeTabs"></div><section id="learn-content" class="card learn-content" data-el="content" role="tabpanel" tabindex="0" aria-live="polite"></section></section>`;
const validMode = (value) => MODES.includes(value) ? value : "translations";

export default {
  async mount(root, ctx) {
    const { storage, learn, i18n, bridge, translator, pronunciation, sidepanelSelection, openTab } = ctx;
    const href = new URL("./learn.css", import.meta.url).href;
    if (!document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet"; link.href = href; document.head.append(link);
    }
    root.innerHTML = TEMPLATE;
    const el = Object.fromEntries([...root.querySelectorAll("[data-el]")].map((node) => [node.dataset.el, node]));
    let saved = {};
    try { saved = await storage.get(PREFERENCES_KEY, {}); } catch { /* Default safely. */ }
    const state = { mode: validMode(saved?.mode), ready: false, unavailable: false, groups: [], vocabularyGroups: [], expanded: new Set(), vocabularyExpanded: new Set(), confirmation: null, pending: "", feedback: "", loadToken: 0, focusContent: false, study: null, pageAudioBlocked: false, flashAudioPlaying: false, flashAudioKind: "", flashAudio: null, audioToken: 0, summaryCache: new Map(), summaryPending: new Set(), editor: null, editMutation: null };
    let preferenceWrite = Promise.resolve();
    const t = (key) => i18n.t(key);
    const format = (key, values) => Object.entries(values).reduce((message, [name, value]) => message.replaceAll(`{${name}}`, String(value)), t(key));
    const modeLabel = (mode) => t(mode === "translations" ? "learnTranslations" : "learnVocabulary");
    // Prefer the active interface locale, while retaining a saved readable name
    // as the fallback for unusual or legacy language codes.
    const languageLabel = (language) => i18n.languageName(language?.code, String(language?.name || "").trim() || language?.code || "");
    const folderLabel = (group) => `${languageLabel(group.sourceLanguage)} → ${languageLabel(group.targetLanguage)}`;
    const vocabularyFolderLabel = (group) => languageLabel(group.language);
    const translationCount = (count) => count === 1 ? t("learnTranslationCountOne") : format("learnTranslationCountOther", { count });
    const vocabularyCount = (count) => count === 1 ? t("learnVocabularyCountOne") : format("learnVocabularyCountOther", { count });
    const previewText = (value) => {
      const lines = String(value ?? "").split(/\r?\n/);
      return lines[0] + (lines.length > 1 ? "..." : "");
    };

    function shuffle(records) {
      const result = [...records];
      for (let index = result.length - 1; index > 0; index--) {
        const next = Math.floor(Math.random() * (index + 1));
        [result[index], result[next]] = [result[next], result[index]];
      }
      return result;
    }
    function stopFlashAudio() {
      state.audioToken++;
      state.flashAudio?.pause?.();
      if (state.flashAudioKind === "phrase" && state.flashAudioPlaying) bridge.phraseAudioCommand({ action: "stop" }).catch(() => {});
      state.flashAudio = null;
      state.flashAudioKind = "";
      state.flashAudioPlaying = false;
    }
    function reconcileStudy(groups, kind) {
      if (!state.study || state.study.kind !== kind) return;
      const group = groups.find((candidate) => candidate.key === state.study.groupKey);
      if (!group) { stopFlashAudio(); state.study = null; state.editor = null; state.feedback = t("learnSessionChanged"); return; }
      const available = new Map(group.records.map((record) => [record.id, record]));
      const currentId = state.study.order[state.study.index];
      const previousCount = state.study.order.length;
      state.study.order = state.study.order.filter((id) => available.has(id));
      state.study.records = available;
      if (state.editor && !available.has(state.editor.recordId)) state.editor = null;
      if (!state.study.order.length) { stopFlashAudio(); state.study = null; state.editor = null; state.feedback = t("learnSessionChanged"); return; }
      const nextIndex = state.study.order.indexOf(currentId);
      state.study.index = nextIndex >= 0 ? nextIndex : Math.min(state.study.index, state.study.order.length - 1);
      if (nextIndex < 0) state.study.side = kind === "vocabulary" ? "word" : "source";
      if (state.study.order.length !== previousCount || nextIndex < 0) state.feedback = t("learnSessionChanged");
    }

    function sortedGroups(groups, label = folderLabel) {
      return groups.map((group) => ({ ...group, records: [...group.records].sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt) || String(a.id).localeCompare(String(b.id))) }))
        .sort((a, b) => Math.max(...b.records.map((r) => Number(r.updatedAt) || 0)) - Math.max(...a.records.map((r) => Number(r.updatedAt) || 0)) || label(a).localeCompare(label(b)));
    }
    async function loadTranslations() {
      const token = ++state.loadToken;
      try {
        const groups = sortedGroups(await learn.translationsByLanguagePair());
        if (token !== state.loadToken) return false;
        state.groups = groups;
        state.expanded = new Set([...state.expanded].filter((key) => groups.some((group) => group.key === key)));
        reconcileStudy(groups, "translations");
        state.unavailable = false;
        return true;
      } catch {
        if (token !== state.loadToken) return false;
        state.unavailable = true;
        return false;
      }
    }
    async function loadVocabulary() {
      const token = ++state.loadToken;
      try {
        const groups = sortedGroups(await learn.vocabularyByLanguage(), vocabularyFolderLabel);
        if (token !== state.loadToken) return false;
        state.vocabularyGroups = groups;
        state.vocabularyExpanded = new Set([...state.vocabularyExpanded].filter((key) => groups.some((group) => group.key === key)));
        reconcileStudy(groups, "vocabulary");
        state.unavailable = false;
        return true;
      } catch {
        if (token !== state.loadToken) return false;
        state.unavailable = true;
        return false;
      }
    }
    const loadForMode = () => state.mode === "vocabulary" ? loadVocabulary() : loadTranslations();
    function makeConfirmation(target, message) {
      const wrap = document.createElement("div");
      wrap.className = "learn-confirmation"; wrap.setAttribute("role", "alert");
      const text = document.createElement("p"); text.textContent = message;
      const actions = document.createElement("div"); actions.className = "learn-confirmation-actions";
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = t("learnCancel"); cancel.disabled = Boolean(state.pending);
      cancel.addEventListener("click", () => { state.confirmation = null; renderContent(); });
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "learn-danger-button"; remove.textContent = t("learnConfirmRemove"); remove.disabled = Boolean(state.pending);
      remove.addEventListener("click", () => removeTarget(target));
      actions.append(cancel, remove); wrap.append(text, actions); return wrap;
    }
    function deleteButton(label, accessibleName, listener, entry = false) {
      const button = document.createElement("button"); button.type = "button";
      button.className = `learn-delete-button${entry ? " learn-delete-entry" : ""}`;
      button.disabled = Boolean(state.pending); button.setAttribute("aria-label", accessibleName); button.title = label;
      button.innerHTML = ICONS.trash;
      button.addEventListener("click", listener); return button;
    }
    function startPractice(group, firstId = "") {
      stopFlashAudio();
      const first = group.records.find((record) => record.id === firstId);
      const rest = group.records.filter((record) => record.id !== firstId);
      const order = first ? [first.id, ...shuffle(rest).map((record) => record.id)] : shuffle(group.records).map((record) => record.id);
      state.study = { kind: "translations", groupKey: group.key, sourceLanguage: group.sourceLanguage, targetLanguage: group.targetLanguage, records: new Map(group.records.map((record) => [record.id, record])), order, index: 0, side: "source", completed: false };
      state.confirmation = null; state.feedback = ""; renderContent();
      requestAnimationFrame(() => root.querySelector("[data-study-focus], .learn-flashcard")?.focus());
    }
    function startVocabularyPractice(group, firstId = "") {
      stopFlashAudio();
      const first = group.records.find((record) => record.id === firstId);
      const rest = group.records.filter((record) => record.id !== firstId);
      const order = first ? [first.id, ...shuffle(rest).map((record) => record.id)] : shuffle(group.records).map((record) => record.id);
      state.study = { kind: "vocabulary", groupKey: group.key, language: group.language, records: new Map(group.records.map((record) => [record.id, record])), order, index: 0, side: "word", completed: false };
      state.confirmation = null; state.feedback = ""; renderContent();
      requestAnimationFrame(() => root.querySelector("[data-study-focus], .learn-flashcard")?.focus());
    }
    function guardEditorAction(action) {
      const editor = state.editor;
      if (!editor) return true;
      if (editor.saving) return false;
      if (editor.draft === editor.initial) { state.editor = null; return true; }
      editor.pendingAction = action; renderContent(); return false;
    }
    function runEditorAction(action) {
      state.editor = null;
      if (action === "flip") flipStudyCard();
      else if (action === "previous") previousStudyCard();
      else if (action === "next") nextStudyCard();
      else if (action === "exit") exitPractice();
      else if (action === "full") openFullDefinition();
      else if (action.startsWith("mode:")) setMode(action.slice(5));
    }
    function exitPractice() {
      if (!state.study) return;
      if (!guardEditorAction("exit")) return;
      const groupKey = state.study.groupKey;
      stopFlashAudio(); state.study = null; state.editor = null; renderContent();
      requestAnimationFrame(() => [...root.querySelectorAll("[data-folder-key]")].find((node) => node.dataset.folderKey === groupKey)?.focus() || el.content.focus());
    }
    function currentCard() {
      return state.study?.records.get(state.study.order[state.study.index]) || null;
    }
    function flipStudyCard() {
      const study = state.study;
      if (!study || study.completed) return;
      if (!guardEditorAction("flip")) return;
      stopFlashAudio();
      study.side = study.kind === "vocabulary" ? (study.side === "word" ? "summary" : "word") : (study.side === "source" ? "target" : "source");
      study.animateFlip = true; renderContent();
    }
    function previousStudyCard() {
      const study = state.study;
      if (!study || study.completed || study.index === 0) return;
      if (!guardEditorAction("previous")) return;
      stopFlashAudio(); study.index--; study.side = study.kind === "vocabulary" ? "word" : "source"; renderContent();
    }
    function nextStudyCard() {
      const study = state.study;
      if (!study || study.completed) return;
      if (!guardEditorAction("next")) return;
      stopFlashAudio();
      if (study.index >= study.order.length - 1) study.completed = true;
      else { study.index++; study.side = study.kind === "vocabulary" ? "word" : "source"; }
      renderContent();
    }
    function playVisibleSide() {
      const study = state.study, record = currentCard();
      if (!study || !record || state.pageAudioBlocked) return;
      stopFlashAudio();
      if (study.kind === "vocabulary") {
        playVocabularyPronunciation(record, study.language.code);
        return;
      }
      const text = study.kind === "vocabulary" ? record.word : (study.side === "source" ? record.sourceText : record.targetText);
      const language = study.kind === "vocabulary" ? study.language.code : (study.side === "source" ? study.sourceLanguage.code : study.targetLanguage.code);
      const token = ++state.audioToken;
      state.flashAudioPlaying = true;
      state.flashAudioKind = "phrase";
      window.dispatchEvent(new CustomEvent("lingua-side-audio-start", { detail: { owner: "learn" } }));
      bridge.phraseAudioCommand({ action: "start", text, language }).then((result) => {
        if (token !== state.audioToken) return;
        state.flashAudioPlaying = Boolean(result?.ok);
        if (!state.flashAudioPlaying) state.flashAudioKind = "";
        renderContent();
      }).catch(() => { if (token === state.audioToken) { state.flashAudioPlaying = false; state.flashAudioKind = ""; renderContent(); } });
    }
    function playVocabularyPronunciation(record, language) {
      const token = ++state.audioToken;
      let fallbackStarted = false;
      const finish = () => {
        if (token !== state.audioToken) return;
        state.flashAudio = null;
        state.flashAudioKind = "";
        state.flashAudioPlaying = false;
        if (state.study) renderContent();
      };
      const fallback = () => {
        if (token !== state.audioToken || fallbackStarted) return;
        fallbackStarted = true;
        state.flashAudio = null;
        const started = pronunciation.speakText(record.word, language, { onEnd: finish, onError: finish });
        if (!started) { finish(); return; }
        state.flashAudio = { pause: pronunciation.stopSpeech };
        state.flashAudioPlaying = true;
        state.flashAudioKind = "vocabulary";
        if (state.study) renderContent();
      };
      state.flashAudioPlaying = true;
      state.flashAudioKind = "vocabulary";
      window.dispatchEvent(new CustomEvent("lingua-side-audio-start", { detail: { owner: "learn" } }));
      const audioUrl = record.pronunciation?.audio?.url;
      if (!audioUrl) { fallback(); return; }
      const audio = new Audio(audioUrl);
      audio.onended = finish;
      audio.onerror = fallback;
      state.flashAudio = audio;
      audio.play().then(() => {
        if (token !== state.audioToken) audio.pause();
      }).catch(fallback);
    }
    function renderStudy() {
      const study = state.study;
      if (study.kind === "vocabulary") return renderVocabularyStudy();
      const group = state.groups.find((candidate) => candidate.key === study.groupKey);
      if (!group || !study.order.length) { exitPractice(); return; }
      el.content.className = "learn-content learn-study";
      const direction = folderLabel(group);
      const returnButton = document.createElement("button"); returnButton.type = "button"; returnButton.className = "learn-return"; returnButton.textContent = t("learnReturnTranslations"); returnButton.addEventListener("click", exitPractice);
      const heading = document.createElement("h1"); heading.className = "learn-study-direction"; heading.textContent = direction;
      const feedback = state.feedback ? document.createElement("p") : null;
      if (feedback) { feedback.className = "learn-feedback"; feedback.setAttribute("role", "status"); feedback.textContent = state.feedback; }
      if (study.completed) {
        const complete = document.createElement("section"); complete.className = "card learn-study-complete";
        const title = document.createElement("h2"); title.textContent = t("learnStudyCompleteTitle");
        const message = document.createElement("p"); message.textContent = t("learnStudyComplete");
        const restart = document.createElement("button"); restart.type = "button"; restart.dataset.studyFocus = ""; restart.textContent = t("learnRestart"); restart.addEventListener("click", () => startPractice(group));
        complete.append(title, message, restart); el.content.append(returnButton, heading); if (feedback) el.content.append(feedback); el.content.append(complete); return;
      }
      const record = currentCard();
      if (!record) { exitPractice(); return; }
      const sourceSide = study.side === "source";
      const language = sourceSide ? languageLabel(study.sourceLanguage) : languageLabel(study.targetLanguage);
      const text = sourceSide ? record.sourceText : record.targetText;
      const card = document.createElement("section"); card.className = "learn-flashcard"; card.tabIndex = 0; card.setAttribute("role", "group"); card.setAttribute("aria-live", "polite"); card.setAttribute("aria-label", format(sourceSide ? "learnFrontLanguage" : "learnBackLanguage", { language })); card.setAttribute("aria-description", t("learnFlip"));
      if (study.animateFlip) { card.classList.add("is-flipping"); study.animateFlip = false; }
      const phrase = document.createElement("p"); phrase.className = "learn-flashcard-text"; phrase.textContent = text;
      const audio = document.createElement("button"); audio.type = "button"; audio.className = "learn-card-audio"; audio.disabled = state.pageAudioBlocked; audio.setAttribute("aria-label", state.pageAudioBlocked ? t("otherAudioBlocked") : format(state.flashAudioPlaying ? "learnAudioStop" : "learnAudioPlay", { language })); audio.title = audio.getAttribute("aria-label"); audio.innerHTML = state.flashAudioPlaying ? ICONS.stop : ICONS.speaker;
      audio.addEventListener("click", (event) => { event.stopPropagation(); if (state.flashAudioPlaying) stopFlashAudio(); else playVisibleSide(); renderContent(); });
      card.addEventListener("click", () => flipStudyCard()); card.append(phrase, audio);
      const navigation = document.createElement("div"); navigation.className = "learn-study-navigation";
      const previous = document.createElement("button"); previous.type = "button"; previous.className = "learn-study-arrow"; previous.disabled = study.index === 0; previous.setAttribute("aria-label", t("learnPrevious")); previous.title = t("learnPrevious"); previous.innerHTML = ICONS.arrowLeft; previous.addEventListener("click", previousStudyCard);
      const progress = document.createElement("p"); progress.className = "learn-study-progress"; progress.textContent = format("learnStudyProgress", { current: study.index + 1, total: study.order.length });
      const next = document.createElement("button"); next.type = "button"; next.className = "learn-study-arrow"; next.setAttribute("aria-label", t("learnNext")); next.title = t("learnNext"); next.innerHTML = ICONS.arrowRight; next.addEventListener("click", nextStudyCard);
      navigation.append(previous, progress, next); el.content.append(returnButton, heading); if (feedback) el.content.append(feedback); el.content.append(card, navigation);
    }
    function vocabularyPartAbbreviation(part) {
      const abbreviations = {
        en: { noun: "n", verb: "v", adjective: "adj", adverb: "adv", pronoun: "pron", preposition: "prep", conjunction: "conj", interjection: "interj", determiner: "det", article: "art", numeral: "num", properNoun: "prop.n" },
        es: { noun: "s.", verb: "v.", adjective: "adj.", adverb: "adv.", pronoun: "pron.", preposition: "prep.", conjunction: "conj.", interjection: "interj.", determiner: "det.", article: "art.", numeral: "num.", properNoun: "n.p." },
        fr: { noun: "n.", verb: "v.", adjective: "adj.", adverb: "adv.", pronoun: "pron.", preposition: "prép.", conjunction: "conj.", interjection: "interj.", determiner: "dét.", article: "art.", numeral: "num.", properNoun: "n.pr." },
        de: { noun: "Subst.", verb: "Verb", adjective: "Adj.", adverb: "Adv.", pronoun: "Pron.", preposition: "Präp.", conjunction: "Konj.", interjection: "Interj.", determiner: "Det.", article: "Art.", numeral: "Num.", properNoun: "Eigenn." },
        pt: { noun: "s.", verb: "v.", adjective: "adj.", adverb: "adv.", pronoun: "pron.", preposition: "prep.", conjunction: "conj.", interjection: "interj.", determiner: "det.", article: "art.", numeral: "num.", properNoun: "n.p." },
        zh: { noun: "名", verb: "动", adjective: "形", adverb: "副", pronoun: "代", preposition: "介", conjunction: "连", interjection: "叹", determiner: "限定", article: "冠", numeral: "数", properNoun: "专名" },
        ja: { noun: "名", verb: "動", adjective: "形", adverb: "副", pronoun: "代", preposition: "前", conjunction: "接", interjection: "感", determiner: "限定", article: "冠", numeral: "数", properNoun: "固有名" },
        ko: { noun: "명", verb: "동", adjective: "형", adverb: "부", pronoun: "대", preposition: "전", conjunction: "접", interjection: "감", determiner: "한정", article: "관", numeral: "수", properNoun: "고유명" },
      };
      return abbreviations[i18n.resolvedLocale]?.[part] || abbreviations.en[part] || part;
    }
    function formatVocabularySummary(record, definitions) {
      const values = Array.isArray(record.flashcardSummary) ? record.flashcardSummary : [];
      return values.map((item, index) => `(${vocabularyPartAbbreviation(item.partOfSpeech)}) ${definitions[index] || item.definition}`).join("\n") || t("learnVocabularySummaryUnavailable");
    }
    function vocabularySummary(record) {
      const values = Array.isArray(record.flashcardSummary) ? record.flashcardSummary : [];
      if (!values.length) return t("learnVocabularySummaryUnavailable");
      const locale = i18n.resolvedLocale;
      const key = `${record.id}\u0001${record.updatedAt}\u0001${locale}`;
      const cached = state.summaryCache.get(key);
      if (cached) return formatVocabularySummary(record, cached);
      if (!state.summaryPending.has(key)) {
        state.summaryPending.add(key);
        const from = record.summaryLanguage || "auto";
        const definitions = values.map((item) => item.definition);
        const finish = (translated) => {
          state.summaryPending.delete(key);
          state.summaryCache.set(key, translated);
          if (state.mode === "vocabulary" && state.ready) renderContent();
        };
        if (from === locale) { state.summaryPending.delete(key); state.summaryCache.set(key, definitions); return formatVocabularySummary(record, definitions); }
        Promise.all(definitions.map((definition) => translator.translate({ text: definition, from, to: locale, concurrency: 1, allowChromeDownload: false }).then((response) => response.text))).then(finish).catch(() => finish(definitions));
      }
      return formatVocabularySummary(record, values.map((item) => item.definition));
    }
    function cardDefinition(record) {
      return String(record.editableDefinition || "").trim() || vocabularySummary(record);
    }
    function startDefinitionEditor(record) {
      stopFlashAudio();
      state.editor = { recordId: record.id, initial: String(record.editableDefinition || "").trim() || vocabularySummary(record), draft: String(record.editableDefinition || "").trim() || vocabularySummary(record), saving: false, token: 0, pendingAction: "" };
      renderContent();
      requestAnimationFrame(() => root.querySelector("[data-definition-editor]")?.focus());
    }
    async function saveDefinitionEditor() {
      const editor = state.editor, record = currentCard();
      if (!editor || editor.saving || !record || record.id !== editor.recordId) return;
      const token = ++editor.token;
      editor.saving = true; renderContent();
      try {
        const updated = await learn.updateVocabularyEditableDefinition(record.id, editor.draft);
        if (state.editor !== editor || editor.token !== token) return;
        if (!updated) throw new Error("Record is unavailable");
        state.study.records.set(updated.id, updated);
        state.editor = null;
        state.feedback = "";
      } catch {
        if (state.editor !== editor || editor.token !== token) return;
        editor.saving = false;
        state.feedback = t("learnDefinitionEditUnavailable");
      }
      renderContent();
    }
    async function restoreVocabularySummary(record) {
      if (state.editMutation || !String(record.editableDefinition || "").trim()) return;
      stopFlashAudio();
      const mutation = { recordId: record.id, token: Date.now() };
      state.editMutation = mutation; renderContent();
      try {
        const updated = await learn.updateVocabularyEditableDefinition(record.id, "");
        if (state.editMutation !== mutation) return;
        if (!updated) throw new Error("Record is unavailable");
        state.study.records.set(updated.id, updated);
        state.feedback = "";
      } catch {
        if (state.editMutation === mutation) state.feedback = t("learnDefinitionEditUnavailable");
      }
      if (state.editMutation === mutation) state.editMutation = null;
      renderContent();
    }
    function openFullDefinition() {
      const record = currentCard();
      if (!record || state.editMutation) return;
      if (!guardEditorAction("full")) return;
      stopFlashAudio();
      state.editor = null;
      sidepanelSelection.setDefinitionRestore({ word: record.word, language: record.language, definition: record.definition, summaryLanguage: record.summaryLanguage || "", pronunciation: record.pronunciation || null });
      openTab?.("definition");
    }
    function renderDefinitionEditor(record) {
      const editor = state.editor;
      const wrap = document.createElement("div"); wrap.className = "learn-definition-editor"; wrap.addEventListener("click", (event) => event.stopPropagation());
      const label = document.createElement("label"); label.htmlFor = "learn-definition-editor"; label.textContent = t("learnDefinitionEditorLabel");
      const area = document.createElement("textarea"); area.id = "learn-definition-editor"; area.dataset.definitionEditor = ""; area.value = editor.draft; area.disabled = editor.saving; area.addEventListener("input", () => { editor.draft = area.value; });
      const actions = document.createElement("div"); actions.className = "learn-definition-editor-actions";
      const save = document.createElement("button"); save.type = "button"; save.textContent = t("learnSaveChanges"); save.disabled = editor.saving; save.addEventListener("click", saveDefinitionEditor);
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = t("learnCancel"); cancel.disabled = editor.saving; cancel.addEventListener("click", () => { state.editor = null; state.feedback = t("learnDefinitionEditCancelled"); renderContent(); });
      actions.append(save, cancel); wrap.append(label, area, actions);
      if (editor.pendingAction) {
        const confirm = document.createElement("div"); confirm.className = "learn-editor-confirmation";
        const message = document.createElement("p"); message.textContent = t("learnDiscardDefinitionChanges");
        const keep = document.createElement("button"); keep.type = "button"; keep.textContent = t("learnKeepEditing"); keep.addEventListener("click", () => { editor.pendingAction = ""; renderContent(); });
        const discard = document.createElement("button"); discard.type = "button"; discard.className = "learn-danger-button"; discard.textContent = t("learnDiscardChanges"); discard.addEventListener("click", () => runEditorAction(editor.pendingAction));
        confirm.append(message, keep, discard); wrap.append(confirm);
      }
      return wrap;
    }
    function renderVocabularyStudy() {
      const study = state.study;
      const group = state.vocabularyGroups.find((candidate) => candidate.key === study.groupKey);
      if (!group || !study.order.length) { exitPractice(); return; }
      el.content.className = "learn-content learn-study";
      const label = vocabularyFolderLabel(group);
      const returnButton = document.createElement("button"); returnButton.type = "button"; returnButton.className = "learn-return"; returnButton.textContent = t("learnReturnVocabulary"); returnButton.addEventListener("click", exitPractice);
      const heading = document.createElement("h1"); heading.className = "learn-study-direction"; heading.textContent = label;
      const feedback = state.feedback ? document.createElement("p") : null;
      if (feedback) { feedback.className = "learn-feedback"; feedback.setAttribute("role", "status"); feedback.textContent = state.feedback; }
      if (study.completed) {
        const complete = document.createElement("section"); complete.className = "card learn-study-complete";
        const title = document.createElement("h2"); title.textContent = t("learnVocabularyStudyCompleteTitle");
        const message = document.createElement("p"); message.textContent = t("learnVocabularyStudyComplete");
        const restart = document.createElement("button"); restart.type = "button"; restart.dataset.studyFocus = ""; restart.textContent = t("learnRestart"); restart.addEventListener("click", () => startVocabularyPractice(group));
        complete.append(title, message, restart); el.content.append(returnButton, heading); if (feedback) el.content.append(feedback); el.content.append(complete); return;
      }
      const record = currentCard();
      if (!record) { exitPractice(); return; }
      const wordSide = study.side === "word";
      const card = document.createElement("section"); card.className = "learn-flashcard learn-vocabulary-card"; card.tabIndex = 0; card.setAttribute("role", "group"); card.setAttribute("aria-live", "polite"); card.setAttribute("aria-label", format(wordSide ? "learnVocabularyFrontLanguage" : "learnVocabularyBack", { language: label })); card.setAttribute("aria-description", t("learnFlip"));
      if (study.animateFlip) { card.classList.add("is-flipping"); study.animateFlip = false; }
      const editing = state.editor?.recordId === record.id;
      const text = document.createElement("p"); text.className = `learn-flashcard-text ${wordSide ? "learn-vocabulary-word" : "learn-vocabulary-summary"}`; text.textContent = wordSide ? record.word : cardDefinition(record); text.hidden = Boolean(editing);
      if (!wordSide && !editing) {
        text.tabIndex = 0;
        text.setAttribute("role", "button");
        text.setAttribute("aria-label", t("learnEditDefinition"));
        text.addEventListener("click", (event) => event.stopPropagation());
        text.addEventListener("dblclick", (event) => { event.stopPropagation(); startDefinitionEditor(record); });
        text.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault(); event.stopPropagation(); startDefinitionEditor(record);
        });
      }
      card.addEventListener("click", (event) => { if (!event.target.closest(".learn-definition-editor,.learn-card-actions")) flipStudyCard(); }); card.append(text);
      if (wordSide) {
        const audio = document.createElement("button"); audio.type = "button"; audio.className = "learn-card-audio"; audio.disabled = state.pageAudioBlocked; audio.setAttribute("aria-label", state.pageAudioBlocked ? t("otherAudioBlocked") : format(state.flashAudioPlaying ? "learnAudioStop" : "learnAudioPlay", { language: label })); audio.title = audio.getAttribute("aria-label"); audio.innerHTML = state.flashAudioPlaying ? ICONS.stop : ICONS.speaker;
        audio.addEventListener("click", (event) => { event.stopPropagation(); if (state.flashAudioPlaying) stopFlashAudio(); else playVisibleSide(); renderContent(); }); card.append(audio);
      }
      if (!wordSide) {
        const actions = document.createElement("div"); actions.className = `learn-card-actions${editing ? " is-editor" : ""}`; actions.addEventListener("click", (event) => event.stopPropagation());
        if (editing) actions.append(renderDefinitionEditor(record));
        else {
          const seeFull = document.createElement("button"); seeFull.type = "button"; seeFull.textContent = t("learnSeeFullDefinition"); seeFull.disabled = Boolean(state.editMutation); seeFull.addEventListener("click", openFullDefinition);
          actions.append(seeFull);
          if (String(record.editableDefinition || "").trim()) {
            const restore = document.createElement("button"); restore.type = "button"; restore.textContent = t("learnRestoreSummary"); restore.disabled = Boolean(state.editMutation); restore.addEventListener("click", () => restoreVocabularySummary(record)); actions.append(restore);
          }
        }
        card.append(actions);
      }
      const navigation = document.createElement("div"); navigation.className = "learn-study-navigation";
      const previous = document.createElement("button"); previous.type = "button"; previous.className = "learn-study-arrow"; previous.disabled = study.index === 0; previous.setAttribute("aria-label", t("learnPrevious")); previous.title = t("learnPrevious"); previous.innerHTML = ICONS.arrowLeft; previous.addEventListener("click", previousStudyCard);
      const progress = document.createElement("p"); progress.className = "learn-study-progress"; progress.textContent = format("learnStudyProgress", { current: study.index + 1, total: study.order.length });
      const next = document.createElement("button"); next.type = "button"; next.className = "learn-study-arrow"; next.setAttribute("aria-label", t("learnNext")); next.title = t("learnNext"); next.innerHTML = ICONS.arrowRight; next.addEventListener("click", nextStudyCard);
      navigation.append(previous, progress, next); el.content.append(returnButton, heading); if (feedback) el.content.append(feedback); el.content.append(card, navigation);
    }
    function renderFolder(group, index) {
      const label = folderLabel(group), expanded = state.expanded.has(group.key);
      const folder = document.createElement("section"); folder.className = "learn-folder";
      const head = document.createElement("div"); head.className = "learn-folder-head";
      const toggle = document.createElement("button"); const panelId = `learn-folder-${index}`;
      toggle.type = "button"; toggle.className = "learn-folder-toggle"; toggle.setAttribute("aria-expanded", String(expanded)); toggle.setAttribute("aria-controls", panelId);
      toggle.dataset.folderKey = group.key;
      toggle.setAttribute("aria-label", format(expanded ? "learnHideFolder" : "learnShowFolder", { pair: label }));
      const title = document.createElement("span"); title.className = "learn-folder-title"; title.textContent = label;
      const count = document.createElement("span"); count.className = "learn-folder-count"; count.textContent = translationCount(group.records.length);
      toggle.append(title, count);
      toggle.addEventListener("click", () => { if (expanded) { state.expanded.delete(group.key); if (state.confirmation?.groupKey === group.key) state.confirmation = null; } else state.expanded.add(group.key); renderContent(); });
      const practice = document.createElement("button"); practice.type = "button"; practice.className = "learn-practice-button"; practice.textContent = t("learnPractice"); practice.setAttribute("aria-label", `${t("learnPractice")}: ${label}`); practice.addEventListener("click", () => startPractice(group));
      const removeFolder = deleteButton(t("learnDeleteFolder"), `${t("learnDeleteFolder")}: ${label}`, () => { state.confirmation = { type: "folder", groupKey: group.key, ids: group.records.map((record) => record.id) }; renderContent(); });
      head.append(toggle, practice, removeFolder); folder.append(head);
      if (state.confirmation?.type === "folder" && state.confirmation.groupKey === group.key) folder.append(makeConfirmation(state.confirmation, format("learnRemoveFolderPrompt", { pair: label, count: group.records.length })));
      if (!expanded) return folder;
      const list = document.createElement("div"); list.id = panelId; list.className = "learn-translation-list"; list.setAttribute("role", "list");
      for (const record of group.records) {
        const row = document.createElement("article"); row.className = "learn-translation-row"; row.setAttribute("role", "listitem"); row.setAttribute("aria-label", `${t("original")}: ${record.sourceText}. ${t("translated")}: ${record.targetText}.`);
        const phrases = document.createElement("div"); phrases.className = "learn-translation-phrases";
        const source = document.createElement("p"); source.className = "learn-translation-source"; source.textContent = previewText(record.sourceText);
        const target = document.createElement("p"); target.className = "learn-translation-target"; target.textContent = previewText(record.targetText);
        phrases.append(source, target);
        const actions = document.createElement("div"); actions.className = "learn-entry-actions";
        const practiceEntry = document.createElement("button"); practiceEntry.type = "button"; practiceEntry.className = "learn-practice-entry"; practiceEntry.textContent = t("learnPractice"); practiceEntry.setAttribute("aria-label", `${t("learnPracticeTranslation")}: ${record.sourceText}`); practiceEntry.addEventListener("click", () => startPractice(group, record.id));
        const remove = deleteButton(t("learnDeleteTranslation"), `${t("learnDeleteTranslation")}: ${record.sourceText}`, () => { state.confirmation = { type: "record", groupKey: group.key, id: record.id }; renderContent(); }, true);
        actions.append(practiceEntry, remove); row.append(phrases, actions);
        if (state.confirmation?.type === "record" && state.confirmation.id === record.id) row.append(makeConfirmation(state.confirmation, t("learnRemoveTranslationPrompt")));
        list.append(row);
      }
      folder.append(list); return folder;
    }
    function renderVocabularyFolder(group, index) {
      const label = vocabularyFolderLabel(group), expanded = state.vocabularyExpanded.has(group.key);
      const folder = document.createElement("section"); folder.className = "learn-folder learn-vocabulary-folder";
      const head = document.createElement("div"); head.className = "learn-folder-head";
      const toggle = document.createElement("button"); const panelId = `learn-vocabulary-folder-${index}`;
      toggle.type = "button"; toggle.className = "learn-folder-toggle"; toggle.setAttribute("aria-expanded", String(expanded)); toggle.setAttribute("aria-controls", panelId);
      toggle.dataset.folderKey = group.key;
      toggle.setAttribute("aria-label", format(expanded ? "learnHideVocabularyFolder" : "learnShowVocabularyFolder", { language: label }));
      const title = document.createElement("span"); title.className = "learn-folder-title"; title.textContent = label;
      const count = document.createElement("span"); count.className = "learn-folder-count"; count.textContent = vocabularyCount(group.records.length);
      toggle.append(title, count);
      toggle.addEventListener("click", () => { if (expanded) { state.vocabularyExpanded.delete(group.key); if (state.confirmation?.groupKey === group.key) state.confirmation = null; } else state.vocabularyExpanded.add(group.key); renderContent(); });
      const practice = document.createElement("button"); practice.type = "button"; practice.className = "learn-practice-button"; practice.textContent = t("learnPractice"); practice.setAttribute("aria-label", `${t("learnPractice")}: ${label}`); practice.addEventListener("click", () => startVocabularyPractice(group));
      const removeFolder = deleteButton(t("learnDeleteVocabularyFolder"), `${t("learnDeleteVocabularyFolder")}: ${label}`, () => { state.confirmation = { type: "vocabulary-folder", groupKey: group.key, ids: group.records.map((record) => record.id) }; renderContent(); });
      head.append(toggle, practice, removeFolder); folder.append(head);
      if (state.confirmation?.type === "vocabulary-folder" && state.confirmation.groupKey === group.key) folder.append(makeConfirmation(state.confirmation, format("learnRemoveVocabularyFolderPrompt", { language: label, count: group.records.length })));
      if (!expanded) return folder;
      const list = document.createElement("div"); list.id = panelId; list.className = "learn-translation-list learn-vocabulary-list"; list.setAttribute("role", "list");
      for (const record of group.records) {
        const visibleDefinition = cardDefinition(record);
        const row = document.createElement("article"); row.className = "learn-translation-row learn-vocabulary-row"; row.setAttribute("role", "listitem"); row.setAttribute("aria-label", `${record.word}. ${label}. ${visibleDefinition}`);
        const details = document.createElement("div"); details.className = "learn-translation-phrases";
        const word = document.createElement("p"); word.className = "learn-translation-source"; word.textContent = record.word;
        const summary = document.createElement("p"); summary.className = "learn-translation-target learn-vocabulary-preview"; summary.textContent = visibleDefinition;
        details.append(word, summary);
        const actions = document.createElement("div"); actions.className = "learn-entry-actions";
        const practiceEntry = document.createElement("button"); practiceEntry.type = "button"; practiceEntry.className = "learn-practice-entry"; practiceEntry.textContent = t("learnPractice"); practiceEntry.setAttribute("aria-label", `${t("learnPracticeVocabulary")}: ${record.word}`); practiceEntry.addEventListener("click", () => startVocabularyPractice(group, record.id));
        const remove = deleteButton(t("learnDeleteVocabulary"), `${t("learnDeleteVocabulary")}: ${record.word}`, () => { state.confirmation = { type: "vocabulary-record", groupKey: group.key, id: record.id }; renderContent(); }, true);
        actions.append(practiceEntry, remove); row.append(details, actions);
        if (state.confirmation?.type === "vocabulary-record" && state.confirmation.id === record.id) row.append(makeConfirmation(state.confirmation, t("learnRemoveVocabularyPrompt")));
        list.append(row);
      }
      folder.append(list); return folder;
    }
    async function removeTarget(target) {
      if (state.pending) return;
      const vocabulary = target.type.startsWith("vocabulary-");
      const folder = target.type === "folder" || target.type === "vocabulary-folder";
      state.pending = target.type === "folder" ? `folder:${target.groupKey}` : `record:${target.id}`; renderContent();
      try {
        const removed = vocabulary
          ? (folder ? await learn.removeSavedVocabularyItems(target.ids) : await learn.removeSavedVocabulary(target.id))
          : (folder ? await learn.removeSavedTranslations(target.ids) : await learn.removeSavedTranslation(target.id));
        if (!removed) throw new Error("Record was already unavailable");
        state.confirmation = null; state.feedback = ""; state.focusContent = true;
        await (vocabulary ? loadVocabulary() : loadTranslations());
      } catch { state.feedback = t(vocabulary ? "learnVocabularyDeleteUnavailable" : "learnDeleteUnavailable"); }
      finally { state.pending = ""; renderContent(); if (state.focusContent) { state.focusContent = false; el.content.focus(); } }
    }
    function renderEmpty(titleKey, messageKey) {
      el.content.className = "card learn-content learn-content-empty";
      const title = document.createElement("h1"); title.className = "learn-content-title"; title.textContent = t(titleKey);
      const message = document.createElement("p"); message.className = "learn-content-message"; message.textContent = t(messageKey);
      el.content.append(title, message);
    }
    function renderTranslations() {
      if (!state.groups.length) return renderEmpty("learnTranslationsEmptyTitle", "learnTranslationsEmpty");
      el.content.className = "learn-content learn-content-list";
      const folders = document.createElement("div"); folders.className = "learn-folder-list";
      state.groups.forEach((group, index) => folders.append(renderFolder(group, index)));
      if (state.feedback) {
        const feedback = document.createElement("p"); feedback.className = "learn-feedback"; feedback.setAttribute("role", "status"); feedback.setAttribute("aria-live", "polite"); feedback.textContent = state.feedback;
        el.content.append(feedback);
      }
      el.content.append(folders);
    }
    function renderVocabulary() {
      if (!state.vocabularyGroups.length) return renderEmpty("learnVocabularyEmptyTitle", "learnVocabularyEmpty");
      el.content.className = "learn-content learn-content-list";
      const folders = document.createElement("div"); folders.className = "learn-folder-list";
      state.vocabularyGroups.forEach((group, index) => folders.append(renderVocabularyFolder(group, index)));
      if (state.feedback) {
        const feedback = document.createElement("p"); feedback.className = "learn-feedback"; feedback.setAttribute("role", "status"); feedback.setAttribute("aria-live", "polite"); feedback.textContent = state.feedback;
        el.content.append(feedback);
      }
      el.content.append(folders);
    }
    function renderContent() {
      el.shell.setAttribute("aria-busy", String(!state.ready && !state.unavailable)); el.content.replaceChildren(); el.content.setAttribute("aria-labelledby", `learn-mode-${state.mode}`);
      if (state.unavailable) {
        el.content.className = "card learn-content learn-content-error";
        const title = document.createElement("h1"); title.className = "learn-content-title"; title.textContent = t("learnUnavailableTitle");
        const message = document.createElement("p"); message.className = "learn-content-message"; message.textContent = t("learnUnavailable");
        return el.content.append(title, message);
      }
      if (!state.ready) {
        el.content.className = "card learn-content learn-content-loading";
        const title = document.createElement("h1"); title.className = "learn-content-title"; title.textContent = modeLabel(state.mode);
        const message = document.createElement("p"); message.className = "learn-content-message"; message.textContent = t("learnLoading");
        return el.content.append(title, message);
      }
      if (state.study) return renderStudy();
      if (state.mode === "translations") return renderTranslations();
      renderVocabulary();
    }
    function renderModes() {
      el.modeTabs.replaceChildren(); el.modeTabs.setAttribute("aria-label", t("learnModeLabel"));
      for (const mode of MODES) {
        const button = document.createElement("button"), selected = state.mode === mode;
        button.type = "button"; button.id = `learn-mode-${mode}`; button.className = "learn-mode-tab"; button.dataset.mode = mode;
        button.setAttribute("role", "tab"); button.setAttribute("aria-selected", String(selected)); button.setAttribute("aria-controls", "learn-content"); button.tabIndex = selected ? 0 : -1; button.textContent = modeLabel(mode);
        button.addEventListener("click", () => setMode(mode)); el.modeTabs.append(button);
      }
    }
    async function setMode(mode) {
      const next = validMode(mode); if (next === state.mode) return;
      if (state.study && state.study.kind !== next) {
        if (!guardEditorAction(`mode:${next}`)) return;
        stopFlashAudio(); state.study = null; state.editor = null;
      }
      state.mode = next; state.ready = false; renderModes(); renderContent();
      state.ready = await loadForMode(); renderContent();
      preferenceWrite = preferenceWrite.catch(() => {}).then(() => storage.set(PREFERENCES_KEY, { mode: state.mode })); preferenceWrite.catch(() => {});
    }
    el.modeTabs.addEventListener("keydown", (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const current = MODES.indexOf(state.mode);
      const index = event.key === "Home" ? 0 : event.key === "End" ? MODES.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + MODES.length) % MODES.length;
      setMode(MODES[index]); el.modeTabs.querySelector(`[data-mode="${MODES[index]}"]`)?.focus();
    });
    document.addEventListener("keydown", (event) => {
      if (!state.study || event.defaultPrevented || event.target?.closest?.("input, textarea, select")) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); previousStudyCard(); }
      else if (event.key === "ArrowRight") { event.preventDefault(); nextStudyCard(); }
      else if ((event.key === " " || event.key === "Spacebar") && !event.target?.closest?.("button")) { event.preventDefault(); flipStudyCard(); }
    });
    i18n.subscribe(() => { renderModes(); renderContent(); });
    window.addEventListener("lingua-side-audio-start", (event) => {
      if (event.detail?.owner !== "learn" && state.flashAudioPlaying) stopFlashAudio();
    });
    window.addEventListener("pagehide", () => stopFlashAudio());
    bridge.watchPhraseAudio((phraseState) => {
      if (phraseState?.status !== "playing" && state.flashAudioPlaying && state.flashAudioKind === "phrase") {
        state.flashAudioPlaying = false;
        state.flashAudioKind = "";
        if (state.study) renderContent();
      }
    });
    function updatePageAudioState(readState) {
      const blocked = readState?.status === "playing" || (readState?.status === "seeking" && readState.willResume);
      if (blocked && state.flashAudioPlaying) stopFlashAudio();
      if (blocked === state.pageAudioBlocked) return;
      state.pageAudioBlocked = blocked;
      if (state.study) renderContent();
    }
    bridge.watchReadAloud(updatePageAudioState);
    bridge.readAloudCommand({ action: "state" }).then((response) => updatePageAudioState(response?.state)).catch(() => {});
    if (globalThis.chrome?.storage?.onChanged) chrome.storage.onChanged.addListener((changes, areaName) => { if (areaName === "local" && changes["learn.state"]) loadForMode().then(renderContent); });
    renderModes(); renderContent(); state.ready = await loadForMode(); renderContent();
    return {
      activate() {},
      deactivate() {
        stopFlashAudio();
        state.expanded.clear();
        state.vocabularyExpanded.clear();
        state.confirmation = null;
        renderContent();
      },
    };
  },
};

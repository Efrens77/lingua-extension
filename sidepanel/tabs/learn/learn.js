import { ICONS } from "../../icons.js";

const PREFERENCES_KEY = "learn.preferences";
const MODES = ["translations", "vocabulary"];
const TEMPLATE = `<section class="learn-shell" aria-busy="true" data-el="shell"><div class="learn-mode-tabs" role="tablist" data-el="modeTabs"></div><section id="learn-content" class="card learn-content" data-el="content" role="tabpanel" tabindex="0" aria-live="polite"></section></section>`;
const validMode = (value) => MODES.includes(value) ? value : "translations";

export default {
  async mount(root, ctx) {
    const { storage, learn, i18n } = ctx;
    const href = new URL("./learn.css", import.meta.url).href;
    if (!document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet"; link.href = href; document.head.append(link);
    }
    root.innerHTML = TEMPLATE;
    const el = Object.fromEntries([...root.querySelectorAll("[data-el]")].map((node) => [node.dataset.el, node]));
    let saved = {};
    try { saved = await storage.get(PREFERENCES_KEY, {}); } catch { /* Default safely. */ }
    const state = { mode: validMode(saved?.mode), ready: false, unavailable: false, groups: [], expanded: new Set(), confirmation: null, pending: "", feedback: "", loadToken: 0, focusContent: false };
    let preferenceWrite = Promise.resolve();
    const t = (key) => i18n.t(key);
    const format = (key, values) => Object.entries(values).reduce((message, [name, value]) => message.replaceAll(`{${name}}`, String(value)), t(key));
    const modeLabel = (mode) => t(mode === "translations" ? "learnTranslations" : "learnVocabulary");
    // Prefer the active interface locale, while retaining a saved readable name
    // as the fallback for unusual or legacy language codes.
    const languageLabel = (language) => i18n.languageName(language?.code, String(language?.name || "").trim() || language?.code || "");
    const folderLabel = (group) => `${languageLabel(group.sourceLanguage)} → ${languageLabel(group.targetLanguage)}`;
    const translationCount = (count) => count === 1 ? t("learnTranslationCountOne") : format("learnTranslationCountOther", { count });

    function sortedGroups(groups) {
      return groups.map((group) => ({ ...group, records: [...group.records].sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt) || String(a.id).localeCompare(String(b.id))) }))
        .sort((a, b) => Math.max(...b.records.map((r) => Number(r.updatedAt) || 0)) - Math.max(...a.records.map((r) => Number(r.updatedAt) || 0)) || folderLabel(a).localeCompare(folderLabel(b)));
    }
    async function loadTranslations() {
      const token = ++state.loadToken;
      try {
        const groups = sortedGroups(await learn.translationsByLanguagePair());
        if (token !== state.loadToken) return false;
        state.groups = groups;
        state.expanded = new Set([...state.expanded].filter((key) => groups.some((group) => group.key === key)));
        state.unavailable = false;
        return true;
      } catch {
        if (token !== state.loadToken) return false;
        state.unavailable = true;
        return false;
      }
    }
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
      button.innerHTML = entry ? ICONS.trash : `${ICONS.trash}<span>${label}</span>`;
      button.addEventListener("click", listener); return button;
    }
    function renderFolder(group, index) {
      const label = folderLabel(group), expanded = state.expanded.has(group.key);
      const folder = document.createElement("section"); folder.className = "learn-folder";
      const head = document.createElement("div"); head.className = "learn-folder-head";
      const toggle = document.createElement("button"); const panelId = `learn-folder-${index}`;
      toggle.type = "button"; toggle.className = "learn-folder-toggle"; toggle.setAttribute("aria-expanded", String(expanded)); toggle.setAttribute("aria-controls", panelId);
      toggle.setAttribute("aria-label", format(expanded ? "learnHideFolder" : "learnShowFolder", { pair: label }));
      const title = document.createElement("span"); title.className = "learn-folder-title"; title.textContent = label;
      const count = document.createElement("span"); count.className = "learn-folder-count"; count.textContent = translationCount(group.records.length);
      toggle.append(title, count);
      toggle.addEventListener("click", () => { if (expanded) { state.expanded.delete(group.key); if (state.confirmation?.groupKey === group.key) state.confirmation = null; } else state.expanded.add(group.key); renderContent(); });
      const removeFolder = deleteButton(t("learnDeleteFolder"), `${t("learnDeleteFolder")}: ${label}`, () => { state.confirmation = { type: "folder", groupKey: group.key, ids: group.records.map((record) => record.id) }; renderContent(); });
      head.append(toggle, removeFolder); folder.append(head);
      if (state.confirmation?.type === "folder" && state.confirmation.groupKey === group.key) folder.append(makeConfirmation(state.confirmation, format("learnRemoveFolderPrompt", { pair: label, count: group.records.length })));
      if (!expanded) return folder;
      const list = document.createElement("div"); list.id = panelId; list.className = "learn-translation-list"; list.setAttribute("role", "list");
      for (const record of group.records) {
        const row = document.createElement("article"); row.className = "learn-translation-row"; row.setAttribute("role", "listitem"); row.setAttribute("aria-label", `${t("original")}: ${record.sourceText}. ${t("translated")}: ${record.targetText}.`);
        const phrases = document.createElement("div"); phrases.className = "learn-translation-phrases";
        const source = document.createElement("p"); source.className = "learn-translation-source"; source.textContent = record.sourceText;
        const target = document.createElement("p"); target.className = "learn-translation-target"; target.textContent = record.targetText;
        phrases.append(source, target);
        const remove = deleteButton(t("learnDeleteTranslation"), `${t("learnDeleteTranslation")}: ${record.sourceText}`, () => { state.confirmation = { type: "record", groupKey: group.key, id: record.id }; renderContent(); }, true);
        row.append(phrases, remove);
        if (state.confirmation?.type === "record" && state.confirmation.id === record.id) row.append(makeConfirmation(state.confirmation, t("learnRemoveTranslationPrompt")));
        list.append(row);
      }
      folder.append(list); return folder;
    }
    async function removeTarget(target) {
      if (state.pending) return;
      state.pending = target.type === "folder" ? `folder:${target.groupKey}` : `record:${target.id}`; renderContent();
      try {
        const removed = target.type === "folder" ? await learn.removeSavedTranslations(target.ids) : await learn.removeSavedTranslation(target.id);
        if (!removed) throw new Error("Record was already unavailable");
        state.confirmation = null; state.feedback = ""; state.focusContent = true;
        await loadTranslations();
      } catch { state.feedback = t("learnDeleteUnavailable"); }
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
      if (state.mode === "translations") return renderTranslations();
      renderEmpty("learnVocabularyEmptyTitle", "learnVocabularyEmpty");
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
      state.mode = next; renderModes(); renderContent();
      preferenceWrite = preferenceWrite.catch(() => {}).then(() => storage.set(PREFERENCES_KEY, { mode: state.mode })); preferenceWrite.catch(() => {});
    }
    el.modeTabs.addEventListener("keydown", (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const current = MODES.indexOf(state.mode);
      const index = event.key === "Home" ? 0 : event.key === "End" ? MODES.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + MODES.length) % MODES.length;
      setMode(MODES[index]); el.modeTabs.querySelector(`[data-mode="${MODES[index]}"]`)?.focus();
    });
    i18n.subscribe(() => { renderModes(); renderContent(); });
    if (globalThis.chrome?.storage?.onChanged) chrome.storage.onChanged.addListener((changes, areaName) => { if (areaName === "local" && changes["learn.state"]) loadTranslations().then(renderContent); });
    renderModes(); renderContent(); state.ready = await loadTranslations(); renderContent();
    return { activate() {}, deactivate() {} };
  },
};

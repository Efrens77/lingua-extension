// Side panel shell: draws the tab bar from the registry and lazily mounts each tab.
// It knows nothing about translation. Every feature lives in tabs/<name>/.
import { TABS } from "./tabs/registry.js";
import { createContext } from "../core/context.js";
import { FEEDBACK_URL } from "../core/config.js";
import { INTERFACE_LANGUAGES } from "../core/i18n.js";

const ctx = await createContext();
const tabBar = document.getElementById("tabs");
const panels = document.getElementById("panels");
const themeToggle = document.getElementById("theme-toggle");
const settingsButton = document.getElementById("settings-button");
const settingsSheet = document.getElementById("settings-sheet");
const settingsClose = document.getElementById("settings-close");
const languageSelect = document.getElementById("interface-language");
const textSize = document.getElementById("text-size");
const mounted = new Map(); // id -> { panel, controller }
let activeId = null;
const THEME_KEY = "app.theme";
const SIZE_KEY = "app.text-scale";

document.getElementById("feedback-link").href = FEEDBACK_URL;

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  themeToggle.textContent = isDark ? ctx.i18n.t("lightMode") : ctx.i18n.t("darkMode");
  themeToggle.setAttribute("aria-pressed", String(isDark));
}

function applyTextSize(value) {
  const scale = Math.min(1.4, Math.max(0.8, Number(value) || 1));
  document.documentElement.style.setProperty("--ui-scale", scale);
  textSize.value = String(scale);
}

function applyShellStrings() {
  const t = ctx.i18n.t;
  document.documentElement.lang = ctx.i18n.locale === "auto" ? (navigator.language || "en") : ctx.i18n.locale;
  document.getElementById("settings-title").textContent = t("settings");
  settingsButton.lastElementChild.textContent = t("settings");
  settingsClose.setAttribute("aria-label", t("close"));
  document.getElementById("interface-language-label").textContent = t("interfaceLanguage");
  document.getElementById("text-size-label").textContent = t("textSize");
  document.getElementById("smaller-label").textContent = t("smaller");
  document.getElementById("larger-label").textContent = t("larger");
  document.getElementById("feedback-link").textContent = t("feedback");
  languageSelect.replaceChildren(...INTERFACE_LANGUAGES.map(([code, name]) => {
    const option = document.createElement("option"); option.value = code;
    option.textContent = code === "auto" ? t("auto") : name; return option;
  }));
  languageSelect.value = ctx.i18n.locale;
  applyTheme(document.documentElement.dataset.theme || "light");
  renderTabBar();
}

themeToggle.addEventListener("click", async () => {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  await ctx.storage.set(THEME_KEY, nextTheme);
});

settingsButton.addEventListener("click", () => {
  settingsSheet.hidden = false;
  settingsButton.setAttribute("aria-expanded", "true");
  settingsClose.focus();
});
settingsClose.addEventListener("click", () => {
  settingsSheet.hidden = true;
  settingsButton.setAttribute("aria-expanded", "false");
  settingsButton.focus();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !settingsSheet.hidden) settingsClose.click();
});
languageSelect.addEventListener("change", () => ctx.i18n.setLocale(languageSelect.value));
textSize.addEventListener("input", () => applyTextSize(textSize.value));
textSize.addEventListener("change", () => ctx.storage.set(SIZE_KEY, Number(textSize.value)));

// A saved choice wins over the default light theme every time the panel opens.
applyTheme(await ctx.storage.get(THEME_KEY, "light"));
applyTextSize(await ctx.storage.get(SIZE_KEY, 1));
ctx.i18n.subscribe(applyShellStrings);

function renderTabBar() {
  tabBar.innerHTML = "";
  for (const tab of TABS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tab";
    btn.id = `tab-${tab.id}`;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-controls", `panel-${tab.id}`);
    btn.setAttribute("aria-selected", "false");
    btn.textContent = tab.id === "translate" ? ctx.i18n.t("translateMode").replace(/ mode$/i, "") : tab.label;
    if (!tab.enabled) {
      btn.disabled = true;
      btn.title = "Coming soon";
    } else {
      btn.addEventListener("click", () => activate(tab.id));
    }
    tabBar.append(btn);
  }
}

async function activate(id) {
  if (id === activeId) return;
  const tab = TABS.find((t) => t.id === id);
  if (!tab?.enabled) return;

  if (activeId) {
    mounted.get(activeId)?.controller.deactivate?.();
    mounted.get(activeId).panel.hidden = true;
  }
  activeId = id;
  for (const btn of tabBar.children) btn.setAttribute("aria-selected", String(btn.id === `tab-${id}`));

  if (!mounted.has(id)) {
    const panel = document.createElement("section");
    panel.id = `panel-${id}`;
    panel.className = "panel";
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `tab-${id}`);
    panels.append(panel);
    const mod = (await tab.load()).default;
    mounted.set(id, { panel, controller: await mod.mount(panel, ctx) });
  }
  const entry = mounted.get(id);
  entry.panel.hidden = false;
  entry.controller.activate?.();
}

applyShellStrings();
activate(TABS.find((t) => t.enabled).id);

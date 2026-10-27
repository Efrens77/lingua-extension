// Side panel shell: draws the tab bar from the registry and lazily mounts each tab.
// It knows nothing about translation. Every feature lives in tabs/<name>/.
import { TABS } from "./tabs/registry.js";
import { createContext } from "../core/context.js";
import { FEEDBACK_URL } from "../core/config.js";

const ctx = createContext();
const tabBar = document.getElementById("tabs");
const panels = document.getElementById("panels");
const themeToggle = document.getElementById("theme-toggle");
const mounted = new Map(); // id -> { panel, controller }
let activeId = null;
const THEME_KEY = "app.theme";

document.getElementById("feedback-link").href = FEEDBACK_URL;

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  themeToggle.textContent = isDark ? "Light mode" : "Dark mode";
  themeToggle.setAttribute("aria-pressed", String(isDark));
}

themeToggle.addEventListener("click", async () => {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  await ctx.storage.set(THEME_KEY, nextTheme);
});

// A saved choice wins over the default light theme every time the panel opens.
ctx.storage.get(THEME_KEY, "light").then(applyTheme);

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
    btn.textContent = tab.label;
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

renderTabBar();
activate(TABS.find((t) => t.enabled).id);

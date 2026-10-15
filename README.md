# Lingua (Chrome extension)

Translate the page you're reading, or just the phrase you highlight, in a side panel that stays open while you browse.

Status: **Alpha v0.1**. Only the Translate tab is built. See [RELEASE_NOTES.md](RELEASE_NOTES.md) for install and usage instructions.

## Run it locally

1. `chrome://extensions` → turn on **Developer mode**
2. **Load unpacked** → select this folder
3. After editing code, click the reload icon on the Lingua card. Close and reopen the side panel to see UI changes.

No build step, no dependencies. Plain JavaScript (ES modules), HTML, and CSS.

## How it's organized

```
manifest.json            MV3 manifest (side panel, content script, permissions)
background.js            Opens the side panel when the toolbar icon is clicked
content/content.js       Runs in web pages: reports highlighted text, returns page text
core/                    Shared code. No UI, usable by every tab
  config.js              Feedback URL, character limits, version label
  context.js             The toolbox handed to every tab
  tab-bridge.js          All chrome.tabs / messaging logic lives here
  languages.js           Language list
  storage.js             chrome.storage wrapper
  translation/           Translation engine
    index.js             translate(): chunking, concurrency, provider fallback
    text-splitter.js
    providers/           google-free.js, mymemory.js
sidepanel/
  index.html, sidepanel.js, sidepanel.css   Shell: tab bar + lazy tab loader
  tabs/registry.js       The list of tabs
  tabs/translate/        The Translate tab (UI + state)
```

## Adding a tab

1. Create a module under `sidepanel/tabs/` that default-exports:
   ```js
   export default {
     async mount(root, ctx) {
       root.innerHTML = "...";
       // ctx.bridge   → active tab, highlighted text (watchSelection), page text
       // ctx.storage  → chrome.storage wrapper (use your own key prefix)
       // ctx.languages, ctx.translator, ctx.config
       return { activate() {}, deactivate() {} };
     },
   };
   ```
2. Add an entry for the tab in `sidepanel/tabs/registry.js` with its `id`, `label`, and `load: () => import(...)`.

That's the whole change. The shell, tab bar, selection events, and storage are already shared.

## Swapping the translation provider

Add a file in `core/translation/providers/` that exports `{ id, label, maxChunk, translate({ text, from, to, signal }) }` returning `{ text, detectedFrom }`, then put it first in `PROVIDERS` in `core/translation/index.js`. Google Cloud Translation or DeepL need an API key, so keep keys out of the repo.

## Before you share it

Set `FEEDBACK_URL` in `core/config.js` to your real feedback form.

// The shared toolbox handed to every tab: tab access, selection events, storage, languages,
// and translation.
import * as bridge from "./tab-bridge.js";
import * as storage from "./storage.js";
import * as languages from "./languages.js";
import * as config from "./config.js";
import { translate } from "./translation/index.js";
import { detectLanguageDetails } from "./translation/chrome.js";
import { lookupDefinition, lookupTypedDefinition } from "./definition/index.js";
import { lookupPronunciation } from "./pronunciation/index.js";
import { bestVoice, speakText, speakChunks, stopSpeech } from "./pronunciation/speech.js";
import { createI18n } from "./i18n.js";

export async function createContext() {
  const sidepanelSelection = {
    text: "",
    set(text) { this.text = String(text || "").trim(); },
    get() { return this.text; },
    take() { const text = this.text; this.text = ""; return text; },
  };
  return {
    bridge, storage, languages, config,
    translator: { translate, detectLanguageDetails },
    dictionary: { lookupDefinition, lookupTypedDefinition },
    pronunciation: { lookupPronunciation, bestVoice, speakText, speakChunks, stopSpeech },
    sidepanelSelection,
    i18n: await createI18n(),
  };
}

// The shared toolbox handed to every tab: tab access, selection events, storage, languages,
// and translation.
import * as bridge from "./tab-bridge.js";
import * as storage from "./storage.js";
import * as languages from "./languages.js";
import * as config from "./config.js";
import { translate } from "./translation/index.js";
import { detectLanguageDetails, prepareChromeTranslator, chromeTranslatorAvailability } from "./translation/chrome.js";
import { lookupDefinition, lookupTypedDefinition, preferredAccentedWordDefinition } from "./definition/index.js";
import { lookupPronunciation } from "./pronunciation/index.js";
import { bestVoice, speakText, speakChunks, stopSpeech } from "./pronunciation/speech.js";
import { createI18n } from "./i18n.js";
import * as learn from "./learn-storage.js";

export async function createContext() {
  const sidepanelSelection = {
    text: "",
    definitionRestore: null,
    set(text) { this.text = String(text || "").trim(); },
    get() { return this.text; },
    take() { const text = this.text; this.text = ""; return text; },
    setDefinitionRestore(value) { this.definitionRestore = value || null; },
    takeDefinitionRestore() { const value = this.definitionRestore; this.definitionRestore = null; return value; },
  };
  return {
    bridge, storage, languages, config, learn,
    translator: { translate, detectLanguageDetails, prepareChromeTranslator, chromeTranslatorAvailability },
    dictionary: { lookupDefinition, lookupTypedDefinition, preferredAccentedWordDefinition },
    pronunciation: { lookupPronunciation, bestVoice, speakText, speakChunks, stopSpeech },
    sidepanelSelection,
    i18n: await createI18n(),
  };
}

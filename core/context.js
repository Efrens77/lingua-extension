// The shared toolbox handed to every tab: tab access, selection events, storage, languages,
// and translation.
import * as bridge from "./tab-bridge.js";
import * as storage from "./storage.js";
import * as languages from "./languages.js";
import * as config from "./config.js";
import { translate } from "./translation/index.js";

export function createContext() {
  return { bridge, storage, languages, config, translator: { translate } };
}

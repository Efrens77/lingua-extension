import { lookupDefinition } from "../definition/index.js";
import { wiktionary } from "../definition/providers/wiktionary.js";

const cache = new Map();
const inflight = new Map();

function key(word, sourceLanguage) { return sourceLanguage + "\u0001" + word; }

// A provider boundary lets the Pronounce tab change data sources later without
// coupling UI code to Wiktionary or browser speech synthesis.
async function lookup({ word, sourceLanguage }) {
  let definition = null;
  try {
    definition = await lookupDefinition({ word, sourceLanguage });
  } catch (error) {
    // Audio can still be useful when the dictionary's phonetic lookup fails.
    console.warn("[Lingua] pronunciation phonetic lookup failed:", error);
  }
  let audio = null;
  try {
    audio = await wiktionary.lookupAudio({ word, sourceLanguage });
  } catch (error) {
    if (error?.rateLimited) throw error;
    console.warn("[Lingua] Wiktionary audio lookup failed:", error);
  }
  return {
    word,
    sourceLanguage,
    phonetic: definition?.phonetic || "",
    audio,
    // Current providers do not supply dependable universal syllables, stress,
    // or teaching tips. The UI deliberately hides those sections instead.
    syllables: [],
    tip: "",
    attributions: audio ? [{
      name: audio.name,
      url: audio.sourceUrl,
      license: audio.license,
      licenseUrl: audio.licenseUrl,
      author: audio.author,
    }] : [],
  };
}

export function lookupPronunciation(request) {
  const cacheKey = key(request.word, request.sourceLanguage);
  if (cache.has(cacheKey)) return Promise.resolve({ ...cache.get(cacheKey), word: request.word });
  if (inflight.has(cacheKey)) return inflight.get(cacheKey).then((result) => ({ ...result, word: request.word }));
  const pending = lookup(request).then((result) => {
    cache.set(cacheKey, result);
    return result;
  }).finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, pending);
  return pending.then((result) => ({ ...result, word: request.word }));
}

import { freeDictionary } from "./providers/free-dictionary.js";
import { wiktionary } from "./providers/wiktionary.js";

// A provider boundary keeps the Definition UI independent from its data source.
export const PROVIDERS = { english: [freeDictionary, wiktionary], multilingual: [wiktionary] };
const cache = new Map();
const inflight = new Map();

function normalizedWord(word, sourceLanguage) {
  let lower = word;
  try { lower = word.toLocaleLowerCase(sourceLanguage || undefined); }
  catch { lower = word.toLowerCase(); }
  return lower;
}

function lookupVariants(word, sourceLanguage) {
  return [...new Set([word, normalizedWord(word, sourceLanguage)])];
}

function cacheKey(word, sourceLanguage) {
  return sourceLanguage + "\u0001" + word;
}

function usable(result) {
  return Boolean(result?.entries?.some((entry) => entry.senses?.length));
}

function comparable(value) {
  return String(value || "").normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "").toLocaleLowerCase();
}

// Some multilingual Wiktionary entries are only a self-reference or a
// one-word translation gloss (for example, "oso → bear"). Keep usable()
// permissive for provider selection, but let the UI request a stronger
// fallback when no sense explains the word in useful detail.
export function hasWeakDefinitions(result, word = result?.word) {
  const headword = comparable(word);
  const senses = (result?.entries || []).flatMap((entry) => entry.senses || []);
  if (!senses.length) return true;
  return !senses.some((sense) => {
    const definition = String(sense?.definition || "").trim();
    const compact = comparable(definition);
    const words = definition.match(/[\p{L}\p{N}]+/gu) || [];
    if (!compact || compact === headword) return false;
    // A concise native gloss is useful, but it does not provide the fuller
    // dictionary explanation expected in Define. Let the English fallback
    // improve one- and two-word glosses while retaining richer native senses.
    return words.length >= 3 || definition.length >= 28;
  });
}

function hasDiacritics(word) {
  return String(word || "").normalize("NFD") !== String(word || "").normalize("NFD").replace(/\p{M}/gu, "");
}

function hasStrongStructuredEnglishDefinition(result, word) {
  return result?.provider === freeDictionary.id && !hasWeakDefinitions(result, word);
}

// Single-word detection can classify accented foreign words as English. Do not
// ban accented English loanwords: retain English when Free Dictionary has a
// substantive result (for example, "café"). Otherwise, prefer the first
// validated non-English Wiktionary language section for the exact word.
export async function preferredAccentedWordDefinition({ word, englishResult }) {
  if (!hasDiacritics(word) || hasStrongStructuredEnglishDefinition(englishResult, word)) return null;
  const languages = await wiktionary.findLanguages({ word });
  for (const sourceLanguage of languages) {
    if (sourceLanguage === "en") continue;
    const result = await lookupDefinition({ word, sourceLanguage });
    if (!result.notFound) return { sourceLanguage, result };
  }
  return null;
}

function complete(result) {
  return usable(result) && Boolean(result.phonetic)
    && result.entries.some((entry) => entry.senses?.some((sense) => sense.example));
}

function mergeEnglish(primary, fallback) {
  if (!usable(primary)) return fallback;
  if (!usable(fallback)) return primary;
  const fallbackByPart = new Map(fallback.entries.map((entry) => [entry.partOfSpeech, entry]));
  const entries = primary.entries.map((entry) => {
    const additional = fallbackByPart.get(entry.partOfSpeech);
    return {
      ...entry,
      senses: entry.senses.map((sense, index) => ({
        ...sense,
        example: sense.example || additional?.senses?.[index]?.example || "",
      })),
    };
  });
  for (const entry of fallback.entries) {
    if (!entries.some((item) => item.partOfSpeech === entry.partOfSpeech)) entries.push(entry);
  }
  return {
    ...primary,
    phonetic: primary.phonetic || fallback.phonetic,
    entries,
    synonyms: primary.synonyms?.length ? primary.synonyms : fallback.synonyms || [],
    attributions: [...(primary.attributions || []), ...(fallback.attributions || [])],
  };
}

async function requestProvider(provider, variants, request, errors) {
  for (const [index, word] of variants.entries()) {
    try {
      // A case variant must always receive its own exact-case attempt first.
      // Only its lowercase fallback may reuse a prior successful lookup.
      if (index > 0) {
        const cached = cache.get(cacheKey(word, request.sourceLanguage));
        if (usable(cached)) return { ...cached, word, lookupWord: word };
      }
      const result = await provider.lookup({ ...request, word });
      if (usable(result)) return { ...result, provider: provider.id, lookupWord: word };
    } catch (error) {
      errors.push(error);
    }
  }
  return null;
}

async function lookup(request) {
  const variants = lookupVariants(request.word, request.sourceLanguage);
  const errors = [];
  if (request.sourceLanguage === "en") {
    const free = await requestProvider(freeDictionary, variants, request, errors);
    if (complete(free)) return free;
    const wiki = await requestProvider(wiktionary, variants, request, errors);
    const result = mergeEnglish(free, wiki);
    if (usable(result)) return result;
  } else {
    const result = await requestProvider(wiktionary, variants, request, errors);
    if (usable(result)) return result;
  }
  if (errors.some((error) => error?.rateLimited)) {
    const error = new Error("Dictionary service limit reached.");
    error.rateLimited = true;
    throw error;
  }
  return {
    word: request.word,
    sourceLanguage: request.sourceLanguage,
    phonetic: "",
    entries: [],
    attributions: [],
    notFound: true,
  };
}

export function lookupDefinition(request) {
  const key = cacheKey(request.word, request.sourceLanguage);
  const normalizedKey = cacheKey(normalizedWord(request.word, request.sourceLanguage), request.sourceLanguage);
  if (cache.has(key)) return Promise.resolve({ ...cache.get(key), word: request.word });
  if (inflight.has(key)) return inflight.get(key).then((result) => ({ ...result, word: request.word }));
  const pending = lookup(request).then((result) => {
    if (!result.notFound) {
      cache.set(key, result);
      if (result.lookupWord !== request.word) cache.set(normalizedKey, result);
    }
    return result;
  }).finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return pending.then((result) => ({ ...result, word: request.word }));
}

// Typed words do not have a page language to anchor detection. Probe English first,
// then let Wiktionary identify whether exactly one language section has usable data.
export async function lookupTypedDefinition({ word }) {
  let englishResult = null;
  let englishError = null;
  try {
    englishResult = await lookupDefinition({ word, sourceLanguage: "en" });
    if (!englishResult.notFound) return englishResult;
  } catch (error) {
    englishError = error;
  }
  try {
    const languages = await wiktionary.findLanguages({ word });
    if (languages.length === 1) return lookupDefinition({ word, sourceLanguage: languages[0] });
    if (languages.length > 1) return { word, ambiguous: true, languages };
  } catch (error) {
    if (error?.rateLimited || englishError?.rateLimited) {
      const rateError = new Error("Dictionary service limit reached.");
      rateError.rateLimited = true;
      throw rateError;
    }
    throw error;
  }
  if (englishError?.rateLimited) throw englishError;
  return englishResult || {
    word, sourceLanguage: "", phonetic: "", entries: [], attributions: [], notFound: true,
  };
}

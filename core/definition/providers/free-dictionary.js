// Structured, no-key English dictionary provider. It is deliberately only used
// after the language detector has identified English.
const ENDPOINT = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const MAX_ATTEMPTS = 3;

function rateLimitError() {
  const error = new Error("Free Dictionary API is temporarily busy.");
  error.name = "RateLimitError";
  error.rateLimited = true;
  return error;
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function retryDelay(header, attempt) {
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30000);
  const date = Date.parse(header || "");
  if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), 30000);
  return Math.min(1000 * (2 ** attempt), 8000);
}

function normalizeEntry(data, word) {
  const records = Array.isArray(data) ? data : [];
  const meaningful = (value) => /[\p{L}\p{N}]/u.test(String(value || ""));
  const lookupWord = (value) => /^[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*$/u.test(value);
  const synonyms = (values, selectedWord) => [...new Map((values || [])
    .map((value) => String(value || "").trim())
    .filter((value) => meaningful(value) && lookupWord(value)
      && value.toLocaleLowerCase() !== String(selectedWord).toLocaleLowerCase())
    .map((value) => [value.toLocaleLowerCase(), value])).values()];
  const phonetic = records.map((entry) => entry.phonetic)
    .concat(records.flatMap((entry) => entry.phonetics || []).map((item) => item.text))
    .find((text) => typeof text === "string" && text.trim()) || "";
  const partOfSpeech = (value) => ({
    exclamation: "interjection", "proper noun": "properNoun",
  })[String(value || "").toLowerCase()] || String(value || "").toLowerCase() || "notAvailable";
  const meanings = records.flatMap((record) => record.meanings || []);
  const entries = meanings.map((meaning) => ({
    partOfSpeech: partOfSpeech(meaning.partOfSpeech),
    senses: (meaning.definitions || []).flatMap((item) => {
      const definition = String(item.definition || "").trim();
      if (!meaningful(definition)) return [];
      // Free Dictionary supplies an example inside its matching definition object.
      return [{ definition, example: meaningful(String(item.example || "")) ? item.example.trim() : "" }];
    }),
  })).filter((entry) => entry.senses.length);
  return {
    word,
    sourceLanguage: "en",
    phonetic,
    entries,
    synonyms: synonyms(meanings.flatMap((meaning) => meaning.synonyms || []), word),
    attributions: [{ name: "Free Dictionary API", url: "https://dictionaryapi.dev/" }],
  };
}

export const freeDictionary = {
  id: "free-dictionary",
  label: "Free Dictionary API",
  async lookup({ word }) {
    const url = ENDPOINT + encodeURIComponent(word);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const response = await fetch(url);
      if (response.status === 404) {
        return { word, sourceLanguage: "en", phonetic: "", entries: [], attributions: [] };
      }
      if (response.status === 429) {
        if (attempt === MAX_ATTEMPTS - 1) throw rateLimitError();
        await wait(retryDelay(response.headers.get("Retry-After"), attempt));
        continue;
      }
      if (!response.ok) throw new Error("Free Dictionary API answered " + response.status);
      return normalizeEntry(await response.json(), word);
    }
    throw rateLimitError();
  },
};

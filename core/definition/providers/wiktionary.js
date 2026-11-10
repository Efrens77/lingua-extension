// Official MediaWiki Action API provider for English Wiktionary. The API returns
// JSON entry source; Wiktionary has no universal structured lexical-data endpoint.
import { LANGUAGES } from "../../languages.js";

const ENDPOINT = "https://en.wiktionary.org/w/api.php";
const cache = new Map();
const sourcePages = new Map();
const searchCache = new Map();
const mediaCache = new Map();
const MAX_ATTEMPTS = 3;

function rateLimitError() {
  const error = new Error("Wiktionary is temporarily busy.");
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}

function languageHeading(code) {
  const wiktionaryNames = { tl: "Tagalog", "zh-Hant": "Chinese", zh: "Chinese", no: "Norwegian" };
  if (String(code).startsWith("zh-")) return "Chinese";
  if (wiktionaryNames[code]) return wiktionaryNames[code];
  try { return new Intl.DisplayNames(["en"], { type: "language" }).of(code); }
  catch { return code; }
}

function languageSection(source, sourceLanguage) {
  const heading = languageHeading(sourceLanguage);
  if (!heading) return "";
  const match = new RegExp("^==\\s*" + escapeRegExp(heading) + "\\s*==\\s*$", "mi").exec(source);
  if (!match) return "";
  const start = match.index + match[0].length;
  const remainder = source.slice(start);
  const next = remainder.search(/^==[^=].*?==\s*$/m);
  return next < 0 ? remainder : remainder.slice(0, next);
}

function plain(text) {
  return String(text || "")
    .replace(/<!--([\s\S]*?)-->/g, "")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/'{2,}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningful(text) {
  return /[\p{L}\p{N}]/u.test(text);
}

function comparable(text) {
  return String(text || "").normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "").toLocaleLowerCase();
}

function weakEntries(entries, selectedWord) {
  const headword = comparable(selectedWord);
  const senses = entries.flatMap((entry) => entry.senses || []);
  if (!senses.length) return true;
  return !senses.some((sense) => {
    const definition = String(sense.definition || "").trim();
    const compact = comparable(definition);
    const words = definition.match(/[\p{L}\p{N}]+/gu) || [];
    return Boolean(compact && compact !== headword && (words.length >= 3 || definition.length >= 28));
  });
}

function findPhonetic(section, sourceLanguage) {
  const code = escapeRegExp(sourceLanguage);
  const ipa = new RegExp("\\{\\{IPA\\|" + code + "\\|([^|}]+)", "i").exec(section)
    || /\{\{IPA\|[^|}]+\|([^|}]+)/i.exec(section);
  return ipa ? plain(ipa[1]).replace(/^\/+|\/+$/g, "") : "";
}

const POS = new Map([
  ["noun", "noun"], ["proper noun", "properNoun"], ["verb", "verb"], ["adjective", "adjective"],
  ["adverb", "adverb"], ["pronoun", "pronoun"], ["determiner", "determiner"], ["article", "article"],
  ["preposition", "preposition"], ["conjunction", "conjunction"], ["interjection", "interjection"],
  ["particle", "particle"], ["numeral", "numeral"],
]);

function parseExample(line) {
  const ux = /\{\{(?:ux|usex)\|[^|}]+\|([^|}]+)/i.exec(line);
  const example = plain(ux?.[1] || line.replace(/^#:\s*/, ""));
  return meaningful(example) ? example : "";
}

function cleanSynonym(value, selectedWord) {
  const text = plain(String(value || "")
    .replace(/\{\{(?:l|m|link)\|[^|}]+\|([^|}]+)(?:\|[^}]*)?\}\}/gi, "$1"));
  const lookupWord = /^[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*$/u.test(text);
  if (!meaningful(text) || !lookupWord || text.toLocaleLowerCase() === String(selectedWord).toLocaleLowerCase()) return "";
  return text;
}

function uniqueSynonyms(values, selectedWord) {
  const seen = new Set();
  return values.map((value) => cleanSynonym(value, selectedWord)).filter((value) => {
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function wikitextSynonyms(body, selectedWord) {
  const synonymHeadings = [...body.matchAll(/^====+\s*Synonyms\s*====+\s*$/gmi)];
  const values = [];
  for (let index = 0; index < synonymHeadings.length; index++) {
    const start = synonymHeadings[index].index + synonymHeadings[index][0].length;
    const next = body.slice(start).search(/^===+\s*[^=]+?\s*===+\s*$/m);
    const section = next < 0 ? body.slice(start) : body.slice(start, start + next);
    for (const line of section.split("\n")) {
      if (!/^\*+\s*/.test(line)) continue;
      const synTemplate = /\{\{syn\|[^|}]+\|([^}]+)\}\}/gi;
      let match;
      while ((match = synTemplate.exec(line))) values.push(...match[1].split("|").filter((value) => !/=/.test(value)));
      values.push(
        ...[...line.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map((match) => match[1]),
        ...[...line.matchAll(/\{\{(?:l|m|link)\|[^|}]+\|([^|}]+)/gi)].map((match) => match[1]),
      );
    }
  }
  return uniqueSynonyms(values, selectedWord);
}

function definitionText(node) {
  const copy = node.cloneNode(true);
  copy.querySelectorAll("ol,ul,dl,.mw-ref,style,script").forEach((child) => child.remove());
  const text = plain(copy.textContent);
  return meaningful(text) ? text : "";
}

function htmlEntries(renderedHtml, sourceLanguage, selectedWord) {
  if (!renderedHtml || typeof DOMParser === "undefined") return [];
  const document = new DOMParser().parseFromString(renderedHtml, "text/html");
  const language = languageHeading(sourceLanguage);
  const headingText = (node) => plain(node.querySelector(".mw-headline")?.textContent || node.textContent);
  const languageHeadingNode = [...document.querySelectorAll("h2")]
    .find((node) => headingText(node) === language);
  if (!languageHeadingNode) return [];

  const out = [];
  const headingLevel = (node) => /^H[2-6]$/.test(node?.tagName || "") ? Number(node.tagName.slice(1)) : 0;
  let node = languageHeadingNode.nextElementSibling;
  while (node && node.tagName !== "H2") {
    const level = headingLevel(node);
    const partOfSpeech = level ? POS.get(headingText(node).toLowerCase()) : null;
    if (!partOfSpeech) {
      node = node.nextElementSibling;
      continue;
    }
    const senses = [];
    const synonyms = [];
    node = node.nextElementSibling;
    while (node && (!headingLevel(node) || headingLevel(node) > level)) {
      if (node.tagName === "OL") {
        for (const item of node.querySelectorAll(":scope > li")) {
          const definition = definitionText(item);
          if (definition) senses.push({ definition, example: "" });
          for (const subSense of item.querySelectorAll(":scope > ol > li")) {
            const nested = definitionText(subSense);
            if (nested) senses.push({ definition: nested, example: "" });
          }
        }
      } else if (node.tagName === "H4" && headingText(node).toLowerCase() === "synonyms") {
        let synonymNode = node.nextElementSibling;
        while (synonymNode && !/^H[234]$/.test(synonymNode.tagName)) {
          if (/^(UL|OL)$/.test(synonymNode.tagName)) {
            for (const item of synonymNode.querySelectorAll(":scope > li")) synonyms.push(definitionText(item));
          }
          synonymNode = synonymNode.nextElementSibling;
        }
      }
      node = node.nextElementSibling;
    }
    if (senses.length) out.push({ partOfSpeech, senses, synonyms: uniqueSynonyms(synonyms, selectedWord) });
  }
  return out;
}

function entriesForLanguage(source, sourceLanguage, selectedWord) {
  const section = languageSection(source.wikitext, sourceLanguage);
  const extracted = extractWikitextEntries(section, selectedWord);
  // Keep language discovery and lookup consistent. Some language sections
  // express their sense entirely through templates, which only the rendered
  // HTML expands into readable definition text.
  const rendered = weakEntries(extracted, selectedWord)
    ? htmlEntries(source.html, sourceLanguage, selectedWord) : [];
  return rendered.length ? rendered : extracted;
}

export function extractWikitextEntries(section, selectedWord = "") {
  const out = [];
  // Some entries place a part of speech below an Etymology heading, making it
  // level four or deeper. Stop at the next heading at the same or higher level
  // so nested Synonyms/Usage notes stay with their owning part of speech.
  const headings = [...section.matchAll(/^(={3,6})\s*([^=]+?)\s*\1\s*$/gmi)]
    .map((match) => ({ match, level: match[1].length, title: match[2] }));
  for (let index = 0; index < headings.length; index++) {
    const partOfSpeech = POS.get(plain(headings[index].title).toLowerCase());
    if (!partOfSpeech) continue;
    const next = headings.slice(index + 1).find((heading) => heading.level <= headings[index].level);
    const body = section.slice(
      headings[index].match.index + headings[index].match[0].length,
      next?.match.index,
    );
    const senses = [];
    const synonyms = wikitextSynonyms(body, selectedWord);
    let lastSense = -1;
    for (const line of body.split("\n")) {
      const sense = /^(#+)\s+(.*)$/.exec(line);
      if (sense) {
        const definition = plain(sense[2]);
        if (meaningful(definition)) {
          senses.push({ definition, example: "" });
          lastSense = senses.length - 1;
        } else {
          lastSense = -1;
        }
      } else if (lastSense >= 0 && /^#:\s*/.test(line)) {
        // A #:-line immediately follows the Wiktionary sense it illustrates.
        // Keep that association rather than making it a general entry example.
        const example = parseExample(line);
        if (example && !senses[lastSense].example) senses[lastSense].example = example;
      } else if (line.trim()) {
        // Do not guess an association after unrelated notes or subsections.
        lastSense = -1;
      }
    }
    if (senses.length) out.push({ partOfSpeech, senses, synonyms });
  }
  return out;
}

async function request(word) {
  if (sourcePages.has(word)) return sourcePages.get(word);
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    action: "parse", page: word, prop: "wikitext|text", format: "json", formatversion: "2", origin: "*",
  });
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url);
    if (response.status === 429) {
      if (attempt === MAX_ATTEMPTS - 1) throw rateLimitError();
      await wait(retryDelay(response.headers.get("Retry-After"), attempt));
      continue;
    }
    if (!response.ok) throw new Error("Wiktionary answered " + response.status);
    const data = await response.json();
    const source = {
      wikitext: data?.parse?.wikitext || "",
      html: typeof data?.parse?.text === "string" ? data.parse.text : data?.parse?.text?.["*"] || "",
    };
    sourcePages.set(word, source);
    return source;
  }
  throw rateLimitError();
}

function dictionaryWord(value) {
  return /^[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*$/u.test(String(value || "").trim());
}

function editDistanceAtMostOne(left, right) {
  if (Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let changes = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex++; rightIndex++;
      continue;
    }
    if (++changes > 1) return false;
    if (left.length > right.length) leftIndex++;
    else if (right.length > left.length) rightIndex++;
    else { leftIndex++; rightIndex++; }
  }
  return true;
}

function safeCorrection(requested, candidate) {
  const requestedComparable = comparable(requested);
  const candidateComparable = comparable(candidate);
  if (!requestedComparable || !candidateComparable || !dictionaryWord(candidate)) return false;
  // Accents do not change the underlying letters, so this is a safe recovery
  // for entries such as "tio" → "tío".
  if (requestedComparable === candidateComparable) return true;
  // A single edit is intentionally conservative. It catches simple typos
  // without silently substituting a semantically unrelated word.
  return requestedComparable.length >= 4
    && candidateComparable.length >= 4
    && editDistanceAtMostOne(requestedComparable, candidateComparable);
}

async function searchCandidates(word) {
  const key = String(word || "").toLocaleLowerCase();
  if (searchCache.has(key)) return searchCache.get(key);
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    action: "query", list: "search", srsearch: word, srnamespace: "0", srlimit: "12",
    format: "json", formatversion: "2", origin: "*",
  });
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url);
    if (response.status === 429) {
      if (attempt === MAX_ATTEMPTS - 1) throw rateLimitError();
      await wait(retryDelay(response.headers.get("Retry-After"), attempt));
      continue;
    }
    if (!response.ok) throw new Error("Wiktionary search answered " + response.status);
    const candidates = (await response.json())?.query?.search
      ?.map((item) => String(item?.title || "").trim())
      .filter((candidate) => safeCorrection(word, candidate)) || [];
    const unique = [...new Set(candidates)];
    searchCache.set(key, unique);
    return unique;
  }
  throw rateLimitError();
}

async function sourceForLanguage(word, sourceLanguage) {
  const direct = await request(word);
  const directEntries = entriesForLanguage(direct, sourceLanguage, word);
  if (directEntries.length) return { source: direct, matchedWord: word, entries: directEntries };

  for (const candidate of await searchCandidates(word)) {
    if (candidate === word) continue;
    const source = await request(candidate);
    const entries = entriesForLanguage(source, sourceLanguage, candidate);
    if (entries.length) return { source, matchedWord: candidate, entries };
  }
  return { source: direct, matchedWord: word, entries: directEntries };
}

function lemmaFromSection(section, sourceLanguage) {
  const sourceCode = String(sourceLanguage || "").toLocaleLowerCase().split("-")[0];
  const templates = section.matchAll(/\{\{(?:plural of|singular of|inflection of)\|([^{}]+)\}\}/gi);
  for (const template of templates) {
    const values = template[1].split("|").map((value) => value.trim());
    const languageIndex = values.findIndex((value) => value.toLocaleLowerCase().split("-")[0] === sourceCode);
    const candidate = values[languageIndex + 1] || "";
    if (dictionaryWord(candidate)) return candidate;
  }
  return "";
}

function matchingAudioFile(section, sourceLanguage) {
  const primary = String(sourceLanguage || "").toLowerCase().split("-")[0];
  for (const match of section.matchAll(/\{\{audio\|([^|}]+)\|([^|}]+)/gi)) {
    const language = match[1].trim().toLowerCase().split("-")[0];
    const file = match[2].trim();
    if (language === primary && /\.(?:ogg|oga|mp3|wav)$/i.test(file)) return file;
  }
  return "";
}

async function audioFile(fileName) {
  if (!fileName) return null;
  if (mediaCache.has(fileName)) return mediaCache.get(fileName);
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    action: "query", titles: "File:" + fileName, prop: "imageinfo",
    iiprop: "url|extmetadata", format: "json", formatversion: "2", origin: "*",
  });
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url);
    if (response.status === 429) {
      if (attempt === MAX_ATTEMPTS - 1) throw rateLimitError();
      await wait(retryDelay(response.headers.get("Retry-After"), attempt));
      continue;
    }
    if (!response.ok) throw new Error("Wikimedia audio lookup answered " + response.status);
    const image = (await response.json())?.query?.pages?.[0]?.imageinfo?.[0];
    if (!image?.url) return null;
    const metadata = image.extmetadata || {};
    const audio = {
      url: image.url,
      name: "Wiktionary",
      sourceUrl: "https://en.wiktionary.org/wiki/File:" + encodeURIComponent(fileName),
      license: metadata.LicenseShortName?.value || "Wikimedia Commons",
      licenseUrl: metadata.LicenseUrl?.value || "",
      author: plain(metadata.Artist?.value || ""),
    };
    mediaCache.set(fileName, audio);
    return audio;
  }
  throw rateLimitError();
}

function codeForHeading(heading) {
  const special = { Tagalog: "tl", Chinese: "zh-CN", Norwegian: "no" };
  if (special[heading]) return special[heading];
  for (const language of LANGUAGES) {
    try {
      if (new Intl.DisplayNames(["en"], { type: "language" }).of(language.code) === heading) {
        return language.code;
      }
    } catch {
      // A missing Intl implementation simply means this entry cannot be auto-selected.
    }
  }
  return null;
}

export const wiktionary = {
  id: "wiktionary",
  label: "Wiktionary",
  async lookup({ word, sourceLanguage }) {
    const key = sourceLanguage + "\u0001" + word;
    if (cache.has(key)) return cache.get(key);
    const matched = await sourceForLanguage(word, sourceLanguage);
    let source = matched.source;
    let matchedWord = matched.matchedWord;
    let section = languageSection(source.wikitext, sourceLanguage);
    let entriesWithSynonyms = matched.entries;
    let lemma = lemmaFromSection(section, sourceLanguage);

    // Inflected forms often have only a "plural of"/"inflection of" note.
    // Follow that reliable Wiktionary relation so the user receives the
    // complete definition of the singular/lemma rather than a thin form note.
    if (lemma && comparable(lemma) !== comparable(matchedWord)) {
      const lemmaMatch = await sourceForLanguage(lemma, sourceLanguage);
      if (lemmaMatch.entries.length) {
        source = lemmaMatch.source;
        matchedWord = lemmaMatch.matchedWord;
        section = languageSection(source.wikitext, sourceLanguage);
        entriesWithSynonyms = lemmaMatch.entries;
        lemma = lemmaMatch.matchedWord;
      }
    }
    const result = {
      word,
      sourceLanguage,
      phonetic: findPhonetic(section, sourceLanguage),
      entries: entriesWithSynonyms.map(({ synonyms, ...entry }) => entry),
      synonyms: uniqueSynonyms(entriesWithSynonyms.flatMap((entry) => entry.synonyms || []), word),
      canonicalWord: matchedWord,
      inflectionOf: lemma || "",
      attributions: [{
        name: "Wiktionary",
        url: "https://en.wiktionary.org/wiki/" + encodeURIComponent(matchedWord),
        license: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      }],
    };
    cache.set(key, result);
    return result;
  },
  async lookupAudio({ word, sourceLanguage }) {
    const source = await request(word);
    return audioFile(matchingAudioFile(languageSection(source.wikitext, sourceLanguage), sourceLanguage));
  },
  async findLanguages({ word }) {
    const variants = [...new Set([word, word.toLocaleLowerCase()])];
    for (const candidate of variants) {
      const source = await request(candidate);
      const headings = [...source.wikitext.matchAll(/^==\s*([^=]+?)\s*==\s*$/gmi)]
        .map((match) => match[1].trim());
      const languages = [];
      for (const heading of headings) {
        const code = codeForHeading(heading);
        if (!code || languages.includes(code)) continue;
        if (entriesForLanguage(source, code, candidate).length) languages.push(code);
      }
      if (languages.length) return languages;
    }
    for (const candidate of await searchCandidates(word)) {
      const source = await request(candidate);
      const headings = [...source.wikitext.matchAll(/^==\s*([^=]+?)\s*==\s*$/gmi)]
        .map((match) => match[1].trim());
      const languages = [];
      for (const heading of headings) {
        const code = codeForHeading(heading);
        if (!code || languages.includes(code)) continue;
        if (entriesForLanguage(source, code, candidate).length) languages.push(code);
      }
      if (languages.length) return languages;
    }
    return [];
  },
};

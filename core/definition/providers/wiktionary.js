// Official MediaWiki Action API provider for English Wiktionary. The API returns
// JSON entry source; Wiktionary has no universal structured lexical-data endpoint.
import { LANGUAGES } from "../../languages.js";

const ENDPOINT = "https://en.wiktionary.org/w/api.php";
const cache = new Map();
const sourcePages = new Map();
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

function definitionText(node) {
  const copy = node.cloneNode(true);
  copy.querySelectorAll("ol,ul,dl,.mw-ref,style,script").forEach((child) => child.remove());
  const text = plain(copy.textContent);
  return meaningful(text) ? text : "";
}

function htmlEntries(renderedHtml, sourceLanguage) {
  if (!renderedHtml || typeof DOMParser === "undefined") return [];
  const document = new DOMParser().parseFromString(renderedHtml, "text/html");
  const language = languageHeading(sourceLanguage);
  const headingText = (node) => plain(node.querySelector(".mw-headline")?.textContent || node.textContent);
  const languageHeadingNode = [...document.querySelectorAll("h2")]
    .find((node) => headingText(node) === language);
  if (!languageHeadingNode) return [];

  const out = [];
  let node = languageHeadingNode.nextElementSibling;
  while (node && node.tagName !== "H2") {
    const partOfSpeech = node.tagName === "H3" ? POS.get(headingText(node).toLowerCase()) : null;
    if (!partOfSpeech) {
      node = node.nextElementSibling;
      continue;
    }
    const definitions = [];
    let example = "";
    node = node.nextElementSibling;
    while (node && node.tagName !== "H2" && node.tagName !== "H3") {
      if (node.tagName === "OL") {
        for (const item of node.querySelectorAll(":scope > li")) {
          const definition = definitionText(item);
          if (definition) definitions.push(definition);
          for (const subSense of item.querySelectorAll(":scope > ol > li")) {
            const nested = definitionText(subSense);
            if (nested) definitions.push(nested);
          }
        }
      } else if (!example && node.tagName === "DL") {
        example = definitionText(node.querySelector("dd") || node);
      }
      node = node.nextElementSibling;
    }
    if (definitions.length) out.push({ partOfSpeech, definitions, example });
  }
  return out;
}

export function extractWikitextEntries(section) {
  const out = [];
  const headings = [...section.matchAll(/^===+\s*([^=]+?)\s*===+\s*$/gmi)];
  for (let index = 0; index < headings.length; index++) {
    const partOfSpeech = POS.get(plain(headings[index][1]).toLowerCase());
    if (!partOfSpeech) continue;
    const body = section.slice(headings[index].index + headings[index][0].length, headings[index + 1]?.index);
    const definitions = [];
    let example = "";
    for (const line of body.split("\n")) {
      const sense = /^(#+)\s+(.*)$/.exec(line);
      if (sense) {
        const definition = plain(sense[2]);
        if (meaningful(definition)) definitions.push(definition);
      } else if (!example && /^#:\s*/.test(line)) {
        example = parseExample(line);
      }
    }
    if (definitions.length) out.push({ partOfSpeech, definitions, example });
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
    const source = await request(word);
    const section = languageSection(source.wikitext, sourceLanguage);
    const extracted = htmlEntries(source.html, sourceLanguage);
    const result = {
      word,
      sourceLanguage,
      phonetic: findPhonetic(section, sourceLanguage),
      entries: extracted.length ? extracted : extractWikitextEntries(section),
      attributions: [{
        name: "Wiktionary",
        url: "https://en.wiktionary.org/wiki/" + encodeURIComponent(word),
        license: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      }],
    };
    cache.set(key, result);
    return result;
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
        if (extractWikitextEntries(languageSection(source.wikitext, code)).length) languages.push(code);
      }
      if (languages.length) return languages;
    }
    return [];
  },
};

// Provider: MyMemory (free, no key, small daily quota). Used as a fallback when the primary
// provider fails. It doesn't report the detected language.
import { splitText } from "../text-splitter.js";

const ENDPOINT = "https://api.mymemory.translated.net/get";

export const myMemory = {
  id: "mymemory",
  label: "MyMemory",
  maxChunk: 450,

  async translate({ text, from, to, signal }) {
    const pair = `${from === "auto" ? "Autodetect" : from}|${to}`;
    const pieces = splitText(text, this.maxChunk);
    let out = "";
    for (const piece of pieces) {
      const params = new URLSearchParams({ q: piece.text, langpair: pair });
      const res = await fetch(`${ENDPOINT}?${params}`, { signal });
      if (!res.ok) throw new Error(`MyMemory answered ${res.status}`);
      const data = await res.json();
      if (Number(data.responseStatus) !== 200) throw new Error(data.responseDetails || "MyMemory failed");
      out += data.responseData.translatedText + piece.sep;
    }
    return { text: out.trim(), detectedFrom: null };
  },
};

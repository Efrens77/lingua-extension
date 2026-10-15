// Public translation API for the whole extension.
//   translate({ text, from, to, signal, onProgress }) -> { text, detectedFrom, provider }
// Long text is chunked, translated a few chunks at a time, and stitched back together.
import { splitText } from "./text-splitter.js";
import { googleFree } from "./providers/google-free.js";
import { myMemory } from "./providers/mymemory.js";

// Order matters: first provider is tried first, the rest are fallbacks.
export const PROVIDERS = [googleFree, myMemory];

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

async function translateChunk(chunk, opts, providers) {
  const errors = [];
  for (const provider of providers) {
    try {
      const r = await provider.translate({ ...opts, text: chunk });
      return { ...r, provider: provider.id };
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      errors.push(`${provider.label}: ${err.message}`);
    }
  }
  throw new Error(errors.join(" | "));
}

export async function translate({
  text,
  from = "auto",
  to,
  signal,
  onProgress,
  providers = PROVIDERS,
  concurrency = 3,
}) {
  const chunks = splitText(text, providers[0].maxChunk);
  const results = new Array(chunks.length);
  let detectedFrom = null;
  let provider = null;
  let done = 0;
  let next = 0;

  async function worker() {
    while (next < chunks.length) {
      if (signal?.aborted) throw abortError();
      const i = next++;
      const r = await translateChunk(chunks[i].text, { from, to, signal }, providers);
      results[i] = r.text;
      detectedFrom ??= r.detectedFrom;
      provider ??= r.provider;
      onProgress?.({ done: ++done, total: chunks.length });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));

  const joined = results.map((t, i) => t + (i < chunks.length - 1 ? chunks[i].sep : "")).join("");
  return { text: joined.trim(), detectedFrom, provider };
}

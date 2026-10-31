// Public translation API for the whole extension.
//   translate({ text, from, to, signal, onProgress }) -> { text, detectedFrom, provider }
// Long text is chunked, translated a few chunks at a time, and stitched back together.
import { splitText } from "./text-splitter.js";
import { googleFree } from "./providers/google-free.js";
import { myMemory } from "./providers/mymemory.js";
import { translateWithChrome } from "./chrome.js";

// Order matters: first provider is tried first, the rest are fallbacks.
export const PROVIDERS = [googleFree, myMemory];

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

function rateLimitError() {
  const err = new Error("Translation service limit reached. Please wait a moment and try again.");
  err.name = "RateLimitError";
  err.rateLimited = true;
  return err;
}

function retryDelay(retryAfter, attempt) {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30000);
  const date = Date.parse(retryAfter || "");
  if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), 30000);
  return Math.min(1000 * (2 ** attempt), 8000);
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(abortError());
    }, { once: true });
  });
}

async function translateChunk(chunk, opts, providers) {
  const errors = [];
  let wasRateLimited = false;
  for (const provider of providers) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await provider.translate({ ...opts, text: chunk });
        return { ...r, provider: provider.id };
      } catch (err) {
        if (err?.name === "AbortError") throw err;
        if (err?.status !== 429) {
          errors.push(`${provider.label}: ${err.message}`);
          break;
        }
        wasRateLimited = true;
        if (attempt === 2) {
          errors.push(`${provider.label}: ${err.message}`);
          break;
        }
        await wait(retryDelay(err.retryAfter, attempt), opts.signal);
      }
    }
    // Do not immediately hammer the fallback after the primary was rate-limited.
    if (wasRateLimited && provider !== providers[providers.length - 1]) await wait(1000, opts.signal);
  }
  if (wasRateLimited) throw rateLimitError();
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
  preferChrome = true,
  allowChromeDownload = false,
  onModelProgress,
}) {
  if (preferChrome) {
    const chromeResult = await translateWithChrome({
      text, from, to, allowDownload: allowChromeDownload, onDownloadProgress: onModelProgress,
    });
    if (chromeResult.ok) return chromeResult;
  }
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

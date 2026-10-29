// Provider: the free Google Translate web endpoint (no API key).
// This endpoint is unofficial, so it can change or rate-limit without notice. That's fine for an
// Alpha. To move to Google Cloud Translation or DeepL, add a sibling file with the same shape
// and put it first in PROVIDERS (core/translation/index.js). Nothing else needs to change.
const ENDPOINT = "https://translate.googleapis.com/translate_a/single";

export const googleFree = {
  id: "google-free",
  label: "Google Translate (free endpoint)",
  // Kept small because text travels in the URL query string.
  maxChunk: 600,

  /** @returns {Promise<{text: string, detectedFrom: string|null}>} */
  async translate({ text, from, to, signal }) {
    const params = new URLSearchParams({ client: "gtx", sl: from, tl: to, dt: "t", dj: "1", q: text });
    const res = await fetch(`${ENDPOINT}?${params}`, { signal });
    if (!res.ok) {
      const err = new Error(`Google Translate answered ${res.status}`);
      err.status = res.status;
      err.retryAfter = res.headers.get("Retry-After");
      throw err;
    }
    const data = await res.json();
    const translated = (data.sentences ?? []).map((s) => s.trans ?? "").join("");
    if (!translated && text.trim()) throw new Error("Google Translate returned nothing");
    return { text: translated, detectedFrom: data.src ?? null };
  },
};

// On-device Chrome Translator and Language Detector provider.
// This module is safe to import anywhere: it simply reports unavailable outside a document
// context where Chrome exposes these APIs (for example, an MV3 service worker).
const translators = new Map();
let detectorPromise = null;

export function normalizeLanguage(code) {
  const value = String(code || "").trim().replace(/_/g, "-");
  if (!value || value === "auto") return "";
  const lower = value.toLowerCase();
  if (lower === "zh-cn" || lower === "zh") return "zh";
  if (lower === "zh-tw" || lower === "zh-hant") return "zh-Hant";
  return lower.split("-")[0];
}

function apiAvailable(name) {
  return typeof globalThis[name] !== "undefined";
}

function canDownload(status, allowDownload) {
  return allowDownload && (status === "downloadable" || status === "downloading");
}

function monitor(onProgress) {
  return onProgress ? {
    monitor(m) {
      m.addEventListener("downloadprogress", (event) => onProgress(Math.round(event.loaded * 100)));
    },
  } : {};
}

function translatorOptions(from, to) {
  const sourceLanguage = normalizeLanguage(from);
  const targetLanguage = normalizeLanguage(to);
  return sourceLanguage && targetLanguage && sourceLanguage !== targetLanguage
    ? { sourceLanguage, targetLanguage } : null;
}

// The Settings download action prepares one deliberate language pair. It is
// separate from normal translation so ordinary lookups never begin a model
// download without an explicit user gesture.
export async function prepareChromeTranslator({ from, to, onProgress } = {}) {
  if (!apiAvailable("Translator")) return { ok: false, reason: "unavailable" };
  const options = translatorOptions(from, to);
  if (!options) return { ok: false, reason: "unsupported" };
  try {
    const availability = await globalThis.Translator.availability(options);
    if (!["available", "downloadable", "downloading"].includes(availability)) {
      return { ok: false, reason: availability || "unavailable" };
    }
    const key = `${options.sourceLanguage}\u0001${options.targetLanguage}`;
    if (!translators.has(key)) {
      translators.set(key, globalThis.Translator.create({ ...options, ...monitor(onProgress) }));
    }
    try {
      await translators.get(key);
    } catch (error) {
      translators.delete(key);
      throw error;
    }
    return { ok: true, status: availability };
  } catch (error) {
    console.warn("[Lingua] Chrome Translator download failed:", error);
    return { ok: false, reason: "unavailable" };
  }
}

export async function chromeTranslatorAvailability({ from, to } = {}) {
  if (!apiAvailable("Translator")) return "unavailable";
  const options = translatorOptions(from, to);
  if (!options) return "unavailable";
  try {
    return await globalThis.Translator.availability(options);
  } catch {
    return "unavailable";
  }
}

export async function detectLanguage(text, { allowDownload = false, onDownloadProgress } = {}) {
  const result = await detectLanguageDetails(text, { allowDownload, onDownloadProgress });
  return result?.code || null;
}

export async function detectLanguageDetails(text, { allowDownload = false, onDownloadProgress } = {}) {
  if (!apiAvailable("LanguageDetector") || !text?.trim()) return null;
  try {
    const status = await globalThis.LanguageDetector.availability();
    if (status !== "available" && !canDownload(status, allowDownload)) return null;
    detectorPromise ??= globalThis.LanguageDetector.create(monitor(onDownloadProgress));
    const detector = await detectorPromise;
    const [best] = await detector.detect(text);
    const code = normalizeLanguage(best?.detectedLanguage);
    return code ? { code, confidence: Number(best?.confidence) || 0 } : null;
  } catch (err) {
    console.warn("[Lingua] Chrome language detection unavailable:", err);
    return null;
  }
}

export async function translateWithChrome({ text, from, to, allowDownload = false, onDownloadProgress }) {
  if (!apiAvailable("Translator") || !text?.trim()) return { ok: false, reason: "unavailable" };
  const declaredFrom = normalizeLanguage(from);
  const detectedFrom = declaredFrom || await detectLanguage(text, { allowDownload, onDownloadProgress });
  const targetLanguage = normalizeLanguage(to);
  if (!detectedFrom || !targetLanguage || detectedFrom === targetLanguage) {
    return detectedFrom === targetLanguage
      ? { ok: true, text, detectedFrom, provider: "chrome" }
      : { ok: false, reason: "unsupported" };
  }
  const options = { sourceLanguage: detectedFrom, targetLanguage };
  const key = `${detectedFrom}\u0001${targetLanguage}`;
  // A translator explicitly prepared from Settings may still report
  // "downloadable" from availability() for privacy reasons. Reuse the
  // prepared instance before asking Chrome for availability again.
  if (translators.has(key)) {
    try {
      const translator = await translators.get(key);
      return { ok: true, text: await translator.translate(text), detectedFrom, provider: "chrome" };
    } catch {
      translators.delete(key);
    }
  }
  try {
    const availability = await globalThis.Translator.availability(options);
    if (availability !== "available" && !canDownload(availability, allowDownload)) {
      // A declared <html lang> can be stale or overly specific. Try Chrome's detector
      // before falling back to the cloud provider chain.
      if (declaredFrom) {
        const detected = await detectLanguage(text, { allowDownload, onDownloadProgress });
        if (detected && detected !== declaredFrom) {
          return translateWithChrome({ text, from: detected, to, allowDownload, onDownloadProgress });
        }
      }
      return { ok: false, reason: availability || "unavailable" };
    }
    if (!translators.has(key)) {
      translators.set(key, globalThis.Translator.create({ ...options, ...monitor(onDownloadProgress) }));
    }
    const translator = await translators.get(key);
    return { ok: true, text: await translator.translate(text), detectedFrom, provider: "chrome" };
  } catch (err) {
    console.warn("[Lingua] Chrome Translator unavailable for this pair:", err);
    return { ok: false, reason: "unsupported" };
  }
}

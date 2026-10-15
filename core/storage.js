// Thin wrapper over chrome.storage.local. Every feature stores under its own key
// prefix (e.g. "translate.prefs", later "dictionary.saved") so tabs never collide.
export async function get(key, fallback = null) {
  const out = await chrome.storage.local.get(key);
  return out[key] ?? fallback;
}

export async function set(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

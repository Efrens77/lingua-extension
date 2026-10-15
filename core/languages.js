// Language list shared by every tab. Codes are the ISO-style codes Google Translate uses.
export const AUTO_CODE = "auto";

const RAW = [
  ["af", "Afrikaans"], ["ar", "Arabic"], ["bn", "Bengali"], ["bg", "Bulgarian"],
  ["zh-CN", "Chinese (Simplified)"], ["zh-TW", "Chinese (Traditional)"], ["hr", "Croatian"],
  ["cs", "Czech"], ["da", "Danish"], ["nl", "Dutch"], ["en", "English"], ["tl", "Filipino (Tagalog)"],
  ["fi", "Finnish"], ["fr", "French"], ["de", "German"], ["el", "Greek"], ["gu", "Gujarati"],
  ["hi", "Hindi"], ["hu", "Hungarian"], ["id", "Indonesian"], ["it", "Italian"], ["ja", "Japanese"],
  ["kn", "Kannada"], ["ko", "Korean"], ["la", "Latin"], ["ms", "Malay"], ["ml", "Malayalam"],
  ["mr", "Marathi"], ["no", "Norwegian"], ["fa", "Persian"], ["pl", "Polish"], ["pt", "Portuguese"],
  ["pa", "Punjabi"], ["ro", "Romanian"], ["ru", "Russian"], ["es", "Spanish"], ["sw", "Swahili"],
  ["sv", "Swedish"], ["ta", "Tamil"], ["te", "Telugu"], ["th", "Thai"], ["tr", "Turkish"],
  ["uk", "Ukrainian"], ["ur", "Urdu"], ["vi", "Vietnamese"],
];

// Alphabetical by name so the dropdown is easy to scan.
export const LANGUAGES = RAW.map(([code, name]) => ({ code, name })).sort((a, b) =>
  a.name.localeCompare(b.name)
);

export function nameOf(code) {
  if (code === AUTO_CODE) return "Detect language";
  return LANGUAGES.find((l) => l.code.toLowerCase() === String(code).toLowerCase())?.name ?? String(code).toUpperCase();
}

export function isSupported(code) {
  return LANGUAGES.some((l) => l.code === code);
}

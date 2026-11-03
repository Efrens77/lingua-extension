// One shared definition of a lookup word keeps Define and Pronounce consistent.
export function normalizeWord(value) {
  const word = String(value || "").trim().replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "");
  return /^[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*$/u.test(word) ? word : null;
}

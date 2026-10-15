// Splits long text into chunks a translation API will accept, without cutting mid-sentence
// when it can be avoided. Each chunk remembers the separator that followed it so the
// translated pieces can be glued back together in the right shape.
const SENTENCE_BREAK = /(?<=[.!?…؟])\s+|(?<=[。！？])/u;

function hardSlice(s, max) {
  const out = [];
  let rest = s;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function splitSentences(paragraph, max) {
  const out = [];
  let cur = "";
  for (const sentence of paragraph.split(SENTENCE_BREAK).filter(Boolean)) {
    if (sentence.length > max) {
      if (cur) { out.push(cur); cur = ""; }
      out.push(...hardSlice(sentence, max));
    } else if (cur && cur.length + 1 + sentence.length > max) {
      out.push(cur);
      cur = sentence;
    } else {
      cur = cur ? `${cur} ${sentence}` : sentence;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** @returns {{text: string, sep: string}[]} */
export function splitText(text, max) {
  const chunks = [];
  let cur = "";
  const flush = (sep) => {
    if (cur) { chunks.push({ text: cur, sep }); cur = ""; }
  };

  const paragraphs = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  for (const p of paragraphs) {
    if (p.length > max) {
      flush("\n");
      const pieces = splitSentences(p, max);
      pieces.forEach((piece, i) => chunks.push({ text: piece, sep: i === pieces.length - 1 ? "\n" : " " }));
    } else if (cur && cur.length + 1 + p.length > max) {
      flush("\n");
      cur = p;
    } else {
      cur = cur ? `${cur}\n${p}` : p;
    }
  }
  flush("");
  return chunks;
}

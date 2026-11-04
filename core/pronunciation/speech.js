export function bestVoice(language) {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const target = String(language || "").toLowerCase();
  const base = target.split("-")[0];
  return voices.find((voice) => voice.lang.toLowerCase() === target)
    || voices.find((voice) => voice.lang.toLowerCase().split("-")[0] === base)
    || null;
}

export function stopSpeech() {
  window.speechSynthesis?.cancel();
}

export function chunkSpeechText(text, limit = 220) {
  const sentences = String(text || "").match(/[^.!?。！？]+[.!?。！？]*/g) || [];
  const chunks = [];
  let chunk = "";
  for (const sentence of sentences) {
    const next = (chunk + " " + sentence).trim();
    if (next.length > limit && chunk) { chunks.push(chunk); chunk = sentence.trim(); }
    else chunk = next;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export function speakText(text, language, { onStart, onEnd, onError } = {}) {
  const voice = bestVoice(language);
  if (!voice || !text) return false;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language;
  utterance.voice = voice;
  utterance.onstart = onStart;
  utterance.onend = onEnd;
  utterance.onerror = onError;
  window.speechSynthesis.speak(utterance);
  return true;
}

export function speakChunks(text, language, { onStart, onEnd, onError } = {}) {
  const chunks = chunkSpeechText(text);
  const voice = bestVoice(language);
  if (!voice || !chunks.length) return false;
  let index = 0;
  const speakNext = () => {
    if (index >= chunks.length) { onEnd?.(); return; }
    const utterance = new SpeechSynthesisUtterance(chunks[index++]);
    utterance.lang = language;
    utterance.voice = voice;
    utterance.onend = speakNext;
    utterance.onerror = onError;
    window.speechSynthesis.speak(utterance);
  };
  onStart?.();
  speakNext();
  return true;
}

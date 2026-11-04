// Document context used by the service worker for Chrome's document-only AI APIs.
import { translateWithChrome } from "./core/translation/chrome.js";

let narration = null;
let utterance = null;
let updateTimer = null;
// Every utterance has a distinct token.  SpeechSynthesis may deliver onend or
// onerror after cancel(), so callbacks must never be allowed to update a newer
// narration session.
let generation = 0;

function chooseVoice(language) {
  const voices = speechSynthesis.getVoices();
  const target = String(language || "").toLowerCase();
  const base = target.split("-")[0];
  return voices.find((voice) => voice.lang.toLowerCase() === target)
    || voices.find((voice) => voice.lang.toLowerCase().split("-")[0] === base) || null;
}

function waitForVoice(language, timeoutMs = 750) {
  const available = chooseVoice(language);
  if (available) return Promise.resolve(available);
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      speechSynthesis.removeEventListener?.("voiceschanged", onVoicesChanged);
      resolve(chooseVoice(language));
    };
    const onVoicesChanged = () => { if (chooseVoice(language)) finish(); };
    const timeout = setTimeout(finish, timeoutMs);
    speechSynthesis.addEventListener?.("voiceschanged", onVoicesChanged, { once: true });
  });
}

function snapshot(session = narration) {
  if (!session) return null;
  const completed = session.chunks.slice(0, session.index).reduce((sum, item) => sum + item.text.length, 0)
    + session.offset;
  const progress = session.totalChars ? Math.min(1, completed / session.totalChars) : 0;
  return {
    tabId: session.tabId, status: session.status, progress,
    elapsed: Math.round(session.duration * progress), duration: session.duration,
    voice: session.voice?.name || "", sessionId: session.sessionId,
    willResume: Boolean(session.willResume),
  };
}

function emit(session = narration) {
  const state = snapshot(session);
  if (!state) return;
  chrome.runtime.sendMessage({
    type: "lingua/read-aloud-state",
    state,
  }).catch(() => {});
}

function clearTimer() { clearTimeout(updateTimer); updateTimer = null; }
function estimateOffset() {
  if (!narration || !utterance || !narration.chunkStartedAt) return;
  const item = narration.chunks[narration.index];
  const words = Math.max(1, item.text.trim().split(/\s+/).length);
  const estimatedMs = words / 160 * 60000;
  const elapsed = Date.now() - narration.chunkStartedAt;
  narration.offset = Math.min(item.text.length, narration.chunkStartOffset + Math.round(item.text.length * elapsed / estimatedMs));
}
function scheduleProgress(session, token) {
  clearTimer();
  updateTimer = setTimeout(() => {
    if (narration !== session || generation !== token || session.status !== "playing") return;
    estimateOffset();
    emit(session);
    scheduleProgress(session, token);
  }, 250);
}
function stop({ reset = false } = {}) {
  clearTimer();
  if (!narration) { generation++; return; }
  const session = narration;
  generation++;
  if (!reset) estimateOffset();
  const wasSpeaking = session.status === "playing" || session.status === "seeking";
  session.status = reset ? "idle" : "paused";
  // Do not cancel the shared browser queue for an already-paused session. A
  // Phrase or Define utterance may legitimately be playing while Full Page is
  // paused.
  if (wasSpeaking) speechSynthesis.cancel();
  utterance = null;
  if (reset) {
    session.index = 0; session.offset = 0;
  }
  emit(session);
}

function speakNext() {
  if (!narration || narration.status !== "playing") return;
  if (narration.index >= narration.chunks.length) {
    narration.status = "finished"; narration.offset = 0; emit(); return;
  }
  const item = narration.chunks[narration.index];
  const startOffset = narration.offset;
  const playToken = ++generation;
  narration.chunkStartedAt = Date.now();
  narration.chunkStartOffset = startOffset;
  utterance = new SpeechSynthesisUtterance(item.text.slice(startOffset));
  utterance.lang = narration.language;
  utterance.voice = narration.voice;
  utterance.onboundary = (event) => {
    if (!narration || generation !== playToken || narration.status !== "playing") return;
    narration.offset = startOffset + Number(event.charIndex || 0);
    emit();
  };
  utterance.onerror = (event) => {
    if (!narration || generation !== playToken || narration.status !== "playing") return;
    const reason = String(event?.error || "").toLowerCase();
    // Intentional cancel() increments generation before the browser sends this
    // event, so it was already rejected above.  A cancellation that reaches
    // this point was external; leave the UI usable instead of pretending the
    // narration is still playing forever.
    narration.status = ["canceled", "cancelled", "interrupted"].includes(reason) ? "idle" : "error";
    clearTimer(); utterance = null; emit();
  };
  utterance.onend = () => {
    if (!narration || narration.status !== "playing" || generation !== playToken) return;
    clearTimer();
    narration.index++; narration.offset = 0; emit();
    updateTimer = setTimeout(speakNext, item.pause || 160);
  };
  speechSynthesis.speak(utterance);
  scheduleProgress(narration, playToken);
  emit();
}

async function start(command) {
  stop({ reset: true });
  const startToken = ++generation;
  const chunks = (command.chunks || []).filter((item) => item?.text?.trim());
  const voice = await waitForVoice(command.language);
  if (generation !== startToken) return { ok: false, reason: "cancelled" };
  if (!chunks.length || !voice) return { ok: false, reason: "unavailable" };
  narration = {
    tabId: command.tabId, chunks, language: command.language, voice, index: 0, offset: 0,
    totalChars: chunks.reduce((sum, item) => sum + item.text.length, 0),
    duration: Math.max(1, Math.round(chunks.map((item) => item.text).join(" ").trim().split(/\s+/).length / 160 * 60)),
    status: "playing", sessionId: `${Date.now()}-${++generation}`,
  };
  speakNext(); return { ok: true };
}

function seek(seconds, resume) {
  if (!narration) return { ok: false };
  const session = narration;
  const wasSpeaking = session.status === "playing";
  generation++;
  clearTimer();
  if (wasSpeaking) speechSynthesis.cancel();
  utterance = null;
  session.status = "seeking";
  session.willResume = Boolean(resume);
  emit(session);
  const ratio = Math.max(0, Math.min(1, Number(seconds || 0) / narration.duration));
  const target = Math.round(narration.totalChars * ratio);
  let used = 0;
  narration.index = 0; narration.offset = 0;
  for (const [index, item] of narration.chunks.entries()) {
    if (used + item.text.length >= target) { narration.index = index; narration.offset = target - used; break; }
    used += item.text.length;
  }
  narration.status = resume ? "playing" : "paused";
  narration.willResume = false;
  emit();
  if (resume) speakNext();
  return { ok: true };
}

function matchesNarration(command) {
  return narration && (!Number.isInteger(command.tabId) || narration.tabId === command.tabId);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "lingua/chrome-translate") {
    translateWithChrome({ ...message.request, allowDownload: false }).then(sendResponse, (err) => {
      console.error("[Lingua] offscreen Chrome translation failed:", err);
      sendResponse({ ok: false, reason: "unavailable" });
    });
    return true;
  }
  if (message?.type === "lingua/offscreen-read-command") {
    const command = message.command || {};
    (async () => {
      let result = { ok: true };
      if (command.action === "start") result = await start(command);
      else if (command.action === "pause" && matchesNarration(command)) stop();
      else if (command.action === "resume" && matchesNarration(command) && narration.status === "paused") { narration.status = "playing"; speakNext(); }
      else if ((command.action === "restart" || command.action === "reset") && matchesNarration(command)) stop({ reset: true });
      else if (command.action === "seek" && matchesNarration(command)) result = seek(command.seconds, Boolean(command.resume));
      else if (command.action === "state") emit();
      sendResponse({ ...result, state: snapshot() });
    })().catch((error) => {
      console.error("[Lingua] read-aloud command failed:", error);
      sendResponse({ ok: false, reason: "unavailable", state: snapshot() });
    });
    return true;
  }
});

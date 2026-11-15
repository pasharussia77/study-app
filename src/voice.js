// Microphone, speech and beeps for the voice quiz. With ?mock=1 everything is replaced by test stand-ins.
import { isMock } from './firebase.js';
import { workerFetch, explain } from './ai.js';

const cache = new Map();
const inflight = new Map();
let currentAudio = null;
let currentResolve = null;

export function stopSpeaking() {
  if (currentAudio) { try { currentAudio.pause(); } catch { /* already stopped */ } currentAudio = null; }
  if (currentResolve) { const r = currentResolve; currentResolve = null; r(); }
}

// Fetches the audio for a sentence once; sentences already fetched (or being fetched) are reused.
async function getAudio(code, text) {
  if (cache.has(text)) return { blob: cache.get(text), cached: true };
  let p = inflight.get(text);
  if (!p) {
    p = (async () => {
      const res = await workerFetch(code, '/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      if (!res.ok) throw new Error(explain(res, await res.json().catch(() => ({})), 'voice'));
      const blob = await res.blob();
      if (cache.size > 80) cache.clear();
      cache.set(text, blob);
      return blob;
    })().finally(() => inflight.delete(text));
    inflight.set(text, p);
  }
  return { blob: await p, cached: false };
}

// Prepares a sentence in the background so it plays without a wait later.
export function warm(code, text) {
  if (isMock) { (window.__warmed ||= []).push(text); return; }
  getAudio(code, text).catch(() => {});
}

// Speaks the text with the tutor voice and waits until it has finished.
export async function speak(code, text, onCost = () => {}, onStart = () => {}) {
  if (isMock) {
    (window.__spoken ||= []).push(text);
    onCost({ chars: text.length, cached: false, ms: 0 });
    onStart();
    await new Promise((r) => setTimeout(r, 10));
    return;
  }
  const t0 = Date.now();
  const { blob, cached } = await getAudio(code, text);
  onCost({ chars: cached ? 0 : text.length, cached, ms: Date.now() - t0 });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  currentAudio = audio;
  try {
    await new Promise((resolve, reject) => {
      currentResolve = resolve;
      audio.onplaying = () => onStart();
      audio.onended = () => { currentResolve = null; resolve(); };
      audio.onerror = () => { currentResolve = null; reject(new Error('The voice audio could not be played.')); };
      audio.play().catch((e) => { currentResolve = null; reject(new Error(e.name === 'NotAllowedError' ? 'The browser blocked sound. Tap Resume to allow it.' : 'The voice audio could not be played.')); });
    });
  } finally { URL.revokeObjectURL(url); currentAudio = null; }
}

// A short tone that says "your turn" (useful when you are not looking at the screen).
export async function beep() {
  if (isMock) { (window.__beeps = (window.__beeps || 0) + 1); return; }
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start();
    await new Promise((r) => setTimeout(r, 140));
    o.stop(); ctx.close().catch(() => {});
  } catch { /* a missing beep is fine */ }
}

// Starts recording and stops by itself after the student has finished talking.
// Returns { promise, stop, cancel }. The promise always gives { blob, ext, stats }; blob is null when nothing was said or it was cancelled.
export function startListening({ maxMs = 60000, silenceMs = 1500, noSpeechMs = 9000 } = {}) {
  if (isMock) {
    let timer, done;
    const stats = (reason, speech) => ({ durationMs: 1200, bytes: 4, peak: 0.2, floor: 0.01, threshold: 0.03, speech, reason, mic: 'mock' });
    const rec = () => ({ blob: new Blob(['mock'], { type: 'audio/webm' }), ext: 'webm', stats: stats('silence', true) });
    const promise = new Promise((res) => { done = res; if (!window.__mockHold) timer = setTimeout(() => res(rec()), 20); });
    return { promise, stop() { done({ ...rec(), stats: stats('manual', true) }); }, cancel() { clearTimeout(timer); done({ blob: null, ext: 'webm', stats: stats('cancel', false) }); } };
  }
  let stopFlag = false, cancelFlag = false;
  const promise = (async () => {
    let stream;
    try {
      // No phone noise-suppression or echo-cancelling: the microphone is only open while nothing is playing, and the processing can muffle quiet voices.
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 } });
    } catch (e) { throw new Error(e && e.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow the microphone for this app in the browser settings.' : 'No microphone could be used.'); }
    const track = stream.getAudioTracks()[0];
    const s = (track && track.getSettings && track.getSettings()) || {};
    const mic = `rate ${s.sampleRate || '?'}, echo-cancel ${s.echoCancellation}, noise-suppress ${s.noiseSuppression}, auto-gain ${s.autoGainControl}`;
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const an = ctx.createAnalyser(); an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    const stopped = new Promise((res) => { rec.onstop = res; });
    rec.start(250);
    const t0 = Date.now(), calib = [];
    let floor = null, thr = 0.012, speaking = false, lastVoice = 0, loud = 0, peak = 0, reason = 'max';
    await new Promise((resolve) => {
      const tick = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let sum = 0; for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length), now = Date.now(), el = now - t0;
        if (rms > peak) peak = rms;
        if (el < 300) calib.push(rms);
        else {
          if (floor === null) { floor = calib.reduce((p, q) => p + q, 0) / Math.max(1, calib.length); thr = Math.max(0.012, floor * 2.5); }
          if (rms > thr) { loud++; lastVoice = now; if (loud >= 2) speaking = true; } else loud = 0;
          if (speaking && now - lastVoice > silenceMs) { reason = 'silence'; clearInterval(tick); resolve(); return; }
          if (!speaking && el > noSpeechMs) { reason = 'nospeech'; clearInterval(tick); resolve(); return; }
        }
        if (stopFlag) { reason = 'manual'; clearInterval(tick); resolve(); } else if (cancelFlag) { reason = 'cancel'; clearInterval(tick); resolve(); } else if (el > maxMs) { clearInterval(tick); resolve(); }
      }, 100);
    });
    if (rec.state !== 'inactive') rec.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
    const type = rec.mimeType || mime || 'audio/webm';
    const blob = (cancelFlag || (!speaking && !stopFlag)) ? null : new Blob(chunks, { type });
    return { blob, ext: type.includes('mp4') ? 'm4a' : 'webm', stats: { durationMs: Date.now() - t0, bytes: blob ? blob.size : 0, peak: +peak.toFixed(3), floor: +(floor || 0).toFixed(3), threshold: +thr.toFixed(3), speech: speaking, reason, mic } };
  })();
  return { promise, stop() { stopFlag = true; }, cancel() { cancelFlag = true; } };
}

export async function transcribe(code, blob, ext = 'webm') {
  if (isMock) { const q = window.__mockSpeech; return q && q.length ? String(q.shift()) : ''; }
  const form = new FormData();
  form.append('file', new File([blob], `answer.${ext}`, { type: blob.type }));
  const res = await workerFetch(code, '/stt', { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(explain(res, data, 'speech recognition'));
  return String(data.text || '').trim();
}

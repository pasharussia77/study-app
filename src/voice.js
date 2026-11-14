// Microphone, speech and beeps for the voice quiz. With ?mock=1 everything is replaced by test stand-ins.
import { isMock } from './firebase.js';
import { workerFetch, explain } from './ai.js';

const cache = new Map();
let currentAudio = null;
let currentResolve = null;

export function stopSpeaking() {
  if (currentAudio) { try { currentAudio.pause(); } catch { /* already stopped */ } currentAudio = null; }
  if (currentResolve) { const r = currentResolve; currentResolve = null; r(); }
}

// Speaks the text with the tutor voice and waits until it has finished. Repeated sentences are not paid for twice.
export async function speak(code, text, onCost = () => {}) {
  if (isMock) {
    (window.__spoken ||= []).push(text);
    onCost({ chars: text.length, cached: false });
    await new Promise((r) => setTimeout(r, 10));
    return;
  }
  let blob = cache.get(text);
  if (blob) onCost({ chars: 0, cached: true });
  else {
    const res = await workerFetch(code, '/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!res.ok) throw new Error(explain(res, await res.json().catch(() => ({})), 'voice'));
    blob = await res.blob();
    if (cache.size > 60) cache.clear();
    cache.set(text, blob);
    onCost({ chars: text.length, cached: false });
  }
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  currentAudio = audio;
  try {
    await new Promise((resolve, reject) => {
      currentResolve = resolve;
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
// Returns { promise, stop, cancel }. The promise gives { blob, ext }, or null when nothing was said or it was cancelled.
export function startListening({ maxMs = 60000, silenceMs = 1700, noSpeechMs = 9000 } = {}) {
  if (isMock) {
    let timer, done;
    const rec = () => ({ blob: new Blob(['mock'], { type: 'audio/webm' }), ext: 'webm' });
    const promise = new Promise((res) => { done = res; if (!window.__mockHold) timer = setTimeout(() => res(rec()), 20); });
    return { promise, stop() { done(rec()); }, cancel() { clearTimeout(timer); done(null); } };
  }
  let stopFlag = false, cancelFlag = false;
  const promise = (async () => {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { throw new Error(e && e.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow the microphone for this app in the browser settings.' : 'No microphone could be used.'); }
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
    let floor = null, speaking = false, lastVoice = 0, loud = 0;
    await new Promise((resolve) => {
      const tick = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let s = 0; for (const v of buf) s += v * v;
        const rms = Math.sqrt(s / buf.length), now = Date.now(), el = now - t0;
        if (el < 400) calib.push(rms);
        else {
          if (floor === null) floor = calib.reduce((a, b) => a + b, 0) / Math.max(1, calib.length);
          if (rms > Math.max(0.015, floor * 3)) { loud++; lastVoice = now; if (loud >= 2) speaking = true; } else loud = 0;
          if ((speaking && now - lastVoice > silenceMs) || (!speaking && el > noSpeechMs)) { clearInterval(tick); resolve(); return; }
        }
        if (stopFlag || cancelFlag || el > maxMs) { clearInterval(tick); resolve(); }
      }, 100);
    });
    if (rec.state !== 'inactive') rec.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
    if (cancelFlag || (!speaking && !stopFlag)) return null;
    const type = rec.mimeType || mime || 'audio/webm';
    return { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'm4a' : 'webm' };
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

// Family Study API: keeps the OpenAI key off the phones.
// Secrets/variables are set in the Cloudflare dashboard, never in this file:
//   OPENAI_API_KEY (secret)  BRAIN_MODEL (optional, default gpt-5.6-luna)  REASONING_EFFORT (optional, default low)
//   TTS_MODEL (optional, default gpt-4o-mini-tts)  TTS_VOICE (optional, default sage)  TTS_STYLE (optional)
//   STT_MODEL (optional, default gpt-transcribe)  STT_FALLBACK_MODEL (optional, default gpt-4o-mini-transcribe)

const ALLOWED_ORIGINS = ['https://pasharussia77.github.io'];
const FIREBASE_PROJECT = 'family-study-94e10';
const DEFAULT_MODEL = 'gpt-5.6-luna';
const MAX_BODY_BYTES = 8_000_000; // photos are sent as compressed data URLs
const MAX_MESSAGES = 40;
const MAX_OUTPUT_TOKENS = 4000;
const MAX_TTS_CHARS = 1500;
const MAX_AUDIO_BYTES = 6_000_000;

const verified = new Map(); // "code:token-tail" -> expiry time (ms)
const VERIFY_TTL_MS = 5 * 60 * 1000;

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Family-Code',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...(origin ? cors(origin) : {}) }
  });
}

// The caller must hold a real Firebase sign-in AND know a real family code.
// We prove both by reading that family's document with the caller's own token.
async function familyIsValid(code, token) {
  if (!/^[a-z0-9-]{6,60}$/.test(code || '') || !token) return false;
  const key = code + ':' + token.slice(-24);
  const hit = verified.get(key);
  if (hit && hit > Date.now()) return true;
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/families/${code}`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) return false;
  if (verified.size > 500) verified.clear();
  verified.set(key, Date.now() + VERIFY_TTL_MS);
  return true;
}

function validMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return false;
  return messages.every((m) => {
    if (!m || !['system', 'user', 'assistant'].includes(m.role)) return false;
    if (typeof m.content === 'string') return m.content.length < 60000;
    if (!Array.isArray(m.content)) return false;
    return m.content.every((p) =>
      (p.type === 'text' && typeof p.text === 'string' && p.text.length < 60000) ||
      (p.type === 'image_url' && typeof p.image_url?.url === 'string' && p.image_url.url.startsWith('data:image/')));
  });
}

async function handleChat(request, env, origin) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400, origin); }
  if (!validMessages(body.messages)) return json({ error: 'Invalid messages.' }, 400, origin);
  const payload = {
    model: env.BRAIN_MODEL || DEFAULT_MODEL,
    messages: body.messages,
    max_completion_tokens: Math.min(Math.max(parseInt(body.maxTokens, 10) || 2000, 100), MAX_OUTPUT_TOKENS),
    // The app may ask for no reasoning (faster) on quick tasks such as the voice tutor.
    reasoning_effort: ['none', 'low'].includes(body.effort) ? body.effort : (env.REASONING_EFFORT || 'low')
  };
  if (body.json) payload.response_format = { type: 'json_object' };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.OPENAI_API_KEY },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: data?.error?.message || 'The AI service returned an error.' }, 502, origin);
  return json({ text: data.choices?.[0]?.message?.content ?? '', usage: data.usage || null }, 200, origin);
}

const VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
const DEFAULT_STYLE = 'Speak in a calm, gentle, warm and patient tone, like a kind teacher who has all the time in the world. Use a soft, friendly intonation and a relaxed, unhurried rhythm with natural pauses. Questions should sound curious and inviting, never like a demand. Never sound stern, strict, rushed or impatient.';

// Text to speech: returns an mp3 of what the tutor says.
async function handleTts(request, env, origin) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400, origin); }
  const text = String((body && body.text) || '').trim();
  if (!text || text.length > MAX_TTS_CHARS) return json({ error: 'Invalid text.' }, 400, origin);
  const model = env.TTS_MODEL || 'gpt-4o-mini-tts';
  const voice = VOICES.includes(body.voice) ? body.voice : (env.TTS_VOICE || 'sage');
  const payload = { model, voice, input: text, response_format: 'mp3' };
  const speed = Number(body.speed);
  if (speed >= 0.8 && speed <= 1.1 && speed !== 1) payload.speed = speed;
  if (model.startsWith('gpt-4o')) payload.instructions = env.TTS_STYLE || DEFAULT_STYLE;
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.OPENAI_API_KEY },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    return json({ error: (d && d.error && d.error.message) || 'The voice service returned an error.' }, 502, origin);
  }
  return new Response(res.body, { status: 200, headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', ...cors(origin) } });
}

const hint = (s, max) => String(s == null ? '' : s).replace(/[<>\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

async function transcribeOnce(env, model, file, keywords, prompt) {
  const out = new FormData();
  out.append('file', file, file.name || 'answer.webm');
  out.append('model', model);
  if (model.startsWith('gpt-transcribe')) {
    out.append('languages[]', 'en');
    keywords.forEach((k) => out.append('keywords[]', k));
  } else {
    out.append('language', 'en');
    out.append('response_format', 'json');
  }
  if (prompt) out.append('prompt', prompt);
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + env.OPENAI_API_KEY }, body: out
  });
  return { res, data: await res.json().catch(() => ({})) };
}

// Speech to text: takes a short recording (and hints about the words to expect), returns what was said.
async function handleStt(request, env, origin) {
  let form;
  try { form = await request.formData(); } catch { return json({ error: 'Invalid upload.' }, 400, origin); }
  const file = form.get('file');
  if (!file || typeof file === 'string' || !file.size || file.size > MAX_AUDIO_BYTES) return json({ error: 'Invalid audio.' }, 400, origin);
  let keywords = [];
  try { keywords = JSON.parse(String(form.get('keywords') || '[]')); } catch { keywords = []; }
  keywords = (Array.isArray(keywords) ? keywords : []).map((k) => hint(k, 40)).filter(Boolean).slice(0, 50);
  const prompt = hint(form.get('prompt'), 400);
  let model = env.STT_MODEL || 'gpt-transcribe';
  let { res, data } = await transcribeOnce(env, model, file, keywords, prompt);
  // If the newer model is not available to this account, fall back to the older one once.
  const message = (data && data.error && data.error.message) || '';
  if (!res.ok && (res.status === 400 || res.status === 404) && model.startsWith('gpt-transcribe') && /model|not found|access|unsupported|parameter/i.test(message)) {
    model = env.STT_FALLBACK_MODEL || 'gpt-4o-mini-transcribe';
    ({ res, data } = await transcribeOnce(env, model, file, keywords, prompt));
  }
  if (!res.ok) return json({ error: (data && data.error && data.error.message) || 'The speech service returned an error.' }, 502, origin);
  return json({ text: (data && data.text) || '', model, languages: (data && data.languages) || null }, 200, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const originOk = origin && ALLOWED_ORIGINS.includes(origin);

    if (request.method === 'OPTIONS') {
      return originOk ? new Response(null, { status: 204, headers: cors(origin) }) : new Response(null, { status: 403 });
    }
    if (url.pathname === '/health') {
      return json({ ok: true, hasKey: !!env.OPENAI_API_KEY, model: env.BRAIN_MODEL || DEFAULT_MODEL }, 200, originOk ? origin : null);
    }
    if (!originOk) return json({ error: 'Not allowed.' }, 403, null);
    if (!env.OPENAI_API_KEY) return json({ error: 'The server is missing its OpenAI key.' }, 500, origin);

    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const code = (request.headers.get('X-Family-Code') || '').toLowerCase();
    if (!(await familyIsValid(code, token).catch(() => false))) return json({ error: 'Family not recognized.' }, 401, origin);

    if (request.method === 'POST') {
      if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) return json({ error: 'Too large.' }, 413, origin);
      if (url.pathname === '/chat') return handleChat(request, env, origin);
      if (url.pathname === '/tts') return handleTts(request, env, origin);
      if (url.pathname === '/stt') return handleStt(request, env, origin);
    }
    return json({ error: 'Not found.' }, 404, origin);
  }
};

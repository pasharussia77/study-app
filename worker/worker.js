// Family Study API: keeps the OpenAI key off the phones.
// Secrets/variables are set in the Cloudflare dashboard, never in this file:
//   OPENAI_API_KEY (secret)  BRAIN_MODEL (optional, default gpt-5.6-luna)  REASONING_EFFORT (optional, default low)

const ALLOWED_ORIGINS = ['https://pasharussia77.github.io'];
const FIREBASE_PROJECT = 'family-study-94e10';
const DEFAULT_MODEL = 'gpt-5.6-luna';
const MAX_BODY_BYTES = 8_000_000; // photos are sent as compressed data URLs
const MAX_MESSAGES = 40;
const MAX_OUTPUT_TOKENS = 4000;

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
    reasoning_effort: env.REASONING_EFFORT || 'low'
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
    }
    return json({ error: 'Not found.' }, 404, origin);
  }
};

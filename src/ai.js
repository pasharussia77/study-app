import { backend, isMock } from './firebase.js';

const WORKER_URL = 'https://study-api.pasharussia77.workers.dev';

// Calls any endpoint on the family's AI helper with the sign-in and family code attached.
export async function workerFetch(code, path, init = {}) {
  let token;
  try { token = await backend.idToken(); } catch { throw new Error('Not signed in. Reload the app and try again.'); }
  try {
    return await fetch(WORKER_URL + path, { ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + token, 'X-Family-Code': code } });
  } catch { throw new Error('Could not reach the AI helper. Check your internet connection.'); }
}
export function explain(res, data, what = 'AI helper') {
  if (res.status === 401) return 'The AI helper did not recognize this phone. Leave and rejoin the family, then try again.';
  if (res.status === 404) return `The AI helper has no ${what} yet. It needs the latest update in Cloudflare.`;
  return (data && data.error) || `The ${what} had a problem.`;
}

// Sends a request to the family's AI helper (the Cloudflare Worker). Returns plain text.
export async function askAI(code, opts) { return (await askAIDetailed(code, opts)).text; }

// Same, but also returns how long it took and how many tokens were used.
export async function askAIDetailed(code, { messages, json = false, maxTokens = 2000 }) {
  const t0 = Date.now();
  if (isMock) return { text: await mockAI(messages), usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }, ms: 5 };
  let token;
  try { token = await backend.idToken(); } catch { throw new Error('Not signed in. Reload the app and try again.'); }
  let res;
  try {
    res = await fetch(WORKER_URL + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'X-Family-Code': code },
      body: JSON.stringify({ messages, json, maxTokens })
    });
  } catch { throw new Error('Could not reach the AI helper. Check your internet connection.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) throw new Error('The AI helper did not recognize this phone. Leave and rejoin the family, then try again.');
    throw new Error(data.error || 'The AI helper had a problem.');
  }
  return { text: data.text || '', usage: data.usage || null, ms: Date.now() - t0 };
}

// Test stand-in used only with ?mock=1
const MOCK_DEFAULT = JSON.stringify({ page: { graded: false, score: null }, ends_with: {}, items: [
  { type: 'term', question: 'photosynthesis', answer_text: 'how plants make food', confidence: 'high', note: '' },
  { type: 'term', question: 'mitochondria', answer_text: "the cell's power plant", confidence: 'high', note: '' }
] });
async function mockAI(messages) {
  window.__lastMessages = messages;
  window.__allMessages = [...(window.__allMessages || []), messages];
  if (new URLSearchParams(location.search).has('aifail')) throw new Error('Pretend AI failure.');
  if (window.__mockAI && window.__mockAI.length) { const next = window.__mockAI.shift(); return typeof next === 'string' ? next : JSON.stringify(next); }
  return MOCK_DEFAULT;
}

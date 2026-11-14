import worker from './worker.js';
const ORIGIN = 'https://pasharussia77.github.io';
const env = { OPENAI_API_KEY: 'sk-test-123' };
let calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  if (String(url).includes('firestore.googleapis.com')) {
    const ok = String(url).endsWith('/families/good-code-123') && init.headers.Authorization === 'Bearer goodtoken-aaaaaaaaaaaaaaaaaaaaaa';
    return new Response('{}', { status: ok ? 200 : 403 });
  }
  if (String(url).includes('api.openai.com')) return new Response(JSON.stringify({ choices: [{ message: { content: 'hi there' } }], usage: { total_tokens: 5 } }), { status: 200 });
  throw new Error('unexpected ' + url);
};
const req = (path, { method = 'POST', origin = ORIGIN, headers = {}, body } = {}) =>
  new Request('https://api.test' + path, { method, headers: { ...(origin ? { Origin: origin } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const good = { Authorization: 'Bearer goodtoken-aaaaaaaaaaaaaaaaaaaaaa', 'X-Family-Code': 'good-code-123', 'Content-Type': 'application/json' };
let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : (fail++, console.log('FAIL', name)); };

let r = await worker.fetch(req('/chat', { method: 'OPTIONS' }), env); check('preflight ok', r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === ORIGIN);
r = await worker.fetch(req('/chat', { method: 'OPTIONS', origin: 'https://evil.example' }), env); check('preflight blocks other origin', r.status === 403);
r = await worker.fetch(req('/chat', { origin: 'https://evil.example', headers: good, body: { messages: [{ role: 'user', content: 'x' }] } }), env); check('blocks other origin', r.status === 403);
r = await worker.fetch(req('/health', { method: 'GET' }), env); let j = await r.json(); check('health', r.status === 200 && j.hasKey === true && j.model === 'gpt-5.6-luna' && !JSON.stringify(j).includes('sk-test'));
r = await worker.fetch(req('/chat', { body: { messages: [{ role: 'user', content: 'x' }] } }), env); check('no auth 401', r.status === 401);
r = await worker.fetch(req('/chat', { headers: { ...good, 'X-Family-Code': 'wrong-code-999' }, body: { messages: [{ role: 'user', content: 'x' }] } }), env); check('wrong family 401', r.status === 401);
r = await worker.fetch(req('/chat', { headers: { ...good, Authorization: 'Bearer badtoken-aaaaaaaaaaaaaaaaaaaaaaaa' }, body: { messages: [{ role: 'user', content: 'x' }] } }), env); check('bad token 401', r.status === 401);
calls = [];
r = await worker.fetch(req('/chat', { headers: good, body: { messages: [{ role: 'user', content: 'hello' }], maxTokens: 999999, json: true } }), env); j = await r.json();
check('valid chat 200', r.status === 200 && j.text === 'hi there');
const oa = calls.find((c) => c.url.includes('openai')); const sent = JSON.parse(oa.init.body);
check('uses key', oa.init.headers.Authorization === 'Bearer sk-test-123');
check('model default', sent.model === 'gpt-5.6-luna'); check('token cap', sent.max_completion_tokens === 4000);
check('json mode', sent.response_format?.type === 'json_object'); check('effort low', sent.reasoning_effort === 'low');
check('key not in response', !JSON.stringify(j).includes('sk-test'));
calls = [];
r = await worker.fetch(req('/chat', { headers: good, body: { messages: [{ role: 'user', content: 'again' }] } }), { ...env, BRAIN_MODEL: 'other-model' });
check('cached family check (no 2nd firestore call)', !calls.some((c) => c.url.includes('firestore')));
check('env model override', JSON.parse(calls.find((c) => c.url.includes('openai')).init.body).model === 'other-model');
r = await worker.fetch(req('/chat', { headers: good, body: { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://evil.example/x.png' } }] }] } }), env); check('rejects remote image url', r.status === 400);
r = await worker.fetch(req('/chat', { headers: good, body: { messages: [{ role: 'user', content: [{ type: 'text', text: 'read this' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }] }] } }), env); check('accepts data image', r.status === 200);
r = await worker.fetch(req('/chat', { headers: good, body: { messages: [{ role: 'hacker', content: 'x' }] } }), env); check('rejects bad role', r.status === 400);
r = await worker.fetch(req('/chat', { headers: good, body: { nope: 1 } }), env); check('rejects missing messages', r.status === 400);
r = await worker.fetch(req('/other', { headers: good, body: {} }), env); check('404 unknown path', r.status === 404);
r = await worker.fetch(req('/chat', { headers: good, body: { messages: [{ role: 'user', content: 'x' }] } }), {}); check('missing key 500', r.status === 500);
console.log(`worker tests: ${pass} passed, ${fail} failed`);

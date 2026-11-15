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
  if (String(url).includes('/audio/speech')) return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  if (String(url).includes('/audio/transcriptions')) {
    const m = init.body.get('model');
    if (globalThis.__sttFailPrimary && m === 'gpt-transcribe') return new Response(JSON.stringify({ error: { message: 'The model `gpt-transcribe` does not exist or you do not have access to it.' } }), { status: 404 });
    return new Response(JSON.stringify({ text: 'it is a small furry pet', languages: [{ code: 'en' }] }), { status: 200 });
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
// ---- optional reasoning effort ----
calls = [];
r = await worker.fetch(req('/chat', { headers: good, body: { messages: [{ role: 'user', content: 'quick' }], effort: 'none' } }), env);
check('effort none passes', JSON.parse(calls.find((c) => c.url.includes('openai')).init.body).reasoning_effort === 'none');
calls = [];
r = await worker.fetch(req('/chat', { headers: good, body: { messages: [{ role: 'user', content: 'quick' }], effort: 'xhigh' } }), env);
check('other efforts are ignored', JSON.parse(calls.find((c) => c.url.includes('openai')).init.body).reasoning_effort === 'low');
calls = [];
r = await worker.fetch(req('/chat', { headers: good, body: { messages: [{ role: 'user', content: 'quick' }] } }), { ...env, REASONING_EFFORT: 'none' });
check('env effort still the default', JSON.parse(calls.find((c) => c.url.includes('openai')).init.body).reasoning_effort === 'none');

// ---- voice: text to speech and speech to text ----
calls = [];
r = await worker.fetch(req('/tts', { headers: good, body: { text: 'Hello there, nice work!' } }), env);
check('tts 200 audio', r.status === 200 && r.headers.get('content-type') === 'audio/mpeg' && (await r.arrayBuffer()).byteLength === 4);
let sp = JSON.parse(calls.find((c) => c.url.includes('/audio/speech')).init.body);
check('tts uses key', calls.find((c) => c.url.includes('/audio/speech')).init.headers.Authorization === 'Bearer sk-test-123');
check('tts defaults: calm voice and gentle style', sp.model === 'gpt-4o-mini-tts' && sp.voice === 'sage' && sp.response_format === 'mp3' && sp.input === 'Hello there, nice work!' && /calm, gentle, warm and patient/.test(sp.instructions) && /Never sound stern/.test(sp.instructions) && sp.speed === undefined);
const lastSpeech = () => JSON.parse(calls.filter((c) => c.url.includes('/audio/speech')).pop().init.body);
r = await worker.fetch(req('/tts', { headers: good, body: { text: 'Hi', voice: 'marin', speed: 0.9 } }), env); sp = lastSpeech();
check('tts accepts a listed voice and a gentle speed', sp.voice === 'marin' && sp.speed === 0.9);
r = await worker.fetch(req('/tts', { headers: good, body: { text: 'Hi', voice: 'evil-voice', speed: 3 } }), env); sp = lastSpeech();
check('tts ignores unknown voice and extreme speed', sp.voice === 'sage' && sp.speed === undefined);
r = await worker.fetch(req('/tts', { headers: good, body: { text: 'Hi' } }), { ...env, TTS_VOICE: 'cedar', TTS_STYLE: 'Be brief.' }); sp = lastSpeech();
check('tts env overrides', sp.voice === 'cedar' && sp.instructions === 'Be brief.');
r = await worker.fetch(req('/tts', { headers: good, body: { text: 'Hi' } }), { ...env, TTS_MODEL: 'tts-1', TTS_VOICE: 'nova' }); sp = lastSpeech();
check('tts older model: no instructions', sp.model === 'tts-1' && sp.voice === 'nova' && sp.instructions === undefined);
check('tts audio keys not leaked', !(await r.clone().text()).includes('sk-test'));
r = await worker.fetch(req('/tts', { headers: good, body: { text: '' } }), env); check('tts rejects empty', r.status === 400);
r = await worker.fetch(req('/tts', { headers: good, body: { text: 'x'.repeat(1501) } }), env); check('tts rejects long', r.status === 400);
r = await worker.fetch(req('/tts', { origin: 'https://evil.example', headers: good, body: { text: 'Hi' } }), env); check('tts blocks other origin', r.status === 403);
r = await worker.fetch(req('/tts', { headers: { ...good, 'X-Family-Code': 'wrong-code-999' }, body: { text: 'Hi' } }), env); check('tts needs family', r.status === 401);

const audioReq = (headers, file, extra = {}) => { const f = new FormData(); if (file !== null) f.append('file', file, 'answer.webm'); Object.entries(extra).forEach(([k, v]) => f.append(k, v)); return new Request('https://api.test/stt', { method: 'POST', headers: { Origin: ORIGIN, ...headers }, body: f }); };
const { 'Content-Type': _ct, ...goodNoType } = good;
const sttCall = () => calls.filter((c) => c.url.includes('/audio/transcriptions')).pop();
const audio = () => new Blob([new Uint8Array(200)], { type: 'audio/webm' });
calls = [];
r = await worker.fetch(audioReq(goodNoType, audio(), { keywords: JSON.stringify(['giraffe', 'elephant', '<b>penguin</b>', 'line\nbreak', '']), prompt: 'A student is answering study questions out loud in English.' }), env); j = await r.json();
check('stt 200 text, model and languages', r.status === 200 && j.text === 'it is a small furry pet' && j.model === 'gpt-transcribe' && j.languages[0].code === 'en');
let body = sttCall().init.body;
check('stt uses key and the newer model', sttCall().init.headers.Authorization === 'Bearer sk-test-123' && body.get('model') === 'gpt-transcribe' && body.get('file').size === 200);
check('stt sends languages[] (never the old language field) and no response_format', body.getAll('languages[]').join() === 'en' && body.get('language') === null && body.get('response_format') === null);
check('stt sends cleaned keywords', body.getAll('keywords[]').join('|') === 'giraffe|elephant|b penguin /b|line break');
check('stt keywords hold no angle brackets or line breaks', body.getAll('keywords[]').every((k) => !/[<>\r\n]/.test(k)));
check('stt sends the prompt', body.get('prompt') === 'A student is answering study questions out loud in English.');
r = await worker.fetch(audioReq(goodNoType, audio(), { keywords: JSON.stringify(Array.from({ length: 80 }, (_, i) => 'word' + i)) }), env); body = sttCall().init.body;
check('stt caps the keyword list', body.getAll('keywords[]').length === 50);
r = await worker.fetch(audioReq(goodNoType, audio(), { keywords: 'not json', prompt: 'x'.repeat(900) }), env); body = sttCall().init.body;
check('stt survives bad keywords and trims a long prompt', r.status === 200 && body.getAll('keywords[]').length === 0 && body.get('prompt').length === 400);
globalThis.__sttFailPrimary = true; calls = [];
r = await worker.fetch(audioReq(goodNoType, audio(), { keywords: JSON.stringify(['giraffe']) }), env); j = await r.json();
const sttCalls = calls.filter((c) => c.url.includes('/audio/transcriptions'));
check('stt falls back to the older model when the new one is not available', r.status === 200 && j.model === 'gpt-4o-mini-transcribe' && sttCalls.length === 2 && sttCalls[1].init.body.get('language') === 'en' && sttCalls[1].init.body.get('languages[]') === null && sttCalls[1].init.body.get('response_format') === 'json');
globalThis.__sttFailPrimary = false; calls = [];
r = await worker.fetch(audioReq(goodNoType, audio()), { ...env, STT_MODEL: 'gpt-4o-mini-transcribe' }); j = await r.json(); body = sttCall().init.body;
check('stt env model override uses the old-style language field', j.model === 'gpt-4o-mini-transcribe' && body.get('language') === 'en' && body.get('languages[]') === null);
r = await worker.fetch(audioReq(goodNoType, null), env); check('stt rejects no file', r.status === 400);
r = await worker.fetch(audioReq(goodNoType, new Blob([])), env); check('stt rejects empty file', r.status === 400);
r = await worker.fetch(audioReq(goodNoType, new Blob([new Uint8Array(6_000_001)])), env); check('stt rejects huge file', r.status === 400);
r = await worker.fetch(audioReq({ ...goodNoType, 'X-Family-Code': 'wrong-code-999' }, new Blob([new Uint8Array(10)])), env); check('stt needs family', r.status === 401);
r = await worker.fetch(new Request('https://api.test/stt', { method: 'POST', headers: { Origin: ORIGIN, ...good }, body: 'not a form' }), env); check('stt rejects non-form', r.status === 400);
console.log(`worker tests: ${pass} passed, ${fail} failed`);

// The voice tutor's rules: how a question is spoken, how a spoken choice is understood, and what the AI is asked.
import { normalize, isCorrect } from './stats.js';
import { answerLetters, withNumber, contextFor } from './deck.js';

const L = (i) => String.fromCharCode(65 + i);

const sentence = (x) => { const t = String(x).trim(); return /[.?!…]$/.test(t) ? t : t + '.'; };
export const INTRO = {
  definition: 'What do these words mean?',
  word: 'Which word fits each definition?',
  question: 'Questions.',
  'true/false': 'True or false questions.',
  'multiple choice': 'Multiple choice questions.',
  'select all': 'Select all that apply. Say the letters.',
  order: 'Put these in order. Say the letters in order.'
};

// `spoken` is just the question; `intro` explains the kind of question and is said once per run of the same kind.
export function describeQuestion(c, ask = 'term') {
  const ctx = contextFor(c);
  const base = (kind, label, shown, spoken, expected, choices) => ({ kind, label, shown: withNumber(c, shown), spoken: ctx ? sentence(ctx) + ' ' + spoken : spoken, expected, choices, intro: INTRO[kind] });
  if (c.type === 'tf') return base('true/false', 'True or false?', c.prompt, sentence(c.prompt), c.answer, c.choices);
  if (c.type === 'mc') return base('multiple choice', 'Choose the correct answer', c.prompt, `${c.prompt} ${c.choices.map((t, i) => `${L(i)}, ${t}.`).join(' ')}`, c.answer, c.choices);
  const lettered = () => `${c.prompt} ${c.choices.map((t, i) => `${L(i)}, ${t}.`).join(' ')}`;
  if (c.type === 'multi') return base('select all', 'Select all that apply', c.prompt, lettered(), sayLetters(answerLetters(c), 'and'), c.choices);
  if (c.type === 'order') return base('order', 'Put these in order', c.prompt, lettered(), answerLetters(c).join(', '), c.choices);
  if (c.type === 'qa') return base('question', 'Answer this question', c.prompt, sentence(c.prompt), c.answer, null);
  return ask === 'definition'
    ? base('word', 'Which word matches this definition?', c.definition, sentence(c.definition), c.term, null)
    : base('definition', 'What is the definition of…', c.term, sentence(c.term), c.definition, null);
}
export const utterance = (qd, withIntro) => (withIntro && qd.intro ? `${qd.intro} ${qd.spoken}` : qd.spoken);

// An exact (or nearly exact) answer needs no AI: it is judged on the spot.
export function quickCorrect(heard, expected) {
  const h = normalize(heard), e = normalize(expected);
  if (!h || !e) return false;
  if (isCorrect(heard, expected)) return true;
  const eWords = e.split(' '), hWords = h.split(' ');
  const negated = /\b(not|no|never|isn't|isnt|don't|dont|doesn't|doesnt)\b/.test(clean(heard));
  return eWords.length <= 3 && hWords.length <= 8 && !negated && ` ${h} `.includes(` ${e} `);
}

// "A, B and D"
export const sayLetters = (letters, word = 'and') => (letters.length < 2 ? letters.join('') : `${letters.slice(0, -1).join(', ')} ${word} ${letters[letters.length - 1]}`);
export const isPick = (c) => c.type === 'tf' || c.type === 'mc' || c.type === 'multi' || c.type === 'order';
export const isLetters = (c) => c.type === 'multi' || c.type === 'order';

// Tries per kind: choosing (true/false, multiple choice, select all, put in order) has one, spoken answers three.
export const maxAttempts = (c) => (isPick(c) ? 1 : 3);
// Counts as "right" (done) only if no real help was needed.
export const countsRight = (c, attempt) => (isPick(c) ? attempt === 1 : attempt <= 2);

function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// How a letter is often written down when it is spoken: the letter A sounds like "hey" to a recognizer.
const SPOKEN = { a: 0, hey: 0, hay: 0, ay: 0, aye: 0, eh: 0, ey: 0, b: 1, bee: 1, be: 1, c: 2, see: 2, sea: 2, cee: 2, d: 3, dee: 3, e: 4 };
const ORDINAL = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4 };
const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();

// Works out which choice the student meant, or -1 if it is unclear.
export function matchChoice(heard, choices) {
  const t = clean(heard);
  if (!t) return -1;
  const norm = choices.map(normalize);
  const iT = norm.indexOf('true'), iF = norm.indexOf('false');
  if (iT >= 0 && iF >= 0) {
    const hasT = /\btrue\b/.test(t), hasF = /\bfalse\b/.test(t);
    if (hasT !== hasF) return hasT ? iT : iF;
  }
  // 1. Which choice's words were heard?
  const nt = normalize(heard);
  const hits = [];
  norm.forEach((nc, i) => {
    if (!nc) return;
    const cw = nc.split(' '), tw = nt.split(' ');
    // every word of the choice is heard, allowing a one-letter slip in longer words ("conscious" for "conscience")
    const allHeard = cw.every((w) => tw.some((x) => x === w || (w.length >= 6 && x.length >= 6 && (lev(x, w) <= 2 || x.slice(0, 6) === w.slice(0, 6)))));
    if ((nc.length >= 3 && nt.includes(nc)) || (nt.length >= 5 && nt.length / nc.length >= 0.7 && nc.includes(nt)) || isCorrect(heard, choices[i]) || (cw.length >= 1 && nc.length >= 3 && allHeard)) hits.push(i);
  });
  const byWords = hits.length === 1 ? hits[0] : -1;
  // 2. Which letter was heard?
  let byLetter = -1;
  const m = t.match(/\b(?:option|letter|choice|answer|number)\s+([a-e]|hey|ay|eh|bee|see|sea|dee)\b/);
  if (m && SPOKEN[m[1]] < choices.length) byLetter = SPOKEN[m[1]];
  const words = t.split(' ');
  const FILLER = new Set(['um', 'uh', 'er', 'hmm', 'is', 'its', "it's", 'it', 'the', 'ah', 'oh']);
  if (byLetter === -1 && words.length <= 2) {
    // a lone "a" is the letter A only when nothing but a filler word comes with it
    const w = words.find((x) => x in SPOKEN && (x !== 'a' || words.every((y) => y === 'a' || FILLER.has(y))));
    if (w !== undefined && SPOKEN[w] < choices.length) byLetter = SPOKEN[w];
  }
  if (byLetter === -1) { const o = t.match(/\b(first|second|third|fourth|fifth)\b/); if (o && ORDINAL[o[1]] < choices.length) byLetter = ORDINAL[o[1]]; }
  // 3. If a letter and a different choice's words disagree ("hey mouse"), the words win.
  if (byLetter !== -1 && byWords !== -1 && byLetter !== byWords) return byWords;
  return byLetter !== -1 ? byLetter : byWords;
}

// Several spoken letters ("A and C", "hey, see, dee", "B then A then C"). Returns the choice positions in the order said,
// or null if anything else was heard. Numbers and "first, second" count as positions only when `numbers` is on.
const LETTERS = { ...SPOKEN, ee: 4, f: 5, ef: 5, eff: 5, g: 6, gee: 6, jee: 6, h: 7, aitch: 7 };
const NUMBER = { 1: 0, one: 0, 2: 1, two: 1, 3: 2, three: 2, 4: 3, four: 3, 5: 4, five: 4, 6: 5, six: 5, 7: 6, seven: 6, 8: 7, eight: 7, ...ORDINAL };
const SKIP = new Set(['and', 'then', 'um', 'uh', 'er', 'hmm', 'the', 'letter', 'letters', 'option', 'options', 'choice', 'choices', 'answer', 'answers', 'is', 'are', 'its', "it's", 'it', 'i', 'think', 'say', 'plus', 'also', 'next', 'comes', 'number']);
export function matchLetters(heard, count, numbers = false) {
  const t = clean(heard);
  if (!t) return null;
  if (numbers && /^(all|all of them|all of the above|every one|everything|all (?:four|five|three|six))$/.test(t)) return Array.from({ length: count }, (_, i) => i);
  const out = [];
  for (const w of t.split(' ')) {
    let found = null;
    if (w in LETTERS) found = [LETTERS[w]];
    else if (numbers && w in NUMBER) found = [NUMBER[w]];
    else if (SKIP.has(w)) continue;
    else if (/^[a-h]{2,8}$/.test(w) && new Set(w).size === w.length) found = [...w].map((ch) => ch.charCodeAt(0) - 97); // "acd" run together
    if (!found || found.some((i) => i >= count)) return null;
    out.push(...found);
  }
  if (!out.length || new Set(out).size !== out.length) return null;
  return out;
}
// Judges spoken letters for "select all" (any order) and "put in order" (exact order). Null means unclear.
export function judgeLetters(c, heard) {
  const said = matchLetters(heard, c.choices.length, c.type === 'multi');
  if (!said) return null;
  const want = answerLetters(c).map((l) => l.charCodeAt(0) - 65);
  if (c.type === 'multi') return said.length === want.length && want.every((i) => said.includes(i));
  return said.length === want.length && said.every((i, k) => i === want[k]);
}

// Short spoken commands. Only short phrases count, so a real answer is never mistaken for a command.
export function detectCommand(heard) {
  const t = clean(heard);
  if (!t || t.split(' ').length > 7) return null;
  const polite = '(?:please |can you |could you |can we |let\'s |lets )?';
  if (t === 'again' || new RegExp('^' + polite + '(?:repeat|say (?:that|it) again|read (?:that|it|the question) again)').test(t)) return 'repeat';
  if (t.split(' ').length <= 5 && new RegExp('^' + polite + '(?:skip|next question)\\b').test(t)) return 'skip';
  if (t === 'pass') return 'skip';
  return null;
}

// Short and plain: one word for a right answer, one for a wrong one.
export const RIGHT = 'Right.';
export const WRONG = 'Wrong.';
export const praise = () => RIGHT;

export function revealCanned(c, qd) {
  if (isPick(c)) return WRONG;
  return `${WRONG} The answer is: ${qd.expected}`;
}

// Shown on screen (not spoken) after a wrong choice.
export function answerLine(c) {
  if (c.type === 'tf') return `Answer: ${c.answer}`;
  if (c.type === 'multi') return `Answer: ${sayLetters(answerLetters(c))}`;
  if (c.type === 'order') return `Answer: ${answerLetters(c).join(', ')}`;
  const i = c.choices.findIndex((x) => x === c.answer);
  return `Answer: ${String.fromCharCode(65 + (i < 0 ? 0 : i))}. ${c.answer}`;
}

export const TUTOR_SYSTEM = `You are a warm, encouraging voice tutor for a teenager. You judge a SPOKEN answer against the expected answer. The transcript comes from speech recognition, so forgive homophones, missing punctuation and small slips. Never read long lists. Keep every spoken reply to at most 2 short sentences (about 25 words).
Reply with ONLY JSON: {"verdict":"correct|mostly|partial|incorrect|dont_know","got_right":"short phrase or empty","missing":"short phrase or empty","spoken":"what you say next"}.
Verdicts: "correct" = all essential points are there (different wording is fine). "mostly" = essentially right, one small detail missing or slightly off. "partial" = some right, some missing or wrong. "incorrect" = wrong or off-topic. "dont_know" = the student says they do not know or makes no attempt.
Modes: In mode "grade": for "correct" or "mostly", praise briefly and name what they got right (for "mostly", mention the small missing detail). For "partial", "incorrect" or "dont_know", do NOT reveal the expected answer unless final_attempt is true. Say what they got right (if anything), then give ONE hint or ask ONE short follow-up question that guides them toward the missing part. Each new hint must be different from the previous hints and a little more helpful.
If final_attempt is true and the answer is not correct or mostly correct, do not give another hint: say the correct answer in your own words, then one very short tip to remember it.
In mode "hint": the student chose a wrong option from a list. Do NOT say which option is correct. Give ONE short hint that helps them reason toward it.
Length: for "correct" use at most 8 words (like "Yes, that's right!"); for "mostly" at most 18 words; for hints at most 25 words.
If the student says they do not know or are not sure, your hint must be clearly different and more specific than every earlier hint (for example give the first letter, a related fact, or a small example). Never repeat an earlier hint.
This app is English-only: always reply in English. If the student's words are not English or make no sense as an attempt, use verdict "dont_know" and kindly ask them to answer in English.
Be kind, never sarcastic, and always use plain spoken language.`;

export function buildTutorMessages(p) {
  return [{ role: 'system', content: TUTOR_SYSTEM }, { role: 'user', content: JSON.stringify(p) }];
}

export function parseTutor(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let d = null;
  try { d = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1)); } catch { /* handled below */ }
  if (!d || typeof d.spoken !== 'string' || !d.spoken.trim() || !d.verdict) throw Object.assign(new Error('The tutor answer was not understood.'), { parse: true });
  return { verdict: String(d.verdict), spoken: d.spoken.trim(), gotRight: d.got_right || '', missing: d.missing || '' };
}

// What the speech recognizer is told to expect. It never gets the correct answer on its own: only the whole project's vocabulary or all the choices.
export function sttContext(c, qd, deck) {
  const base = 'A student is answering study questions out loud in English.';
  const short = (x) => { const s = String(x).trim(); return s.length <= 40 ? s : s.split(/\s+/).slice(0, 4).join(' '); };
  if (c.type === 'tf') return { prompt: `${base} The question is a true or false statement, and the answer is the word true or the word false.`, keywords: ['true', 'false'] };
  if (c.type === 'mc') return { prompt: `${base} The question has lettered choices. The student says a letter (A, B, C or D) or the choice itself. Question: ${qd.shown}`.slice(0, 380), keywords: c.choices.map(short) };
  if (isLetters(c)) return { prompt: `${base} The question has lettered choices. The student says several letters, for example "A, C and D". Question: ${qd.shown}`.slice(0, 380), keywords: c.choices.map(short) };
  const vocab = [...new Set(deck.filter((x) => x.type === 'term').map((x) => short(x.term)))].slice(0, 40);
  return { prompt: `${base} Short answers, even a single word, are common. Question: ${qd.shown}`.slice(0, 380), keywords: vocab };
}

// This app is English-only. Anything that comes back in another alphabet, with letters English does not use,
// or that the recognizer says is another language, is treated as "not understood".
export function isEnglishSpeech(text, languages) {
  if (Array.isArray(languages) && languages.length && !languages.some((l) => String((l && l.code) || l).toLowerCase().startsWith('en'))) return false;
  return !/[^\u0000-\u007F\u2018\u2019\u201C\u201D\u2013\u2014\u2026]/.test(String(text || ''));
}

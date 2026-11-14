// The voice tutor's rules: how a question is spoken, how a spoken choice is understood, and what the AI is asked.
import { normalize, isCorrect } from './stats.js';

const L = (i) => String.fromCharCode(65 + i);

export function describeQuestion(c, ask = 'term') {
  if (c.type === 'tf') return { kind: 'true/false', label: 'True or false?', shown: c.prompt, spoken: `True or false: ${c.prompt}`, expected: c.answer, choices: c.choices };
  if (c.type === 'mc') return { kind: 'multiple choice', label: 'Choose the correct answer', shown: c.prompt, spoken: `${c.prompt} ${c.choices.map((t, i) => `${L(i)}, ${t}.`).join(' ')}`, expected: c.answer, choices: c.choices };
  if (c.type === 'qa') return { kind: 'question', label: 'Answer this question', shown: c.prompt, spoken: c.prompt, expected: c.answer, choices: null };
  const reversed = ask === 'definition';
  return reversed
    ? { kind: 'word', label: 'Which word matches this definition?', shown: c.definition, spoken: `Which word matches this definition? ${c.definition}`, expected: c.term, choices: null }
    : { kind: 'definition', label: 'What is the definition of…', shown: c.term, spoken: `What is the definition of ${c.term}?`, expected: c.definition, choices: null };
}

// Tries per kind: true/false has one, multiple choice two, spoken answers three.
export const maxAttempts = (c) => (c.type === 'tf' ? 1 : c.type === 'mc' ? 2 : 3);
// Counts as "right" (done) only if no real help was needed.
export const countsRight = (c, attempt) => (c.type === 'tf' || c.type === 'mc' ? attempt === 1 : attempt <= 2);

function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const SPOKEN = { a: 0, b: 1, c: 2, d: 3, e: 4, bee: 1, be: 1, see: 2, sea: 2, dee: 3 };
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
  const m = t.match(/\b(?:option|letter|choice|answer|number)\s+([a-e]|bee|see|sea|dee)\b/);
  if (m && SPOKEN[m[1]] < choices.length) return SPOKEN[m[1]];
  const words = t.split(' ');
  const FILLER = new Set(['um', 'uh', 'er', 'hmm', 'is', 'its', "it's", 'it', 'the', 'ah', 'oh']);
  if (words.length <= 2) {
    // a lone "a" is the letter A only when nothing but a filler word comes with it
    const w = words.find((x) => x in SPOKEN && (x !== 'a' || words.every((y) => y === 'a' || FILLER.has(y))));
    if (w !== undefined && SPOKEN[w] < choices.length) return SPOKEN[w];
  }
  const o = t.match(/\b(first|second|third|fourth|fifth)\b/);
  if (o && ORDINAL[o[1]] < choices.length) return ORDINAL[o[1]];
  const nt = normalize(heard);
  const hits = [];
  norm.forEach((nc, i) => {
    if (!nc) return;
    const cw = nc.split(' '), tw = nt.split(' ');
    // every word of the choice is heard, allowing a one-letter slip in longer words ("conscious" for "conscience")
    const allHeard = cw.every((w) => tw.some((x) => x === w || (w.length >= 6 && x.length >= 6 && (lev(x, w) <= 2 || x.slice(0, 6) === w.slice(0, 6)))));
    if ((nc.length >= 3 && nt.includes(nc)) || (nt.length >= 4 && nc.includes(nt)) || isCorrect(heard, choices[i]) || (cw.length >= 1 && nc.length >= 3 && allHeard)) hits.push(i);
  });
  return hits.length === 1 ? hits[0] : -1;
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

const PRAISE = ['Correct!', "Yes, that's right!", 'Nice one!', 'Exactly right!'];
export const praise = (r = Math.random()) => PRAISE[Math.floor(r * PRAISE.length) % PRAISE.length];

export function revealCanned(c, qd) {
  if (c.type === 'tf') return `Not quite. The answer is ${qd.expected}.`;
  if (c.type === 'mc') { const i = c.choices.findIndex((x) => x === c.answer); return `Not quite. The correct answer is ${L(i < 0 ? 0 : i)}, ${c.answer}.`; }
  return `The answer is: ${qd.expected}`;
}

export const TUTOR_SYSTEM = `You are a warm, encouraging voice tutor for a teenager. You judge a SPOKEN answer against the expected answer. The transcript comes from speech recognition, so forgive homophones, missing punctuation and small slips. Never read long lists. Keep every spoken reply to at most 2 short sentences (about 25 words).
Reply with ONLY JSON: {"verdict":"correct|mostly|partial|incorrect|dont_know","got_right":"short phrase or empty","missing":"short phrase or empty","spoken":"what you say next"}.
Verdicts: "correct" = all essential points are there (different wording is fine). "mostly" = essentially right, one small detail missing or slightly off. "partial" = some right, some missing or wrong. "incorrect" = wrong or off-topic. "dont_know" = the student says they do not know or makes no attempt.
Modes: In mode "grade": for "correct" or "mostly", praise briefly and name what they got right (for "mostly", mention the small missing detail). For "partial", "incorrect" or "dont_know", do NOT reveal the expected answer unless final_attempt is true. Say what they got right (if anything), then give ONE hint or ask ONE short follow-up question that guides them toward the missing part. Each new hint must be different from the previous hints and a little more helpful.
If final_attempt is true and the answer is not correct or mostly correct, do not give another hint: say the correct answer in your own words, then one very short tip to remember it.
In mode "hint": the student chose a wrong option from a list. Do NOT say which option is correct. Give ONE short hint that helps them reason toward it.
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

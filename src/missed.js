// "What's Missed?": whole lines of the study material with some words left out, to be said from memory.
// No AI: fixed rules choose the words. Pure functions (tests/missed.test.mjs).

export const LEVELS = [
  { id: 'superEasy', label: 'Super easy', hint: 'Second half of 2-3 words' },
  { id: 'easy', label: 'Easy', hint: '1 word is left out' },
  { id: 'hard', label: 'Hard', hint: '2 words are left out' },
  { id: 'superHard', label: 'Super hard', hint: '3-4 words are left out' },
];

const STOP = new Set(('a an the of and or but nor to in on at by for from with without into onto upon over under about as is are was were be been being am do does did has have had it its this that these those there their they them he she his her him we our us you your i not no so if than then also can could may might shall should will would which who whom whose what when where why how any all each every some such other than very just only').split(' '));
const SPLIT = /^([^\p{L}\p{N}]*)([\p{L}\p{N}][\p{L}\p{N}'\u2019-]*(?:[.,][\p{N}]+)?)(.*)$/u;
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 1000 / 1000; };

// The lines of every selected block, page by page. A list gives one line per item; other blocks give their source sentences.
export function missedLines(files) {
  const out = []; const seen = new Set();
  const add = (t, context = '') => {
    const text = String(t || '').replace(/^[\s\-\u2022*\u2013\u2014]+/, '').replace(/\s+/g, ' ').trim();
    if (text.length < 3 || seen.has(text.toLowerCase()) || !tokens(text).some((x) => x.cand)) return;
    seen.add(text.toLowerCase()); out.push({ text, context });
  };
  for (const f of files || []) {
    for (const b of f.blocks || []) {
      if (b.on === false) continue;
      if (b.type === 'list' && Array.isArray(b.items) && b.items.length) { b.items.forEach((t) => add(t, b.subject)); continue; }
      String(b.source || '').split(/\n+/).forEach((ln) => ln.split(/(?<=[.!?])\s+(?=[A-Z0-9\u201c"(])/).forEach((t) => add(t, b.subject)));
    }
  }
  return out;
}

// Splits a line into words with their punctuation, and marks the words that can be left out.
function tokens(text) {
  const parts = text.split(/(\s+)/);
  let w = 0;
  return parts.map((p) => {
    if (!p || /^\s+$/.test(p)) return { raw: p, cand: false };
    const m = SPLIT.exec(p);
    if (!m) return { raw: p, cand: false };
    const [, lead, core, trail] = m;
    const idx = w++;
    const lower = core.toLowerCase();
    const roman = /^[IVXLC]+$/.test(core);
    const digits = /\d/.test(core);
    const cand = digits || roman || !STOP.has(lower);
    let score = (digits ? 5 : roman ? 4 : 0) + (/^\p{Lu}/u.test(core) && idx > 0 ? 3 : 0) + (core.length >= 7 ? 2 : core.length >= 4 ? 1 : 0);
    return { raw: p, lead, core, trail, idx, cand, score };
  });
}

const howMany = (level, n) => {
  if (n <= 1) return 1;
  const half = Math.max(1, Math.floor(n / 2));
  if (level === 'superEasy') return n >= 8 ? 3 : 2;
  if (level === 'hard') return Math.min(2, half);
  if (level === 'superHard') return Math.min(n >= 8 ? 4 : 3, half);
  return 1; // easy
};

// The line as pieces: {text} is shown, {gap} is a dotted pill that shows its word when tapped. At "super easy" a gap is the second half of a word.
export function makeMissed(line, level, seed = 0) {
  const toks = tokens(line.text);
  // At super easy a number (4, IV) is never covered: it stays visible beside the half word.
  const isNum = (t) => /\d/.test(t.core) || /^[IVXLC]+$/.test(t.core);
  const cands = toks.filter((t) => t.cand && !(level === 'superEasy' && isNum(t)));
  const n = cands.length ? howMany(level, cands.length) : 0;
  const ranked = [...cands].sort((a, b) => (b.score + hash(seed + ':' + b.idx + b.core)) - (a.score + hash(seed + ':' + a.idx + a.core)));
  const chosen = new Set(ranked.slice(0, n));
  const segs = []; let gaps = 0;
  const pushText = (t) => { if (!t) return; const l = segs[segs.length - 1]; if (l && l.text !== undefined) l.text += t; else segs.push({ text: t }); };
  for (const t of toks) {
    if (!chosen.has(t)) { pushText(t.raw); continue; }
    let keep = 0;
    if (level === 'superEasy' && t.core.length >= 2) keep = Math.floor(t.core.length / 2);
    pushText(t.lead + t.core.slice(0, keep));
    const g = { gap: t.core.slice(keep) };
    // A word of 4 or more letters gets a first-2-letters hint on the first tap. Not at super easy (half the word is already shown), and not for numbers or Roman numerals.
    if (level !== 'superEasy' && /^\p{L}+$/u.test(t.core) && !/^[IVXLC]+$/.test(t.core) && t.core.length >= 4) g.hint = t.core.slice(0, 2);
    segs.push(g); gaps++;
    pushText(t.trail);
  }
  return { segs, gaps };
}

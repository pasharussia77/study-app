import { missedLines, makeMissed, LEVELS } from '../src/missed.js';
import { contextFor } from '../src/deck.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const files = [{ blocks: [
  { type: 'list', on: true, items: ['IV — Search and seizure', 'V — Rights of the accused', 'VI — Speedy trial'], source: 'x' },
  { type: 'fact', on: false, source: 'This one is unselected.' },
  { type: 'fact', source: 'Plants make food from light. They also release oxygen.' },
] }, { off: [], blocks: [{ type: 'fact', on: false, source: 'Another unselected block.' }] }];
const L = missedLines(files);
ok(L.length === 5 && L[0].text.startsWith('IV') && L[3].text === 'Plants make food from light.', 'lines: list items then sentences, in page order, unselected blocks left out, an empty off list on a page changes nothing (' + L.length + ')');
const gaps = (lv, t) => makeMissed({ text: t }, lv, 3);
const long = 'The right of the people to be secure in their persons, houses, papers, and effects, shall not be violated.';
ok(gaps('easy', long).gaps === 1 && gaps('hard', long).gaps === 2 && gaps('superHard', long).gaps === 4 && gaps('superEasy', long).gaps === 3, 'long line: easy 1, hard 2, super hard 4, super easy 3');
const mid = 'Congress makes the laws';
ok(gaps('superEasy', mid).gaps === 2 && gaps('superHard', mid).gaps === 1, 'short line: super easy 2, super hard capped at half the words');
ok(gaps('superEasy', 'Photosynthesis').gaps === 1 && gaps('hard', 'Photosynthesis').gaps === 1, 'one word line: one gap');
const se = gaps('superEasy', long); const half = se.segs.filter((s) => s.gap !== undefined);
ok(half.every((s, n) => { const before = se.segs[se.segs.indexOf(s) - 1]; return before && /[A-Za-z]$/.test(before.text) && s.gap.length >= 1; }), 'super easy: a gap always follows the first half of its word');
const rebuild = (r) => r.segs.map((s) => (s.gap !== undefined ? s.gap : s.text)).join('');
ok(LEVELS.every((l) => rebuild(makeMissed({ text: long }, l.id, 1)) === long), 'every level rebuilds the whole line when the gaps are filled');
ok(rebuild(makeMissed({ text: 'IV — Search and seizure' }, 'easy', 1)) === 'IV — Search and seizure', 'dash stays');
ok(JSON.stringify(makeMissed({ text: long }, 'hard', 7)) === JSON.stringify(makeMissed({ text: long }, 'hard', 7)), 'same seed, same gaps');
const seNum = makeMissed({ text: 'IV — Searches and seizures' }, 'superEasy', 2);
ok(seNum.segs[0].text !== undefined && seNum.segs[0].text.startsWith('IV —') && seNum.gaps >= 1, 'super easy: a Roman numeral is never covered, it stays beside the half word');
ok(makeMissed({ text: 'In 1787 it began' }, 'superEasy', 2).segs.every((s) => s.gap === undefined || !/\d/.test(s.gap)), 'super easy: a number is never covered');
ok(makeMissed({ text: '1787' }, 'superEasy', 2).gaps === 0, 'super easy: a line with only a number has nothing to cover');
ok(makeMissed({ text: 'IV — Searches and seizures' }, 'easy', 2).gaps === 1, 'other levels can still cover a number');
const hl = (lv, t) => makeMissed({ text: t }, lv, 3).segs.filter((s) => s.gap !== undefined);
ok(hl('easy', long).every((s) => s.hint && s.hint.length === 2 && s.gap.toLowerCase().startsWith(s.hint.toLowerCase())), 'easy: a long word gets a hint of its first 2 letters');
ok(hl('superEasy', long).every((s) => s.hint === undefined), 'super easy: no hint step (half the word is already shown)');
ok(hl('easy', 'Article IV').every((s) => s.hint === undefined) && hl('easy', 'In 1787 it began').every((s) => s.hint === undefined), 'a Roman numeral or a number goes straight to the word');
ok(hl('easy', 'The cat sat').every((s) => s.hint === undefined), 'a word of 3 letters or fewer goes straight to the word');
const ctxFiles = [{ blocks: [{ type: 'list', on: true, subject: 'Constitutional amendments', items: ['I — Freedom of religion'], source: 'x' }, { type: 'fact', subject: 'Photosynthesis', source: 'Plants make food from light.' }] }];
const CL = missedLines(ctxFiles);
ok(CL[0].context === 'Constitutional amendments' && CL[1].context === 'Photosynthesis', 'each line carries its block subject as context');
ok(contextFor({ context: 'Constitutional amendments', prompt: 'What is number I?', answer: 'Freedom of religion' }) === 'Constitutional amendments', 'context label is shown above a question');
ok(contextFor({ context: 'Photosynthesis', prompt: 'What does photosynthesis make?', answer: 'Sugar' }) === '', 'context is left out when the question already says it');
ok(contextFor({ context: 'Legislative Branch', prompt: 'What is ARTICLE I?', answer: 'Legislative Branch' }) === '', 'context is left out when it would give the answer away');
process.exit(fails ? 1 : 0);

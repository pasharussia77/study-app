import { missedLines, makeMissed, LEVELS } from '../src/missed.js';
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
process.exit(fails ? 1 : 0);

// Rule tests built on the "Chapter 5 Review" fixture (six photos, answers handwritten in red).
// Run with: npm test
import { resolvePage, resolveItem, reapplyItem, readTrueFalse, duplicateGroups, buildPrompt } from '../src/items.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.log('FAIL: ' + name); } };
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), `${name} (got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)})`);

const TF = [{ label: 'A', text: 'True' }, { label: 'B', text: 'False' }];
const base = { marked_wrong: false, circled_choice: null, printed_answer: null, answer_text: null, confidence: 'high', note: '', needs_review: false };
const fill = { 1: 'equality', 2: 'God-given', 3: 'laws', 4: 'Congress, obeyed', 5: 'tax', 6: 'Veterans', 7: 'property', 8: 'Rebellion, debt',
  32: 'doubled', 33: 'President Jefferson, Meriwether Lewis', 34: 'William Clark', 35: 'Sacagawea', 36: 'Corps of Discovery' };
const tf = { 9: 'T', 10: 'George Washington', 11: 'T', 12: 'House', 13: 'T', 14: 'T', 15: 'T', 16: 'Anti-Federalists', 37: 'T', 38: 'T', 39: 'James Madison', 40: 'T' };
const match = { 17: 'D', 18: 'B', 19: 'F', 20: 'G', 21: 'H', 22: 'A', 23: 'C', 24: 'E', 25: 'J', 26: 'L', 27: 'I', 28: 'K', 29: 'O', 30: 'M', 31: 'N' };
const bank = 'ABCDEFGHIJKLMNO'.split('').map((l) => ({ label: l, text: 'Meaning ' + l }));

// What the AI reports for the pages (it only records what it sees).
const raw = [];
for (const [n, a] of Object.entries(fill)) raw.push({ ...base, type: 'qa', number: +n, question: `Fill in ${n} ____`, answer_text: a });
for (const [n, a] of Object.entries(tf)) raw.push({ ...base, type: 'tf', number: +n, question: `Statement ${n}`, choices: TF, student_answer: a });
for (const [n, a] of Object.entries(match)) raw.push({ ...base, type: 'mc', number: +n, question: `Term ${n}`, choices: bank, student_answer: a });
raw.sort((a, b) => a.number - b.number);

// --- A. Ungraded page: handwriting is the answer key ---
const key = resolvePage({ page: { graded: false, score: null }, items: raw }).items;
eq(key.length, 40, 'all 40 fixture items (1-40) are kept');
eq(key.filter((i) => !i.answer).length, 0, 'every item 1-40 has an answer');
eq(key.filter((i) => i.flagged).length, 0, 'no item 1-40 is flagged');
const by = (list, n) => list.find((i) => i.number === n);
for (const [n, a] of Object.entries(fill)) eq(by(key, +n).answer, a, `fill-in ${n}`);
for (const [n, a] of Object.entries(match)) eq(by(key, +n).correctLabel, a, `matching ${n}`);
for (const [n, a] of Object.entries(tf)) {
  const it = by(key, +n);
  eq(it.answer, a === 'T' ? 'True' : 'False', `true/false ${n} answer`);
  eq(it.correction, a === 'T' ? '' : a, `true/false ${n} correction`);
}
eq(by(key, 9).source, 'handwritten answer key', 'source label for the answer key');

// --- A. "Student's work" on an ungraded page keeps the old caution ---
const stu = resolvePage({ page: { graded: false }, items: raw }, null, 'student').items;
ok(stu.filter((i) => i.type !== 'qa').every((i) => !i.answer && i.flagged), 'student work, ungraded: choices stay unanswered and flagged');

// --- A. Graded page keeps the current logic ---
const g = (o) => resolveItem({ ...base, type: 'tf', question: 'S', choices: TF, ...o }, { graded: true });
eq(g({ student_answer: 'A' }).source, 'assumed correct (no red mark)', 'graded: no red mark means correct');
eq(g({ student_answer: 'A', marked_wrong: true }).answer, 'False', 'graded: red X on True means False');
eq(g({ student_answer: 'A', marked_wrong: true }).correction, '', 'graded: no correction from a wrong answer');
ok(g({ student_answer: 'A', marked_wrong: null }).flagged, 'graded: unsure mark is flagged');
eq(resolveItem({ ...base, type: 'mc', question: 'Q', choices: bank, student_answer: 'C', marked_wrong: true }, { graded: true }).answer, null, 'graded: wrong multiple choice has no answer');

// --- Flag only when the AI cannot read it ---
ok(resolveItem({ ...base, type: 'tf', question: 'S', choices: TF, student_answer: 'T', needs_review: true }, {}).flagged, 'the AI asking for a check still flags');
ok(resolveItem({ ...base, type: 'tf', question: 'S', choices: TF, student_answer: 'T', confidence: 'low' }, {}).flagged, 'low confidence still flags');
ok(resolveItem({ ...base, type: 'mc', question: 'Q', choices: bank, student_answer: 'Z' }, {}).flagged, 'a letter that is not a choice is flagged');
ok(resolveItem({ ...base, type: 'mc', question: 'Q', choices: bank }, {}).flagged, 'no handwriting at all is flagged');

// --- B. True/false reading ---
const r = (v) => readTrueFalse(v, TF);
eq(r('T'), { label: 'A', correction: '' }, 'T');
eq(r('t.'), { label: 'A', correction: '' }, 't.');
eq(r('True'), { label: 'A', correction: '' }, 'True');
eq(r('F'), { label: 'B', correction: '' }, 'F');
eq(r('false'), { label: 'B', correction: '' }, 'false');
eq(r('B'), { label: 'B', correction: '' }, 'letter B');
eq(r('House'), { label: 'B', correction: 'House' }, 'a word is False plus correction');
eq(r('F - George Washington'), { label: 'B', correction: 'George Washington' }, 'F with a correction');
eq(r('False: House'), { label: 'B', correction: 'House' }, 'False: word');
eq(r('Federalists'), { label: 'B', correction: 'Federalists' }, 'a word starting with F is not F');
eq(r('Tax'), { label: 'B', correction: 'Tax' }, 'a word starting with T is not T');
eq(r(''), null, 'empty');
eq(readTrueFalse('T', [{ label: 'T', text: 'True' }, { label: 'F', text: 'False' }]), { label: 'T', correction: '' }, 'T/F printed as labels');

// --- E. Re-apply the rules to items stored by the old version (no AI) ---
const oldStored = raw.map((x, i) => {
  const choice = x.type !== 'qa';
  return { id: 'i' + i, fileId: 'f1', type: x.type, number: x.number, question: x.question, choices: choice ? x.choices : [], correctLabel: null,
    answer: choice ? null : x.answer_text, source: choice ? 'none' : 'page', studentAnswer: x.student_answer || null, markedWrong: false, confidence: 'high',
    note: choice ? 'The page has no grading, so the student\u2019s answer may be wrong.' : '', order: i, circled: null, printed: null, flagged: choice };
});
eq(oldStored.filter((i) => i.flagged).length, 27, 'old version: 27 of items 1-40 were flagged');
const fixed = oldStored.map((it) => ({ ...it, ...(reapplyItem(it, { graded: false, hand: 'key' }) || {}) }));
eq(fixed.filter((i) => i.flagged || !i.answer).length, 0, 're-apply: all of items 1-40 usable');
eq(by(fixed, 10).correction, 'George Washington', 're-apply: correction 10');
eq(by(fixed, 29).correctLabel, 'O', 're-apply: matching 29');
eq(by(fixed, 12).note, '', 're-apply: the old warning is removed');
eq(reapplyItem({ ...oldStored[20], source: 'set by you' }, {}), null, 're-apply leaves your own edits alone');
eq(reapplyItem({ ...oldStored[20], fileId: 'text' }, {}), null, 're-apply leaves typed-text items alone');
ok(reapplyItem({ ...by(oldStored, 9), note: 'Red mark is smudged and unclear. The page has no grading, so the student\u2019s answer may be wrong.' }, {}).flagged, 're-apply keeps the flag when the AI could not read it');
eq(reapplyItem(by(fixed, 9), { graded: false, hand: 'key' }), null, 're-apply twice changes nothing');
ok(!reapplyItem(by(oldStored, 9), { graded: false, hand: 'student' })?.answer, 're-apply as student work gives no answer');

// --- G. Duplicates (one page photographed twice) ---
const twice = [...fixed.slice(0, 8).map((i) => ({ ...i, createdAt: 1 })), ...oldStored.slice(0, 8).map((i) => ({ ...i, id: 'd' + i.id, fileId: 'f2', createdAt: 2 }))];
const groups = duplicateGroups(twice);
eq(groups.length, 8, 'eight duplicated questions found');
ok(groups.every((x) => x.keep.fileId === 'f1' && x.drop.length === 1), 'the usable copy is kept');
eq(duplicateGroups(fixed).length, 0, 'no false duplicates in the real set');

// --- Prompt ---
ok(buildPrompt('none', null, 'key').includes('ANSWER KEY'), 'prompt: answer-key note present');
ok(!buildPrompt('none', null, 'student').includes('ANSWER KEY'), 'prompt: no answer-key note for student work');
ok(!buildPrompt('handwriting', null, 'key').includes('ANSWER KEY'), 'prompt: no answer-key note when handwriting is ignored');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

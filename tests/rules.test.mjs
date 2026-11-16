// Rule tests built on the "Chapter 5 Review" fixture (six photos, answers handwritten in red).
// Run with: npm test
import { resolvePage, resolveItem, reapplyItem, readTrueFalse, duplicateGroups, buildPrompt, buildTextPrompt, parseLabels, fixNumbers } from '../src/items.js';
import { buildDeck, cardFaces, answerLetters, withNumber, inPageOrder, tidy } from '../src/deck.js';
import { parseCards, shorterIsTerm } from '../src/parse.js';
import { buildReport, splitReport, latestReads } from '../src/report.js';
import { cardKey } from '../src/stats.js';
import { matchLetters, judgeLetters, describeQuestion, answerLine, maxAttempts, matchChoice } from '../src/tutor.js';
import { enhancePixels } from '../src/enhance.js';

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


// --- C. Select all that apply (filled circle = selected, hollow = not) ---
const five = 'ABCDE'.split('').map((l) => ({ label: l, text: 'Choice ' + l }));
const sel = { 41: [1, 2, 4, 5], 42: [1, 2, 3, 5], 43: [1, 2, 3, 4], 44: [1, 2, 4, 5], 45: [1, 2, 3, 4], 47: [2, 3] };
const size = { 41: 5, 42: 5, 43: 5, 44: 5, 45: 4, 47: 3 };
const rawSel = Object.entries(sel).map(([n, list]) => ({ ...base, type: 'multi', number: +n, question: `Mark the answers ${n}`,
  choices: five.slice(0, size[n]).map((c) => ({ label: '', text: c.text })), // no printed letters: the app letters them
  selected_choices: list.map((k) => 'ABCDE'[k - 1]), unclear_choices: [] }));
const rawOrder = { ...base, type: 'order', number: 46, question: 'Number the events in order', choices: five.map((c) => ({ label: '', text: 'Event ' + c.label })), order_numbers: [1, 4, 2, 5, 3] };
const page6 = resolvePage({ page: { graded: false }, items: [...rawSel, rawOrder] }).items;
eq(page6.filter((i) => i.flagged || !i.answer).length, 0, 'items 41-47: all usable, none flagged');
for (const [n, list] of Object.entries(sel)) eq(by(page6, +n).correctLabels, list.map((k) => 'ABCDE'[k - 1]), `select all ${n}`);
eq(by(page6, 41).answer, 'Choice A; Choice B; Choice D; Choice E', 'select all 41 answer text');
eq(by(page6, 46).correctOrder, ['A', 'C', 'E', 'B', 'D'], 'order 46: events sorted by their numbers');
eq(by(page6, 46).answer, '1. Event A; 2. Event C; 3. Event E; 4. Event B; 5. Event D', 'order 46 answer text');
eq(by(page6, 46).source, 'handwritten answer key', 'order 46 source');

// The whole fixture: 47 items, all usable, none flagged.
const all47 = [...key, ...page6];
eq(all47.length, 47, 'fixture has 47 items');
eq(all47.filter((i) => i.flagged || !i.answer).length, 0, 'FIXTURE: all 47 usable, none flagged');

const m = (o, pg = {}) => resolveItem({ ...base, type: 'multi', question: 'Q', choices: five, selected_choices: ['A', 'C'], unclear_choices: [], ...o }, pg);
eq(m({ selected_choices: ['1', '3'] }).correctLabels, ['A', 'C'], 'select all: numbers count as positions');
eq(m({ selected_choices: ['C', 'A'] }).correctLabels, ['A', 'C'], 'select all: kept in page order');
ok(m({ selected_choices: [] }).flagged && !m({ selected_choices: [] }).answer, 'select all: nothing filled is flagged');
ok(m({ unclear_choices: ['B'] }).flagged, 'select all: an unclear circle is flagged');
ok(m({ unclear_choices: ['B'] }).answer, 'select all: an unclear circle still keeps the clear ones');
ok(!m({}, { hand: 'student' }).answer, "select all: student's work on an ungraded page has no answer");
eq(m({}, { graded: true }).source, 'assumed correct (no red mark)', 'select all: graded, no red mark');
ok(!m({ marked_wrong: true }, { graded: true }).answer, 'select all: graded and marked wrong has no answer');
eq(m({ selected_choices: null, printed_answer: ['B', 'D'] }).correctLabels, ['B', 'D'], 'select all: printed key');
eq(m({ selected_choices: null, printed_answer: 'B, D' }).source, 'printed key', 'select all: printed key as text');
eq(resolveItem({ ...base, type: 'multi', question: 'Q', choices: [five[0]], selected_choices: ['A'] }, {}).type, 'qa', 'select all with one choice is not select all');
eq(parseLabels('A and C', five), ['A', 'C'], 'parseLabels: "A and C"');
eq(parseLabels(['A', 'Z'], five), null, 'parseLabels: unknown label');

// --- D. Number the events ---
const o = (nums, pg = {}) => resolveItem({ ...rawOrder, order_numbers: nums }, pg);
ok(o([1, 4, 2, 5, null]).flagged && !o([1, 4, 2, 5, null]).answer, 'order: a missing number is flagged');
ok(!o([1, 1, 2, 5, 3]).answer, 'order: a repeated number is not an order');
ok(!o(null).answer, 'order: no numbers at all');
eq(o(['2', '1', '3', '4', '5']).correctOrder, ['B', 'A', 'C', 'D', 'E'], 'order: numbers given as text');
ok(!o([1, 4, 2, 5, 3], { hand: 'student' }).answer, "order: student's work on an ungraded page has no answer");
eq(resolveItem({ ...rawOrder, order_numbers: null, printed_answer: ['B', 'A', 'C', 'D', 'E'] }, {}).correctOrder, ['B', 'A', 'C', 'D', 'E'], 'order: printed key');

// --- E. Re-apply works on the new types once they are stored ---
const storedSel = { ...by(page6, 41), id: 's41', fileId: 'f6' }, storedOrd = { ...by(page6, 46), id: 's46', fileId: 'f6' };
eq(reapplyItem(storedSel, { graded: false, hand: 'key' }), null, 're-apply: select all unchanged as answer key');
eq(reapplyItem(storedOrd, { graded: false, hand: 'key' }), null, 're-apply: order unchanged as answer key');
const asStudent = reapplyItem(storedSel, { graded: false, hand: 'student' });
ok(asStudent && asStudent.answer === null && asStudent.correctLabels === null && asStudent.flagged, 're-apply: select all as student work loses its answer');
eq(reapplyItem({ ...storedSel, ...asStudent }, { graded: false, hand: 'key' }).correctLabels, ['A', 'B', 'D', 'E'], 're-apply: and gets it back as answer key');
eq(reapplyItem({ ...storedOrd, ...reapplyItem(storedOrd, { hand: 'student' }) }, { hand: 'key' }).correctOrder, ['A', 'C', 'E', 'B', 'D'], 're-apply: order comes back too');

// --- Deck, flashcards ---
const { deck, notReady } = buildDeck([], all47.map((it, i) => ({ ...it, id: 'x' + i })));
eq([deck.length, notReady], [47, 0], 'deck: all 47 items are studyable');
const c41 = deck.find((c) => c.number === 41), c46 = deck.find((c) => c.number === 46);
eq(c41.answers, ['Choice A', 'Choice B', 'Choice D', 'Choice E'], 'deck: select-all answers');
eq(c46.sequence, ['Event A', 'Event C', 'Event E', 'Event B', 'Event D'], 'deck: order sequence');
eq(cardFaces(c41).bt, 'A. Choice A\nB. Choice B\nD. Choice D\nE. Choice E', 'flashcard back: select all');
eq(cardFaces(c46).bt, '1. Event A\n2. Event C\n3. Event E\n4. Event B\n5. Event D', 'flashcard back: order');
eq(cardFaces(c46).extra.length, 5, 'flashcard front: order lists the events');
eq(buildDeck([], [{ ...by(page6, 41), id: 'z', correctLabels: null }]).notReady, 1, 'deck: select all without labels is not studyable');

// --- Voice: several letters ---
eq(answerLetters(c41), ['A', 'B', 'D', 'E'], 'voice: letters for 41');
eq(answerLetters(c46), ['A', 'C', 'E', 'B', 'D'], 'voice: letters for 46');
eq(matchLetters('A and C', 5), [0, 2], '"A and C"');
eq(matchLetters('A, B, D, and E.', 5), [0, 1, 3, 4], '"A, B, D, and E."');
eq(matchLetters('hey bee dee', 5), [0, 1, 3], 'letters as heard by a recognizer');
eq(matchLetters('ABDE', 5), [0, 1, 3, 4], 'letters run together');
eq(matchLetters('I think B then A then C', 5), [1, 0, 2], 'filler words');
eq(matchLetters('A and F', 5), null, 'a letter past the last choice');
eq(matchLetters('A and A', 5), null, 'a repeated letter');
eq(matchLetters('the constitution', 5), null, 'not letters');
eq(matchLetters('', 5), null, 'silence');
eq(matchLetters('one, two and four', 5, true), [0, 1, 3], 'numbers for select all');
eq(matchLetters('1 4 2 5 3', 5), null, 'numbers are not accepted for put in order');
eq(matchLetters('all of them', 4, true), [0, 1, 2, 3], '"all of them"');
eq(judgeLetters(c41, 'E, D, B and A'), true, 'select all: any order is right');
eq(judgeLetters(c41, 'A, B and D'), false, 'select all: one missing is wrong');
eq(judgeLetters(c41, 'A, B, C, D and E'), false, 'select all: one extra is wrong');
eq(judgeLetters(c41, 'banana'), null, 'select all: unclear');
eq(judgeLetters(c46, 'A, C, E, B, D'), true, 'order: exact order is right');
eq(judgeLetters(c46, 'A, B, C, D, E'), false, 'order: wrong order');
eq(judgeLetters(c46, 'A, C, E'), false, 'order: incomplete');
eq(answerLine(c41), 'Answer: A, B, D and E', 'voice: answer line, select all');
eq(answerLine(c46), 'Answer: A, C, E, B, D', 'voice: answer line, order');
eq([maxAttempts(c41), maxAttempts(c46)], [1, 1], 'voice: one try for the new types');
eq(describeQuestion(c41).kind, 'select all', 'voice: kind select all');
ok(describeQuestion(c46).spoken.includes('A, Event A.'), 'voice: events are read with letters');
eq(matchChoice('true', ['True', 'False']), 0, 'voice: single choice still works');

// --- Prompts ---
ok(buildPrompt('none').includes('selected_choices') && buildPrompt('none').includes('order_numbers'), 'prompt: asks for filled circles and order numbers');
ok(buildTextPrompt().includes('"multi"') && buildTextPrompt().includes('"order"'), 'text prompt: knows the new types');

// --- F. Photo clean-up ---
function picture(paper, parts) { // parts: [[share, [r,g,b]]...], the rest is paper, with a little noise
  const n = 40000, d = new Uint8ClampedArray(n * 4);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 12;
  for (let i = 0; i < n; i++) {
    let x = (i * 37 % 1000) / 1000, col = paper;
    for (const [share, c] of parts) { if (x < share) { col = c; break; } x -= share; }
    const k = rnd();
    d[i * 4] = col[0] + k; d[i * 4 + 1] = col[1] + k; d[i * 4 + 2] = col[2] + k; d[i * 4 + 3] = 255;
  }
  return d;
}
const avg = (d, test) => { const s = [0, 0, 0]; let n = 0; for (let i = 0; i < d.length; i += 4) if (test(i / 4)) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++; } return s.map((v) => Math.round(v / n)); };
const zone = (lo, hi) => (i) => { const x = (i * 37 % 1000) / 1000; return x >= lo && x < hi; };
// A page under a yellow lamp, a bit dark: paper, black print (8%), red pen (5%).
const lamp = picture([200, 180, 120], [[0.08, [45, 38, 24]], [0.05, [165, 34, 20]]]);
const redBefore = avg(lamp, zone(0.08, 0.13));
const info = enhancePixels(lamp);
const paperAfter = avg(lamp, zone(0.13, 1)), inkAfter = avg(lamp, zone(0, 0.08)), redAfter = avg(lamp, zone(0.08, 0.13));
ok(info.applied && info.whiteBalance, 'clean-up: applied to the lamp-light page');
ok(Math.min(...paperAfter) >= 235, 'clean-up: paper is white (got ' + paperAfter + ')');
ok(Math.max(...paperAfter) - Math.min(...paperAfter) <= 8, 'clean-up: yellow cast is gone (got ' + paperAfter + ')');
ok(Math.max(...inkAfter) <= 45, 'clean-up: print stays dark (got ' + inkAfter + ')');
ok(redAfter[0] >= 170 && redAfter[1] <= redAfter[0] * 0.4 && redAfter[2] <= redAfter[0] * 0.4, 'clean-up: red ink is still clearly red (got ' + redAfter + ')');
ok(redAfter[0] - Math.max(redAfter[1], redAfter[2]) >= redBefore[0] - Math.max(redBefore[1], redBefore[2]), 'clean-up: red ink is not washed out (before ' + redBefore + ', after ' + redAfter + ')');
// A clean scan barely changes.
const scan = picture([250, 250, 250], [[0.1, [20, 20, 20]], [0.05, [210, 30, 30]]]);
enhancePixels(scan);
const scanRed = avg(scan, zone(0.1, 0.15));
ok(Math.min(...avg(scan, zone(0.15, 1))) >= 248 && scanRed[0] >= 200 && scanRed[1] <= 45, 'clean-up: a clean scan stays as it is (red ' + scanRed + ')');
// Not a page: left alone.
const dark = picture([60, 50, 40], [[0.1, [20, 20, 20]]]), darkCopy = dark.slice();
ok(!enhancePixels(dark).applied && dark.every((v, i) => v === darkCopy[i]), 'clean-up: a dark picture is left alone');
// Coloured paper keeps its colour.
const pink = picture([240, 150, 170], [[0.1, [30, 20, 25]]]);
const pinkInfo = enhancePixels(pink), pinkAfter = avg(pink, zone(0.1, 1));
ok(pinkInfo.applied && !pinkInfo.whiteBalance && pinkAfter[0] - pinkAfter[1] >= 70, 'clean-up: coloured paper keeps its colour (got ' + pinkAfter + ')');


// --- 0.15: the term is always the shorter side ---
ok(shorterIsTerm('Congress', 'the legislative branch that makes laws'), 'short before long: first is the term');
ok(!shorterIsTerm('the legislative branch that makes laws', 'Congress'), 'long before short: second is the term');
ok(shorterIsTerm('cat', 'dog'), 'same length: keep the order');
eq(shorterIsTerm('big cat', 'tiny'), false, 'fewer words wins over fewer letters');
eq(shorterIsTerm('ox', 'a very long animal name'), true, 'one word vs many words');
const pc = parseCards('Congress - the part of government that makes laws\nthe part of government that makes laws for the country - Senate\n12. Veto - to reject a bill\n13) to reject a bill and send it back - Veto\nnot a card');
eq(pc.cards.map((c) => c.term), ['Congress', 'Senate', 'Veto', 'Veto'], 'parseCards: the shorter side is the term');
eq(pc.cards.map((c) => c.swapped), [false, true, false, true], 'parseCards: swapped flag');
eq(pc.cards.map((c) => c.number), [null, null, 12, 13], 'parseCards: leading numbers are kept as numbers');
eq(pc.cards[2].rawTerm, '12. Veto', 'parseCards: the saved key still uses the original line');
eq(pc.skipped, 1, 'parseCards: a line with no separator is skipped');
eq(cardKey({ term: pc.cards[0].rawTerm, definition: pc.cards[0].rawDefinition }), cardKey({ term: 'Congress', definition: 'the part of government that makes laws' }), 'progress key is unchanged for a card that did not change');
const tdeck = buildDeck(pc.cards, [], []).deck;
eq(tdeck.map((c) => withNumber(c, c.prompt)), ['Congress', 'Senate', '12.\u00A0Veto', '13.\u00A0Veto'], 'typed cards show their numbers');

// AI-made word items: swapped when the question side is longer
const termRaw = (q, a) => ({ ...base, type: 'term', number: 3, question: q, answer_text: a });
const t1 = resolveItem(termRaw('the branch of government that makes laws', 'Congress'), {});
eq([t1.question, t1.answer, t1.swapped], ['Congress', 'the branch of government that makes laws', true], 'photo term: long side is moved to the definition');
const t2 = resolveItem(termRaw('Congress', 'the branch of government that makes laws'), {});
eq([t2.question, t2.answer, !!t2.swapped], ['Congress', 'the branch of government that makes laws', false], 'photo term: already right is left alone');
const storedTerm = { id: 't1', fileId: 'f1', type: 'term', number: 3, question: 'the branch of government that makes laws', answer: 'Congress', source: 'page', studentAnswer: null, markedWrong: false, confidence: 'high', note: '', order: 0, flagged: false, choices: [] };
const tp = reapplyItem(storedTerm, {});
eq([tp.question, tp.answer], ['Congress', 'the branch of government that makes laws'], 're-apply swaps a stored word that is the wrong way round');
eq(reapplyItem({ ...storedTerm, ...tp }, {}), null, 're-apply: swapped word is stable');
const qaStored = { ...storedTerm, id: 'q1', type: 'qa', question: 'Who wrote the Declaration of Independence?', answer: 'Jefferson' };
const qp = reapplyItem(qaStored, {});
ok(!qp || (qp.question === undefined && qp.answer === 'Jefferson'), 're-apply never swaps a question and its answer');

// --- 0.15: question numbers keep counting up ---
const seq1 = [{ number: 45, type: 'order', question: 'Number the events' }, { number: 47, type: 'multi', question: 'What is true' }];
eq(fixNumbers(seq1, { last_number: 45, type: 'multi' }), [0], 'photo 6: 45 after a page that ended at 45 becomes 46');
eq(seq1.map((x) => x.number), [46, 47], 'photo 6 numbers are 46, 47');
const seq2 = [{ number: 44, type: 'multi', question: 'a' }, { number: 45, type: 'multi', question: 'b' }, { number: 45, type: 'order', question: 'c' }, { number: 47, type: 'multi', question: 'd' }];
fixNumbers(seq2);
eq(seq2.map((x) => x.number), [44, 45, 46, 47], 'a repeated number inside a list is corrected when there is a gap');
const seq3 = [{ number: 45, type: 'multi', question: 'same question' }];
eq(fixNumbers(seq3, { last_number: 45, type: 'multi' }), [], 'the same kind of question continuing from the last page keeps its number');
const seq4 = [{ number: 5, type: 'qa', question: 'x' }, { number: 5, type: 'qa', question: 'y' }];
eq(fixNumbers(seq4), [1], 'a repeat at the very end is renumbered');
const seq5 = [{ number: 5, type: 'qa', question: 'x' }, { number: 5, type: 'qa', question: 'y' }, { number: 6, type: 'qa', question: 'z' }];
eq(fixNumbers(seq5), [], 'a repeat with no gap after it is left alone');
const seq6 = [{ number: null, type: 'qa', question: 'x' }, { number: null, type: 'qa', question: 'y' }];
eq(fixNumbers(seq6, { last_number: null }), [], 'no numbers, nothing to fix');
const p6 = resolvePage({ page: { graded: false }, ends_with: { last_number: 47 }, items: [{ ...rawOrder, number: 45 }, { ...rawSel[5], number: 47 }] }, { last_number: 45, type: 'multi' }).items;
eq(p6.map((i) => i.number), [46, 47], 'resolvePage applies the number rule using the page before');

// --- 0.15: original order, numbers on cards ---
const files3 = [{ id: 'fA', createdAt: 100 }, { id: 'fB', createdAt: 200 }, { id: 'fC', createdAt: 300 }];
const mk = (id, fileId, order, number) => ({ id, fileId, order, number, type: 'qa', question: 'Q ' + id, answer: 'A', source: 'page', createdAt: 1000 - order });
const jumbled = [mk('c2', 'fC', 1, 12), mk('a2', 'fA', 1, 2), mk('b1', 'fB', 0, 5), mk('a1', 'fA', 0, 1), mk('c1', 'fC', 0, 11), mk('b2', 'fB', 1, 6)];
eq(inPageOrder(jumbled, files3).map((i) => i.id), ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'], 'photos in the order added, then the order on each page');
const gone = [mk('g1', 'fGone', 0, 8), mk('a1', 'fA', 0, 1), mk('b1', 'fB', 0, 5)];
gone[0].createdAt = 150;
eq(inPageOrder(gone, files3).map((i) => i.id), ['a1', 'g1', 'b1'], 'items of a removed photo stay in place by when they were made');
const withText = [{ ...mk('t1', 'text', 1, 2), createdAt: 5 }, { ...mk('t0', 'text', 0, 1), createdAt: 5 }, mk('a1', 'fA', 0, 1)];
eq(inPageOrder(withText, files3).map((i) => i.id), ['t0', 't1', 'a1'], 'typed-text items come first, in order');
const dk = buildDeck([], jumbled, files3).deck;
eq(dk.map((c) => c.number), [1, 2, 5, 6, 11, 12], 'the deck follows the pages');
eq(withNumber(dk[2], dk[2].prompt), '5.\u00A0Q b1', 'number shown before the question');
eq(cardFaces(dk[0]).ft, '1.\u00A0Q a1', 'flashcard front shows the number');
eq(withNumber({ number: null }, 'Q'), 'Q', 'no number, nothing added');
eq(describeQuestion({ ...dk[0], type: 'qa' }).shown, '1.\u00A0Q a1', 'voice and quiz show the number');
ok(!describeQuestion({ ...dk[0], type: 'qa' }).spoken.startsWith('1.'), 'voice does not read the number aloud');

// --- 0.15: the report is short enough and comes in parts ---
const photoFiles = [1, 2, 3, 4, 5, 6].map((n) => ({ id: 'f' + n, ignore: 'none', hand: 'key', status: 'done', page: { graded: false }, made: 8, createdAt: n }));
const all = all47.map((it, i) => ({ ...it, id: 'r' + i, fileId: 'f' + (1 + Math.floor(i / 8)) }));
const longRaw = 'x'.repeat(4000);
const evs = photoFiles.map((f) => ({ t: Date.now(), type: 'photo_read', fileId: f.id, ignore: 'none', ok: true, raw: longRaw, ms: 9000, usage: { prompt_tokens: 3400, completion_tokens: 1500 }, made: 8 }));
const rep = buildReport({ version: '0.15.0', device: 'test', health: { model: 'm', hasKey: true }, profile: { name: 'Test', test: true }, project: { name: 'Ch5' }, text: '', parsed: { cards: [], skipped: 0, skippedLines: [] }, sum: { total: 47, covered: 0, remainingCount: 47, correct: 0, incorrect: 0 }, files: photoFiles, items: all, check: null, events: evs, notes: '' });
ok(rep.length < 16000, 'report for 47 items is short (' + rep.length + ' characters)');
ok(rep.includes('#10 tf') && rep.includes('fix: George Washington'), 'report: a true/false line carries its correction');
ok(rep.includes('#46 order') && rep.includes('#41 multi'), 'report: new types are in it');
ok(!rep.includes('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'), 'report: raw AI text is cut short');
const parts = splitReport(rep, 10000);
ok(parts.length >= 2 && parts.every((p) => p.length <= 10300), 'report splits into parts of at most about 10,000 characters (' + parts.map((p) => p.length) + ')');
ok(parts[0].startsWith('PART 1 of ' + parts.length) && parts[0].includes('more follows'), 'first part says it is first and that more follows');
ok(parts[parts.length - 1].endsWith('END OF REPORT (part ' + parts.length + ' of ' + parts.length + ')'), 'last part says it is the end');
const joined = parts.map((p) => p.split('\n').slice(1, -1).join('\n')).join('\n');
ok(rep.split('\n').every((line) => joined.includes(line)), 'no line of the report is lost by splitting');
eq(splitReport('short\nreport', 10000), ['short\nreport\nEND OF REPORT'], 'a short report stays one part');
ok(splitReport('a'.repeat(25000), 10000).every((p) => p.length < 10400), 'one huge line is still cut into pieces');


// --- 0.16: readable cards ---
eq(tidy('Shays’s ________ resulted'), 'Shays’s _____ resulted', 'long blanks are shortened to one even size');
eq(tidy('no blank here_ or __ two'), 'no blank here_ or __ two', 'one or two underscores are left alone');
eq(withNumber({ number: 35 }, '________ interpreted some'), '35.\u00A0_____ interpreted some', 'the number is glued to the blank so they never split');
ok(!/35\. /.test(withNumber({ number: 35 }, '_____ x')), 'no ordinary space after the number');
const c41b = deck.find((c) => c.number === 41), c46b = deck.find((c) => c.number === 46);
eq(cardFaces(c41b).list.map((x) => x.k), ['A', 'B', 'D', 'E'], 'select-all back is a list keyed by letter');
eq(cardFaces(c46b).list.map((x) => x.k), ['1 · A', '2 · C', '3 · E', '4 · B', '5 · D'], 'order back is a list: number, letter, text');
eq(cardFaces(c46b).list.map((x) => x.text), ['Event A', 'Event C', 'Event E', 'Event B', 'Event D'], 'order back list text');
eq(cardFaces(dk[0]).list, undefined, 'plain cards have no list');


// --- 0.17: handwriting read with only medium confidence needs a look (item 37: a T misread as F) ---
const tf37 = (o, pg = {}) => resolveItem({ ...base, type: 'tf', number: 37, question: 'Statement 37', choices: TF, student_answer: 'F', ...o }, pg);
ok(tf37({ confidence: 'medium' }).flagged, 'medium: a handwritten T/F read with medium confidence is flagged');
ok(tf37({ confidence: 'medium' }).answer === 'False', 'medium: the answer is kept, only flagged');
ok(tf37({ confidence: 'medium' }).note.includes('fairly sure'), 'medium: the note says why');
ok(!tf37({ confidence: 'high' }).flagged, 'medium: high confidence is not flagged');
ok(!resolveItem({ ...base, type: 'tf', question: 'Q', choices: TF, printed_answer: 'A', confidence: 'medium' }, {}).flagged, 'medium: a printed key is not handwriting, not flagged');
ok(!resolveItem({ ...base, type: 'term', question: 'cat', answer_text: 'a small furry pet', confidence: 'medium' }, {}).flagged, 'medium: printed text on the page is not flagged');
ok(resolveItem({ ...base, type: 'qa', question: 'All people have ____', student_answer: 'equality', confidence: 'medium' }, {}).flagged, 'medium: a handwritten fill-in is flagged');
ok(resolveItem({ ...base, type: 'multi', question: 'Q', choices: five, selected_choices: ['A', 'C'], unclear_choices: [], confidence: 'medium' }, {}).flagged, 'medium: hand-filled circles are flagged');
ok(resolveItem({ ...base, type: 'mc', question: 'Q', choices: five, student_answer: 'B', confidence: 'medium' }, { graded: true }).flagged, 'medium: graded page, handwritten answer is flagged');
const stored37 = { ...tf37({ confidence: 'medium' }), id: 'm37', fileId: 'f5', flagged: false, note: '' };
const re37 = reapplyItem(stored37, { graded: false, hand: 'key' });
ok(re37 && re37.flagged === true, 'medium: Re-apply the rules flags an item already stored');
const again37 = reapplyItem({ ...stored37, ...re37 }, { graded: false, hand: 'key' });
eq(again37, null, 'medium: re-applying twice changes nothing (the note is not repeated)');
eq(all47.filter((i) => i.flagged).length, 0, 'medium: the Chapter 5 fixture (all high) is still not flagged');

// --- 0.17: the report lists only the latest reading of each photo ---
const rd = (fileId, raw, extra = {}) => ({ t: Date.now(), type: 'photo_read', fileId, ignore: 'none', ok: true, raw, ms: 1000, usage: { prompt_tokens: 1, completion_tokens: 1 }, made: 1, ...extra });
const twoFiles = [{ id: 'fA', ignore: 'none', hand: 'key', status: 'done', createdAt: 1 }, { id: 'fB', ignore: 'none', hand: 'key', status: 'done', createdAt: 2 }];
const manyReads = [rd('fB', 'OLD-B'), rd('fA', 'OLD-A1'), rd('fA', 'OLD-A2'), rd('fGone', 'GONE'), rd('fA', 'NEW-A'), rd('fB', 'NEW-B'), { t: Date.now(), type: 'text_read', part: 1, chars: 10, ok: true, raw: 'TEXT-OLD' }, { t: Date.now(), type: 'text_read', part: 1, chars: 10, ok: true, raw: 'TEXT-NEW' }];
eq(latestReads(manyReads, twoFiles).map((r) => r.raw), ['TEXT-NEW', 'NEW-A', 'NEW-B'], 'report: latest reading of each photo, in photo order');
const rep17 = buildReport({ version: '0.17.0', device: 'test', health: null, profile: { name: 'Test', test: true }, project: { name: 'P' }, text: '', parsed: { cards: [], skipped: 0, skippedLines: [] }, sum: { total: 0, covered: 0, remainingCount: 0, correct: 0, incorrect: 0 }, files: twoFiles, items: [], check: null, events: manyReads, notes: 'my note' });
ok(rep17.includes('NEW-A') && rep17.includes('NEW-B') && !rep17.includes('OLD-A1') && !rep17.includes('OLD-A2') && !rep17.includes('OLD-B') && !rep17.includes('GONE'), 'report: older readings are left out');
ok(rep17.includes('5 older readings left out'), 'report: it says how many readings were left out');
ok(rep17.includes('--- Photo 1 at') && rep17.includes('--- Photo 2 at'), 'report: readings are named by photo');
ok(rep17.indexOf('YOUR NOTES') < rep17.indexOf('1. WHAT WAS ADDED') && splitReport(rep17).length === 1 && splitReport('x\n'.repeat(20000)).length > 1, 'report: notes first, and the parts feature is kept');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// Rule tests for Reading projects (layout, chunks, blocks, question builder). Run with: npm test
import { parseJson, parseTranscript, makeChunks, layoutText, parseBlocks, buildQuestions, splitTextPages, textTranscript, cleanCount, toRows, suggestCount } from '../src/reading.js';
import { buildDeck } from '../src/deck.js';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.log('FAIL: ' + name); } };

// A notes page: heading, indented lines, a big gap, two words alone in the middle, an arrow.
const t = parseTranscript({ kind: 'handwritten', lines: [
  { text: 'Causes of WWI', x: 0.1, y: 0.05, w: 0.4, h: 0.03, marks: ['underline'] },
  { text: '- alliances', x: 0.15, y: 0.09, w: 0.25, h: 0.03 },
  { text: '- militarism', x: 0.15, y: 0.125, w: 0.25, h: 0.03 },
  { text: '1914 - Franz Ferdinand shot', x: 0.1, y: 0.4, w: 0.7, h: 0.03, marks: ['box'] },
  { text: 'war starts', x: 0.4, y: 0.7, w: 0.2, h: 0.03 },
  { text: '', x: 0, y: 0, w: 1, h: 1 }
] });
ok(t.lines.length === 5, 'empty pieces are dropped');
ok(t.lines[0].text === 'Causes of WWI' && t.lines[4].text === 'war starts', 'pieces stay in page order');
const chunks = makeChunks(t);
ok(chunks.length === 3, 'big gaps start a new chunk (got ' + chunks.length + ')');
ok(chunks[0].lines.length === 3, 'heading and its indented lines stay together');
const lt = layoutText(t);
const rows = lt.split('\n');
ok(rows[0].startsWith('      Causes') || rows[0].trim() === 'Causes of WWI', 'heading keeps its left gap');
ok(rows[1].indexOf('- alliances') > rows[0].indexOf('Causes'), 'indented lines are indented more than the heading');
ok(rows.some((r) => r === ''), 'empty space between lines shows as blank lines');
ok(/^\s{20,}war starts$/.test(rows[rows.length - 1]), 'two words in the middle stay in the middle');
ok(layoutText(t, { marks: true }).includes('[1914 - Franz Ferdinand shot]') && layoutText(t, { marks: true }).includes('_Causes of WWI_'), 'marks are shown for the AI');
ok(!layoutText(t, { off: ['l1'] }).includes('Causes of WWI'), 'unticked lines are left out');
ok(toRows(parseTranscript({ lines: [{ text: 'a', x: 0.1, y: 0.1, w: 0.1, h: 0.03 }, { text: 'b', x: 0.6, y: 0.102, w: 0.1, h: 0.03 }] }).lines).length === 1, 'two phrases on one row stay one row');

// The AI's answer arrives as text, maybe inside code fences
ok(parseTranscript('```json\n' + JSON.stringify({ lines: [{ text: 'hi', x: 0.1, y: 0.1, w: 0.1, h: 0.03 }] }) + '\n```').lines.length === 1, 'a transcript in a text answer with code fences is read');
ok(parseBlocks('Here you go: ' + JSON.stringify({ blocks: [{ type: 'date', source: 'In 1900.', question: 'When?', value: '1900' }] })).length === 1, 'blocks in a text answer are read');
let threw = false; try { parseJson('no json here'); } catch { threw = true; }
ok(threw, 'an answer with no JSON gives a clear error');

// Pasted text
const pages = splitTextPages('One.\n\nTwo.\n\n' + 'x'.repeat(95) + '\n\nFour.', 100);
ok(pages.length >= 2 && pages.flat().length === 4, 'pasted text splits into pages by paragraph');
const tt = textTranscript(['Para one', 'Para two']);
ok(makeChunks(tt).length === 2 && layoutText(tt) === 'Para one\n\nPara two', 'text pages: one chunk per paragraph');

// Blocks
const blocks = parseBlocks({ blocks: [
  { type: 'date', source: 'The Treaty of Paris was signed in 1783.', subject: 'Treaty of Paris', question: 'When was the Treaty of Paris signed?', value: '1783' },
  { type: 'date', source: 'The Declaration was adopted in 1776.', subject: 'Declaration of Independence', question: 'When was the Declaration adopted?', value: '1776', important: true },
  { type: 'date', source: 'The Constitution was written in 1787.', subject: 'Constitution', question: 'When was the Constitution written?', value: '1787' },
  { type: 'date', source: 'The war began in 1775.', subject: 'Revolutionary War', question: 'When did the war begin?', value: '1775' },
  { type: 'definition', source: 'A treaty is a formal agreement between countries.', subject: 'treaty', question: 'What is a treaty?', value: 'a formal agreement between countries' },
  { type: 'list', source: 'Causes: alliances, militarism, imperialism, nationalism', subject: 'Causes of WWI', question: 'What were the causes of WWI?', items: ['alliances', 'militarism', 'imperialism', 'nationalism'] },
  { type: 'list', source: 'Steps: first plan, then build, then test', subject: 'Steps', question: 'What are the steps in order?', items: ['plan', 'build', 'test'], ordered: true },
  { type: 'date', source: 'Something about 1900.', subject: 'x', question: 'When?', value: '1999' },
  { type: 'fact', source: '', question: 'bad', value: 'bad' },
  { type: 'fact', source: 'A source', question: 'When was the Treaty of Paris signed?', value: 'dup' }
] });
ok(blocks.length === 8, 'bad and duplicate blocks are dropped (got ' + blocks.length + ')');
ok(blocks.find((b) => b.value === '1999').grounded === false, 'a value that is not in its source is marked not grounded');
ok(blocks.find((b) => b.value === '1783').grounded === true, 'a value found in its source is grounded');

const qs = buildQuestions(blocks, blocks, 10, 'Page 1', 'a');
ok(qs.length === 10, 'makes the requested number (got ' + qs.length + ')');
ok(qs[0].blockType !== undefined && qs.every((q) => q.source === 'reading'), 'items carry block type and source');
ok(qs.filter((q) => q.type === 'qa').length >= 4, 'round 1 gives each block its main question');
const first = qs.slice(0, 3).map((q) => q.question).join('|');
ok(first.includes('Declaration') || qs[0].srcText.includes('1776'), 'important blocks come first');
ok(qs.every((q) => q.question && q.answer), 'every question has an answer');
for (const q of qs.filter((x) => x.type === 'mc')) {
  ok(q.choices.length >= 3 && new Set(q.choices.map((c) => c.text)).size === q.choices.length, 'mc choices are different');
  ok(q.choices.find((c) => c.label === q.correctLabel).text === q.answer, 'mc correct label matches the answer');
}
for (const q of qs.filter((x) => x.type === 'tf')) ok((q.answer === 'True') === (q.correctLabel === 'A') && (q.answer === 'True' || q.correction), 'tf answer and label agree; false ones give the true version');
const multi = qs.find((q) => q.type === 'multi');
ok(multi && multi.correctLabels.length === 4 && multi.choices.length >= 6, 'list makes a select-all with extra wrong choices from other lists');
const order = qs.find((q) => q.type === 'order') || buildQuestions(blocks.filter((b) => b.ordered), blocks, 5, 'P', 'b').find((q) => q.type === 'order');
ok(order && order.correctOrder.length === 3 && order.correctOrder.join('') !== 'ABC', 'ordered list makes a put-in-order with a mixed-up start');
ok(JSON.stringify(buildQuestions(blocks, blocks, 10, 'Page 1', 'a')) === JSON.stringify(qs), 'same blocks and count give the same questions');
const few = buildQuestions(blocks.slice(0, 1), blocks.slice(0, 1), 25, 'P', 'c');
ok(few.length < 25 && few.length >= 1, 'a page with little in it is not padded');
ok(buildQuestions(blocks, blocks, 7, 'P', 'd').length === 7, 'a custom number like 7 works');
ok(cleanCount('7') === 7 && cleanCount('0') === 1 && cleanCount('999') === 40 && cleanCount('x') === 10, 'the typed number is cleaned');

ok(suggestCount(t) === 5, 'a short page suggests 5');
ok(suggestCount(textTranscript(['word '.repeat(150)])) === 10 && suggestCount(textTranscript(['word '.repeat(400)])) === 20, 'longer pages suggest more');
ok(suggestCount(textTranscript(['word '.repeat(400), 'x']), ['l1']) === 5, 'unticked text does not count');

// They fit the existing deck builder
const items = qs.map((q, i) => ({ ...q, id: 'i' + i, fileId: 'f1' }));
const { deck, notReady } = buildDeck([], items, [{ id: 'f1', createdAt: 1 }]);
ok(deck.length === items.length && notReady === 0, 'all reading items become cards in the existing study modes (got ' + deck.length + ', notReady ' + notReady + ')');

console.log(`reading: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// Rule tests for Reading projects (layout, chunks, blocks, question builder). Run with: npm test
import { parseJson, parseTranscript, makeChunks, layoutText, parseBlocks, buildQuestions, splitTextPages, textTranscript, cleanCount, toRows, suggestCount, countQuestions, readingReport } from '../src/reading.js';
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

ok(blocks.every((b) => b.id && b.on === true), 'blocks get an id and start ticked');
// Blocks that say nothing are dropped: Congress -> Congress, answer given away in the question
const empty = parseBlocks({ blocks: [
  { type: 'name', source: 'Congress', subject: 'Congress', question: 'Which body makes laws?', value: 'Congress' },
  { type: 'name', source: 'Legislative -> Congress', subject: 'Legislative branch', question: 'Which body is the legislative branch?', value: 'Congress' },
  { type: 'fact', source: 'The war began in 1775.', subject: 'war', question: 'The war began in 1775. When?', value: '1775' },
  { type: 'date', source: 'In 1787.', subject: 'Constitution', question: 'When?', value: '1787' },
  { type: 'date', source: 'In 1787 again.', subject: 'Constitution', question: 'What year?', value: '1787' }
] });
ok(empty.length === 2 && empty[0].value === 'Congress' && empty[0].subject === 'Legislative branch', 'subject = answer and answer-in-question blocks are dropped; the same fact twice is kept once (got ' + empty.length + ')');

const qs = buildQuestions(blocks, blocks, 1, 'Page 1', 'a');
ok(qs.length === blocks.length, 'one question per block by default (got ' + qs.length + ' for ' + blocks.length + ')');
ok(new Set(qs.map((q) => q.srcText)).size === qs.length, 'no fact is asked twice');
ok(qs.every((q) => q.source === 'reading' && q.blockType), 'items carry block type and source');
ok(qs.every((q) => q.question && q.answer), 'every question has an answer');
ok(qs.some((q) => q.type === 'mc') && qs.some((q) => q.type === 'term') && qs.some((q) => q.type === 'multi'), 'types vary to suit the block: ' + qs.map((q) => q.type).join(','));
ok(qs.every((q) => q.type === 'tf' || q.type === 'multi' || q.type === 'order' || !q.question.toLowerCase().includes(q.answer.toLowerCase())), 'no question gives its answer away');
for (const q of qs.filter((x) => x.type === 'mc')) ok(q.choices.find((c) => c.label === q.correctLabel).text === q.answer && new Set(q.choices.map((c) => c.text)).size === q.choices.length, 'mc right label and different choices');
const order = qs.find((q) => q.type === 'order');
ok(order && order.correctOrder.length === 3 && order.correctOrder.join('') !== 'ABC', 'an ordered list becomes put-in-order with a mixed-up start');
const two = buildQuestions(blocks, blocks, 2, 'Page 1', 'a');
ok(two.length > qs.length && two.length <= blocks.length * 2, 'two per fact adds questions (got ' + two.length + ')');
const byFact = {}; two.forEach((q) => { (byFact[q.srcText] ||= []).push(q.type); });
ok(Object.values(byFact).every((ts) => new Set(ts.map((t) => t)).size === ts.length), 'extra questions on a fact use a different form');
const three = buildQuestions(blocks, blocks, 3, 'Page 1', 'a');
ok(three.length >= two.length && Object.values(three.reduce((m, q) => ((m[q.srcText] = (m[q.srcText] || 0) + 1), m), {})).every((n) => n <= 3), 'three per fact at most');
const ticked = blocks.map((b, i) => ({ ...b, on: i % 2 === 0 }));
ok(buildQuestions(ticked, ticked, 1, 'P', 'a').length === ticked.filter((b) => b.on).length, 'unticked blocks make no questions');
ok(JSON.stringify(buildQuestions(blocks, blocks, 1, 'Page 1', 'a')) === JSON.stringify(qs), 'same blocks give the same questions');
const cong = parseBlocks({ blocks: [{ type: 'name', source: 'Legislative -> Congress', subject: 'Legislative branch', question: 'Which body is the legislative branch?', value: 'Congress' }] });
ok(!buildQuestions(cong, cong, 3, 'P', 'z').some((q) => /^congress: congress$/i.test(q.question)), 'never "Congress: Congress"');
ok(countQuestions([{ id: 'p1', blocks }], 1) === blocks.length, 'the count of questions is known before making them');
const rep = readingReport([{ id: 'f1', source: 'photo', status: 'typed', checked: true, transcript: t, off: ['l5'], blocks }], qs.map((q) => ({ ...q, fileId: 'f1' })), 1);
ok(rep.includes('Page 1') && rep.includes('blocks: 8 found') && rep.includes('war starts') && rep.includes('unticked: war starts'), 'the report shows typed copy, blocks and questions');

// They fit the existing deck builder
const items = qs.map((q, i) => ({ ...q, id: 'i' + i, fileId: 'f1' }));
const { deck, notReady } = buildDeck([], items, [{ id: 'f1', createdAt: 1 }]);
ok(deck.length === items.length && notReady === 0, 'all reading items become cards in the existing study modes (got ' + deck.length + ', notReady ' + notReady + ')');

console.log(`reading: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

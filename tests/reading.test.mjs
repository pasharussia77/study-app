// Rule tests for Reading projects (layout, chunks, blocks, question builder). Run with: npm test
import { parseJson, parseTranscript, makeChunks, layoutText, parseBlocks, buildQuestions, splitTextPages, textTranscript, cleanCount, toRows, suggestCount, countQuestions, readingReport, parseBlocksDetailed, buildCheckPrompt, parseChecks, struckIds, buildFactsPrompt } from '../src/reading.js';
import { buildDeck, spreadGroups } from '../src/deck.js';

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
ok(!layoutText(t, { off: ['l1'] }).includes('Causes of WWI'), 'unselected lines are left out');
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

ok(blocks.every((b) => b.id && b.on === true), 'blocks get an id and start selected');
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
const sel = blocks.map((b, i) => ({ ...b, on: i % 2 === 0 }));
ok(buildQuestions(sel, sel, 1, 'P', 'a').length === sel.filter((b) => b.on).length, 'unselected blocks make no questions');
ok(JSON.stringify(buildQuestions(blocks, blocks, 1, 'Page 1', 'a')) === JSON.stringify(qs), 'same blocks give the same questions');
const cong = parseBlocks({ blocks: [{ type: 'name', source: 'Legislative -> Congress', subject: 'Legislative branch', question: 'Which body is the legislative branch?', value: 'Congress' }] });
ok(!buildQuestions(cong, cong, 3, 'P', 'z').some((q) => /^congress: congress$/i.test(q.question)), 'never "Congress: Congress"');
ok(countQuestions([{ id: 'p1', blocks }], 1) === blocks.length, 'the count of questions is known before making them');
const rep = readingReport([{ id: 'f1', source: 'photo', status: 'typed', checked: true, transcript: t, off: ['l5'], blocks }], qs.map((q) => ({ ...q, fileId: 'f1' })), 1);
ok(rep.includes('Page 1') && rep.includes('blocks: 8 found') && rep.includes('war starts') && rep.includes('unselected: war starts'), 'the report shows typed copy, blocks and questions');

// They fit the existing deck builder
const items = qs.map((q, i) => ({ ...q, id: 'i' + i, fileId: 'f1' }));
const { deck, notReady } = buildDeck([], items, [{ id: 'f1', createdAt: 1 }]);
ok(deck.length === items.length && notReady === 0, 'all reading items become cards in the existing study modes (got ' + deck.length + ', notReady ' + notReady + ')');

// 0.20.2: reworded-subject answers are dropped, with a reason in the report info
const pd = parseBlocksDetailed({ blocks: [
  { type: 'fact', source: 'the constitution divided Federal Power', subject: 'Division of federal power', question: 'What did the constitution do to federal power?', value: 'divided Federal Power' },
  { type: 'fact', source: 'The constitution assigned different responsibilities to three branches.', subject: 'Responsibilities of branches', question: 'What did it assign to the branches?', value: 'different responsibilities' },
  { type: 'date', source: 'In 1787, delegates met in Philadelphia.', subject: 'Philadelphia meeting', question: 'When did delegates meet in Philadelphia?', value: '1787' }
] });
ok(pd.blocks.length === 3 && pd.asked === 3 && pd.blocks[0].plain === true && !pd.blocks[1].plain, 'reworded-subject block with a real question is kept as plain question (got ' + pd.blocks.length + ')');
const pd2 = parseBlocksDetailed({ blocks: [
  { type: 'fact', source: 'Congress', subject: 'Congress', question: 'What is Congress?', value: 'Congress' },
  { type: 'fact', source: 'the new constitution', subject: 'new constitution', question: 'Tell me about the new constitution and the delegates', value: 'the new constitution' }
] });
ok(pd2.blocks.length === 0 && pd2.dropped.length === 2 && /repeats/.test(pd2.dropped[0].why), 'weak subject AND weak question is dropped, with a reason');
const pd3 = parseBlocksDetailed({ blocks: [{ type: 'list', source: 'The constitution assigned different responsibilities to three branches.', subject: 'three branches', question: 'What did the constitution assign to the three branches?', items: ['different responsibilities'] }] });
ok(pd3.blocks.length === 1 && pd3.blocks[0].type === 'fact' && pd3.blocks[0].value === 'different responsibilities', 'a list with one item becomes a fact block');
const plainQs = buildQuestions(pd.blocks, pd.blocks, 3, 'Page 1', 'pp');
ok(plainQs.filter((q) => q.srcText === pd.blocks[0].source && (q.type === 'term' || q.type === 'tf')).length === 0, 'a plain block never makes a word card or true/false');
// 0.20.4: crossed-out pieces
const tr = parseTranscript({ kind: 'handwritten', lines: [{ text: 'gained new powers', x: .1, y: .2, w: .3, h: .03, marks: ['strike'] }, { text: 'decided to write', x: .5, y: .2, w: .3, h: .03 }] });
ok(tr.lines[0].marks.includes('strike') && struckIds(tr).length === 1 && struckIds(tr)[0] === tr.lines[0].id, 'crossed-out piece keeps its strike mark and is listed to start unselected');
ok(/~~gained new powers~~/.test(layoutText(tr, { marks: 'all' })) && !/gained/.test(layoutText(tr, { off: struckIds(tr) })), 'report shows ~~crossed out~~ text; unselected it is left out of the source text');
ok(/gained new powers/.test(layoutText(tr, { marks: true })) && !/~~/.test(layoutText(tr, { marks: true })), 'selected back, crossed-out text goes to the block finder as plain text');
ok(/MAIN POINTS/.test(buildFactsPrompt('x', 30, 'printed', 'main')) && /EVERY DETAIL/.test(buildFactsPrompt('x', 30, 'printed', 'all')) && !/Detail level/.test(buildFactsPrompt('x', 30, 'printed')), 'detail level changes the block prompt');
ok(/handwriting/.test(buildCheckPrompt([{ type: 'qa', question: 'Q', answer: 'A', srcText: 'S' }])), 'check prompt warns about handwriting misreads');

// 0.20.3: AI check of questions and unselected questions
const cq = [{ type: 'qa', question: 'What does the Legislative branch do?', answer: 'Moves federal laws', srcText: 'Moves federal laws' }, { type: 'mc', question: 'When?', answer: '1787', srcText: 'In 1787', choices: [{ label: 'A', text: '1787' }, { label: 'B', text: '1789' }] }];
const cp = buildCheckPrompt(cq);
ok(/CHECK THESE QUESTIONS/.test(cp) && /1\. \[qa\]/.test(cp) && /2\. \[mc\]/.test(cp) && /Choices: A\. 1787/.test(cp) && /Source sentence: In 1787/.test(cp), 'check prompt lists every question with answer and source');
const pc = parseChecks('Sure: {"checks":[{"n":1,"kind":"wrong","why":"Laws are made, not moved"},{"n":9,"kind":"wrong","why":"x"},{"n":2,"kind":"odd","why":"y"}]}', 2);
ok(pc.size === 2 && pc.get(0).kind === 'wrong' && pc.get(1).kind === 'unclear', 'check answer parsed: bad numbers ignored, unknown kind becomes unclear');
ok(parseChecks('{"checks":[]}', 2).size === 0, 'empty check answer means no problems');
let badCheck = false; try { parseChecks('not json', 2); } catch { badCheck = true; }
ok(badCheck, 'an unreadable check answer throws (so the app shows "check did not work")');
const dk = buildDeck([], [{ id: 'a', fileId: 'f1', type: 'qa', question: 'Q1', answer: 'A1' }, { id: 'b', fileId: 'f1', type: 'qa', question: 'Q2', answer: 'A2', off: true }], [{ id: 'f1', createdAt: 1 }]);
ok(dk.deck.length === 1 && dk.deck[0].prompt === 'Q1' && dk.notReady === 0, 'an unselected question is left out of the deck');

// 0.20.6: other forms use different wording, true/false is a real sentence, no duplicates, report lists questions in full
const B6 = (id, type, subject, value, question, source, extra = {}) => ({ id, type, subject, value, question, source, grounded: true, on: true, ...extra });
const pg6 = [
  B6('b2', 'date', "Delegates' meeting", '1787', 'When did delegates meet in Philadelphia to revise the Articles?', 'In 1787, delegates met in Philadelphia to revise the Articles.'),
  B6('b3', 'event', 'Decision', 'a new Constitution', 'What did the delegates decide to write?', 'They decided to write a new Constitution.'),
  B6('b5', 'date', 'New government', '1789', 'When did the new government begin operating?', 'The new government began operating in 1789.'),
  B6('b6', 'fact', 'Branches', 'different responsibilities', 'What did the Constitution assign to the three branches?', 'The constitution assigned different responsibilities to three branches.'),
  B6('b8', 'fact', 'Legislative function', 'Makes federal laws', 'What does the Legislative branch do?', 'Makes federal laws'),
];
for (const per of [2, 3]) {
  const q6 = buildQuestions(pg6, pg6, per, 'P', 'z');
  const keys = q6.map((x) => x.question.toLowerCase() + '|' + String(x.answer).toLowerCase());
  ok(new Set(keys).size === keys.length, `per ${per}: no question has the same wording and answer as another`);
  const stems = q6.filter((x) => x.type !== 'tf').map((x) => x.question);
  ok(new Set(stems).size === stems.length, `per ${per}: no two questions share the same stem`);
  ok(q6.filter((x) => x.type === 'tf').every((x) => !/^[^.?!]{1,40}: /.test(x.question) && x.question.split(' ').length >= 5), `per ${per}: true/false is a full sentence, not a label`);
  ok(q6.some((x) => /^Fill in the blank: .*_____/.test(x.question)), `per ${per}: fill in the blank is used`);
  ok(q6.every((x) => x.type === 'tf' || !x.question.includes(String(x.answer)) || x.type === 'order' || x.type === 'multi'), `per ${per}: the answer is never in the question`);
}
const q1 = buildQuestions(pg6, pg6, 1, 'P', 'z');
ok(q1.length === pg6.length && q1.every((x) => !/Fill in the blank/.test(x.question) || x.type === 'mc'), 'one per block stays one per block');
const tfq = buildQuestions(pg6, pg6, 3, 'P', 'z').find((x) => x.type === 'tf' && x.answer === 'False');
ok(tfq && tfq.correction && /1787|a new Constitution|1789|different/.test(tfq.correction), 'a false statement keeps the true sentence as its correction');
const rp6 = readingReport([{ id: 'f1', source: 'photo', status: 'typed', checked: true, transcript: { kind: 'handwritten', lines: [{ id: 'l1', text: 'x', marks: [], conf: 'high' }], figures: [] }, off: [], blocks: pg6 }], buildQuestions(pg6, pg6, 2, 'P', 'z').map((x, i) => ({ ...x, id: 'i' + i, fileId: 'f1' })), 2, 'all');
ok(/Q1 /.test(rp6) && /choices: A\./.test(rp6) && /from: "In 1787/.test(rp6) && /same wording and answer asked twice: 0/.test(rp6), 'report lists each question in full with choices, answer and source sentence');
ok(buildCheckPrompt([{ type: 'qa', question: 'Q', answer: 'A', srcText: 'S' }]).includes('vague') && /ON PURPOSE/.test(buildCheckPrompt([{ type: 'qa', question: 'Q', answer: 'A', srcText: 'S' }])), 'AI check looks for vague questions and leaves other forms of the same fact alone');
ok(parseChecks('{"checks":[{"n":2,"kind":"duplicate","why":"same as 1"},{"n":1,"kind":"vague","why":"x"}]}', 2).size === 1, 'a duplicate flag from the AI check is ignored');
ok(/arrow diagram/i.test(buildFactsPrompt('x', 5, 'handwritten', 'normal')), 'block finder is told arrow diagrams link one thing to its details');
for (const per of [2, 3]) {
  const q8 = buildQuestions(pg6, pg6, per, 'P', 'z');
  ok(q8.every((x, j) => j === 0 || x.blockId !== q8[j - 1].blockId), `per ${per}: two questions on one block never sit side by side`);
  ok(q8.every((x, j) => x.order === j), `per ${per}: order follows the spread-out list`);
}
const one8 = buildQuestions([pg6[0]], pg6, 3, 'P', 'z');
ok(one8.length >= 2, 'a page with one block still gets its questions');

const ev7 = [{ t: 1, type: 'transcribe', fileId: 'f1', ok: true, ms: 900, usage: { prompt_tokens: 10, completion_tokens: 20 }, lines: 1, raw: '{"lines":[RAWT]}' },
  { t: 2, type: 'blocks', fileId: 'f1', ok: true, ms: 800, detail: 'all', want: 9, sent: 'SENT TEXT', raw: '{"blocks":[RAWB]}' },
  { t: 3, type: 'check', fileId: 'f1', ok: true, ms: 700, asked: 2, flagged: 0, raw: '{"checks":[]}' }, { t: 4, type: 'check', fileId: 'check', ok: false, error: 'boom' }];
const rp7 = readingReport([{ id: 'f1', source: 'photo', status: 'typed', checked: true, transcript: { kind: 'handwritten', lines: [{ id: 'l1', text: 'gained', marks: ['strike'], conf: 'high', x: 0.1, y: 0.2, w: 0.3, h: 0.04 }], figures: [] }, off: ['l1'], blocks: pg6 }], [], 2, 'all', ev7);
ok(/l1 \| 0\.1,0\.2,0\.3,0\.04 \| strike \| high \| NO \| gained/.test(rp7), 'report lists every piece with place, marks and whether it is used');
ok(rp7.includes('RAWT') && rp7.includes('SENT TEXT') && rp7.includes('RAWB') && rp7.includes('{"checks":[]}') && /Check again/.test(rp7) && /FAILED: boom/.test(rp7), 'report holds the AI answers, the text sent to the block finder and failed calls');

const cards9 = ['a', 'a', 'a', 'b', 'b', 'c', 'c', 'd'].map((g, i) => ({ key: 'k' + i, group: g }));
const sp9 = spreadGroups(cards9);
ok(sp9.length === 8 && new Set(sp9.map((c) => c.key)).size === 8 && sp9.every((c, j) => j === 0 || c.group !== sp9[j - 1].group), 'shuffled cards are moved so one block never comes twice in a row');
ok(spreadGroups([{ key: 'x', group: '' }, { key: 'y', group: '' }]).length === 2, 'cards without a block are left alone');

console.log(`reading: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// Rule tests for Reading projects (layout, chunks, blocks, question builder). Run with: npm test
import { alignLines, untangle, inkRows } from '../src/align.js';
import { wordsToLines } from '../src/gvision.js';
import { similar, placeByEngine, dbBoxes, ctcDecode } from '../src/paddle.js';
import { numberedParts, blockAreas, remakeQuestion, dateLike, parseJson, parseTranscript, makeChunks, layoutText, parseBlocks, buildQuestions, splitTextPages, textTranscript, cleanCount, toRows, suggestCount, countQuestions, readingReport, parseBlocksDetailed, buildCheckPrompt, parseChecks, struckIds, buildFactsPrompt } from '../src/reading.js';
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

// 0.20.10: run-2 page from the report
const raw10 = JSON.stringify({ blocks: [
  { type: 'date', source: 'In 1787, delegates met in Philadelphia to revise the Articles.', subject: '1787 meeting', question: 'When and where did delegates meet to revise the Articles?', value: 'In 1787, delegates met in Philadelphia', items: [] },
  { type: 'date', source: 'the new government began operating in 1789.', subject: 'new government', question: 'When did the new government begin operating?', value: '1789', items: [] },
  { type: 'fact', source: 'The constitution gave congress the power to levy federal taxes and regulate trade among the states.', subject: "Congress's powers", question: 'What powers did the constitution give Congress?', value: '', items: ['levy federal taxes', 'regulate trade among the states'] },
  { type: 'fact', source: 'the constitution divided Federal Power', subject: 'federal power', question: 'What did the constitution do to federal power?', value: 'divided Federal Power', items: [] },
  { type: 'fact', source: 'Legislative ↓ Makes federal laws ↓ Congress', subject: 'Legislative branch', question: 'What does the Legislative branch do?', value: 'Makes federal laws', items: [] },
  { type: 'date', source: 'In 1776 the colonies declared independence.', subject: 'independence', question: 'When was independence declared?', value: '1776', items: [] }
] });
const p10 = parseBlocksDetailed(raw10);
ok(p10.blocks.find((b) => /Philadelphia/.test(b.value)).type === 'fact', 'a "date" whose answer is not a short date becomes a fact');
ok(p10.blocks.some((b) => b.type === 'list' && b.items.length === 2), 'a fact sent with list items is kept as a list');
ok(dateLike('1789') && dateLike('the 1780s') && dateLike('July 4, 1776') && !dateLike('In 1787, delegates met in Philadelphia'), 'what counts as a date');
const q10 = buildQuestions(p10.blocks, p10.blocks, 3, 'P', 'r');
ok(q10.every((x) => !/\bin In\b|^1789 to/.test(x.question)), 'no broken true/false from a long "date"');
ok(q10.every((x) => !/[↓→]/.test(x.question)), 'no fill in the blank or true/false from arrows');
ok(!q10.some((x) => /^Fill in the blank: the constitution _____/i.test(x.question)), 'no blank that is most of the sentence');
ok(q10.filter((x) => x.type === 'tf' || /^Fill in the blank: [a-z]/.test(x.question) === false).every((x) => !/^Fill in the blank: [a-z]/.test(x.question)) && q10.filter((x) => x.type === 'tf').every((x) => /^[A-Z0-9]/.test(x.question)), 'questions from a lowercase sentence start with a capital');
const tf10 = q10.find((x) => x.type === 'tf' && x.answer === 'False');
ok(!tf10 || /1776|1789/.test(tf10.question), 'a false date statement swaps in another date');
// Make again
const blk = pg6[0];
const firstQ = buildQuestions([blk], pg6, 1, 'P', 'z')[0];
const again1 = remakeQuestion(firstQ, blk, pg6, [], 1);
ok(again1 && (again1.question !== firstQ.question || again1.type !== firstQ.type), 'Make again gives a different version');
const again2 = remakeQuestion({ ...firstQ, ...again1 }, blk, pg6, [firstQ], 2);
ok(again2 && !(again2.question === firstQ.question && again2.answer === firstQ.answer), 'Make again never repeats another question on the same block');
ok(remakeQuestion(firstQ, null, pg6, [], 1) === null, 'Make again without a block says no');

// 0.20.11
const p11 = parseBlocksDetailed(JSON.stringify({ blocks: [
  { type: 'date', source: 'In 1787, delegates met in Philadelphia to revise the Articles.', subject: 'meeting', question: 'When did delegates meet in Philadelphia?', value: 'In 1787', items: [] },
  { type: 'date', source: 'The new government began operating in 1789.', subject: 'new government', question: 'When did the new government begin operating?', value: '1789', items: [] },
  { type: 'fact', source: 'The constitution gave congress the power to levy federal taxes and regulate trade among the states.', subject: 'taxes', question: 'What power about taxes did Congress get?', value: 'to levy federal taxes', items: [] },
  { type: 'fact', source: 'The constitution gave congress the power to levy federal taxes and regulate trade among the states.', subject: 'trade', question: 'What power about trade did Congress get?', value: 'regulate trade among the states', items: [] },
  { type: 'fact', source: 'They decided to write a new constitution.', subject: 'decision', question: 'What did they decide to write?', value: 'a new constitution', items: [] },
  { type: 'fact', source: 'The constitution assigned different responsibilities to three branches.', subject: 'branches', question: 'What did the constitution assign?', value: 'different responsibilities', items: [] }
] }));
ok(p11.blocks[0].value === '1787' && p11.blocks[0].type === 'date', 'a date answer "In 1787" is kept as "1787"');
const q11 = buildQuestions(p11.blocks, p11.blocks, 3, 'P', 'w');
ok(q11.every((x) => !/\bin In\b|^1789, delegates/.test(x.question)), 'swapping dates keeps the sentence whole');
ok(q11.filter((x) => x.choices && x.type !== 'tf').every((x) => x.choices.filter((c) => c.text !== x.answer).every((c) => !x.question.toLowerCase().includes(c.text.toLowerCase()))), 'a wrong choice is never already written in the question');

// 0.20.12: where each block sits on the page
const tMap = { lines: [
  { id: 'h1', text: 'The House of Representatives', x: 0.3, y: 0.1, w: 0.4, h: 0.03 },
  { id: 'a1', text: 'The larger house of Congress is the House of Representatives. There are 435 representatives', x: 0.1, y: 0.2, w: 0.8, h: 0.02 },
  { id: 'a2', text: 'in the House. The first census was con-', x: 0.1, y: 0.23, w: 0.8, h: 0.02 },
  { id: 'a3', text: 'ducted in 1790. When will', x: 0.1, y: 0.26, w: 0.5, h: 0.02 },
  { id: 'd1', text: 'Legislative', x: 0.2, y: 0.5, w: 0.2, h: 0.02 }, { id: 'd2', text: '↓', x: 0.25, y: 0.53, w: 0.02, h: 0.02 },
  { id: 'd3', text: 'Makes federal laws', x: 0.15, y: 0.56, w: 0.3, h: 0.02 }] };
const bMap = [
  { id: 'x1', source: 'The larger house of Congress is the House of Representatives.' },
  { id: 'x2', source: 'There are 435 representatives in the House.' },
  { id: 'x3', source: 'The first census was conducted in 1790.' },
  { id: 'x4', source: 'Legislative ↓ Makes federal laws' },
  { id: 'x5', source: 'Something that is not on this page at all.' }];
const am = blockAreas(tMap, bMap);
ok(am.get('x1').lines.join() === 'a1', 'a block is found on its own line, not on a heading with the same words');
ok(am.get('x1').rects[0].w < 0.8 && am.get('x2').rects.find((r) => r.line === 'a1').x > 0.4, 'only the part of a line that belongs to the block is shaded');
ok(am.get('x2').lines.join() === 'a1,a2', 'a sentence over two lines shades both');
ok(am.get('x3').lines.join() === 'a2,a3', 'a word split with a hyphen is followed to the next line');
ok(am.get('x4').lines.join() === 'd1,d2,d3', 'a diagram block shades its arrow too');
ok(am.get('x5').lines.length === 0, 'a source not on the page is not shaded anywhere');

// 0.20.15: lining the typed page up with the photo
{
  const W = 200, H = 400, ink = new Uint8Array(W * H);
  const bar = (x0, x1, y0, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ink[y * W + x] = 1; };
  bar(20, 180, 100, 108); bar(20, 180, 116, 124); bar(40, 100, 132, 140); bar(20, 180, 148, 156); // rows: full, full, short indented, full
  const mask = { W, H, ink };
  ok(inkRows(mask, 20, 180, 90, 170).length === 4, 'rows of print are found');
  const lines = [
    { id: 'l1', text: 'a', x: 0.1, y: 0.255, w: 0.8, h: 0.02 },
    { id: 'l2', text: 'b', x: 0.1, y: 0.30, w: 0.8, h: 0.02 },
    { id: 'l3', text: 'c', x: 0.2, y: 0.30, w: 0.3, h: 0.02 }, // the AI gave it the same height as the line before
    { id: 'l4', text: 'd', x: 0.1, y: 0.36, w: 0.8, h: 0.02 }];
  const a = alignLines(lines, mask);
  const yc = (l) => (l.y + l.h / 2) * H;
  ok(Math.abs(yc(a.lines[0]) - 104) < 2 && Math.abs(yc(a.lines[1]) - 120) < 2, 'lines move onto their real rows');
  ok(Math.abs(yc(a.lines[2]) - 136) < 2, 'two lines the AI put at one height go to two rows, the short indented one to the short row');
  ok(Math.abs(yc(a.lines[3]) - 152) < 2, 'the next line follows');
  ok(a.lines.every((l, i) => l.h === lines[i].h && l.x === lines[i].x), 'letter size and left edge stay as read');
  const u = untangle([{ id: 'l1', x: 0.1, y: 0.3, w: 0.8, h: 0.02 }, { id: 'l2', x: 0.1, y: 0.302, w: 0.8, h: 0.02 }, { id: 'l3', x: 0.1, y: 0.31, w: 0.8, h: 0.02 }, { id: 'l4', x: 0.1, y: 0.4, w: 0.8, h: 0.02 }]);
  ok(u.lines.every((l, i, arr) => i === 0 || Math.abs(l.y - arr[i - 1].y) >= 0.012) && u.lines[3].y === 0.4, 'lines on top of each other are moved apart; lines far below stay');
  const side = untangle([{ id: 'l1', x: 0.05, y: 0.3, w: 0.3, h: 0.02 }, { id: 'l2', x: 0.5, y: 0.3, w: 0.4, h: 0.02 }]);
  ok(side.pushed === 0, 'lines side by side at one height are left alone');
  const L = (id, y, h = 0.019) => ({ id, x: 0.1, y, w: 0.3, h });
  const ord = untangle([L('a', 0.455), L('b', 0.4735), L('c', 0.486, 0.024), L('d', 0.5), L('e', 0.524, 0.021)], new Set(['a', 'c', 'e']));
  ok(ord.lines[1].y > ord.lines[0].y && ord.lines[1].y < ord.lines[2].y && ord.lines[3].y > ord.lines[2].y && ord.lines[3].y < ord.lines[4].y, 'a missed line stays between the found lines read before and after it (reading order wins)');
}

// 0.20.26: places from the PaddleOCR text finder
{
  const W = 1000, H = 1000;
  const e = (y, text, x = 100, w = 400, a = 0) => ({ text, cx: x + w / 2, cy: y + 10, w, h: 20, a: (a * Math.PI) / 180 });
  ok(similar('reelected every two years.', 'reelectedevery twoyears.') > 0.9 && similar('the a of', 'The House of Representatives') < 0.6, 'lines are matched by their letters, missing spaces do not matter');
  const t = { lines: [
    { id: 'l1', text: 'many people are in a state,', x: 0.1, y: 0.40, w: 0.3, h: 0.02 },
    { id: 'l4', text: 'The first census was con-', x: 0.1, y: 0.61, w: 0.3, h: 0.02 },
    { id: 'l2', text: 'a census, or count of the', x: 0.1, y: 0.62, w: 0.3, h: 0.02 },
    { id: 'l3', text: 'unreadable smudge words', x: 0.1, y: 0.64, w: 0.3, h: 0.02 }], figures: [] };
  const eng = [e(396, 'manypeople are ina state,'), e(436, 'a census, or count of the'), e(476, 'The first census was con-', 100, 400, 2), e(700, 'Understanding the U.S. Constitution')];
  const p = placeByEngine(t, eng, W, H);
  const y = (id) => p.lines.find((l) => l.id === id).y;
  ok(p.matched === 3 && p.fixed.has('l2') && !p.fixed.has('l3'), 'each line takes the engine line with the most similar text; text not in the reading is ignored');
  ok(Math.abs(y('l2') - 0.436) < 0.002 && Math.abs(p.lines[1].a - 2) < 0.01, 'a found line takes the box and tilt of its printed line');
  ok(y('l2') < y('l3') && y('l3') < y('l4'), 'a line the engine did not find goes between the found lines read before and after it (line numbers are the reading order)');
  const rn = { lines: [
    { id: 'l1', text: 'II', x: 0.15, y: 0.44, w: 0.02, h: 0.016 }, { id: 'l2', text: 'Right to bear arms', x: 0.22, y: 0.44, w: 0.16, h: 0.016 },
    { id: 'l3', text: 'III', x: 0.15, y: 0.46, w: 0.03, h: 0.016 }, { id: 'l4', text: 'Quartering of soldiers', x: 0.22, y: 0.46, w: 0.19, h: 0.016 }], figures: [] };
  const re = [e(442, 'Right to bear arms', 220, 160), e(462, 'Quartering of soldiers', 220, 190), e(462, 'III', 150, 30), e(442, '11', 150, 15)];
  const rp = placeByEngine(rn, re, W, H);
  const ry = (id) => rp.lines.find((l) => l.id === id).y;
  ok(Math.abs(ry('l1') - 0.442) < 0.004 && Math.abs(ry('l3') - 0.462) < 0.004 && rp.lines.every((l) => l.id === 'l2' || l.id === 'l4' || !l.a), 'short lines like II and III take only an exact reading near their place, else stay on the row of their text, never tilted');
  const one = new Float32Array(32 * 32); for (let yy = 10; yy < 16; yy++) for (let xx = 4; xx < 28; xx++) one[yy * 32 + xx] = 0.9;
  const bx = dbBoxes(one, 32, 32, 64, 64);
  ok(bx.length === 1 && bx[0].w > bx[0].h * 2 && Math.abs(bx[0].cy - 26) < 2, 'the detector map turns into one line box, scaled to the photo');
  const pr = new Float32Array(4 * 4); [1, 1, 0, 2].forEach((c, t2) => { pr[t2 * 4 + c] = 1; });
  ok(ctcDecode(pr, 4, 4, ['a', 'b']).text === 'ab', 'recognition output is read with repeats and blanks removed');
}

// 0.22.0: lines from Google Vision's words
{
  const W = 1000, H = 1000, tilt = 0.02; // radians
  // a word as Google gives it: text, four corners (top-left, top-right, bottom-right, bottom-left), and "L" when the line ends after it
  const word = (t, x, y, w, h, b = '') => {
    const c = Math.cos(tilt), s = Math.sin(tilt), pt = (dx, dy) => [(x + dx) * c - (y + dy) * s, (x + dx) * s + (y + dy) * c]; // the whole page is tilted around its corner
    return { t, v: [...pt(0, 0), ...pt(w, 0), ...pt(w, h), ...pt(0, h)], b };
  };
  const words = [
    word('II', 150, 440, 18, 16), word('Right', 220, 440, 50, 16), word('to', 276, 440, 20, 16), word('bear', 302, 440, 40, 16), word('arms', 348, 440, 44, 16, 'L'),
    word('XIV', 140, 600, 36, 16), word('Civil', 215, 600, 44, 16), word('rights', 265, 600, 52, 16, 'L'),
    word('Freedom', 225, 480, 70, 16), word('of', 300, 480, 18, 16), word('religion,', 322, 480, 70, 16, 'L'),
    word('assembly,', 225, 500, 80, 16), word('petition', 312, 500, 66, 16, 'L')
  ];
  const ls = wordsToLines(words);
  ok(ls.length === 6, 'a numeral far from its text is its own line; each line break ends a line (' + ls.length + ')');
  ok(ls[0].text === 'II' && ls[1].text === 'Right to bear arms', 'words are joined in reading order');
  ok(Math.abs(ls[1].a - tilt) < 0.002 && ls[1].h > 15 && ls[1].h < 17 && Math.abs(ls[1].w - 172) < 3, 'a line takes the tilt, height and length of its words');
  const t = { lines: [
    { id: 'l1', text: 'II', x: 0.15, y: 0.44, w: 0.02, h: 0.016 }, { id: 'l2', text: 'Right to bear arms', x: 0.22, y: 0.44, w: 0.16, h: 0.016 },
    { id: 'l3', text: 'XIV', x: 0.14, y: 0.6, w: 0.04, h: 0.016 }, { id: 'l4', text: 'Civil rights in the states', x: 0.21, y: 0.6, w: 0.2, h: 0.016 },
    { id: 'l5', text: 'Freedom of religion,', x: 0.22, y: 0.48, w: 0.17, h: 0.016 }], figures: [] };
  const p = placeByEngine(t, ls, W, H);
  ok(p.matched === 5 && p.fixed.has('l1') && p.fixed.has('l3') && p.fixed.has('l2') && p.fixed.has('l5'), 'Google lines feed the same matching: numerals and long lines are found (' + p.matched + ')');
  ok(Math.abs(p.lines[1].a - 1.146) < 0.1, 'the tilt reaches the page piece (' + p.lines[1].a + ')');
  ok(wordsToLines([]).length === 0 && wordsToLines(null).length === 0 && wordsToLines([{ t: 'x', v: [1, 2] }]).length === 0, 'empty or broken words give no lines');
  const wide = wordsToLines([word('A', 100, 100, 10, 16), word('B', 400, 100, 10, 16)]);
  ok(wide.length === 2, 'a wide gap on one row splits the line');
  const two = wordsToLines([word('top', 100, 100, 30, 16), word('lower', 100, 140, 40, 16)]);
  ok(two.length === 2, 'a word on another row starts a new line even without a line break');
}

// 0.22.1: look-alike numerals, the not-found list, whole ordered lists
{
  const W = 1000, H = 1000;
  const e = (y, text, x = 100, w = 400) => ({ text, cx: x + w / 2, cy: y + 10, w, h: 20, a: 0 });
  const t = { lines: [
    { id: 'l1', text: 'I', x: 0.15, y: 0.40, w: 0.01, h: 0.016 }, { id: 'l2', text: 'Freedom of religion', x: 0.22, y: 0.40, w: 0.2, h: 0.016 },
    { id: 'l3', text: 'II', x: 0.15, y: 0.44, w: 0.015, h: 0.016 }, { id: 'l4', text: 'Right to bear arms', x: 0.22, y: 0.44, w: 0.16, h: 0.016 },
    { id: 'l5', text: 'III', x: 0.15, y: 0.46, w: 0.025, h: 0.016 }, { id: 'l6', text: 'Quartering of soldiers', x: 0.22, y: 0.46, w: 0.19, h: 0.016 },
    { id: 'l7', text: 'IV', x: 0.15, y: 0.48, w: 0.02, h: 0.016 }, { id: 'l8', text: 'Searches and seizures', x: 0.22, y: 0.48, w: 0.2, h: 0.016 }], figures: [] };
  const eng = [e(402, 'Freedom of religion', 220, 200), e(442, 'Right to bear arms', 220, 160), e(462, 'Quartering of soldiers', 220, 190), e(482, 'Searches and seizures', 220, 200),
    e(402, '|', 150, 10), e(442, 'Il', 150, 15), e(462, 'Ill', 150, 25), e(482, 'IV', 150, 20)];
  const p = placeByEngine(t, eng, W, H);
  ok(p.matched === 8 && p.miss.length === 0, 'I, Il, 11, Ill and | are taken for the numerals I, II and III on their own rows (matched ' + p.matched + ')');
  const t2 = { lines: [...t.lines, { id: 'l9', text: 'XXVII', x: 0.08, y: 0.5, w: 0.05, h: 0.016 }], figures: [] };
  const p2 = placeByEngine(t2, [...eng, e(522, 'XXV11', 130, 50)], W, H);
  ok(p2.matched === 8 && p2.miss.length === 1 && p2.miss[0] === 'l9 "XXVII" -> "XXV11"', 'a line not found is listed with what the reader saw nearest: ' + p2.miss[0]);
  const items = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const blk = [{ type: 'list', source: items.join(', '), subject: 'Steps', question: 'What are the steps in order?', items: items.slice(0, 8), ordered: true }];
  const q8 = buildQuestions(blk, blk, 1, 'Page 1', 'a').find((q) => q.type === 'order');
  ok(q8 && q8.choices.length === 8 && q8.correctOrder.length === 8 && q8.answer.includes('8. eight'), 'an ordered list of 8 is asked whole');
}

// 0.22.2: a list with one-letter markers and a second column beside it gets all its lines outlined
{
  const names = ['Freedom of religion', 'Right to bear arms', 'Quartering of soldiers', 'Searches and seizures', 'Life, liberty, and property', 'Rights of the accused', 'Right to trial by jury'];
  const marks = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const L = []; let n = 1;
  marks.forEach((m, i) => { const y = 0.4 + i * 0.02; L.push({ id: 'l' + n++, text: m, x: 0.15, y, w: 0.02 + 0.005 * i, h: 0.016 }); L.push({ id: 'l' + n++, text: names[i], x: 0.22, y: y + 0.001, w: 0.2, h: 0.016 }); });
  const side = ['Throughout the convention, Ben Franklin had noticed', 'the back of the chair. There was', 'a sun carved into it.', 'sun, Franklin observed.'];
  side.forEach((tx, i) => L.push({ id: 'l' + n++, text: tx, x: 0.57, y: 0.405 + i * 0.03, w: 0.4, h: 0.015 }));
  const blocksL = [
    { id: 'b1', type: 'list', source: marks.map((m, i) => m + '   ' + names[i]).join('\n'), items: names },
    { id: 'b2', type: 'fact', source: 'a sun carved into it.', items: [] }];
  const a = blockAreas({ lines: L }, blocksL);
  const got = new Set(a.get('b1').lines.map((l) => (typeof l === 'string' ? l : l.id)));
  ok(got.size === 14 && L.slice(0, 14).every((l) => got.has(l.id)), 'every row of a list is outlined, numerals I, V and the rest included (' + got.size + ' of 14)');
  ok(!L.slice(14).some((l) => got.has(l.id)), 'the paragraph in the second column is not part of the list');
  const f = new Set(a.get('b2').lines.map((l) => (typeof l === 'string' ? l : l.id)));
  ok(f.size === 1 && f.has('l17'), 'a fact block still gets only its own line');
}

// 0.23.0: numbered lists (articles, amendments) get one question per number, both ways
{
  const R = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII', 'XXIII', 'XXIV', 'XXV', 'XXVI', 'XXVII'];
  const am = R.map((r, i) => `${r} \u2014 Topic ${i + 1}`);
  const np = numberedParts(am);
  ok(np && np.length === 27 && np[3].label === 'IV' && np[3].value === 4 && np[26].value === 27 && np[3].topic === 'Topic 4', 'Roman numerals are read with their values');
  const arts = ['PREAMBLE \u2014 Introduction', ...['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'].map((r) => `ARTICLE ${r} \u2014 Part ${r}`)];
  const ap = numberedParts(arts);
  ok(ap && ap[0] === null && ap[4].label === 'ARTICLE IV' && ap[4].word === true, 'a list with one heading before the numbers is still numbered, the word stays in the label');
  ok(numberedParts(['Civil rights', 'Citizens vote', 'Congress meets']) === null && numberedParts(['13 colonies', '50 states', '27 amendments']) === null && numberedParts(['plan', 'build', 'test']) === null, 'words, counts and plain steps are not numbered lists');
  ok(numberedParts(['1. Plan', '2. Build', '3. Test']).length === 3 && numberedParts(['1. Plan', '2. Build', '9. Test']) === null, 'numbers must count up, a gap of one or two allowed');
  const parsed = parseBlocks(JSON.stringify({ blocks: [{ type: 'list', source: am.join('\n'), subject: 'Constitutional amendments', question: 'What are the amendments?', items: am, ordered: true }] }));
  ok(parsed.length === 1 && parsed[0].items.length === 27, 'a numbered list keeps all 27 items');
  const plain = parseBlocks(JSON.stringify({ blocks: [{ type: 'list', source: 'a b c d e f g h i j', subject: 'Letters', question: 'Which?', items: ['a','b','c','d','e','f','g','h','i','j'], ordered: false }] }));
  ok(plain[0].items.length === 8, 'other lists still keep 8');
  const qs = buildQuestions(parsed, parsed, 1, 'Page 1', 'a');
  const qa = qs.filter((q) => q.type === 'qa'), ord = qs.filter((q) => q.type === 'order');
  ok(qa.length === 54 && ord.length === 4 && qs.length === 58, 'one question per number, both ways, plus 4 rounds to put in order (got ' + qs.length + ')');
  ok(qa[6].question === 'Constitutional amendments: what is number IV?'.replace('IV', 'IV') || qa[6].question.includes('IV'), 'a number asks for its topic');
  const back = qa.find((q) => q.answer === 'IV');
  ok(back && back.question.includes('Topic 4') && !back.question.includes('number IV'), 'a topic asks for its number (' + (back && back.question) + ')');
  ok(ord.every((q) => q.choices.length >= 6 && q.choices.length <= 8 && q.choices.every((c) => !/^[IVXL]+ /.test(c.text))), 'order rounds hold 6 to 8 topics without their numbers');
  ok(qs.every((q, i) => q.order === i && q.blockType === 'list'), 'questions keep their order and block');
  const mixed = [...parsed, { id: 'b2', type: 'fact', source: 'It was in 1787.', subject: 'Constitution', question: 'When was it written?', value: '1787', items: [], on: true, grounded: true }];
  const both = buildQuestions(mixed, mixed, 1, 'Page 1', 'a');
  ok(both.length === 59 && both[58].blockType !== 'list' && both[0].blockType === 'list', 'blocks keep their place: the list first, then the fact');
}

console.log(`reading: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

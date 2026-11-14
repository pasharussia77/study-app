// Turns what the AI saw on a page into clean study items. The AI only reports what it sees;
// the app works out the correct answers with fixed rules, so the logic can be checked.
import { normalize } from './stats.js';

export const TYPE_LABEL = { term: 'Word', qa: 'Question', tf: 'True/False', mc: 'Multiple choice' };

const MODE_RULES = {
  none: 'Read everything on the page. Record handwritten student answers and red teacher marks as observations (see below).',
  handwriting: 'The reader chose to IGNORE HANDWRITING. Use only printed content. Treat all handwriting and all red teacher marks as if they were not there: set student_answer, marked_wrong and circled_choice to null for every item.',
  printed: 'The reader chose to IGNORE PRINTED TEXT. The study material is the HANDWRITTEN notes on the page. Turn each handwritten note into an item (a handwritten "word - meaning" is a "term", a handwritten question and answer is a "qa"). Ignore printed text, and set student_answer, marked_wrong and circled_choice to null.'
};

export function buildPrompt(ignore = 'none', ctx = null) {
  const carry = ctx && (ctx.section || ctx.last_number || ctx.graded)
    ? `\nThe previous page ended in the section "${ctx.section || 'unknown'}" (type ${ctx.type || 'unknown'}) at question number ${ctx.last_number ?? 'unknown'}.${ctx.graded ? ' The earlier pages were graded by a teacher.' : ''} If this page continues that section without repeating the instructions, reuse that section and its type.`
    : '';
  return `You are turning a photo of a school page into study material. Reply with ONLY valid JSON (no markdown, no commentary).

${MODE_RULES[ignore] || MODE_RULES.none}

A page can mix several kinds of material. Decide the type of EACH item separately and keep the order of the page:
- "mc": a multiple-choice question with labeled choices.
- "tf": a true/false statement. Give its choices exactly as printed (for example A. True, B. False). If none are printed use A. True and B. False.
- "term": a word or term with its definition (word lists, glossaries).
- "qa": a question without choices, with its answer if one is shown.
Never merge, skip or invent items. Keep the printed question number. Ignore the student's name, doodles, scores' decorations, copyright lines, page headers and footers, and anything that is not part of the page (table, fingers, other papers, embossed marks).
Printed instructions such as "True/False: Indicate whether..." tell you the "section" for the items under them until another section starts. Give "section" as a SHORT label of at most 4 words (for example "True/False" or "Multiple Choice"), not the full instruction sentence.${carry}

For every item record only what you SEE, do not work out correct answers yourself:
- student_answer: what the student wrote for this item (a letter or text), or null.
- marked_wrong: true only if the teacher clearly marked THIS item wrong with a red X or slash on or near its number or answer; false if there is no such mark; null if you cannot tell. A small red tick, dot or dash that is not clearly an X, slash or circle is NOT a wrong mark: use false and mention it in note.
- circled_choice: the label of a choice the teacher circled or underlined in red as the correct answer, or null.
- printed_answer: the correct answer if an answer key is printed on the page, or null.
- answer_text: for "term" and "qa", the definition or answer shown on the page, or null.
- confidence: "high", "medium" or "low" for how well you could read this item.
- note: a short note if anything is unclear (cut off, smudged, ambiguous mark), else "".
- needs_review: true ONLY if a person should double-check this item, for example the writing is smudged or cut off, you are unsure what the student wrote, or a red mark is ambiguous. A clear red X, a clear circle, or a clearly readable item is NOT a reason: use false.

Also record for the page: graded (true if any teacher grading such as red marks or a score is visible), score (like "12/15" or null), and ends_with (the section, type and last question number the page ends with).

JSON shape:
{"page":{"graded":true,"score":"12/15"},"ends_with":{"section":"Multiple Choice","type":"mc","last_number":7},"items":[{"type":"mc","section":"Multiple Choice","number":1,"question":"...","choices":[{"label":"A","text":"..."}],"student_answer":"B","marked_wrong":false,"circled_choice":null,"printed_answer":null,"answer_text":null,"confidence":"high","note":"","needs_review":false}]}`;
}

export function buildTextPrompt(ctx = null) {
  const carry = ctx && (ctx.section || ctx.last_number)
    ? `\nThe text before this part ended in the section "${ctx.section || 'unknown'}" (type ${ctx.type || 'unknown'}) at question number ${ctx.last_number ?? 'unknown'}. If this part continues that section without repeating the instructions, reuse that section and its type.`
    : '';
  return `You are turning study text typed or pasted by a student into study material. Reply with ONLY valid JSON (no markdown, no commentary).

The text can mix several kinds of material. Decide the type of EACH item separately and keep the order of the text:
- "mc": a multiple-choice question with labeled choices.
- "tf": a true/false statement. Give its choices as written (for example A. True, B. False). If none are written use A. True and B. False.
- "term": a word or term with its definition (word lists, glossaries, lines like "word - meaning").
- "qa": a question without choices, with its answer if one is given.
Never merge, skip or invent items. Keep the question number if there is one. Ignore headings, names, dates, page numbers, copyright lines and anything that is not study material. Written instructions such as "True/False: Indicate whether..." tell you the "section" for the items under them until another section starts. Give "section" as a SHORT label of at most 4 words (for example "True/False" or "Multiple Choice"), not the full instruction sentence.${carry}

Do NOT work out or guess correct answers yourself. Only record an answer that is written in the text:
- printed_answer: the correct choice letter (or text) if the text gives an answer or an answer key for this item (for example "Answer: B", "1. B", or a key at the end), otherwise null.
- answer_text: for "term" and "qa", the definition or answer written in the text, or null.
- confidence: "high", "medium" or "low" for how clearly you could read this item.
- note: a short note if anything is unclear, else "".
- needs_review: true ONLY if a person should double-check this item (for example the text is garbled, cut off, or you are unsure which answer belongs to it). Otherwise false.
Also record ends_with (the section, type and last question number this text ends with).

JSON shape:
{"ends_with":{"section":"Multiple Choice","type":"mc","last_number":7},"items":[{"type":"mc","section":"Multiple Choice","number":1,"question":"...","choices":[{"label":"A","text":"..."}],"printed_answer":"B","answer_text":null,"confidence":"high","note":"","needs_review":false}]}`;
}

export function chunkText(text, size = 3000) {
  const chunks = [];
  let cur = '';
  const push = () => { if (cur.trim()) chunks.push(cur.trim()); cur = ''; };
  for (const line of String(text).split(/\r?\n/)) {
    if (line.length > size) { push(); for (let i = 0; i < line.length; i += size) chunks.push(line.slice(i, i + size)); continue; }
    if (cur.length + line.length + 1 > size) push();
    cur += line + '\n';
  }
  push();
  return chunks;
}

export function parseAiJson(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
  const bad = (m) => Object.assign(new Error(m), { parse: true });
  if (start === -1 || end === -1) throw bad('The AI did not return study items. Try again.');
  let data;
  try { data = JSON.parse(cleaned.slice(start, end + 1)); }
  catch { throw bad('The AI answer was cut off or garbled. Try again.'); }
  if (!Array.isArray(data.items)) throw bad('The AI answer had no items. Try again.');
  return data;
}

const str = (x) => (x == null ? '' : String(x).trim());

function labelFor(value, choices) {
  const t = str(value).replace(/[.)\s]+$/, '').toUpperCase();
  if (/^[A-Z]$/.test(t) && choices.some((c) => c.label === t)) return t;
  const byText = value != null && choices.find((c) => normalize(c.text) === normalize(value));
  return byText ? byText.label : null;
}

// Fixed rules that decide the correct answer from what the AI observed.
export function resolveItem(raw, page = {}, index = 0) {
  let choices = (Array.isArray(raw.choices) ? raw.choices : []).map((c, i) => ({
    label: (str(c.label).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 1)) || String.fromCharCode(65 + i),
    text: str(c.text)
  })).filter((c) => c.text);
  let type = ['mc', 'tf', 'term', 'qa'].includes(raw.type) ? raw.type : (choices.length ? 'mc' : 'qa');
  if (type === 'tf' && choices.length < 2) choices = [{ label: 'A', text: 'True' }, { label: 'B', text: 'False' }];
  if (type === 'mc' && choices.length < 2) type = 'qa';
  if ((type === 'term' || type === 'qa')) choices = [];

  const graded = !!page.graded;
  const confidence = ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'medium';
  const markedWrong = raw.marked_wrong === true ? true : raw.marked_wrong === false ? false : null;
  const out = {
    type, section: str(raw.section), number: raw.number == null ? null : raw.number, question: str(raw.question),
    choices, correctLabel: null, answer: null, source: 'none', studentAnswer: str(raw.student_answer) || null,
    markedWrong, confidence, note: str(raw.note), order: index, circled: null, printed: null
  };
  let unknownReason = '';

  if (type === 'term' || type === 'qa') {
    const ans = str(raw.answer_text) || str(raw.printed_answer);
    if (ans) { out.answer = ans; out.source = 'page'; } else unknownReason = 'No answer is shown on the page.';
  } else {
    const printed = labelFor(raw.printed_answer, choices);
    const circled = labelFor(raw.circled_choice, choices);
    const student = labelFor(raw.student_answer, choices);
    out.circled = circled; out.printed = printed;
    if (printed) { out.correctLabel = printed; out.source = 'printed key'; }
    else if (circled) { out.correctLabel = circled; out.source = 'circled by teacher'; }
    else if (markedWrong === true) {
      if (choices.length === 2 && student) { out.correctLabel = choices.find((c) => c.label !== student).label; out.source = 'inferred from red X'; }
      else unknownReason = 'The teacher marked this wrong, but the correct choice is not shown.';
    } else if (graded && student) { out.correctLabel = student; out.source = 'assumed correct (no red mark)'; }
    else if (!graded && student) unknownReason = 'The page has no grading, so the student\u2019s answer may be wrong.';
    else unknownReason = 'No answer is marked on the page.';
    if (out.correctLabel) out.answer = choices.find((c) => c.label === out.correctLabel).text;
  }
  if (unknownReason) out.note = [out.note, unknownReason].filter(Boolean).join(' ');
  out.flagged = !out.answer || confidence === 'low' || raw.needs_review === true || (graded && markedWrong === null && type !== 'term' && type !== 'qa');
  return out;
}

export function resolvePage(data, prevCtx = null) {
  // A page with no red marks of its own still counts as graded when the pages before it were.
  const page = { graded: !!(data.page && data.page.graded) || !!(prevCtx && prevCtx.graded), score: str(data.page && data.page.score) || null };
  const items = data.items.filter((r) => r && (str(r.question) || str(r.answer_text))).map((r, i) => resolveItem(r, page, i));
  const ends = data.ends_with || {};
  const ctx = { section: str(ends.section), type: str(ends.type), last_number: ends.last_number ?? null, graded: page.graded };
  return { page, items, ctx };
}

// Compares the score written on the sheet with the red X marks found.
export function crossCheck(files, items) {
  const scored = files.find((f) => f.page && f.page.score);
  if (!scored) return null;
  const m = /(\d+)\s*\/\s*(\d+)/.exec(scored.page.score);
  if (!m) return null;
  const got = +m[1], total = +m[2];
  const wrongFound = items.filter((i) => i.markedWrong === true).length;
  const questions = items.filter((i) => i.type !== 'term').length;
  return { score: scored.page.score, expectedWrong: total - got, wrongFound, questions, total, ok: wrongFound === total - got, countOk: questions === total };
}

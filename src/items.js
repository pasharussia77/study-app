// Turns what the AI saw on a page into clean study items. The AI only reports what it sees;
// the app works out the correct answers with fixed rules, so the logic can be checked.
import { normalize } from './stats.js';

import { shorterIsTerm } from './parse.js';

export const TYPE_LABEL = { term: 'Word', qa: 'Question', tf: 'True/False', mc: 'Multiple choice', multi: 'Select all', order: 'Put in order' };

const MODE_RULES = {
  none: 'Read everything on the page. Record handwritten student answers and red teacher marks as observations (see below).',
  handwriting: 'The reader chose to IGNORE HANDWRITING. Use only printed content. Treat all handwriting and all red teacher marks as if they were not there: set student_answer, marked_wrong, circled_choice, selected_choices and order_numbers to null for every item.',
  printed: 'The reader chose to IGNORE PRINTED TEXT. The study material is the HANDWRITTEN notes on the page. Turn each handwritten note into an item (a handwritten "word - meaning" is a "term", a handwritten question and answer is a "qa"). Ignore printed text, and set student_answer, marked_wrong, circled_choice, selected_choices and order_numbers to null.'
};

const KEY_RULE = ' The reader says the HANDWRITING on this page is the ANSWER KEY: the correct answers were written in by hand, often in red ink. Record each handwritten answer in student_answer exactly as written (for example "T", "F", a letter, or a word or name). Handwritten answers in red ink are NOT teacher grading: set graded to true only if there is a score or there are red X marks, slashes or check marks beside answers.';

export function buildPrompt(ignore = 'none', ctx = null, hand = 'key') {
  const carry = ctx && (ctx.section || ctx.last_number || ctx.graded)
    ? `\nThe previous page ended in the section "${ctx.section || 'unknown'}" (type ${ctx.type || 'unknown'}) at question number ${ctx.last_number ?? 'unknown'}.${ctx.graded ? ' The earlier pages were graded by a teacher.' : ''} If this page continues that section without repeating the instructions, reuse that section and its type.`
    : '';
  return `You are turning a photo of a school page into study material. Reply with ONLY valid JSON (no markdown, no commentary).

${MODE_RULES[ignore] || MODE_RULES.none}${(ignore === 'none' || !MODE_RULES[ignore]) && hand !== 'student' ? KEY_RULE : ''}

A page can mix several kinds of material. Decide the type of EACH item separately and keep the order of the page:
- "mc": a multiple-choice question with labeled choices and ONE correct choice.
- "multi": a question where SEVERAL choices can be correct ("select all that apply", "mark all the correct answers", "choose two"), usually with a small circle or box printed in front of each choice. List every choice, in the printed order.
- "order": a list of events or steps to number or put in order ("number the events in order"). Put each event in "choices", in the printed order from top to bottom.
- "tf": a true/false statement. Give its choices exactly as printed (for example A. True, B. False). If none are printed use A. True and B. False.
- "term": a word or term with its definition (word lists, glossaries).
- "qa": a question without choices, with its answer if one is shown.
Never merge, skip or invent items. Keep the printed question number. If choices have no printed letters, label them A, B, C and so on in the printed order. Ignore the student's name, doodles, scores' decorations, copyright lines, page headers and footers, and anything that is not part of the page (table, fingers, other papers, embossed marks).
Printed instructions such as "True/False: Indicate whether..." tell you the "section" for the items under them until another section starts. Give "section" as a SHORT label of at most 4 words (for example "True/False" or "Multiple Choice"), not the full instruction sentence.${carry}

For every item record only what you SEE, do not work out correct answers yourself:
- student_answer: what the student wrote for this item (a letter or text), or null.
- marked_wrong: true only if the teacher clearly marked THIS item wrong with a red X or slash on or near its number or answer; false if there is no such mark; null if you cannot tell. A small red tick, dot or dash that is not clearly an X, slash or circle is NOT a wrong mark: use false and mention it in note.
- circled_choice: the label of a choice the teacher circled or underlined in red as the correct answer, or null.
- selected_choices: for "multi" only, the list of labels of the choices that were MARKED BY HAND: the circle or box in front of the choice is filled in, shaded, coloured, ticked or crossed with pen or pencil. Look at EACH circle on its own. A filled circle is solid ink inside; a hollow circle still shows blank paper inside and is NOT selected. Do not guess from what the correct answer should be. Use [] if no circle is filled, and null for other types.
- unclear_choices: for "multi" only, the labels of choices where you cannot tell whether the circle is filled, else [].
- order_numbers: for "order" only, the number written by hand beside each event, as a list with one entry per choice in the same top-to-bottom order as "choices" (for example [1,4,2,5,3] means the first printed event happened first and the second printed event happened fourth). Use null for an event with no number, and null for other types.
- printed_answer: the correct answer if an answer key is printed on the page, or null.
- answer_text: for "term" and "qa", the definition or answer shown on the page, or null.
- confidence: "high", "medium" or "low" for how well you could read this item.
- note: a short note if anything is unclear (cut off, smudged, ambiguous mark), else "".
- needs_review: true ONLY if a person should double-check this item, for example the writing is smudged or cut off, you are unsure what the student wrote, or a red mark is ambiguous. A clear red X, a clear circle, or a clearly readable item is NOT a reason: use false.

Also record for the page: graded (true if any teacher grading such as red marks or a score is visible), score (like "12/15" or null), and ends_with (the section, type and last question number the page ends with).

JSON shape:
{"page":{"graded":true,"score":"12/15"},"ends_with":{"section":"Multiple Choice","type":"mc","last_number":7},"items":[{"type":"mc","section":"Multiple Choice","number":1,"question":"...","choices":[{"label":"A","text":"..."}],"student_answer":"B","marked_wrong":false,"circled_choice":null,"selected_choices":null,"unclear_choices":[],"order_numbers":null,"printed_answer":null,"answer_text":null,"confidence":"high","note":"","needs_review":false}]}`;
}

export function buildTextPrompt(ctx = null) {
  const carry = ctx && (ctx.section || ctx.last_number)
    ? `\nThe text before this part ended in the section "${ctx.section || 'unknown'}" (type ${ctx.type || 'unknown'}) at question number ${ctx.last_number ?? 'unknown'}. If this part continues that section without repeating the instructions, reuse that section and its type.`
    : '';
  return `You are turning study text typed or pasted by a student into study material. Reply with ONLY valid JSON (no markdown, no commentary).

The text can mix several kinds of material. Decide the type of EACH item separately and keep the order of the text:
- "mc": a multiple-choice question with labeled choices and ONE correct choice.
- "multi": a question where SEVERAL choices can be correct ("select all that apply"). List every choice.
- "order": a list of events or steps to put in order. Put each event in "choices", in the order written.
- "tf": a true/false statement. Give its choices as written (for example A. True, B. False). If none are written use A. True and B. False.
- "term": a word or term with its definition (word lists, glossaries, lines like "word - meaning").
- "qa": a question without choices, with its answer if one is given.
Never merge, skip or invent items. Keep the question number if there is one. Ignore headings, names, dates, page numbers, copyright lines and anything that is not study material. Written instructions such as "True/False: Indicate whether..." tell you the "section" for the items under them until another section starts. Give "section" as a SHORT label of at most 4 words (for example "True/False" or "Multiple Choice"), not the full instruction sentence.${carry}

Do NOT work out or guess correct answers yourself. Only record an answer that is written in the text:
- printed_answer: the correct choice letter (or text) if the text gives an answer or an answer key for this item (for example "Answer: B", "1. B", or a key at the end), otherwise null. For "multi" give the list of correct labels (for example ["A","C"]). For "order" give the labels in the correct order (for example ["B","A","C"]).
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

// What a handwritten mark on a true/false line means: T is True, F is False,
// and any other word means False with that word as the correction.
export function readTrueFalse(value, choices) {
  const v = str(value);
  if (!v) return null;
  const T = choices.find((c) => normalize(c.text) === 'true'), F = choices.find((c) => normalize(c.text) === 'false');
  const byLabel = labelFor(v, choices);
  if (byLabel) return { label: byLabel, correction: '' };
  if (!T || !F) return null;
  const bare = v.replace(/^[\s"'(]+|[\s"').,;:!]+$/g, '');
  if (/^(t|true|yes|correct|✓|✔)$/i.test(bare)) return { label: T.label, correction: '' };
  if (/^(f|false|no)$/i.test(bare)) return { label: F.label, correction: '' };
  const m = /^(?:f|false)\b[\s.,:;()\-–—]+(.+)$/i.exec(bare);
  return { label: F.label, correction: (m ? m[1] : bare).trim() };
}

// Turns a list (or a string like "A, C" or "1 2 4") into choice labels, in the order given. Null if any part is not a choice.
export function parseLabels(value, choices) {
  if (value == null) return null;
  const parts = (Array.isArray(value) ? value : String(value).split(/[\s,;&/]+|\band\b/i)).map(str).filter(Boolean);
  const out = [];
  for (const part of parts) {
    let label = labelFor(part, choices);
    if (!label && /^\d+$/.test(part) && choices[+part - 1]) label = choices[+part - 1].label;
    if (!label) return null;
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

export const MEDIUM_NOTE = 'The AI was only fairly sure it read the handwriting correctly.';
const HAND_SOURCES = ['handwritten answer key', 'assumed correct (no red mark)', 'inferred from red X', 'circled by teacher'];
const REASONS = [
  MEDIUM_NOTE,
  'The teacher marked this wrong, but the correct choices are not shown.',
  'No choices are marked on the page.',
  'The numbers written beside the events are not a complete order.',
  'No order is written on the page.',
  'No answer is shown on the page.',
  'The teacher marked this wrong, but the correct choice is not shown.',
  'The page has no grading, so the student\u2019s answer may be wrong.',
  'No answer is marked on the page.',
  'The handwritten answer does not match any choice.'
];

// Fixed rules that decide the correct answer from what the AI observed.
export function resolveItem(raw, page = {}, index = 0) {
  let choices = (Array.isArray(raw.choices) ? raw.choices : []).map((c, i) => ({
    label: (str(c.label).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 1)) || String.fromCharCode(65 + i),
    text: str(c.text)
  })).filter((c) => c.text);
  let type = ['mc', 'tf', 'term', 'qa', 'multi', 'order'].includes(raw.type) ? raw.type : (choices.length ? 'mc' : 'qa');
  if (type === 'tf' && choices.length < 2) choices = [{ label: 'A', text: 'True' }, { label: 'B', text: 'False' }];
  if ((type === 'mc' || type === 'multi' || type === 'order') && choices.length < 2) type = 'qa';
  if ((type === 'term' || type === 'qa')) choices = [];

  const graded = !!page.graded;
  // On a page without grading, handwriting is the answer key unless the reader said it is a student's work.
  const isKey = !graded && page.hand !== 'student';
  const confidence = ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'medium';
  const markedWrong = raw.marked_wrong === true ? true : raw.marked_wrong === false ? false : null;
  const out = {
    type, section: str(raw.section), number: raw.number == null ? null : raw.number, question: str(raw.question),
    choices, correctLabel: null, answer: null, source: 'none', studentAnswer: str(raw.student_answer) || null,
    markedWrong, confidence, note: str(raw.note), order: index, circled: null, printed: null,
    correction: '', aiReview: raw.needs_review === true
  };
  let unknownReason = '';

  if (type === 'term' || type === 'qa') {
    const ans = str(raw.answer_text) || str(raw.printed_answer);
    if (ans) {
      out.answer = ans; out.source = 'page';
      // The term is always the shorter side: if the "question" is longer than its answer, swap them.
      if (type === 'term' && out.question && !shorterIsTerm(out.question, ans)) { out.answer = out.question; out.question = ans; out.swapped = true; }
    }
    else if (isKey && out.studentAnswer) { out.answer = out.studentAnswer; out.source = 'handwritten answer key'; }
    else unknownReason = 'No answer is shown on the page.';
  } else if (type === 'multi' || type === 'order') {
    const multi = type === 'multi';
    const printed = parseLabels(raw.printed_answer, choices);
    const printedOk = printed && printed.length && (multi || printed.length === choices.length);
    out.printedList = printedOk ? printed : null;
    let seen = null; // what the handwriting says, as labels
    if (multi) {
      const sel = parseLabels(raw.selected_choices, choices) || [];
      out.selected = choices.filter((c) => sel.includes(c.label)).map((c) => c.label);
      out.unclear = parseLabels(raw.unclear_choices, choices) || [];
      if (out.selected.length) seen = out.selected;
    } else {
      const nums = Array.isArray(raw.order_numbers) ? raw.order_numbers.map((n) => (n == null || n === '' || isNaN(+n) ? null : +n)) : [];
      out.orderNumbers = nums;
      const complete = nums.length === choices.length && [...nums].sort((a, b) => a - b).every((n, i) => n === i + 1);
      if (complete) seen = choices.map((c, i) => ({ c, n: nums[i] })).sort((a, b) => a.n - b.n).map((x) => x.c.label);
      else if (nums.some((n) => n != null)) unknownReason = 'The numbers written beside the events are not a complete order.';
    }
    let labels = null;
    if (printedOk) { labels = printed; out.source = 'printed key'; }
    else if (seen && markedWrong === true) unknownReason = 'The teacher marked this wrong, but the correct choices are not shown.';
    else if (seen && graded) { labels = seen; out.source = 'assumed correct (no red mark)'; }
    else if (seen && isKey) { labels = seen; out.source = 'handwritten answer key'; }
    else if (seen) unknownReason = 'The page has no grading, so the student\u2019s answer may be wrong.';
    else if (!unknownReason) unknownReason = multi ? 'No choices are marked on the page.' : 'No order is written on the page.';
    if (labels) {
      const text = (l) => choices.find((c) => c.label === l).text;
      if (multi) { out.correctLabels = choices.filter((c) => labels.includes(c.label)).map((c) => c.label); out.answer = out.correctLabels.map(text).join('; '); }
      else { out.correctOrder = labels; out.answer = labels.map((l, i) => `${i + 1}. ${text(l)}`).join('; '); }
    }
    if (multi && out.unclear.length) unknownReason = [unknownReason, `Could not tell whether these are marked: ${out.unclear.join(', ')}.`].filter(Boolean).join(' ');
  } else {
    const printed = labelFor(raw.printed_answer, choices);
    const circled = labelFor(raw.circled_choice, choices);
    const read = type === 'tf' ? readTrueFalse(raw.student_answer, choices) : null;
    const student = read ? read.label : labelFor(raw.student_answer, choices);
    const correction = read ? read.correction : '';
    out.circled = circled; out.printed = printed;
    if (printed) { out.correctLabel = printed; out.source = 'printed key'; }
    else if (circled) { out.correctLabel = circled; out.source = 'circled by teacher'; }
    else if (markedWrong === true) {
      if (choices.length === 2 && student) { out.correctLabel = choices.find((c) => c.label !== student).label; out.source = 'inferred from red X'; }
      else unknownReason = 'The teacher marked this wrong, but the correct choice is not shown.';
    } else if (graded && student) { out.correctLabel = student; out.source = 'assumed correct (no red mark)'; out.correction = correction; }
    else if (isKey && student) { out.correctLabel = student; out.source = 'handwritten answer key'; out.correction = correction; }
    else if (!graded && student) unknownReason = 'The page has no grading, so the student\u2019s answer may be wrong.';
    else if (out.studentAnswer) unknownReason = 'The handwritten answer does not match any choice.';
    else unknownReason = 'No answer is marked on the page.';
    if (out.correctLabel) out.answer = choices.find((c) => c.label === out.correctLabel).text;
  }
  // An answer that rests on handwriting the AI read with only medium confidence is worth a look (a T can be misread as an F).
  const shakyHand = !!out.answer && confidence === 'medium' && (HAND_SOURCES.includes(out.source) || (out.source === 'page' && !!out.studentAnswer));
  if (shakyHand) unknownReason = [unknownReason, MEDIUM_NOTE].filter(Boolean).join(' ');
  if (unknownReason) out.note = [out.note, unknownReason].filter(Boolean).join(' ');
  out.flagged = shakyHand || !out.answer || (out.unclear && out.unclear.length > 0) || confidence === 'low' || raw.needs_review === true || (graded && markedWrong === null && type !== 'term' && type !== 'qa');
  return out;
}

export function resolvePage(data, prevCtx = null, hand = 'key') {
  // A page with no red marks of its own still counts as graded when the pages before it were.
  const page = { graded: !!(data.page && data.page.graded) || !!(prevCtx && prevCtx.graded), score: str(data.page && data.page.score) || null, hand: hand === 'student' ? 'student' : 'key' };
  const items = data.items.filter((r) => r && (str(r.question) || str(r.answer_text))).map((r, i) => resolveItem(r, page, i));
  fixNumbers(items, prevCtx);
  const ends = data.ends_with || {};
  const ctx = { section: str(ends.section), type: str(ends.type), last_number: ends.last_number ?? null, graded: page.graded };
  return { page, items, ctx };
}

// Question numbers keep counting up. When a number repeats for a different question and the next number
// shows there is a gap (45, 45, 47), the repeat is the next number (46). `ctx` is how the page before ended.
// Changes the list in place and returns the positions it changed.
export function fixNumbers(seq, ctx = null) {
  let prev = ctx && ctx.last_number != null && Number.isFinite(+ctx.last_number) ? { number: +ctx.last_number, type: ctx.type, question: null, fromCtx: true } : null;
  const changed = [];
  seq.forEach((cur, i) => {
    const n = cur.number == null || !Number.isFinite(+cur.number) ? null : +cur.number;
    if (n != null && prev && prev.number === n) {
      const differs = prev.fromCtx ? cur.type !== prev.type : normalize(cur.question) !== normalize(prev.question);
      const next = seq.slice(i + 1).find((x) => x.number != null && Number.isFinite(+x.number));
      if (differs && (!next || +next.number > n + 1)) { cur.number = n + 1; changed.push(i); }
    }
    prev = { number: cur.number == null ? null : +cur.number, type: cur.type, question: cur.question };
  });
  return changed;
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

// Works out an item again from what is already stored (no AI). Returns the fields to change, or null to leave it alone.
export function reapplyItem(it, page = {}) {
  if (!it || it.source === 'set by you' || it.fileId === 'text') return null;
  let note = str(it.note);
  REASONS.forEach((r) => { note = note.split(r).join(''); });
  note = note.replace(/Could not tell whether these are marked: [A-Z, ]+\./, '').replace(/\s+/g, ' ').trim();
  const isChoice = it.type === 'tf' || it.type === 'mc' || it.type === 'multi' || it.type === 'order';
  const isList = it.type === 'multi' || it.type === 'order';
  let aiReview = it.aiReview;
  if (aiReview == null) {
    // Older items did not store the AI's own "please check" flag, so work it out.
    const byApp = !it.answer || it.confidence === 'low' || (!!page.graded && it.markedWrong == null && isChoice);
    aiReview = it.answer ? (!!it.flagged && !byApp) : /unclear|unsure|not sure|smudg|cut off|ambiguous|illegible|hard to read|cannot|can\u2019t|can't|partly|faint/i.test(note);
  }
  const r = resolveItem({
    type: it.type, section: it.section, number: it.number, question: it.question, choices: it.choices,
    student_answer: it.studentAnswer, marked_wrong: it.markedWrong, circled_choice: it.circled, printed_answer: isList ? it.printedList : it.printed,
    selected_choices: it.selected, unclear_choices: it.unclear, order_numbers: it.orderNumbers,
    answer_text: !isChoice && it.source === 'page' ? it.answer : null, confidence: it.confidence, note, needs_review: aiReview
  }, page, it.order ?? 0);
  const patch = { ...(it.type === 'term' ? { question: r.question } : {}), correctLabel: r.correctLabel, ...(it.type === 'multi' ? { correctLabels: r.correctLabels ?? null } : {}), ...(it.type === 'order' ? { correctOrder: r.correctOrder ?? null } : {}), answer: r.answer, source: r.source, note: r.note, flagged: r.flagged, correction: r.correction, aiReview: r.aiReview };
  const cur = (k) => (k === 'question' ? it.question : k === 'correction' ? it.correction || '' : k === 'aiReview' ? it.aiReview : it[k] ?? null);
  const same = Object.keys(patch).every((k) => JSON.stringify(patch[k] ?? null) === JSON.stringify(cur(k) ?? null));
  return same ? null : patch;
}

// Finds questions that were read twice (for example one page photographed twice).
// Each group says which copy to keep (the best one) and which to drop.
export function duplicateGroups(items) {
  const groups = new Map();
  for (const it of items) {
    const q = normalize(it.question);
    if (q.length < 4) continue;
    const key = [it.type, it.number ?? '', q, (it.choices || []).map((c) => normalize(c.text)).join('~')].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const rank = (it) => (it.source === 'set by you' ? 3 : it.answer && !it.flagged ? 2 : it.answer ? 1 : 0);
  const out = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => rank(b) - rank(a) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
    out.push({ keep: sorted[0], drop: sorted.slice(1) });
  }
  return out;
}

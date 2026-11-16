// The deck is everything studyable: typed "word - definition" lines plus the AI-made items.
import { cardKey } from './stats.js';

// Everything shown to the student carries the question's number from the page, when it has one.
// The number stays glued to the first word (no line break after it), and a blank like ________ is always the same short length.
export const tidy = (text) => String(text ?? '').replace(/_{3,}/g, '_____');
export const withNumber = (c, text) => (c && c.number != null && c.number !== '' && text ? `${c.number}.\u00A0${tidy(text)}` : tidy(text));

// For a card: the number goes on a line of its own, with the text under it. Returns [number or null, text].
export function numberParts(c, shown) {
  const prefix = c && c.number != null && c.number !== '' ? `${c.number}.\u00A0` : null;
  return prefix && String(shown).startsWith(prefix) ? [`${c.number}.`, String(shown).slice(prefix.length)] : [null, shown];
}

// Items in the order of the pages: the photos in the order they were added, then the order on each page.
export function inPageOrder(items, files = []) {
  const fileTime = new Map(files.map((f) => [f.id, f.createdAt ?? 0]));
  const firstSeen = new Map();
  for (const it of items) if (it.fileId !== 'text') firstSeen.set(it.fileId, Math.min(firstSeen.get(it.fileId) ?? Infinity, it.createdAt ?? 0));
  const rank = (it) => (it.fileId === 'text' ? -1 : fileTime.has(it.fileId) ? fileTime.get(it.fileId) : firstSeen.get(it.fileId) ?? 0);
  return [...items].sort((a, b) => rank(a) - rank(b) || (a.order ?? 0) - (b.order ?? 0) || String(a.id).localeCompare(String(b.id)));
}

export function buildDeck(textCards, items, files = []) {
  const deck = [];
  // Once the AI has made study items from the typed text, those replace the simple typed cards.
  const textMade = items.some((i) => i.fileId === 'text');
  for (const c of textMade ? [] : textCards) {
    // progress is saved under what the line said at first, so it is not lost when the rules change
    deck.push({ key: cardKey({ term: c.rawTerm ?? c.term, definition: c.rawDefinition ?? c.definition }), type: 'term', prompt: c.term, answer: c.definition, term: c.term, definition: c.definition, number: c.number ?? null });
  }
  let notReady = 0;
  for (const it of inPageOrder(items, files)) {
    if (!it.answer || !it.question) { notReady++; continue; }
    const key = 'i' + cardKey({ term: it.id, definition: it.answer });
    const base = { key, type: it.type, prompt: it.question, answer: it.answer, itemId: it.id, number: it.number, section: it.section, correction: it.type === 'tf' && it.correction ? it.correction : '' };
    if (it.type === 'term') deck.push({ ...base, term: it.question, definition: it.answer });
    else if (it.type === 'qa') deck.push(base);
    else if (it.type === 'multi' || it.type === 'order') {
      const text = (l) => (it.choices.find((c) => c.label === l) || {}).text;
      const labels = it.type === 'multi' ? it.correctLabels : it.correctOrder;
      const list = Array.isArray(labels) ? labels.map(text).filter(Boolean) : [];
      if (!list.length || (it.type === 'order' && list.length !== it.choices.length)) { notReady++; continue; }
      deck.push({ ...base, choices: it.choices.map((c) => c.text), ...(it.type === 'multi' ? { answers: list } : { sequence: list }) });
    }
    else deck.push({ ...base, choices: it.choices.map((c) => c.text) });
  }
  return { deck, notReady };
}

export const isChoiceOnly = (c) => c.type === 'tf' || c.type === 'mc' || c.type === 'multi' || c.type === 'order';
const LETTER = (i) => String.fromCharCode(65 + i);
// The letters of the right answer, as shown beside the choices: several for "select all", in order for "put in order".
export const answerLetters = (c) => (c.type === 'multi' ? c.answers : c.sequence).map((t) => LETTER(c.choices.indexOf(t)));

// What each side of a flashcard shows.
export function cardFaces(c, first) {
  if (c.type === 'term') {
    const t = first === 'term';
    return { fl: t ? 'word' : 'definition', ft: withNumber(c, t ? c.term : c.definition), bl: t ? 'definition' : 'word', bt: t ? c.definition : c.term, extra: null };
  }
  if (c.type === 'qa') return { fl: 'question', ft: withNumber(c, c.prompt), bl: 'answer', bt: c.answer, extra: null };
  if (c.type === 'tf') return { fl: 'true or false?', ft: withNumber(c, c.prompt), bl: 'answer', bt: c.correction ? `${c.answer} (correct: ${c.correction})` : c.answer, extra: null };
  const L = LETTER;
  const lettered = c.choices.map((x, i) => `${L(i)}. ${x}`);
  if (c.type === 'multi') return { fl: 'select all that apply', ft: withNumber(c, c.prompt), bl: 'answers', bt: c.answers.map((t) => `${L(c.choices.indexOf(t))}. ${t}`).join('\n'), extra: lettered, list: c.answers.map((t) => ({ k: L(c.choices.indexOf(t)), text: t })) };
  if (c.type === 'order') return { fl: 'put in order', ft: withNumber(c, c.prompt), bl: 'correct order', bt: c.sequence.map((t, i) => `${i + 1}. ${t}`).join('\n'), extra: lettered, list: c.sequence.map((t, i) => ({ k: `${i + 1} · ${L(c.choices.indexOf(t))}`, text: t })) };
  const idx = c.choices.findIndex((x) => x === c.answer);
  return { fl: 'multiple choice', ft: withNumber(c, c.prompt), bl: 'answer', bt: `${L(idx < 0 ? 0 : idx)}. ${c.answer}`, extra: c.choices.map((x, i) => `${L(i)}. ${x}`) };
}

export function deckTypes(deck) {
  const counts = {};
  deck.forEach((c) => { counts[c.type] = (counts[c.type] || 0) + 1; });
  return counts;
}

// The deck is everything studyable: typed "word - definition" lines plus the AI-made items.
import { cardKey } from './stats.js';

export function buildDeck(textCards, items) {
  const deck = [];
  // Once the AI has made study items from the typed text, those replace the simple typed cards.
  const textMade = items.some((i) => i.fileId === 'text');
  for (const c of textMade ? [] : textCards) {
    deck.push({ key: cardKey(c), type: 'term', prompt: c.term, answer: c.definition, term: c.term, definition: c.definition });
  }
  let notReady = 0;
  for (const it of items) {
    if (!it.answer || !it.question) { notReady++; continue; }
    const key = 'i' + cardKey({ term: it.id, definition: it.answer });
    const base = { key, type: it.type, prompt: it.question, answer: it.answer, itemId: it.id, number: it.number, section: it.section, correction: it.type === 'tf' && it.correction ? it.correction : '' };
    if (it.type === 'term') deck.push({ ...base, term: it.question, definition: it.answer });
    else if (it.type === 'qa') deck.push(base);
    else deck.push({ ...base, choices: it.choices.map((c) => c.text) });
  }
  return { deck, notReady };
}

export const isChoiceOnly = (c) => c.type === 'tf' || c.type === 'mc';

// What each side of a flashcard shows.
export function cardFaces(c, first) {
  if (c.type === 'term') {
    const t = first === 'term';
    return { fl: t ? 'word' : 'definition', ft: t ? c.term : c.definition, bl: t ? 'definition' : 'word', bt: t ? c.definition : c.term, extra: null };
  }
  if (c.type === 'qa') return { fl: 'question', ft: c.prompt, bl: 'answer', bt: c.answer, extra: null };
  if (c.type === 'tf') return { fl: 'true or false?', ft: c.prompt, bl: 'answer', bt: c.correction ? `${c.answer} (correct: ${c.correction})` : c.answer, extra: null };
  const idx = c.choices.findIndex((x) => x === c.answer);
  const L = (i) => String.fromCharCode(65 + i);
  return { fl: 'multiple choice', ft: c.prompt, bl: 'answer', bt: `${L(idx < 0 ? 0 : idx)}. ${c.answer}`, extra: c.choices.map((x, i) => `${L(i)}. ${x}`) };
}

export function deckTypes(deck) {
  const counts = {};
  deck.forEach((c) => { counts[c.type] = (counts[c.type] || 0) + 1; });
  return counts;
}

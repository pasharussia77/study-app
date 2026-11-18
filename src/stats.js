// Progress helpers shared by flashcards and the written quiz.
export function cardKey(card) {
  const s = card.term + '\u0001' + card.definition;
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 'c' + (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

// last: 'right' | 'wrong' | undefined (not covered yet)
export function summarize(cards, items = {}) {
  let correct = 0, incorrect = 0;
  const missed = [], remaining = [];
  for (const c of cards) {
    const last = items[c.key || cardKey(c)]?.last;
    if (last === 'right') correct++;
    else if (last === 'wrong') { incorrect++; missed.push(c); }
    else remaining.push(c);
  }
  const total = cards.length;
  return { total, covered: correct + incorrect, remainingCount: remaining.length, correct, incorrect, missed, remaining, mastered: total > 0 && correct === total };
}

export function pickChoices(sum) {
  const out = [{ id: 'all', label: `All cards (${sum.total})` }];
  if (sum.covered > 0 && sum.remainingCount > 0) out.push({ id: 'remaining', label: `Not covered yet (${sum.remainingCount})` });
  if (sum.incorrect > 0) out.push({ id: 'missed', label: `Missed only (${sum.incorrect})` });
  return out;
}
export function defaultPick(sum) {
  if (sum.incorrect > 0 && sum.remainingCount === 0) return 'missed';
  if (sum.covered > 0 && sum.remainingCount > 0) return 'remaining';
  return 'all';
}
export function queueFor(pick, cards, sum) {
  if (pick === 'missed') return sum.missed;
  if (pick === 'remaining') return sum.remaining;
  return cards;
}

// ----- Answer checking that forgives small typos -----
export function normalize(s) {
  return (s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\b(a|an|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
function distance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
export function isCorrect(answer, expected) {
  const a = normalize(answer);
  if (!a) return false;
  const options = [expected, ...expected.split(/\s*[;/]\s*/)].map(normalize).filter(Boolean);
  // When the right answer holds exactly one number, that number alone is right too ("435" for "435 representatives", "25" for "at least 25 years old").
  const nums = (x) => String(x).match(/\d[\d,.]*\d|\d/g) || [];
  const bare = String(answer).trim().replace(/[.,]$/, '');
  if (/^\d[\d,.]*$/.test(bare)) {
    const n = nums(expected);
    if (n.length === 1 && n[0].replace(/,/g, '') === bare.replace(/,/g, '')) return true;
  }
  return options.some((e) => {
    if (a === e) return true;
    const len = Math.max(a.length, e.length);
    const allowed = len <= 3 ? 0 : len <= 8 ? 1 : Math.max(2, Math.floor(len * 0.15));
    return distance(a, e) <= allowed;
  });
}

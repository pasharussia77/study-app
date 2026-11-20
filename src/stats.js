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
// A numbered label ("IV", "ARTICLE IV", "12") is also right as the number ("4", "four") with or without its word ("article 4").
const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100 };
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const numberWord = (n) => (n < 20 ? ONES[n] : n < 100 ? TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '') : n === 100 ? 'one hundred' : '');
const LABEL_WORD = '(?:article|amendment|chapter|section|step|part|rule|lesson|unit)';
function numeralValue(expected) {
  const m = new RegExp('^\\s*(?:' + LABEL_WORD + '\\s+)?([IVXLC]{1,8}|\\d{1,3})\\s*$', 'i').exec(String(expected || ''));
  if (!m) return 0;
  if (/^\d+$/.test(m[1])) return parseInt(m[1], 10);
  const r = m[1];
  if (r !== r.toUpperCase()) return 0; // a lower-case "mix" or "civil" is a word, not a numeral
  let t = 0; for (let i = 0; i < r.length; i++) { const v = ROMAN[r[i]], n = ROMAN[r[i + 1]] || 0; t += v < n ? -v : v; }
  return t;
}
function sameNumeral(a, expected) {
  const v = numeralValue(expected);
  if (!v || v > 100) return false;
  const bare = a.replace(new RegExp('^(?:' + LABEL_WORD + '|number|no)\\s+'), '');
  const romanForm = (() => { let n = v, out = ''; for (const [sym, val] of [['C', 100], ['XC', 90], ['L', 50], ['XL', 40], ['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1]]) while (n >= val) { out += sym; n -= val; } return out.toLowerCase(); })();
  return bare === String(v) || bare === normalize(numberWord(v)) || bare === romanForm;
}
export function isCorrect(answer, expected) {
  const a = normalize(answer);
  if (!a) return false;
  if (sameNumeral(a, expected)) return true;
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

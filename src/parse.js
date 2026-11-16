// Turns pasted material into flashcards. Each line "term - definition" becomes one card.
const SEPARATORS = ['\t', ' – ', ' — ', ' - ', ': ', ' = '];

const wordCount = (s) => (String(s).match(/\S+/g) || []).length;
// True when `a` should be the term and `b` the definition: the term is always the shorter side
// (fewer words; if the same, fewer letters; if the same, the first one).
export function shorterIsTerm(a, b) {
  const wa = wordCount(a), wb = wordCount(b);
  if (wa !== wb) return wa < wb;
  return String(a).length <= String(b).length;
}

export function parseCards(text) {
  const cards = [];
  let skipped = 0;
  const skippedLines = [];
  for (const raw of (text || '').split(/\r?\n/)) {
    const full = raw.trim();
    if (!full) continue;
    // "12. word - meaning": the number is kept as the card's number, not as part of the word.
    const nm = /^(\d{1,3})\s*[.)]\s+(\S.*)$/.exec(full);
    const line = nm ? nm[2] : full;
    const prefix = nm ? full.slice(0, full.length - line.length) : '';
    let best = -1, sepLen = 0;
    for (const sep of SEPARATORS) {
      const i = line.indexOf(sep);
      if (i > 0 && (best === -1 || i < best)) { best = i; sepLen = sep.length; }
    }
    if (best === -1) { skipped++; skippedLines.push(full); continue; }
    const first = line.slice(0, best).trim();
    const second = line.slice(best + sepLen).trim();
    if (!first || !second) { skipped++; skippedLines.push(full); continue; }
    const swapped = !shorterIsTerm(first, second);
    cards.push({
      id: cards.length, term: swapped ? second : first, definition: swapped ? first : second,
      number: nm ? +nm[1] : null, swapped,
      // what the line said before any change: progress is saved under this, so it survives the new rules
      rawTerm: prefix + first, rawDefinition: second
    });
  }
  return { cards, skipped, skippedLines };
}

export function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function datedName(name, d = new Date()) {
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${name.trim()} – ${iso}`;
}
// A project's name without the date that was added when it was made. The saved name is not changed.
export function shortName(name) {
  return String(name || '').replace(/\s+[–-]\s+\d{4}-\d{2}-\d{2}$/, '') || String(name || '');
}
export function niceDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const WORDS = ['amber','birch','cedar','dune','ember','fjord','glade','harbor','iris','jade','kite','lotus','maple','north','olive','pearl','quartz','river','sage','tulip','umber','vivid','willow','xenon','yarrow','zephyr','coral','delta','frost','grove','lunar','meadow','nova','opal','pine','quill','reef','solar','tide','vale','wren','aster','brook','cliff','dawn','echo','fern','gust','hazel','ivy','juniper','koala','lagoon','mist','nectar','otter','prism','raven','spark','thistle','urchin','violet','wave'];
export function makeFamilyCode() {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
  const n = String(Math.floor(Math.random() * 900) + 100);
  return `${pick()}-${pick()}-${pick()}-${n}`;
}
export function cleanCode(s) { return (s || '').toLowerCase().trim().replace(/\s+/g, '-'); }

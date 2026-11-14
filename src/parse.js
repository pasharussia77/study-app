// Turns pasted material into flashcards. Each line "term - definition" becomes one card.
const SEPARATORS = ['\t', ' – ', ' — ', ' - ', ': ', ' = '];

export function parseCards(text) {
  const cards = [];
  let skipped = 0;
  const skippedLines = [];
  for (const raw of (text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let best = -1, sepLen = 0;
    for (const sep of SEPARATORS) {
      const i = line.indexOf(sep);
      if (i > 0 && (best === -1 || i < best)) { best = i; sepLen = sep.length; }
    }
    if (best === -1) { skipped++; skippedLines.push(line); continue; }
    const term = line.slice(0, best).trim();
    const definition = line.slice(best + sepLen).trim();
    if (!term || !definition) { skipped++; skippedLines.push(line); continue; }
    cards.push({ id: cards.length, term, definition });
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

// "Reading" projects: material that is not a test yet (textbook pages, class notes, articles, pasted text).
// Steps: photo/text -> typed copy of the page (same layout) -> chunks the student selects -> the AI reports
// information blocks -> fixed rules here build the questions.

// The AI's JSON answer, with code fences and extra words around it removed. (items.js has one too, but it insists on an "items" list.)
export function parseJson(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('The AI did not return an answer I could read. Try again.');
  try { return JSON.parse(cleaned.slice(start, end + 1)); }
  catch { throw new Error('The AI answer was cut off or garbled. Try again.'); }
}

export const COUNT_CHOICES = [5, 10, 15, 20];
export const DEFAULT_COUNT = 10;
export const MAX_COUNT = 40;
export const BLOCK_TYPES = ['definition', 'fact', 'date', 'name', 'event', 'cause', 'list'];
export const BLOCK_LABEL = { definition: 'Definition', fact: 'Fact', date: 'Date', name: 'Name', event: 'Event', cause: 'Cause and effect', list: 'List' };
const MARKS = ['underline', 'box', 'circle', 'star', 'strike'];

const str = (x) => (x == null ? '' : String(x).trim());
const num = (x, d = 0) => (isFinite(+x) && x !== null && x !== '' ? +x : d);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- typed copy of a page

export function buildTranscribePrompt() {
  return `You are making a typed copy of one page (a photo of a textbook page, an article, or handwritten class notes).
The copy must keep the LAYOUT exactly as on the page, because where things sit shows the logic of the page.

Return ONLY JSON: {"kind":"printed"|"handwritten"|"mixed","lines":[...],"figures":[...]}

"lines": one entry for every line or phrase, in the place where it is written.
- text: the exact words. Do not fix spelling or grammar, do not merge, reorder, shorten or explain. Keep bullets, dashes and numbers at the start of the text. Write an arrow you see as its own entry with text "→" or "↓" (or "←", "↑") at its position. If a word cannot be read, write [?].
- x, y: the top-left corner of the text, as a fraction of the picture width and height (0 to 1).
- Each line is lower on the page than the line before it (y grows down the page). Two lines may have the same y only when they sit side by side and do not overlap. Lines never sit on top of each other.
- w: its width as a fraction of the picture width. h: the height of one text line as a fraction of the picture height.
- If a line has a big gap in the middle, or two phrases sit far apart on the same row, make two entries.
- If there is empty space between two lines, the y values must show it. If a phrase is short and sits in the middle of the page, its x must show that. Short lines stay short.
- marks: any of "underline", "box", "circle", "star", "strike" when that phrase is underlined, boxed, circled, starred or crossed out. Leave marks out when there are none. "strike" means a line drawn THROUGH the middle of the words, as when a writer scratches out a mistake: it is not an underline (a line under the words). Type crossed-out words exactly as written, and mark them "strike".
- conf: "low" or "medium" when you are not sure you read it right. Leave conf out when you are sure.
Keep the answer short: round x, y, w and h to 3 decimals and add nothing else.
"figures": drawings, diagrams, tables or pictures you cannot type: {"x":..,"y":..,"w":..,"h":..,"label":"short description"}.
Skip page numbers, running headers and footers, and ads.
Do not add anything that is not on the page.`;
}

// Crossed-out pieces start unselected: the writer scratched them out, so they are not study material (the student can select them back).
export const struckIds = (t) => ((t && t.lines) || []).filter((l) => l.marks.includes('strike')).map((l) => l.id);

// Cleans the AI's answer: numbers clamped to the page, ids added, empty pieces dropped.
export function parseTranscript(raw) {
  const data = typeof raw === 'string' ? parseJson(raw) : raw;
  const list = Array.isArray(data && data.lines) ? data.lines : [];
  const lines = list.map((l, i) => {
    const h = clamp(num(l.h, 0.025), 0.008, 0.2);
    const x = clamp(num(l.x, 0.05), 0, 0.98);
    const y = clamp(num(l.y, i * 0.03), 0, 0.99);
    return {
      id: 'l' + (i + 1), text: str(l.text), x, y,
      w: clamp(num(l.w, 0.3), 0.01, 1 - x), h,
      marks: (Array.isArray(l.marks) ? l.marks : []).filter((m) => MARKS.includes(m)),
      conf: ['high', 'medium', 'low'].includes(l.conf) ? l.conf : 'high'
    };
  }).filter((l) => l.text);
  lines.sort((a, b) => a.y - b.y || a.x - b.x);
  const figures = (Array.isArray(data && data.figures) ? data.figures : []).map((f) => ({
    x: clamp(num(f.x), 0, 0.99), y: clamp(num(f.y), 0, 0.99), w: clamp(num(f.w, 0.2), 0.02, 1), h: clamp(num(f.h, 0.2), 0.02, 1), label: str(f.label)
  }));
  const kind = ['printed', 'handwritten', 'mixed'].includes(data && data.kind) ? data.kind : 'printed';
  return { kind, layout: true, lines, figures };
}

export async function transcribePhoto(code, dataUrl, log = () => {}) {
  const { askAIDetailed } = await import('./ai.js'); // loaded when needed, so the rules above can be tested without the app
  const prompt = buildTranscribePrompt();
  const t0 = Date.now();
  let res;
  try {
    res = await askAIDetailed(code, { messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }] }], json: true, maxTokens: 4000 });
  } catch (e) { log({ type: 'transcribe', ok: false, error: e.message, ms: Date.now() - t0 }); throw e; }
  let t;
  try { t = parseTranscript(res.text); } catch (e) { log({ type: 'transcribe', ok: false, error: e.message, raw: res.text }); throw new Error(e.message + ' If the page is very full, photograph it in two parts.'); }
  if (!t.lines.length) { log({ type: 'transcribe', ok: false, error: 'no text', raw: res.text }); throw new Error('No text was found on this page.'); }
  // the AI's places are estimates: move each line onto its real row of print in the photo, then make sure no two lines overlap
  try { const { placeOnPhoto } = await import('./align.js'); t = await placeOnPhoto(dataUrl, t); } catch { /* keep the AI's places */ }
  log({ type: 'transcribe', ok: true, ms: res.ms, usage: res.usage, lines: t.lines.length, raw: res.text, finish: res.finish, placed: t.placed });
  return t;
}

// Pasted or typed text: no positions, just paragraphs. Split into pages of a sensible size.
export function splitTextPages(text, maxChars = 2200) {
  const paras = String(text || '').replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const flat = [];
  for (const p of paras) {
    if (p.length <= maxChars) { flat.push(p); continue; }
    let rest = p;
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf('. ', maxChars); if (cut < maxChars * 0.4) cut = rest.lastIndexOf('\n', maxChars); if (cut < maxChars * 0.4) cut = rest.lastIndexOf(' ', maxChars); if (cut < 1) cut = maxChars;
      flat.push(rest.slice(0, cut + 1).trim()); rest = rest.slice(cut + 1).trim();
    }
    if (rest) flat.push(rest);
  }
  const pages = []; let cur = [], size = 0;
  for (const p of flat) {
    if (cur.length && size + p.length > maxChars) { pages.push(cur); cur = []; size = 0; }
    cur.push(p); size += p.length;
  }
  if (cur.length) pages.push(cur);
  return pages;
}
export function textTranscript(paragraphs) {
  return { kind: 'text', layout: false, figures: [], lines: paragraphs.map((t, i) => ({ id: 'l' + (i + 1), text: t, marks: [], conf: 'high' })) };
}

// ---------------------------------------------------------------- rows, chunks, layout text

const medianH = (lines) => { const hs = lines.map((l) => l.h).sort((a, b) => a - b); return hs[Math.floor(hs.length / 2)] || 0.02; };

// Pieces that sit on the same row, left to right.
export function toRows(lines) {
  const sorted = [...lines].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const l of sorted) {
    const r = rows[rows.length - 1];
    if (r && Math.abs(l.y - r.y) < Math.max(r.h, l.h) * 0.6) { r.lines.push(l); r.h = Math.max(r.h, l.h); }
    else rows.push({ y: l.y, h: l.h, lines: [l] });
  }
  rows.forEach((r) => r.lines.sort((a, b) => a.x - b.x));
  return rows;
}

// Groups of lines that belong together: a big empty gap starts a new chunk. Pasted text: one chunk per paragraph.
// ---- where each block comes from on the page (for the block map)
// A line of the page belongs to a block when a stretch of it (a sentence part) is found in the block's source sentence.
// Short stretches (a word or two) count only next to a line that already matched with a longer stretch, so common words do not light up the page.
const mapNorm = (x) => String(x || '').replace(/~~/g, '').replace(/[•·▪●]/g, ' ').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').toLowerCase().replace(/\s+/g, ' ').replace(/\s+([.,;:!?)])/g, '$1').trim();
function lineParts(text) {
  const raw = String(text || '').replace(/~~/g, '');
  const parts = []; let start = 0;
  const re = /[.!?;:](\s+|$)|\s+[↓↑→←⇒]\s+/g; let m;
  while ((m = re.exec(raw))) { parts.push([start, m.index + (/[.!?;:]/.test(m[0][0]) ? 1 : 0)]); start = m.index + m[0].length; }
  if (start < raw.length) parts.push([start, raw.length]);
  return parts.map(([a, b]) => ({ a, b, text: mapNorm(raw.slice(a, b).replace(/-$/, '')) })).filter((p) => /[a-z0-9]/.test(p.text));
}
export function blockAreas(t, blocks) {
  const lines = ((t && t.lines) || []).filter((l) => l.x != null && l.y != null);
  const order = [...lines].sort((p, q) => (p.y - q.y) || (p.x - q.x));
  const out = new Map();
  for (const b of blocks || []) {
    const src = mapNorm(b.source).replace(/- /g, '');
    const srcJoined = src.replace(/-\s*/g, '');
    if (!src) { out.set(b.id, { rects: [], lines: [] }); continue; }
    const hits = new Map(); // line id -> { a, b, strong }
    order.forEach((l) => {
      for (const p of lineParts(l.text)) {
        if (p.text.length < 2) continue;
        if (!(src.includes(p.text) || srcJoined.includes(p.text.replace(/-\s*/g, '')))) continue;
        const strong = p.text.split(' ').length >= 3 || p.text === src || p.text === srcJoined;
        const h = hits.get(l.id);
        const pos = srcJoined.indexOf(p.text.replace(/-\s*/g, ''));
        if (h) { h.a = Math.min(h.a, p.a); h.b = Math.max(h.b, p.b); h.strong = h.strong || strong; h.pos = Math.min(h.pos, pos); } else hits.set(l.id, { a: p.a, b: p.b, strong, pos });
      }
    });
    // keep short hits only when a neighbouring line with letters is a strong hit for this block
    const withText = order.filter((l) => /[a-z0-9]/i.test(l.text));
    const keep = new Set();
    withText.forEach((l, i) => {
      const h = hits.get(l.id); if (!h) return;
      if (h.strong) { keep.add(l.id); return; }
      const near = [withText[i - 1], withText[i + 1]].some((n) => n && hits.get(n.id) && hits.get(n.id).strong);
      if (near) keep.add(l.id);
    });
    // the lines must follow the sentence in order: a heading just above that repeats words from the middle of the sentence is not part of it
    const kept = withText.filter((l) => keep.has(l.id));
    if (kept.length > 1) {
      const len = (id) => hits.get(id).b - hits.get(id).a;
      const best = kept.map(() => 0), prev = kept.map(() => -1);
      kept.forEach((l, i) => { best[i] = len(l.id); for (let j = 0; j < i; j++) if (hits.get(kept[j].id).pos <= hits.get(l.id).pos && best[j] + len(l.id) > best[i]) { best[i] = best[j] + len(l.id); prev[i] = j; } });
      let i = best.indexOf(Math.max(...best)); const chain = new Set();
      while (i >= 0) { chain.add(kept[i].id); i = prev[i]; }
      kept.forEach((l) => { if (!chain.has(l.id)) keep.delete(l.id); });
    }
    // one block comes from one place: keep the biggest run of neighbouring lines (a heading elsewhere that repeats the words is not it)
    const runs = []; let run = null;
    withText.forEach((l) => { if (keep.has(l.id)) { if (!run) { run = []; runs.push(run); } run.push(l.id); } else run = null; });
    if (runs.length > 1) {
      const size = (r) => r.reduce((n, id) => n + (hits.get(id).b - hits.get(id).a), 0);
      const best = runs.reduce((x, y) => (size(y) > size(x) ? y : x));
      runs.forEach((r) => { if (r !== best) r.forEach((id) => keep.delete(id)); });
    }
    // lines with only arrows between two kept lines belong to the block too (diagrams)
    order.forEach((l, i) => { if (!/[a-z0-9]/i.test(l.text) && /[↓↑→←⇒]/.test(l.text) && keep.has((order[i - 1] || {}).id) && keep.has((order[i + 1] || {}).id)) { keep.add(l.id); hits.set(l.id, { a: 0, b: l.text.length }); } });
    const rects = order.filter((l) => keep.has(l.id)).map((l) => {
      const h = hits.get(l.id); const len = Math.max(String(l.text).length, 1);
      // never reach into the line below: the box stops just above the next line that sits under this one
      const lw = l.w || 0.5;
      const below = lines.filter((o) => o !== l && o.y > l.y && o.x < l.x + lw && o.x + (o.w || 0.5) > l.x).map((o) => o.y - l.y);
      const room = below.length ? Math.min(...below) : Infinity;
      const w = l.w || Math.min(0.9, len * (l.h || 0.025) * 0.5);
      return { x: l.x + w * (h.a / len), y: l.y, w: Math.max(w * ((h.b - h.a) / len), 0.01), h: Math.min(l.h || 0.025, room * 0.92), line: l.id, a: h.a / len, b: h.b / len };
    });
    out.set(b.id, { rects, lines: rects.map((r) => r.line) });
  }
  return out;
}

export function makeChunks(t) {
  const lines = (t && t.lines) || [];
  if (!lines.length) return [];
  if (!t.layout) return lines.map((l, i) => ({ id: 'c' + (i + 1), lines: [l], box: null }));
  const med = medianH(lines);
  const sorted = [...lines].sort((a, b) => a.y - b.y || a.x - b.x);
  const chunks = []; let cur = null, bottom = 0;
  for (const l of sorted) {
    if (!cur || l.y - bottom > med * 1.4) { cur = { id: 'c' + (chunks.length + 1), lines: [] }; chunks.push(cur); bottom = l.y + l.h; }
    cur.lines.push(l); bottom = Math.max(bottom, l.y + l.h);
  }
  chunks.forEach((c) => {
    const x0 = Math.min(...c.lines.map((l) => l.x)), y0 = Math.min(...c.lines.map((l) => l.y));
    const x1 = Math.max(...c.lines.map((l) => l.x + l.w)), y1 = Math.max(...c.lines.map((l) => l.y + l.h));
    c.box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  });
  return chunks;
}

const COLS = 64;
const wrap = (l, marks) => {
  if (!marks) return l.text;
  if (l.marks.includes('box')) return `[${l.text}]`;
  if (l.marks.includes('circle')) return `(${l.text})`;
  if (l.marks.includes('strike')) return marks === 'all' ? `~~${l.text}~~` : l.text;
  if (l.marks.includes('underline')) return `_${l.text}_`;
  if (l.marks.includes('star')) return `*${l.text}`;
  return l.text;
};
// The page as plain text with its spacing kept: left gaps become spaces, empty gaps between lines become blank lines.
export function layoutText(t, { marks = false, off = [] } = {}) {
  const lines = ((t && t.lines) || []).filter((l) => !off.includes(l.id));
  if (!lines.length) return '';
  if (!t.layout) return lines.map((l) => l.text).join('\n\n');
  const med = medianH(lines);
  const out = []; let prev = null;
  for (const r of toRows(lines)) {
    if (prev != null) { const blanks = Math.min(3, Math.floor((r.y - prev) / (med * 0.9))); for (let i = 0; i < blanks; i++) out.push(''); }
    let s = '';
    for (const l of r.lines) {
      const col = Math.round(l.x * COLS);
      if (s.length < col) s += ' '.repeat(col - s.length); else if (s) s += '  ';
      s += wrap(l, marks);
    }
    out.push(s.replace(/\s+$/, ''));
    prev = r.y + r.h;
  }
  return out.join('\n');
}
export const chunkPreview = (t, chunk) => layoutText({ ...t, lines: chunk.lines }, { marks: false });

// ---------------------------------------------------------------- information blocks

export const DETAIL_LABEL = { main: 'main points', normal: 'normal', all: 'every detail' };
export const DETAILS = ['main', 'normal', 'all'];
const DETAIL_RULE = {
  main: 'Detail level: MAIN POINTS. Report only the most important ideas a test would ask about. Skip small details and examples.',
  normal: '',
  all: 'Detail level: EVERY DETAIL. Each separate piece of information gets its own block, even small ones. Split a sentence that holds several pieces into several blocks.'
};
export function buildFactsPrompt(sourceText, wantBlocks, kind, detail = 'normal') {
  return `Find the information blocks in the study material below, for a student who will be quizzed on it.
Report ONLY what the text says. Never add anything from your own knowledge.

Block types:
- definition: a term and what it means
- date: something with a date, year or time
- name: a person, place or thing that is named, and what it did or is
- event: something that happened, and its outcome
- cause: a cause and its effect (or a reason and its result)
- list: a group of items that belong together (parts, steps, causes, types). Set "ordered": true only if the text shows a sequence (numbers, steps, first/then, chronology).
- An arrow diagram (A ↓ B ↓ C, or A → B → C) usually links one thing to its details, not separate items of a list or steps in order. Make a fact block for each link instead (for example "Legislative ↓ Makes federal laws ↓ Congress" gives: Legislative branch → makes federal laws, and Legislative branch → Congress). Only treat arrows as an order when they clearly show steps or time.
- fact: any other fact worth knowing

For each block return:
- type
- source: the exact words from the text that this block comes from (copy them, one or two sentences or lines)
- subject: what the block is about, in a few words
- question: a clear question a student could answer from memory. It must make sense alone (never say "according to the text"). For a list, ask for the whole group.
- value: the short exact answer, copied from the source (a date, a name, the meaning, the outcome). Use the SHORTEST words that answer the question: only the key number, date, name or term, never words the question already says (for "How many representatives are in the House?" the value is "435", not "435 representatives"; for "How many people does one representative stand for?" it is "500,000"). Leave "" for a list.
- items: for a list, the items copied from the source (2 to 8). Otherwise [].
- ordered: true or false (lists only)
- important: true if the text marks it as important (boxed, underlined, circled, starred, bold, or stressed like "remember" or "important")

How to read the layout: the text is shown with its spacing as on the page.${kind === 'handwritten' || kind === 'mixed' ? ' This page was handwritten notes, so lines may be short fragments like "1776 - independence". Treat those as blocks. Indented lines under a heading belong to that heading. An arrow (→) means the left part leads to or causes the right part.' : ''} Markers: [text] boxed, (text) circled, _text_ underlined, *text starred.
Skip headings that stand alone, page numbers, captions and anything that is not study content.
${DETAIL_RULE[detail] ? DETAIL_RULE[detail] + '\n' : ''}Find every block that deserves a question, up to ${wantBlocks}. One block per separate piece of information: never report the same fact twice. If one sentence holds two separate facts (for example what happened and when, or two different results), report two blocks, each with its own source and its own question. Every bullet or line that states something to learn should give a block, unless another block already covers the same fact. Do not pad. A block's value must say something more than its subject (never "Congress" → "Congress").

Return ONLY JSON: {"blocks":[...]}

TEXT:
${sourceText}`;
}

// A block is only worth a question if its answer says more than its subject and is not given away by the question.
export function saysMore(subject, value, question = '') {
  const v = norm(value), s = norm(subject);
  if (!v) return false;
  if (s && (v === s || s.includes(v))) return false;
  if (norm(question).includes(v)) return false;
  if (s && onlyReworded(s, v)) return false;
  return true;
}
// "Division of federal power" -> "divided Federal Power": every answer word is already in the subject (endings ignored).
const FILLER = new Set(['of', 'the', 'a', 'an', 'and', 'in', 'to', 'is', 'are', 'was', 'were', 'by', 'for', 'on']);
const sameWord = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 4) === b.slice(0, 4));
function onlyReworded(subject, value) {
  const sw = subject.split(' ').filter((w) => w && !FILLER.has(w));
  const vw = value.split(' ').filter((w) => w && !FILLER.has(w));
  return vw.length > 0 && vw.every((w) => sw.some((x) => sameWord(w, x)));
}
export function blockLine(b) {
  if (b.type === 'list') return `${b.subject || b.question}: ${b.items.join(', ')}`;
  return `${b.subject || b.question} → ${b.value}`;
}

export function parseBlocks(raw) { return parseBlocksDetailed(raw).blocks; }

// A short answer that is a date: a year, a decade, a month, a day of the month, a century or an era.
export const dateLike = (v) => String(v || '').trim().split(/\s+/).length <= 4 && /\b(1\d{3}|20\d{2})s?\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\b|\b\d{1,2}(st|nd|rd|th)\b|\bcentury\b|\b\d+\s*(bc|ad|bce|ce)\b/i.test(String(v || ''));
export function parseBlocksDetailed(raw) {
  const data = typeof raw === 'string' ? parseJson(raw) : raw;
  const list = Array.isArray(data && data.blocks) ? data.blocks : [];
  const seen = new Set();
  const out = [];
  const dropped = [];
  const drop = (why, b) => dropped.push({ why, line: String((b && (b.subject || b.question)) || '?').slice(0, 60) + ' → ' + String((b && (b.value || (Array.isArray(b.items) ? b.items.join(', ') : ''))) || '').slice(0, 60) });
  for (const b of list) {
    let type = BLOCK_TYPES.includes(b.type) ? b.type : 'fact';
    const source = str(b.source), question = str(b.question);
    let value = str(b.value);
    let items = (Array.isArray(b.items) ? b.items : []).map(str).filter(Boolean).slice(0, 8);
    if (type === 'list' && items.length === 1) { type = 'fact'; value = value || items[0]; items = []; } // one item is not a list
    if (type !== 'list' && !value && items.length >= 2) type = 'list'; // labelled as a fact but sent as a list
    if (type === 'date') value = value.replace(/^(in|on|by|around|about|during|since|from|at|until|before|after)\s+/i, ''); // "In 1787" -> "1787"
    if (type === 'date' && !dateLike(value)) type = 'fact'; // a "date" whose answer is not a short date
    if (!source || !question) { drop('no source or question', b); continue; }
    if (type === 'list' ? items.length < 2 : !value) { drop(type === 'list' ? 'list with under 2 items' : 'no answer', b); continue; }
    let plain = false;
    if (type !== 'list' && !saysMore(b.subject, value, question)) {
      // The answer repeats the subject: keep it only if the question itself is a real question that does not give the answer away. Then it stays a plain question and answer.
      if (question.split(/\s+/).length >= 4 && !norm(question).includes(norm(value)) && norm(value) !== norm(b.subject)) plain = true;
      else { drop('answer repeats the subject or the question', b); continue; }
    }
    const keys = [norm(question), type === 'list' ? '' : 'v:' + norm(value) + '|' + norm(b.subject || question)].filter(Boolean);
    if (keys.some((k) => seen.has(k))) { drop('same fact found twice', b); continue; }
    keys.forEach((k) => seen.add(k));
    out.push({
      id: 'b' + (out.length + 1), on: true, type, source, subject: str(b.subject), question, value: type === 'list' ? '' : value, items: type === 'list' ? items : [],
      ordered: type === 'list' && b.ordered === true, important: b.important === true, plain,
      grounded: type === 'list' ? items.every((it) => norm(source).includes(norm(it))) : norm(source).includes(norm(value))
    });
  }
  return { blocks: out, asked: list.length, dropped: dropped.slice(0, 20) };
}

export async function findBlocks(code, t, off, log = () => {}, detail = 'normal') {
  const sourceText = layoutText(t, { marks: true, off });
  if (!sourceText.trim()) throw new Error('Nothing on this page is selected as source material.');
  const want = 30;
  const { askAIDetailed } = await import('./ai.js');
  const prompt = buildFactsPrompt(sourceText, want, t.kind, detail);
  const t0 = Date.now();
  let res;
  try { res = await askAIDetailed(code, { messages: [{ role: 'user', content: prompt }], json: true, maxTokens: 4000 }); }
  catch (e) { log({ type: 'blocks', ok: false, error: e.message, ms: Date.now() - t0, detail, want, sent: sourceText }); throw e; }
  let blocks, info;
  try { const r = parseBlocksDetailed(res.text); blocks = r.blocks; info = { asked: r.asked, dropped: r.dropped }; } catch (e) { log({ type: 'blocks', ok: false, error: e.message, raw: res.text }); throw new Error(e.message); }
  log({ type: 'blocks', ok: true, ms: res.ms, usage: res.usage, made: blocks.length, asked: info.asked, detail, want, sent: sourceText, raw: res.text, finish: res.finish });
  blocks.info = info; // read by the caller and saved with the page for the report
  return blocks;
}

// ---------------------------------------------------------------- AI check of the made questions (reading projects)

const CHECK_KIND = { unclear: 'Not clear', mismatch: 'Answer does not fit', wrong: 'May be factually wrong', trivial: 'Too trivial to study', vague: 'Too vague', duplicate: 'Same as another question' };
export const checkLabel = (k) => CHECK_KIND[k] || 'Look at this one';

function choiceLine(q) {
  if (!q.choices || !q.choices.length || q.type === 'order') return q.type === 'order' ? ` Items: ${(q.choices || []).map((c) => c.text).join(' | ')}` : '';
  return ` Choices: ${q.choices.map((c) => c.label + '. ' + c.text).join(' | ')}`;
}
export function buildCheckPrompt(list) {
  const lines = list.map((q, i) => `${i + 1}. [${q.type}] ${q.question}${choiceLine(q)}\n   Answer: ${q.answer || '(none)'}${q.correction ? ' (correction: ' + q.correction + ')' : ''}\n   Source sentence: ${q.srcText || '(none)'}`).join('\n');
  return `CHECK THESE QUESTIONS. They were made automatically from a student's study material. Look at each one and report only the ones with a problem.
Problem kinds:
- unclear: the question does not make sense on its own, is cut off, or has no clear answer
- mismatch: the answer does not answer the question, or is not supported by the source sentence
- wrong: the fact itself looks wrong compared with what you know (be sure; if you are not sure, do not report it)
- trivial: so simple or common that a student at this level would not need to study it
- vague: the question or its answer is too general to be a useful fact on its own (for example the answer \"different responsibilities\" or \"a new plan\" says almost nothing)
- Several questions on the same fact in different forms (question, fill in the blank, true/false, choices) are made ON PURPOSE. Never report a question for that.
Some source sentences were read from a photo of handwriting by a program, so a word can be misread. If a word looks like a misread of a likelier word (for example \"Moves federal laws\" where \"Makes federal laws\" is meant), report it as unclear and name the likely word in why.
Do not report a question just because the wording could be nicer. A question with no problem is NOT reported.
For each problem return: n (the question number), kind (unclear, mismatch, wrong or trivial), why (at most 12 words, plain).

Return ONLY JSON: {"checks":[{"n":1,"kind":"unclear","why":"..."}]}  (use {"checks":[]} if all are fine)

QUESTIONS:
${lines}`;
}
export function parseChecks(raw, count) {
  const data = typeof raw === 'string' ? parseJson(raw) : raw;
  if (!data || !Array.isArray(data.checks)) throw new Error('The AI check answer could not be read.');
  const out = new Map();
  for (const c of data.checks) {
    const n = Number(c && c.n);
    if (!Number.isInteger(n) || n < 1 || n > count) continue;
    if (c && c.kind === 'duplicate') continue; // the same fact in other forms is on purpose
    const kind = CHECK_KIND[c.kind] ? c.kind : 'unclear';
    const why = str(c.why).slice(0, 140);
    out.set(n - 1, { kind, why });
  }
  return out;
}
// One AI call for a list of question items. Returns Map(index -> {kind, why}) for the ones with a problem. Throws if the call or answer fails.
export async function checkQuestions(code, list, log = () => {}) {
  if (!list.length) return new Map();
  const { askAIDetailed } = await import('./ai.js');
  const t0 = Date.now();
  let res;
  try { res = await askAIDetailed(code, { messages: [{ role: 'user', content: buildCheckPrompt(list) }], json: true, maxTokens: 4000 }); }
  catch (e) { log({ type: 'check', ok: false, error: e.message, ms: Date.now() - t0 }); throw e; }
  let flags;
  try { flags = parseChecks(res.text, list.length); } catch (e) { log({ type: 'check', ok: false, error: e.message, raw: res.text }); throw e; }
  log({ type: 'check', ok: true, ms: res.ms, usage: res.usage, asked: list.length, flagged: flags.size, raw: res.text, finish: res.finish });
  return flags;
}

// Checks the made questions that have no AI check yet and saves the result on them. Returns how many were flagged. Throws if the check fails.
export async function recheckItems(code, projectId, items, backend, log = () => {}) {
  const list = items.filter((x) => x.srcText && x.aiChecked !== true);
  const flags = await checkQuestions(code, list, log);
  for (let i = 0; i < list.length; i++) {
    const f = flags.get(i);
    await backend.updateItem(code, projectId, list[i].id, { aiChecked: true, aiNote: f ? f.why : '', aiKind: f ? f.kind : '' });
  }
  return flags.size;
}

// ---------------------------------------------------------------- questions from blocks (fixed rules, no AI)

function rng(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (let i = 0; i < String(seed).length; i++) { h = Math.imul(h ^ String(seed).charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffled(list, rand) { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const LETTER = (i) => String.fromCharCode(65 + i);
const GROUPS = { date: ['date'], name: ['name'], definition: ['definition'], event: ['event', 'cause', 'fact'], cause: ['event', 'cause', 'fact'], fact: ['event', 'cause', 'fact'] };

// Wrong answers come from other blocks of the same kind in the whole project.
// Wrong answers must look like the right one: a date for a date, and about the same length, so the answer is not given away and a swapped sentence still reads well.
const words = (v) => String(v || '').trim().split(/\s+/).filter(Boolean).length;
export const alike = (a, b) => dateLike(a) === dateLike(b) && Math.max(words(a), words(b)) <= 2 * Math.min(words(a), words(b)) + 1;
function distractors(block, all, n, rand, avoid = '') {
  const kinds = GROUPS[block.type] || [];
  const mine = norm(block.value);
  const seen = new Set([mine]);
  const pool = [];
  for (const b of all) {
    if (b === block || !kinds.includes(b.type) || !b.value || !alike(block.value, b.value)) continue;
    if (avoid && norm(avoid).includes(norm(b.value))) continue; // already written in the question: it would give itself away
    const k = norm(b.value);
    if (!k || seen.has(k) || mine.includes(k) || k.includes(mine)) continue;
    seen.add(k); pool.push(b.value);
  }
  return shuffled(pool, rand).slice(0, n);
}
function listDistractors(block, all, n, rand) {
  const mine = new Set(block.items.map(norm));
  const pool = []; const seen = new Set();
  for (const b of all) {
    if (b === block || b.type !== 'list') continue;
    for (const it of b.items) { const k = norm(it); if (mine.has(k) || seen.has(k)) continue; seen.add(k); pool.push(it); }
  }
  return shuffled(pool, rand).slice(0, n);
}

function baseItem(block, extra, label, seq) {
  const flagged = !block.grounded;
  return {
    type: 'qa', section: label, number: null, question: '', choices: [], correctLabel: null, answer: '', source: 'reading', studentAnswer: null,
    markedWrong: null, confidence: 'high', note: flagged ? 'The answer was not found word for word in the page text. Check it.' : '', order: seq,
    circled: null, printed: null, correction: '', aiReview: false, flagged, blockType: block.type, blockId: block.id || '', srcText: block.source, ...extra
  };
}


// The sentence of the page that holds the block's answer: used for fill-in-the-blank and true/false in real sentences.
function sentenceOf(b) {
  const v = String(b.value || '').trim();
  if (!v || !b.source) return null;
  const text = String(b.source).replace(/[•·▪●]/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = text.split(/(?<=[.!?])\s+/);
  const low = v.toLowerCase();
  const sent = parts.find((x) => x.toLowerCase().includes(low));
  if (!sent || sent.split(/\s+/).length < 4) return null;
  if (/[↓↑→←⇒⇐⟶➔]/.test(sent)) return null; // a diagram, not a sentence
  if (words(v) * 2 > words(sent)) return null; // the answer is most of the sentence: a blank would leave almost nothing
  return sent.charAt(0).toUpperCase() + sent.slice(1); // handwriting may start lowercase
}
function swapIn(sentence, value, replacement) {
  const i = sentence.toLowerCase().indexOf(String(value).toLowerCase());
  if (i < 0) return null;
  const all = sentence.toLowerCase().split(String(value).toLowerCase()).length - 1;
  if (all !== 1) return null; // the answer shows up twice: a blank would be ambiguous
  return sentence.slice(0, i) + replacement + sentence.slice(i + String(value).length);
}
function clozeOf(b, label, seq) {
  const sent = sentenceOf(b); if (!sent) return null;
  const q = swapIn(sent, b.value, '_____'); if (!q) return null;
  return baseItem(b, { type: 'qa', question: 'Fill in the blank: ' + q, answer: b.value }, label, seq);
}
function clozeMcOf(b, all, label, seq, rand) {
  const sent = sentenceOf(b); if (!sent) return null;
  const q = swapIn(sent, b.value, '_____'); if (!q) return null;
  const d = distractors(b, all, 3, rand, sent);
  if (d.length < 2) return null;
  const texts = shuffled([b.value, ...d], rand);
  const choices = texts.map((text, i) => ({ label: LETTER(i), text }));
  return baseItem(b, { type: 'mc', question: 'Fill in the blank: ' + q, choices, correctLabel: choices.find((c) => c.text === b.value).label, answer: b.value }, label, seq);
}

function qaOf(b, label, seq) { return baseItem(b, { type: 'qa', question: b.question, answer: b.value }, label, seq); }
function termOf(b, label, seq) {
  if (b.plain || b.type !== 'definition' || !b.subject || b.subject.split(/\s+/).length > 6) return null;
  return baseItem(b, { type: 'term', question: b.subject, answer: b.value }, label, seq);
}
function mcOf(b, all, label, seq, rand) {
  const d = distractors(b, all, 3, rand, b.question);
  if (d.length < 2) return null;
  const texts = shuffled([b.value, ...d], rand);
  const choices = texts.map((text, i) => ({ label: LETTER(i), text }));
  const correct = choices.find((c) => c.text === b.value);
  return baseItem(b, { type: 'mc', question: b.question, choices, correctLabel: correct.label, answer: b.value }, label, seq);
}
function tfOf(b, all, label, seq, rand, which) {
  const sent = sentenceOf(b); if (!sent) return null; // a true/false needs a real sentence, not a label
  const makeFalse = which === 'false';
  let statement = sent, answer = 'True';
  if (makeFalse) {
    const d = distractors(b, all, 1, rand, sent)[0];
    if (!d) return null;
    statement = swapIn(sent, b.value, d); answer = 'False';
    if (!statement) return null;
  }
  const choices = [{ label: 'A', text: 'True' }, { label: 'B', text: 'False' }];
  return baseItem(b, { type: 'tf', question: statement, choices, correctLabel: makeFalse ? 'B' : 'A', answer, correction: makeFalse ? sent : '' }, label, seq);
}
function listOf(b, all, label, seq, rand, form = '') {
  const items = b.items.slice(0, 6);
  if (form !== 'multi' && b.ordered && items.length >= 3) {
    let order = shuffled(items, rand);
    if (order.every((t, i) => t === items[i])) order = [...order.slice(1), order[0]];
    const choices = order.map((text, i) => ({ label: LETTER(i), text }));
    const correctOrder = items.map((t) => choices.find((c) => c.text === t).label);
    return baseItem(b, { type: 'order', question: b.question, choices, correctOrder, answer: items.map((t, i) => `${i + 1}. ${t}`).join('; ') }, label, seq);
  }
  const d = listDistractors(b, all, Math.min(3, Math.max(2, items.length - 1)), rand);
  if (d.length < 2) return baseItem(b, { type: 'qa', question: b.question, answer: items.join('; ') }, label, seq);
  const texts = shuffled([...items, ...d], rand);
  const choices = texts.map((text, i) => ({ label: LETTER(i), text }));
  const correctLabels = choices.filter((c) => items.includes(c.text)).map((c) => c.label);
  return baseItem(b, { type: 'multi', question: b.question, choices, correctLabels, answer: items.join('; ') }, label, seq);
}
function listPickOf(b, all, label, seq, rand) {
  const d = listDistractors(b, all, 3, rand);
  if (d.length < 2) return null;
  const right = b.items[Math.floor(rand() * b.items.length)];
  const texts = shuffled([right, ...d], rand);
  const choices = texts.map((text, i) => ({ label: LETTER(i), text }));
  return baseItem(b, { type: 'mc', question: `Which one belongs to this group? ${b.subject || b.question}`, choices, correctLabel: choices.find((c) => c.text === right).label, answer: right }, label, seq);
}
function listTfOf(b, all, label, seq, rand) {
  const wrong = listDistractors(b, all, 1, rand)[0];
  if (!wrong) return null;
  const subj = b.subject || 'this group';
  const choices = [{ label: 'A', text: 'True' }, { label: 'B', text: 'False' }];
  return baseItem(b, { type: 'tf', question: `${wrong} belongs to: ${subj}`, choices, correctLabel: 'B', answer: 'False', correction: `${subj}: ${b.items.join('; ')}` }, label, seq);
}

// One question per selected block, so no fact is asked twice. The type is chosen to suit the block.
// With perFact 2 or 3, extra questions on the same fact are added in other forms with different wording (fill in the blank, true/false in a real sentence).
export function buildQuestions(pageBlocks, allBlocks, perFact, label, pageKey = 'p') {
  const pool = allBlocks.filter((b) => b.on !== false);
  const blocks = pageBlocks.filter((b) => b.on !== false);
  const per = clamp(Math.round(+perFact) || 1, 1, 3);
  const used = new Set();
  const ok = (it) => {
    if (!it) return false;
    if (it.type !== 'tf' && it.type !== 'multi' && it.type !== 'order' && norm(it.question).includes(norm(it.answer))) return false; // never give the answer away
    const k = norm(it.question) + '|' + norm(it.answer); // the same wording and answer is never asked twice, in any form
    if (used.has(k)) return false; used.add(k); return true;
  };
  const perBlock = blocks.map((b, i) => {
    const r = rng(`${pageKey}:${b.id || i}`);
    const mine = []; const types = new Set();
    for (const f of formsFor(b)) {
      if (mine.length >= per) break;
      const kind = f === 'tf-true' || f === 'tf-false' ? 'tf' : f === 'cloze' ? 'qa' : f === 'clozemc' ? 'mc' : f;
      if (types.has(kind)) continue;
      const it = make(f, b, pool, label, r);
      if (ok(it)) { mine.push(it); types.add(kind); }
    }
    return mine;
  });
  // Round by round: every block's first question, then every block's second, so two questions on one block never sit side by side.
  const out = [];
  for (let round = 0; round < per; round++) {
    for (const mine of perBlock) {
      const it = mine[round]; if (!it) continue;
      if (out.length && out[out.length - 1].blockId === it.blockId) { // only this block has questions left: put it where it does not touch its own
        const at = out.findIndex((x, j) => x.blockId !== it.blockId && (j === 0 || out[j - 1].blockId !== it.blockId));
        if (at >= 0) { out.splice(at, 0, it); continue; }
      }
      out.push(it);
    }
  }
  out.forEach((it, j) => { it.order = j; });
  return out;
}
// "Make again" on one question: builds another version from the same block by the same rules (another form, or other wrong choices).
// Never the same as the question now or as the other questions on that block. Returns null when no other version is possible.
export function remakeQuestion(item, block, allBlocks, siblings = [], n = 1) {
  if (!block) return null;
  const pool = allBlocks.filter((b) => b.on !== false);
  const forms = block.type === 'list' ? formsFor(block) : [...new Set([...formsFor(block), 'qa', 'cloze', 'clozemc', 'mc', 'tf-false', 'tf-true'])];
  const keyOf = (x) => norm(x.question) + '|' + norm(x.answer) + '|' + (x.choices || []).map((c) => norm(c.text)).sort().join(',');
  const same = (x, y) => norm(x.question) === norm(y.question) && norm(x.answer) === norm(y.answer);
  const taken = new Set([item, ...siblings].map(keyOf));
  for (let a = 0; a < forms.length * 3; a++) {
    const f = forms[(n + a) % forms.length];
    const it = make(f, block, pool, item.section || '', rng(`again:${block.id}:${n}:${a}`));
    if (!it) continue;
    if (it.type !== 'tf' && it.type !== 'multi' && it.type !== 'order' && norm(it.question).includes(norm(it.answer))) continue;
    if (taken.has(keyOf(it)) || siblings.some((x) => same(x, it))) continue;
    return { ...it, order: item.order };
  }
  return null;
}
// The forms a block can take, best first.
function formsFor(b) {
  if (b.plain) return ['qa', 'clozemc', 'cloze']; // subject label is weak: no word card or true/false made from it
  if (b.type === 'list') return b.ordered && b.items.length >= 3 ? ['order', 'multi', 'listmc', 'listtf'] : ['multi', 'listmc', 'listtf'];
  if (b.type === 'definition') return ['term', 'mc', 'cloze', 'tf-false'];
  if (b.type === 'date' || b.type === 'name') return ['mc', 'qa', 'cloze', 'tf-false'];
  return ['qa', 'clozemc', 'tf-false', 'cloze'];
}
function make(form, b, all, label, r) {
  switch (form) {
    case 'qa': return qaOf(b, label, 0);
    case 'term': return termOf(b, label, 0);
    case 'mc': return mcOf(b, all, label, 0, r);
    case 'cloze': return clozeOf(b, label, 0);
    case 'clozemc': return clozeMcOf(b, all, label, 0, r);
    case 'tf-false': return tfOf(b, all, label, 0, r, 'false');
    case 'tf-true': return tfOf(b, all, label, 0, r, 'true');
    case 'order': { const it = listOf(b, all, label, 0, r, 'order'); return it && it.type === 'order' ? it : null; }
    case 'multi': return listOf(b, all, label, 0, r, 'multi');
    case 'listmc': return listPickOf(b, all, label, 0, r);
    case 'listtf': return listTfOf(b, all, label, 0, r);
    default: return null;
  }
}
// How many questions the selected blocks would make (shown before making them).
export function countQuestions(pages, perFact) {
  const all = pages.flatMap((p) => p.blocks || []);
  return pages.reduce((n, p) => n + buildQuestions(p.blocks || [], all, perFact, 'x', p.id).length, 0);
}

// Text for the diagnostic report: each page's text, the blocks found and the questions made.
const indent = (x) => String(x).split('\n').map((l) => '    ' + l).join('\n');
const aiLine = (e) => `${new Date(e.t || 0).toLocaleTimeString('en-US', { timeZone: 'America/New_York' })}: ${e.ok ? 'ok' : 'FAILED: ' + e.error}${e.ms ? `, ${(e.ms / 1000).toFixed(1)} s` : ''}${e.usage ? `, tokens in/out ${e.usage.prompt_tokens ?? '?'}/${e.usage.completion_tokens ?? '?'}` : ''}${e.finish ? ', finish ' + e.finish : ''}${e.lines != null ? `, ${e.lines} pieces` : ''}${e.asked != null ? `, ${e.asked} ${e.type === 'check' ? 'questions checked' : 'blocks sent'}` : ''}${e.flagged != null ? `, ${e.flagged} flagged` : ''}`;
export function readingReport(files, items, perFact, detail = 'normal', events = []) {
  const out = ['=== READING PROJECT ===', `Questions per block: ${perFact} · detail: ${DETAIL_LABEL[detail] || detail}`];
  files.forEach((f, i) => {
    const mine = items.filter((x) => x.fileId === f.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const types = {}; mine.forEach((x) => { types[x.type] = (types[x.type] || 0) + 1; });
    out.push('', `--- Page ${i + 1} (${f.source || 'photo'}${f.from ? ', ' + f.from : ''}) status=${f.status || ''} approved=${!!f.checked}${f.error ? ' error=' + f.error : ''}`);
    if (f.transcript) {
      const t = f.transcript;
      out.push(`page text: kind=${t.kind} pieces=${t.lines.length} unselected=${(f.off || []).length} low-confidence=${t.lines.filter((l) => l.conf !== 'high').length} figures=${(t.figures || []).length}`);
      if (t.placed) out.push(`lined up with the photo: ${t.placed.aligned ? `yes, ${t.placed.moved} of ${t.lines.length} lines moved, average shift ${t.placed.avgShift}` : 'no (kept the AI\'s places)'}; overlaps pushed down: ${t.placed.pushed}; ${t.placed.ms} ms`);
      out.push(layoutText(t, { marks: 'all' }));
      if ((f.off || []).length) out.push('unselected: ' + t.lines.filter((l) => (f.off || []).includes(l.id)).map((l) => l.text).join(' | '));
      out.push('pieces (id | x,y,w,h | marks | confidence | used | text):');
      t.lines.forEach((l) => out.push(`  ${l.id} | ${[l.x, l.y, l.w, l.h].map((v) => (v == null ? '-' : Math.round(v * 1000) / 1000)).join(',')} | ${(l.marks || []).join(',') || '-'} | ${l.conf || '-'} | ${(f.off || []).includes(l.id) ? 'NO' : 'yes'} | ${l.text}`));
      (t.figures || []).forEach((g, k) => out.push(`  figure ${k + 1} | ${[g.x, g.y, g.w, g.h].map((v) => (v == null ? '-' : Math.round(v * 1000) / 1000)).join(',')} | ${g.label || g.text || ''}`));
    }
    const mineEv = events.filter((e) => e.fileId === f.id && ['transcribe', 'blocks', 'check'].includes(e.type));
    ['transcribe', 'blocks', 'check'].forEach((kind) => {
      const all = mineEv.filter((e) => e.type === kind);
      if (!all.length) return;
      all.forEach((e, k) => { if (k < all.length - 1) out.push(`AI ${kind} (earlier) ${aiLine(e)}`); });
      const e = all[all.length - 1];
      out.push(`AI ${kind} (latest) ${aiLine(e)}${e.detail ? ` | detail ${e.detail}${e.want != null ? ', asked for about ' + e.want : ''}` : ''}`);
      if (e.sent) out.push('  text sent to the AI:', indent(e.sent));
      if (e.raw) out.push('  the AI\'s answer:', indent(e.raw.length > 12000 ? e.raw.slice(0, 12000) + `\n[... cut, ${e.raw.length - 12000} more characters]` : e.raw));
    });
    if (!mineEv.length) out.push('AI calls: none recorded on this phone for this page (the log is kept per phone; "Start fresh log" clears it)');
    const bl = f.blocks || [];
    out.push(`blocks: ${bl.length} found, ${bl.filter((b) => b.on !== false).length} selected`);
    if (f.blocksInfo) {
      const d = f.blocksInfo.dropped || [];
      out.push(`  the AI sent ${f.blocksInfo.asked} blocks, the app dropped ${d.length}${d.length ? ':' : ''}`);
      d.forEach((x) => out.push(`    dropped (${x.why}): ${x.line}`));
    }
    const areas = f.transcript ? blockAreas(f.transcript, bl) : new Map();
    bl.forEach((b) => out.push(`  [${b.on === false ? ' ' : 'x'}] ${b.id} ${b.type}${b.important ? ' !' : ''}${b.plain ? ' plain' : ''}${b.ordered ? ' ordered' : ''}${b.grounded ? '' : ' (not in source)'}: ${blockLine(b)}  | question: ${b.question || '-'}  | on the page: ${(areas.get(b.id) || { lines: [] }).lines.join(',') || 'NOT FOUND'}  <= "${String(b.source || '').replace(/\s+/g, ' ')}"`));
    out.push(`questions: ${mine.length} ${JSON.stringify(types)}`);
    const unchecked = mine.filter((x) => x.aiChecked !== true).length;
    out.push(unchecked ? `AI check: not done for ${unchecked} of ${mine.length} questions` : `AI check: done, ${mine.filter((x) => x.aiNote).length} flagged, ${mine.filter((x) => x.off).length} unselected by you`);
    const seen = new Map(); let dups = 0;
    mine.forEach((x) => { const k = norm(x.question) + '|' + norm(x.answer); if (seen.has(k)) dups++; seen.set(k, 1); });
    out.push(`same wording and answer asked twice: ${dups}`);
    mine.forEach((x, n) => {
      out.push(`  Q${n + 1} ${x.off ? '[ ] ' : ''}${x.type}: ${x.question}${x.flagged ? ' [flagged]' : ''}${x.aiNote ? ` [AI ${x.aiKind || 'check'}: ${x.aiNote}]` : ''}`);
      if (x.choices && x.choices.length && x.type !== 'tf') out.push('      choices: ' + x.choices.map((c) => c.label + '. ' + c.text).join(' | '));
      out.push(`      answer: ${x.answer}${x.correction ? ' (true version: ' + x.correction + ')' : ''}`);
      if (x.srcText) out.push(`      from: "${String(x.srcText).replace(/\s+/g, ' ')}"`);
    });
  });
  const again = events.filter((e) => e.type === 'check' && e.fileId === 'check');
  if (again.length) {
    out.push('', '--- "Check again" calls (all pages)');
    again.forEach((e) => { out.push(`AI check ${aiLine(e)}`); if (e.raw) out.push('  the AI\'s answer:', indent(e.raw)); });
  }
  return out.join('\n');
}

export function countNote(made, wanted) {
  return made >= wanted ? '' : `Only ${made} question${made === 1 ? '' : 's'} could be made from what was found, not ${wanted}.`;
}
// A starting suggestion for one page, from how much selected text it has. The student can change it.
export function suggestCount(t, off = []) {
  const words = (layoutText(t, { off }).match(/[A-Za-z0-9]+/g) || []).length;
  return words < 80 ? 5 : words < 200 ? 10 : words < 350 ? 15 : 20;
}
export function cleanCount(v) {
  const n = Math.round(+v);
  return isFinite(n) ? clamp(n, 1, MAX_COUNT) : DEFAULT_COUNT;
}

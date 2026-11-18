// Finds where each typed line really is on the photo with a text-reading engine (Tesseract) that runs on the phone.
// The AI's words are kept; only the places come from the engine. The engine files are served by the app itself
// (folder ocr/) and kept by the phone after the first use. Pure matching parts are exported for tests.

const norm = (s) => String(s || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9']+/g, ' ').trim();
const tokens = (s) => norm(s).split(' ').filter(Boolean);

function close(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4) return false;
  // one letter wrong, missing or extra (print read by the engine is not perfect)
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

// For one typed line, the engine line that holds most of its words, and the box around those words.
// ocrLines: [{ words: [{ text, x0, y0, x1, y1 }] }] in pixels.
export function matchLine(text, ocrLines, used = new Set()) {
  const t = tokens(text);
  if (!t.length) return null;
  let best = null;
  ocrLines.forEach((ol, k) => {
    const words = ol.words.map((w) => ({ ...w, n: norm(w.text) })).filter((w) => w.n);
    const hit = [];
    let from = 0;
    for (const tok of t) { // in order: each word of the line is looked for after the last one found
      for (let j = from; j < words.length; j++) if (close(tok, words[j].n)) { hit.push(words[j]); from = j + 1; break; }
    }
    // count letters, not words: short words like "the" or "a" are found almost anywhere
    const letters = (arr) => arr.reduce((n, w) => n + (w.n || w).length, 0);
    const score = letters(hit) / Math.max(letters(t), 1);
    const strongWords = hit.filter((w) => w.n.length >= 4).length;
    if (hit.length && (!best || score > best.score || (score === best.score && used.has(best.k) && !used.has(k)))) best = { k, score, hit, strongWords };
  });
  if (!best || best.score < 0.7) return null; // most of the line must be there: a weak match does more harm than none
  const longWords = t.filter((w) => w.length >= 4).length;
  if (best.strongWords < Math.min(2, longWords)) return null;
  // a line of only short words ("met.", "In a") must match a short engine line word for word
  if (!longWords && (best.score < 1 || ocrLines[best.k].words.length > t.length + 1)) return null;
  const xs0 = best.hit.map((w) => w.x0), xs1 = best.hit.map((w) => w.x1), ys0 = best.hit.map((w) => w.y0), ys1 = best.hit.map((w) => w.y1);
  return { k: best.k, score: best.score, box: { x0: Math.min(...xs0), y0: Math.min(...ys0), x1: Math.max(...xs1), y1: Math.max(...ys1) } };
}

// A straight-line map v' = a*v + b that a few wrong matches cannot spoil: the middle of all pairwise slopes.
function fit(pairs) {
  if (pairs.length < 3) return null;
  const slopes = [];
  for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
    const dx = pairs[j][0] - pairs[i][0];
    if (Math.abs(dx) > 0.02) slopes.push((pairs[j][1] - pairs[i][1]) / dx);
  }
  const mid = (arr) => { const s = [...arr].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
  const a = slopes.length ? mid(slopes) : 1;
  if (!(a > 0.3 && a < 3)) return null;
  return { a, b: mid(pairs.map((p) => p[1] - a * p[0])) };
}

// Puts the typed lines on the engine's boxes. W, H: size of the picture the engine read.
// First the sure matches (most of the words found) give how the AI's places map onto the photo;
// a weaker match then only counts when it is near where that map puts the line.
export function placeByOcr(t, ocrLines, W, H) {
  const found = t.lines.map((l) => matchLine(l.text, ocrLines));
  const sure = found.map((m) => m && m.score >= 0.7);
  const box = (l, m) => ({ ...l, x: m.box.x0 / W, y: m.box.y0 / H, w: Math.max((m.box.x1 - m.box.x0) / W, 0.01), h: Math.max((m.box.y1 - m.box.y0) / H, 0.006) });
  const py = [], px = [];
  t.lines.forEach((l, i) => { if (sure[i]) { const b = box(l, found[i]); py.push([l.y, b.y]); px.push([l.x, b.x]); } });
  const fy = fit(py), fx = fit(px);
  const mv = (v, f) => (f ? Math.max(0, Math.min(0.99, f.a * v + f.b)) : v);
  let matched = 0;
  const fixed = new Set();
  const placed = t.lines.map((l, i) => {
    const m = found[i];
    if (m) {
      const b = box(l, m);
      // every match, even a sure one, must sit about where the map puts the line: the same words can appear twice on a page
      if (!fy ? sure[i] : Math.abs(b.y - mv(l.y, fy)) < 0.05) { matched++; fixed.add(l.id); return b; }
    }
    return null;
  });
  // a line matched by only a few of its words can get a box that is too low: give it the usual line height
  const hs = placed.filter(Boolean).map((l) => l.h).sort((p, q) => p - q);
  const typicalH = hs.length ? hs[Math.floor(hs.length / 2)] : null;
  if (typicalH) placed.forEach((l, i) => { if (l && l.h < 0.7 * typicalH) placed[i] = { ...l, y: Math.max(0, l.y - (typicalH - l.h) / 2), h: typicalH }; });
  // a line matched by part of its words gets a box only around those words: widen it to fit the whole line
  const per = placed.map((l, i) => (l && found[i].score >= 0.95 && l.text.length > 8 ? l.w / l.text.length : null)).filter(Boolean).sort((p, q) => p - q);
  const charW = per.length ? per[Math.floor(per.length / 2)] : null;
  if (charW) placed.forEach((l, i) => { if (l) placed[i] = { ...l, w: Math.min(1 - l.x, Math.max(l.w, l.text.length * charW * 0.9)) }; });
  // the lines the engine did not find go between the found lines around them, in proportion (the AI's order and spacing are kept)
  const anchors = t.lines.map((l, i) => (placed[i] ? [l.y, placed[i].y] : null)).filter(Boolean).sort((p, q) => p[0] - q[0]);
  const yOf = (v) => {
    if (!anchors.length) return mv(v, fy);
    let lo = null, hi = null;
    for (const a of anchors) { if (a[0] <= v) lo = a; else if (!hi) hi = a; }
    const a = fy ? fy.a : 1;
    if (lo && hi && hi[0] - lo[0] > 1e-6) return lo[1] + (hi[1] - lo[1]) * (v - lo[0]) / (hi[0] - lo[0]);
    if (lo) return Math.min(0.99, lo[1] + (v - lo[0]) * a);
    return Math.max(0, hi[1] - (hi[0] - v) * a);
  };
  const lines = t.lines.map((l, i) => placed[i] || { ...l, x: mv(l.x, fx), y: yOf(l.y), w: fx ? Math.max(0.01, l.w * fx.a) : l.w, h: fy ? Math.max(0.006, l.h * fy.a) : l.h });
  const figures = (t.figures || []).map((f) => (fx && fy ? { ...f, x: mv(f.x, fx), y: mv(f.y, fy), w: Math.max(0.02, f.w * fx.a), h: Math.max(0.02, f.h * fy.a) } : f));
  return { ...t, lines, figures, matched, fixed };
}

// Browser only: reads the photo with the engine. Returns { lines, W, H } or throws.
let workerP = null;
async function engine() {
  if (!workerP) {
    workerP = (async () => {
      const { createWorker } = await import('tesseract.js');
      const base = new URL('ocr/', document.baseURI).href;
      return createWorker('eng', 1, { workerPath: base + 'worker.min.js', corePath: base, langPath: base, gzip: true });
    })();
    workerP.catch(() => { workerP = null; });
  }
  return workerP;
}
export async function readWithEngine(dataUrl, width = 2200) {
  const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('photo')); i.src = dataUrl; });
  // small print reads better a little enlarged
  const W = Math.min(width, Math.max(img.naturalWidth, 1800)), H = Math.round(W * img.naturalHeight / img.naturalWidth);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  c.getContext('2d').drawImage(img, 0, 0, W, H);
  const worker = await engine();
  const { data } = await worker.recognize(c, {}, { blocks: true, text: false });
  const lines = [];
  (data.blocks || []).forEach((b) => (b.paragraphs || []).forEach((p) => (p.lines || []).forEach((ln) => {
    lines.push({ words: (ln.words || []).map((w) => ({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 })) });
  })));
  return { lines, W, H };
}

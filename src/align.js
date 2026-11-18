// Puts each typed line where its text really is on the photo.
// The AI reads the words well but guesses their places; the photo's dark rows of print show the real places.
// Pure parts (inkRows, alignLines, untangle) work on plain numbers so they can be tested without a browser.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// A page mask: { W, H, ink: Uint8Array } where ink[y * W + x] is 1 for dark print.
// Rows of print inside the columns x0..x1, between rows y0..y1: [{ top, bottom }] in pixels.
export function inkRows(mask, x0, x1, y0, y1) {
  const { W, H, ink } = mask;
  x0 = clamp(Math.round(x0), 0, W - 1); x1 = clamp(Math.round(x1), x0 + 1, W);
  y0 = clamp(Math.round(y0), 0, H - 1); y1 = clamp(Math.round(y1), y0 + 1, H);
  const width = x1 - x0;
  const count = [];
  for (let y = y0; y < y1; y++) {
    let n = 0; const base = y * W;
    for (let x = x0; x < x1; x++) n += ink[base + x];
    count.push(n);
  }
  // a row counts as print when it is well inked compared with the darkest rows here:
  // the thin gaps between close lines (only tails of g, p, y) then still split the lines apart
  const top = Math.max(...count, 0);
  const need = Math.max(2, width * 0.02, top * 0.12);
  const rows = [];
  let start = -1;
  for (let y = y0; y < y1; y++) {
    const on = count[y - y0] >= need;
    if (on && start < 0) start = y;
    if (!on && start >= 0) { rows.push({ top: start, bottom: y }); start = -1; }
  }
  if (start >= 0) rows.push({ top: start, bottom: y1 });
  // join bits of one row split by a thin gap (letters like i, j, dots)
  const out = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && r.top - last.bottom <= 2) last.bottom = r.bottom; else out.push({ ...r });
  }
  return out.filter((r) => r.bottom - r.top >= 2);
}

// Where the print of one row starts and ends (pixels), looking only between x0 and x1.
export function rowExtent(mask, row, x0, x1) {
  const { W, ink } = mask;
  x0 = clamp(Math.round(x0), 0, W - 1); x1 = clamp(Math.round(x1), x0 + 1, W);
  const col = new Uint16Array(x1 - x0);
  for (let y = row.top; y < row.bottom; y++) { const base = y * W; for (let x = x0; x < x1; x++) col[x - x0] += ink[base + x]; }
  // ignore specks: a column counts when it has ink in at least 2 rows
  let left = -1, right = -1;
  for (let i = 0; i < col.length; i++) if (col[i] >= 2) { if (left < 0) left = i; right = i; }
  return left < 0 ? null : { left: x0 + left, right: x0 + right + 1 };
}

const xOverlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);

// Moves each line onto the nearest row of print near where the AI put it, one line per row.
// Lines are handled in reading order, so two lines never take the same row.
export function alignLines(lines, mask, figures = []) {
  const { W, H } = mask;
  const placed = [];
  const out = [];
  let moved = 0, total = 0;
  // go through the lines in the AI's reading order (their ids), not top to bottom by its guessed places:
  // when it gives two lines the same height, the one it read first is the upper one
  const num = (l) => { const m = /^l(\d+)$/.exec(l.id || ''); return m ? +m[1] : 0; };
  const order = [...lines].sort((a, b) => num(a) - num(b));
  const done = new Map();
  for (const l of order) {
    if (l.x == null || l.y == null || !l.w) { done.set(l, l); continue; }
    const h = clamp(l.h || 0.02, 0.006, 0.12);
    // look at the start of the line only: on a tilted photo the far end drifts up or down
    const x0 = l.x * W, x1 = (l.x + Math.min(l.w, 0.3)) * W;
    const yc = (l.y + h / 2) * H, reach = Math.max(3 * h * H, 12);
    const rows = inkRows(mask, x0, x1, yc - reach, yc + reach)
      .filter((r) => (r.bottom - r.top) <= 2.5 * h * H && (r.bottom - r.top) >= 0.3 * h * H) // about the size of a line of text
      .filter((r) => !figures.some((f) => Math.min(x1, (f.x + f.w) * W) - Math.max(x0, f.x * W) > 0.5 * (x1 - x0) && f.y * H < r.top && (f.y + f.h) * H > r.bottom)) // not inside a picture
      .filter((r) => !placed.some((p) => xOverlap(p, l) > 0.2 * Math.min(p.w, l.w) && r.top / H < p.y + p.h * 0.7 && r.bottom / H > p.y + p.h * 0.3)); // not already taken
    // keep the reading order: a line never goes above the line read just before it in the same column
    const before = [...placed].reverse().find((p) => xOverlap(p, l) > 0.2 * Math.min(p.w, l.w));
    if (before) for (let k = rows.length - 1; k >= 0; k--) if ((rows[k].top + rows[k].bottom) / 2 <= (before.y + before.h / 2) * H) rows.splice(k, 1);
    if (!rows.length) { done.set(l, l); placed.push({ ...l, h }); continue; }
    // pick the row that is near AND has the same shape: where the print starts and ends should match the line
    // (an indented short line and a full line next to it then do not get mixed up)
    const lx0 = l.x * W, lx1 = (l.x + l.w) * W;
    const cost = (r) => {
      const e = rowExtent(mask, r, lx0 - 0.04 * W, lx1 + 0.04 * W);
      const dy = Math.abs((r.top + r.bottom) / 2 - yc) / (h * H);
      if (!e) return dy + 3;
      return dy + 2.5 * (Math.abs(e.left - lx0) + Math.abs(e.right - lx1)) / Math.max(lx1 - lx0, 1);
    };
    const best = rows.map((r) => ({ r, c: cost(r) })).reduce((a, b) => (b.c < a.c ? b : a)).r;
    if (Math.abs((best.top + best.bottom) / 2 - yc) > 2.5 * h * H) { done.set(l, l); placed.push({ ...l, h }); continue; }
    // keep the AI's line height (it sets the letter size) and centre the line on its row of print
    const nh = h, ny = clamp(((best.top + best.bottom) / 2) / H - h / 2, 0, 1);
    const shift = Math.abs(ny - l.y);
    total += shift; if (shift > 0.003) moved++;
    const nl = { ...l, y: ny, h: nh };
    done.set(l, nl); placed.push(nl);
  }
  lines.forEach((l) => out.push(done.get(l) || l));
  return { lines: out, moved, avgShift: lines.length ? total / lines.length : 0 };
}

// Safety net: a line that still covers an earlier one moves down just below it; the lines under it follow.
export function untangle(lines) {
  const out = [];
  let pushed = 0;
  for (const l of lines) {
    if (l.x == null || l.y == null) { out.push(l); continue; }
    let nl = { ...l };
    const h = nl.h || 0.02;
    for (let guard = 0; guard < 40; guard++) {
      // lines whose tops are closer than 60% of a line height would print on top of each other
      const hit = out.find((p) => p.y != null && xOverlap(p, nl) > 0.2 * Math.min(p.w || 0.3, nl.w || 0.3) && Math.abs(nl.y - p.y) < 0.6 * Math.min(p.h || 0.02, h));
      if (!hit) break;
      nl = { ...nl, y: hit.y + (hit.h || 0.02) * 0.8 };
      pushed++;
    }
    out.push(nl);
  }
  return { lines: out, pushed };
}

// Browser only: builds the ink mask from a photo. Dark means clearly darker than the paper around it,
// so shadows and uneven light do not count as print.
export async function photoMask(dataUrl, width = 900) {
  const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('photo')); i.src = dataUrl; });
  const W = Math.min(width, img.naturalWidth || width);
  const H = Math.round(W * (img.naturalHeight / img.naturalWidth));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data;
  const gray = new Float32Array(W * H);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = px[j] * 0.3 + px[j + 1] * 0.59 + px[j + 2] * 0.11;
  // sums over the picture, to get the average brightness around any point quickly
  const S = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) { row += gray[y * W + x]; S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row; }
  }
  const r = Math.max(8, Math.round(W / 40));
  const ink = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(W, x + r + 1);
      const sum = S[yb * (W + 1) + xb] - S[ya * (W + 1) + xb] - S[yb * (W + 1) + xa] + S[ya * (W + 1) + xa];
      const mean = sum / ((yb - ya) * (xb - xa));
      ink[y * W + x] = gray[y * W + x] < mean * 0.85 ? 1 : 0; // faint grey print counts too
    }
  }
  return { W, H, ink };
}

// The whole step for one page: align to the photo when there is one, then untangle. Never throws.
export async function placeOnPhoto(dataUrl, t) {
  const t0 = Date.now();
  let lines = t.lines, moved = 0, avgShift = 0, aligned = false;
  try {
    if (dataUrl && typeof document !== 'undefined') {
      const mask = await photoMask(dataUrl);
      ({ lines, moved, avgShift } = alignLines(lines, mask, t.figures || []));
      aligned = true;
    }
  } catch { /* keep the AI's places */ }
  const u = untangle(lines);
  return { ...t, lines: u.lines, placed: { aligned, moved, avgShift: Math.round(avgShift * 1000) / 1000, pushed: u.pushed, ms: Date.now() - t0 } };
}

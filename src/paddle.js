// Text finder on the phone: PaddleOCR models (PP-OCRv4 detection + recognition) run with ONNX Runtime.
// The engine finds every printed line with its exact box; the AI's text is then matched to those lines.
// Everything here is plain math on pixel arrays, so it runs in a web worker and in Node tests alike.
// An image is { data: RGBA bytes, width, height }.

export const DET = { side: 1600, thresh: 0.3, boxThresh: 0.3, unclip: 1.6 };

// bilinear sample of one channel at (x, y)
function sample(img, x, y, c) {
  const { data, width: W, height: H } = img;
  x = Math.max(0, Math.min(W - 1, x)); y = Math.max(0, Math.min(H - 1, y));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), fx = x - x0, fy = y - y0;
  const a = data[(y0 * W + x0) * 4 + c], b = data[(y0 * W + x1) * 4 + c], d = data[(y1 * W + x0) * 4 + c], e = data[(y1 * W + x1) * 4 + c];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
}

// detection input: longest side at most DET.side, both sides multiples of 32, BGR, (v/255 - .5) / .5
export function detInput(img) {
  const r = Math.min(1, DET.side / Math.max(img.width, img.height));
  const rw = Math.max(32, Math.round((img.width * r) / 32) * 32), rh = Math.max(32, Math.round((img.height * r) / 32) * 32);
  const out = new Float32Array(3 * rw * rh), plane = rw * rh, sx = img.width / rw, sy = img.height / rh;
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const X = (x + 0.5) * sx - 0.5, Y = (y + 0.5) * sy - 0.5, p = y * rw + x;
    out[p] = (sample(img, X, Y, 2) / 255 - 0.5) / 0.5;
    out[plane + p] = (sample(img, X, Y, 1) / 255 - 0.5) / 0.5;
    out[2 * plane + p] = (sample(img, X, Y, 0) / 255 - 0.5) / 0.5;
  }
  return { data: out, rw, rh };
}

function hull(pts) { // monotone chain; pts as [x, y]
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

// smallest rotated rectangle around a convex hull: { cx, cy, w, h, a } with w along the text (a in radians, |a| <= 45°)
function minRect(h) {
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const p = h[i], q = h[(i + 1) % h.length];
    const ang = Math.atan2(q[1] - p[1], q[0] - p[0]), c = Math.cos(ang), s = Math.sin(ang);
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const r of h) { const u = r[0] * c + r[1] * s, v = -r[0] * s + r[1] * c; a0 = Math.min(a0, u); a1 = Math.max(a1, u); b0 = Math.min(b0, v); b1 = Math.max(b1, v); }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area) best = { area, ang, a0, a1, b0, b1 };
  }
  if (!best) return null;
  const { ang, a0, a1, b0, b1 } = best, c = Math.cos(ang), s = Math.sin(ang), mu = (a0 + a1) / 2, mv = (b0 + b1) / 2;
  let w = a1 - a0, hh = b1 - b0, a = ang;
  const cx = mu * c - mv * s, cy = mu * s + mv * c;
  // turn so the long side runs left to right
  if (hh > w) { [w, hh] = [hh, w]; a += Math.PI / 2; }
  while (a > Math.PI / 2) a -= Math.PI; while (a <= -Math.PI / 2) a += Math.PI;
  return { cx, cy, w, h: hh, a };
}

// detection output (probability per pixel, rw x rh) -> text line boxes in the original image's pixels
export function dbBoxes(pred, rw, rh, W, H) {
  const n = rw * rh, bit = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (pred[i] > DET.thresh) bit[i] = 1;
  const dil = new Uint8Array(n); // 2x2 dilation
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const i = y * rw + x;
    if (bit[i] || (x > 0 && bit[i - 1]) || (y > 0 && bit[i - rw]) || (x > 0 && y > 0 && bit[i - rw - 1])) dil[i] = 1;
  }
  const lab = new Int32Array(n), boxes = [], stack = new Int32Array(n);
  let next = 1;
  for (let s = 0; s < n; s++) {
    if (!dil[s] || lab[s]) continue;
    let top = 0, sum = 0, cnt = 0; stack[top++] = s; lab[s] = next;
    const edge = [];
    while (top) {
      const i = stack[--top], x = i % rw, y = (i - x) / rw;
      sum += pred[i]; cnt++;
      let border = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= rw || Y >= rh) { border = true; continue; }
        const j = Y * rw + X;
        if (!dil[j]) { border = true; continue; }
        if (!lab[j]) { lab[j] = next; stack[top++] = j; }
      }
      if (border) edge.push([x + 0.5, y + 0.5]);
    }
    next++;
    if (cnt < 6 || edge.length < 3) continue;
    const r = minRect(hull(edge));
    if (!r || r.h < 3) continue;
    const score = sum / cnt;
    if (score < DET.boxThresh) continue;
    const d = (r.w * r.h * DET.unclip) / (2 * (r.w + r.h)); // grow the box like PaddleOCR's unclip
    const w = r.w + 2 * d, h = r.h + 2 * d;
    if (h < 5) continue;
    const kx = W / rw, ky = H / rh;
    boxes.push({ cx: r.cx * kx, cy: r.cy * ky, w: w * Math.hypot(Math.cos(r.a) * kx, Math.sin(r.a) * ky), h: h * Math.hypot(Math.sin(r.a) * kx, Math.cos(r.a) * ky), a: r.a, score });
  }
  return boxes.sort((p, q) => p.cy - q.cy || p.cx - q.cx);
}

// recognition input for one box: the rotated line cut out, 48 high, BGR, (v/255 - .5) / .5, padded to width
export function recInput(img, b, width) {
  const H = 48, ratio = b.w / Math.max(1, b.h), rwid = Math.min(width, Math.ceil(H * ratio));
  const out = new Float32Array(3 * H * width), plane = H * width, c = Math.cos(b.a), s = Math.sin(b.a);
  for (let y = 0; y < H; y++) for (let x = 0; x < rwid; x++) {
    const u = ((x + 0.5) / rwid - 0.5) * b.w, v = ((y + 0.5) / H - 0.5) * b.h;
    const X = b.cx + u * c - v * s - 0.5, Y = b.cy + u * s + v * c - 0.5, p = y * width + x;
    out[p] = (sample(img, X, Y, 2) / 255 - 0.5) / 0.5;
    out[plane + p] = (sample(img, X, Y, 1) / 255 - 0.5) / 0.5;
    out[2 * plane + p] = (sample(img, X, Y, 0) / 255 - 0.5) / 0.5;
  }
  return out;
}

// greedy CTC decoding: index 0 is the blank, the last index is a space
export function ctcDecode(probs, T, C, keys, offset = 0) {
  let text = '', last = -1, conf = 0, k = 0;
  for (let t = 0; t < T; t++) {
    let bi = 0, bv = -1;
    const base = offset + t * C;
    for (let c = 0; c < C; c++) { const v = probs[base + c]; if (v > bv) { bv = v; bi = c; } }
    if (bi !== 0 && bi !== last) { text += bi === C - 1 ? ' ' : keys[bi - 1] || ''; conf += bv; k++; }
    last = bi;
  }
  return { text: text.trim(), conf: k ? conf / k : 0 };
}

// run both models: returns lines { text, conf, cx, cy, w, h, a } in the image's pixels
export async function readImage(ort, det, rec, keys, img) {
  const di = detInput(img);
  const dOut = await det.run({ [det.inputNames[0]]: new ort.Tensor('float32', di.data, [1, 3, di.rh, di.rw]) });
  const pred = dOut[det.outputNames[0]].data;
  const boxes = dbBoxes(pred, di.rw, di.rh, img.width, img.height);
  const order = boxes.map((b, i) => i).sort((p, q) => boxes[p].w / boxes[p].h - boxes[q].w / boxes[q].h);
  const res = new Array(boxes.length);
  for (let i = 0; i < order.length; i += 6) { // batches of similar shape, as PaddleOCR does
    const ids = order.slice(i, i + 6);
    const width = Math.max(320, ...ids.map((j) => Math.ceil((48 * boxes[j].w) / Math.max(1, boxes[j].h))));
    const one = 3 * 48 * width, batch = new Float32Array(one * ids.length);
    ids.forEach((j, k) => batch.set(recInput(img, boxes[j], width), k * one));
    const rOut = await rec.run({ [rec.inputNames[0]]: new ort.Tensor('float32', batch, [ids.length, 3, 48, width]) });
    const o = rOut[rec.outputNames[0]], [, T, C] = o.dims;
    ids.forEach((j, k) => { res[j] = { ...boxes[j], ...ctcDecode(o.data, T, C, keys, k * T * C) }; });
  }
  return res;
}

// ---- matching the AI's lines to the engine's lines ----
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function similar(a, b) { // 2 * longest common subsequence / total length
  a = norm(a); b = norm(b);
  if (!a.length || !b.length) return 0;
  let prev = new Uint16Array(b.length + 1), cur = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    [prev, cur] = [cur, prev];
  }
  return (2 * prev[b.length]) / (a.length + b.length);
}
const rnum = (l) => Number(String(l.id).replace(/\D/g, '')) || 0;

// t: the page ({ lines, figures }, places 0..1); eng: engine lines in pixels of a W x H image.
// 1. Lines with 6 or more letters take the engine line with the most similar text (each engine line once, best pairs first).
// 2. Short lines (like "II" or "XI") look alike, so they only take an engine line with exactly the same letters,
//    near where the found lines around them put them.
// 3. A line still not found keeps the AI's place, moved by the same step as the found lines read before and after it
//    (so a numeral stays on the row of its text).
// A placed line keeps x, y (top-left of its left end), w (length along the text), h and a (tilt in degrees).
export function placeByEngine(t, eng, W, H) {
  const short = (l) => norm(l.text).length < 6;
  const box = (e) => {
    if (e.w < 1.5 * e.h || Math.abs(e.a) > Math.PI / 4) { // a short box is never tilted: take its straight outline
      const c = Math.abs(Math.cos(e.a)), s = Math.abs(Math.sin(e.a));
      const bw = e.w * c + e.h * s, bh = e.w * s + e.h * c;
      return { x: (e.cx - bw / 2) / W, y: (e.cy - bh / 2) / H, w: bw / W, h: bh / H, a: 0 };
    }
    const c = Math.cos(e.a), s = Math.sin(e.a);
    const lx = e.cx - (e.w / 2) * c, ly = e.cy - (e.w / 2) * s; // middle of the left end
    return { x: (lx + (e.h / 2) * s) / W, y: (ly - (e.h / 2) * c) / H, w: e.w / W, h: e.h / H, a: (e.a * 180) / Math.PI };
  };
  const got = new Map(), used = new Set();
  const pairs = [];
  t.lines.forEach((l, i) => { if (!short(l)) eng.forEach((e, j) => { const s = similar(l.text, e.text); if (s > 0.6) pairs.push([s, i, j]); }); });
  pairs.sort((p, q) => q[0] - p[0]);
  for (const [, i, j] of pairs) if (!got.has(i) && !used.has(j)) { got.set(i, j); used.add(j); }
  const rd = t.lines.map((l, i) => i).sort((p, q) => rnum(t.lines[p]) - rnum(t.lines[q]));
  const pos = new Map(rd.map((i, k) => [i, k]));
  const placed = new Map([...got].map(([i, j]) => [i, box(eng[j])]));
  // the step (dx, dy) the found lines around line i were moved by, mixed by how close they are in reading order
  const step = (i) => {
    const k = pos.get(i);
    let lo = null, hi = null;
    for (let m = k - 1; m >= 0; m--) if (placed.has(rd[m])) { lo = rd[m]; break; }
    for (let m = k + 1; m < rd.length; m++) if (placed.has(rd[m])) { hi = rd[m]; break; }
    const d = (n) => ({ dx: placed.get(n).x - t.lines[n].x, dy: placed.get(n).y - t.lines[n].y, h: placed.get(n).h, a: placed.get(n).a });
    if (lo != null && hi != null) {
      const f = (k - pos.get(lo)) / (pos.get(hi) - pos.get(lo)), A = d(lo), B = d(hi);
      return { dx: A.dx + (B.dx - A.dx) * f, dy: A.dy + (B.dy - A.dy) * f, h: (A.h + B.h) / 2, a: Math.abs(A.a - B.a) < 3 ? (A.a + B.a) / 2 : 0 };
    }
    return lo != null ? d(lo) : hi != null ? d(hi) : null;
  };
  // 2. short lines: exactly the same letters, within about half a line of where they are expected (closest pairs first)
  const near = [];
  t.lines.forEach((l, i) => {
    if (got.has(i) || !short(l) || !norm(l.text)) return;
    const st = step(i); if (!st) return;
    const ey = l.y + st.dy, ex = l.x + st.dx, tol = 0.6 * (st.h || l.h || 0.02);
    eng.forEach((e, j) => {
      if (used.has(j) || norm(e.text) !== norm(l.text)) return;
      const b = box(e);
      if (Math.abs(b.y - ey) < tol) near.push([Math.abs(b.y - ey) + 0.5 * Math.abs(b.x - ex), i, j]);
    });
  });
  near.sort((p, q) => p[0] - q[0]);
  for (const [, i, j] of near) if (!got.has(i) && !used.has(j)) { got.set(i, j); used.add(j); placed.set(i, box(eng[j])); }
  // 3. the rest keep the AI's place, moved like their neighbours
  const lines = t.lines.map((l, i) => {
    if (placed.has(i)) return { ...l, ...placed.get(i) };
    const st = step(i);
    if (!st) return l;
    let y = l.y + st.dy;
    // reading order wins: never above the found line read before it, never below the one read after it
    // (in its own column it also keeps a line's height of room; a numeral beside its text may share the row)
    const k = pos.get(i), h = st.h || l.h || 0.02;
    let lo = null, hi = null;
    for (let m = k - 1; m >= 0; m--) if (placed.has(rd[m])) { lo = rd[m]; break; }
    for (let m = k + 1; m < rd.length; m++) if (placed.has(rd[m])) { hi = rd[m]; break; }
    const sameCol = (n) => Math.min(t.lines[n].x + t.lines[n].w, l.x + l.w) - Math.max(t.lines[n].x, l.x) > 0.5 * Math.min(t.lines[n].w, l.w);
    const low = lo != null ? placed.get(lo).y + (sameCol(lo) ? 0.6 * h : 0) : -Infinity;
    const top = hi != null ? placed.get(hi).y - (sameCol(hi) ? 0.6 * h : 0) : Infinity;
    if (low <= top) y = Math.min(top, Math.max(low, y)); else y = (low + top) / 2;
    return { ...l, x: l.x + st.dx, y, h, a: short(l) ? 0 : st.a };
  });
  const fixed = new Set([...got.keys()].map((i) => t.lines[i].id));
  const offs = [...got.keys()].map((i) => `${t.lines[i].id}${lines[i].y - t.lines[i].y >= 0 ? '+' : ''}${(lines[i].y - t.lines[i].y).toFixed(3)}`);
  return { lines, matched: got.size, fixed, offs, engineLines: eng.length };
}

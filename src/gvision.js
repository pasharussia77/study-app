// Google Vision gives every word with its four corners (photo pixels). This joins the words into lines,
// in the same shape the on-phone text finder returns: { cx, cy, w, h, a (radians), text }.
// Words arrive in reading order; a line ends where Google ends it, where a wide gap opens (a numeral and its text sit
// far apart) or where the next word is off the line's row.
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

function geo(w) {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = w.v;
  return {
    t: String(w.t), b: w.b, wl: dist(x0, y0, x1, y1), h: dist(x0, y0, x3, y3), a: Math.atan2(y1 - y0, x1 - x0),
    lx: (x0 + x3) / 2, ly: (y0 + y3) / 2, rx: (x1 + x2) / 2, ry: (y1 + y2) / 2, cx: (x0 + x1 + x2 + x3) / 4, cy: (y0 + y1 + y2 + y3) / 4
  };
}

function finish(ws) {
  const f = ws[0], l = ws[ws.length - 1];
  const wl = dist(f.lx, f.ly, l.rx, l.ry);
  return {
    cx: (f.lx + l.rx) / 2, cy: (f.ly + l.ry) / 2, w: wl, h: ws.reduce((s, x) => s + x.h, 0) / ws.length,
    a: ws.length > 1 && wl > 0 ? Math.atan2(l.ry - f.ly, l.rx - f.lx) : f.a, text: ws.map((x) => x.t).join(' ')
  };
}

export function wordsToLines(words) {
  const lines = [];
  let cur = [];
  const push = () => { if (cur.length) lines.push(finish(cur)); cur = []; };
  for (const w of words || []) {
    if (!w || !Array.isArray(w.v) || w.v.length < 8) continue;
    const g = geo(w);
    if (!(g.wl > 0 && g.h > 0) || !g.t.trim()) { if (w.b === 'L') push(); continue; }
    if (cur.length) {
      const p = cur[cur.length - 1], ux = Math.cos(p.a), uy = Math.sin(p.a);
      const along = (g.lx - p.rx) * ux + (g.ly - p.ry) * uy; // from the end of the last word to the start of this one
      const across = Math.abs(-(g.cx - p.cx) * uy + (g.cy - p.cy) * ux); // how far this word sits off the line's row
      const hh = Math.max(g.h, p.h);
      if (along > 1.5 * hh || along < -0.5 * hh || across > 0.6 * hh) push();
    }
    cur.push(g);
    if (w.b === 'L') push();
  }
  push();
  return lines;
}

// Sends the photo to the Worker (which asks Google) and returns { lines, W, H } in the sent photo's pixels.
export async function readGoogle(code, dataUrl, maxSide = 1800) {
  const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
  const k = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
  const W = Math.round(im.naturalWidth * k), H = Math.round(im.naturalHeight * k);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  c.getContext('2d').drawImage(im, 0, 0, W, H);
  const image = c.toDataURL('image/jpeg', 0.85).split(',')[1];
  const { workerFetch, explain } = await import('./ai.js');
  const res = await workerFetch(code, '/vision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(explain(res, data, 'Google Vision reading'));
  return { lines: wordsToLines(data.words), W, H, words: (data.words || []).length };
}

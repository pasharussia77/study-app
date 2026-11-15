// A fake cracked screen. It is fixed to the glass: it does not scroll with the page.
// The crack grows with the setting (0 = none ... 1 = shattered): at first one small crack, then more cracks branch out.
// Where it hit decides how it spreads: from the middle it radiates in every direction, from a corner or edge it only spreads inward.
// The spot is picked at random once for this phone and kept, like a real crack; the Colors screen can move it to a new spot.
import React, { useEffect, useMemo, useState } from 'react';

const W = 390, H = 844; // the crack is drawn in a phone-sized space and scaled to the screen
const KEY = 'crackSeed';

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function rerollCrack() {
  const s = 1 + Math.floor(Math.random() * 2147483646);
  try { localStorage.setItem(KEY, String(s)); } catch { /* not saved */ }
  window.dispatchEvent(new Event('crack-reroll'));
  return s;
}
function getSeed() {
  try { const s = parseInt(localStorage.getItem(KEY), 10); if (s > 0) return s; } catch { /* none yet */ }
  const s = 1 + Math.floor(Math.random() * 2147483646);
  try { localStorage.setItem(KEY, String(s)); } catch { /* not saved */ }
  return s;
}

// Where the glass was hit: a corner (40%), an edge (25%) or somewhere in the middle (35%).
export function impactFor(seed) {
  const r = rng(seed), m = r();
  if (m < 0.4) return { kind: 'corner', x: r() < 0.5 ? 6 + r() * 60 : W - 6 - r() * 60, y: r() < 0.5 ? 6 + r() * 80 : H - 6 - r() * 80 };
  if (m < 0.65) return r() < 0.5
    ? { kind: 'edge', x: r() < 0.5 ? 4 + r() * 20 : W - 4 - r() * 20, y: 140 + r() * 560 }
    : { kind: 'edge', x: 80 + r() * 230, y: r() < 0.5 ? 4 + r() * 30 : H - 4 - r() * 30 };
  return { kind: 'center', x: 100 + r() * 190, y: 230 + r() * 380 };
}

const f1 = (n) => n.toFixed(1);
export function buildCrack(seed) {
  const { x: ix, y: iy, kind } = impactFor(seed);
  const r = rng((seed * 2654435761) ^ 0x9e3779b9), R = (a, b) => a + r() * (b - a);
  const nR = kind === 'center' ? 9 : kind === 'edge' ? 7 : 6;
  const toMid = Math.atan2(H / 2 - iy, W / 2 - ix);
  const half = kind === 'center' ? Math.PI : kind === 'edge' ? Math.PI * 0.85 : Math.PI * 0.62; // how wide the fan opens
  const rays = [];
  for (let i = 0; i < nR; i++) {
    const base = kind === 'center' ? (i / nR) * Math.PI * 2 + R(-0.2, 0.2) : toMid - half + ((i + 0.5) / nR) * half * 2 + R(-0.12, 0.12);
    let a = base, x = ix, y = iy, len = 0;
    const target = R(600, 1000), pts = [[x, y]], cum = [0];
    while (len < target) {
      const s = R(20, 42); a += R(-0.2, 0.2) + (base - a) * 0.12;
      x += Math.cos(a) * s; y += Math.sin(a) * s; len += s; pts.push([x, y]); cum.push(len);
    }
    rays.push({ base, pts, cum, total: len, off: Math.abs(((base - toMid + Math.PI * 3) % (Math.PI * 2)) - Math.PI) });
  }
  // the crack that heads toward the middle of the screen starts first, the rest follow
  const order = [...rays].sort((p, q) => p.off - q.off);
  order.forEach((ry, i) => { ry.th = (i / nR) * 0.5; ry.sp = 0.5; });
  const paths = [];
  const toD = (pts) => pts.map((p, i) => (i ? 'L' : 'M') + f1(p[0]) + ' ' + f1(p[1])).join('');
  rays.forEach((ry) => paths.push({ d: toD(ry.pts), th: ry.th, sp: ry.sp, w: 1.5, k: 'ray' }));
  // branches that fork off each crack once it has grown that far
  rays.forEach((ry) => {
    const nB = 2 + Math.floor(r() * 3);
    for (let b = 0; b < nB; b++) {
      const k = 3 + Math.floor(r() * (ry.pts.length - 6)); if (k < 3 || k >= ry.pts.length - 2) continue;
      const [px, py] = ry.pts[k], dir = Math.atan2(ry.pts[k + 1][1] - ry.pts[k - 1][1], ry.pts[k + 1][0] - ry.pts[k - 1][0]);
      let a = dir + (r() < 0.5 ? -1 : 1) * R(0.45, 0.95), x = px, y = py, len = 0;
      const target = R(70, 230) * (1 - (k / ry.pts.length) * 0.4), pts = [[x, y]];
      while (len < target) { const s = R(12, 24); a += R(-0.3, 0.3); x += Math.cos(a) * s; y += Math.sin(a) * s; len += s; pts.push([x, y]); }
      paths.push({ d: toD(pts), th: Math.min(0.88, ry.th + ry.sp * (ry.cum[k] / ry.total) + 0.02), sp: 0.28, w: 0.95, k: 'branch' });
    }
  });
  // the spider-web rings that join neighbouring cracks
  const sorted = [...rays].sort((p, q) => p.base - q.base);
  const at = (ry, d) => { let i = 1; while (i < ry.cum.length - 1 && ry.cum[i] < d) i++; const t = (d - ry.cum[i - 1]) / (ry.cum[i] - ry.cum[i - 1] || 1); return [ry.pts[i - 1][0] + (ry.pts[i][0] - ry.pts[i - 1][0]) * t, ry.pts[i - 1][1] + (ry.pts[i][1] - ry.pts[i - 1][1]) * t]; };
  [48, 98, 165, 250].forEach((rho) => {
    const pairs = sorted.map((a, i) => [a, sorted[(i + 1) % sorted.length]]).filter(([a, b], i) => kind === 'center' || i < sorted.length - 1);
    pairs.forEach(([a, b]) => {
      if (rho > a.total || rho > b.total) return;
      const pa = at(a, rho), pb = at(b, rho), mx = (pa[0] + pb[0]) / 2 + R(-6, 6), my = (pa[1] + pb[1]) / 2 + R(-6, 6);
      const th = Math.max(a.th + a.sp * (rho / a.total), b.th + b.sp * (rho / b.total)) + 0.01;
      paths.push({ d: toD([pa, [mx, my], pb]), th: Math.min(th, 0.95), sp: 0.1, w: 0.8, k: 'ring' });
    });
  });
  // small chips of glass around the point of impact
  const chips = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + R(-0.2, 0.2), d = R(6, 20), s = R(4, 9), t = a + R(0.5, 1.2);
    chips.push([[ix + Math.cos(a) * d, iy + Math.sin(a) * d], [ix + Math.cos(a) * (d + s), iy + Math.sin(a) * (d + s)], [ix + Math.cos(t) * (d + s * 0.6), iy + Math.sin(t) * (d + s * 0.6)]].map((p) => f1(p[0]) + ',' + f1(p[1])).join(' '));
  }
  return { ix, iy, kind, paths, chips };
}

export default function Crack() {
  const [seed, setSeed] = useState(getSeed);
  useEffect(() => { const h = () => setSeed(getSeed()); window.addEventListener('crack-reroll', h); return () => window.removeEventListener('crack-reroll', h); }, []);
  const c = useMemo(() => buildCrack(seed), [seed]);
  return (
    <svg className="crack" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="crack-haze"><stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
      </defs>
      <circle className="crack-haze" cx={c.ix} cy={c.iy} r="78" fill="url(#crack-haze)" />
      {c.paths.map((p, i) => <path key={'l' + i} className="ck ck-l" d={p.d} pathLength="1" transform="translate(1.1 1.1)" strokeWidth={p.w * 0.55} style={{ '--th': p.th, '--sp': p.sp }} />)}
      {c.paths.map((p, i) => <path key={'d' + i} className="ck ck-d" d={p.d} pathLength="1" strokeWidth={p.w} style={{ '--th': p.th, '--sp': p.sp }} />)}
      <g className="crack-chips" style={{ transformOrigin: `${c.ix}px ${c.iy}px` }}>
        {c.chips.map((pts, i) => <polygon key={i} points={pts} />)}
        <circle cx={c.ix} cy={c.iy} r="2.4" className="crack-pit" />
      </g>
    </svg>
  );
}

if (typeof location !== 'undefined' && location.search.includes('mock')) {
  window.__crack = { impactFor, setSeed: (s) => { try { localStorage.setItem(KEY, String(s)); } catch { /* ignore */ } window.dispatchEvent(new Event('crack-reroll')); } };
}

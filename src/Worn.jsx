// The worn look at the left of the colour pad: an old, dirty study book.
// Layers over the whole screen: edge grime, grain, uneven shading, yellowed stains, smudges, dirty spots, a few scratches,
// and pale patches where the page has faded out. A new random pattern is drawn every time a screen loads.
// How much shows depends on --g (0 clean ... 1 most worn); each mark has its own threshold, so moving further left brings in more.
import React, { useEffect, useMemo, useState } from 'react';
import { onScreenChange } from './nav.js';

const W = 390, H = 844;
function rng(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function marks(seed) {
  const r = rng(seed), mul = [], fade = [];
  const R = (a, b) => a + r() * (b - a);
  const th = () => R(0.02, 0.92);
  const f = (n) => +n.toFixed(1);
  // soft patches: ellipses filled with a gradient that fades to nothing at the edge
  const blob = (list, g, n, rx, ry, o) => { for (let i = 0; i < n; i++) { const a = R(0, 180); list.push({ t: 'e', g, cx: f(R(-20, W + 20)), cy: f(R(-20, H + 20)), rx: f(R(rx[0], rx[1])), ry: f(R(ry[0], ry[1])), a: f(a), o: +R(o[0], o[1]).toFixed(2), th: th() }); } };
  blob(mul, 'dark', 9, [90, 210], [60, 150], [0.1, 0.2]);      // uneven shading
  blob(mul, 'sepia', 9, [40, 130], [30, 100], [0.16, 0.3]);    // yellowed, brownish stains
  blob(mul, 'dark', 16, [24, 90], [7, 24], [0.12, 0.26]);      // smudges
  blob(mul, 'dark', 7, [14, 30], [18, 40], [0.1, 0.2]);        // thumb marks
  blob(fade, 'white', 10, [70, 190], [50, 140], [0.28, 0.48]); // pale patches where the page has faded
  // coffee-ring style stains
  for (let i = 0; i < 3; i++) mul.push({ t: 'ring', cx: f(R(30, W - 30)), cy: f(R(40, H - 40)), r: f(R(22, 46)), o: +R(0.16, 0.3).toFixed(2), th: R(0.25, 0.9) });
  // dirty spots, alone and in small groups
  for (let i = 0; i < 60; i++) mul.push({ t: 'c', cx: f(R(0, W)), cy: f(R(0, H)), r: f(R(0.7, 4.8)), fill: r() < 0.25 ? '#6B4A1E' : '#1F1A14', o: +R(0.3, 0.62).toFixed(2), th: th() });
  for (let k = 0; k < 7; k++) {
    const cx = R(10, W - 10), cy = R(10, H - 10), th0 = R(0.05, 0.8);
    for (let i = 0; i < 9; i++) mul.push({ t: 'c', cx: f(cx + R(-26, 26)), cy: f(cy + R(-26, 26)), r: f(R(0.6, 3.2)), fill: '#241D15', o: +R(0.3, 0.6).toFixed(2), th: th0 + i * 0.01 });
  }
  // a few short scratches
  for (let i = 0; i < 24; i++) {
    const x = R(0, W), y = R(0, H), len = R(24, 150), ang = r() < 0.5 ? R(1.2, 1.9) : R(0, 3.14), bend = R(-14, 14);
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    mul.push({ t: 'p', d: `M${f(x)} ${f(y)}Q${f((x + x2) / 2 + bend)} ${f((y + y2) / 2 - bend)} ${f(x2)} ${f(y2)}`, sw: +R(0.35, 0.9).toFixed(2), o: +R(0.18, 0.34).toFixed(2), stroke: '#1E1A16', th: th() });
  }
  for (let i = 0; i < 12; i++) {
    const x = R(0, W), y = R(0, H), len = R(20, 110), ang = R(0, 3.14);
    fade.push({ t: 'p', d: `M${f(x)} ${f(y)}L${f(x + Math.cos(ang) * len)} ${f(y + Math.sin(ang) * len)}`, sw: +R(0.4, 1).toFixed(2), o: +R(0.45, 0.7).toFixed(2), stroke: '#FFFFFF', th: th() });
  }
  for (let i = 0; i < 40; i++) fade.push({ t: 'c', cx: f(R(0, W)), cy: f(R(0, H)), r: f(R(0.5, 2.2)), fill: '#FFFFFF', o: +R(0.4, 0.75).toFixed(2), th: th() });
  return { mul, fade };
}

function Marks({ list }) {
  return list.map((m, i) => {
    const style = { '--th': m.th, '--o': m.o };
    if (m.t === 'e') return <ellipse key={i} className="wi" style={style} cx={m.cx} cy={m.cy} rx={m.rx} ry={m.ry} transform={`rotate(${m.a} ${m.cx} ${m.cy})`} fill={`url(#wg-${m.g})`} />;
    if (m.t === 'ring') return <g key={i} className="wi" style={style}><circle cx={m.cx} cy={m.cy} r={m.r} fill="url(#wg-sepia)" opacity=".5" /><circle cx={m.cx} cy={m.cy} r={m.r} fill="none" stroke="#7A5524" strokeWidth="2.4" opacity=".55" /></g>;
    if (m.t === 'c') return <circle key={i} className="wi" style={style} cx={m.cx} cy={m.cy} r={m.r} fill={m.fill} />;
    return <path key={i} className="wi" style={style} d={m.d} fill="none" stroke={m.stroke} strokeWidth={m.sw} strokeLinecap="round" />;
  });
}

const Defs = () => (
  <defs>
    {[['dark', '#26201A'], ['sepia', '#8E6A2C'], ['white', '#FFFFFF']].map(([k, c]) => (
      <radialGradient key={k} id={`wg-${k}`}><stop offset="0" stopColor={c} stopOpacity="1" /><stop offset=".55" stopColor={c} stopOpacity=".55" /><stop offset="1" stopColor={c} stopOpacity="0" /></radialGradient>
    ))}
  </defs>
);

export default function Worn() {
  const fresh = () => Math.floor(Math.random() * 2147483647);
  const [seed, setSeed] = useState(fresh);
  useEffect(() => onScreenChange(() => setSeed(fresh())), []);
  const m = useMemo(() => marks(seed), [seed]);
  const common = { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': true, focusable: 'false' };
  return (
    <>
      <div className="worn worn-edge" aria-hidden="true" />
      <div className="worn worn-grain" aria-hidden="true" />
      <svg className="worn worn-mul" {...common}><Defs /><Marks list={m.mul} /></svg>
      <svg className="worn worn-fade" {...common}><Defs /><Marks list={m.fade} /></svg>
    </>
  );
}

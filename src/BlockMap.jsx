import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './art.jsx';
import { useOverlay } from './nav.js';

// Ten colours that stay apart from each other; block n gets colour n.
const HUES = [212, 28, 140, 330, 265, 50, 185, 0, 95, 300];
export const blockColor = (n) => {
  const h = HUES[n % HUES.length];
  return { line: `hsl(${h} 70% 45%)`, fill: `hsla(${h} 95% 55% / .22)`, soft: `hsla(${h} 70% 45% / .45)`, pale: `hsla(${h} 95% 60% / .09)`, h };
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// The read page with each selected block outlined and shaded in its own colour.
// Pinch, drag and double-tap to zoom; tap a coloured area to pick its block.
export default function BlockMap({ file, blocks, areas, activeId, onPick, pageLabel }) {
  const t = file.transcript || { lines: [], figures: [] };
  const lines = t.lines || [];
  const ratio = file.w && file.h ? file.h / file.w : 4 / 3;
  const [fade, setFade] = useState(1);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [vpW, setVpW] = useState(0);
  const [full, setFull] = useState(false);
  const vpRef = useRef(null);
  const ptrs = useRef(new Map());
  const gest = useRef(null);
  const lastTap = useRef(null);
  const viewRef = useRef(view); viewRef.current = view;
  // where each line of text really sits once drawn, so the boxes fit the words exactly
  const pageRef = useRef(null);
  const [boxes, setBoxes] = useState({});
  useLayoutEffect(() => {
    const pg = pageRef.current; if (!pg || !pg.offsetWidth) return;
    const W = pg.offsetWidth, H = pg.offsetHeight, out = {};
    pg.querySelectorAll('[data-lid]').forEach((el) => {
      // the text itself, without the small side padding of the piece
      const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0;
      out[el.dataset.lid] = { x: (el.offsetLeft + pad) / W, y: el.offsetTop / H, w: Math.max(el.offsetWidth - 2 * pad, 1) / W, h: el.offsetHeight / H };
    });
    setBoxes(out);
  }, [vpW, file.id, lines.length]); // eslint-disable-line
  useOverlay(full, () => setFull(false));
  useEffect(() => { setView({ s: 1, x: 0, y: 0 }); }, [full, file.id]);
  useEffect(() => {
    const el = vpRef.current; if (!el) return undefined;
    const ro = new ResizeObserver(() => setVpW(el.clientWidth)); ro.observe(el); setVpW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const pageH = vpW * ratio;
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const vpH = Math.round(full ? Math.max(200, winH - 64) : Math.min(pageH || 1, winH * 0.36));
  const fit = (v) => {
    const s = clamp(v.s, 1, 6);
    return { s, x: clamp(v.x, Math.min(0, vpW - vpW * s), 0), y: clamp(v.y, Math.min(0, vpH - pageH * s), 0) };
  };

  // bring the picked block into view
  useEffect(() => {
    if (!activeId || !pageH) return;
    const a = areas.get(activeId); if (!a || !a.rects.length) return;
    const x0 = Math.min(...a.rects.map((r) => r.x)), x1 = Math.max(...a.rects.map((r) => r.x + r.w));
    const y0 = Math.min(...a.rects.map((r) => r.y)), y1 = Math.max(...a.rects.map((r) => r.y + r.h));
    setView((v) => fit({ s: v.s, x: vpW / 2 - ((x0 + x1) / 2) * vpW * v.s, y: vpH / 2 - ((y0 + y1) / 2) * pageH * v.s }));
  }, [activeId, pageH, vpH]); // eslint-disable-line

  const zoomAt = (f, cx, cy) => setView((v) => { const s = clamp(v.s * f, 1, 6); return fit({ s, x: cx - (cx - v.x) * (s / v.s), y: cy - (cy - v.y) * (s / v.s) }); });
  const rel = (e) => { const r = vpRef.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e) => {
    try { vpRef.current.setPointerCapture(e.pointerId); } catch {}
    const pt = rel(e); ptrs.current.set(e.pointerId, pt);
    const v = viewRef.current;
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      gest.current = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ...v };
    } else gest.current = { type: 'pan', sx: pt.x, sy: pt.y, x0: v.x, y0: v.y, moved: false };
  };
  const move = (e) => {
    if (!ptrs.current.has(e.pointerId)) return;
    const pt = rel(e); ptrs.current.set(e.pointerId, pt);
    const g = gest.current; if (!g) return;
    if (g.type === 'pinch' && ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const s = clamp(g.s * d / g.d0, 1, 6);
      setView(fit({ s, x: m.x - ((g.m0.x - g.x) / g.s) * s, y: m.y - ((g.m0.y - g.y) / g.s) * s }));
    } else if (g.type === 'pan') {
      const dx = pt.x - g.sx, dy = pt.y - g.sy;
      if (Math.abs(dx) + Math.abs(dy) > 8) g.moved = true;
      if (g.moved) setView((v) => fit({ ...v, x: g.x0 + dx, y: g.y0 + dy }));
    }
  };
  const up = (e) => {
    ptrs.current.delete(e.pointerId);
    const g = gest.current;
    if (g && g.type === 'pan' && !g.moved) {
      const now = Date.now(), pt = { x: g.sx, y: g.sy }, prev = lastTap.current;
      if (prev && now - prev.t < 320 && Math.hypot(pt.x - prev.x, pt.y - prev.y) < 30) {
        lastTap.current = null;
        if (viewRef.current.s > 1.05) setView({ s: 1, x: 0, y: 0 }); else zoomAt(2.5, pt.x, pt.y);
      } else {
        lastTap.current = { t: now, ...pt };
        // which coloured area was tapped (the smallest one wins where they overlap)
        const v = viewRef.current; const px = (pt.x - v.x) / (vpW * v.s), py = (pt.y - v.y) / (pageH * v.s);
        let best = null, bestArea = Infinity;
        blocks.forEach((b) => { if (b.on === false) return; (areas.get(b.id) || { rects: [] }).rects.forEach((r) => {
          if (px >= r.x - 0.01 && px <= r.x + r.w + 0.01 && py >= r.y - 0.006 && py <= r.y + r.h + 0.006 && r.w * r.h < bestArea) { best = b.id; bestArea = r.w * r.h; }
        }); });
        if (best) onPick(best, 'map');
      }
    }
    if (g && g.type === 'pinch' && ptrs.current.size === 1) { const [p] = [...ptrs.current.values()]; const v = viewRef.current; gest.current = { type: 'pan', sx: p.x, sy: p.y, x0: v.x, y0: v.y, moved: true }; return; }
    if (!ptrs.current.size) gest.current = null;
  };

  const fs = (l) => Math.min(l.h * ratio * 100 * 0.85, ((l.w || 0.3) * 100) / (Math.max(String(l.text).length, 1) * 0.5)).toFixed(2) + 'cqw';
  const shown = blocks.map((b, n) => ({ b, n })).filter(({ b }) => b.on !== false);
  return (
    <div className={'rd-stage rd-map' + (full ? ' full' : '')} data-testid="block-map">
      <div className="rd-bar">
        {pageLabel && <span className="rd-map-page">{pageLabel}</span>}
        {file.data ? (
          <div className="rd-fade">
            <button className="rd-end" onClick={() => setFade(0)}>Photo</button>
            <input type="range" min="0" max="100" value={Math.round(fade * 100)} onChange={(e) => setFade(e.target.value / 100)} aria-label="Fade between the photo and the page text" />
            <button className="rd-end" onClick={() => setFade(1)}>Typed</button>
          </div>
        ) : <span className="rd-fade" />}
        <button className="rd-ic" onClick={() => setView({ s: 1, x: 0, y: 0 })} aria-label="Fit" disabled={view.s === 1 && !view.x && !view.y}><Icon name="fit" size={20} /></button>
        <button className="rd-ic" onClick={() => setFull(!full)} aria-label={full ? 'Close full screen' : 'Full screen'} data-testid="map-full"><Icon name={full ? 'x' : 'expand'} size={20} /></button>
      </div>
      <div ref={vpRef} className="rd-vp" style={{ height: vpH || undefined }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <div ref={pageRef} className="rd-page" style={{ paddingBottom: `${ratio * 100}%`, transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}>
          {file.data && <img className="rd-photo" src={file.data} alt="Original page" draggable="false" />}
          <div className="rd-typed" style={{ opacity: file.data ? fade : 1 }}>
            {(t.figures || []).map((f, i) => <div key={i} className="rd-fig" style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, ...(f.h < 0.04 ? { fontSize: Math.min(f.h * ratio * 100 * 0.85, (f.w * 100) / (Math.max(String(f.label || 'Picture').length, 1) * 0.5)).toFixed(2) + 'cqw', whiteSpace: 'nowrap', lineHeight: 1, borderWidth: 1, padding: 0 } : {}) }}><span>{f.label || 'Picture'}</span></div>)}
            {lines.map((l) => (
              <div key={l.id} data-lid={l.id} className={'rd-piece' + ((file.off || []).includes(l.id) ? ' off' : '') + (l.marks || []).map((m) => ' m-' + m).join('')}
                style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, fontSize: fs(l) }}>{l.text}</div>
            ))}
          </div>
          {shown.map(({ b, n }) => {
            const c = blockColor(n); const on = b.id === activeId;
            return (areas.get(b.id) || { rects: [] }).rects.map((r0, k) => {
              const m = boxes[r0.line];
              const r = m ? { x: m.x + m.w * r0.a, w: m.w * (r0.b - r0.a), y: m.y, h: m.h } : r0;
              return (
              <div key={b.id + k} className={'rd-area' + (on ? ' on' : '')} data-testid="area" data-bid={b.id}
                style={{ left: `${r.x * 100 - 0.2}%`, top: `${r.y * 100}%`, width: `${Math.max(r.w * 100 + 0.1, 0.5)}%`, height: `${r.h * 100}%`, borderColor: on ? c.line : c.soft, background: on ? c.fill : c.pale }} />
              );
            });
          })}
        </div>
      </div>
    </div>
  );
}

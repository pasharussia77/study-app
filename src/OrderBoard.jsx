import React, { useRef, useState } from 'react';

// "Put in order": a station of number buttons floats above the answers. Drag a number onto an answer
// (or tap a number, then tap an answer). Nothing is assigned until the number is let go over an answer.
// A number already on an answer can be dragged to another answer or back to the station.
export function OrderBoard({ options, place, setPlace }) {
  const total = options.length;
  const [sel, setSel] = useState(null); // number picked by tapping
  const [drag, setDrag] = useState(null); // { num, x, y, moved }
  const [over, setOver] = useState(null); // what is under the finger while dragging
  const start = useRef(null);

  const placedOn = (num) => options.find((o) => place[o] === num) ?? null;
  const free = Array.from({ length: total }, (_, i) => i + 1).filter((k) => placedOn(k) === null);

  // Put number `num` on answer `opt`; null takes it back to the station. The answer's old number goes back to the station too.
  const assign = (num, opt) => setPlace((p) => {
    const q = { ...p };
    Object.keys(q).forEach((k) => { if (q[k] === num) delete q[k]; });
    if (opt != null) q[opt] = num;
    return q;
  });

  const targetAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const b = el.closest('[data-drop]');
    if (b) return { opt: b.getAttribute('data-drop') };
    if (el.closest('[data-station]')) return { station: true };
    return null;
  };

  const down = (e, num) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    start.current = { num, x: e.clientX, y: e.clientY, moved: false };
    setDrag({ num, x: e.clientX, y: e.clientY, moved: false });
  };
  const move = (e) => {
    const s = start.current;
    if (!s) return;
    if (!s.moved && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 6) s.moved = true;
    setDrag({ num: s.num, x: e.clientX, y: e.clientY, moved: s.moved });
    setOver(s.moved ? targetAt(e.clientX, e.clientY) : null);
  };
  const up = (e) => {
    const s = start.current;
    start.current = null; setDrag(null); setOver(null);
    if (!s) return;
    if (!s.moved) { setSel(sel === s.num ? null : s.num); return; } // a tap picks the number
    const t = targetAt(e.clientX, e.clientY);
    if (t && t.opt != null) assign(s.num, t.opt);
    else if (t && t.station) assign(s.num, null);
    setSel(null);
  };
  const cancel = () => { start.current = null; setDrag(null); setOver(null); };

  // a plain function, not a component: the chip must stay mounted while it is dragged
  const chip = (num, small) => (
    <button key={num} type="button" className={'nchip' + (small ? ' small' : '') + (sel === num ? ' sel' : '') + (drag && drag.moved && drag.num === num ? ' lifted' : '')}
      data-testid={'chip-' + num} aria-label={`Number ${num}. Drag it onto an answer, or tap it and then tap an answer.`} aria-pressed={sel === num}
      onPointerDown={(e) => down(e, num)} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}
      onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(sel === num ? null : num); } }}>
      {num}
    </button>
  );

  const bubbleTap = (opt) => { if (sel != null) { assign(sel, opt); setSel(null); } };
  const stationTap = () => { if (sel != null && placedOn(sel) !== null) { assign(sel, null); setSel(null); } };

  return (
    <div className="order-board" role="group" aria-label="Put in order">
      <div className={'station' + (over && over.station ? ' over' : '')} data-station data-testid="station" onClick={stationTap}>
        <span className="station-label">Numbers</span>
        <div className="station-chips">
          {/* a number that has been placed leaves an empty placeholder, so the station keeps its shape */}
          {Array.from({ length: total }, (_, i) => i + 1).map((k) => (placedOn(k) === null ? chip(k) : <span key={k} className="nslot" data-testid={'slot-' + k} aria-label={`Number ${k} is placed`}>{k}</span>))}
        </div>
      </div>
      <div className="stack">
        {options.map((o) => {
          const num = place[o];
          const hasNum = num != null;
          return (
            <div key={o} className={'obub' + (hasNum ? ' has' : '') + (over && over.opt === o ? ' over' : '') + (sel != null ? ' armed' : '')} data-drop={o} data-testid="obub" onClick={() => bubbleTap(o)}>
              <span className="oslot">{hasNum ? chip(num, true) : <i className="oempty" aria-hidden="true" />}</span>
              <span className="opt-text">{o}</span>
            </div>
          );
        })}
        <p className="muted tiny center">Drag a number onto each answer, or tap a number and then an answer. Drag it back to move it.</p>
      </div>
      {drag && drag.moved && <div className="nchip ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">{drag.num}</div>}
    </div>
  );
}

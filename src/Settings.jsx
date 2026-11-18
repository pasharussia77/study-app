import React, { useEffect, useRef, useState } from 'react';
import { PALETTES, DEFAULT_THEME, BASE_HUE, MODES, applyTheme, cleanTheme } from './theme.js';
import { Icon } from './art.jsx';
import { ScreenHead } from './Session.jsx';
import { goUp } from './nav.js';
import { rerollCrack } from './Crack.jsx';

const clamp = (v) => Math.min(1, Math.max(0, v));
const r3 = (v) => Math.round(v * 1000) / 1000;

// A colour swatch for a palette: the original violet turned to the palette's hue.
const swatch = (p) => {
  const h = BASE_HUE + p.hue;
  return `linear-gradient(135deg, hsl(${h - 28} 85% 62%), hsl(${h} 80% 56%) 55%, hsl(${h + 34} 80% 68%))`;
};

export default function Settings({ profile, theme: initial, onChange }) {
  const [t, setT] = useState(() => cleanTheme(initial));
  const latest = useRef(t);
  const dirty = useRef(false);
  const timer = useRef(null);
  const pad = useRef(null);
  const dragging = useRef(false);
  const flush = useRef(onChange);
  flush.current = onChange;

  const update = (next) => {
    latest.current = next; dirty.current = true;
    setT(next); applyTheme(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { dirty.current = false; flush.current(latest.current); }, 500);
  };
  // Leaving the screen saves whatever was changed last.
  useEffect(() => () => { clearTimeout(timer.current); if (dirty.current) flush.current(latest.current); }, []);

  const fromPointer = (e) => {
    const r = pad.current.getBoundingClientRect();
    update({ ...latest.current, x: r3(clamp((e.clientX - r.left) / r.width)), y: r3(clamp((e.clientY - r.top) / r.height)) });
  };
  const onKey = (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    update({ ...latest.current, x: r3(clamp(latest.current.x + d[0])), y: r3(clamp(latest.current.y + d[1])) });
  };
  const atDefault = t.x === DEFAULT_THEME.x && t.y === DEFAULT_THEME.y;
  const pal = PALETTES.find((p) => p.id === t.palette) || PALETTES[0];

  return (
    <section className="settings">
      <ScreenHead onBack={goUp} backLabel="Back" icon={<span className="head-ic"><Icon name="gear" size={26} /></span>} title="Colors" />
      <p className="muted">Colors for {profile.name}. Drag the dot: left is black and white, right is bright color, up is a warm background, down is a cold one.</p>

      <div className="pad-wrap">
        <div ref={pad} className="pad" style={{ '--pal-h': BASE_HUE + pal.hue }} role="slider" tabIndex={0} aria-label="Color pad"
          aria-valuetext={`Color ${Math.round(t.x * 100)} percent, background ${t.y < 0.45 ? 'warm' : t.y > 0.55 ? 'cold' : 'neutral'}`}
          onKeyDown={onKey}
          onPointerDown={(e) => { pad.current.setPointerCapture(e.pointerId); dragging.current = true; fromPointer(e); }}
          onPointerMove={(e) => dragging.current && fromPointer(e)}
          onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }}>
          <span className="pad-label top">Warm background</span>
          <span className="pad-label bottom">Cold background</span>
          <span className="pad-label left">Black and white</span>
          <span className="pad-label right">Bright color</span>
          <span className="pad-axis h" aria-hidden="true" />
          <span className="pad-axis v" aria-hidden="true" />
          <span className="knob" style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }} aria-hidden="true" />
        </div>
      </div>

      <fieldset className="palettes">
        <legend>Palette</legend>
        <div className="pal-row">
          {PALETTES.map((p) => (
            <button key={p.id} className={'pal' + (p.id === t.palette ? ' on' : '')} onClick={() => update({ ...latest.current, palette: p.id })} aria-pressed={p.id === t.palette}>
              <span className="pal-dot" style={{ background: swatch(p) }}>{p.id === t.palette && <Icon name="check" size={20} />}</span>
              <span className="pal-name">{p.name}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="seg modes" aria-label="Screen">
        <legend>Screen</legend>
        {MODES.map((m) => (
          <button key={m.id} className={m.id === t.mode ? 'on' : ''} aria-pressed={m.id === t.mode} onClick={() => update({ ...latest.current, mode: m.id })} data-testid={'mode-' + m.id}>
            <Icon name={m.id === 'dark' ? 'moon' : m.id === 'light' ? 'sun' : 'phone'} size={20} />{m.name}
          </button>
        ))}
      </fieldset>

      <div className="crack-box">
        <div className="crack-head"><b>Cracked screen</b><span className="muted tiny">{t.crack === 0 ? 'None' : Math.round(t.crack * 100) + '%'}</span></div>
        <input type="range" min="0" max="100" step="1" value={Math.round(t.crack * 100)} aria-label="Cracked screen"
          onChange={(e) => update({ ...latest.current, crack: r3(Number(e.target.value) / 100) })} />
        <div className="crack-ends"><span>Clean</span><span>Shattered</span></div>
        {t.crack > 0 && <button className="link" onClick={rerollCrack}><Icon name="repeat" size={18} />Move the crack to a new spot</button>}
      </div>

      <button className="btn ghost" disabled={atDefault} onClick={() => update({ ...latest.current, x: DEFAULT_THEME.x, y: DEFAULT_THEME.y })}><Icon name="repeat" />Put the dot back</button>
      <p className="muted tiny center">Saved for {profile.name}. Only {profile.name} sees these colors. The family screens keep the default colors, with light or dark as last chosen on this phone.</p>
    </section>
  );
}

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { shuffle } from './parse.js';
import { LEVELS, makeMissed } from './missed.js';
import { contextFor } from './deck.js';
import { ScreenHead, PlayTop, StartFab } from './Session.jsx';
import { Icon, Scenery, TileArt } from './art.jsx';
import { diagLog } from './diag.js';
import { useOverlay, back } from './nav.js';
import { FitBody } from './Scroller.jsx';

// A pill with the word under a soft cover. A tap slides the cover off to the right; a long word slides it only past its first 2 letters first, then all the way.
function Pill({ seg, stage, onTap }) {
  const first = useRef(null);
  const [off, setOff] = useState(0);
  const measure = () => { const e = first.current; if (e) setOff(e.offsetLeft + e.offsetWidth); };
  useLayoutEffect(measure, [seg.gap]);
  useEffect(() => { if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure); }, [seg.gap]); // eslint-disable-line
  const word = seg.hint ? <><span ref={first} data-testid="hint">{seg.hint}</span><span>{seg.gap.slice(seg.hint.length)}</span></> : seg.gap;
  return (
    <button className="miss-pill" style={{ '--off': off + 'px' }} data-stage={stage} data-hintable={seg.hint ? 'true' : 'false'} onClick={onTap}
      aria-label={stage === 2 ? 'Hide the word' : stage === 1 ? 'Show the whole word' : seg.hint ? 'Show the first letters' : 'Show the word'} aria-pressed={stage === 2} data-testid="pill">
      <span className="word" aria-hidden={stage === 0}>{word}</span>
      <span className="cover" aria-hidden="true" />
    </button>
  );
}

// "What's Missed?": a whole line of the study material with some words under covers. Tap a pill to slide its cover away, tap again to cover it.
export default function Missed({ cards, projectId, onExit }) {
  const [phase, setPhase] = useState('setup');
  const [level, setLevel] = useState('easy');
  const [mix, setMix] = useState(false);
  const [order, setOrder] = useState([]);
  const [i, setI] = useState(0);
  const [shown, setShown] = useState({});
  useOverlay(phase !== 'setup', () => setPhase('setup'));

  // Lines with nothing to cover at this level (for example only a number at super easy) are left out.
  const usable = useMemo(() => cards.map((_, k) => k).filter((k) => makeMissed(cards[k], level, k).gaps > 0), [cards, level]);
  const begin = () => {
    if (!usable.length) return;
    diagLog(projectId, { type: 'session_start', mode: "what's missed", level, shuffle: mix, deckSize: usable.length });
    setOrder(mix ? shuffle([...usable]) : [...usable]);
    setI(0); setShown({}); setPhase('play');
  };
  const card = phase === 'play' ? cards[order[i]] : null;
  const made = useMemo(() => (card ? makeMissed(card, level, order[i]) : null), [card, level, order, i]);
  const go = (n) => { setShown({}); if (n >= order.length) setPhase('done'); else setI(Math.max(0, n)); };

  if (phase === 'setup') return (
    <section>
      <ScreenHead onBack={onExit} title="What&apos;s Missed?" />
      <StartFab disabled={!usable.length} onClick={begin} />
      <fieldset className="seg stack-seg" aria-label="Difficulty">
        <legend>Difficulty</legend>
        {LEVELS.map((l) => <button key={l.id} className={level === l.id ? 'on' : ''} onClick={() => setLevel(l.id)} data-testid={'level-' + l.id}>{l.label}<small className="lvl-hint">{l.hint}</small></button>)}
      </fieldset>
      <label className="switch">
        <Icon name="shuffle" />
        <span>Shuffle the cards</span>
        <input type="checkbox" checked={mix} onChange={(e) => setMix(e.target.checked)} />
      </label>
      <p className="muted tiny">{usable.length} line{usable.length === 1 ? '' : 's'} from your selected blocks, in page order.</p>
    </section>
  );

  if (phase === 'done') return (
    <section className="done">
      <Scenery kind="lake" />
      <h1>All done</h1>
      <p className="lead">You went through {order.length} line{order.length === 1 ? '' : 's'}.</p>
      <div className="stack">
        <button className="btn primary" onClick={begin}><Icon name="repeat" />Go again</button>
        <button className="btn ghost" onClick={onExit}>Back to project</button>
      </div>
    </section>
  );

  const gapIdx = made.segs.map((s, n) => (s.gap !== undefined ? n : -1)).filter((n) => n >= 0);
  const allOpen = gapIdx.every((n) => shown[n] === 2);
  const setAll = (v) => setShown(Object.fromEntries(gapIdx.map((n) => [n, v ? 2 : 0])));
  const tap = (n, s) => setShown((x) => ({ ...x, [n]: x[n] === 2 ? 0 : x[n] === 1 ? 2 : s.hint ? 1 : 2 }));
  const ctx = contextFor({ context: card.context, prompt: card.text, answer: '' });
  return (
    <section className="play on-scene">
      <Scenery kind="peaks" />
      <PlayTop onExit={back} index={i} total={order.length} title="What's Missed?" />
      <div className="kindrow">
        <span className="kind" data-testid="kind">{LEVELS.find((l) => l.id === level).label}</span>
        <span className="flip-hint"><Icon name="tap" size={16} />Tap a pill</span>
      </div>
      <div className="flip missed-card" data-testid="card">
        <div className="face face-front">
          {ctx && <span className="card-ctx" data-testid="card-ctx">{ctx}</span>}
          <FitBody key={'m' + order[i] + level} dep={i + ':' + level}>
            <b className="miss-line">
              {made.segs.map((s, n) => (s.gap === undefined ? <span key={n}>{s.text}</span> : <Pill key={n} seg={s} stage={shown[n] || 0} onTap={() => tap(n, s)} />))}
            </b>
          </FitBody>
        </div>
      </div>
      {made.gaps >= 2 && <button className="btn ghost" onClick={() => setAll(!allOpen)} data-testid="review-all"><Icon name="eye" />{allOpen ? 'Hide all' : 'Review all'}</button>}
      <div className="row nav">
        <button className="btn ghost" disabled={i === 0} onClick={() => go(i - 1)}><Icon name="left" />Back</button>
        <button className="btn primary" onClick={() => go(i + 1)} data-testid="next">{i + 1 >= order.length ? 'Finish' : 'Next'}<Icon name="right" /></button>
      </div>
    </section>
  );
}

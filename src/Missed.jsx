import React, { useMemo, useState } from 'react';
import { shuffle } from './parse.js';
import { LEVELS, makeMissed } from './missed.js';
import { ScreenHead, PlayTop, StartFab } from './Session.jsx';
import { Icon, Scenery, TileArt } from './art.jsx';
import { diagLog } from './diag.js';
import { useOverlay, back } from './nav.js';
import { FitBody } from './Scroller.jsx';

// "What's Missed?": a whole line of the study material with some words left as dotted pills. Tap a pill to see its word, tap again to hide it.
export default function Missed({ cards, projectId, onExit }) {
  const [phase, setPhase] = useState('setup');
  const [level, setLevel] = useState('easy');
  const [mix, setMix] = useState(false);
  const [order, setOrder] = useState([]);
  const [i, setI] = useState(0);
  const [shown, setShown] = useState({});
  useOverlay(phase !== 'setup', () => setPhase('setup'));

  const begin = () => {
    if (!cards.length) return;
    diagLog(projectId, { type: 'session_start', mode: "what's missed", level, shuffle: mix, deckSize: cards.length });
    setOrder(mix ? shuffle(cards.map((_, k) => k)) : cards.map((_, k) => k));
    setI(0); setShown({}); setPhase('play');
  };
  const card = phase === 'play' ? cards[order[i]] : null;
  const made = useMemo(() => (card ? makeMissed(card, level, order[i]) : null), [card, level, order, i]);
  const go = (n) => { setShown({}); if (n >= order.length) setPhase('done'); else setI(Math.max(0, n)); };

  if (phase === 'setup') return (
    <section>
      <ScreenHead onBack={onExit} title="What&apos;s Missed?" />
      <StartFab disabled={!cards.length} onClick={begin} />
      <fieldset className="seg stack-seg" aria-label="Difficulty">
        <legend>Difficulty</legend>
        {LEVELS.map((l) => <button key={l.id} className={level === l.id ? 'on' : ''} onClick={() => setLevel(l.id)} data-testid={'level-' + l.id}>{l.label}<small className="lvl-hint">{l.hint}</small></button>)}
      </fieldset>
      <label className="switch">
        <Icon name="shuffle" />
        <span>Shuffle the cards</span>
        <input type="checkbox" checked={mix} onChange={(e) => setMix(e.target.checked)} />
      </label>
      <p className="muted tiny">{cards.length} line{cards.length === 1 ? '' : 's'} from your selected blocks, in page order.</p>
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
  const allOpen = gapIdx.every((n) => shown[n]);
  const setAll = (v) => setShown(Object.fromEntries(gapIdx.map((n) => [n, v])));
  return (
    <section className="play on-scene">
      <Scenery kind="peaks" />
      <PlayTop onExit={back} index={i} total={order.length} title="What's Missed?" />
      <div className="kindrow">
        <span className="kind" data-testid="kind">{LEVELS.find((l) => l.id === level).label}</span>
        <span className="flip-hint"><Icon name="tap" size={16} />Tap a dotted pill</span>
      </div>
      <div className="flip missed-card" data-testid="card">
        <div className="face face-front">
          <FitBody key={'m' + order[i] + level} dep={i + ':' + level}>
            <b className="miss-line">
              {made.segs.map((s, n) => s.gap === undefined ? <span key={n}>{s.text}</span> : (
                <button key={n} className={'miss-pill' + (shown[n] ? ' open' : '')} onClick={() => setShown((x) => ({ ...x, [n]: !x[n] }))} aria-label={shown[n] ? 'Hide the word' : 'Show the word'} aria-pressed={!!shown[n]} data-testid="pill">
                  {shown[n] ? s.gap : <span className="dots" style={{ width: Math.min(9, Math.max(2.4, s.gap.length * 0.62)) + 'em' }} />}
                </button>
              ))}
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

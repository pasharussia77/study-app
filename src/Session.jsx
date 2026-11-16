import React, { useEffect, useRef, useState } from 'react';
import { backend } from './firebase.js';
import { summarize, pickChoices } from './stats.js';
import { deckTypes } from './deck.js';
import { TYPE_LABEL } from './items.js';
import { Icon, Ring, Scenery } from './art.jsx';

export function useStats(code, projectId, cards) {
  const [items, setItems] = useState({});
  const ref = useRef({});
  useEffect(() => backend.watchStats(code, projectId, (x) => { ref.current = x; setItems(x); }), [code, projectId]);
  return { items, itemsRef: ref, sum: summarize(cards, items), sumNow: () => summarize(cards, ref.current) };
}

// How much of the deck was answered right the last time each card came up.
export const masteryOf = (sum) => (sum.total ? (sum.correct / sum.total) * 100 : 0);

function Tally({ sum, total = false }) {
  return (
    <ul className="tally">
      <li className="ok"><span className="mark"><Icon name="check" size={16} /></span><b>{sum.correct}</b> Correct</li>
      <li className="bad"><span className="mark"><Icon name="x" size={16} /></span><b>{sum.incorrect}</b> Incorrect</li>
      <li className="rest"><span className="mark" /><b>{sum.remainingCount}</b> Remaining</li>
      {total && <li className="all"><span className="mark none" /><b>{sum.total}</b> Total</li>}
    </ul>
  );
}

export function StatsSheet({ sum, onClose }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="stats-sheet" role="dialog" aria-label="Your progress" onClick={(e) => e.stopPropagation()}>
        <h2><Icon name="chart" /> Your progress</h2>
        <div className="progress-body">
          <Ring percent={masteryOf(sum)} />
          <Tally sum={sum} total />
        </div>
        <p className="muted tiny center">{sum.covered} of {sum.total} covered so far</p>
        <button className="btn primary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// The progress card at the top of a project.
export function StatsStrip({ sum }) {
  return (
    <div className="card progress-card" aria-label="Progress">
      <div className="card-head"><b>Project progress</b><span className="muted tiny">{sum.covered}/{sum.total} covered</span></div>
      <div className="progress-body">
        <Ring percent={masteryOf(sum)} size={118} />
        <Tally sum={sum} />
      </div>
    </div>
  );
}

const PICK_ICON = { all: 'layers', remaining: 'circle', missed: 'target' };
export function CardPicker({ sum, value, onChange }) {
  const choices = pickChoices(sum);
  if (choices.length < 2) return null;
  return (
    <fieldset className="seg stack-seg" aria-label="Which cards">
      <legend>Which cards</legend>
      {choices.map((c) => <button key={c.id} className={value === c.id ? 'on' : ''} onClick={() => onChange(c.id)}><Icon name={PICK_ICON[c.id] || 'layers'} />{c.label}</button>)}
    </fieldset>
  );
}

export function TypePicker({ deck, value, onChange }) {
  const counts = deckTypes(deck);
  const kinds = Object.keys(counts);
  if (kinds.length < 2) return null;
  return (
    <fieldset className="seg stack-seg" aria-label="Which kind">
      <legend>Which kind</legend>
      <button className={value === 'all' ? 'on' : ''} onClick={() => onChange('all')}>{`All kinds (${deck.length})`}</button>
      {kinds.map((k) => <button key={k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{`${TYPE_LABEL[k]} (${counts[k]})`}</button>)}
    </fieldset>
  );
}

// Title bar for the set-up screens: round back button, small picture, title.
export function ScreenHead({ onBack, icon, title, backLabel = 'Back' }) {
  return (
    <header className="head">
      <button className="back round" onClick={onBack} aria-label={backLabel}><Icon name="left" /><span className="sr">{backLabel}</span></button>
      {icon}
      <h1>{title}</h1>
    </header>
  );
}

// The Start button on the set-up screens: it floats at the top right and stays there while the page scrolls.
export function StartFab({ disabled, onClick, icon = 'play' }) {
  return <button className="btn primary start-fab" data-testid="start" disabled={disabled} onClick={onClick}><Icon name={icon} size={20} />Start</button>;
}

// Top of a study round: exit, how far along, and the stats button.
export function PlayTop({ onExit, index, total, onStats, title }) {
  return (
    <>
      <header className="play-top">
        <button className="back round" onClick={onExit}><Icon name="left" /><span className="sr">Exit</span></button>
        <span className="play-title">{title}</span>
        <button className="chip" onClick={onStats}><Icon name="chart" size={18} />Stats</button>
      </header>
      <div className="track">
        <span className="count" data-testid="counter">{index + 1} / {total}</span>
        <div className="bar" role="progressbar" aria-valuemin="0" aria-valuemax={total} aria-valuenow={index + 1}><span style={{ width: `${((index + 1) / total) * 100}%` }} /></div>
      </div>
    </>
  );
}

export function RoundDone({ round, sum, onPractice, onReset, onExit }) {
  const next = sum.incorrect > 0
    ? <button className="btn primary" onClick={() => onPractice('missed')}><Icon name="target" />Practice missed ({sum.incorrect})</button>
    : sum.remainingCount > 0
      ? <button className="btn primary" onClick={() => onPractice('remaining')}><Icon name="play" />Continue with the rest ({sum.remainingCount})</button>
      : <button className="btn primary" onClick={onReset}><Icon name="repeat" />Start over</button>;
  return (
    <section className="done">
      <Scenery kind="lake" />
      <h1>{sum.mastered ? 'All mastered' : 'Round complete'}</h1>
      <p className="lead">
        {sum.mastered
          ? `You got all ${sum.total} cards right.`
          : `This round: ${round.right} right, ${round.wrong} missed.`}
      </p>
      <div className="card progress-card">
        <div className="progress-body">
          <Ring percent={masteryOf(sum)} />
          <Tally sum={sum} total />
        </div>
      </div>
      <div className="stack">
        {next}
        <button className="btn ghost" onClick={onExit}>Back to project</button>
      </div>
    </section>
  );
}

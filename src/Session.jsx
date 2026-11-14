import React, { useEffect, useRef, useState } from 'react';
import { backend } from './firebase.js';
import { summarize, pickChoices } from './stats.js';
import { deckTypes } from './deck.js';
import { TYPE_LABEL } from './items.js';

export function useStats(code, projectId, cards) {
  const [items, setItems] = useState({});
  const ref = useRef({});
  useEffect(() => backend.watchStats(code, projectId, (x) => { ref.current = x; setItems(x); }), [code, projectId]);
  return { items, itemsRef: ref, sum: summarize(cards, items), sumNow: () => summarize(cards, ref.current) };
}

export function StatsSheet({ sum, onClose }) {
  const rows = [
    ['Total questions', sum.total], ['Covered', sum.covered], ['Remaining', sum.remainingCount],
    ['Correct', sum.correct], ['Incorrect', sum.incorrect]
  ];
  return (
    <div className="overlay" onClick={onClose}>
      <div className="stats-sheet" role="dialog" aria-label="Your progress" onClick={(e) => e.stopPropagation()}>
        <h2>Your progress</h2>
        <dl className="stats-grid">
          {rows.map(([k, v]) => <div key={k} className={'stat ' + k.toLowerCase().split(' ')[0]}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
        <button className="btn primary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export function StatsStrip({ sum }) {
  return (
    <div className="strip" aria-label="Progress">
      <span><b>{sum.covered}</b>/{sum.total} covered</span>
      <span className="ok"><b>{sum.correct}</b> correct</span>
      <span className="bad"><b>{sum.incorrect}</b> incorrect</span>
    </div>
  );
}

export function CardPicker({ sum, value, onChange }) {
  const choices = pickChoices(sum);
  if (choices.length < 2) return null;
  return (
    <fieldset className="seg stack-seg" aria-label="Which cards">
      <legend>Which cards</legend>
      {choices.map((c) => <button key={c.id} className={value === c.id ? 'on' : ''} onClick={() => onChange(c.id)}>{c.label}</button>)}
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

export function RoundDone({ round, sum, onPractice, onReset, onExit }) {
  const next = sum.incorrect > 0
    ? <button className="btn primary" onClick={() => onPractice('missed')}>Practice missed ({sum.incorrect})</button>
    : sum.remainingCount > 0
      ? <button className="btn primary" onClick={() => onPractice('remaining')}>Continue with the rest ({sum.remainingCount})</button>
      : <button className="btn primary" onClick={onReset}>Start over</button>;
  return (
    <section className="done">
      <h1>{sum.mastered ? 'All mastered' : 'Round complete'}</h1>
      <p className="lead">
        {sum.mastered
          ? `You got all ${sum.total} cards right.`
          : `This round: ${round.right} right, ${round.wrong} missed.`}
      </p>
      <div className="stats-grid compact">
        <div className="stat covered"><dt>Covered</dt><dd>{sum.covered}/{sum.total}</dd></div>
        <div className="stat correct"><dt>Correct</dt><dd>{sum.correct}</dd></div>
        <div className="stat incorrect"><dt>Incorrect</dt><dd>{sum.incorrect}</dd></div>
      </div>
      <div className="stack">
        {next}
        <button className="btn ghost" onClick={onExit}>Back to project</button>
      </div>
    </section>
  );
}

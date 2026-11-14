import React, { useRef, useState } from 'react';
import { backend } from './firebase.js';
import { shuffle } from './parse.js';
import { cardKey, defaultPick, queueFor } from './stats.js';
import { useStats, StatsSheet, CardPicker, RoundDone } from './Session.jsx';

export default function Flashcards({ cards, code, projectId, onExit }) {
  const { sum, sumNow } = useStats(code, projectId, cards);
  const [phase, setPhase] = useState('setup');
  const [first, setFirst] = useState('term');
  const [mix, setMix] = useState(true);
  const [pick, setPick] = useState(null);
  const [deck, setDeck] = useState([]);
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [round, setRound] = useState({ right: 0, wrong: 0 });
  const [showStats, setShowStats] = useState(false);
  const chosen = pick || defaultPick(sum);

  const begin = (kind) => {
    const q = queueFor(kind, cards, sumNow());
    if (!q.length) return;
    setDeck(mix ? shuffle(q) : q); setI(0); setFlipped(false); setRound({ right: 0, wrong: 0 }); setPhase('play');
  };
  const reset = async () => { await backend.resetStats(code, projectId); begin('all'); };
  const mark = (right) => {
    backend.saveResult(code, projectId, cardKey(deck[i]), right).catch(() => {});
    setRound((r) => ({ right: r.right + (right ? 1 : 0), wrong: r.wrong + (right ? 0 : 1) }));
    if (i + 1 < deck.length) { setFlipped(false); setI(i + 1); } else setPhase('done');
  };

  if (phase === 'setup') return (
    <section>
      <button className="back" onClick={onExit}><span aria-hidden="true">‹</span> Back</button>
      <h1>Flashcards</h1>
      <fieldset className="seg" aria-label="Show first">
        <legend>Show first</legend>
        <button className={first === 'term' ? 'on' : ''} onClick={() => setFirst('term')}>Word</button>
        <button className={first === 'definition' ? 'on' : ''} onClick={() => setFirst('definition')}>Definition</button>
      </fieldset>
      <CardPicker sum={sum} value={chosen} onChange={setPick} />
      <label className="switch">
        <input type="checkbox" checked={mix} onChange={(e) => setMix(e.target.checked)} />
        <span>Shuffle the cards</span>
      </label>
      <button className="btn primary bottom" onClick={() => begin(chosen)}>Start</button>
    </section>
  );

  if (phase === 'done') return <RoundDone round={round} sum={sum} onPractice={begin} onReset={reset} onExit={onExit} />;

  const c = deck[i];
  const front = first === 'term' ? c.term : c.definition;
  const back = first === 'term' ? c.definition : c.term;
  const name = (k) => (k === 'term' ? 'word' : 'definition');
  const other = first === 'term' ? 'definition' : 'term';
  return (
    <section className="play">
      <header className="play-top">
        <button className="back" onClick={() => setPhase('setup')}><span aria-hidden="true">‹</span> Exit</button>
        <span className="count" data-testid="counter">{i + 1} / {deck.length}</span>
        <button className="chip" onClick={() => setShowStats(true)}>Stats</button>
      </header>
      <div className="bar" role="progressbar" aria-valuemin="0" aria-valuemax={deck.length} aria-valuenow={i + 1}><span style={{ width: `${((i + 1) / deck.length) * 100}%` }} /></div>
      <button className={'flip' + (flipped ? ' flipped' : '')} onClick={() => setFlipped(!flipped)} aria-label={flipped ? 'Show front' : 'Show back'} data-testid="card">
        <span className="face face-front"><small>{name(first)}</small><b>{front}</b><em>Tap to flip</em></span>
        <span className="face face-back"><small>{name(other)}</small><b>{back}</b></span>
      </button>
      <div className="row nav">
        <button className="btn miss" onClick={() => mark(false)}>Missed it</button>
        <button className="btn primary" onClick={() => mark(true)}>Got it</button>
      </div>
      {showStats && <StatsSheet sum={sum} onClose={() => setShowStats(false)} />}
    </section>
  );
}

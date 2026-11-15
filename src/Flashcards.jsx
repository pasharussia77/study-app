import React, { useState } from 'react';
import { backend } from './firebase.js';
import { shuffle } from './parse.js';
import { defaultPick, queueFor } from './stats.js';
import { cardFaces } from './deck.js';
import { useStats, StatsSheet, CardPicker, TypePicker, RoundDone, ScreenHead, PlayTop } from './Session.jsx';
import { Icon, Scenery, TileArt } from './art.jsx';
import { diagLog } from './diag.js';
import { useOverlay, back } from './nav.js';

export default function Flashcards({ cards, code, projectId, onExit }) {
  const { sum, sumNow } = useStats(code, projectId, cards);
  const [phase, setPhase] = useState('setup');
  const [first, setFirst] = useState('term');
  const [mix, setMix] = useState(true);
  const [pick, setPick] = useState(null);
  const [kind, setKind] = useState('all');
  const [deck, setDeck] = useState([]);
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [round, setRound] = useState({ right: 0, wrong: 0 });
  const [showStats, setShowStats] = useState(false);
  useOverlay(phase !== 'setup', () => setPhase('setup'));
  useOverlay(showStats, () => setShowStats(false));
  const chosen = pick || defaultPick(sum);
  const hasTerm = cards.some((c) => c.type === 'term');
  const filtered = (which, s) => queueFor(which, cards, s).filter((c) => kind === 'all' || c.type === kind);
  const available = filtered(chosen, sum).length;

  const begin = (which) => {
    const q = filtered(which, sumNow());
    if (!q.length) return;
    diagLog(projectId, { type: 'session_start', mode: 'flashcards', shows: hasTerm ? (first === 'term' ? 'word first' : 'definition first') : 'question first', pick: which + (kind !== 'all' ? ', only ' + kind : ''), shuffle: mix, deckSize: q.length });
    setDeck(mix ? shuffle(q) : q); setI(0); setFlipped(false); setRound({ right: 0, wrong: 0 }); setPhase('play');
  };
  const reset = async () => { await backend.resetStats(code, projectId); setKind('all'); begin('all'); };
  const mark = (right) => {
    const c0 = deck[i];
    const f0 = cardFaces(c0, first);
    backend.saveResult(code, projectId, c0.key, right).catch(() => {});
    diagLog(projectId, { type: 'answer', mode: 'flashcards (' + c0.type + ')', question: f0.ft, expected: f0.bt, correct: right });
    if (i + 1 >= deck.length) diagLog(projectId, { type: 'round_done', mode: 'flashcards', right: round.right + (right ? 1 : 0), wrong: round.wrong + (right ? 0 : 1) });
    setRound((r) => ({ right: r.right + (right ? 1 : 0), wrong: r.wrong + (right ? 0 : 1) }));
    if (i + 1 < deck.length) { setFlipped(false); setI(i + 1); } else setPhase('done');
  };

  if (phase === 'setup') return (
    <section>
      <ScreenHead onBack={onExit} icon={<TileArt kind="flash" />} title="Flashcards" />
      {hasTerm && (
        <fieldset className="seg" aria-label="Show first">
          <legend>Show first (for words)</legend>
          <button className={first === 'term' ? 'on' : ''} onClick={() => setFirst('term')}>Word</button>
          <button className={first === 'definition' ? 'on' : ''} onClick={() => setFirst('definition')}>Definition</button>
        </fieldset>
      )}
      <TypePicker deck={cards} value={kind} onChange={setKind} />
      <CardPicker sum={sum} value={chosen} onChange={setPick} />
      <label className="switch">
        <Icon name="shuffle" />
        <span>Shuffle the cards</span>
        <input type="checkbox" checked={mix} onChange={(e) => setMix(e.target.checked)} />
      </label>
      {available === 0 && <p className="hint">Nothing to study with this selection.</p>}
      <button className="btn primary bottom" disabled={available === 0} onClick={() => begin(chosen)}><Icon name="play" />Start</button>
    </section>
  );

  if (phase === 'done') return <RoundDone round={round} sum={sum} onPractice={begin} onReset={reset} onExit={onExit} />;

  const f = cardFaces(deck[i], first);
  return (
    <section className="play on-scene">
      <Scenery kind="peaks" />
      <PlayTop onExit={back} index={i} total={deck.length} onStats={() => setShowStats(true)} title="Flashcards" />
      <button className={'flip' + (flipped ? ' flipped' : '')} onClick={() => setFlipped(!flipped)} aria-label={flipped ? 'Show front' : 'Show back'} data-testid="card">
        <span className="face face-front">
          <small>{f.fl}</small><b>{f.ft}</b>
          {f.extra && <ul className="face-choices">{f.extra.map((x) => <li key={x}>{x}</li>)}</ul>}
          <em><Icon name="tap" size={18} />Tap to flip</em>
        </span>
        <span className="face face-back"><small>{f.bl}</small><b>{f.bt}</b><em><Icon name="swap" size={18} />Tap to flip back</em></span>
      </button>
      {deck[i].type === 'term' && (
        <button className="link swap" onClick={() => { setFirst(first === 'term' ? 'definition' : 'term'); setFlipped(false); }}>
          <Icon name="swap" size={18} />Showing {first === 'term' ? 'word' : 'definition'} first · Swap sides
        </button>
      )}
      <div className="row nav">
        <button className="btn miss" onClick={() => mark(false)}><Icon name="x" />Missed it</button>
        <button className="btn primary" onClick={() => mark(true)}><Icon name="check" />Got it</button>
      </div>
      {showStats && <StatsSheet sum={sum} onClose={() => setShowStats(false)} />}
    </section>
  );
}

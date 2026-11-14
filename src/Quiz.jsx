import React, { useEffect, useMemo, useRef, useState } from 'react';
import { backend } from './firebase.js';
import { shuffle } from './parse.js';
import { cardKey, defaultPick, queueFor, isCorrect, normalize } from './stats.js';
import { useStats, StatsSheet, CardPicker, RoundDone } from './Session.jsx';

export default function Quiz({ cards, code, projectId, onExit }) {
  const { sum, sumNow } = useStats(code, projectId, cards);
  const [phase, setPhase] = useState('setup');
  const [ask, setAsk] = useState('term'); // what you are shown
  const [how, setHow] = useState('type');
  const [mix, setMix] = useState(true);
  const [pick, setPick] = useState(null);
  const [deck, setDeck] = useState([]);
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState(null); // { right, given, overridden }
  const [round, setRound] = useState({ right: 0, wrong: 0 });
  const [showStats, setShowStats] = useState(false);
  const inputRef = useRef(null);
  const chosen = pick || defaultPick(sum);
  const canChoose = cards.length >= 2;
  const mode = canChoose ? how : 'type';

  const begin = (kind) => {
    const q = queueFor(kind, cards, sumNow());
    if (!q.length) return;
    setDeck(mix ? shuffle(q) : q); setI(0); setAnswer(''); setResult(null);
    setRound({ right: 0, wrong: 0 }); setPhase('play');
  };
  const reset = async () => { await backend.resetStats(code, projectId); begin('all'); };

  const c = deck[i];
  const shown = c && (ask === 'term' ? c.term : c.definition);
  const expected = c && (ask === 'term' ? c.definition : c.term);

  const options = useMemo(() => {
    if (!c || mode !== 'choice') return [];
    const pool = cards.map((x) => (ask === 'term' ? x.definition : x.term)).filter((t) => normalize(t) !== normalize(expected));
    const uniq = [...new Map(pool.map((t) => [normalize(t), t])).values()];
    return shuffle([expected, ...shuffle(uniq).slice(0, 3)]);
    // eslint-disable-next-line
  }, [i, deck, mode, ask]);

  useEffect(() => { if (phase === 'play' && mode === 'type' && !result) inputRef.current?.focus(); }, [phase, i, mode, result]);

  const record = (right, fix = false) => backend.saveResult(code, projectId, cardKey(c), right, fix).catch(() => {});
  const submitTyped = () => {
    if (!answer.trim() || result) return;
    const right = isCorrect(answer, expected);
    setResult({ right, given: answer.trim() });
    record(right);
    setRound((r) => ({ right: r.right + (right ? 1 : 0), wrong: r.wrong + (right ? 0 : 1) }));
  };
  const choose = (opt) => {
    if (result) return;
    const right = normalize(opt) === normalize(expected);
    setResult({ right, given: opt });
    record(right);
    setRound((r) => ({ right: r.right + (right ? 1 : 0), wrong: r.wrong + (right ? 0 : 1) }));
  };
  const override = () => {
    setResult({ ...result, right: true, overridden: true });
    record(true, true);
    setRound((r) => ({ right: r.right + 1, wrong: r.wrong - 1 }));
  };
  const next = () => {
    if (i + 1 < deck.length) { setI(i + 1); setAnswer(''); setResult(null); } else setPhase('done');
  };

  if (phase === 'setup') return (
    <section>
      <button className="back" onClick={onExit}><span aria-hidden="true">‹</span> Back</button>
      <h1>Written quiz</h1>
      <fieldset className="seg" aria-label="Question shows">
        <legend>Question shows</legend>
        <button className={ask === 'term' ? 'on' : ''} onClick={() => setAsk('term')}>Word</button>
        <button className={ask === 'definition' ? 'on' : ''} onClick={() => setAsk('definition')}>Definition</button>
      </fieldset>
      {canChoose && (
        <fieldset className="seg" aria-label="Answer by">
          <legend>Answer by</legend>
          <button className={how === 'type' ? 'on' : ''} onClick={() => setHow('type')}>Typing</button>
          <button className={how === 'choice' ? 'on' : ''} onClick={() => setHow('choice')}>Choosing</button>
        </fieldset>
      )}
      <CardPicker sum={sum} value={chosen} onChange={setPick} />
      <label className="switch">
        <input type="checkbox" checked={mix} onChange={(e) => setMix(e.target.checked)} />
        <span>Shuffle the questions</span>
      </label>
      <button className="btn primary bottom" onClick={() => begin(chosen)}>Start</button>
    </section>
  );

  if (phase === 'done') return <RoundDone round={round} sum={sum} onPractice={begin} onReset={reset} onExit={onExit} />;

  const prompt = ask === 'term' ? 'What is the definition of' : 'Which word matches this definition?';
  return (
    <section className="play">
      <header className="play-top">
        <button className="back" onClick={() => setPhase('setup')}><span aria-hidden="true">‹</span> Exit</button>
        <span className="count" data-testid="counter">{i + 1} / {deck.length}</span>
        <button className="chip" onClick={() => setShowStats(true)}>Stats</button>
      </header>
      <div className="bar" role="progressbar" aria-valuemin="0" aria-valuemax={deck.length} aria-valuenow={i + 1}><span style={{ width: `${((i + 1) / deck.length) * 100}%` }} /></div>
      <div className="question">
        <small>{prompt}{ask === 'term' ? '…' : ''}</small>
        <b data-testid="question">{shown}</b>
      </div>

      {mode === 'type' && !result && (
        <div className="stack">
          <input ref={inputRef} className="big-input" value={answer} onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitTyped()} placeholder="Type your answer"
            autoCapitalize="none" autoCorrect="off" spellCheck="false" aria-label="Your answer" />
          <button className="btn primary" disabled={!answer.trim()} onClick={submitTyped}>Check</button>
        </div>
      )}

      {mode === 'choice' && (
        <div className="stack" role="group" aria-label="Answer choices">
          {options.map((o) => {
            const isRight = normalize(o) === normalize(expected);
            const cls = !result ? '' : isRight ? ' right' : o === result.given ? ' wrong' : ' dim';
            return <button key={o} className={'opt' + cls} onClick={() => choose(o)} disabled={!!result && !isRight && o !== result.given}>{o}</button>;
          })}
        </div>
      )}

      {result && (
        <div className={'feedback ' + (result.right ? 'good' : 'bad')} role="status" data-testid="feedback">
          <b>{result.overridden ? 'Counted as correct' : result.right ? 'Correct' : 'Not quite'}</b>
          {!result.right && mode === 'type' && <p className="given">You wrote: {result.given}</p>}
          {(!result.right || result.given.trim() !== expected) && <p className="answer-line">Answer: <b>{expected}</b></p>}
          <div className="row">
            {!result.right && mode === 'type' && <button className="btn ghost" onClick={override}>I was right</button>}
            <button className="btn primary" onClick={next} data-testid="next">{i + 1 < deck.length ? 'Next' : 'Finish'}</button>
          </div>
        </div>
      )}
      {showStats && <StatsSheet sum={sum} onClose={() => setShowStats(false)} />}
    </section>
  );
}

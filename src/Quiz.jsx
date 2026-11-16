import React, { useEffect, useMemo, useRef, useState } from 'react';
import { backend } from './firebase.js';
import { shuffle } from './parse.js';
import { defaultPick, queueFor, isCorrect, normalize } from './stats.js';
import { isChoiceOnly, withNumber } from './deck.js';
import { useStats, StatsSheet, CardPicker, TypePicker, RoundDone, ScreenHead, PlayTop } from './Session.jsx';
import { Icon, Scenery, TileArt } from './art.jsx';
import { diagLog } from './diag.js';
import { useOverlay, back } from './nav.js';

// How one question is asked: what is shown, what counts as right, and the choices if any.
function plan(c, cards, ask, how) {
  if (c.type === 'multi') return { mode: 'multi', shown: withNumber(c, c.prompt), expected: c.answers.join('; '), label: 'Select all that apply', options: shuffle(c.choices), answers: c.answers };
  if (c.type === 'order') {
    let options = shuffle(c.choices);
    if (options.every((o, k) => o === c.sequence[k])) options = [...options.slice(1), options[0]]; // never start already in order
    return { mode: 'order', shown: withNumber(c, c.prompt), expected: c.sequence.map((t, k) => `${k + 1}. ${t}`).join('; '), label: 'Put these in order', options, sequence: c.sequence };
  }
  if (isChoiceOnly(c)) {
    return { mode: 'choice', shown: withNumber(c, c.prompt), expected: c.answer, label: c.type === 'tf' ? 'True or false?' : 'Choose the correct answer', options: c.type === 'tf' ? c.choices : shuffle(c.choices) };
  }
  const reversed = c.type === 'term' && ask === 'definition';
  const shown = withNumber(c, reversed ? c.definition : c.prompt);
  const expected = reversed ? c.term : c.answer;
  const label = c.type === 'qa' ? 'Answer this question' : reversed ? 'Which word matches this definition?' : 'What is the definition of…';
  let mode = 'type', options = [];
  if (how === 'choice') {
    const pool = cards.filter((x) => x.type === c.type && x.key !== c.key).map((x) => (reversed ? x.term : x.answer)).filter((t) => normalize(t) !== normalize(expected));
    const uniq = [...new Map(pool.map((t) => [normalize(t), t])).values()];
    if (uniq.length >= 1) { mode = 'choice'; options = shuffle([expected, ...shuffle(uniq).slice(0, 3)]); }
  }
  return { mode, shown, expected, label, options };
}

export default function Quiz({ cards, code, projectId, onExit }) {
  const { sum, sumNow } = useStats(code, projectId, cards);
  const [phase, setPhase] = useState('setup');
  const [ask, setAsk] = useState('term'); // what you are shown, for words
  const [how, setHow] = useState('type');
  const [mix, setMix] = useState(true);
  const [pick, setPick] = useState(null);
  const [kind, setKind] = useState('all');
  const [deck, setDeck] = useState([]);
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState('');
  const [picks, setPicks] = useState([]); // choices tapped so far, for "select all" and "put in order"
  const [result, setResult] = useState(null); // { right, given, overridden }
  const [round, setRound] = useState({ right: 0, wrong: 0 });
  const [showStats, setShowStats] = useState(false);
  const inputRef = useRef(null);
  useOverlay(phase !== 'setup', () => setPhase('setup'));
  useOverlay(showStats, () => setShowStats(false));
  const chosen = pick || defaultPick(sum);
  const hasTerm = cards.some((c) => c.type === 'term');
  const hasTyped = cards.some((c) => c.type === 'term' || c.type === 'qa');
  const hasChoiceOnly = cards.some(isChoiceOnly);
  const filtered = (which, s) => queueFor(which, cards, s).filter((c) => kind === 'all' || c.type === kind);
  const available = filtered(chosen, sum).length;

  const begin = (which) => {
    const q = filtered(which, sumNow());
    if (!q.length) return;
    diagLog(projectId, { type: 'session_start', mode: 'written quiz', shows: hasTerm ? (ask === 'term' ? 'word' : 'definition') : 'question', how: hasTyped ? (how === 'type' ? 'typing' : 'choosing') + (hasChoiceOnly ? ' (true/false and multiple choice always choose)' : '') : 'choosing', pick: which + (kind !== 'all' ? ', only ' + kind : ''), shuffle: mix, deckSize: q.length });
    setDeck(mix ? shuffle(q) : q); setI(0); setAnswer(''); setPicks([]); setResult(null);
    setRound({ right: 0, wrong: 0 }); setPhase('play');
  };
  const reset = async () => { await backend.resetStats(code, projectId); setKind('all'); begin('all'); };

  const c = deck[i];
  const q = useMemo(() => (c ? plan(c, cards, ask, how) : null), [i, deck, ask, how]); // eslint-disable-line
  const mode = q && q.mode;

  useEffect(() => { if (phase === 'play' && mode === 'type' && !result) inputRef.current?.focus(); }, [phase, i, mode, result]);

  const record = (right, fix = false) => backend.saveResult(code, projectId, c.key, right, fix).catch(() => {});
  const count = (right) => setRound((r) => ({ right: r.right + (right ? 1 : 0), wrong: r.wrong + (right ? 0 : 1) }));
  const submitTyped = () => {
    if (!answer.trim() || result) return;
    const right = isCorrect(answer, q.expected);
    if (!right && q.expected.trim().split(/\s+/).length > 6) {
      // Long answers can be worded many ways: show the answer and let the student judge.
      setResult({ right: false, given: answer.trim(), selfCheck: true });
      return;
    }
    diagLog(projectId, { type: 'answer', mode: `quiz ${c.type} (typed)`, question: q.shown, expected: q.expected, given: answer.trim(), correct: right });
    setResult({ right, given: answer.trim() });
    record(right); count(right);
  };
  const choose = (opt) => {
    if (result) return;
    const right = normalize(opt) === normalize(q.expected);
    diagLog(projectId, { type: 'answer', mode: `quiz ${c.type} (choice)`, question: q.shown, expected: q.expected, given: opt, correct: right });
    setResult({ right, given: opt });
    record(right); count(right);
  };
  const tap = (opt) => { if (!result) setPicks(picks.includes(opt) ? picks.filter((x) => x !== opt) : [...picks, opt]); };
  const submitPicks = () => {
    if (result || !picks.length) return;
    const right = mode === 'multi'
      ? picks.length === q.answers.length && q.answers.every((a) => picks.includes(a))
      : picks.length === q.sequence.length && picks.every((p, k) => p === q.sequence[k]);
    const given = mode === 'multi' ? q.options.filter((o) => picks.includes(o)).join('; ') : picks.map((t, k) => `${k + 1}. ${t}`).join('; ');
    diagLog(projectId, { type: 'answer', mode: `quiz ${c.type} (${mode === 'multi' ? 'select all' : 'put in order'})`, question: q.shown, expected: q.expected, given, correct: right });
    setResult({ right, given });
    record(right); count(right);
  };
  const decide = (right) => {
    diagLog(projectId, { type: 'answer', mode: `quiz ${c.type} (typed, self-checked)`, question: q.shown, expected: q.expected, given: result.given, correct: right });
    setResult({ right, given: result.given, selfChecked: true });
    record(right); count(right);
  };
  const override = () => {
    diagLog(projectId, { type: 'override', question: q.shown });
    setResult({ ...result, right: true, overridden: true });
    record(true, true);
    setRound((r) => ({ right: r.right + 1, wrong: r.wrong - 1 }));
  };
  const next = () => {
    if (i + 1 < deck.length) { setI(i + 1); setAnswer(''); setPicks([]); setResult(null); }
    else { diagLog(projectId, { type: 'round_done', mode: 'quiz', right: round.right, wrong: round.wrong }); setPhase('done'); }
  };

  if (phase === 'setup') return (
    <section>
      <ScreenHead onBack={onExit} icon={<TileArt kind="quiz" />} title="Written quiz" />
      {hasTerm && (
        <fieldset className="seg" aria-label="Question shows">
          <legend>Question shows (for words)</legend>
          <button className={ask === 'term' ? 'on' : ''} onClick={() => setAsk('term')}>Word</button>
          <button className={ask === 'definition' ? 'on' : ''} onClick={() => setAsk('definition')}>Definition</button>
        </fieldset>
      )}
      {hasTyped && (
        <fieldset className="seg" aria-label="Answer by">
          <legend>Answer by</legend>
          <button className={how === 'type' ? 'on' : ''} onClick={() => setHow('type')}>Typing</button>
          <button className={how === 'choice' ? 'on' : ''} onClick={() => setHow('choice')}>Choosing</button>
        </fieldset>
      )}
      {hasChoiceOnly && <p className="muted tiny">True/false, multiple-choice, select-all and put-in-order questions are always answered by choosing.</p>}
      <TypePicker deck={cards} value={kind} onChange={setKind} />
      <CardPicker sum={sum} value={chosen} onChange={setPick} />
      <label className="switch">
        <Icon name="shuffle" />
        <span>Shuffle the questions</span>
        <input type="checkbox" checked={mix} onChange={(e) => setMix(e.target.checked)} />
      </label>
      {available === 0 && <p className="hint">Nothing to ask with this selection.</p>}
      <button className="btn primary bottom" disabled={available === 0} onClick={() => begin(chosen)}><Icon name="play" />Start</button>
    </section>
  );

  if (phase === 'done') return <RoundDone round={round} sum={sum} onPractice={begin} onReset={reset} onExit={onExit} />;

  return (
    <section className="play on-scene quiz">
      <Scenery kind="haze" />
      <PlayTop onExit={back} index={i} total={deck.length} onStats={() => setShowStats(true)} title="Written quiz" />
      <div className="question">
        <small>{q.label}</small>
        <b data-testid="question">{q.shown}</b>
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
          {q.options.map((o) => {
            const isRight = normalize(o) === normalize(q.expected);
            const cls = !result ? '' : isRight ? ' right' : o === result.given ? ' wrong' : ' dim';
            return <button key={o} className={'opt' + cls} onClick={() => choose(o)} disabled={!!result && !isRight && o !== result.given}><span className="radio-dot" aria-hidden="true" /><span className="opt-text">{o}</span></button>;
          })}
        </div>
      )}

      {(mode === 'multi' || mode === 'order') && (
        <div className="stack" role="group" aria-label="Answer choices">
          {q.options.map((o) => {
            const at = picks.indexOf(o);
            let cls = at >= 0 ? ' on' : '';
            if (result && mode === 'multi') cls = q.answers.includes(o) ? ' right' : at >= 0 ? ' wrong' : ' dim';
            if (result && mode === 'order') cls = at === q.sequence.indexOf(o) ? ' right' : ' wrong';
            return (
              <button key={o} className={'opt' + cls} onClick={() => tap(o)} disabled={!!result} aria-pressed={at >= 0}>
                <span className={'radio-dot ' + (mode === 'multi' ? 'box' : 'num')} aria-hidden="true">{mode === 'order' ? (result ? q.sequence.indexOf(o) + 1 : at >= 0 ? at + 1 : '') : at >= 0 && !result ? '✓' : ''}</span>
                <span className="opt-text">{o}</span>
              </button>
            );
          })}
          {!result && <p className="muted tiny center">{mode === 'multi' ? 'Tap every correct choice, then Check.' : 'Tap them in order, first to last. Tap again to take one back.'}</p>}
          {!result && <button className="btn primary" disabled={mode === 'multi' ? !picks.length : picks.length !== q.options.length} onClick={submitPicks}>Check</button>}
        </div>
      )}

      {result && result.selfCheck && (
        <div className="feedback check" role="status" data-testid="feedback">
          <b>Compare your answer</b>
          <p className="given">You wrote: {result.given}</p>
          <p className="answer-line">Answer: <b>{q.expected}</b></p>
          <p className="muted tiny">Long answers can be worded in many ways, so you decide.</p>
          <div className="row">
            <button className="btn miss" onClick={() => decide(false)}>Missed it</button>
            <button className="btn primary" onClick={() => decide(true)}>I got it</button>
          </div>
        </div>
      )}

      {result && !result.selfCheck && (
        <div className={'feedback ' + (result.right ? 'good' : 'bad')} role="status" data-testid="feedback">
          <b>{result.selfChecked ? (result.right ? 'Counted as correct' : 'Counted as missed') : result.overridden ? 'Counted as correct' : result.right ? 'Correct' : 'Not quite'}</b>
          {!result.right && mode === 'type' && !result.selfChecked && <p className="given">You wrote: {result.given}</p>}
          {(!result.right || result.given.trim() !== q.expected) && <p className="answer-line">Answer: <b>{q.expected}</b></p>}
          {c.correction && <p className="answer-line" data-testid="quiz-correction">Correction: <b>{c.correction}</b></p>}
          <div className="row">
            {!result.right && mode === 'type' && !result.selfChecked && <button className="btn ghost" onClick={override}>I was right</button>}
            <button className="btn primary" onClick={next} data-testid="next">{i + 1 < deck.length ? 'Next' : 'Finish'}</button>
          </div>
        </div>
      )}
      {showStats && <StatsSheet sum={sum} onClose={() => setShowStats(false)} />}
    </section>
  );
}

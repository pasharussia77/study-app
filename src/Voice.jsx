import React, { useEffect, useRef, useState } from 'react';
import { backend } from './firebase.js';
import { shuffle } from './parse.js';
import { defaultPick, queueFor, normalize } from './stats.js';
import { askAIDetailed } from './ai.js';
import { describeQuestion, maxAttempts, countsRight, matchChoice, detectCommand, praise, revealCanned, buildTutorMessages, parseTutor } from './tutor.js';
import { speak, stopSpeaking, startListening, transcribe, beep } from './voice.js';
import { useStats, StatsSheet, CardPicker, TypePicker, RoundDone } from './Session.jsx';
import { diagLog } from './diag.js';
import { useOverlay, back } from './nav.js';

const STATUS_TEXT = { asking: 'Reading the question…', listening: 'Listening… speak your answer', thinking: 'Thinking…', speaking: 'Tutor is speaking…', paused: 'Paused', idle: '' };

// Keeps the screen on while studying by voice.
function useWakeLock(active) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return undefined;
    let sentinel = null, dead = false;
    const get = async () => { try { sentinel = await navigator.wakeLock.request('screen'); } catch { /* not allowed right now */ } };
    get();
    const onVis = () => { if (document.visibilityState === 'visible' && !dead) get(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      dead = true;
      document.removeEventListener('visibilitychange', onVis);
      if (sentinel && sentinel.release) sentinel.release().catch(() => {});
    };
  }, [active]);
}

export default function Voice({ cards, code, projectId, onExit }) {
  const { sum, sumNow } = useStats(code, projectId, cards);
  const [phase, setPhase] = useState('setup');
  const [ask, setAsk] = useState('term');
  const [readAloud, setReadAloud] = useState(true);
  const [mix, setMix] = useState(true);
  const [pick, setPick] = useState(null);
  const [kind, setKind] = useState('all');
  const [deck, setDeck] = useState([]);
  const [i, setI] = useState(0);
  const [status, setStatus] = useState('idle');
  const [heard, setHeard] = useState('');
  const [tutor, setTutor] = useState('');
  const [attempt, setAttempt] = useState(1);
  const [err, setErr] = useState('');
  const [round, setRound] = useState({ right: 0, wrong: 0 });
  const [showStats, setShowStats] = useState(false);
  const token = useRef(0);
  const listener = useRef(null);
  const deckRef = useRef([]);
  const iRef = useRef(0);
  const roundRef = useRef({ right: 0, wrong: 0 });
  const cfg = useRef({ ask: 'term', readAloud: true });

  const stopAll = () => { token.current++; stopSpeaking(); if (listener.current) { listener.current.cancel(); listener.current = null; } };
  useEffect(() => () => { token.current++; stopSpeaking(); if (listener.current) listener.current.cancel(); }, []);
  useOverlay(phase !== 'setup', () => { stopAll(); setStatus('idle'); setPhase('setup'); });
  useOverlay(showStats, () => setShowStats(false));
  useWakeLock(phase === 'play');

  const chosen = pick || defaultPick(sum);
  const hasTerm = cards.some((c) => c.type === 'term');
  const filtered = (which, s) => queueFor(which, cards, s).filter((c) => kind === 'all' || c.type === kind);
  const available = filtered(chosen, sum).length;

  // One call to the AI tutor. Rules decide right or wrong for choices; the AI judges spoken answers and writes the hints.
  const tutorAI = async (payload, turn) => {
    const res = await askAIDetailed(code, { messages: buildTutorMessages(payload), json: true, maxTokens: 600 });
    turn.aiMs += res.ms || 0;
    if (res.usage) { turn.aiIn += res.usage.prompt_tokens || 0; turn.aiOut += res.usage.completion_tokens || 0; }
    try { return parseTutor(res.text); }
    catch { throw new Error('The tutor gave an answer I could not read. Tap Resume to try again.'); }
  };

  const judge = async (c, qd, text, attemptNo, hints, turn) => {
    const last = attemptNo >= maxAttempts(c);
    if (c.type === 'tf' || c.type === 'mc') {
      const idx = matchChoice(text, c.choices);
      if (idx < 0) return { unclear: true, spoken: c.type === 'tf' ? 'Please say true or false.' : 'Please say the letter, or say the answer.' };
      if (normalize(c.choices[idx]) === normalize(c.answer)) return { correct: true, spoken: praise(), verdict: 'correct', rule: true };
      if (last) return { correct: false, final: true, spoken: revealCanned(c, qd), verdict: 'incorrect', rule: true };
      const r = await tutorAI({ mode: 'hint', kind: qd.kind, question: qd.shown, choices: c.choices, expected_answer: qd.expected, student_chose: c.choices[idx], previous_hints: hints }, turn);
      return { correct: false, spoken: r.spoken, verdict: r.verdict };
    }
    const r = await tutorAI({ mode: 'grade', kind: qd.kind, question: qd.shown, expected_answer: qd.expected, student_said: text, attempt: attemptNo, final_attempt: last, previous_hints: hints }, turn);
    const ok = r.verdict === 'correct' || r.verdict === 'mostly';
    return { correct: ok, final: !ok && last, spoken: r.spoken, verdict: r.verdict };
  };

  const settle = (c, qd, outcome, turn) => {
    const right = !!outcome.right;
    backend.saveResult(code, projectId, c.key, right).catch(() => {});
    roundRef.current = { right: roundRef.current.right + (right ? 1 : 0), wrong: roundRef.current.wrong + (right ? 0 : 1) };
    setRound({ ...roundRef.current });
    diagLog(projectId, { type: 'voice_result', question: qd.shown, expected: qd.expected, right, attempts: outcome.attempt, skipped: !!outcome.skipped, ttsChars: turn.ttsChars, sttMs: turn.sttMs, aiMs: turn.aiMs, aiIn: turn.aiIn, aiOut: turn.aiOut, recordings: turn.recordings });
  };
  const finish = () => {
    diagLog(projectId, { type: 'round_done', mode: 'voice quiz', right: roundRef.current.right, wrong: roundRef.current.wrong });
    stopAll(); setStatus('idle'); setPhase('done');
  };
  const newTurn = () => ({ ttsChars: 0, sttMs: 0, aiMs: 0, aiIn: 0, aiOut: 0, recordings: 0 });

  // The conversation: ask, listen, judge, answer, repeat, one question at a time.
  const run = async (startIdx) => {
    const my = ++token.current;
    const live = () => token.current === my;
    setErr('');
    try {
      for (let idx = startIdx; idx < deckRef.current.length; idx++) {
        if (!live()) return;
        iRef.current = idx; setI(idx); setHeard(''); setTutor(''); setAttempt(1);
        const c = deckRef.current[idx];
        const qd = describeQuestion(c, cfg.current.ask);
        const turn = newTurn();
        const cost = (e) => { turn.ttsChars += e.chars; };
        if (cfg.current.readAloud) { setStatus('asking'); await speak(code, qd.spoken, cost); if (!live()) return; }
        let attemptNo = 1, unclear = 0, outcome = null;
        const hints = [];
        while (live()) {
          const l = startListening();
          listener.current = l;
          setStatus('listening');
          await beep();
          const rec = await l.promise;
          listener.current = null;
          if (!live()) return;
          let text = '';
          if (rec && rec.blob) {
            setStatus('thinking');
            const t0 = Date.now();
            turn.recordings++;
            text = await transcribe(code, rec.blob, rec.ext);
            turn.sttMs += Date.now() - t0;
            if (!live()) return;
          }
          setHeard(text);
          if (!text) {
            unclear++;
            if (unclear >= 2) throw new Error('I could not hear you. Check the microphone, then tap Resume.');
            const m = "I didn't catch that. Please say it again.";
            setTutor(m); setStatus('speaking'); await speak(code, m, cost); if (!live()) return;
            continue;
          }
          const cmd = detectCommand(text);
          if (cmd === 'repeat') { setStatus('asking'); await speak(code, qd.spoken, cost); if (!live()) return; continue; }
          if (cmd === 'skip') { outcome = { right: false, skipped: true, attempt: attemptNo }; break; }
          unclear = 0;
          setStatus('thinking');
          const res = await judge(c, qd, text, attemptNo, hints, turn);
          if (!live()) return;
          if (!res.unclear) diagLog(projectId, { type: 'voice_turn', question: qd.shown, expected: qd.expected, attempt: attemptNo, heard: text, verdict: res.verdict, tutor: res.spoken, correct: !!res.correct, byRule: !!res.rule });
          setTutor(res.spoken); setStatus('speaking');
          await speak(code, res.spoken, cost);
          if (!live()) return;
          if (res.unclear) continue;
          if (res.correct) { outcome = { right: countsRight(c, attemptNo), attempt: attemptNo }; break; }
          if (res.final || attemptNo >= maxAttempts(c)) { outcome = { right: false, attempt: attemptNo }; break; }
          hints.push(res.spoken); attemptNo++; setAttempt(attemptNo);
        }
        if (!live() || !outcome) return;
        settle(c, qd, outcome, turn);
        await new Promise((r) => setTimeout(r, 300));
      }
      if (live()) finish();
    } catch (e) {
      if (live()) { token.current++; stopSpeaking(); setErr(e.message); setStatus('paused'); }
    }
  };

  const start = (which) => {
    const q = filtered(which, sumNow());
    if (!q.length) return;
    const d = mix ? shuffle(q) : q;
    cfg.current = { ask, readAloud };
    deckRef.current = d; setDeck(d); iRef.current = 0; setI(0);
    roundRef.current = { right: 0, wrong: 0 }; setRound({ right: 0, wrong: 0 });
    diagLog(projectId, { type: 'session_start', mode: 'voice quiz', shows: hasTerm ? (ask === 'term' ? 'word' : 'definition') : 'question', how: `speaking, questions ${readAloud ? 'read aloud' : 'on screen only'}`, pick: which + (kind !== 'all' ? ', only ' + kind : ''), shuffle: mix, deckSize: q.length });
    setPhase('play');
    run(0);
  };
  const reset = async () => { await backend.resetStats(code, projectId); setKind('all'); start('all'); };
  const pause = () => { stopAll(); setStatus('paused'); };
  const resume = () => run(iRef.current);
  const repeatQ = () => { stopAll(); run(iRef.current); };
  const skipQ = () => {
    stopAll();
    const c = deckRef.current[iRef.current];
    settle(c, describeQuestion(c, cfg.current.ask), { right: false, skipped: true, attempt: attempt }, newTurn());
    if (iRef.current + 1 >= deckRef.current.length) finish(); else run(iRef.current + 1);
  };

  if (phase === 'setup') return (
    <section>
      <button className="back" onClick={onExit}><span aria-hidden="true">‹</span> Back</button>
      <h1>Voice quiz</h1>
      <p className="muted">The tutor asks one question at a time. You answer out loud, and it helps you get to the right answer.</p>
      {hasTerm && (
        <fieldset className="seg" aria-label="Question shows">
          <legend>Question shows (for words)</legend>
          <button className={ask === 'term' ? 'on' : ''} onClick={() => setAsk('term')}>Word</button>
          <button className={ask === 'definition' ? 'on' : ''} onClick={() => setAsk('definition')}>Definition</button>
        </fieldset>
      )}
      <label className="switch">
        <input type="checkbox" checked={readAloud} onChange={(e) => setReadAloud(e.target.checked)} />
        <span>Read each question aloud</span>
      </label>
      <p className="muted tiny">The question always stays on the screen. The tutor always speaks its feedback.</p>
      <TypePicker deck={cards} value={kind} onChange={setKind} />
      <CardPicker sum={sum} value={chosen} onChange={setPick} />
      <label className="switch">
        <input type="checkbox" checked={mix} onChange={(e) => setMix(e.target.checked)} />
        <span>Shuffle the questions</span>
      </label>
      <p className="hint">Allow the microphone when your phone asks. The screen stays on while you study; sound may stop if your phone turns the screen off.</p>
      {available === 0 && <p className="hint">Nothing to ask with this selection.</p>}
      <button className="btn primary bottom" disabled={available === 0} onClick={() => start(chosen)}>Start talking</button>
    </section>
  );

  if (phase === 'done') return <RoundDone round={round} sum={sum} onPractice={start} onReset={reset} onExit={onExit} />;

  const c = deck[i];
  const qd = c ? describeQuestion(c, cfg.current.ask) : null;
  if (!qd) return null;
  return (
    <section className="play voice">
      <header className="play-top">
        <button className="back" onClick={back}><span aria-hidden="true">‹</span> Exit</button>
        <span className="count" data-testid="counter">{i + 1} / {deck.length}</span>
        <button className="chip" onClick={() => setShowStats(true)}>Stats</button>
      </header>
      <div className="bar" role="progressbar" aria-valuemin="0" aria-valuemax={deck.length} aria-valuenow={i + 1}><span style={{ width: `${((i + 1) / deck.length) * 100}%` }} /></div>
      <div className="question">
        <small>{qd.label}</small>
        <b data-testid="question">{qd.shown}</b>
        {qd.choices && <ul className="qchoices">{qd.choices.map((t, k) => <li key={k}>{String.fromCharCode(65 + k)}. {t}</li>)}</ul>}
      </div>
      <div className="voice-zone">
        <div className={'orb ' + status} aria-hidden="true"><span /></div>
        <p className="orb-label" role="status" data-testid="voice-status">{err ? '' : STATUS_TEXT[status]}</p>
      </div>
      {heard && <p className="said" data-testid="heard">You said: “{heard}”</p>}
      {tutor && <p className="tutor" data-testid="tutor">{tutor}</p>}
      {attempt > 1 && <p className="muted tiny center">Hint {attempt - 1}</p>}
      {err && <div className="error" role="alert">{err}</div>}
      <div className="row nav">
        {status === 'paused'
          ? <button className="btn primary" onClick={resume}>Resume</button>
          : <button className="btn ghost" onClick={pause}>Pause</button>}
        {status === 'listening' && <button className="btn primary" onClick={() => listener.current && listener.current.stop()}>Done talking</button>}
      </div>
      <div className="row links">
        <button className="link" onClick={repeatQ}>Repeat question</button>
        <button className="link" onClick={skipQ}>Skip</button>
      </div>
      {showStats && <StatsSheet sum={sum} onClose={() => setShowStats(false)} />}
    </section>
  );
}

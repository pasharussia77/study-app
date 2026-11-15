import React, { useEffect, useRef, useState } from 'react';
import { backend } from './firebase.js';
import { shuffle } from './parse.js';
import { defaultPick, queueFor, normalize } from './stats.js';
import { askAIDetailed } from './ai.js';
import { describeQuestion, utterance, maxAttempts, countsRight, matchChoice, detectCommand, quickCorrect, praise, revealCanned, buildTutorMessages, parseTutor, sttContext } from './tutor.js';
import { speak, warm, stopSpeaking, startListening, transcribe, beep, VOICES, getVoice, setVoice } from './voice.js';
import { useStats, StatsSheet, CardPicker, TypePicker, RoundDone } from './Session.jsx';
import { diagLog } from './diag.js';
import { useOverlay, back } from './nav.js';

const STATUS_TEXT = { asking: 'Reading the question…', listening: 'Listening… speak your answer', thinking: 'Thinking…', speaking: 'Tutor is speaking…', paused: 'Paused', idle: '' };
const CANNED = ["Correct!", "Yes, that's right!", 'Nice one!', 'Exactly right!', "I didn't catch that. Please say it again.", 'Please say true or false.', 'Please say the letter, or say the answer.'];

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
  const [voice, setVoiceState] = useState(getVoice());
  const [mic, setMic] = useState(null);       // result of the microphone test
  const [voiceTest, setVoiceTest] = useState('');
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
  const lastKind = useRef(null);
  const statusRef = useRef('idle');
  statusRef.current = status;

  const stopAll = () => { token.current++; stopSpeaking(); if (listener.current) { listener.current.cancel(); listener.current = null; } };
  useEffect(() => () => { token.current++; stopSpeaking(); if (listener.current) listener.current.cancel(); }, []);
  useOverlay(phase !== 'setup', () => { stopAll(); setStatus('idle'); setPhase('setup'); });
  useOverlay(showStats, () => setShowStats(false));
  useWakeLock(phase === 'play');

  // Record when the screen turns off or the app is left, so the report can show what happened.
  useEffect(() => {
    if (phase !== 'play') return undefined;
    const onVis = () => diagLog(projectId, { type: 'voice_visibility', state: document.visibilityState, status: statusRef.current });
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [phase, projectId]);

  const chosen = pick || defaultPick(sum);
  const hasTerm = cards.some((c) => c.type === 'term');
  const filtered = (which, s) => queueFor(which, cards, s).filter((c) => kind === 'all' || c.type === kind);
  const available = filtered(chosen, sum).length;

  // One call to the AI tutor. Rules decide right or wrong for choices; the AI judges spoken answers and writes the hints.
  const tutorAI = async (payload, turn) => {
    const send = (effort) => askAIDetailed(code, { messages: buildTutorMessages(payload), json: true, maxTokens: 400, effort });
    let res;
    try { res = await send('none'); }
    catch (e) { if (/reason|effort/i.test(e.message)) res = await send('low'); else throw e; }
    turn.m.ai += res.ms || 0;
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
    if (quickCorrect(text, qd.expected)) return { correct: true, spoken: praise(), verdict: 'correct', rule: true };
    const r = await tutorAI({ mode: 'grade', kind: qd.kind, question: qd.shown, expected_answer: qd.expected, student_said: text, attempt: attemptNo, final_attempt: last, previous_hints: hints }, turn);
    const ok = r.verdict === 'correct' || r.verdict === 'mostly';
    // On the last try the app says the answer itself, so it never depends on the AI remembering to.
    if (!ok && last) return { correct: false, final: true, spoken: revealCanned(c, qd), verdict: r.verdict };
    return { correct: ok, spoken: r.spoken, verdict: r.verdict };
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
  const newTurn = () => ({ ttsChars: 0, sttMs: 0, aiMs: 0, aiIn: 0, aiOut: 0, recordings: 0, m: { stt: 0, ai: 0, tts: 0, gap: null } });

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
        const cost = (e) => { turn.ttsChars += e.chars; turn.m.tts += e.ms || 0; };
        if (cfg.current.readAloud) {
          // The kind of question is explained only when it changes, together with the first question of that kind.
          const intro = lastKind.current !== qd.kind;
          setStatus('asking');
          await speak(code, utterance(qd, intro), cost);
          if (!live()) return;
        }
        lastKind.current = qd.kind;
        // While the student answers, get the next question's audio ready.
        const next = deckRef.current[idx + 1];
        if (next && cfg.current.readAloud) { const nq = describeQuestion(next, cfg.current.ask); warm(code, utterance(nq, nq.kind !== qd.kind)); }
        let attemptNo = 1, unclear = 0, outcome = null;
        const hints = [];
        while (live()) {
          turn.m = { stt: 0, ai: 0, tts: 0, gap: null };
          setStatus('listening');
          await beep();
          if (!live()) return;
          const l = startListening();
          listener.current = l;
          const rec = await l.promise;
          listener.current = null;
          if (!live()) return;
          const tEnd = Date.now();
          let text = '', heardInfo = {};
          const stt = sttContext(c, qd, deckRef.current);
          if (rec.blob) {
            setStatus('thinking');
            turn.recordings++;
            heardInfo = await transcribe(code, rec.blob, rec.ext, stt);
            text = heardInfo.text;
            turn.m.stt = Date.now() - tEnd; turn.sttMs += turn.m.stt;
            if (!live()) return;
          }
          setHeard(text);
          const onStart = () => { if (turn.m.gap === null) turn.m.gap = Date.now() - tEnd; };
          const logHeard = (outcome) => diagLog(projectId, { type: 'voice_heard', text, outcome, sttMs: turn.m.stt, stats: rec.stats, sttModel: heardInfo.model, languages: heardInfo.languages, hints: stt.keywords.length });
          if (!text) {
            logHeard(rec.blob ? 'the recording was transcribed as empty' : 'no speech detected');
            unclear++;
            if (unclear >= 2) throw new Error('I could not hear you. Check the microphone, then tap Resume.');
            const m = "I didn't catch that. Please say it again.";
            setTutor(m); setStatus('speaking'); await speak(code, m, cost, onStart); if (!live()) return;
            continue;
          }
          const cmd = detectCommand(text);
          if (cmd) logHeard('command: ' + cmd);
          if (cmd === 'repeat') { setStatus('asking'); await speak(code, qd.spoken, cost, onStart); if (!live()) return; continue; }
          if (cmd === 'skip') { outcome = { right: false, skipped: true, attempt: attemptNo }; break; }
          unclear = 0;
          setStatus('thinking');
          const res = await judge(c, qd, text, attemptNo, hints, turn);
          if (!live()) return;
          setTutor(res.spoken); setStatus('speaking');
          await speak(code, res.spoken, cost, onStart);
          if (!live()) return;
          if (!res.unclear) diagLog(projectId, { type: 'voice_turn', question: qd.shown, expected: qd.expected, attempt: attemptNo, heard: text, verdict: res.verdict, tutor: res.spoken, correct: !!res.correct, byRule: !!res.rule, gapMs: turn.m.gap, sttMs: turn.m.stt, aiMs: turn.m.ai, ttsMs: turn.m.tts });
          if (res.unclear) { logHeard('could not tell which choice was meant'); continue; }
          logHeard('judged');
          if (res.correct) { outcome = { right: countsRight(c, attemptNo), attempt: attemptNo }; break; }
          if (res.final || attemptNo >= maxAttempts(c)) { outcome = { right: false, attempt: attemptNo }; break; }
          hints.push(res.spoken); attemptNo++; setAttempt(attemptNo);
        }
        if (!live() || !outcome) return;
        turn.aiMs += 0;
        settle(c, qd, outcome, turn);
      }
      if (live()) finish();
    } catch (e) {
      if (live()) { token.current++; stopSpeaking(); setErr(e.message); setStatus('paused'); }
    }
  };

  const pause = () => { stopAll(); setStatus('paused'); };
  const resume = () => run(iRef.current);
  const repeatQ = () => { stopAll(); run(iRef.current); };
  const skipQ = () => {
    stopAll();
    const c = deckRef.current[iRef.current];
    settle(c, describeQuestion(c, cfg.current.ask), { right: false, skipped: true, attempt }, newTurn());
    if (iRef.current + 1 >= deckRef.current.length) finish(); else run(iRef.current + 1);
  };
  const controls = useRef({});
  controls.current = { pause, resume };

  const start = (which) => {
    const q = filtered(which, sumNow());
    if (!q.length) return;
    const d = mix ? shuffle(q) : q;
    const read = readAloud;
    cfg.current = { ask, readAloud: read };
    lastKind.current = null;
    deckRef.current = d; setDeck(d); iRef.current = 0; setI(0);
    roundRef.current = { right: 0, wrong: 0 }; setRound({ right: 0, wrong: 0 });
    diagLog(projectId, { type: 'session_start', mode: 'voice quiz', shows: hasTerm ? (ask === 'term' ? 'word' : 'definition') : 'question', how: `speaking, questions ${read ? 'read aloud' : 'on screen only'}`, pick: which + (kind !== 'all' ? ', only ' + kind : ''), shuffle: mix, deckSize: q.length });
    // Get the standard replies ready so they play without a wait.
    CANNED.forEach((t) => warm(code, t));
    setPhase('play');
    run(0);
  };
  const testMic = async () => {
    setMic({ busy: 'Say a sentence, like: "The quick brown fox jumps over the lazy dog."' });
    try {
      await beep();
      const rec = await startListening().promise;
      let text = '', info = {};
      if (rec.blob) { setMic({ busy: 'Hearing you…' }); info = await transcribe(code, rec.blob, rec.ext, { prompt: 'A student is testing a microphone by saying a sentence in English.' }); text = info.text; }
      diagLog(projectId, { type: 'voice_heard', text, outcome: 'microphone test', stats: rec.stats, sttModel: info.model, languages: info.languages, hints: 0 });
      setMic({ text, stats: rec.stats });
    } catch (e) { setMic({ error: e.message }); }
  };
  const testVoice = async () => {
    setVoiceTest('Speaking…');
    try { await speak(code, 'Hello! This is how your tutor sounds. Can you understand me clearly?'); setVoiceTest('If this voice sounds friendly and clear, you are ready. If not, pick another voice above and test again.'); }
    catch (e) { setVoiceTest(e.message); }
  };
  const reset = async () => { await backend.resetStats(code, projectId); setKind('all'); start('all'); };

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
      <div className="micbox">
        <b>Check the sound first</b>
        <label className="voicepick">
          <span className="muted tiny">Tutor voice</span>
          <select value={voice} aria-label="Tutor voice" onChange={(e) => { setVoice(e.target.value); setVoiceState(e.target.value); }}>
            {VOICES.map((n) => <option key={n} value={n}>{n[0].toUpperCase() + n.slice(1)}</option>)}
          </select>
        </label>
        <div className="row">
          <button className="btn ghost small" onClick={testMic} disabled={!!(mic && mic.busy)}>Test my microphone</button>
          <button className="btn ghost small" onClick={testVoice}>Test the tutor voice</button>
        </div>
        {mic && mic.busy && <p className="hint" role="status">{mic.busy}</p>}
        {mic && mic.error && <p className="error" role="alert">{mic.error}</p>}
        {mic && !mic.busy && !mic.error && (
          <p className="okmsg" data-testid="mictest">
            {mic.text ? <>I heard: “{mic.text}”</> : 'I heard nothing.'}
            <span className="tiny block">Recording {(mic.stats.durationMs / 1000).toFixed(1)} s · loudest {mic.stats.peak} · background {mic.stats.floor} · {mic.stats.speech ? 'speech detected' : 'no speech detected'}</span>
          </p>
        )}
        {voiceTest && <p className="muted tiny" role="status">{voiceTest}</p>}
      </div>
      <p className="muted tiny">The screen stays on while you study. Studying with the screen off is not possible in a web app.</p>
      <p className="hint">Allow the microphone when your phone asks.</p>
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
        {status === 'asking' && <button className="btn primary" onClick={() => stopSpeaking()}>Answer now</button>}
        {status === 'speaking' && <button className="btn ghost" onClick={() => stopSpeaking()}>Skip talking</button>}
      </div>
      <div className="row links">
        <button className="link" onClick={repeatQ}>Repeat question</button>
        <button className="link" onClick={skipQ}>Skip</button>
      </div>
      {showStats && <StatsSheet sum={sum} onClose={() => setShowStats(false)} />}
    </section>
  );
}

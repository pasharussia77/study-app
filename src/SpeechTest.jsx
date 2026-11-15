import React, { useEffect, useRef, useState } from 'react';
import { transcribe, startListening, beep } from './voice.js';
import { SPEECH_ITEMS, scoreHeard, speechHints, tally, buildSpeechReport } from './speechtest.js';
import { useOverlay, back } from './nav.js';
import { useWakeLock } from './wakelock.js';
import { APP_VERSION } from './version.js';

export default function SpeechTest({ code, onExit }) {
  const [phase, setPhase] = useState('intro');
  const [i, setI] = useState(0);
  const [status, setStatus] = useState('idle');
  const [last, setLast] = useState(null);
  const [results, setResults] = useState([]);
  const [err, setErr] = useState('');
  const [notes, setNotes] = useState('');
  const [copied, setCopied] = useState('');
  const token = useRef(0), listener = useRef(null), skipFlag = useRef(false), resultsRef = useRef([]), startedAt = useRef(0);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const stopAll = () => { token.current++; if (listener.current) { listener.current.cancel(); listener.current = null; } };
  useEffect(() => () => { token.current++; if (listener.current) listener.current.cancel(); }, []);
  useOverlay(phase === 'run', () => { stopAll(); setStatus('idle'); setPhase(resultsRef.current.length ? 'done' : 'intro'); });
  useWakeLock(phase === 'run');

  const run = async (startIdx) => {
    const my = ++token.current;
    const live = () => token.current === my;
    const hints = speechHints();
    setErr('');
    try {
      for (let idx = startIdx; idx < SPEECH_ITEMS.length; idx++) {
        if (!live()) return;
        const item = SPEECH_ITEMS[idx];
        setI(idx); setLast(null); setStatus('listening');
        await beep();
        if (!live()) return;
        const l = startListening();
        listener.current = l;
        const rec = await l.promise;
        listener.current = null;
        if (!live()) return;
        let r;
        if (skipFlag.current) { skipFlag.current = false; r = { item, skipped: true }; }
        else {
          let withHints = { text: '' }, without = { text: '' };
          if (rec.blob) {
            setStatus('thinking');
            // The same recording is sent twice, once with the quiz's word hints and once with none.
            [withHints, without] = await Promise.all([transcribe(code, rec.blob, rec.ext, hints), transcribe(code, rec.blob, rec.ext, {})]);
            if (!live()) return;
          }
          r = { item, stats: rec.stats, withHints, without, verdictWith: scoreHeard(withHints.text, item), verdictWithout: scoreHeard(without.text, item) };
        }
        resultsRef.current = [...resultsRef.current, r];
        setResults(resultsRef.current);
        setLast(r); setStatus('shown');
        await sleep(window.__stDelay != null ? window.__stDelay : 1500);
      }
      if (live()) { setStatus('idle'); setPhase('done'); }
    } catch (e) {
      if (live()) { token.current++; setErr(e.message); setStatus('paused'); }
    }
  };

  const start = () => { resultsRef.current = []; setResults([]); startedAt.current = Date.now(); setNotes(''); setCopied(''); setPhase('run'); run(0); };
  const finishNow = () => { stopAll(); setStatus('idle'); setPhase('done'); };
  const skip = () => { skipFlag.current = true; if (listener.current) listener.current.cancel(); };
  const resume = () => run(resultsRef.current.length);

  const report = phase === 'done' ? buildSpeechReport({
    version: APP_VERSION,
    device: `${navigator.userAgent} | screen ${screen.width}x${screen.height} | online ${navigator.onLine}`,
    results, notes, startedAt: startedAt.current
  }) : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(report); setCopied('Copied. Now paste it in the chat with Claude.'); }
    catch { setCopied('Could not copy automatically. Press and hold in the box, choose Select all, then Copy.'); }
  };

  if (phase === 'intro') return (
    <section>
      <button className="back" onClick={onExit}><span aria-hidden="true">‹</span> Back</button>
      <h1>Speech test</h1>
      <p className="muted">A scripted test of how well the app understands you. You will see {SPEECH_ITEMS.length} words and phrases, one at a time, from easy to tricky. Say each one in your normal voice. It takes about 5 minutes.</p>
      <div className="hint">Find a quiet place. Each recording is sent to the recognizer twice, once with word hints like the quiz uses and once without, so we can see whether the hints help.</div>
      <p className="muted tiny">When it ends, press Copy report and paste it to Claude. If you can, also run a normal voice quiz and send its report.</p>
      <button className="btn primary bottom" onClick={start}>Start the test</button>
    </section>
  );

  if (phase === 'done') {
    const a = tally(results, 'verdictWith'), b = tally(results, 'verdictWithout');
    const done = results.filter((r) => !r.skipped).length;
    return (
      <section>
        <button className="back" onClick={onExit}><span aria-hidden="true">‹</span> Back</button>
        <h1>Test finished</h1>
        <div className="stats-grid compact">
          <div className="stat correct"><dt>With hints</dt><dd data-testid="with-ok">{a.exact + a.close}/{done}</dd></div>
          <div className="stat covered"><dt>No hints</dt><dd data-testid="without-ok">{b.exact + b.close}/{done}</dd></div>
          <div className="stat incorrect"><dt>Recorded</dt><dd>{done}</dd></div>
        </div>
        <label className="muted tiny" htmlFor="stnotes">Your notes (optional)</label>
        <textarea id="stnotes" className="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything that felt different or strange?" />
        <textarea className="report-box" readOnly value={report} aria-label="Report text" data-testid="st-report" />
        <button className="btn primary" onClick={copy}>Copy report</button>
        {copied && <p className="okmsg" role="status">{copied}</p>}
        <button className="btn ghost" onClick={start}>Run the test again</button>
      </section>
    );
  }

  const item = SPEECH_ITEMS[i];
  const showRes = status === 'shown' && last;
  return (
    <section className="play">
      <header className="play-top">
        <button className="back" onClick={back}><span aria-hidden="true">‹</span> Exit</button>
        <span className="count" data-testid="counter">{i + 1} / {SPEECH_ITEMS.length}</span>
        <button className="chip" onClick={finishNow}>Finish now</button>
      </header>
      <div className="bar" role="progressbar" aria-valuemin="0" aria-valuemax={SPEECH_ITEMS.length} aria-valuenow={i + 1}><span style={{ width: `${((i + 1) / SPEECH_ITEMS.length) * 100}%` }} /></div>
      <div className="question">
        <small>Say this{item.group ? ` · ${item.group}` : ''}</small>
        <b data-testid="say">{item.say}</b>
      </div>
      <div className="voice-zone">
        <div className={'orb ' + (status === 'shown' ? 'paused' : status)} aria-hidden="true"><span /></div>
        <p className="orb-label" role="status" data-testid="st-status">
          {err ? '' : status === 'listening' ? 'Listening… say it now' : status === 'thinking' ? 'Checking…' : status === 'shown' ? 'Got it' : status === 'paused' ? 'Paused' : ''}
        </p>
      </div>
      {showRes && !last.skipped && (
        <div className="stres" data-testid="st-result">
          <p>With hints: <b>“{last.withHints.text || '—'}”</b> <span className={'v v-' + last.verdictWith}>{last.verdictWith}</span></p>
          <p>Without: <b>“{last.without.text || '—'}”</b> <span className={'v v-' + last.verdictWithout}>{last.verdictWithout}</span></p>
        </div>
      )}
      {err && <div className="error" role="alert">{err}</div>}
      <div className="row nav">
        {status === 'paused' ? <button className="btn primary" onClick={resume}>Resume</button> : null}
        {status === 'listening' && <button className="btn primary" onClick={() => listener.current && listener.current.stop()}>Done talking</button>}
        {status === 'listening' && <button className="btn ghost" onClick={skip}>Skip this one</button>}
      </div>
    </section>
  );
}

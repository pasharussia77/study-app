import React, { useEffect, useMemo, useState } from 'react';
import { backend } from './firebase.js';
import { buildReport, splitReport } from './report.js';
import { diagGet, diagClear } from './diag.js';
import { parseCards } from './parse.js';
import { summarize } from './stats.js';
import { crossCheck } from './items.js';
import { useOverlay } from './nav.js';
import { APP_VERSION } from './version.js';

const WORKER_URL = 'https://study-api.pasharussia77.workers.dev';

export default function ReportSheet({ code, project, profile, text, deck, onClose, extra = '' }) {
  const [files, setFiles] = useState([]);
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({});
  const [health, setHealth] = useState(null);
  const [notes, setNotes] = useState('');
  const [events, setEvents] = useState(() => diagGet(project.id));
  const [copied, setCopied] = useState('');

  useEffect(() => backend.watchFiles(code, project.id, setFiles), [code, project.id]);
  useEffect(() => backend.watchStats(code, project.id, setStats), [code, project.id]);
  useEffect(() => backend.watchItems(code, project.id, setItems), [code, project.id]);
  useEffect(() => {
    if (new URLSearchParams(location.search).has('mock')) { setHealth({ model: 'mock-model', hasKey: true }); return; }
    fetch(WORKER_URL + '/health').then((r) => r.json()).then(setHealth).catch(() => {});
  }, []);

  const report = useMemo(() => {
    const parsed = parseCards(text);
    return buildReport({
      version: APP_VERSION,
      device: `${navigator.userAgent} | screen ${screen.width}x${screen.height} | online ${navigator.onLine}`,
      health, profile, project, text, parsed, sum: summarize(deck, stats), files, items, check: crossCheck(files, items), events, notes
    }) + (extra ? '\n\n' + extra : '');
  }, [text, stats, files, items, deck, events, notes, health, profile, project, extra]);

  const parts = useMemo(() => splitReport(report), [report]);
  const copy = async (i = 0) => {
    try { await navigator.clipboard.writeText(parts[i]); setCopied(parts.length > 1 ? `Copied part ${i + 1} of ${parts.length}. Paste it in the chat, send it, then copy the next part.` : 'Copied. Now paste it in the chat with Claude.'); }
    catch { setCopied('Could not copy automatically. Press and hold in the box, choose Select all, then Copy.'); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="stats-sheet report-sheet" role="dialog" aria-label="Diagnostic report" onClick={(e) => e.stopPropagation()}>
        <h2>Diagnostic report</h2>
        <p className="muted tiny">It lists what the app read, how it made cards, and how your quizzes went. Add your own notes first if you like.</p>
        <label className="muted tiny" htmlFor="notes">Your notes (optional)</label>
        <textarea id="notes" className="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did you expect? What looked wrong?" />
        <textarea className="report-box" readOnly value={report} aria-label="Report text" data-testid="report" />
        {parts.length > 1 && <p className="muted tiny" data-testid="parts-note">The report is long, so it comes in {parts.length} parts. Paste each part in the chat as its own message, in order.</p>}
        {parts.map((p, i) => (
          <button key={i} className={'btn ' + (i === 0 ? 'primary' : 'ghost')} onClick={() => copy(i)} data-testid={'copy-' + i}>{parts.length > 1 ? `Copy part ${i + 1} of ${parts.length}` : 'Copy report'}</button>
        ))}
        {copied && <p className="okmsg" role="status">{copied}</p>}
        <div className="row">
          <button className="btn ghost" onClick={() => { if (confirm('Clear the recorded activity for this project? Your photos and material stay.')) { diagClear(project.id); setEvents([]); } }}>Start fresh log</button>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

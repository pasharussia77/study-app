import React, { useEffect, useMemo, useRef, useState } from 'react';
import { backend } from './firebase.js';
import { compressImage, readTextFile, readPdf } from './material.js';
import { buildDeck } from './deck.js';
import { shortName, niceDate } from './parse.js';
import { diagLog } from './diag.js';
import { useOverlay } from './nav.js';
import { Icon } from './art.jsx';
import { ScreenHead, useStats, StatsStrip } from './Session.jsx';
import { TileArt } from './art.jsx';
import {
  COUNT_CHOICES, DEFAULT_COUNT, BLOCK_LABEL, cleanCount, countNote, transcribePhoto, findBlocks, buildQuestions,
  splitTextPages, textTranscript, makeChunks, layoutText, chunkPreview, suggestCount
} from './reading.js';

const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return String(h); };
// What the questions were made from: the ticked text of the page. If it changes, the questions are out of date.
export const stampOf = (f) => (f.transcript ? hash(layoutText(f.transcript, { off: f.off || [] })) : '');
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const countOf = (f) => (f.count ? f.count : f.transcript ? suggestCount(f.transcript, f.off || []) : DEFAULT_COUNT);

async function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const imgSize = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({ w: 3, h: 4 }); i.src = src; });

// The typed copy as a picture (layout pages only).
function pictureOf(t, ratio) {
  const W = 1200, H = Math.round(W * ratio);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#111'; g.textBaseline = 'alphabetic';
  for (const l of t.lines) {
    const fs = Math.max(10, l.h * H * 0.85);
    g.font = `${fs}px sans-serif`;
    const x = l.x * W, y = l.y * H + fs;
    g.fillText(l.text, x, y);
    const tw = g.measureText(l.text).width;
    g.strokeStyle = '#111'; g.lineWidth = 2;
    if (l.marks.includes('underline')) { g.beginPath(); g.moveTo(x, y + 4); g.lineTo(x + tw, y + 4); g.stroke(); }
    if (l.marks.includes('box')) g.strokeRect(x - 6, y - fs, tw + 12, fs * 1.25);
    if (l.marks.includes('circle')) { g.beginPath(); g.ellipse(x + tw / 2, y - fs * 0.35, tw / 2 + 12, fs * 0.8, 0, 0, Math.PI * 2); g.stroke(); }
  }
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

// ------------------------------------------------------------------ the whole project

export default function ReadingProject({ code, projectId, profile, onBack, onStudy, onReview }) {
  const [p, setP] = useState(null);
  const [files, setFiles] = useState(null);
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [editing, setEditing] = useState(null); // file id
  const [pasting, setPasting] = useState(false);
  const [paste, setPaste] = useState('');
  const cam = useRef(null), gallery = useRef(null), doc = useRef(null);

  useEffect(() => { backend.getProject(code, projectId).then(setP); }, [code, projectId]);
  useEffect(() => backend.watchFiles(code, projectId, setFiles), [code, projectId]);
  useEffect(() => backend.watchItems(code, projectId, setItems), [code, projectId]);
  useOverlay(editing !== null, () => setEditing(null));
  useOverlay(pasting, () => setPasting(false));

  const fileList = files || [], itemList = items || [];
  const { deck } = useMemo(() => buildDeck([], itemList, fileList), [items, files]); // eslint-disable-line
  const { sum } = useStats(code, projectId, deck);
  const log = (fileId) => (e) => diagLog(projectId, { ...e, fileId });

  // ---- adding pages
  const typeUp = async (id, data) => {
    setBusy('Typing up the page… this can take a minute.');
    try {
      const t = await transcribePhoto(code, data, log(id));
      await backend.updateFile(code, projectId, id, { transcript: t, transcriptRev: Date.now(), status: 'typed', error: '', checked: false, off: [], blocks: null, blocksStamp: '', qStamp: '' });
      return true;
    } catch (e) {
      await backend.updateFile(code, projectId, id, { status: 'error', error: e.message }).catch(() => {});
      setMsg({ kind: 'error', text: e.message });
      return false;
    }
  };
  const addPhotos = async (list) => {
    setMsg(null);
    let ok = 0;
    try {
      for (let i = 0; i < list.length; i++) {
        setBusy(`Saving photo ${i + 1} of ${list.length}…`);
        const { data, width, height } = await compressImage(list[i]);
        const id = await backend.addFile(code, projectId, { kind: 'page', source: 'photo', data, w: width, h: height, status: 'new', checked: false, off: [] });
        if (await typeUp(id, data)) ok++;
      }
      if (ok) setMsg({ kind: 'ok', text: `Typed up ${ok} page${ok === 1 ? '' : 's'}. Open each page to check the typed copy.` });
    } catch (e) { setMsg({ kind: 'error', text: e.message }); }
    setBusy('');
  };
  const choosePhotos = (e) => { const list = [...e.target.files].filter((f) => f.type.startsWith('image/')); e.target.value = ''; if (list.length) addPhotos(list); };
  const addText = async (text, from = '') => {
    const pages = splitTextPages(text);
    if (!pages.length) { setMsg({ kind: 'error', text: 'There is no text to add.' }); return; }
    for (const paras of pages) await backend.addFile(code, projectId, { kind: 'page', source: 'text', from, transcript: textTranscript(paras), transcriptRev: Date.now(), status: 'typed', checked: true, off: [] });
    setMsg({ kind: 'ok', text: `Added ${pages.length} page${pages.length === 1 ? '' : 's'} of text.` });
  };
  const chooseDoc = async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    setMsg(null);
    try {
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        setBusy('Reading PDF…');
        const r = await readPdf(file, setBusy, (ev) => diagLog(projectId, ev));
        if (r.images) {
          let ok = 0;
          for (let i = 0; i < r.images.length; i++) {
            const { w, h } = await imgSize(r.images[i].data);
            const id = await backend.addFile(code, projectId, { kind: 'page', source: 'photo', data: r.images[i].data, w, h, status: 'new', checked: false, off: [], from: file.name });
            setBusy(`Typing up page ${i + 1} of ${r.images.length}…`);
            if (await typeUp(id, r.images[i].data)) ok++;
          }
          if (ok) setMsg({ kind: 'ok', text: `Typed up ${ok} scanned page${ok === 1 ? '' : 's'}. Open each page to check the typed copy.` });
        } else await addText(r.text, file.name);
      } else await addText(await readTextFile(file), file.name);
    } catch (err) { setMsg({ kind: 'error', text: err.message }); }
    setBusy('');
  };
  const addPasted = async () => { const t = paste; setPasting(false); setPaste(''); if (t.trim()) await addText(t); };

  const removePage = async (f) => {
    if (!confirm('Remove this page and the questions made from it?')) return;
    try { await backend.replaceItemsForFile(code, projectId, f.id, []); await backend.deleteFile(code, projectId, f.id); } catch (e) { setMsg({ kind: 'error', text: e.message }); }
  };

  // ---- making the questions
  const makeQuestions = async () => {
    setMsg(null);
    const ready = fileList.filter((f) => f.transcript && f.checked);
    if (!ready.length) { setMsg({ kind: 'error', text: 'Open a page, check its typed copy, and tap "This copy is right" first.' }); return; }
    const found = new Map();
    let failed = 0, lastErr = '';
    for (let i = 0; i < ready.length; i++) {
      const f = ready[i], st = stampOf(f), n = countOf(f);
      if (f.blocks && f.blocksStamp === st && (f.blocksWant || 0) >= n) { found.set(f.id, f.blocks); continue; }
      setBusy(`Finding the key information, page ${i + 1} of ${ready.length}…`);
      try {
        const blocks = await findBlocks(code, f.transcript, f.off || [], n, log(f.id));
        await backend.updateFile(code, projectId, f.id, { blocks, blocksStamp: st, blocksWant: n, error: '' });
        found.set(f.id, blocks);
      } catch (e) { failed++; lastErr = e.message; }
    }
    setBusy('Making questions…');
    const all = ready.flatMap((f) => found.get(f.id) || []);
    let total = 0; const notes = [];
    try {
      for (const f of ready) {
        const blocks = found.get(f.id); if (!blocks) continue;
        const label = `Page ${fileList.indexOf(f) + 1}`;
        const kept = itemList.filter((x) => x.fileId === f.id && x.source === 'set by you').map(({ id, createdAt, fileId, ...rest }) => rest);
        const n = countOf(f);
        const made = buildQuestions(blocks, all, n, label, f.id);
        await backend.replaceItemsForFile(code, projectId, f.id, [...made, ...kept]);
        await backend.updateFile(code, projectId, f.id, { qStamp: stampOf(f) + ':' + n, made: made.length, qNote: countNote(made.length, n) });
        total += made.length;
        const nt = countNote(made.length, n); if (nt) notes.push(`${label}: ${nt}`);
      }
    } catch (e) { setBusy(''); setMsg({ kind: 'error', text: e.message }); return; }
    setBusy('');
    if (failed) setMsg({ kind: 'error', text: `${failed} page${failed === 1 ? '' : 's'} could not be read for key information. ${lastErr}`, review: total > 0 });
    else setMsg({ kind: 'ok', review: true, text: `Made ${total} question${total === 1 ? '' : 's'} from ${ready.length} page${ready.length === 1 ? '' : 's'}. ${notes.join(' ')}`.trim() });
  };

  const del = async () => {
    if (confirm('Delete this project and its material?')) { await backend.deleteProject(code, projectId); onBack(); }
  };

  if (!p || files === null || items === null) return <section><ScreenHead onBack={onBack} backLabel="Back" title="Loading…" /></section>;

  const editFile = fileList.find((f) => f.id === editing);
  if (editFile) return <PageEditor key={editFile.id} code={code} projectId={projectId} projectName={p.name} file={editFile} index={fileList.indexOf(editFile)} onClose={() => setEditing(null)} />;

  const stateOf = (f) => {
    if (f.status === 'error' && !f.transcript) return { text: 'Could not type up', cls: 'bad' };
    if (!f.transcript) return { text: 'Not typed yet', cls: 'warn' };
    if (!f.checked) return { text: 'Check the typed copy', cls: 'warn' };
    const made = itemList.filter((x) => x.fileId === f.id).length;
    if (!made && !f.qStamp) return { text: `Ready · up to ${countOf(f)} questions`, cls: '' };
    if (f.qStamp !== stampOf(f) + ':' + countOf(f)) return { text: 'Changed. Make questions again', cls: 'warn' };
    return { text: `${made} question${made === 1 ? '' : 's'} (up to ${countOf(f)})`, cls: 'good' };
  };
  const readyCount = fileList.filter((f) => f.transcript && f.checked).length;
  const needCheck = fileList.filter((f) => f.transcript && !f.checked).length;

  return (
    <section className="rd">
      <ScreenHead onBack={onBack} backLabel={`${profile.name}'s projects`} icon={<span className="head-ic"><Icon name="text" size={26} /></span>} title={shortName(p.name)} />
      <p className="muted tiny rd-sub">Reading project{p.createdAt ? ` · ${niceDate(p.createdAt)}` : ''} · Test account only</p>

      {deck.length > 0 && (
        <>
          <StatsStrip sum={sum} />
          <div className="modes">
            <button className="mode-tile flash" onClick={() => onStudy('flash', deck)}><TileArt kind="flash" /><span>Flashcards</span></button>
            <button className="mode-tile quiz" onClick={() => onStudy('quiz', deck)}><TileArt kind="quiz" /><span>Written quiz</span></button>
            <button className="mode-tile voice" onClick={() => onStudy('voice', deck)}><TileArt kind="voice" /><span>Voice quiz</span></button>
            <button className="mode-tile mat" onClick={onReview}><TileArt kind="folder" /><span>Review questions</span></button>
          </div>
        </>
      )}

      <div className="label">Pages</div>
      {fileList.length === 0 && <div className="empty"><p>No pages yet.</p><p className="muted">Add a photo, a PDF or some text. Each page is typed up first, so you can check it.</p></div>}
      <ul className="list">
        {fileList.map((f, i) => {
          const s = stateOf(f);
          return (
            <li key={f.id} className="rd-row">
              <button className="card-row" onClick={() => setEditing(f.id)} aria-label={`Open page ${i + 1}`}>
                <span className="rd-thumb">{f.data ? <img src={f.data} alt="" /> : <Icon name="text" size={26} />}</span>
                <span className="row-main">
                  <span className="row-title">Page {i + 1}{f.from ? <span className="muted tiny"> · {f.from}</span> : null}</span>
                  <span className={'rd-state ' + s.cls}>{s.text}</span>
                </span>
                <Icon name="right" className="row-go" />
              </button>
              <button className="rd-x" aria-label={`Remove page ${i + 1}`} onClick={() => removePage(f)}>×</button>
            </li>
          );
        })}
      </ul>

      <div className="add-row">
        <button className="btn ghost" disabled={!!busy} onClick={() => cam.current.click()}><Icon name="camera" />Take photo</button>
        <button className="btn ghost" disabled={!!busy} onClick={() => gallery.current.click()}><Icon name="image" />Photos</button>
        <button className="btn ghost" disabled={!!busy} onClick={() => doc.current.click()}><Icon name="file" />PDF or text file</button>
        <button className="btn ghost" disabled={!!busy} onClick={() => setPasting(true)}><Icon name="text" />Paste text</button>
      </div>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={choosePhotos} data-testid="in-camera" />
      <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={choosePhotos} data-testid="in-photos" />
      <input ref={doc} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" hidden onChange={chooseDoc} data-testid="in-doc" />

      {busy && <p className="hint" role="status">{busy}</p>}
      {msg && (
        <div className={msg.kind === 'ok' ? 'okmsg' : 'error'} role={msg.kind === 'ok' ? 'status' : 'alert'}>
          {msg.text}
          {msg.review && <button className="link inline" onClick={onReview}>Review questions</button>}
        </div>
      )}
      {needCheck > 0 && <p className="hint"><Icon name="alert" size={20} />{needCheck} page{needCheck === 1 ? ' needs' : 's need'} a look. Open it, check the typed copy, then tap "This copy is right".</p>}

      <button className="btn primary" disabled={!!busy || !readyCount} onClick={makeQuestions} data-testid="make-questions">
        <Icon name="sparkle" />{itemList.length ? 'Make the questions again' : `Make questions${readyCount ? ` from ${readyCount} page${readyCount === 1 ? '' : 's'}` : ''}`}
      </button>
      {itemList.length > 0 && <button className="btn ghost" onClick={onReview}><Icon name="list" />Review questions ({itemList.length})</button>}
      <button className="link danger" onClick={del}><Icon name="trash" size={18} />Delete project</button>

      {pasting && (
        <div className="rd-modal" role="dialog" aria-label="Paste text">
          <div className="sheet rd-sheet">
            <label htmlFor="rd-paste">Paste the text</label>
            <textarea id="rd-paste" className="material" autoFocus value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste a chapter, an article, a play scene or your notes. Blank lines separate paragraphs." />
            <p className="muted tiny">Long text is split into pages. You can check and untick parts next.</p>
            <div className="row">
              <button className="btn ghost" onClick={() => { setPasting(false); setPaste(''); }}>Cancel</button>
              <button className="btn primary" disabled={!paste.trim()} onClick={addPasted}>Add text</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ one page: typed copy next to the original

function PageEditor({ code, projectId, projectName, file, index, onClose }) {
  const t0 = file.transcript || { layout: true, lines: [], figures: [], kind: 'printed' };
  const layout = t0.layout !== false;
  const [lines, setLines] = useState(t0.lines || []);
  const [off, setOff] = useState(file.off || []);
  const [sel, setSel] = useState(null);
  const [hl, setHl] = useState(null);
  const [fade, setFade] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [count, setCountState] = useState(file.count || null); // null = the suggestion
  const [custom, setCustom] = useState('');
  const pageRef = useRef(null), topRef = useRef(null);
  const latest = useRef({}); latest.current = { lines, off };
  const timer = useRef(null);
  const drag = useRef(null);

  // a fresh typed copy (typed again) replaces what is on screen
  useEffect(() => { setLines((file.transcript && file.transcript.lines) || []); setOff(file.off || []); setSel(null); setHl(null); }, [file.transcriptRev]); // eslint-disable-line

  const flush = () => {
    clearTimeout(timer.current); timer.current = null;
    return backend.updateFile(code, projectId, file.id, { transcript: { ...t0, lines: latest.current.lines }, off: latest.current.off });
  };
  const persist = () => { clearTimeout(timer.current); timer.current = setTimeout(() => flush().catch(() => {}), 600); };
  useEffect(() => () => { if (timer.current) flush().catch(() => {}); }, []); // eslint-disable-line

  const t = { ...t0, lines };
  const chunks = useMemo(() => makeChunks({ ...t0, lines }), [lines]); // eslint-disable-line
  const ratio = file.w && file.h ? file.h / file.w : 4 / 3;
  const selLine = lines.find((l) => l.id === sel);
  const hlChunk = chunks.find((c) => c.id === hl);

  const edit = (id, patch) => { setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l))); persist(); };
  const removeLine = (id) => { setLines((ls) => ls.filter((l) => l.id !== id)); setOff((o) => o.filter((x) => x !== id)); setSel(null); persist(); };
  const addLine = () => {
    const id = 'n' + Date.now();
    const hs = lines.map((l) => l.h).sort((a, b) => a - b);
    const h = hs[Math.floor(hs.length / 2)] || 0.025;
    setLines((ls) => [...ls, layout ? { id, text: '', x: 0.1, y: 0.5, w: 0.3, h, marks: [], conf: 'high' } : { id, text: '', marks: [], conf: 'high' }]);
    setSel(id); persist();
  };

  const toggleChunk = (c) => {
    const ids = c.lines.map((l) => l.id);
    const on = ids.every((id) => !off.includes(id));
    setOff(on ? [...new Set([...off, ...ids])] : off.filter((id) => !ids.includes(id))); persist();
  };
  const onlyChunk = (c) => { const keep = new Set(c.lines.map((l) => l.id)); setOff(lines.filter((l) => !keep.has(l.id)).map((l) => l.id)); persist(); };
  const allOn = () => { setOff([]); persist(); };
  const showChunk = (c) => { setHl(hl === c.id ? null : c.id); if (layout) topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  // moving a selected piece: press it and drag
  const down = (e, l) => {
    if (sel !== l.id) { setSel(l.id); return; }
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = pageRef.current.getBoundingClientRect();
    drag.current = { id: l.id, sx: e.clientX, sy: e.clientY, x: l.x, y: l.y, w: r.width, h: r.height };
  };
  const move = (e) => {
    const d = drag.current; if (!d) return;
    const x = clamp(d.x + (e.clientX - d.sx) / d.w, 0, 0.98), y = clamp(d.y + (e.clientY - d.sy) / d.h, 0, 0.99);
    setLines((ls) => ls.map((l) => (l.id === d.id ? { ...l, x, y } : l)));
  };
  const up = () => { if (drag.current) { drag.current = null; persist(); } };

  const suggested = suggestCount({ ...t0, lines }, off);
  const n = count || suggested;
  const pickCount = (v) => { const c = cleanCount(v); setCountState(c); setCustom(''); backend.updateFile(code, projectId, file.id, { count: c }).catch(() => {}); };
  const confirmed = async () => {
    try { await flush(); await backend.updateFile(code, projectId, file.id, { checked: true, count: n }); onClose(); } catch (e) { setNote(e.message); }
  };
  const retype = async () => {
    if (!confirm('Type this page up again? This replaces the typed copy, including your changes.')) return;
    setBusy('Typing up the page…'); setNote('');
    try {
      const nt = await transcribePhoto(code, file.data, (e) => diagLog(projectId, { ...e, fileId: file.id }));
      await backend.updateFile(code, projectId, file.id, { transcript: nt, transcriptRev: Date.now(), status: 'typed', error: '', checked: false, off: [], blocks: null, blocksStamp: '', qStamp: '' });
    } catch (e) { setNote(e.message); }
    setBusy('');
  };
  const base = `${(projectName || 'page').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 80)} page ${index + 1}`;
  const copyText = async () => { try { await navigator.clipboard.writeText(layoutText(t)); setNote('Copied.'); } catch { setNote('Could not copy. Use Save as text instead.'); } };
  const saveText = () => saveBlob(new Blob([layoutText(t)], { type: 'text/plain' }), base + '.txt');
  const savePicture = async () => saveBlob(await pictureOf(t, ratio), base + ' typed.png');

  const blockCounts = {};
  (file.blocks || []).forEach((b) => { blockCounts[b.type] = (blockCounts[b.type] || 0) + 1; });
  const fs = (l) => (l.h * ratio * 100 * 0.85).toFixed(2) + 'cqw';

  return (
    <section className="rd rd-edit">
      <ScreenHead onBack={onClose} backLabel="Pages" icon={<span className="head-ic"><Icon name={layout ? 'image' : 'text'} size={26} /></span>} title={`Page ${index + 1}`} />
      <div ref={topRef} />

      {layout ? (
        <>
          <p className="muted tiny">Typed copy with the same layout as the page. Tap a piece to fix its words. Press and drag a selected piece to move it.</p>
          {file.data && (
            <div className="rd-fade">
              <button className="link inline" onClick={() => setFade(0)}>Original</button>
              <input type="range" min="0" max="100" value={Math.round(fade * 100)} onChange={(e) => setFade(e.target.value / 100)} aria-label="Fade between the original and the typed copy" />
              <button className="link inline" onClick={() => setFade(1)}>Typed</button>
              <button className="link inline" onClick={() => setZoom(zoom === 1 ? 2 : 1)}>{zoom === 1 ? 'Zoom in' : 'Zoom out'}</button>
            </div>
          )}
          <div className="rd-scroll">
            <div ref={pageRef} className="rd-page" style={{ width: `${zoom * 100}%`, paddingBottom: `${ratio * zoom * 100}%` }} data-testid="page-copy">
              {file.data && <img className="rd-photo" src={file.data} alt={`Original page ${index + 1}`} />}
              <div className="rd-typed" style={{ opacity: file.data ? fade : 1 }} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
                {(t0.figures || []).map((f, i) => <div key={i} className="rd-fig" style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` }}><span>{f.label || 'Picture'}</span></div>)}
                {lines.map((l) => (
                  <div key={l.id} data-testid="piece"
                    className={'rd-piece' + (off.includes(l.id) ? ' off' : '') + (sel === l.id ? ' sel' : '') + (l.conf === 'low' ? ' low' : '') + l.marks.map((m) => ' m-' + m).join('')}
                    style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, fontSize: fs(l) }}
                    onPointerDown={(e) => down(e, l)}>{l.marks.includes('star') ? '★ ' : ''}{l.text}</div>
                ))}
                {hlChunk && hlChunk.box && <div className="rd-hl" style={{ left: `${hlChunk.box.x * 100 - 1}%`, top: `${hlChunk.box.y * 100 - 0.6}%`, width: `${hlChunk.box.w * 100 + 2}%`, height: `${hlChunk.box.h * 100 + 1.2}%` }} />}
              </div>
            </div>
          </div>
          {selLine && (
            <div className="rd-edit-bar">
              <input className="big-input" value={selLine.text} autoFocus aria-label="Words of the selected piece" onChange={(e) => edit(selLine.id, { text: e.target.value })} />
              <div className="row">
                <button className="btn ghost" onClick={() => removeLine(selLine.id)}><Icon name="trash" size={18} />Delete</button>
                <button className="btn primary" onClick={() => setSel(null)}>Done</button>
              </div>
            </div>
          )}
          <button className="btn ghost small" onClick={addLine}><Icon name="plus" size={18} />Add missing text</button>
        </>
      ) : (
        <p className="muted tiny">This is the text you added. Fix the words, and tick which parts to use.</p>
      )}

      <div className="label">Use as source material</div>
      <p className="muted tiny">Ticked parts are used for questions. Unticked parts are greyed out.</p>
      <div className="row">
        <button className="btn ghost small" onClick={allOn}>Tick all</button>
        {!layout && <button className="btn ghost small" onClick={addLine}><Icon name="plus" size={18} />Add paragraph</button>}
      </div>
      <ul className="rd-chunks">
        {chunks.map((c, i) => {
          const on = c.lines.every((l) => !off.includes(l.id));
          return (
            <li key={c.id} className={'rd-chunk' + (on ? '' : ' off') + (hl === c.id ? ' hl' : '')} data-testid="chunk">
              <label className="rd-tick"><input type="checkbox" checked={on} onChange={() => toggleChunk(c)} aria-label={`Use part ${i + 1}`} /><span>Part {i + 1}</span></label>
              {layout
                ? <button className="rd-body" onClick={() => showChunk(c)} aria-label={`Show part ${i + 1} on the page`}><pre>{chunkPreview(t, c)}</pre></button>
                : <textarea className="rd-text" value={c.lines[0].text} aria-label={`Text of part ${i + 1}`} onChange={(e) => edit(c.lines[0].id, { text: e.target.value })} />}
              <div className="rd-chunk-actions">
                <button className="link inline" onClick={() => onlyChunk(c)}>Only this</button>
                {!layout && <button className="link inline danger" onClick={() => removeLine(c.lines[0].id)}>Delete</button>}
              </div>
            </li>
          );
        })}
        {chunks.length === 0 && <li className="muted">No text on this page.</li>}
      </ul>

      {(file.blocks || []).length > 0 && (
        <p className="muted tiny">Key information found: {Object.entries(blockCounts).map(([k, n]) => `${n} ${(BLOCK_LABEL[k] || k).toLowerCase()}${n === 1 ? '' : 's'}`).join(', ')}.</p>
      )}

      <div className="label">Questions for this page</div>
      <div className="rd-counts" role="group" aria-label="Questions for this page">
        {COUNT_CHOICES.map((c) => <button key={c} className={'rd-chip' + (n === c && !custom ? ' on' : '')} onClick={() => pickCount(c)}>{c}</button>)}
        <input className={'rd-num' + (!COUNT_CHOICES.includes(n) && !custom ? ' on' : '')} inputMode="numeric" aria-label="Other number of questions" placeholder="Other" value={custom || (COUNT_CHOICES.includes(n) ? '' : String(n))}
          onChange={(e) => setCustom(e.target.value.replace(/\D/g, '').slice(0, 2))}
          onBlur={() => custom && pickCount(custom)} onKeyDown={(e) => e.key === 'Enter' && custom && pickCount(custom)} />
      </div>
      <p className="muted tiny">{count ? `Up to ${n} questions.` : `Suggested for how much this page has: ${suggested}.`} A page with little in it makes fewer, so nothing is padded.</p>

      <div className="label">Keep this page</div>
      <div className="add-row">
        <button className="btn ghost" onClick={copyText}><Icon name="copy" />Copy text</button>
        <button className="btn ghost" onClick={saveText}><Icon name="file" />Save as text</button>
        {layout && <button className="btn ghost" onClick={savePicture}><Icon name="image" />Save as picture</button>}
        {file.data && <button className="btn ghost" disabled={!!busy} onClick={retype}><Icon name="repeat" />Type it again</button>}
      </div>
      {busy && <p className="hint" role="status">{busy}</p>}
      {note && <p className="muted tiny" role="status">{note}</p>}
      {file.status === 'error' && file.error && <p className="error" role="alert">{file.error}</p>}
      <button className="btn primary" onClick={confirmed} disabled={!!busy || !lines.length} data-testid="confirm-page"><Icon name="check" />{file.checked ? 'Save and close' : 'This copy is right'}</button>
    </section>
  );
}

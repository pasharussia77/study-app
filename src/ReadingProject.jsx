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
import ReportSheet from './Report.jsx';
import {
  BLOCK_LABEL, transcribePhoto, findBlocks, buildQuestions, countQuestions, blockLine, readingReport,
  splitTextPages, textTranscript, makeChunks, layoutText, chunkPreview
} from './reading.js';

const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return String(h); };
// What the questions were made from: the ticked text of the page. If it changes, the questions are out of date.
export const stampOf = (f) => (f.transcript ? hash(layoutText(f.transcript, { off: f.off || [] })) : '');
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
// Which ticked blocks the questions were made from, and how many per fact.
const blocksSig = (f) => hash(JSON.stringify((f.blocks || []).map((b) => [b.id, b.on !== false])));
const blocksFresh = (f) => !!f.blocks && f.blocksStamp === stampOf(f);

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

export default function ReadingProject({ code, projectId, profile, onBack, onStudy, onReview, onSpeechTest }) {
  const [p, setP] = useState(null);
  const [files, setFiles] = useState(null);
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [editing, setEditing] = useState(null); // file id
  const [pasting, setPasting] = useState(false);
  const [paste, setPaste] = useState('');
  const [blocksOpen, setBlocksOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const cam = useRef(null), gallery = useRef(null), doc = useRef(null);

  useEffect(() => { backend.getProject(code, projectId).then(setP); }, [code, projectId]);
  useEffect(() => backend.watchFiles(code, projectId, setFiles), [code, projectId]);
  useEffect(() => backend.watchItems(code, projectId, setItems), [code, projectId]);
  useOverlay(editing !== null, () => setEditing(null));
  useOverlay(pasting, () => setPasting(false));
  useOverlay(blocksOpen, () => setBlocksOpen(false));
  useOverlay(reporting, () => setReporting(false));

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

  // ---- step 1: find the information blocks on approved pages
  const approved = fileList.filter((f) => f.transcript && f.checked);
  const toFind = approved.filter((f) => !blocksFresh(f));
  const withBlocks = approved.filter(blocksFresh);
  const perFact = (p && p.perFact) || 1;
  const findAll = async () => {
    setMsg(null);
    let failed = 0, found = 0, lastErr = '';
    for (let i = 0; i < toFind.length; i++) {
      const f = toFind[i];
      setBusy(`Finding information blocks, page ${i + 1} of ${toFind.length}…`);
      try {
        const blocks = await findBlocks(code, f.transcript, f.off || [], log(f.id));
        await backend.updateFile(code, projectId, f.id, { blocks, blocksStamp: stampOf(f), error: '' });
        found += blocks.length;
      } catch (e) { failed++; lastErr = e.message; }
    }
    setBusy('');
    if (failed) setMsg({ kind: 'error', text: `${failed} page${failed === 1 ? '' : 's'} could not be read for information blocks. ${lastErr}` });
    else setMsg({ kind: 'ok', text: `${found} information block${found === 1 ? '' : 's'} found. Review them if you like, then make the questions.`, blocks: true });
  };
  const setPerFact = async (n) => { setP((x) => ({ ...x, perFact: n })); try { await backend.updateProject(code, projectId, { perFact: n }); } catch {} };
  const toggleBlock = async (f, id, on) => {
    const blocks = (f.blocks || []).map((b) => (id === '*' || b.id === id ? { ...b, on } : b));
    try { await backend.updateFile(code, projectId, f.id, { blocks }); } catch (e) { setMsg({ kind: 'error', text: e.message }); }
  };
  const allBlocks = withBlocks.flatMap((f) => f.blocks || []);
  const tickedBlocks = allBlocks.filter((b) => b.on !== false).length;
  const willMake = useMemo(() => countQuestions(withBlocks, perFact), [files, perFact]); // eslint-disable-line
  const madeFrom = (f) => blocksSig(f) + ':' + perFact;
  const stale = withBlocks.some((f) => f.qStamp !== madeFrom(f) || f.qText !== stampOf(f));

  // ---- step 2: make the questions from the ticked blocks (no AI)
  const makeQuestions = async () => {
    setMsg(null); setBusy('Making questions…');
    let total = 0;
    try {
      for (const f of withBlocks) {
        const label = `Page ${fileList.indexOf(f) + 1}`;
        const kept = itemList.filter((x) => x.fileId === f.id && x.source === 'set by you').map(({ id, createdAt, fileId, ...rest }) => rest);
        const made = buildQuestions(f.blocks || [], allBlocks, perFact, label, f.id);
        await backend.replaceItemsForFile(code, projectId, f.id, [...made, ...kept]);
        await backend.updateFile(code, projectId, f.id, { qStamp: madeFrom(f), qText: stampOf(f), made: made.length });
        total += made.length;
      }
    } catch (e) { setBusy(''); setMsg({ kind: 'error', text: e.message }); return; }
    setBusy('');
    setMsg({ kind: 'ok', review: true, text: `Made ${total} question${total === 1 ? '' : 's'} from ${tickedBlocks} information block${tickedBlocks === 1 ? '' : 's'}.` });
  };

  const del = async () => {
    if (confirm('Delete this project and its material?')) { await backend.deleteProject(code, projectId); onBack(); }
  };

  if (!p || files === null || items === null) return <section><ScreenHead onBack={onBack} backLabel="Back" title="Loading…" /></section>;

  if (blocksOpen) return <BlocksView files={withBlocks} allFiles={fileList} perFact={perFact} willMake={willMake} onToggle={toggleBlock} onClose={() => setBlocksOpen(false)} />;
  const editFile = fileList.find((f) => f.id === editing);
  if (editFile) return <PageEditor key={editFile.id} code={code} projectId={projectId} projectName={p.name} file={editFile} index={fileList.indexOf(editFile)} onClose={() => setEditing(null)} />;

  const stateOf = (f) => {
    if (f.status === 'error' && !f.transcript) return { text: 'Could not type up', cls: 'bad' };
    if (!f.transcript) return { text: 'Not typed yet', cls: 'warn' };
    if (!f.checked) return { text: 'Check the typed copy', cls: 'warn' };
    if (!f.blocks) return { text: 'Approved · find blocks next', cls: '' };
    if (!blocksFresh(f)) return { text: 'Changed · find blocks again', cls: 'warn' };
    const on = f.blocks.filter((b) => b.on !== false).length;
    const made = itemList.filter((x) => x.fileId === f.id).length;
    return { text: `${on} of ${f.blocks.length} blocks ticked${made ? ` · ${made} questions` : ''}`, cls: made ? 'good' : '' };
  };
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
          {msg.blocks && <button className="link inline" onClick={() => setBlocksOpen(true)}>Review blocks</button>}
        </div>
      )}
      {needCheck > 0 && <p className="hint"><Icon name="alert" size={20} />{needCheck} page{needCheck === 1 ? ' needs' : 's need'} a look. Open it, check the typed copy, then tap "Approve this page".</p>}

      {toFind.length > 0 && (
        <button className="btn primary" disabled={!!busy} onClick={findAll} data-testid="find-blocks">
          <Icon name="sparkle" />Find information blocks ({toFind.length} page{toFind.length === 1 ? '' : 's'})
        </button>
      )}
      {withBlocks.length > 0 && (
        <div className="rd-card" data-testid="blocks-card">
          <p className="rd-big"><b>{allBlocks.length}</b> information block{allBlocks.length === 1 ? '' : 's'} found · <b>{tickedBlocks}</b> ticked</p>
          <button className="btn ghost" onClick={() => setBlocksOpen(true)} data-testid="review-blocks"><Icon name="list" />Review blocks</button>
          <div className="label">Questions per fact</div>
          <div className="rd-counts" role="group" aria-label="Questions per fact">
            {[1, 2, 3].map((n) => <button key={n} className={'rd-chip' + (perFact === n ? ' on' : '')} onClick={() => setPerFact(n)} aria-pressed={perFact === n}>{n}</button>)}
          </div>
          <p className="muted tiny">{perFact === 1 ? 'One question for each fact, so nothing is asked twice.' : `Up to ${perFact} questions on each fact, each in a different form.`}</p>
          <button className="btn primary" disabled={!!busy || !willMake} onClick={makeQuestions} data-testid="make-questions">
            <Icon name="sparkle" />{itemList.length && !stale ? `Questions are up to date (${willMake})` : `Make ${willMake} question${willMake === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
      {itemList.length > 0 && <button className="btn ghost" onClick={onReview}><Icon name="list" />Review questions ({itemList.length})</button>}
      <div className="testtools">
        <b><Icon name="flask" size={18} /> Testing tools</b>
        <p className="muted tiny">Creates a report of the typed pages, the blocks found and the questions made. Paste it to Claude.</p>
        <button className="btn ghost" onClick={() => setReporting(true)}>Create diagnostic report</button>
        <b><Icon name="flask" size={18} /> Speech recognition test</b>
        <p className="muted tiny">A scripted test with the trickiest words, about 5 minutes. It ends with a report to send to Claude.</p>
        <button className="btn ghost" onClick={onSpeechTest}><Icon name="mic" />Run the speech test</button>
      </div>
      <button className="link danger" onClick={del}><Icon name="trash" size={18} />Delete project</button>
      {reporting && <ReportSheet code={code} project={p} profile={profile} text="" deck={deck} extra={readingReport(fileList, itemList, perFact)} onClose={() => setReporting(false)} />}

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

// ------------------------------------------------------------------ all blocks, ticked or not

function BlocksView({ files, allFiles, perFact, willMake, onToggle, onClose }) {
  const all = files.flatMap((f) => f.blocks || []);
  const on = all.filter((b) => b.on !== false).length;
  return (
    <section className="rd rd-blocks">
      <ScreenHead onBack={onClose} backLabel="Pages" icon={<span className="head-ic"><Icon name="list" size={26} /></span>} title="Information blocks" />
      <p className="muted" data-testid="blocks-summary">{all.length} found · {on} ticked · {willMake} question{willMake === 1 ? '' : 's'} at {perFact} per fact</p>
      <p className="muted tiny">Untick a block you don't need. Each ticked block gets {perFact === 1 ? 'one question' : `up to ${perFact} questions`}.</p>
      {files.map((f) => {
        const list = f.blocks || [];
        const allOn = list.every((b) => b.on !== false);
        return (
          <div key={f.id} className="igroup">
            <div className="igroup-head">
              <b>Page {allFiles.indexOf(f) + 1}</b>
              <span className="muted tiny">{list.filter((b) => b.on !== false).length} of {list.length}</span>
              <button className="link inline" onClick={() => onToggle(f, '*', !allOn)}>{allOn ? 'Untick all' : 'Tick all'}</button>
            </div>
            <ul className="rd-chunks">
              {list.map((b) => (
                <li key={b.id} className={'rd-chunk' + (b.on === false ? ' off' : '')} data-testid="block">
                  <label className="rd-tick">
                    <input type="checkbox" checked={b.on !== false} onChange={(e) => onToggle(f, b.id, e.target.checked)} aria-label={`Use block: ${blockLine(b)}`} />
                    <span className="ttype">{BLOCK_LABEL[b.type] || b.type}</span>
                    {b.important && <span className="tag">Important</span>}
                  </label>
                  <p className="rd-line">{blockLine(b)}</p>
                  <p className="muted tiny rd-from">From the page: {b.source}{b.grounded ? '' : ' (check: the answer is not word for word in it)'}</p>
                </li>
              ))}
              {list.length === 0 && <li className="muted">No information blocks on this page.</li>}
            </ul>
          </div>
        );
      })}
      <button className="btn primary" onClick={onClose}><Icon name="check" />Done</button>
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
  const [locked, setLocked] = useState(true);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [vpW, setVpW] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const vpRef = useRef(null), topRef = useRef(null);
  const latest = useRef({}); latest.current = { lines, off, view };
  const timer = useRef(null);
  const ptrs = useRef(new Map());
  const gest = useRef(null);

  // a fresh typed copy (typed again) replaces what is on screen
  useEffect(() => { setLines((file.transcript && file.transcript.lines) || []); setOff(file.off || []); setSel(null); setHl(null); }, [file.transcriptRev]); // eslint-disable-line
  useEffect(() => {
    const el = vpRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setVpW(el.clientWidth)); ro.observe(el); setVpW(el.clientWidth);
    return () => ro.disconnect();
  }, [layout]);

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

  // ---- zoom and move with the fingers
  const pageH = vpW * ratio;
  const vpH = Math.round(Math.min(pageH || 1, (typeof window !== 'undefined' ? window.innerHeight : 800) * 0.7));
  const fit = (v) => {
    const s = clamp(v.s, 1, 6);
    return { s, x: clamp(v.x, Math.min(0, vpW - vpW * s), 0), y: clamp(v.y, Math.min(0, vpH - pageH * s), 0) };
  };
  const zoomAt = (factor, cx = vpW / 2, cy = vpH / 2) => setView((v) => { const s = clamp(v.s * factor, 1, 6); return fit({ s, x: cx - (cx - v.x) * (s / v.s), y: cy - (cy - v.y) * (s / v.s) }); });
  const rel = (e) => { const r = vpRef.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const startPan = (pt, pid) => { const v = latest.current.view; gest.current = { type: 'pan', sx: pt.x, sy: pt.y, x0: v.x, y0: v.y, moved: false, pid }; };
  const down = (e) => {
    try { vpRef.current.setPointerCapture(e.pointerId); } catch {}
    const pt = rel(e); ptrs.current.set(e.pointerId, pt);
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()]; const v = latest.current.view;
      gest.current = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ...v };
      return;
    }
    const piece = e.target.closest && e.target.closest('[data-pid]');
    const pid = piece ? piece.dataset.pid : null;
    if (!locked && pid && pid === sel) {
      const l = latest.current.lines.find((x) => x.id === pid);
      gest.current = { type: 'piece', id: pid, sx: pt.x, sy: pt.y, px: l.x, py: l.y };
    } else startPan(pt, pid);
  };
  const move = (e) => {
    if (!ptrs.current.has(e.pointerId)) return;
    const pt = rel(e); ptrs.current.set(e.pointerId, pt);
    const g = gest.current; if (!g) return;
    if (g.type === 'pinch' && ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const s = clamp(g.s * d / g.d0, 1, 6);
      const cx = (g.m0.x - g.x) / g.s, cy = (g.m0.y - g.y) / g.s;
      setView(fit({ s, x: m.x - cx * s, y: m.y - cy * s }));
    } else if (g.type === 'pan') {
      const dx = pt.x - g.sx, dy = pt.y - g.sy;
      if (Math.abs(dx) + Math.abs(dy) > 8) g.moved = true;
      if (g.moved) setView((v) => fit({ ...v, x: g.x0 + dx, y: g.y0 + dy }));
    } else if (g.type === 'piece') {
      const s = latest.current.view.s;
      const x = clamp(g.px + (pt.x - g.sx) / (vpW * s), 0, 0.98), y = clamp(g.py + (pt.y - g.sy) / (pageH * s), 0, 0.99);
      setLines((ls) => ls.map((l) => (l.id === g.id ? { ...l, x, y } : l)));
    }
  };
  const up = (e) => {
    ptrs.current.delete(e.pointerId);
    const g = gest.current;
    if (g && g.type === 'pan' && !g.moved) setSel(g.pid || null);   // a tap picks a piece (or clears the pick)
    if (g && g.type === 'piece') persist();
    if (g && g.type === 'pinch' && ptrs.current.size === 1) { startPan([...ptrs.current.values()][0], null); gest.current.moved = true; return; }
    if (!ptrs.current.size) gest.current = null;
  };

  const edit = (id, patch) => { setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l))); persist(); };
  const removeLine = (id) => { setLines((ls) => ls.filter((l) => l.id !== id)); setOff((o) => o.filter((x) => x !== id)); setSel(null); persist(); };
  const addLine = () => {
    const id = 'n' + Date.now();
    const hs = lines.map((l) => l.h).sort((a, b) => a - b);
    const h = hs[Math.floor(hs.length / 2)] || 0.025;
    const y = layout && pageH ? clamp((vpH / 2 - view.y) / (pageH * view.s), 0, 0.95) : 0.5;
    const x = layout && vpW ? clamp((vpW * 0.15 - view.x) / (vpW * view.s), 0, 0.9) : 0.1;
    setLines((ls) => [...ls, layout ? { id, text: '', x, y, w: 0.3, h, marks: [], conf: 'high' } : { id, text: '', marks: [], conf: 'high' }]);
    setSel(id); persist();
  };

  const toggleChunk = (c) => {
    const ids = c.lines.map((l) => l.id);
    const on = ids.every((id) => !off.includes(id));
    setOff(on ? [...new Set([...off, ...ids])] : off.filter((id) => !ids.includes(id))); persist();
  };
  const allOn = () => { setOff([]); persist(); };
  const showChunk = (c) => { setHl(hl === c.id ? null : c.id); if (layout) topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  const confirmed = async () => {
    try { await flush(); await backend.updateFile(code, projectId, file.id, { checked: true }); onClose(); } catch (e) { setNote(e.message); }
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

  // Text shrinks to fit the width it had on the paper, so nothing runs off the edge or over other text.
  const fs = (l) => Math.min(l.h * ratio * 100 * 0.85, (l.w * 100) / (Math.max(l.text.length, 1) * 0.5)).toFixed(2) + 'cqw';

  return (
    <section className="rd rd-edit">
      <ScreenHead onBack={onClose} backLabel="Pages" icon={<span className="head-ic"><Icon name={layout ? 'image' : 'text'} size={26} /></span>} title={`Page ${index + 1}`} />
      <div ref={topRef} />

      {layout ? (
        <>
          <p className="muted tiny">Typed copy with the same layout as the page. Pinch to zoom, drag to move around. Tap a piece to fix its words.</p>
          <div className="rd-fade">
            {file.data && <button className="link inline" onClick={() => setFade(0)}>Original</button>}
            {file.data && <input type="range" min="0" max="100" value={Math.round(fade * 100)} onChange={(e) => setFade(e.target.value / 100)} aria-label="Fade between the original and the typed copy" />}
            {file.data && <button className="link inline" onClick={() => setFade(1)}>Typed</button>}
          </div>
          <div className="rd-tools">
            <button className="rd-round" onClick={() => zoomAt(1 / 1.5)} aria-label="Zoom out" disabled={view.s <= 1}>−</button>
            <button className="rd-round" onClick={() => zoomAt(1.5)} aria-label="Zoom in" disabled={view.s >= 6}>+</button>
            <button className="link inline" onClick={() => setView({ s: 1, x: 0, y: 0 })} disabled={view.s === 1 && !view.x && !view.y}>Fit</button>
            <span className="muted tiny" data-testid="zoom">{Math.round(view.s * 100)}%</span>
            <button className={'chip rd-lock' + (locked ? '' : ' open')} onClick={() => { setLocked(!locked); }} aria-pressed={!locked} data-testid="lock">
              <Icon name={locked ? 'lock' : 'edit'} size={16} />{locked ? 'Pieces locked' : 'Moving pieces'}
            </button>
          </div>
          {!locked && <p className="hint tiny">Tap a piece, then press and drag it. Tap "Moving pieces" to lock them again.</p>}
          <div ref={vpRef} className="rd-vp" style={{ height: vpH || undefined }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-testid="viewport">
            <div className="rd-page" style={{ paddingBottom: `${ratio * 100}%`, transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }} data-testid="page-copy">
              {file.data && <img className="rd-photo" src={file.data} alt={`Original page ${index + 1}`} draggable="false" />}
              <div className="rd-typed" style={{ opacity: file.data ? fade : 1 }}>
                {(t0.figures || []).map((f, i) => <div key={i} className="rd-fig" style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` }}><span>{f.label || 'Picture'}</span></div>)}
                {lines.map((l) => (
                  <div key={l.id} data-testid="piece" data-pid={l.id}
                    className={'rd-piece' + (off.includes(l.id) ? ' off' : '') + (sel === l.id ? ' sel' : '') + (l.conf === 'low' ? ' low' : '') + l.marks.map((m) => ' m-' + m).join('')}
                    style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, fontSize: fs(l) }}>{l.marks.includes('star') ? '★ ' : ''}{l.text}</div>
                ))}
                {hlChunk && hlChunk.box && <div className="rd-hl" style={{ left: `${hlChunk.box.x * 100 - 1}%`, top: `${hlChunk.box.y * 100 - 0.6}%`, width: `${hlChunk.box.w * 100 + 2}%`, height: `${hlChunk.box.h * 100 + 1.2}%` }} />}
              </div>
            </div>
          </div>
          {selLine && (
            <div className="rd-edit-bar">
              <input className="big-input" value={selLine.text} aria-label="Words of the selected piece" onChange={(e) => edit(selLine.id, { text: e.target.value })} />
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
              {!layout && <div className="rd-chunk-actions"><button className="link inline danger" onClick={() => removeLine(c.lines[0].id)}>Delete</button></div>}
            </li>
          );
        })}
        {chunks.length === 0 && <li className="muted">No text on this page.</li>}
      </ul>

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
      <button className="btn primary" onClick={confirmed} disabled={!!busy || !lines.length} data-testid="confirm-page"><Icon name="check" />{file.checked ? 'Save and close' : 'Approve this page'}</button>
    </section>
  );
}

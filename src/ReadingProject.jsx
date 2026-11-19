import React, { useEffect, useMemo, useRef, useState } from 'react';
import { backend } from './firebase.js';
import { compressImage, readTextFile, readPdf } from './material.js';
import { buildDeck } from './deck.js';
import { shortName, niceDate } from './parse.js';
import { diagLog, diagGet } from './diag.js';
import { useOverlay } from './nav.js';
import { Icon } from './art.jsx';
import { ScreenHead, useStats, StatsStrip } from './Session.jsx';
import { TileArt } from './art.jsx';
import ReportSheet from './Report.jsx';
import BlockMap, { blockColor } from './BlockMap.jsx';
import {
  blockAreas,
  BLOCK_LABEL, transcribePhoto, findBlocks, buildQuestions, countQuestions, blockLine, readingReport,
  splitTextPages, textTranscript, makeChunks, layoutText, chunkPreview, checkQuestions, recheckItems, struckIds, DETAILS, DETAIL_LABEL
} from './reading.js';

const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return String(h); };
// What the questions were made from: the selected text of the page. If it changes, the questions are out of date.
export const stampOf = (f) => (f.transcript ? hash(layoutText(f.transcript, { off: f.off || [] })) : '');
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
// Which selected blocks the questions were made from, and how many per block.
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
    if (l.marks.includes('strike')) { g.beginPath(); g.moveTo(x, y - fs * 0.3); g.lineTo(x + tw, y - fs * 0.3); g.stroke(); }
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
    setBusy('Reading the page… this can take a minute.');
    try {
      const t = await transcribePhoto(code, data, log(id));
      await backend.updateFile(code, projectId, id, { transcript: t, transcriptRev: Date.now(), status: 'typed', error: '', checked: false, off: struckIds(t), blocks: null, blocksInfo: null, blocksStamp: '', qStamp: '' });
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
      if (ok) setMsg({ kind: 'ok', text: `Read ${ok} page${ok === 1 ? '' : 's'}. Open each page to check the page text.` });
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
            setBusy(`Reading page ${i + 1} of ${r.images.length}…`);
            if (await typeUp(id, r.images[i].data)) ok++;
          }
          if (ok) setMsg({ kind: 'ok', text: `Read ${ok} scanned page${ok === 1 ? '' : 's'}. Open each page to check the page text.` });
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
  const detail = DETAILS.includes(p && p.detail) ? p.detail : 'normal';
  const findAll = async () => {
    setMsg(null);
    let failed = 0, found = 0, lastErr = '';
    for (let i = 0; i < toFind.length; i++) {
      const f = toFind[i];
      setBusy(`Finding information blocks, page ${i + 1} of ${toFind.length}…`);
      try {
        const blocks = await findBlocks(code, f.transcript, f.off || [], log(f.id), detail);
        await backend.updateFile(code, projectId, f.id, { blocks, blocksInfo: blocks.info || null, blocksStamp: stampOf(f), error: '' });
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

  const unchecked = itemList.filter((x) => x.srcText && x.aiChecked !== true).length;
  const checkAgain = async () => {
    setMsg(null); setBusy('Checking the questions…');
    try { const n = await recheckItems(code, projectId, itemList, backend, log('check')); setMsg({ kind: 'ok', review: true, text: n ? `The AI check flagged ${n}. Look at them in the review.` : 'The AI check found no problems.' }); }
    catch (e) { setMsg({ kind: 'error', text: 'The AI check did not work: ' + e.message }); }
    setBusy('');
  };

  // ---- step 2: make the questions from the selected blocks (no AI for the questions, then one AI check)
  const makeQuestions = async (fresh = null) => {
    const pages = fresh || withBlocks;
    const every = pages.flatMap((f) => f.blocks || []);
    const nSel = every.filter((b) => b.on !== false).length;
    setMsg(null); setBusy('Making questions, then checking them…');
    let total = 0, flagged = 0, checkFailed = false;
    try {
      for (const f of pages) {
        const label = `Page ${fileList.indexOf(f) + 1}`;
        const kept = itemList.filter((x) => x.fileId === f.id && x.source === 'set by you').map(({ id, createdAt, fileId, ...rest }) => rest);
        const made = buildQuestions(f.blocks || [], every, perFact, label, f.id);
        let flags = null;
        try { flags = await checkQuestions(code, made, log(f.id)); } catch { checkFailed = true; }
        const marked = made.map((q, i) => flags ? { ...q, aiChecked: true, aiNote: flags.has(i) ? flags.get(i).why : '', aiKind: flags.has(i) ? flags.get(i).kind : '' } : { ...q, aiChecked: false });
        if (flags) flagged += flags.size;
        await backend.replaceItemsForFile(code, projectId, f.id, [...marked, ...kept]);
        await backend.updateFile(code, projectId, f.id, { qStamp: madeFrom(f), qText: stampOf(f), made: made.length });
        total += made.length;
      }
    } catch (e) { setBusy(''); setMsg({ kind: 'error', text: e.message }); return; }
    setBusy('');
    setMsg({ kind: 'ok', review: true, text: `Made ${total} question${total === 1 ? '' : 's'} from ${nSel} information block${nSel === 1 ? '' : 's'}. ` + (checkFailed ? 'The AI check did not work, so none are checked yet. Tap "Check again".' : flagged ? `The AI check flagged ${flagged}. Look at them in the review.` : 'The AI check found no problems.') });
  };

  // Less / More: find the blocks again at another detail level, then make the questions again.
  const refind = async (step) => {
    const next = DETAILS[DETAILS.indexOf(detail) + step];
    if (!next) return;
    setMsg(null);
    setP((x) => ({ ...x, detail: next }));
    try { await backend.updateProject(code, projectId, { detail: next }); } catch {}
    const fresh = [];
    let lastErr = '';
    for (let i = 0; i < approved.length; i++) {
      const f = approved[i];
      setBusy(`Finding blocks (${DETAIL_LABEL[next]}), page ${i + 1} of ${approved.length}…`);
      try {
        const blocks = await findBlocks(code, f.transcript, f.off || [], log(f.id), next);
        const upd = { blocks: blocks.map((b) => ({ ...b })), blocksInfo: blocks.info || null, blocksStamp: stampOf(f), error: '' };
        await backend.updateFile(code, projectId, f.id, upd);
        fresh.push({ ...f, ...upd });
      } catch (e) { lastErr = e.message; }
    }
    setBusy('');
    if (!fresh.length) { setMsg({ kind: 'error', text: 'Could not find the blocks again. ' + lastErr }); return; }
    await makeQuestions(fresh);
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
    if (!f.transcript) return { text: 'Not read yet', cls: 'warn' };
    if (!f.checked) return { text: 'Check the page text', cls: 'warn' };
    if (!f.blocks) return { text: 'Approved · find blocks next', cls: '' };
    if (!blocksFresh(f)) return { text: 'Changed · find blocks again', cls: 'warn' };
    const on = f.blocks.filter((b) => b.on !== false).length;
    const made = itemList.filter((x) => x.fileId === f.id).length;
    return { text: `${on} of ${f.blocks.length} blocks selected${made ? ` · ${made} questions` : ''}`, cls: made ? 'good' : '' };
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
            <button className="mode-tile mat" onClick={onReview} data-testid="review-tile"><TileArt kind="folder" /><span>Review questions <small className="tile-count">· {itemList.length}</small></span></button>
          </div>
        </>
      )}

      <div className="label">Pages</div>
      {fileList.length === 0 && <div className="empty"><p>No pages yet.</p><p className="muted">Add a photo, a PDF or some text. Each page is read first, so you can check it.</p></div>}
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

      <div className="add-row two">
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
      {needCheck > 0 && <p className="hint"><Icon name="alert" size={20} />{needCheck} page{needCheck === 1 ? ' needs' : 's need'} a look. Open it, check the page text, then tap "Approve this page".</p>}

      {toFind.length > 0 && (
        <button className="btn primary" disabled={!!busy} onClick={findAll} data-testid="find-blocks">
          <Icon name="sparkle" />Find information blocks ({toFind.length} page{toFind.length === 1 ? '' : 's'})
        </button>
      )}
      {withBlocks.length > 0 && (
        <div className="rd-card" data-testid="blocks-card">
          <p className="rd-big"><b>{allBlocks.length}</b> information block{allBlocks.length === 1 ? '' : 's'} found · <b>{tickedBlocks}</b> selected</p>
          <button className="btn ghost" onClick={() => setBlocksOpen(true)} data-testid="review-blocks"><Icon name="list" />Review blocks</button>
          <p className="muted tiny rd-qline" data-testid="q-line">{itemList.length} question{itemList.length === 1 ? '' : 's'} · Detail: {DETAIL_LABEL[detail]}</p>
          <div className="rd-make">
            <button className="btn ghost" disabled={!!busy || detail === DETAILS[0]} onClick={() => refind(-1)} data-testid="less">Less</button>
            <button className="btn primary" disabled={!!busy || !willMake} onClick={() => makeQuestions()} data-testid="make-questions">
              {itemList.length && !stale ? 'Remake' : `Make ${willMake} question${willMake === 1 ? '' : 's'}`}
            </button>
            <button className="btn ghost" disabled={!!busy || detail === DETAILS[DETAILS.length - 1]} onClick={() => refind(1)} data-testid="more">More</button>
          </div>
          <div className="rd-per" role="group" aria-label="Questions per block">
            <span>Questions per block</span>
            {[1, 2, 3].map((n) => <button key={n} className={'rd-chip' + (perFact === n ? ' on' : '')} onClick={() => setPerFact(n)} aria-pressed={perFact === n}>{n}</button>)}
          </div>
          <p className="muted tiny">{perFact === 1 ? 'One question for each block, so nothing is asked twice.' : `${perFact} ask the same block again in other forms (multiple choice, true/false).`}</p>
        </div>
      )}
      {itemList.length > 0 && deck.length === 0 && <button className="btn ghost" onClick={onReview}><Icon name="list" />Review questions ({itemList.length})</button>}
      {unchecked > 0 && !stale && (
        <div className="hint" data-testid="check-missing">
          The AI check has not been done for {unchecked} question{unchecked === 1 ? '' : 's'}.
          <button className="link inline" disabled={!!busy} onClick={checkAgain} data-testid="check-again">Check again</button>
        </div>
      )}
      {itemList.length > 0 && stale && withBlocks.length > 0 && <p className="muted tiny" data-testid="out-of-date">Out of date: these questions were made from earlier blocks. Tap "Make {willMake} question{willMake === 1 ? '' : 's'}" to refresh them.</p>}
      <div className="testtools">
        <b><Icon name="flask" size={18} /> Testing tools</b>
        <p className="muted tiny">Creates a report of the pages, the blocks found and the questions made. Send it to Claude.</p>
        <button className="btn ghost" onClick={() => setReporting(true)}>Create diagnostic report</button>
        <b><Icon name="flask" size={18} /> Speech recognition test</b>
        <p className="muted tiny">A scripted test with the trickiest words, about 5 minutes. It ends with a report to send to Claude.</p>
        <button className="btn ghost" onClick={onSpeechTest}><Icon name="mic" />Run the speech test</button>
      </div>
      <button className="link danger" onClick={del}><Icon name="trash" size={18} />Delete project</button>
      {reporting && <ReportSheet code={code} project={p} profile={profile} text="" deck={deck} extra={readingReport(fileList, itemList, perFact, detail, diagGet(p.id))} onClose={() => setReporting(false)} />}

      {pasting && (
        <div className="rd-modal" role="dialog" aria-label="Paste text">
          <div className="sheet rd-sheet">
            <label htmlFor="rd-paste">Paste the text</label>
            <textarea id="rd-paste" className="material" autoFocus value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste a chapter, an article, a play scene or your notes. Blank lines separate paragraphs." />
            <p className="muted tiny">Long text is split into pages. You can check and unselect parts next.</p>
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

// ------------------------------------------------------------------ all blocks, selected or not

function BlocksView({ files, allFiles, perFact, willMake, onToggle, onClose }) {
  const all = files.flatMap((f) => f.blocks || []);
  const on = all.filter((b) => b.on !== false).length;
  const [pageId, setPageId] = useState(files[0] ? files[0].id : null);
  const [active, setActive] = useState(null);
  const page = files.find((f) => f.id === pageId) || files[0];
  const areasOf = useMemo(() => new Map(files.map((f) => [f.id, f.transcript ? blockAreas(f.transcript, f.blocks || []) : new Map()])), [files]);
  // tapping a block in the list shows it on the page; tapping the page shows its block in the list
  const pick = (f, id, from) => {
    setPageId(f.id); setActive(id);
    if (from === 'map') setTimeout(() => { const el = document.querySelector(`[data-block="${id}"]`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 30);
  };
  return (
    <section className="rd rd-blocks">
      <header className="rd-blocks-head">
        <button className="back round small" onClick={onClose} aria-label="Pages"><Icon name="left" size={20} /></button>
        <h1>Information blocks</h1>
        <span className="muted tiny" data-testid="blocks-summary">{on} of {all.length} · {willMake} question{willMake === 1 ? '' : 's'}</span>
      </header>
      {page && page.transcript && (
        <div className="rd-map-pin">
          {files.length > 1 && (
            <div className="seg rd-map-tabs">{files.map((f) => <button key={f.id} className={f.id === page.id ? 'on' : ''} onClick={() => { setPageId(f.id); setActive(null); }}>Page {allFiles.indexOf(f) + 1}</button>)}</div>
          )}
          <BlockMap file={page} blocks={page.blocks || []} areas={areasOf.get(page.id)} activeId={active} onPick={(id, from) => pick(page, id, from)} />
        </div>
      )}
      {files.map((f) => {
        const list = f.blocks || [];
        const allOn = list.every((b) => b.on !== false);
        const areas = areasOf.get(f.id) || new Map();
        return (
          <div key={f.id} className="igroup">
            <div className="igroup-head">
              <b>Page {allFiles.indexOf(f) + 1}</b>
              <span className="muted tiny">{list.filter((b) => b.on !== false).length} of {list.length}</span>
              <button className="link inline" onClick={() => onToggle(f, '*', !allOn)}>{allOn ? 'Unselect all' : 'Select all'}</button>
            </div>
            <ul className="rd-chunks">
              {list.map((b, n) => {
                const c = blockColor(n); const found = (areas.get(b.id) || { rects: [] }).rects.length > 0;
                return (
                  <li key={b.id} className={'rd-chunk rd-blk' + (b.on === false ? ' off' : '') + (active === b.id ? ' on' : '')} data-testid="block" data-block={b.id}
                    style={{ borderLeftColor: b.on === false ? undefined : c.line }} onClick={(e) => { if (!e.target.closest('label')) pick(f, b.id, 'list'); }}>
                    <label className="rd-tick">
                      <input type="checkbox" checked={b.on !== false} onChange={(e) => onToggle(f, b.id, e.target.checked)} aria-label={`Use block: ${blockLine(b)}`} />
                      <span className="ttype">{BLOCK_LABEL[b.type] || b.type}</span>
                      {b.important && <span className="tag">Important</span>}
                      <span className="rd-swatch" style={{ background: b.on === false ? 'transparent' : c.fill, borderColor: c.line }} aria-hidden="true" />
                    </label>
                    <p className="rd-line">{blockLine(b)}</p>
                    <p className="muted tiny rd-from">From the page: {b.source}{b.grounded ? '' : ' (check: the answer is not word for word in it)'}{f.transcript && !found ? ' · not found on the page' : ''}</p>
                  </li>
                );
              })}
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
  const [full, setFull] = useState(false);
  const [hint, setHint] = useState(true); // the short how-to over the page, until the first zoom or move
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const vpRef = useRef(null), topRef = useRef(null);
  const latest = useRef({}); latest.current = { lines, off, view };
  const timer = useRef(null);
  const ptrs = useRef(new Map());
  const gest = useRef(null);
  const lastTap = useRef(null);
  useOverlay(full, () => setFull(false));
  useEffect(() => { setView({ s: 1, x: 0, y: 0 }); }, [full]);

  // a fresh reading replaces what is on screen
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
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const vpH = Math.round(full ? Math.max(200, winH - 64 - (sel ? 150 : 0)) : Math.min(pageH || 1, winH * 0.8));
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
      setHint(false);
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
      if (Math.abs(dx) + Math.abs(dy) > 8) { if (!g.moved) setHint(false); g.moved = true; }
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
    if (g && g.type === 'pan' && !g.moved) {
      // a tap picks a piece (or clears the pick); a double tap zooms in there, or back to fit
      const now = Date.now(), pt = { x: g.sx, y: g.sy }, prev = lastTap.current;
      if (prev && now - prev.t < 320 && Math.hypot(pt.x - prev.x, pt.y - prev.y) < 30) {
        lastTap.current = null; setHint(false);
        if (latest.current.view.s > 1.05) setView({ s: 1, x: 0, y: 0 }); else zoomAt(2.5, pt.x, pt.y);
      } else { lastTap.current = { t: now, ...pt }; setSel(g.pid || null); }
    }
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

  // A part counts as used when its normal text is used; crossed-out words in it stay left out and never come back with the part.
  const struck = new Set(struckIds(t));
  const plainIds = (c) => { const ids = c.lines.filter((l) => !struck.has(l.id)).map((l) => l.id); return ids.length ? ids : c.lines.map((l) => l.id); };
  const chunkOn = (c) => plainIds(c).some((id) => !off.includes(id));
  const toggleChunk = (c) => {
    const ids = c.lines.map((l) => l.id);
    setOff(chunkOn(c) ? [...new Set([...off, ...ids])] : off.filter((id) => !plainIds(c).includes(id))); persist();
  };
  const allOn = () => { setOff(struckIds(t)); persist(); }; // crossed-out parts stay unselected
  const showChunk = (c) => { setHl(hl === c.id ? null : c.id); if (layout) topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  const confirmed = async () => {
    try { await flush(); await backend.updateFile(code, projectId, file.id, { checked: true }); onClose(); } catch (e) { setNote(e.message); }
  };
  const retype = async () => {
    if (!confirm('Read the image again? This replaces the page text, including your changes.')) return;
    setBusy('Reading the image again…'); setNote('');
    try {
      const nt = await transcribePhoto(code, file.data, (e) => diagLog(projectId, { ...e, fileId: file.id }));
      await backend.updateFile(code, projectId, file.id, { transcript: nt, transcriptRev: Date.now(), status: 'typed', error: '', checked: false, off: struckIds(nt), blocks: null, blocksInfo: null, blocksStamp: '', qStamp: '' });
    } catch (e) { setNote(e.message); }
    setBusy('');
  };
  const base = `${(projectName || 'page').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 80)} page ${index + 1}`;
  const copyText = async () => { try { await navigator.clipboard.writeText(layoutText(t)); setNote('Copied.'); } catch { setNote('Could not copy. Use Save text instead.'); } };
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
          <div className={'rd-stage' + (full ? ' full' : '')}>
            <div className="rd-bar">
              <button className={'rd-ic' + (locked ? '' : ' open')} onClick={() => setLocked(!locked)} aria-pressed={!locked} aria-label={locked ? 'Pieces locked. Tap to move pieces' : 'Moving pieces. Tap to lock'} data-testid="lock"><Icon name={locked ? 'lock' : 'unlock'} size={20} /></button>
              {file.data ? (
                <div className="rd-fade">
                  <button className="rd-end" onClick={() => setFade(0)}>Photo</button>
                  <input type="range" min="0" max="100" value={Math.round(fade * 100)} onChange={(e) => setFade(e.target.value / 100)} aria-label="Fade between the original and the page text" />
                  <button className="rd-end" onClick={() => setFade(1)}>Typed</button>
                </div>
              ) : <span className="rd-fade" />}
              {!locked && <button className="rd-ic" onClick={addLine} aria-label="Add missing text"><Icon name="plus" size={20} /></button>}
              <button className="rd-ic" onClick={() => setView({ s: 1, x: 0, y: 0 })} aria-label="Fit" disabled={view.s === 1 && !view.x && !view.y}><Icon name="fit" size={20} /></button>
              <button className="rd-ic" onClick={() => setFull(!full)} aria-label={full ? 'Close full screen' : 'Full screen'} data-testid="full"><Icon name={full ? 'x' : 'expand'} size={20} /></button>
              <span className="sr" data-testid="zoom">{Math.round(view.s * 100)}%</span>
            </div>
            <div ref={vpRef} className="rd-vp" style={{ height: vpH || undefined }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-testid="viewport">
              <div className="rd-page" style={{ paddingBottom: `${ratio * 100}%`, transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }} data-testid="page-copy">
                {file.data && <img className="rd-photo" src={file.data} alt={`Original page ${index + 1}`} draggable="false" />}
                <div className="rd-typed" style={{ opacity: file.data ? fade : 1 }}>
                  {(t0.figures || []).map((f, i) => <div key={i} className="rd-fig" style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, ...(f.h < 0.04 ? { fontSize: Math.min(f.h * ratio * 100 * 0.85, (f.w * 100) / (Math.max(String(f.label || 'Picture').length, 1) * 0.5)).toFixed(2) + 'cqw', whiteSpace: 'nowrap', lineHeight: 1, borderWidth: 1, padding: 0 } : {}) }}><span>{f.label || 'Picture'}</span></div>)}
                  {lines.map((l) => (
                    <div key={l.id} data-testid="piece" data-pid={l.id}
                      className={'rd-piece' + (off.includes(l.id) ? ' off' : '') + (sel === l.id ? ' sel' : '') + (l.conf === 'low' ? ' low' : '') + l.marks.map((m) => ' m-' + m).join('')}
                      style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, fontSize: fs(l) }}>{l.marks.includes('star') ? '★ ' : ''}{l.text}</div>
                  ))}
                  {hlChunk && hlChunk.box && <div className="rd-hl" style={{ left: `${hlChunk.box.x * 100 - 1}%`, top: `${hlChunk.box.y * 100 - 0.6}%`, width: `${hlChunk.box.w * 100 + 2}%`, height: `${hlChunk.box.h * 100 + 1.2}%` }} />}
                </div>
              </div>
              {hint && <div className="rd-hint" aria-hidden="true">Pinch or double-tap to zoom · drag to move · tap a piece to fix it</div>}
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
          </div>
        </>
      ) : (
        <p className="muted tiny">This is the text you added. Fix the words, and select which parts to use.</p>
      )}

      <div className="label">Use as source material</div>
      <p className="muted tiny">Selected parts are used for questions. Unselected parts are greyed out.</p>
      <div className="row">
        <button className="btn ghost small" onClick={allOn}>Select all</button>
        {!layout && <button className="btn ghost small" onClick={addLine}><Icon name="plus" size={18} />Add paragraph</button>}
      </div>
      <ul className="rd-chunks">
        {chunks.map((c, i) => {
          const on = chunkOn(c);
          const leftOut = on && c.lines.some((l) => struck.has(l.id) && off.includes(l.id));
          return (
            <li key={c.id} className={'rd-chunk' + (on ? '' : ' off') + (hl === c.id ? ' hl' : '')} data-testid="chunk">
              <label className="rd-tick"><input type="checkbox" checked={on} onChange={() => toggleChunk(c)} aria-label={`Use part ${i + 1}`} /><span>Part {i + 1}</span></label>
              {layout
                ? <button className="rd-body" onClick={() => showChunk(c)} aria-label={`Show part ${i + 1} on the page`}><pre>{chunkPreview(t, c)}</pre></button>
                : <textarea className="rd-text" value={c.lines[0].text} aria-label={`Text of part ${i + 1}`} onChange={(e) => edit(c.lines[0].id, { text: e.target.value })} />}
              {leftOut && <p className="muted tiny rd-left-out" data-testid="left-out">Crossed-out words are left out.</p>}
              {!layout && <div className="rd-chunk-actions"><button className="link inline danger" onClick={() => removeLine(c.lines[0].id)}>Delete</button></div>}
            </li>
          );
        })}
        {chunks.length === 0 && <li className="muted">No text on this page.</li>}
      </ul>

      <div className="label">Keep this page</div>
      {file.data && <button className="btn rd-reread" disabled={!!busy} onClick={retype} data-testid="read-again"><Icon name="repeat" />Read the image again</button>}
      <div className="rd-keep">
        <button className="btn ghost small" onClick={copyText}><Icon name="copy" size={18} />Copy</button>
        <button className="btn ghost small" onClick={saveText}><Icon name="file" size={18} />Save text</button>
        {layout && <button className="btn ghost small" onClick={savePicture}><Icon name="image" size={18} />Picture</button>}
      </div>
      {busy && <p className="hint" role="status">{busy}</p>}
      {note && <p className="muted tiny" role="status">{note}</p>}
      {file.status === 'error' && file.error && <p className="error" role="alert">{file.error}</p>}
      <button className="btn primary" onClick={confirmed} disabled={!!busy || !lines.length} data-testid="confirm-page"><Icon name="check" />{file.checked ? 'Save and close' : 'Approve this page'}</button>
    </section>
  );
}

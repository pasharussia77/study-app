import React, { useEffect, useRef, useState } from 'react';
import { backend } from './firebase.js';
import { compressImage, readPhotoItems, readTextFile, readPdf } from './material.js';
import { diagLog } from './diag.js';
import { useOverlay } from './nav.js';
import { Icon } from './art.jsx';

const IGNORE_LABEL = { none: 'Everything', handwriting: 'Printed only', printed: 'Handwriting only' };

// File name for a saved photo: the project name, plus _1, _2... when there is more than one photo.
export function photoFileName(projectName, index, total) {
  const base = (projectName || 'photo').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100) || 'photo';
  return total > 1 ? `${base}_${index + 1}.jpg` : `${base}.jpg`;
}

async function downloadPhoto(dataUrl, name) {
  const blob = await (await fetch(dataUrl)).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export default function Sources({ code, projectId, projectName, canSave, onAppend, onReview }) {
  const [files, setFiles] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [rereading, setRereading] = useState(false); // the "read all photos again" question
  const [rereadHand, setRereadHand] = useState('key');
  const [pending, setPending] = useState(null); // photos waiting for the "what to read" choice
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null); // { kind: 'ok' | 'error', text, review? }
  const [lastIgnore, setLastIgnore] = useState('none');
  const [hand, setHand] = useState('key'); // what handwriting means: 'key' (answer key) or 'student'
  const [removing, setRemoving] = useState(null); // photo waiting for the "remove its items too?" choice
  const [viewing, setViewing] = useState(null); // index of the photo shown large
  const cam = useRef(null), gallery = useRef(null), doc = useRef(null);

  useEffect(() => backend.watchFiles(code, projectId, setFiles), [code, projectId]);
  useEffect(() => backend.watchItems(code, projectId, setAllItems), [code, projectId]);
  useOverlay(rereading, () => setRereading(false));
  useOverlay(pending !== null, () => setPending(null));
  useOverlay(viewing !== null, () => setViewing(null));
  useOverlay(removing !== null, () => setRemoving(null));

  const choosePhotos = (e) => {
    const list = [...e.target.files].filter((f) => f.type.startsWith('image/'));
    e.target.value = '';
    if (list.length) setPending(list);
  };

  const savePhotos = async (ignore) => {
    const list = pending; setPending(null); setLastIgnore(ignore); setMsg(null);
    try {
      for (let i = 0; i < list.length; i++) {
        setBusy(`Saving photo ${i + 1} of ${list.length}…`);
        const { data, width, height, enh } = await compressImage(list[i]);
        const id = await backend.addFile(code, projectId, { kind: 'photo', data, ignore, hand, status: 'new' });
        diagLog(projectId, { type: 'photo_added', fileId: id, ignore, hand, name: list[i].name, origBytes: list[i].size, origType: list[i].type, w: width, h: height, storedChars: data.length, enh });
      }
    } catch (e) { setMsg({ kind: 'error', text: e.message }); }
    setBusy('');
  };

  // Reads the given photos in page order; each page is told how the previous page ended.
  const readList = async (todo, { keepEdits = false } = {}) => {
    setMsg(null);
    const ctxById = new Map();
    let made = 0, flagged = 0, failed = 0, lastErr = '';
    for (let i = 0; i < todo.length; i++) {
      const f = todo[i];
      const pos = files.findIndex((x) => x.id === f.id);
      const before = files.slice(0, pos).reverse().find((x) => ctxById.get(x.id) || x.ctx);
      const ctx = before ? (ctxById.get(before.id) || before.ctx) : null;
      setBusy(`Reading photo ${i + 1} of ${todo.length}…`);
      try {
        const r = await readPhotoItems(code, f.data, f.ignore, ctx, (e) => diagLog(projectId, { ...e, fileId: f.id }), f.hand || 'key');
        // Items you changed by hand stay (the new reading of the same question is dropped).
        const kept = keepEdits ? allItems.filter((x) => x.fileId === f.id && x.source === 'set by you').map(({ id, createdAt, fileId, ...rest }) => rest) : [];
        const fresh = r.items.filter((n) => !kept.some((k) => k.number != null && k.number === n.number && k.type === n.type));
        await backend.replaceItemsForFile(code, projectId, f.id, [...fresh, ...kept]);
        await backend.updateFile(code, projectId, f.id, { status: 'done', error: '', page: r.page, ctx: r.ctx, made: r.items.length });
        ctxById.set(f.id, r.ctx);
        made += r.items.length; flagged += r.items.filter((x) => x.flagged).length;
      } catch (e) {
        failed++; lastErr = e.message;
        await backend.updateFile(code, projectId, f.id, { status: 'error', error: e.message }).catch(() => {});
      }
    }
    setBusy('');
    if (failed) setMsg({ kind: 'error', text: `${failed} photo${failed > 1 ? 's' : ''} could not be read. ${lastErr}`, review: made > 0 });
    else setMsg({ kind: 'ok', review: true, text: `Made ${made} study item${made === 1 ? '' : 's'} from ${todo.length} photo${todo.length > 1 ? 's' : ''}.${flagged ? ` ${flagged} need${flagged === 1 ? 's' : ''} a look.` : ''}` });
  };

  const readPhotos = () => readList(files.filter((f) => f.status !== 'done'));

  const readAllAgain = async () => {
    const hand = rereadHand;
    setRereading(false);
    const todo = files.map((f) => ({ ...f, hand }));
    for (const f of todo) await backend.updateFile(code, projectId, f.id, { hand }).catch(() => {});
    diagLog(projectId, { type: 'reread_all', photos: todo.length, hand });
    readList(todo, { keepEdits: true });
  };

  const readAgain = (f) => {
    if (!confirm('Read this photo again? This replaces the study items made from it, including any changes you made.')) return;
    setViewing(null);
    setTimeout(() => readList([f]), 50);
  };

  const removePhoto = async (f) => {
    if (f.status === 'done' && f.made > 0) { setRemoving(f); return; }
    if (confirm('Remove this photo?')) await backend.deleteFile(code, projectId, f.id);
  };
  const finishRemove = async (withItems) => {
    const f = removing; setRemoving(null);
    try {
      if (withItems) await backend.replaceItemsForFile(code, projectId, f.id, []);
      await backend.deleteFile(code, projectId, f.id);
      diagLog(projectId, { type: 'photo_removed', fileId: f.id, withItems });
    } catch (e) { setMsg({ kind: 'error', text: e.message }); }
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
          for (const img of r.images) await backend.addFile(code, projectId, { kind: 'photo', data: img.data, ignore: 'none', status: 'new', from: file.name });
          setMsg({ kind: 'ok', text: `${file.name} is a scanned PDF, so its ${r.images.length} page${r.images.length > 1 ? 's were' : ' was'} added as photos. Tap Read to make study items. ${r.note}`.trim() });
        } else {
          onAppend(r.text);
          setMsg({ kind: 'ok', text: `Added text from ${file.name}. ${r.note} To turn it into questions, tap Make study items from this text, below.`.replace(/\s+/g, ' ').trim() });
        }
      } else if (/\.(txt|md|csv)$/i.test(file.name) || file.type.startsWith('text/')) {
        const t0 = Date.now();
        const text = await readTextFile(file);
        diagLog(projectId, { type: 'doc_import', name: file.name, size: file.size, method: 'Text file (no AI)', chars: text.length, ms: Date.now() - t0 });
        onAppend(text);
        setMsg({ kind: 'ok', text: `Added text from ${file.name}. To turn it into questions, tap Make study items from this text, below.` });
      } else throw new Error('Please choose a PDF or a text file.');
    } catch (err) {
      diagLog(projectId, { type: 'doc_import', name: file.name, size: file.size, ok: false, error: err.message });
      setMsg({ kind: 'error', text: err.message });
    }
    setBusy('');
  };

  const unread = files.filter((f) => f.status !== 'done').length;
  return (
    <div className="sources">
      <div className="label">Add material</div>
      <div className="add-row">
        <button className="btn ghost" disabled={!!busy} onClick={() => cam.current.click()}><Icon name="camera" />Take photo</button>
        <button className="btn ghost" disabled={!!busy} onClick={() => gallery.current.click()}><Icon name="image" />Photos</button>
        <button className="btn ghost" disabled={!!busy} onClick={() => doc.current.click()}><Icon name="file" />PDF or text file</button>
      </div>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={choosePhotos} data-testid="in-camera" />
      <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={choosePhotos} data-testid="in-photos" />
      <input ref={doc} type="file" accept=".pdf,.txt,.md,.csv,application/pdf,text/plain" hidden onChange={chooseDoc} data-testid="in-doc" />

      {files.length > 0 && (
        <ul className="thumbs" aria-label="Photos">
          {files.map((f) => (
            <li key={f.id} className={'thumb ' + f.status}>
              <button className="open" aria-label={`View photo ${files.indexOf(f) + 1}`} onClick={() => setViewing(files.indexOf(f))}>
                <img src={f.data} alt="Saved page" />
              </button>
              <span className="badge">{f.status === 'done' ? `${f.made ?? ''} items`.trim() : f.status === 'error' ? 'Failed' : 'Not read'}</span>
              {f.ignore !== 'none' && <span className="mode">{IGNORE_LABEL[f.ignore]}</span>}
              <button className="x" aria-label="Remove photo" onClick={() => removePhoto(f)}>×</button>
            </li>
          ))}
        </ul>
      )}
      {unread > 0 && <button className="btn primary" disabled={!!busy} onClick={readPhotos}><Icon name="sparkle" />{`Read ${unread} photo${unread > 1 ? 's' : ''}`}</button>}
      {files.some((f) => f.status === 'done' || f.status === 'error') && unread === 0 && (
        <button className="btn ghost" disabled={!!busy} onClick={() => setRereading(true)} data-testid="reread-all"><Icon name="sparkle" />Re-read all photos</button>
      )}
      {busy && <p className="hint" role="status">{busy}</p>}
      {msg && (
        <div className={msg.kind === 'ok' ? 'okmsg' : 'error'} role={msg.kind === 'ok' ? 'status' : 'alert'}>
          {msg.text}
          {msg.review && <button className="link inline" onClick={onReview}>Review items</button>}
        </div>
      )}

      {viewing !== null && files[viewing] && (() => {
        const f = files[viewing];
        const name = photoFileName(projectName, viewing, files.length);
        return (
          <div className="viewer" role="dialog" aria-label="Photo">
            <div className="viewer-top">
              <button className="chip" onClick={() => setViewing(null)}>Close</button>
              <span data-testid="viewer-info">Photo {viewing + 1} of {files.length} · {IGNORE_LABEL[f.ignore]} · {f.status === 'done' ? `${f.made ?? ''} items` : f.status === 'error' ? 'Failed' : 'Not read'}</span>
            </div>
            <div className="viewer-img"><img src={f.data} alt={`Photo ${viewing + 1}`} data-testid="viewer-img" /></div>
            <div className="viewer-bottom">
              {canSave && (
                <>
                  <button className="btn primary" onClick={() => downloadPhoto(f.data, name)}>Save photo</button>
                  <p className="tiny" data-testid="save-name">Saves as: {name}</p>
                </>
              )}
              {f.status !== 'new' && <button className="btn ghost" onClick={() => readAgain(f)}>Read this photo again</button>}
              {files.length > 1 && (
                <div className="row">
                  <button className="btn ghost" disabled={viewing === 0} onClick={() => setViewing(viewing - 1)}>Previous</button>
                  <button className="btn ghost" disabled={viewing === files.length - 1} onClick={() => setViewing(viewing + 1)}>Next</button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {rereading && (
        <div className="overlay" onClick={() => setRereading(false)}>
          <div className="stats-sheet" role="dialog" aria-label="Re-read all photos" onClick={(e) => e.stopPropagation()}>
            <h2>Re-read all photos?</h2>
            <p className="muted">Handwriting on the pages is</p>
            <fieldset className="seg hand-seg">
              <legend className="sr">Handwriting on the pages is</legend>
              <button type="button" className={rereadHand === 'key' ? 'on' : ''} aria-pressed={rereadHand === 'key'} onClick={() => setRereadHand('key')}>The answer key</button>
              <button type="button" className={rereadHand === 'student' ? 'on' : ''} aria-pressed={rereadHand === 'student'} onClick={() => setRereadHand('student')}>A student&rsquo;s work</button>
            </fieldset>
            <p className="muted tiny">The AI reads all {files.length} photo{files.length === 1 ? '' : 's'} again, one by one. This uses the AI and takes about {Math.max(1, Math.round(files.length * 12 / 60))} minute{Math.round(files.length * 12 / 60) > 1 ? 's' : ''}. Items you edited by hand stay. If a photo cannot be read, its old items stay.</p>
            <div className="stack">
              <button className="btn primary" onClick={readAllAgain}>Read all {files.length} again</button>
              <button className="link" onClick={() => setRereading(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {removing && (
        <div className="overlay" onClick={() => setRemoving(null)}>
          <div className="stats-sheet" role="dialog" aria-label="Remove photo" onClick={(e) => e.stopPropagation()}>
            <h2>Remove this photo?</h2>
            <p className="muted">{removing.made} study item{removing.made === 1 ? ' was' : 's were'} made from it.</p>
            <div className="stack">
              <button className="btn primary" onClick={() => finishRemove(true)}>Remove photo and its items</button>
              <button className="btn ghost" onClick={() => finishRemove(false)}>Remove photo, keep items</button>
              <button className="link" onClick={() => setRemoving(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {pending && (
        <div className="overlay" onClick={() => setPending(null)}>
          <div className="stats-sheet" role="dialog" aria-label="What should be read?" onClick={(e) => e.stopPropagation()}>
            <h2>What should be read?</h2>
            <p className="muted">{pending.length} photo{pending.length > 1 ? 's' : ''} selected</p>
            <fieldset className="seg hand-seg">
              <legend>Handwriting on the page is</legend>
              <button type="button" className={hand === 'key' ? 'on' : ''} aria-pressed={hand === 'key'} onClick={() => setHand('key')}>The answer key</button>
              <button type="button" className={hand === 'student' ? 'on' : ''} aria-pressed={hand === 'student'} onClick={() => setHand('student')}>A student&rsquo;s work</button>
            </fieldset>
            <p className="muted tiny">{hand === 'key' ? 'Handwritten answers are used as the correct answers.' : 'Handwritten answers may be wrong, so they are not used unless the page is graded.'} A page with a score or red X marks is always read as graded work.</p>
            <div className="stack">
              {['none', 'handwriting', 'printed'].map((k) => (
                <button key={k} className={'btn ' + (k === lastIgnore ? 'primary' : 'ghost')} onClick={() => savePhotos(k)}>
                  {k === 'none' ? 'Read everything' : k === 'handwriting' ? 'Ignore handwriting' : 'Ignore printed text'}
                </button>
              ))}
              <button className="link" onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { backend } from './firebase.js';
import { compressImage, readPhotoItems, readTextFile, readPdf } from './material.js';
import { diagLog } from './diag.js';
import { useOverlay } from './nav.js';

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
  const [pending, setPending] = useState(null); // photos waiting for the "what to read" choice
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null); // { kind: 'ok' | 'error', text, review? }
  const [lastIgnore, setLastIgnore] = useState('none');
  const [viewing, setViewing] = useState(null); // index of the photo shown large
  const cam = useRef(null), gallery = useRef(null), doc = useRef(null);

  useEffect(() => backend.watchFiles(code, projectId, setFiles), [code, projectId]);
  useOverlay(pending !== null, () => setPending(null));
  useOverlay(viewing !== null, () => setViewing(null));

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
        const { data, width, height } = await compressImage(list[i]);
        const id = await backend.addFile(code, projectId, { kind: 'photo', data, ignore, status: 'new' });
        diagLog(projectId, { type: 'photo_added', fileId: id, ignore, name: list[i].name, origBytes: list[i].size, origType: list[i].type, w: width, h: height, storedChars: data.length });
      }
    } catch (e) { setMsg({ kind: 'error', text: e.message }); }
    setBusy('');
  };

  // Reads the given photos in page order; each page is told how the previous page ended.
  const readList = async (todo) => {
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
        const r = await readPhotoItems(code, f.data, f.ignore, ctx, (e) => diagLog(projectId, { ...e, fileId: f.id }));
        await backend.replaceItemsForFile(code, projectId, f.id, r.items);
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

  const readAgain = (f) => {
    if (!confirm('Read this photo again? This replaces the study items made from it, including any changes you made.')) return;
    setViewing(null);
    setTimeout(() => readList([f]), 50);
  };

  const removePhoto = async (f) => {
    const note = f.status === 'done' ? ' The study items already made from it stay.' : '';
    if (confirm('Remove this photo?' + note)) await backend.deleteFile(code, projectId, f.id);
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
          setMsg({ kind: 'ok', text: `Added text from ${file.name}. ${r.note}`.trim() });
        }
      } else if (/\.(txt|md|csv)$/i.test(file.name) || file.type.startsWith('text/')) {
        const t0 = Date.now();
        const text = await readTextFile(file);
        diagLog(projectId, { type: 'doc_import', name: file.name, size: file.size, method: 'Text file (no AI)', chars: text.length, ms: Date.now() - t0 });
        onAppend(text);
        setMsg({ kind: 'ok', text: `Added text from ${file.name}.` });
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
      <div className="muted">Add material</div>
      <div className="add-row">
        <button className="btn ghost" disabled={!!busy} onClick={() => cam.current.click()}>Take photo</button>
        <button className="btn ghost" disabled={!!busy} onClick={() => gallery.current.click()}>Photos</button>
        <button className="btn ghost" disabled={!!busy} onClick={() => doc.current.click()}>PDF or text file</button>
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
      {unread > 0 && <button className="btn primary" disabled={!!busy} onClick={readPhotos}>{`Read ${unread} photo${unread > 1 ? 's' : ''}`}</button>}
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

      {pending && (
        <div className="overlay" onClick={() => setPending(null)}>
          <div className="stats-sheet" role="dialog" aria-label="What should be read?" onClick={(e) => e.stopPropagation()}>
            <h2>What should be read?</h2>
            <p className="muted">{pending.length} photo{pending.length > 1 ? 's' : ''} selected</p>
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

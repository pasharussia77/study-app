import React, { useEffect, useMemo, useState } from 'react';
import { backend } from './firebase.js';
import { TYPE_LABEL, crossCheck } from './items.js';
import { useOverlay, goUp } from './nav.js';
import { Icon } from './art.jsx';
import { ScreenHead } from './Session.jsx';

const SOURCE_LABEL = {
  'printed key': 'Answer given in the material', 'circled by teacher': 'Circled by the teacher',
  'inferred from red X': 'Worked out from the red X', 'assumed correct (no red mark)': 'Assumed correct (no red mark)',
  page: 'Taken from the page', 'set by you': 'Set by you', none: 'No answer yet'
};

export default function Items({ code, projectId }) {
  const [itemsRaw, setItems] = useState(null);
  const [filesRaw, setFiles] = useState(null);
  const items = itemsRaw || [], files = filesRaw || [];
  const loaded = itemsRaw !== null && filesRaw !== null;
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [editing, setEditing] = useState(null);
  const [photo, setPhoto] = useState(null);
  useEffect(() => backend.watchItems(code, projectId, setItems), [code, projectId]);
  useEffect(() => backend.watchFiles(code, projectId, setFiles), [code, projectId]);
  useOverlay(!!editing, () => setEditing(null));
  useOverlay(!!photo, () => setPhoto(null));

  const groups = useMemo(() => {
    const byFile = new Map();
    items.forEach((it) => { if (!byFile.has(it.fileId)) byFile.set(it.fileId, []); byFile.get(it.fileId).push(it); });
    const out = files.filter((f) => byFile.has(f.id)).map((f, i) => ({ file: f, label: `Photo ${files.indexOf(f) + 1}`, list: byFile.get(f.id) }));
    const known = new Set(files.map((f) => f.id));
    const fromText = items.filter((it) => it.fileId === 'text');
    if (fromText.length) out.unshift({ file: null, label: 'Typed or pasted text', list: fromText });
    const orphan = items.filter((it) => !known.has(it.fileId) && it.fileId !== 'text');
    if (orphan.length) out.push({ file: null, label: 'From a removed photo', list: orphan });
    out.forEach((g) => g.list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
    return out;
  }, [items, files]);

  const flaggedCount = items.filter((i) => i.flagged).length;
  const check = useMemo(() => crossCheck(files, items), [files, items]);

  return (
    <section>
      <ScreenHead onBack={goUp} backLabel="Project" icon={<span className="head-ic"><Icon name="list" size={26} /></span>} title="Study items" />
      {!loaded ? <p className="muted" data-testid="items-loading">Loading…</p> : (
      <>
      <p className="muted" data-testid="items-summary">{items.length} item{items.length === 1 ? '' : 's'}{flaggedCount ? ` · ${flaggedCount} need a look` : ' · all look fine'}</p>
      {check && (
        <div className={check.ok && check.countOk ? 'okmsg' : 'hint'} data-testid="crosscheck">
          Score on the sheet: {check.score}, so {check.expectedWrong} wrong. Found {check.wrongFound} marked wrong. {check.ok ? 'These match.' : 'These do not match, so a red mark may have been missed or misread.'}
          {!check.countOk && ` The sheet has ${check.total} questions and ${check.questions} were found; a page may be missing.`}
        </div>
      )}
      {flaggedCount > 0 && (
        <label className="switch"><Icon name="alert" /><span>Only show items that need a look</span><input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} /></label>
      )}
      {items.length === 0 && <div className="empty"><p>No study items yet.</p><p className="muted">Take a photo and tap Read.</p></div>}

      {groups.map((g) => {
        const shown = onlyFlagged ? g.list.filter((i) => i.flagged) : g.list;
        if (!shown.length) return null;
        return (
          <div key={g.label} className="igroup">
            <div className="igroup-head">
              {g.file && <button className="gthumb" aria-label={`Show ${g.label}`} onClick={() => setPhoto(g.file)}><img src={g.file.data} alt="" /></button>}
              <b>{g.label}</b>
              <span className="muted tiny">{g.list.length} items</span>
            </div>
            <ul className="ilist">
              {shown.map((it) => (
                <li key={it.id} className={'item' + (it.flagged ? ' flagged' : '')} data-testid="item">
                  <div className="item-top">
                    {it.number != null && <b>{it.number}.</b>}
                    <span className={'ttype t-' + it.type}>{TYPE_LABEL[it.type]}</span>
                    <span className="src">{SOURCE_LABEL[it.source] || it.source}</span>
                  </div>
                  <p className="item-q">{it.question}</p>
                  {it.choices && it.choices.length > 0 && (
                    <ul className="ichoices">
                      {it.choices.map((c) => <li key={c.label} className={c.label === it.correctLabel ? 'right' : ''}>{c.label}. {c.text}{c.label === it.correctLabel ? '  ✓' : ''}</li>)}
                    </ul>
                  )}
                  {(it.type === 'term' || it.type === 'qa') && <p className="ichoices-answer">Answer: <b>{it.answer || '—'}</b></p>}
                  {it.studentAnswer && it.type !== 'term' && it.type !== 'qa' && <p className="muted tiny">Student wrote: {it.studentAnswer}{it.markedWrong ? ' (marked wrong)' : ''}</p>}
                  {it.flagged && <p className="needs">Needs a look{it.note ? ': ' + it.note : ''}</p>}
                  <button className="btn ghost small" onClick={() => setEditing(it)}>{it.flagged ? 'Check and fix' : 'Edit'}</button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      </>
      )}
      {photo && (
        <div className="viewer" role="dialog" aria-label="Photo">
          <div className="viewer-top"><button className="chip" onClick={() => setPhoto(null)}>Close</button><span>{`Photo ${files.indexOf(photo) + 1}`}</span></div>
          <div className="viewer-img"><img src={photo.data} alt="The page" /></div>
        </div>
      )}
      {editing && <EditSheet item={editing} onClose={() => setEditing(null)} code={code} projectId={projectId} />}
    </section>
  );
}

function EditSheet({ item, onClose, code, projectId }) {
  const isChoice = item.type === 'tf' || item.type === 'mc';
  const [q, setQ] = useState(item.question);
  const [choices, setChoices] = useState(item.choices || []);
  const [correct, setCorrect] = useState(item.correctLabel);
  const [answer, setAnswer] = useState(item.answer || '');
  const canSave = q.trim() && (isChoice ? !!correct : answer.trim());

  const save = async () => {
    const patch = { question: q.trim(), flagged: false, source: 'set by you', note: '' };
    if (isChoice) {
      patch.choices = choices.map((c) => ({ label: c.label, text: c.text.trim() }));
      patch.correctLabel = correct;
      patch.answer = patch.choices.find((c) => c.label === correct).text;
    } else patch.answer = answer.trim();
    await backend.updateItem(code, projectId, item.id, patch);
    onClose();
  };
  const remove = async () => {
    if (confirm('Delete this item?')) { await backend.deleteItem(code, projectId, item.id); onClose(); }
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="stats-sheet report-sheet" role="dialog" aria-label="Edit item" onClick={(e) => e.stopPropagation()}>
        <h2>{TYPE_LABEL[item.type]}{item.number != null ? ` ${item.number}` : ''}</h2>
        {item.note && <p className="needs">{item.note}</p>}
        <label className="muted tiny" htmlFor="eq">{item.type === 'term' ? 'Word' : 'Question'}</label>
        <textarea id="eq" className="notes" value={q} onChange={(e) => setQ(e.target.value)} />
        {isChoice ? (
          <fieldset className="radios">
            <legend className="muted tiny">Tap the correct choice</legend>
            {choices.map((c, i) => (
              <label key={c.label} className={'radio' + (correct === c.label ? ' on' : '')}>
                <input type="radio" name="correct" checked={correct === c.label} onChange={() => setCorrect(c.label)} />
                <span className="rl">{c.label}</span>
                <input className="rt" value={c.text} aria-label={`Choice ${c.label}`} onChange={(e) => setChoices(choices.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              </label>
            ))}
          </fieldset>
        ) : (
          <>
            <label className="muted tiny" htmlFor="ea">{item.type === 'term' ? 'Definition' : 'Answer'}</label>
            <textarea id="ea" className="notes" value={answer} onChange={(e) => setAnswer(e.target.value)} />
          </>
        )}
        <button className="btn primary" disabled={!canSave} onClick={save}>Save</button>
        <div className="row">
          <button className="btn ghost" onClick={remove}>Delete item</button>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

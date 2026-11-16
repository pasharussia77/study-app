import React, { useEffect, useMemo, useState } from 'react';
import { backend } from './firebase.js';
import { TYPE_LABEL, crossCheck, reapplyItem, duplicateGroups } from './items.js';
import { useOverlay, goUp } from './nav.js';
import { Icon } from './art.jsx';
import { ScreenHead } from './Session.jsx';

const SOURCE_LABEL = {
  'printed key': 'Answer given in the material', 'circled by teacher': 'Circled by the teacher',
  'inferred from red X': 'Worked out from the red X', 'assumed correct (no red mark)': 'Assumed correct (no red mark)',
  'handwritten answer key': 'Handwritten answer key', page: 'Taken from the page', 'set by you': 'Set by you', none: 'No answer yet'
};

export default function Items({ code, projectId }) {
  const [itemsRaw, setItems] = useState(null);
  const [filesRaw, setFiles] = useState(null);
  const items = itemsRaw || [], files = filesRaw || [];
  const loaded = itemsRaw !== null && filesRaw !== null;
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [editing, setEditing] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [asking, setAsking] = useState(false); // the "re-apply the rules" question
  const [working, setWorking] = useState('');
  const [done, setDone] = useState('');
  useEffect(() => backend.watchItems(code, projectId, setItems), [code, projectId]);
  useEffect(() => backend.watchFiles(code, projectId, setFiles), [code, projectId]);
  useOverlay(!!editing, () => setEditing(null));
  useOverlay(!!photo, () => setPhoto(null));
  useOverlay(asking, () => setAsking(false));

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
  const dups = useMemo(() => duplicateGroups(items), [items]);
  const dupCount = dups.reduce((n, g) => n + g.drop.length, 0);
  const fromPhotos = items.filter((i) => i.fileId !== 'text' && i.source !== 'set by you').length;

  // Works out the answers again from what is already stored. No AI is used.
  const reapply = async (hand) => {
    setAsking(false); setDone(''); setWorking('Applying the rules…');
    const fileById = new Map(files.map((f) => [f.id, f]));
    let changed = 0, gained = 0;
    try {
      for (const f of files) if (f.kind === 'photo' && (f.hand || 'key') !== hand) await backend.updateFile(code, projectId, f.id, { hand });
      for (const it of items) {
        const f = fileById.get(it.fileId);
        const patch = reapplyItem(it, { graded: !!(f && f.page && f.page.graded), hand });
        if (!patch) continue;
        await backend.updateItem(code, projectId, it.id, patch);
        changed++; if (!it.answer && patch.answer) gained++;
      }
      setDone(changed ? `Rules applied. ${gained} item${gained === 1 ? '' : 's'} got an answer.` : 'Rules applied. Nothing needed to change.');
    } catch (e) { setDone('Could not finish: ' + e.message); }
    setWorking('');
  };

  const mergeDups = async () => {
    if (!confirm(`${dupCount} question${dupCount === 1 ? ' appears' : 's appear'} more than once. Keep the best copy of each and delete the other${dupCount === 1 ? '' : 's'}?`)) return;
    setDone(''); setWorking('Merging duplicates…');
    try {
      for (const g of dups) for (const it of g.drop) await backend.deleteItem(code, projectId, it.id);
      setDone(`Merged. ${dupCount} duplicate${dupCount === 1 ? '' : 's'} removed.`);
    } catch (e) { setDone('Could not finish: ' + e.message); }
    setWorking('');
  };

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
      {dupCount > 0 && (
        <div className="hint" data-testid="dups">
          {dupCount} question{dupCount === 1 ? ' appears' : 's appear'} more than once (a page may have been photographed twice).
          <button className="link inline" disabled={!!working} onClick={mergeDups}>Merge duplicates</button>
        </div>
      )}
      {fromPhotos > 0 && <button className="btn ghost small" disabled={!!working} onClick={() => setAsking(true)} data-testid="reapply">Re-apply the rules</button>}
      {working && <p className="hint" role="status">{working}</p>}
      {done && <div className="okmsg" role="status" data-testid="reapply-done">{done}</div>}
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
                  {it.choices && it.choices.length > 0 && it.type !== 'order' && (
                    <ul className="ichoices">
                      {it.choices.map((c) => {
                        const on = it.type === 'multi' ? (it.correctLabels || []).includes(c.label) : c.label === it.correctLabel;
                        return <li key={c.label} className={on ? 'right' : ''}>{c.label}. {c.text}{on ? '  ✓' : ''}</li>;
                      })}
                    </ul>
                  )}
                  {it.type === 'order' && (
                    <ul className="ichoices ordered" data-testid="order-list">
                      {it.choices.map((c) => {
                        const at = (it.correctOrder || []).indexOf(c.label);
                        return <li key={c.label} className={at >= 0 ? 'right' : ''}>{at >= 0 ? `${at + 1}` : '?'} · {c.text}</li>;
                      })}
                    </ul>
                  )}
                  {it.type === 'tf' && it.correction && <p className="ichoices-answer" data-testid="correction">Correction: <b>{it.correction}</b></p>}
                  {(it.type === 'term' || it.type === 'qa') && <p className="ichoices-answer">Answer: <b>{it.answer || '—'}</b></p>}
                  {it.studentAnswer && it.type !== 'term' && it.type !== 'qa' && <p className="muted tiny">{it.source === 'handwritten answer key' ? 'Written on the page' : 'Student wrote'}: {it.studentAnswer}{it.markedWrong ? ' (marked wrong)' : ''}</p>}
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
      {asking && (
        <div className="overlay" onClick={() => setAsking(false)}>
          <div className="stats-sheet" role="dialog" aria-label="Re-apply the rules" onClick={(e) => e.stopPropagation()}>
            <h2>Handwriting on the pages is</h2>
            <p className="muted">The answers are worked out again from what was already read. No AI is used and items you edited stay as they are.</p>
            <div className="stack">
              <button className="btn primary" onClick={() => reapply('key')}>The answer key</button>
              <button className="btn ghost" onClick={() => reapply('student')}>A student&rsquo;s work</button>
              <button className="link" onClick={() => setAsking(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {editing && <EditSheet item={editing} onClose={() => setEditing(null)} code={code} projectId={projectId} />}
    </section>
  );
}

function EditSheet({ item, onClose, code, projectId }) {
  const isChoice = item.type === 'tf' || item.type === 'mc';
  const isMulti = item.type === 'multi', isOrder = item.type === 'order';
  const [many, setMany] = useState(item.correctLabels || []);
  const [nums, setNums] = useState(() => (item.choices || []).map((c) => { const at = (item.correctOrder || []).indexOf(c.label); return at >= 0 ? String(at + 1) : ''; }));
  const numsOk = isOrder && [...nums].map(Number).sort((a, b) => a - b).every((n, i) => n === i + 1);
  const [q, setQ] = useState(item.question);
  const [choices, setChoices] = useState(item.choices || []);
  const [correct, setCorrect] = useState(item.correctLabel);
  const [answer, setAnswer] = useState(item.answer || '');
  const [correction, setCorrection] = useState(item.correction || '');
  const falseLabel = item.type === 'tf' ? ((item.choices || []).find((c) => c.text.trim().toLowerCase() === 'false') || {}).label : null;
  const canSave = q.trim() && (isChoice ? !!correct : isMulti ? many.length > 0 : isOrder ? numsOk : answer.trim());

  const save = async () => {
    const patch = { question: q.trim(), flagged: false, source: 'set by you', note: '' };
    if (isChoice) {
      patch.choices = choices.map((c) => ({ label: c.label, text: c.text.trim() }));
      patch.correctLabel = correct;
      patch.answer = patch.choices.find((c) => c.label === correct).text;
      if (item.type === 'tf') patch.correction = correct === falseLabel ? correction.trim() : '';
    } else if (isMulti || isOrder) {
      patch.choices = choices.map((c) => ({ label: c.label, text: c.text.trim() }));
      if (isMulti) {
        patch.correctLabels = patch.choices.filter((c) => many.includes(c.label)).map((c) => c.label);
        patch.answer = patch.choices.filter((c) => many.includes(c.label)).map((c) => c.text).join('; ');
      } else {
        const sorted = patch.choices.map((c, i) => ({ c, n: +nums[i] })).sort((a, b) => a.n - b.n);
        patch.correctOrder = sorted.map((x) => x.c.label);
        patch.answer = sorted.map((x, i) => `${i + 1}. ${x.c.text}`).join('; ');
      }
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
        ) : null}
        {isChoice && item.type === 'tf' && correct === falseLabel && (
          <>
            <label className="muted tiny" htmlFor="ec">Correction (what makes it true, optional)</label>
            <input id="ec" className="big-input" value={correction} onChange={(e) => setCorrection(e.target.value)} />
          </>
        )}
        {isMulti && (
          <fieldset className="radios">
            <legend className="muted tiny">Tick every correct choice</legend>
            {choices.map((c, i) => (
              <label key={c.label} className={'radio' + (many.includes(c.label) ? ' on' : '')}>
                <input type="checkbox" checked={many.includes(c.label)} aria-label={`Choice ${c.label} is correct`} onChange={() => setMany(many.includes(c.label) ? many.filter((x) => x !== c.label) : [...many, c.label])} />
                <span className="rl">{c.label}</span>
                <input className="rt" value={c.text} aria-label={`Choice ${c.label}`} onChange={(e) => setChoices(choices.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              </label>
            ))}
          </fieldset>
        )}
        {isOrder && (
          <fieldset className="radios">
            <legend className="muted tiny">Number each event: 1 for the first, {choices.length} for the last</legend>
            {choices.map((c, i) => (
              <label key={c.label} className="radio">
                <input className="numin" inputMode="numeric" value={nums[i]} aria-label={`Position of event ${c.label}`} onChange={(e) => setNums(nums.map((x, j) => (j === i ? e.target.value.replace(/\D/g, '').slice(0, 2) : x)))} />
                <input className="rt" value={c.text} aria-label={`Event ${c.label}`} onChange={(e) => setChoices(choices.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              </label>
            ))}
            {!numsOk && <p className="muted tiny">Use each number from 1 to {choices.length} once.</p>}
          </fieldset>
        )}
        {isChoice || isMulti || isOrder ? null : (
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

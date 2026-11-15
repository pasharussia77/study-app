import React, { useState } from 'react';
import { backend } from './firebase.js';
import { readTextChunk } from './material.js';
import { chunkText } from './items.js';
import { diagLog } from './diag.js';
import { cardKey } from './stats.js';
import { Icon } from './art.jsx';

const MAX_TEXT = 30000;

export const textHash = (t) => cardKey({ term: String(t || '').trim(), definition: 'text' });

// Sends the typed, pasted or imported text through the same AI step as photos.
export default function TextItems({ code, projectId, text, items, onReview }) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const made = items.filter((i) => i.fileId === 'text');
  const trimmed = text.trim();
  const changed = made.length > 0 && made[0].srcHash !== textHash(text);

  const run = async () => {
    if (made.length && !confirm('Make study items again? This replaces the items made from your text, including any changes you made.')) return;
    setMsg(null);
    const cut = trimmed.slice(0, MAX_TEXT);
    const chunks = chunkText(cut);
    const log = (e) => diagLog(projectId, e);
    const all = [];
    let ctx = null;
    try {
      for (let i = 0; i < chunks.length; i++) {
        setBusy(chunks.length > 1 ? `Reading part ${i + 1} of ${chunks.length}…` : 'Reading your text…');
        const r = await readTextChunk(code, chunks[i], ctx, (e) => log({ ...e, part: i + 1 }), i + 1);
        r.items.forEach((it) => all.push({ ...it, order: all.length }));
        ctx = r.ctx;
      }
      if (!all.length) throw new Error('No questions or words were found in this text.');
      const hash = textHash(text);
      await backend.replaceItemsForFile(code, projectId, 'text', all.map((it) => ({ ...it, srcHash: hash })));
      const flagged = all.filter((i) => i.flagged).length;
      setMsg({ kind: 'ok', review: true, text: `Made ${all.length} study item${all.length === 1 ? '' : 's'} from your text.${flagged ? ` ${flagged} need${flagged === 1 ? 's' : ''} a look.` : ''}${trimmed.length > MAX_TEXT ? ` Only the first ${MAX_TEXT.toLocaleString('en-US')} characters were used.` : ''}` });
    } catch (e) {
      setMsg({ kind: 'error', text: e.message });
    }
    setBusy('');
  };

  return (
    <div className="textitems">
      <p className="muted tiny">Lines like <b>word - definition</b> become cards on their own. For anything else, such as a pasted quiz or notes, let the AI make study items.</p>
      <button className="btn ghost" disabled={trimmed.length < 10 || !!busy} onClick={run}>
        <Icon name="sparkle" />{made.length ? 'Make study items from this text again' : 'Make study items from this text'}
      </button>
      {changed && !busy && <p className="hint">The text changed since the study items were made. Make them again to include the changes.</p>}
      {busy && <p className="hint" role="status">{busy}</p>}
      {msg && (
        <div className={msg.kind === 'ok' ? 'okmsg' : 'error'} role={msg.kind === 'ok' ? 'status' : 'alert'}>
          {msg.text}
          {msg.review && <button className="link inline" onClick={onReview}>Review items</button>}
        </div>
      )}
    </div>
  );
}

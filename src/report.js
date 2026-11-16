// Builds the plain-text diagnostic report the tester pastes back to Claude.
const tz = 'America/New_York';
const time = (t) => new Date(t).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', second: '2-digit' });
const stamp = (t) => new Date(t).toLocaleString('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }) + ' ET';
const kb = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
const clip = (s, n) => (s.length > n ? s.slice(0, n) + `\n[... cut, ${s.length - n} more characters]` : s);
const one = (s, n = 140) => { const x = String(s ?? '').replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n) + '…' : x; };
const sec = (ms) => (ms / 1000).toFixed(1) + ' s';
const NAMES = { none: 'Read everything', handwriting: 'Ignore handwriting (printed only)', printed: 'Ignore printed text (handwriting only)' };

export function buildReport({ version, device, health, profile, project, text, parsed, sum, files, items = [], check = null, events, notes }) {
  const L = [];
  const h = (t) => L.push('', '=== ' + t + ' ===');
  L.push('FAMILY STUDY DIAGNOSTIC REPORT');
  L.push('Created: ' + stamp(Date.now()));
  L.push('App version: ' + version);
  L.push('Account: ' + profile.name + (profile.test ? ' (testing account)' : ''));
  L.push(`Project: ${project.name}`);
  L.push('Device: ' + device);
  const micLine = [...events].reverse().find((e) => e.type === 'voice_heard' && e.stats && e.stats.mic);
  if (micLine) L.push('Microphone: ' + micLine.stats.mic);
  L.push('AI helper: ' + (health ? `model ${health.model}, key present: ${health.hasKey ? 'yes' : 'NO'}` : 'could not be checked'));

  h('YOUR NOTES (written first so a cut-off paste cannot lose them)');
  L.push(notes && notes.trim() ? notes.trim() : '(none)');

  h('1. WHAT WAS ADDED');
  const photoEvents = events.filter((e) => e.type === 'photo_added');
  const reads = events.filter((e) => e.type === 'photo_read' && !e.label);
  L.push(`Photos saved in this project now: ${files.length}`);
  files.forEach((f, i) => {
    const added = photoEvents.find((e) => e.fileId === f.id);
    const reading = [...events].reverse().find((e) => e.type === 'photo_read' && e.fileId === f.id);
    L.push(`Photo ${i + 1}: mode "${NAMES[f.ignore] || f.ignore}", handwriting: ${f.hand === 'student' ? 'student work' : f.hand === 'key' ? 'answer key' : 'not set (answer key)'}, status ${f.status}${f.error ? ' (' + f.error + ')' : ''}${f.page ? `, page graded: ${f.page.graded ? 'yes' : 'no'}${f.page.score ? ', score ' + f.page.score : ''}` : ''}${f.made != null ? ', items made: ' + f.made : ''}`);
    if (added) L.push(`   original ${kb(added.origBytes || 0)} ${added.origType || ''}, stored as ${added.w}x${added.h} (${kb(added.storedChars || 0)})${added.enh ? (added.enh.applied ? `, cleaned up: paper colour ${added.enh.paper.join('/')}, gains ${added.enh.gain.join('/')}, black point ${added.enh.black}${added.enh.whiteBalance ? '' : ' (no colour correction)'}` : `, not cleaned up (${added.enh.why})`) : ''}`);
    if (reading) L.push(`   AI reading: ${reading.ok ? 'ok' : 'FAILED'}, ${sec(reading.ms || 0)}, tokens in/out ${reading.usage?.prompt_tokens ?? '?'}/${reading.usage?.completion_tokens ?? '?'}${reading.made != null ? `, ${reading.made} items (${reading.flagged} need a look)` : ''}`);
  });
  const docs = events.filter((e) => e.type === 'doc_import');
  docs.forEach((d) => L.push(`File "${d.name}" (${kb(d.size || 0)}): ${d.ok === false ? 'FAILED: ' + d.error : d.method + ', ' + (d.pages ? d.pages + ' page(s), ' : '') + d.chars + ' characters, ' + sec(d.ms || 0)}${d.note ? '. ' + d.note : ''}`));
  if (!files.length && !docs.length) L.push('No photos or files were added (text may have been typed or pasted).');

  h('2. THE AI\'S RAW ANSWER, LATEST READING OF EACH PHOTO (first 350 characters)');
  const allReads = events.filter((e) => e.type === 'photo_read' || e.type === 'text_read');
  const rawReads = latestReads(allReads, files);
  if (!rawReads.length) L.push('No AI readings recorded.');
  if (allReads.length > rawReads.length) L.push(`(${allReads.length - rawReads.length} older reading${allReads.length - rawReads.length === 1 ? '' : 's'} left out: earlier readings of the same photo, and readings of photos that were removed.)`);
  const photoNo = new Map(files.map((f, i) => [f.id, i + 1]));
  rawReads.forEach((r) => {
    L.push(`--- ${r.type === 'text_read' ? 'Text' : 'Photo ' + (photoNo.get(r.fileId) ?? '?')} at ${time(r.t)}: ${r.type === 'text_read' ? `typed/pasted text, part ${r.part}, ${r.chars} characters` : (NAMES[r.ignore] || r.ignore)}${r.usage ? `, ${sec(r.ms || 0)}, tokens in/out ${r.usage.prompt_tokens}/${r.usage.completion_tokens}` : ''} ---`);
    L.push(r.ok ? clip(r.raw || '', 350) : 'FAILED: ' + r.error + (r.raw ? '\nRaw answer:\n' + clip(r.raw, 1200) : ''));
  });
  if (rawReads.some((x) => x.type === 'photo_read')) L.push('', `Instruction sent with each picture: mode "${NAMES[(rawReads.find((x) => x.type === 'photo_read') || {}).ignore] || ''}", ${String((rawReads.find((x) => x.type === 'photo_read') || {}).prompt || '').length} characters (the full text is built into this app version).`);

  h('3. STUDY ITEMS THE APP BUILT (from photos and typed text)');
  L.push('Rule: the AI only reports what it sees or what is written (handwritten answers, red X marks, circles, printed keys). The app then decides each correct answer with fixed rules: printed key, then a circled choice, then a red X on a true/false (the other choice), then "no red mark = assumed correct" on a graded page, then on a page without grading the handwriting itself when the reader said it is the answer key (T = True; another word on a true/false line = False plus that correction). "Select all": the choices whose circles are filled by hand. "Put in order": the numbers written beside the events. Anything else has no answer and is flagged.');
  const types = {};
  items.forEach((i) => { types[i.type] = (types[i.type] || 0) + 1; });
  L.push(`Items: ${items.length} (${Object.entries(types).map(([k, v]) => v + ' ' + k).join(', ') || 'none'}); flagged "needs a look": ${items.filter((i) => i.flagged).length}; without an answer: ${items.filter((i) => !i.answer).length}`);
  if (check) L.push(`Score cross-check: sheet says ${check.score} (so ${check.expectedWrong} wrong); items marked wrong: ${check.wrongFound} -> ${check.ok ? 'MATCH' : 'MISMATCH'}. Questions found ${check.questions} of ${check.total}${check.countOk ? '' : ' (MISSING SOME)'}.`);
  const byFile = files.map((f, i) => ({ f, n: i + 1, list: items.filter((x) => x.fileId === f.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) })).filter((g) => g.list.length);
  const textItems = items.filter((x) => x.fileId === 'text').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (textItems.length) byFile.unshift({ f: null, n: 'typed or pasted text', list: textItems });
  L.push('Legend: key = handwritten answer key, printed = printed key, assumed = no red mark on a graded page, page = answer on the page. ch = number of choices.');
  const SRC = { 'handwritten answer key': 'key', 'printed key': 'printed', 'assumed correct (no red mark)': 'assumed', page: 'page', 'set by you': 'edited', none: 'none' };
  const lbl = (it, l) => { const c = (it.choices || []).find((x) => x.label === l); return c ? `${l}. ${one(c.text, 24)}` : l; };
  byFile.forEach((g) => {
    L.push(`--- from ${typeof g.n === 'number' ? 'Photo ' + g.n : g.n} ---`);
    g.list.forEach((it) => {
      let ans;
      if (it.type === 'term' || it.type === 'qa') ans = it.answer ? one(it.answer, 45) : 'NONE';
      else if (it.type === 'multi') ans = `${(it.correctLabels || []).join(',') || 'NONE'} (filled: ${(it.selected || []).join(',') || '-'}${it.unclear && it.unclear.length ? '; unclear: ' + it.unclear.join(',') : ''})`;
      else if (it.type === 'order') ans = `${(it.correctOrder || []).join(',') || 'NONE'} (numbers: ${(it.orderNumbers || []).map((n) => n ?? '-').join(',') || '-'})`;
      else ans = `${it.correctLabel ? lbl(it, it.correctLabel) : 'NONE'}${it.correction ? ' | fix: ' + one(it.correction, 30) : ''} (written: ${one(it.studentAnswer ?? '-', 24)}${it.markedWrong === true ? '; red X' : ''})`;
      const tags = [it.flagged ? 'NEEDS A LOOK' : '', it.confidence && it.confidence !== 'high' ? 'conf ' + it.confidence : '', it.note ? 'note: ' + one(it.note, 90) : ''].filter(Boolean).join(' | ');
      L.push(`${it.number != null ? '#' + it.number + ' ' : ''}${it.type}${it.choices && it.choices.length > 2 ? ' ' + it.choices.length + 'ch' : ''} "${one(it.question, 45)}" -> ${ans} [${SRC[it.source] || it.source}]${tags ? ' | ' + tags : ''}`);
    });
  });
  if (!items.length) L.push('No study items yet.');

  h(`4. TYPED, PASTED AND FILE TEXT (${text.length} characters)`);
  L.push(text ? clip(text, 1500) : '(empty)');
  L.push('Rule: one line becomes one word card only if it has a separator: " - ", " – ", " — ", a tab, " = " or ": ".');
  L.push(`Word cards made from this text: ${parsed.cards.length}; lines skipped: ${parsed.skipped}${textItems.length ? ' (NOT USED: the AI made ' + textItems.length + ' study items from this text, which replace these simple cards)' : ''}`);
  parsed.cards.slice(0, 25).forEach((c, i) => L.push(`  ${i + 1}. "${one(c.term, 80)}"  ->  "${one(c.definition, 120)}"`));
  parsed.skippedLines.slice(0, 25).forEach((s) => L.push('  - skipped: ' + one(s, 130)));

  h('5. PROGRESS NOW');
  L.push(`Everything studyable (typed + photo items with an answer): total ${sum.total}, covered ${sum.covered}, remaining ${sum.remainingCount}, correct ${sum.correct}, incorrect ${sum.incorrect}`);

  h('6. STUDY SESSIONS (most recent activity)');
  const voiceRes = events.filter((e) => e.type === 'voice_result');
  if (voiceRes.length) {
    const sum = (k) => voiceRes.reduce((a, e) => a + (e[k] || 0), 0);
    L.push(`Voice usage in this log: ${sum('recordings')} recordings (${(sum('sttMs') / 1000).toFixed(0)} s waiting on transcription), ${sum('ttsChars')} characters spoken by the tutor voice, AI tokens in/out ${sum('aiIn')}/${sum('aiOut')}.`);
  }
  const study = events.filter((e) => ['session_start', 'answer', 'override', 'round_done', 'voice_turn', 'voice_result', 'voice_visibility', 'voice_heard'].includes(e.type)).slice(-40);
  const rec = (s) => (s ? `${(s.durationMs / 1000).toFixed(1)} s, loudest ${s.peak}, background ${s.floor}, speech: ${s.speech ? 'yes' : 'no'}, ended: ${s.reason}` : '');
  const reco = (e) => (e.sttModel ? ` | recognizer: ${e.sttModel}${e.languages && e.languages.length ? ' (heard as ' + e.languages.map((l) => l.code).join(',') + ')' : ''}, ${e.hints} hint words` : '');
  if (!study.length) L.push('No flashcard or quiz activity recorded yet.');
  study.forEach((e, k) => {
    if (e.type === 'session_start') L.push(`[${time(e.t)}] START ${e.mode}: shows ${e.shows}${e.how ? ', answers by ' + e.how : ''}, cards: ${e.pick}, shuffle ${e.shuffle ? 'on' : 'off'}, ${e.deckSize} in this round`);
    else if (e.type === 'answer') L.push(`[${time(e.t)}] ${e.mode} | Q: "${one(e.question, 90)}" | correct answer: "${one(e.expected, 90)}"${e.given != null ? ' | given: "' + one(e.given, 90) + '"' : ''} | ${e.correct ? 'RIGHT' : 'WRONG'}`);
    else if (e.type === 'voice_turn') {
      // The recording line that follows a judged answer is folded into this one.
      const next = study[k + 1];
      const folded = next && next.type === 'voice_heard' && next.outcome === 'judged' && next.text === e.heard ? next : null;
      L.push(`[${time(e.t)}] voice | Q: "${one(e.question, 80)}" | expected: "${one(e.expected, 80)}" | try ${e.attempt} | heard: "${one(e.heard, 120)}" | ${e.byRule ? 'rule' : 'AI'} verdict: ${e.verdict} | tutor said: "${one(e.tutor, 140)}"${e.gapMs != null ? ` | pause after you stopped talking: ${(e.gapMs / 1000).toFixed(1)} s (hearing ${(e.sttMs / 1000).toFixed(1)}, AI ${(e.aiMs / 1000).toFixed(1)}, voice ${(e.ttsMs / 1000).toFixed(1)})` : ''}${folded ? ` | recording ${rec(folded.stats)}${reco(folded)}` : ''}`);
    }
    else if (e.type === 'voice_heard') {
      const prev = study[k - 1];
      if (e.outcome === 'judged' && prev && prev.type === 'voice_turn' && prev.heard === e.text) return;
      L.push(`[${time(e.t)}] recording (${e.outcome}) | heard: "${one(e.text, 100)}"${e.stats ? ' | ' + rec(e.stats) : ''}${reco(e)}`);
    }
    else if (e.type === 'voice_result') L.push(`[${time(e.t)}] voice result | "${one(e.question, 80)}" -> ${e.right ? 'RIGHT' : 'WRONG'} after ${e.attempts} ${e.attempts === 1 ? 'try' : 'tries'}${e.skipped ? ' (skipped)' : ''}`);
    else if (e.type === 'voice_visibility') L.push(`[${time(e.t)}] the app became ${e.state === 'hidden' ? 'HIDDEN (screen off or app left)' : 'visible again'} while the tutor was: ${e.status}`);
    else if (e.type === 'override') L.push(`[${time(e.t)}] marked "I was right" for: "${one(e.question, 90)}"`);
    else if (e.type === 'round_done') L.push(`[${time(e.t)}] ROUND DONE (${e.mode}): ${e.right} right, ${e.wrong} wrong`);
  });

  return L.join('\n');
}

// Only the latest reading of each photo that is still in the project (and of each part of the typed text), in photo order.
export function latestReads(reads, files = []) {
  const last = new Map();
  reads.forEach((r, i) => {
    const key = r.type === 'text_read' ? 'text:' + (r.part ?? i) : r.fileId != null ? 'photo:' + r.fileId : 'other:' + i;
    last.set(key, r);
  });
  const known = new Set(files.map((f) => f.id));
  const order = new Map(files.map((f, i) => [f.id, i]));
  const kept = [...last.values()].filter((r) => r.type === 'text_read' || r.fileId == null || known.has(r.fileId));
  const rank = (r) => (r.type === 'text_read' ? -1 : order.get(r.fileId) ?? 1e6);
  return kept.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
}

// Cuts a long report into parts that are short enough to paste into a chat one at a time.
// Every part says which one it is and ends with a marker, so a cut-off paste is easy to spot.
export function splitReport(text, max = 10000) {
  const lines = String(text).split('\n');
  const head = lines.slice(0, 3).join(' | ').slice(0, 160);
  const parts = [];
  let cur = [], len = 0;
  for (const line of lines) {
    // a section header starts a new part when the current part is already more than half full
    const starts = /^=== /.test(line) && len > max * 0.5;
    if (cur.length && (len + line.length + 1 > max || starts)) { parts.push(cur.join('\n')); cur = []; len = 0; }
    // one very long line is cut into pieces
    for (let i = 0; i < Math.max(1, Math.ceil(line.length / max)); i++) { const piece = line.slice(i * max, (i + 1) * max); if (i > 0 && cur.length) { parts.push(cur.join('\n')); cur = []; len = 0; } cur.push(piece); len += piece.length + 1; }
  }
  if (cur.length) parts.push(cur.join('\n'));
  const n = parts.length;
  if (n === 1) return [parts[0] + '\nEND OF REPORT'];
  return parts.map((p, i) => `PART ${i + 1} of ${n}${i ? ' (continued) | ' + head : ''}\n${p}\n${i + 1 === n ? 'END OF REPORT (part ' + n + ' of ' + n + ')' : 'END OF PART ' + (i + 1) + ' of ' + n + ' - more follows'}`);
}

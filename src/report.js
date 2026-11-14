// Builds the plain-text diagnostic report the tester pastes back to Claude.
const tz = 'America/New_York';
const time = (t) => new Date(t).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', second: '2-digit' });
const stamp = (t) => new Date(t).toLocaleString('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }) + ' ET';
const kb = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
const clip = (s, n) => (s.length > n ? s.slice(0, n) + `\n[... cut, ${s.length - n} more characters]` : s);
const one = (s, n = 140) => { const x = String(s ?? '').replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n) + '…' : x; };
const sec = (ms) => (ms / 1000).toFixed(1) + ' s';
const NAMES = { none: 'Read everything', handwriting: 'Ignore handwriting (printed only)', printed: 'Ignore printed text (handwriting only)' };

export function buildReport({ version, device, health, profile, project, text, parsed, sum, files, events, notes }) {
  const L = [];
  const h = (t) => L.push('', '=== ' + t + ' ===');
  L.push('FAMILY STUDY DIAGNOSTIC REPORT');
  L.push('Created: ' + stamp(Date.now()));
  L.push('App version: ' + version);
  L.push('Account: ' + profile.name + (profile.test ? ' (testing account)' : ''));
  L.push(`Project: ${project.name}`);
  L.push('Device: ' + device);
  L.push('AI helper: ' + (health ? `model ${health.model}, key present: ${health.hasKey ? 'yes' : 'NO'}` : 'could not be checked'));

  h('1. WHAT WAS ADDED');
  const photoEvents = events.filter((e) => e.type === 'photo_added');
  const reads = events.filter((e) => e.type === 'photo_read' && !e.label);
  L.push(`Photos saved in this project now: ${files.length}`);
  files.forEach((f, i) => {
    const added = photoEvents.find((e) => e.fileId === f.id);
    const reading = [...events].reverse().find((e) => e.type === 'photo_read' && e.fileId === f.id);
    L.push(`Photo ${i + 1}: mode "${NAMES[f.ignore] || f.ignore}", status ${f.status}${f.error ? ' (' + f.error + ')' : ''}`);
    if (added) L.push(`   original ${kb(added.origBytes || 0)} ${added.origType || ''}, stored as ${added.w}x${added.h} (${kb(added.storedChars || 0)})`);
    if (reading) L.push(`   AI reading: ${reading.ok ? 'ok' : 'FAILED'}, ${sec(reading.ms || 0)}, tokens in/out ${reading.usage?.prompt_tokens ?? '?'}/${reading.usage?.completion_tokens ?? '?'}${reading.raw ? ', ' + reading.raw.split('\n').filter(Boolean).length + ' lines' : ''}`);
  });
  const docs = events.filter((e) => e.type === 'doc_import');
  docs.forEach((d) => L.push(`File "${d.name}" (${kb(d.size || 0)}): ${d.ok === false ? 'FAILED: ' + d.error : d.method + ', ' + (d.pages ? d.pages + ' page(s), ' : '') + d.chars + ' characters, ' + sec(d.ms || 0)}${d.note ? '. ' + d.note : ''}`));
  if (!files.length && !docs.length) L.push('No photos or files were added (text may have been typed or pasted).');

  h('2. EXACT AI READING OF EACH PHOTO (raw, before any editing)');
  const rawReads = events.filter((e) => e.type === 'photo_read');
  if (!rawReads.length) L.push('No AI readings recorded.');
  rawReads.forEach((r, i) => {
    L.push(`--- Reading ${i + 1}${r.label ? ' (' + r.label + ')' : ''} at ${time(r.t)}: ${NAMES[r.ignore] || r.ignore} ---`);
    L.push(r.ok ? clip(r.raw || '', 3500) : 'FAILED: ' + r.error);
  });
  if (rawReads[0]) { L.push('', 'Instruction sent to the AI with each picture ("' + (NAMES[rawReads[0].ignore] || '') + '"):', rawReads[0].prompt); }

  h(`3. MATERIAL TEXT NOW IN THE PROJECT (${text.length} characters)`);
  L.push(text ? clip(text, 4000) : '(empty)');

  h('4. HOW THE APP TURNED THE TEXT INTO CARDS');
  L.push('Rule: one line becomes one card only if it has a separator: " - ", " – ", " — ", a tab, " = " or ": ". The part before it is the word, the part after is the definition. Nothing else is read as a card yet.');
  L.push(`Cards created: ${parsed.cards.length}`);
  parsed.cards.slice(0, 60).forEach((c, i) => L.push(`  ${i + 1}. "${one(c.term, 80)}"  ->  "${one(c.definition, 120)}"`));
  L.push(`Lines skipped (no separator): ${parsed.skipped}`);
  parsed.skippedLines.slice(0, 40).forEach((s) => L.push('  - ' + one(s, 130)));
  if (parsed.skippedLines.length > 40) L.push(`  ... and ${parsed.skippedLines.length - 40} more`);

  h('5. PROGRESS NOW');
  L.push(`Total ${sum.total}, covered ${sum.covered}, remaining ${sum.remainingCount}, correct ${sum.correct}, incorrect ${sum.incorrect}`);

  h('6. STUDY SESSIONS (most recent activity)');
  const study = events.filter((e) => ['session_start', 'answer', 'override', 'round_done'].includes(e.type)).slice(-70);
  if (!study.length) L.push('No flashcard or quiz activity recorded yet.');
  study.forEach((e) => {
    if (e.type === 'session_start') L.push(`[${time(e.t)}] START ${e.mode}: shows ${e.shows}${e.how ? ', answers by ' + e.how : ''}, cards: ${e.pick}, shuffle ${e.shuffle ? 'on' : 'off'}, ${e.deckSize} in this round`);
    else if (e.type === 'answer') L.push(`[${time(e.t)}] ${e.mode} | Q: "${one(e.question, 90)}" | correct answer: "${one(e.expected, 90)}"${e.given != null ? ' | given: "' + one(e.given, 90) + '"' : ''} | ${e.correct ? 'RIGHT' : 'WRONG'}`);
    else if (e.type === 'override') L.push(`[${time(e.t)}] marked "I was right" for: "${one(e.question, 90)}"`);
    else if (e.type === 'round_done') L.push(`[${time(e.t)}] ROUND DONE (${e.mode}): ${e.right} right, ${e.wrong} wrong`);
  });

  h('7. TESTER NOTES');
  L.push(notes && notes.trim() ? notes.trim() : '(none)');
  return L.join('\n');
}

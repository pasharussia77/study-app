// A scripted speech-recognition test: the hardest words and phrases for a speaker with an accent.
import { normalize, isCorrect } from './stats.js';

const letter = (say, accept) => ({ say, accept, letter: true, group: 'Letters and true/false' });
const word = (say, group, accept = []) => ({ say, accept, group });
export const SPEECH_ITEMS = [
  letter('A', ['a', 'ay', 'eh']), letter('B', ['b', 'bee', 'be']), letter('C', ['c', 'see', 'sea']), letter('D', ['d', 'dee']),
  word('True', 'Letters and true/false'), word('False', 'Letters and true/false'),
  word('Giraffe', 'Quiz words'), word('Mouse', 'Quiz words'), word('Cow', 'Quiz words'), word('Puppy', 'Quiz words'),
  word('Elephant', 'Quiz words'), word('Butterfly', 'Quiz words'), word('Herbivore', 'Quiz words'), word('Habitat', 'Quiz words'),
  word('Think', 'Tricky sounds'), word('Three', 'Tricky sounds'), word('Thirty', 'Tricky sounds', ['30']), word('Fifteen', 'Tricky sounds', ['15']),
  word('Fifty', 'Tricky sounds', ['50']), word('Very', 'Tricky sounds'), word('Wine', 'Tricky sounds'), word('Light', 'Tricky sounds'),
  word('Sheep', 'Tricky sounds'), word('Ship', 'Tricky sounds'),
  word('Photosynthesis', 'Long words'), word('Mitochondria', 'Long words'), word('Inerrancy', 'Long words'), word('Infallibility', 'Long words'), word('Circular reasoning', 'Long words'),
  word('A black and white bird that cannot fly', 'Phrases'), word("I don't know", 'Phrases'), word('Repeat the question', 'Phrases'), word('Skip', 'Phrases'), word('It has a long trunk and big ears', 'Phrases')
];

const plain = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// 'exact' | 'close' | 'miss' | 'empty'
export function scoreHeard(heard, item) {
  const h = String(heard || '').trim();
  if (!h) return 'empty';
  const accepts = [item.say, ...(item.accept || [])];
  if (item.letter) return accepts.some((a) => plain(a) === plain(h)) ? 'exact' : 'miss';
  if (accepts.some((a) => normalize(a) === normalize(h))) return 'exact';
  if (accepts.some((a) => ` ${normalize(h)} `.includes(` ${normalize(a)} `) && normalize(h).split(' ').length <= normalize(a).split(' ').length + 2)) return 'close';
  if (accepts.some((a) => isCorrect(h, a))) return 'close';
  return 'miss';
}

export function speechHints() {
  const short = (x) => (x.length <= 40 ? x : x.split(/\s+/).slice(0, 4).join(' '));
  return {
    prompt: 'A student is saying words and phrases out loud in English, one at a time. Single letters, numbers and quiz answers are common.',
    keywords: [...new Set(SPEECH_ITEMS.map((i) => short(i.say)))]
  };
}

const tz = 'America/New_York';
const stamp = (t) => new Date(t).toLocaleString('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }) + ' ET';
const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '-');
const MARK = { exact: 'OK', close: 'close', miss: 'WRONG', empty: 'NOTHING' };

export function tally(results, key) {
  const t = { exact: 0, close: 0, miss: 0, empty: 0 };
  results.filter((r) => !r.skipped).forEach((r) => { t[r[key]]++; });
  return t;
}

export function buildSpeechReport({ version, device, results, notes, startedAt }) {
  const L = [];
  const done = results.filter((r) => !r.skipped);
  const models = [...new Set(done.flatMap((r) => [r.withHints && r.withHints.model, r.without && r.without.model]).filter(Boolean))];
  L.push('SPEECH RECOGNITION TEST REPORT');
  L.push('Created: ' + stamp(Date.now()) + (startedAt ? ' (started ' + stamp(startedAt) + ')' : ''));
  L.push('App version: ' + version);
  L.push('Account: Test (testing account)');
  L.push('Device: ' + device);
  L.push('Recognizer(s) answering: ' + (models.join(', ') || 'unknown'));
  const mic = done.find((r) => r.stats && r.stats.mic);
  L.push('Microphone: ' + (mic ? mic.stats.mic : 'unknown'));
  L.push('');
  L.push('=== SUMMARY ===');
  L.push(`Words asked: ${SPEECH_ITEMS.length}; recorded: ${done.length}; skipped: ${results.length - done.length}; not reached: ${SPEECH_ITEMS.length - results.length}`);
  const a = tally(results, 'verdictWith'), b = tally(results, 'verdictWithout');
  const line = (t) => `exact ${t.exact}, close ${t.close}, wrong ${t.miss}, nothing ${t.empty} (usable: ${pct(t.exact + t.close, done.length)})`;
  L.push('With word hints (like the quiz):  ' + line(a));
  L.push('Without any hints:                ' + line(b));
  const rank = { exact: 3, close: 2, miss: 1, empty: 0 };
  const helped = done.filter((r) => rank[r.verdictWith] > rank[r.verdictWithout]).length;
  const hurt = done.filter((r) => rank[r.verdictWith] < rank[r.verdictWithout]).length;
  L.push(`Hints helped on ${helped} words, hurt on ${hurt}, made no difference on ${done.length - helped - hurt}.`);
  L.push('');
  L.push('=== BY GROUP (usable = exact or close; with hints / without hints) ===');
  [...new Set(SPEECH_ITEMS.map((i) => i.group))].forEach((g) => {
    const rs = done.filter((r) => r.item.group === g);
    if (!rs.length) return;
    const ok = (k) => rs.filter((r) => r[k] === 'exact' || r[k] === 'close').length;
    L.push(`${g}: ${ok('verdictWith')} / ${ok('verdictWithout')} of ${rs.length}`);
  });
  L.push('');
  L.push('=== EVERY WORD ===');
  results.forEach((r, n) => {
    if (r.skipped) { L.push(`${n + 1}. [${r.item.group}] should say: "${r.item.say}" -> SKIPPED`); return; }
    const s = r.stats || {};
    const lang = (x) => (x && x.languages && x.languages.length ? ' [' + x.languages.map((l) => l.code).join(',') + ']' : '');
    L.push(`${n + 1}. [${r.item.group}] should say: "${r.item.say}"`);
    L.push(`     with hints:    "${(r.withHints && r.withHints.text) || ''}"${lang(r.withHints)} -> ${MARK[r.verdictWith]}`);
    L.push(`     without hints: "${(r.without && r.without.text) || ''}"${lang(r.without)} -> ${MARK[r.verdictWithout]}`);
    L.push(`     recording: ${((s.durationMs || 0) / 1000).toFixed(1)} s, ${Math.round((s.bytes || 0) / 1024)} KB, loudest ${s.peak}, background ${s.floor}, speech detected: ${s.speech ? 'yes' : 'no'}, ended by: ${s.reason}`);
  });
  L.push('');
  L.push('=== TESTER NOTES ===');
  L.push(notes && notes.trim() ? notes.trim() : '(none)');
  return L.join('\n');
}

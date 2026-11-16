import React, { useEffect, useMemo, useRef, useState } from 'react';
import { backend, isMock } from './firebase.js';
import { parseCards, shuffle, datedName, niceDate, shortName, makeFamilyCode, cleanCode } from './parse.js';
import { APP_VERSION } from './version.js';
import Flashcards from './Flashcards.jsx';
import Quiz from './Quiz.jsx';
import Voice from './Voice.jsx';
import SpeechTest from './SpeechTest.jsx';
import Sources from './Sources.jsx';
import ReportSheet from './Report.jsx';
import { diagClear } from './diag.js';
import Items from './Items.jsx';
import Settings from './Settings.jsx';
import Worn from './Worn.jsx';
import FamilySettings from './FamilySettings.jsx';
import PinSheet from './Pin.jsx';
import { applyTheme, cleanTheme, DEFAULT_THEME } from './theme.js';
import TextItems, { textHash } from './TextItems.jsx';
import { useStats, StatsStrip } from './Session.jsx';
import { buildDeck } from './deck.js';
import { Icon, BookLogo, Scenery, Avatar, avatarKind, TileArt, ProjectThumb } from './art.jsx';
import { startNav, pushScreen, replaceScreen, resetTo, goUp, goToScreen, useOverlay } from './nav.js';

const COLORS = ['#FF6B5E', '#2BB3FF', '#19C79A'];
const store = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} }
};

export default function App() {
  const [view, setView] = useState({ screen: 'loading' });
  const [code, setCode] = useState(store.get('familyCode'));
  const [family, setFamily] = useState(store.get('family'));

  useEffect(() => {
    (async () => {
      try { await backend.init(); } catch {}
      if (code && family) {
        // The app always opens on the family page, where you choose who is studying.
        startNav([{ screen: 'profiles' }], setView);
      } else startNav([{ screen: 'welcome' }], setView);
    })();
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (!code) return;
    return backend.watchFamily(code, (f) => { setFamily(f); store.set('family', f); });
  }, [code]);

  // Each student has their own colors. The page shows the colors of whoever was in their own area last, main page included.
  const themeOf = (id) => cleanTheme(family?.profiles.find((x) => x.id === id)?.theme);
  const familyRef = useRef(null);
  familyRef.current = family;
  const saveTimer = useRef(null);
  const saveTheme = (id, theme) => {
    const next = { profiles: familyRef.current.profiles.map((x) => (x.id === id ? { ...x, theme } : x)) };
    familyRef.current = next; setFamily(next); store.set('family', next);
    backend.setProfiles(code, next.profiles).catch(() => {}); // the Colors screen already waits for the dot to settle
  };
  useEffect(() => {
    if (view.screen === 'settings') return; // the settings screen shows its own live choice
    // A student's own colours show only inside that student's area. Family screens always use the default colours.
    applyTheme(view.profile && family ? themeOf(view.profile.id) : DEFAULT_THEME);
    // eslint-disable-next-line
  }, [view.screen, view.profile?.id, family]);

  const enterFamily = (c, f) => {
    store.set('familyCode', c); store.set('family', f);
    setCode(c); setFamily(f); resetTo({ screen: 'profiles' });
  };
  const leaveFamily = () => {
    ['familyCode', 'family', 'profileId'].forEach(store.del);
    applyTheme(DEFAULT_THEME);
    setCode(null); setFamily(null); resetTo({ screen: 'welcome' });
  };
  const addTest = async () => {
    if (family.profiles.some((p) => p.id === 'test')) return;
    const next = { profiles: [...family.profiles, { id: 'test', name: 'Test', color: '#F59E0B', test: true }] };
    setFamily(next); store.set('family', next);
    try { await backend.setProfiles(code, next.profiles); } catch {}
  };
  const pickProfile = (p) => { store.set('profileId', p.id); pushScreen({ screen: 'home', profile: p }); };

  const { screen, profile, project } = view;
  if (screen === 'loading') return <Shell><p className="muted center-msg">Loading…</p></Shell>;
  if (screen === 'welcome') return <Shell><Welcome onCreate={() => replaceScreen({ screen: 'create' })} onJoin={() => replaceScreen({ screen: 'join' })} /></Shell>;
  if (screen === 'create') return <Shell><CreateFamily onBack={() => (family ? goUp() : replaceScreen({ screen: 'welcome' }))} onDone={enterFamily} /></Shell>;
  if (screen === 'join') return <Shell><JoinFamily onBack={() => (family ? goUp() : replaceScreen({ screen: 'welcome' }))} onDone={enterFamily} /></Shell>;
  if (screen === 'profiles') return <Shell><Profiles family={family} onPick={pickProfile} onSettings={() => pushScreen({ screen: 'family' })} /></Shell>;
  if (screen === 'family') return <Shell><FamilySettings code={code} family={family} version={APP_VERSION + (isMock ? ' (test mode)' : '')} onCreate={() => replaceScreen({ screen: 'create' })} onJoin={() => replaceScreen({ screen: 'join' })} onLeave={leaveFamily} onAddTest={addTest} /></Shell>;
  if (screen === 'home') return (
    <Shell>
      <Home code={code} profile={profile} onSwitch={goUp} onSettings={() => pushScreen({ screen: 'settings', profile })} onSpeechTest={() => pushScreen({ screen: 'speechtest', profile })}
        onOpen={(p) => pushScreen({ screen: 'project', profile, project: p })} />
    </Shell>
  );
  if (screen === 'project') return (
    <Shell>
      <Project key={project.id} code={code} projectId={project.id} profile={profile} onBack={goUp}
        onStudy={(mode, deck) => pushScreen({ screen: 'study', profile, project, mode, deck })}
        onReview={() => pushScreen({ screen: 'items', profile, project })} />
    </Shell>
  );
  if (screen === 'settings') return <Shell><Settings profile={profile} theme={themeOf(profile.id)} onChange={(t) => saveTheme(profile.id, t)} /></Shell>;
  if (screen === 'speechtest') return <Shell><SpeechTest code={code} onExit={goUp} /></Shell>;
  if (screen === 'items') return <Shell><Items code={code} projectId={project.id} /></Shell>;
  if (screen === 'study') {
    const Mode = view.mode === 'quiz' ? Quiz : view.mode === 'voice' ? Voice : Flashcards;
    return <Shell><Mode cards={view.deck} code={code} projectId={project.id} onExit={goUp} /></Shell>;
  }
  return null;
}

// "Family > Anna": shows where you are; each earlier level is a button that jumps there.
function Crumbs({ items }) {
  return (
    <nav className="crumbs" aria-label="You are here">
      {items.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span aria-hidden="true">›</span>}
          {c.onClick ? <button onClick={c.onClick}>{c.label}</button> : <span aria-current="page">{c.label}</span>}
        </React.Fragment>
      ))}
    </nav>
  );
}

// The worn-paper layer is inside the page, so it scrolls with the content.
function Shell({ children }) { return <main className="shell">{children}<Worn /></main>; }

function Back({ onClick, label = 'Back' }) {
  return <button className="back pill" onClick={onClick} aria-label={label}><Icon name="left" size={20} /> {label}</button>;
}

/* ---------- Setting up the family ---------- */

function Welcome({ onCreate, onJoin }) {
  return (
    <section className="welcome">
      <Scenery kind="lake" />
      <div className="brand">
        <BookLogo size={132} />
        <h1>Study, your way</h1>
        <p className="lead">Turn your notes into flashcards and quizzes.</p>
      </div>
      <div className="stack">
        <button className="btn primary" onClick={onJoin}><Icon name="key" />I have a family code</button>
        <button className="btn ghost" onClick={onCreate}><Icon name="users" />Start a new family</button>
      </div>
    </section>
  );
}

function CreateFamily({ onBack, onDone }) {
  const [names, setNames] = useState(['', '', '']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [made, setMade] = useState(null);
  const ok = names.every((n) => n.trim());
  const create = async () => {
    setBusy(true); setErr('');
    try {
      const c = makeFamilyCode();
      const profiles = names.map((n, i) => ({ id: 'kid' + (i + 1), name: n.trim(), color: COLORS[i] }));
      await backend.createFamily(c, profiles);
      setMade({ code: c, family: { profiles } });
    } catch (e) {
      setErr('Could not create the family. Check your internet connection and try again.');
    }
    setBusy(false);
  };
  if (made) return (
    <section className="setup">
      <Scenery kind="lake" />
      <h1>Your family code</h1>
      <p className="lead">Enter this code on every phone that should use the app. Write it down somewhere safe.</p>
      <div className="code-box" data-testid="family-code">{made.code}</div>
      <div className="stack">
        <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(made.code)}><Icon name="copy" />Copy code</button>
        <button className="btn primary" onClick={() => onDone(made.code, made.family)}>Continue</button>
      </div>
    </section>
  );
  return (
    <section className="setup">
      <Scenery kind="lake" />
      <Back onClick={onBack} />
      <h1>Who will study?</h1>
      <p className="lead">Add each person's name.</p>
      <div className="stack">
        {names.map((n, i) => (
          <label key={i} className="field">
            <Avatar kind={avatarKind({ id: 'kid' + (i + 1) })} size={36} />
            <input value={n} placeholder={`Name ${i + 1}`} maxLength={20}
              onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))} />
          </label>
        ))}
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      <button className="btn primary bottom" disabled={!ok || busy} onClick={create}>{busy ? 'Creating…' : 'Create family'}</button>
    </section>
  );
}

function JoinFamily({ onBack, onDone }) {
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const join = async () => {
    setBusy(true); setErr('');
    const c = cleanCode(val);
    try {
      const f = await backend.getFamily(c);
      if (f) onDone(c, { profiles: f.profiles });
      else setErr('No family found with that code. Check the spelling and try again.');
    } catch {
      setErr('Could not reach the app. Check your internet connection and try again.');
    }
    setBusy(false);
  };
  return (
    <section className="setup">
      <Scenery kind="lake" />
      <Back onClick={onBack} />
      <h1>Enter your family code</h1>
      <p className="lead">It looks like <b>maple-otter-reef-482</b>.</p>
      <input className="big-input" value={val} onChange={(e) => setVal(e.target.value)} placeholder="family code"
        autoCapitalize="none" autoCorrect="off" spellCheck="false" aria-label="Family code" />
      {err && <p className="error" role="alert">{err}</p>}
      <button className="btn primary bottom" disabled={!val.trim() || busy} onClick={join}>{busy ? 'Checking…' : 'Join'}</button>
    </section>
  );
}

/* ---------- Profiles and projects ---------- */

function Profiles({ family, onPick, onSettings }) {
  const [pinFor, setPinFor] = useState(null); // the testing account asks for its code first
  const lastId = store.get('profileId'); // the person who studied last on this phone
  const choose = (p) => (p.test ? setPinFor(p) : onPick(p));
  return (
    <section className="who">
      <Scenery kind="lake" />
      <button className="gear corner" onClick={onSettings} aria-label="Family settings"><Icon name="gear" size={24} /></button>
      <div className="brand small">
        <BookLogo size={84} />
        <div className="famhead"><Icon name="home" size={18} /><b>Our family</b></div>
      </div>
      <h1>Who's studying?</h1>
      <p className="muted">Tap a name to open that person's projects.</p>
      <div className="tiles">
        {family.profiles.map((p, i) => (
          <button key={p.id} className={'tile' + (p.test ? ' test' : '') + (p.id === lastId ? ' last' : '')} onClick={() => choose(p)} style={{ '--c': p.color }}>
            {p.id === lastId && <span className="tick" aria-hidden="true"><Icon name="check" size={16} /></span>}
            <Avatar kind={avatarKind(p, i)} size={78} />
            <span className="tile-name">{p.name}</span>
            {p.test && <span className="tag"><Icon name="lock" size={12} /> Testing</span>}
          </button>
        ))}
      </div>
      <footer className="foot plain">
        <p className="version-pill" data-testid="version">Version {APP_VERSION}{isMock ? ' (test mode)' : ''}</p>
      </footer>
      {pinFor && <PinSheet name={pinFor.name} onCancel={() => setPinFor(null)} onOk={() => { const p = pinFor; setPinFor(null); setTimeout(() => onPick(p), 200); }} />}
    </section>
  );
}

function Home({ code, profile, onSwitch, onOpen, onSettings, onSpeechTest }) {
  const [projects, setProjects] = useState(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => backend.watchProjects(code, profile.id, (list) => setProjects(list.sort((a, b) => b.createdAt - a.createdAt)), () => setErr('Could not load projects.')), [code, profile.id]);
  const add = async () => {
    const full = datedName(name);
    setName(''); setAdding(false);
    try { const id = await backend.createProject(code, profile.id, full); onOpen({ id, name: full }); }
    catch { setErr('Could not create the project. Try again.'); }
  };
  return (
    <section className="home on-scene">
      <Scenery kind="peaks" />
      <Back onClick={onSwitch} label="Family" />
      <div className="hello">
        <button className="avatar-btn" onClick={onSwitch} aria-label="Switch person"><Avatar kind={avatarKind(profile)} size={64} /></button>
        <div>
          <p className="hi">Hi, {profile.name}! <span aria-hidden="true">👋</span></p>
          <Crumbs items={[{ label: 'Family', onClick: onSwitch }, { label: profile.name }]} />
        </div>
        <button className="gear" onClick={onSettings} aria-label="Colors and settings"><Icon name="gear" size={24} /></button>
      </div>
      <header className="top">
        <TileArt kind="folder" />
        <h1>{profile.name}'s projects</h1>
      </header>
      {profile.test && (
        <div className="testtools">
          <b><Icon name="flask" size={18} /> Speech recognition test</b>
          <p className="muted tiny">A scripted test with the trickiest words, about 5 minutes. It ends with a report to send to Claude.</p>
          <button className="btn ghost" onClick={onSpeechTest}><Icon name="mic" />Run the speech test</button>
        </div>
      )}
      {err && <p className="error" role="alert">{err}</p>}
      {projects && projects.length === 0 && !adding && (
        <div className="empty"><TileArt kind="folder" /><p>No projects yet.</p><p className="muted">Create one, paste your notes, and get flashcards.</p></div>
      )}
      <ul className="list">
        {(projects || []).map((p) => (
          <li key={p.id}>
            <button className="card-row" onClick={() => onOpen(p)}>
              <ProjectThumb name={p.name} />
              <span className="row-main">
                <span className="row-title">{shortName(p.name)}</span>
                <span className="muted">{niceDate(p.createdAt)}</span>
              </span>
              <Icon name="right" className="row-go" />
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="sheet">
          <label className="muted" htmlFor="pname">Project name</label>
          <input id="pname" autoFocus className="big-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Biology chapter 4" maxLength={60}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && add()} />
          <p className="muted tiny">Today's date is added to the name.</p>
          <div className="row">
            <button className="btn ghost" onClick={() => { setAdding(false); setName(''); }}>Cancel</button>
            <button className="btn primary" disabled={!name.trim()} onClick={add}>Create project</button>
          </div>
        </div>
      ) : <button className="btn primary bottom" onClick={() => setAdding(true)}><Icon name="plus" />New project</button>}
    </section>
  );
}

function Project({ code, projectId, profile, onBack, onStudy, onReview }) {
  const [p, setP] = useState(null);
  const [text, setText] = useState('');
  const [state, setState] = useState('saved');
  const [reporting, setReporting] = useState(false);
  const [userOpen, setUserOpen] = useState(null); // null = not decided yet
  const timer = useRef(null);
  const latest = useRef('');
  useEffect(() => { backend.getProject(code, projectId).then((x) => { setP(x); setText(x?.text || ''); latest.current = x?.text || ''; }); }, [code, projectId]);
  const save = async (t) => {
    clearTimeout(timer.current);
    try { await backend.saveProjectText(code, projectId, t); setState('saved'); } catch { setState('error'); }
  };
  const change = (t) => {
    setText(t); latest.current = t; setState('saving');
    clearTimeout(timer.current); timer.current = setTimeout(() => save(t), 800);
  };
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); backend.saveProjectText(code, projectId, latest.current).catch(() => {}); } }, [code, projectId]);
  const append = (t) => {
    const base = latest.current.replace(/\s+$/, '');
    change((base ? base + '\n\n' : '') + t.trim());
  };
  const { cards, skipped } = useMemo(() => parseCards(text), [text]);
  const [items, setItems] = useState(null);
  const [files, setFiles] = useState(null);
  useEffect(() => backend.watchItems(code, projectId, setItems), [code, projectId]);
  useEffect(() => backend.watchFiles(code, projectId, setFiles), [code, projectId]);
  useOverlay(reporting, () => setReporting(false));
  const itemList = items || [], fileList = files || [];
  const { deck, notReady } = useMemo(() => buildDeck(cards, itemList, fileList), [cards, items, files]); // eslint-disable-line
  const flagged = itemList.filter((i) => i.flagged).length;
  const textMade = itemList.some((i) => i.fileId === 'text');
  const textChanged = textMade && itemList.find((i) => i.fileId === 'text').srcHash !== textHash(text);
  const unread = fileList.filter((f) => f.status !== 'done').length;
  const { sum } = useStats(code, projectId, deck);

  // The material section starts folded once a project has anything in it; an empty project starts open.
  const ready = p && items !== null && files !== null;
  const empty = ready && deck.length === 0 && itemList.length === 0 && fileList.length === 0;
  useEffect(() => { if (userOpen === null && empty) setUserOpen(true); }, [userOpen, empty]);
  const open = userOpen === true;
  const foldRef = useRef(null);
  const showMaterial = () => {
    setUserOpen(true);
    setTimeout(() => foldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  if (!p) return <section><Back onClick={onBack} /><p className="muted">Loading…</p></section>;
  const del = async () => {
    if (confirm('Delete this project and its material?')) { clearTimeout(timer.current); timer.current = null; await backend.deleteProject(code, projectId); diagClear(projectId); onBack(); }
  };
  const bits = [];
  if (fileList.length) bits.push(`${fileList.length} photo${fileList.length === 1 ? '' : 's'}`);
  if (itemList.length) bits.push(`${itemList.length} study item${itemList.length === 1 ? '' : 's'}`);
  if (cards.length && !textMade) bits.push(`${cards.length} typed card${cards.length === 1 ? '' : 's'}`);
  if (textMade) bits.push('typed text turned into items');
  const warns = [];
  if (unread) warns.push(`${unread} photo${unread === 1 ? '' : 's'} not read yet`);
  if (flagged) warns.push(`${flagged} item${flagged === 1 ? '' : 's'} need${flagged === 1 ? 's' : ''} a look`);
  if (notReady) warns.push(`${notReady} without an answer`);
  if (textChanged) warns.push('text changed since items were made');
  return (
    <section>
      <Back onClick={onBack} label={`${profile.name}'s projects`} />
      <Crumbs items={[{ label: 'Family', onClick: () => goToScreen('profiles') }, { label: profile.name, onClick: onBack }]} />
      <header className="top proj">
        <ProjectThumb name={p.name} />
        <div className="row-main">
          <h1 className="proj-title">{shortName(p.name)}</h1>
          {p.createdAt ? <span className="muted proj-date">{niceDate(p.createdAt)}</span> : null}
        </div>
      </header>
      {deck.length > 0 && (
        <>
          <StatsStrip sum={sum} />
          <div className="modes">
            <button className="mode-tile flash" onClick={() => onStudy('flash', deck)}><TileArt kind="flash" /><span>Flashcards</span></button>
            <button className="mode-tile quiz" onClick={() => onStudy('quiz', deck)}><TileArt kind="quiz" /><span>Written quiz</span></button>
            <button className="mode-tile voice" onClick={() => onStudy('voice', deck)}><TileArt kind="voice" /><span>Voice quiz</span></button>
            <button className="mode-tile mat" onClick={showMaterial}><TileArt kind="folder" /><span>My material</span></button>
          </div>
          {sum.incorrect > 0 && <p className="hint"><Icon name="target" size={20} />{sum.incorrect} {sum.incorrect === 1 ? 'card needs' : 'cards need'} another try. Choose "Missed only" when you start.</p>}
        </>
      )}

      <button ref={foldRef} className="fold" aria-expanded={open} aria-controls="material-body" onClick={() => setUserOpen(!open)}>
        <span className="fold-ic"><Icon name="layers" /></span>
        <span className="fold-main">
          <span className="fold-title">Material and photos</span>
          <span className="fold-sub">{bits.length ? bits.join(' · ') : 'Add photos, a PDF or text'}</span>
          {warns.length > 0 && <span className="fold-warn">{warns.join(' · ')}</span>}
        </span>
        <Icon name="down" className="chev" />
      </button>
      <div id="material-body" className="fold-body" hidden={!open}>
        <Sources code={code} projectId={projectId} projectName={p.name} canSave={!!profile?.test} onAppend={append} onReview={onReview} />
        {itemList.length > 0 && (
          <button className="btn ghost" onClick={onReview}>
            <Icon name="list" />Review study items ({itemList.length}){flagged > 0 ? ` · ${flagged} need a look` : ''}
          </button>
        )}
        <label className="label" htmlFor="material">Typed or pasted material</label>
        <textarea id="material" className="material" value={text} onChange={(e) => change(e.target.value)}
          placeholder={'Paste your notes here.\nWrite one item per line:\n\nphotosynthesis - how plants turn light into food\nmitochondria - the cell\'s power plant'} />
        <p className="status" aria-live="polite">
          {state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved – check your connection' : 'Saved'}
          {cards.length > 0 && !textMade ? ` · ${cards.length} typed ${cards.length === 1 ? 'card' : 'cards'}` : ''}
        </p>
        <TextItems code={code} projectId={projectId} text={text} items={itemList} onReview={onReview} />
        {profile?.test && (
          <div className="testtools">
            <b><Icon name="flask" size={18} /> Testing tools</b>
            <p className="muted tiny">Creates a report of what was read, how cards were made, and how your quiz went. Paste it to Claude.</p>
            <button className="btn ghost" onClick={() => setReporting(true)}>Create diagnostic report</button>
          </div>
        )}
        <button className="link danger" onClick={del}><Icon name="trash" size={18} />Delete project</button>
      </div>
      {reporting && <ReportSheet code={code} project={p} profile={profile} text={text} deck={deck} onClose={() => setReporting(false)} />}
    </section>
  );
}

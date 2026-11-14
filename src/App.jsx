import React, { useEffect, useMemo, useRef, useState } from 'react';
import { backend, isMock } from './firebase.js';
import { parseCards, shuffle, datedName, niceDate, makeFamilyCode, cleanCode } from './parse.js';
import { APP_VERSION } from './version.js';
import Flashcards from './Flashcards.jsx';
import Quiz from './Quiz.jsx';
import Sources from './Sources.jsx';
import { useStats, StatsStrip } from './Session.jsx';

const COLORS = ['#FF6B5E', '#2BB3FF', '#19C79A'];
const store = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} }
};

export default function App() {
  const [screen, setScreen] = useState('loading');
  const [code, setCode] = useState(store.get('familyCode'));
  const [family, setFamily] = useState(store.get('family'));
  const [profile, setProfile] = useState(null);
  const [project, setProject] = useState(null);
  const [study, setStudy] = useState(null);

  useEffect(() => {
    (async () => {
      try { await backend.init(); } catch {}
      if (code && family) {
        const savedProfile = store.get('profileId');
        const p = savedProfile && family.profiles.find((x) => x.id === savedProfile);
        setProfile(p || null);
        setScreen(p ? 'home' : 'profiles');
      } else setScreen('welcome');
    })();
    // eslint-disable-next-line
  }, []);

  const enterFamily = (c, f) => {
    store.set('familyCode', c); store.set('family', f);
    setCode(c); setFamily(f); setScreen('profiles');
  };
  const leaveFamily = () => {
    ['familyCode', 'family', 'profileId'].forEach(store.del);
    setCode(null); setFamily(null); setProfile(null); setScreen('welcome');
  };
  const pickProfile = (p) => { store.set('profileId', p.id); setProfile(p); setScreen('home'); };

  if (screen === 'loading') return <Shell><p className="muted center-msg">Loading…</p></Shell>;
  if (screen === 'welcome') return <Shell><Welcome onCreate={() => setScreen('create')} onJoin={() => setScreen('join')} /></Shell>;
  if (screen === 'create') return <Shell><CreateFamily onBack={() => setScreen('welcome')} onDone={enterFamily} /></Shell>;
  if (screen === 'join') return <Shell><JoinFamily onBack={() => setScreen('welcome')} onDone={enterFamily} /></Shell>;
  if (screen === 'profiles') return <Shell><Profiles family={family} code={code} onPick={pickProfile} onLeave={leaveFamily} /></Shell>;
  if (screen === 'home') return (
    <Shell>
      <Home code={code} profile={profile} onSwitch={() => setScreen('profiles')}
        onOpen={(p) => { setProject(p); setScreen('project'); }} />
    </Shell>
  );
  if (screen === 'project') return (
    <Shell>
      <Project code={code} projectId={project.id} onBack={() => setScreen('home')}
        onStudy={(mode, cards) => { setStudy({ mode, cards }); setScreen('study'); }} />
    </Shell>
  );
  if (screen === 'study') {
    const Mode = study.mode === 'quiz' ? Quiz : Flashcards;
    return <Shell><Mode cards={study.cards} code={code} projectId={project.id} onExit={() => setScreen('project')} /></Shell>;
  }
  return null;
}

function Shell({ children }) { return <main className="shell">{children}</main>; }

function Back({ onClick, label = 'Back' }) {
  return <button className="back" onClick={onClick} aria-label={label}><span aria-hidden="true">‹</span> {label}</button>;
}

/* ---------- Setting up the family ---------- */

function Welcome({ onCreate, onJoin }) {
  return (
    <section className="welcome">
      <div className="logo" aria-hidden="true"><span className="logo-back" /><span className="logo-front">✓</span></div>
      <h1>Study, your way</h1>
      <p className="lead">Turn your notes into flashcards and quizzes.</p>
      <div className="stack">
        <button className="btn primary" onClick={onJoin}>I have a family code</button>
        <button className="btn ghost" onClick={onCreate}>Start a new family</button>
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
    <section>
      <h1>Your family code</h1>
      <p className="lead">Enter this code on every phone that should use the app. Write it down somewhere safe.</p>
      <div className="code-box" data-testid="family-code">{made.code}</div>
      <div className="stack">
        <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(made.code)}>Copy code</button>
        <button className="btn primary" onClick={() => onDone(made.code, made.family)}>Continue</button>
      </div>
    </section>
  );
  return (
    <section>
      <Back onClick={onBack} />
      <h1>Who will study?</h1>
      <p className="lead">Add each person's name.</p>
      <div className="stack">
        {names.map((n, i) => (
          <label key={i} className="field">
            <span className="dot" style={{ background: COLORS[i] }} />
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
    <section>
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

function Profiles({ family, code, onPick, onLeave }) {
  const [show, setShow] = useState(false);
  return (
    <section>
      <h1>Who's studying?</h1>
      <div className="tiles">
        {family.profiles.map((p) => (
          <button key={p.id} className="tile" onClick={() => onPick(p)} style={{ '--c': p.color }}>
            <span className="avatar">{p.name[0].toUpperCase()}</span>
            <span className="tile-name">{p.name}</span>
          </button>
        ))}
      </div>
      <footer className="foot">
        {show ? (
          <>
            <p className="muted">Family code</p>
            <p className="code-small">{code}</p>
            <button className="link danger" onClick={() => { if (confirm('Leave this family on this phone? Your projects stay saved.')) onLeave(); }}>Leave family on this phone</button>
          </>
        ) : <button className="link" onClick={() => setShow(true)}>Show family code</button>}
        <p className="muted tiny">Version {APP_VERSION}{isMock ? ' (test mode)' : ''}</p>
      </footer>
    </section>
  );
}

function Home({ code, profile, onSwitch, onOpen }) {
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
    <section>
      <header className="top">
        <button className="avatar sm" style={{ '--c': profile.color }} onClick={onSwitch} aria-label="Switch person">{profile.name[0].toUpperCase()}</button>
        <h1>{profile.name}'s projects</h1>
      </header>
      {err && <p className="error" role="alert">{err}</p>}
      {projects && projects.length === 0 && !adding && (
        <div className="empty"><p>No projects yet.</p><p className="muted">Create one, paste your notes, and get flashcards.</p></div>
      )}
      <ul className="list">
        {(projects || []).map((p) => (
          <li key={p.id}>
            <button className="card-row" onClick={() => onOpen(p)}>
              <span className="row-title">{p.name}</span>
              <span className="muted">{parseCards(p.text).cards.length} cards</span>
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
      ) : <button className="btn primary bottom" onClick={() => setAdding(true)}>New project</button>}
    </section>
  );
}

function Project({ code, projectId, onBack, onStudy }) {
  const [p, setP] = useState(null);
  const [text, setText] = useState('');
  const [state, setState] = useState('saved');
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
  const { sum } = useStats(code, projectId, cards);
  if (!p) return <section><Back onClick={onBack} /><p className="muted">Loading…</p></section>;
  const del = async () => {
    if (confirm('Delete this project and its material?')) { clearTimeout(timer.current); timer.current = null; await backend.deleteProject(code, projectId); onBack(); }
  };
  return (
    <section>
      <Back onClick={onBack} label="Projects" />
      <h1 className="proj-title">{p.name}</h1>
      {cards.length > 0 && (
        <>
          <StatsStrip sum={sum} />
          <div className="stack">
            <button className="btn primary" onClick={() => onStudy('flash', cards)}>Flashcards</button>
            <button className="btn primary alt" onClick={() => onStudy('quiz', cards)}>Written quiz</button>
          </div>
          {sum.incorrect > 0 && <p className="hint">{sum.incorrect} {sum.incorrect === 1 ? 'card needs' : 'cards need'} another try. Choose "Missed only" when you start.</p>}
        </>
      )}
      <Sources code={code} projectId={projectId} onAppend={append} />
      <label className="muted" htmlFor="material">Your material</label>
      <textarea id="material" className="material" value={text} onChange={(e) => change(e.target.value)}
        placeholder={'Paste your notes here.\nWrite one item per line:\n\nphotosynthesis - how plants turn light into food\nmitochondria - the cell\'s power plant'} />
      <p className="status" aria-live="polite">
        {state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved – check your connection' : 'Saved'}
        {' · '}{cards.length} {cards.length === 1 ? 'card' : 'cards'}
      </p>
      {skipped > 0 && <p className="hint">{skipped} {skipped === 1 ? 'line was' : 'lines were'} skipped. Write each card as <b>word - definition</b>.</p>}
      <button className="link danger" onClick={del}>Delete project</button>
    </section>
  );
}

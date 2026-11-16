import React, { useState } from 'react';
import { Icon } from './art.jsx';
import { ScreenHead } from './Session.jsx';
import { goUp } from './nav.js';

// Settings for the whole family: the family code, switching to another family, the testing account.
export default function FamilySettings({ code, family, version, onCreate, onJoin, onLeave, onAddTest }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState('');
  const hasTest = family.profiles.some((p) => p.test);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied('Copied'); } catch { setCopied('Press and hold the code to copy it'); }
  };
  return (
    <section className="famsettings">
      <ScreenHead onBack={goUp} backLabel="Back" icon={<span className="head-ic"><Icon name="gear" size={26} /></span>} title="Family settings" />

      <div className="card">
        <div className="card-head"><b>Family code</b></div>
        {show ? (
          <>
            <p className="code-small" data-testid="family-code-shown">{code}</p>
            <div className="row">
              <button className="btn ghost small" onClick={copy}><Icon name="copy" size={18} />Copy code</button>
              <button className="btn ghost small" onClick={() => { setShow(false); setCopied(''); }}>Hide</button>
            </div>
            {copied && <p className="muted tiny" role="status">{copied}</p>}
          </>
        ) : (
          <>
            <p className="muted">Enter this code on another phone to join the family.</p>
            <button className="btn ghost" onClick={() => setShow(true)}><Icon name="key" />Show family code</button>
          </>
        )}
      </div>

      <div className="card">
        <div className="card-head"><b>Another family</b></div>
        <p className="muted">This phone will switch to the other family. This family and its projects stay saved, and its code brings you back.</p>
        <div className="stack">
          <button className="btn ghost" onClick={onJoin}><Icon name="key" />Use an existing family</button>
          <button className="btn ghost" onClick={onCreate}><Icon name="users" />Start a new family</button>
        </div>
      </div>

      {!hasTest && (
        <div className="card">
          <div className="card-head"><b>Testing account</b></div>
          <p className="muted">An extra account for trying things out. It is locked with a code.</p>
          <button className="btn ghost" onClick={onAddTest}><Icon name="flask" />Add a testing account</button>
        </div>
      )}

      <button className="link danger" onClick={() => { if (confirm('Leave this family on this phone? Your projects stay saved.')) onLeave(); }}><Icon name="trash" size={18} />Leave this family on this phone</button>
      <p className="version-line version-pill">Version {version}</p>
    </section>
  );
}

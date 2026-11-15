import React, { useRef, useState } from 'react';
import { Icon } from './art.jsx';
import { useOverlay } from './nav.js';

// A casual lock for the testing account. The code is in the app itself, so it keeps children out; it is not real security.
export const TEST_PIN = '1308';

export default function PinSheet({ name, onOk, onCancel }) {
  const [pin, setPin] = useState('');
  const [bad, setBad] = useState(false);
  const busy = useRef(false);
  useOverlay(true, onCancel);
  const press = (d) => {
    if (busy.current || pin.length >= 4) return;
    const next = pin + d;
    setPin(next); setBad(false);
    if (next.length === 4) {
      if (next === TEST_PIN) { busy.current = true; onOk(); }
      else { busy.current = true; setBad(true); setTimeout(() => { setPin(''); busy.current = false; }, 500); }
    }
  };
  const del = () => { if (!busy.current) { setPin(pin.slice(0, -1)); setBad(false); } };
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="stats-sheet pin-sheet" role="dialog" aria-label="Enter the code" onClick={(e) => e.stopPropagation()}>
        <h2><Icon name="lock" /> Enter the code</h2>
        <p className="muted center">{name} is locked. Type the 4-digit code.</p>
        <div className={'pin-dots' + (bad ? ' bad' : '')} data-testid="pin-dots" aria-live="polite">
          {[0, 1, 2, 3].map((i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}
        </div>
        <p className="pin-msg" role="status" data-testid="pin-msg">{bad ? 'Wrong code. Try again.' : '\u00a0'}</p>
        <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} className="key" onClick={() => press(d)}>{d}</button>)}
          <button className="key ghost" onClick={onCancel} aria-label="Cancel"><Icon name="x" /></button>
          <button className="key" onClick={() => press('0')}>0</button>
          <button className="key ghost" onClick={del} aria-label="Delete the last digit"><Icon name="left" /></button>
        </div>
      </div>
    </div>
  );
}

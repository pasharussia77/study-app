// Keeps the phone's Back button in step with the app: one press = one step up.
import { useEffect, useRef } from 'react';

let stack = [];          // entries from the bottom of the app upward
let setView = () => {};  // tells React which screen to show
let skip = 0;            // popstate events we caused ourselves and should ignore

window.addEventListener('popstate', (e) => {
  if (skip > 0) { skip--; return; }
  const d = e.state && e.state.d;
  if (!d || !stack.length) return;
  while (stack.length > d) {
    const x = stack.pop();
    if (x.kind === 'overlay' && !x.closed) x.onPop();
  }
  const top = stack[stack.length - 1];
  if (top && top.kind === 'screen') setView(top.data);
});

// entries: screens from the bottom of the app to the one to show first.
export function startNav(entries, apply) {
  setView = apply;
  const init = () => {
    stack = [];
    history.replaceState({ d: 1 }, '');
    entries.forEach((data, i) => {
      stack.push({ kind: 'screen', data });
      if (i > 0) history.pushState({ d: stack.length }, '');
    });
    apply(entries[entries.length - 1]);
  };
  // After a reload the browser still holds our old entries; rewind to the first one so Back stays tidy.
  const old = history.state && history.state.d;
  if (old > 1) {
    let done = false;
    const go = () => { if (done) return; done = true; window.removeEventListener('popstate', go); init(); };
    skip++;
    window.addEventListener('popstate', go);
    history.go(-(old - 1));
    setTimeout(go, 400);
    return;
  }
  init();
}
export function pushScreen(data) {
  stack.push({ kind: 'screen', data });
  history.pushState({ d: stack.length }, '');
  setView(data);
}
export function replaceScreen(data) {
  stack[stack.length - 1] = { kind: 'screen', data };
  history.replaceState({ d: stack.length }, '');
  setView(data);
}
export function resetTo(data) {
  stack = [{ kind: 'screen', data }];
  history.replaceState({ d: 1 }, '');
  setView(data);
}
// One step up: closes any sheets that are open on top, then leaves the screen.
export function goUp() {
  let n = 0;
  for (let i = stack.length - 1; i >= 1; i--) {
    n++;
    if (stack[i].kind === 'screen') break;
  }
  if (n > 0) history.go(-n);
}
export function back() { history.back(); }
export function depth() { return stack.length; }

function pushOverlay(onPop) {
  const e = { kind: 'overlay', onPop, closed: false };
  stack.push(e);
  history.pushState({ d: stack.length }, '');
  return e;
}
function closeOverlay(e) {
  const i = stack.lastIndexOf(e);
  if (i === -1) return;                 // already closed by the Back button
  if (i === stack.length - 1) { stack.pop(); skip++; history.back(); }
  else e.closed = true;
}

// While `open` is true, the Back button closes this sheet instead of leaving the screen.
export function useOverlay(open, onClose) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const e = pushOverlay(() => ref.current());
    return () => closeOverlay(e);
  }, [open]);
}

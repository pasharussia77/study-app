import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

// A thin scroll bar that is always drawn while there is more to scroll, so it is clear that a screen continues.
// Phones hide their own scroll bars after a moment; this one stays.
function thumbFor(scrollTop, scrollHeight, clientHeight) {
  if (scrollHeight <= clientHeight + 1) return null;
  const h = Math.max(30, (clientHeight * clientHeight) / scrollHeight);
  const room = clientHeight - h;
  const top = room * (scrollTop / (scrollHeight - clientHeight));
  return { h, top: Math.max(0, Math.min(room, top)) };
}

// The whole page: a bar fixed at the right edge of the screen.
export function PageScrollBar() {
  const [t, setT] = useState(null);
  useEffect(() => {
    const el = document.documentElement;
    const measure = () => setT(thumbFor(window.scrollY, el.scrollHeight, window.innerHeight));
    measure();
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    const timer = setInterval(measure, 700); // screens change under it; cheap to keep it right
    return () => { window.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); ro.disconnect(); clearInterval(timer); };
  }, []);
  if (!t) return null;
  const top = 'env(safe-area-inset-top, 0px)';
  return (
    <div className="pagebar" aria-hidden="true" data-testid="pagebar" style={{ top, bottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <i style={{ height: t.h, transform: `translateY(${t.top}px)` }} />
    </div>
  );
}

// An area that scrolls inside a card, with its own always-visible bar.
export function Scroller({ className = '', children, innerRef, dep }) {
  const own = useRef(null);
  const ref = innerRef || own;
  const [t, setT] = useState(null);
  const measure = () => { const el = ref.current; if (el) setT(thumbFor(el.scrollTop, el.scrollHeight, el.clientHeight)); };
  useLayoutEffect(measure, [dep, children]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    [...el.children].forEach((c) => ro.observe(c));
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={'scroller-wrap' + (t ? ' scrolls' : '') + (className ? ' ' + className : '')}>
      <div ref={ref} className="scroller" onScroll={measure} tabIndex={t ? 0 : -1}>{children}</div>
      {t && <i className="sbar" aria-hidden="true" data-testid="sbar" style={{ height: t.h, transform: `translateY(${t.top}px)` }} />}
    </div>
  );
}

import { useEffect } from 'react';

// Keeps the screen on while `active` is true.
export function useWakeLock(active) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return undefined;
    let sentinel = null, dead = false;
    const get = async () => { try { sentinel = await navigator.wakeLock.request('screen'); } catch { /* not allowed right now */ } };
    get();
    const onVis = () => { if (document.visibilityState === 'visible' && !dead) get(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      dead = true;
      document.removeEventListener('visibilitychange', onVis);
      if (sentinel && sentinel.release) sentinel.release().catch(() => {});
    };
  }, [active]);
}

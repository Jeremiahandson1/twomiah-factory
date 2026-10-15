// hooks/usePolling.ts — ported from CVHC hooks/usePolling.js
// Visibility-aware interval poller.
//
// Calls `callback` once on mount, then every `intervalMs`. While the browser tab is hidden the
// interval is paused (no rate-limit budget or battery spent on data nobody can see); when the tab
// becomes visible again it fires once immediately, then resumes.
//
// `callback` is held in a ref so it always reads the latest state, and re-renders do not restart the
// interval. `intervalMs <= 0` means "fire once and don't poll".
import { useEffect, useRef } from 'react';

export function usePolling(callback: () => unknown, intervalMs: number) {
  const cbRef = useRef(callback);
  useEffect(() => { cbRef.current = callback; }, [callback]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => { try { cbRef.current?.(); } catch { /* swallow */ } };
    const start = () => {
      if (timer || !(intervalMs > 0)) return;
      timer = setInterval(tick, intervalMs);
    };
    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };
    const onVisibility = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'hidden') stop();
      else { tick(); start(); }
    };

    tick();
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') start();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);
}

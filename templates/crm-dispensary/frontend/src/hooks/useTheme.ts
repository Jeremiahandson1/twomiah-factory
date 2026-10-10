import { useState, useEffect } from 'react';

type Theme = 'light' | 'dark' | 'system';

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  const resolved = theme === 'system' ? getSystemTheme() : theme;
  const root = document.documentElement
  const dark = resolved === 'dark'
  if (root.classList.contains('dark') === dark) return;
  /*
   * SWITCH EVERYTHING AT ONCE. (T64) A ground with `transition-colors` fades over ~150ms while its text changes
   * instantly, so for the first frames a tile read white under light ink — measured at 1.1:1 one frame after the toggle.
   * Transitions are suspended for the switch and restored two frames later, once the new colours are painted.
   */
  const freeze = document.createElement('style');
  freeze.textContent = '*,*::before,*::after{transition:none!important}';
  document.head.appendChild(freeze);
  root.classList.toggle('dark', dark);
  void window.getComputedStyle(root).backgroundColor; // commit the new colours before transitions come back
  requestAnimationFrame(() => requestAnimationFrame(() => freeze.remove()));
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem('theme') as Theme) || 'light';
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Listen for system theme changes when in 'system' mode
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = (t: Theme) => {
    localStorage.setItem('theme', t);
    setThemeState(t);
  };

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
  };

  return { theme, setTheme, toggle, isDark: theme === 'dark' || (theme === 'system' && getSystemTheme() === 'dark') };
}

// Theme + media-query hooks used by the shell (and by any template component that needs them).
import { useState, useEffect } from 'react'

export type Theme = 'light' | 'dark' | 'system'

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  const resolved = theme === 'system' ? getSystemTheme() : theme
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    try { return (localStorage.getItem('theme') as Theme) || 'light' } catch { return 'light' }
  })

  useEffect(() => { applyTheme(theme) }, [theme])

  // Follow the OS while in 'system' mode
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  const setTheme = (t: Theme) => {
    try { localStorage.setItem('theme', t) } catch { /* private mode */ }
    setThemeState(t)
  }
  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark')

  return { theme, setTheme, toggle, isDark: theme === 'dark' || (theme === 'system' && getSystemTheme() === 'dark') }
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false))
  useEffect(() => {
    const media = window.matchMedia(query)
    if (media.matches !== matches) setMatches(media.matches)
    const listener = (e: MediaQueryListEvent) => setMatches(e.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps
  return matches
}

export function useIsMobile() { return useMediaQuery('(max-width: 1023px)') }
export function useIsTablet() { return useMediaQuery('(min-width: 768px) and (max-width: 1023px)') }
export function useIsDesktop() { return useMediaQuery('(min-width: 1024px)') }
export function usePrefersDarkMode() { return useMediaQuery('(prefers-color-scheme: dark)') }
export function usePrefersReducedMotion() { return useMediaQuery('(prefers-reduced-motion: reduce)') }

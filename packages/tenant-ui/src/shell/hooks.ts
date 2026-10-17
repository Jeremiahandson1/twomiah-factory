// Theme + media-query hooks used by the shell (and by any template component that needs them).
import { useState, useEffect } from 'react'
import { applyBrandPalette } from '../brandPalette.js'

export type Theme = 'light' | 'dark' | 'system'

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  const resolved = theme === 'system' ? getSystemTheme() : theme
  const root = document.documentElement
  const dark = resolved === 'dark'
  if (root.classList.contains('dark') === dark) return
  /*
   * SWITCH EVERYTHING AT ONCE. (T64) A ground with `transition-colors` fades over ~150ms while its text changes
   * instantly, so for the first frames a tile read white under light ink — measured at 1.1:1 one frame after the toggle.
   * Transitions are suspended for the switch and restored two frames later, once the new colours are painted.
   */
  const freeze = document.createElement('style')
  freeze.textContent = '*,*::before,*::after{transition:none!important}'
  document.head.appendChild(freeze)
  root.classList.toggle('dark', dark)
  void window.getComputedStyle(root).backgroundColor // commit the new colours before transitions come back
  requestAnimationFrame(() => requestAnimationFrame(() => freeze.remove()))
}

/**
 * Put the saved theme on <html> at startup, before anything renders.
 *
 * useTheme() only applies the class when a component that CALLS it mounts, and the only such component
 * is the shell. Anything rendered outside the shell — the 404 catch-all, most obviously — therefore
 * loaded in full light theme no matter what the user had chosen, because nothing had told the document
 * yet. Calling this from the entry point also removes the flash of light theme on a cold load of any
 * page. (Salon T20 L5)
 */
export function applyStoredTheme(): void {
  try { applyTheme((localStorage.getItem('theme') as Theme) || 'light') } catch { /* private mode */ }
  applyStoredBrand()
}

/**
 * The company's colour, before the first render. (10/17)
 *
 * useBrandPalette sets it once the company has loaded, so every page load painted the SIGNUP colour first and
 * switched a moment later — for any company whose colour had been changed since. The last colour the company
 * reported is remembered (BRAND_KEY) and applied here, at startup, through the same generator.
 */
const BRAND_KEY = 'brandColor'
export function applyStoredBrand(): void {
  try { const hex = localStorage.getItem(BRAND_KEY); if (hex) applyBrandPalette(hex) } catch { /* private mode */ }
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

// Reactive read of the ACTUAL applied theme — the `dark` class on <html> that Tailwind's
// class strategy toggles. Unlike useTheme() (which keeps its own local copy of the setting),
// this tracks the single source of truth and updates live no matter which component flipped it,
// so a leaf page that colours itself from JS (inline styles) never goes stale after a toggle.
export function useIsDark(): boolean {
  const [dark, setDark] = useState<boolean>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark'))
  useEffect(() => {
    if (typeof document === 'undefined') return
    const el = document.documentElement
    const update = () => setDark(el.classList.contains('dark'))
    update()
    const obs = new MutationObserver(update)
    obs.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return dark
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

/**
 * The CRM's own screens in the company's own colour — the one set in Settings, not only the one chosen at signup.
 *
 * Every orange-/primary-/brand- class reads a --brand-* CSS variable whose default is the palette the build
 * baked in (tailwind.config.js). This sets those variables on <html> from `primaryColor`, through the SAME
 * generatePalette and contrast clamps the build uses (brandPalette.js), so a pale colour picked in Settings still
 * gets a primary button white text can be read on. Re-runs whenever the colour changes — which is how a save in
 * Settings shows at once: the save puts the new row into auth (updateCompany) and the shell re-renders with it.
 * Blank or not a hex → the overrides come off and the build's palette shows again.
 */
export function useBrandPalette(primaryColor?: string | null): void {
  useEffect(() => {
    // undefined: the company has not loaded yet — leave the colour applied at startup alone. null or '' is the
    // company saying it has none, which clears both the overrides and the remembered colour.
    if (primaryColor === undefined) return
    const applied = applyBrandPalette(primaryColor)
    try { if (applied && primaryColor) localStorage.setItem(BRAND_KEY, primaryColor); else localStorage.removeItem(BRAND_KEY) } catch { /* private mode */ }
  }, [primaryColor])
}

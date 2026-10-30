// What a page shows while it loads: words that say what is coming, over grey blocks shaped like a page. A page that is
// still loading used to be a blank screen (the lazy wrapper's fallback was null) or a lone spinner, and a builder on a
// slow phone connection could not tell a page that was loading from one that was broken.
import { useContext } from 'react'
import { useLocation } from 'react-router-dom'
import { MenuNameContext } from '../shell/menuName'

/** The page's own name for itself: the menu item at this address, else the closest menu item above it ("Jobs" for one job). */
export function useLoadingName(fallback = ''): string {
  const items = useContext(MenuNameContext)
  const { pathname } = useLocation()
  const here = pathname.replace(/\/+$/, '')
  const exact = items.find((i) => i.to === here)
  if (exact) return exact.label
  if (fallback) return fallback
  const above = items.filter((i) => here.startsWith(i.to + '/')).sort((a, b) => b.to.length - a.to.length)[0]
  return above?.label || ''
}

/**
 * `what` is what is loading, in the words of a sentence: "your submittals", "lien waivers". Without it the line says
 * only "Loading…". `rows` is how many grey rows to draw (a list page: 5).
 */
export function PageLoading({ what, rows = 5, bare }: { what?: string; rows?: number; bare?: boolean }) {
  const words = what ? `Loading ${what}…` : 'Loading…'
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={bare ? 'py-6' : 'p-4 sm:p-6 max-w-5xl mx-auto'} data-page-loading="">
      <p className="mb-4 text-sm font-medium text-gray-600 dark:text-slate-300">{words}</p>
      <div className="animate-pulse space-y-3" aria-hidden="true">
        <div className="h-7 w-1/3 rounded bg-gray-200 dark:bg-slate-700" />
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-12 rounded-lg bg-gray-100 dark:bg-slate-800" />
        ))}
      </div>
    </div>
  )
}

/** The Suspense fallback of a screen that is being fetched: named from the menu, or from the name the screen was registered under. */
export function ScreenLoading({ name = '' }: { name?: string }) {
  const label = useLoadingName(name)
  return <PageLoading what={label} />
}

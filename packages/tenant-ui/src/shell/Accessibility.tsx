// Keyboard / screen-reader helpers used by the shell.
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

/** Lets keyboard users jump past the sidebar to the page content. */
export function SkipLink({ targetId = 'main-content', children = 'Skip to main content' }: { targetId?: string; children?: React.ReactNode }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-orange-500 focus:text-white focus:rounded-lg focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-orange-300 focus:ring-offset-2"
    >
      {children}
    </a>
  )
}

/** Keeps Tab inside a dialog while it is open. */
export function FocusTrap({ children, active = true }: { children: React.ReactNode; active?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!active || !containerRef.current) return
    const container = containerRef.current
    const focusable = container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    const first = focusable[0] as HTMLElement | undefined
    const last = focusable[focusable.length - 1] as HTMLElement | undefined
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
    }
    container.addEventListener('keydown', onKeyDown)
    first?.focus()
    return () => container.removeEventListener('keydown', onKeyDown)
  }, [active])
  return <div ref={containerRef}>{children}</div>
}

/** Announces route changes to screen readers (document.title or a title derived from the path). */
export function RouteAnnouncer() {
  const location = useLocation()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fromPath = () => {
      const last = location.pathname.replace(/\/+$/, '').split('/').pop() || ''
      if (!last || last === 'crm') return 'Dashboard'
      return last.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    }
    const title = (document.title && document.title.split(' | ')[0]) || fromPath()
    if (ref.current) ref.current.textContent = `Navigated to ${title}`
  }, [location.pathname])
  return <div ref={ref} role="status" aria-live="polite" aria-atomic="true" className="sr-only" />
}

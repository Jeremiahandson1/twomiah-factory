// View As in the shell, for home care: the header's "View As" button (the office opens the app as a member of staff,
// or a client's portal) and, while a View As is open, the strip under the header on every page that says whose app
// this is and offers Exit. Mounted through the shell's config (web/src/shell.ts headerActions / banner), only for an
// agency. The template swapped the token in its React state (App.tsx impersonationToken); the app's session is the
// server's cookies, so the server holds the View As too (server/crm/homecare/office/signIn.ts):
//
//   GET  /api/auth/impersonate           → { active: false } | { active: true, name, role, impersonatedBy, expiresAt }
//   POST /api/auth/impersonate/:userId   sets the View As cookie (httpOnly: no script here ever holds it); the page
//                                        then loads afresh and every screen is that person's, read-only
//   POST /api/auth/logout                in a View As, ends only the View As (Exit); the office's own session is as it was
//
// The picker and the client-portal preview load only when the button is pressed (./ViewAsPanel).
import { lazy, Suspense, useEffect, useState } from 'react'
import { Eye } from 'lucide-react'
import { usePermissions } from '../../../../shared'
import { api, errorMessage } from '../lib/http'

export interface ViewAsStatus {
  active: boolean
  name?: string
  role?: string
  impersonatedBy?: string | null
  expiresAt?: string | null
}

// One question per page load: starting and ending a View As both load the page afresh.
let statusOnce: Promise<ViewAsStatus> | null = null
const askStatus = (): Promise<ViewAsStatus> =>
  (statusOnce ??= api.get('/api/auth/impersonate').then((s: ViewAsStatus) => s ?? { active: false }).catch(() => ({ active: false })))

/** Whether this session is a View As (null until the server has said). */
export function useViewAs(): ViewAsStatus | null {
  const [status, setStatus] = useState<ViewAsStatus | null>(null)
  useEffect(() => {
    let live = true
    askStatus().then((s) => { if (live) setStatus(s) })
    return () => { live = false }
  }, [])
  return status
}

/** The agency's words for a seat (verticals/homecare/settings.ts roleLabels; moved tenants store `caregiver`). */
export const seatLabel = (role?: string | null): string => {
  const r = String(role || '').toLowerCase()
  if (r === 'field' || r === 'caregiver') return 'Caregiver'
  if (r === 'manager') return 'Office Manager'
  return r ? r.charAt(0).toUpperCase() + r.slice(1) : ''
}

/** Load the app afresh at the dashboard, as whoever the session now is. */
export const reloadAsSession = () => window.location.assign('/crm/dashboard')

/** The strip under the header while a View As is open. */
export function ViewAsBanner() {
  const status = useViewAs()
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState('')
  if (!status?.active) return null

  const exit = async () => {
    setLeaving(true)
    setError('')
    try {
      await api.post('/api/auth/logout', {})
      reloadAsSession()
    } catch (e) {
      setError(errorMessage(e, 'Could not leave View As. Try again.'))
      setLeaving(false)
    }
  }

  return (
    <div role="status" className="border-b border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm">
        <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1">
          Viewing as <strong>{status.name || 'another person'}</strong>
          {status.role ? ` (${seatLabel(status.role)})` : ''} — read-only: nothing can be changed.
          {error && <span className="ml-2 font-semibold text-red-800 dark:text-red-300">{error}</span>}
        </p>
        <button
          type="button"
          onClick={exit}
          disabled={leaving}
          className="shrink-0 rounded-md bg-amber-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-60 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100"
        >
          {leaving ? 'Leaving…' : 'Exit View As'}
        </button>
      </div>
    </div>
  )
}

const ViewAsPanel = lazy(() => import('./ViewAsPanel'))

/**
 * The header's View As button: for whoever may open one (the staff list's users:read, or a client portal preview's
 * care-portal:update — the permissions the two server routes ask), and not from inside a View As, which the server
 * refuses (starting one is a write).
 */
export function ViewAsButton() {
  const { can, known } = usePermissions()
  const status = useViewAs()
  const [open, setOpen] = useState(false)
  if (!known || !status || status.active) return null
  if (!can('users:read') && !can('care-portal:update')) return null
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg p-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800"
        title="See the app as a member of staff or a client sees it"
      >
        <Eye className="h-5 w-5" aria-hidden="true" />
        <span className="hidden md:inline">View As</span>
      </button>
      {open && (
        <Suspense fallback={null}>
          <ViewAsPanel onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  )
}

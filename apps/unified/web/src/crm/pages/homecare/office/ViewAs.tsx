// View As in the shell, for home care: the header's "View As" button — the office opens the app as a member of staff,
// or a client's portal. View As itself is every vertical's now (web/src/crm/viewAs.tsx: the strip under the header with
// "Return to my account", and "View as <person>" in Settings › Users; server/core/viewAs.ts the rules); this button is
// home care's own way in, because an agency also previews a client's portal from it. Mounted through the shell's
// config (web/src/shell.ts headerActions), only for an agency.
//
//   POST /api/auth/impersonate/:userId   sets the View As cookie (httpOnly: no script here ever holds it); the page
//                                        then loads afresh and every screen is that person's — read-only for a
//                                        caregiver (server crm/homecare/core/viewAsReadOnly.ts)
//
// The picker and the client-portal preview load only when the button is pressed (./ViewAsPanel).
import { lazy, Suspense, useState } from 'react'
import { Eye } from 'lucide-react'
import { usePermissions } from '../../../../shared'
import { useViewAs, roleWord, VIEW_AS_PERMISSION } from '../../../viewAs'

/** The agency's words for a seat: the server's (verticals/homecare/settings.ts roleLabels; moved tenants store `caregiver`). */
export const seatLabel = (role?: string | null): string => roleWord(role)

/** Load the app afresh at the dashboard, as whoever the session now is. */
export const reloadAsSession = () => window.location.assign('/crm/dashboard')

const ViewAsPanel = lazy(() => import('./ViewAsPanel'))

/**
 * The header's View As button: for whoever may open one (users:view-as for staff — the permission the server asks — or a
 * client portal preview's care-portal:update), and not from inside a View As, which the server refuses.
 */
export function ViewAsButton() {
  const { can, known } = usePermissions()
  const status = useViewAs()
  const [open, setOpen] = useState(false)
  if (!known || !status || status.active) return null
  if (!can(VIEW_AS_PERMISSION) && !can('care-portal:update')) return null
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

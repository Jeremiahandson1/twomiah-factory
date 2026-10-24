// View As on the screens, every vertical (server/core/viewAs.ts has the rules). The owner — or an admin — opens it from
// Settings › Users ("View as <person>"); the page then loads afresh as that person, so every menu, page and button is
// exactly theirs, and the strip under the header on every page says whose app this is and offers the way back:
//
//   Viewing as Test Staff (Staff) — Return to my account
//
//   GET  /api/auth/impersonate          → { active: false } | { active: true, name, role, roleLabel, impersonatedBy, expiresAt }
//   POST /api/auth/impersonate/:userId  sets the View As cookie (httpOnly: no script here ever holds it)
//   DELETE /api/auth/impersonate        Return: ends only the View As — the owner's own session was never touched (and
//                                       outside a View As it does nothing; signing out of a View As does the same)
//
// The strip goes back on its own when the View As times out or the server ends it (checked once a minute), so the screens
// never go on showing one person's menus over another's session. Home care's header button (its staff picker and the
// client-portal preview, crm/pages/homecare/office/ViewAs.tsx) starts the same View As.
import { useEffect, useState } from 'react'
import { Eye } from 'lucide-react'
import { api, useAuth, usePermissions, useToast } from '../shared'
import { whenTime } from '@twomiah/tenant-ui/src/time/companyClock'
import { verticalScreens } from './vertical'

export interface ViewAsStatus {
  active: boolean
  name?: string
  role?: string
  roleLabel?: string
  impersonatedBy?: string | null
  impersonatorName?: string | null
  expiresAt?: string | null
}

/** The permission that opens a View As (the server's VIEW_AS_PERMISSION). */
export const VIEW_AS_PERMISSION = 'users:view-as'
const RETURN_KEY = 'twomiah.viewAs.return'
const ask = (): Promise<ViewAsStatus> => api.get('/api/auth/impersonate').then((s: ViewAsStatus) => s ?? { active: false }).catch(() => ({ active: false }))

// One question per page load: starting and ending a View As both load the page afresh.
let statusOnce: Promise<ViewAsStatus> | null = null
const askOnce = (): Promise<ViewAsStatus> => (statusOnce ??= ask())

/** Whether this session is a View As (null until the server has said). */
export function useViewAs(): ViewAsStatus | null {
  const [status, setStatus] = useState<ViewAsStatus | null>(null)
  useEffect(() => {
    let live = true
    askOnce().then((s) => { if (live) setStatus(s) })
    return () => { live = false }
  }, [])
  return status
}

/** What this vertical calls a rung — the server's word (VerticalSettings.roleLabels through permissions.roleLabel). */
export function roleWord(role?: string | null): string {
  const r = String(role || '')
  const labels = verticalScreens().roleLabels || {}
  const id = r === 'user' || r === 'caregiver' ? 'field' : r
  return labels[id] || (id ? id.charAt(0).toUpperCase() + id.slice(1) : '')
}

const remember = (path: string) => { try { sessionStorage.setItem(RETURN_KEY, path) } catch { /* private window: back to Settings */ } }
const recall = (): string => {
  let path = ''
  try { path = sessionStorage.getItem(RETURN_KEY) || ''; sessionStorage.removeItem(RETURN_KEY) } catch { path = '' }
  return path.startsWith('/crm') ? path : '/crm/settings'
}

/** Start a View As and load the app afresh as that person. Throws the server's refusal (shown by the caller). */
export async function startViewAs(userId: string): Promise<void> {
  const here = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/crm/settings'
  await api.post(`/api/auth/impersonate/${userId}`, {})
  remember(here)
  window.location.assign('/crm/dashboard')
}

/** Return to my account: end the View As and load the app afresh as the real user, where they started it. */
export async function returnToMyAccount(): Promise<void> {
  // DELETE /api/auth/impersonate, not sign-out: should the View As have run out a moment before the click, this does
  // nothing at all, where a sign-out would have ended the real user's own session.
  await api.delete('/api/auth/impersonate')
  window.location.assign(recall())
}

/** The strip under the header while a View As is open, on every page. */
export function ViewAsBanner() {
  const status = useViewAs()
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState('')

  // Timed out, or ended by the server (the person's access changed, the opener's login switched off…): back to the real
  // account, loaded afresh, rather than one person's screens over the other's session.
  useEffect(() => {
    if (!status?.active) return
    const goBack = () => { window.location.assign(recall()) }
    // The browser drops the View As cookie a minute before the token runs out (server VIEW_AS_HOURS): go back then.
    const left = status.expiresAt ? new Date(status.expiresAt).getTime() - 60_000 - Date.now() : null
    const timer = left !== null && left < 2 ** 31 - 1 ? setTimeout(goBack, Math.max(0, left) + 1000) : null
    const poll = setInterval(() => { ask().then((s) => { if (!s.active) goBack() }) }, 60_000)
    return () => { if (timer) clearTimeout(timer); clearInterval(poll) }
  }, [status?.active, status?.expiresAt])

  if (!status?.active) return null
  const label = status.roleLabel || roleWord(status.role)
  const back = async () => {
    setLeaving(true)
    setError('')
    try {
      await returnToMyAccount()
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not return to your account. Try again.')
      setLeaving(false)
    }
  }

  return (
    <div role="status" data-testid="view-as-banner" className="border-b border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm">
        <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1">
          Viewing as <strong>{status.name || 'another person'}</strong>{label ? ` (${label})` : ''}
          {status.expiresAt ? <span className="ml-1 text-amber-900 dark:text-amber-200">· ends {whenTime(status.expiresAt)}</span> : null}
          {error && <span className="ml-2 font-semibold text-red-800 dark:text-red-300">{error}</span>}
        </p>
        <button
          type="button"
          onClick={back}
          disabled={leaving}
          className="shrink-0 rounded-md bg-amber-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-60 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100"
        >
          {leaving ? 'Returning…' : 'Return to my account'}
        </button>
      </div>
    </div>
  )
}

/**
 * "View as <person>" on a row of Settings › Users — drawn only where the server would open it: for a holder of
 * users:view-as, outside a View As, and never on the owner's row, your own, or a switched-off login. The server still
 * decides (someone whose access is wider than yours is refused, in words).
 */
export function ViewAsUserButton({ person }: { person: { id: string; firstName?: string | null; lastName?: string | null; email?: string | null; role?: string | null; isActive?: boolean | null } }) {
  const { user } = useAuth() as { user: { id?: string } | null }
  const { can, known } = usePermissions()
  const status = useViewAs()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!known || !status || status.active || !can(VIEW_AS_PERMISSION)) return null
  if (!person?.id || person.id === user?.id || person.role === 'owner' || person.isActive === false) return null
  const name = [person.firstName, person.lastName].filter(Boolean).join(' ') || person.email || 'this person'
  const go = async () => {
    setBusy(true)
    try {
      await startViewAs(person.id)
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Could not open View As.')
      setBusy(false)
    }
  }
  return (
    <button type="button" onClick={go} disabled={busy} data-testid="view-as-user" title={`See the app exactly as ${name} sees it`}
      className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 hover:text-amber-900 mr-3 disabled:opacity-60 dark:text-amber-300 dark:hover:text-amber-200">
      <Eye className="h-3.5 w-3.5" aria-hidden="true" />{busy ? 'Opening…' : `View as ${name}`}
    </button>
  )
}

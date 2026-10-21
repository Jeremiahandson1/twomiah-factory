// The practice screens' helpers. Moved from templates/crm-vet/frontend/src/lib/{staff,appointmentTypes,printable}.ts.
import { api } from '../../../api'
import { useKnownPermission } from '../../../shared'

// ── Who can be assigned as a provider (veterinarian) ─────────────────────────────────────────────────────────────────
// The logins, not /api/team's crew roster: appointment.providerId, visit.providerId, vaccination.providerId and
// prescription.prescriberId reference a login user (a roster row is a foreign-key violation on save). It read
// /api/company/users, which the desk's seat may not read (users:read / team:read) — the assignable list is the
// booker's (2026-10-21).

export interface StaffMember {
  id: string
  firstName?: string
  lastName?: string
  email?: string
  role?: string
  isActive?: boolean
}

export function staffName(u: StaffMember): string {
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id
}

/** null until the permission list has arrived; then whether GET /api/team/assignable answers this seat (team.ts:
 *  team:read or schedule:create). A seat it would refuse is not asked. */
export function useMayPickStaff(): boolean | null {
  const roster = useKnownPermission('team:read')
  const books = useKnownPermission('schedule:create')
  return roster === null || books === null ? null : roster || books
}

/** The logins work can be given to: GET /api/team/assignable (active, never a view-only seat; names, and e-mail only
 *  for a roster reader). Roster-only crew (kind 'member') are left out — the column references a login user. */
export async function fetchStaff(): Promise<StaffMember[]> {
  const res = (await api.get('/api/team/assignable')) as { data?: Array<{ id: string; name?: string; email?: string; role?: string; kind?: string }> } | null
  return (res?.data ?? []).filter((u) => u.kind !== 'member').map((u) => {
    const parts = String(u.name || '').trim().split(/\s+/)
    return { id: u.id, firstName: parts[0] || undefined, lastName: parts.slice(1).join(' ') || undefined, email: u.email, role: u.role, isActive: true }
  })
}

// ── What a clinic calls its appointment types (Vet T12 M11) ──────────────────────────────────────────────────────────
// The stored values are short words ("wellness", "euthanasia"); only what a person sees changes.

export const APPOINTMENT_TYPES = [
  { value: 'wellness', label: 'Wellness exam' },
  { value: 'sick', label: 'Sick visit' },
  { value: 'surgery', label: 'Surgery' },
  { value: 'dental', label: 'Dental' },
  { value: 'recheck', label: 'Recheck' },
  { value: 'grooming', label: 'Grooming' },
  { value: 'euthanasia', label: 'Euthanasia' },
] as const

const BY_VALUE: Record<string, string> = Object.fromEntries(APPOINTMENT_TYPES.map((t) => [t.value, t.label]))

/** A type we do not know still reads as a word, not as nothing. */
export function appointmentTypeLabel(value?: string | null): string {
  const v = String(value ?? '').trim()
  if (!v) return ''
  return BY_VALUE[v.toLowerCase()] || v.replace(/[_-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())
}

// ── A server-rendered printable page in a new tab ────────────────────────────────────────────────────────────────────
// Fetched through the client (the session, never a token in a URL) and handed to the tab as a blob, which prints the
// same. On failure it throws, and the caller shows the reason (the template used alert()).
export async function openPrintable(path: string): Promise<void> {
  // Open the tab BEFORE awaiting — a window.open() after an await is a popup blocker's "not user initiated".
  const tab = window.open('', '_blank')
  try {
    const res = await api.raw(path)
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Could not load the document (HTTP ${res.status}). ${detail.slice(0, 200)}`)
    }
    const html = await res.text()
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    if (tab) {
      tab.location.href = url
      // Revoke once the tab has had time to load it; revoking immediately races the navigation.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } else {
      // Popup blocked — fall back to the current tab rather than failing silently.
      window.location.href = url
    }
  } catch (err) {
    tab?.close()
    throw err instanceof Error ? err : new Error('Could not open the document')
  }
}

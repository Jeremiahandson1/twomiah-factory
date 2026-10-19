// The events screens' helpers. Moved from templates/crm-restaurant/frontend/src/lib/{staff,eventWarnings,printable}.ts
// (templates/crm-bar has the same files).
import { api } from '../../../api'

// ── Who can be assigned as an event coordinator ──────────────────────────────────────────────────────────────────────
// From /api/company/users, not /api/team: event.coordinatorId references a login user, and /api/team lists the crew
// roster (empty on a new business, and a foreign-key violation on save once a row exists).

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

export async function fetchStaff(): Promise<StaffMember[]> {
  const res = (await api.get('/api/company/users')) as StaffMember[] | { data?: StaffMember[] } | null
  const list: StaffMember[] = Array.isArray(res) ? res : (res?.data ?? [])
  // A revoked coordinator must not stay assignable.
  return list.filter((u) => u.isActive !== false)
}

// ── Soft warnings before an event is saved (T16 L1 / L2) ─────────────────────────────────────────────────────────────
// Allowed with a confirm, never blocked: a past date (venues back-date walk-ins and migrated history) and more guests
// than the room holds (a 30-seat room hosts 60 standing). On an edit only a CHANGED date / room / head count asks.
// The template asked with window.confirm; here the app's confirm dialog (`ask`, from useConfirm) asks.

export interface SpaceCapacity { id: string; name?: string; seatedCapacity?: number | null; standingCapacity?: number | null }
export interface EventRiskFields { eventDate: string; guestCount: string | number; spaceId: string }
export interface EventRiskOriginal { eventDate?: string; guestCount?: number | null; spaceId?: string | null }
export type Ask = (message: string, options?: { title?: string; confirmText?: string; danger?: boolean }) => Promise<boolean>

export const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function confirmEventRisks(ask: Ask, next: EventRiskFields, spaces: SpaceCapacity[], original?: EventRiskOriginal): Promise<boolean> {
  const dateChanged = !original || original.eventDate !== next.eventDate
  if (dateChanged && next.eventDate && next.eventDate < localToday()
    && !(await ask(`${next.eventDate} is in the past — log it as a past event anyway?`, { title: 'A past date', confirmText: 'Save anyway', danger: false }))) return false
  const guests = Number(next.guestCount || 0)
  const space = spaces.find((s) => s.id === next.spaceId)
  const cap = space ? Math.max(Number(space.seatedCapacity || 0), Number(space.standingCapacity || 0)) : 0
  const roomOrHeadsChanged = !original || (original.spaceId || '') !== (next.spaceId || '') || Number(original.guestCount || 0) !== guests
  if (roomOrHeadsChanged && cap > 0 && guests > cap
    && !(await ask(`${guests} guests is more than ${space?.name || 'that room'} holds (${cap} at most) — save anyway?`, { title: 'Over capacity', confirmText: 'Save anyway', danger: false }))) return false
  return true
}

// ── A server-rendered printable page in a new tab ────────────────────────────────────────────────────────────────────
// Fetched through the client (the session, never a token in a URL) and handed to the tab as a blob, which prints the
// same. On failure it throws, and the caller shows the reason on its page. (T58)
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

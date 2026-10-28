/**
 * THE MORE MENU: every item the desktop's menu gives THIS seat in THIS business, from menu.generated.ts (written by
 * apps/unified/scripts/mobile-parity.ts out of the desktop's own menu definitions — never a hand list). Pure, so tests/mobile/more-menu.test.ts
 * runs the very same rule against the desktop's maySeeRoute for every trade and seat.
 *
 * An item shows when the desktop would show it AND let the seat open it:
 *   · the rank (minRole) and the route's own rank (routeRole), · the permission and the route's own permission,
 *   · the business switch (any one of `features` on).
 * A row with a phone screen opens it natively; every other row opens the real desktop page inside the app, signed in.
 */
import { MENU } from './menu.generated'

export interface MenuRow {
  label: string; path: string; group: string; icon: string
  minRole?: string; permission?: string | string[]; routeRole?: string; routePermission?: string | string[]
  features?: string[]
  native?: { for?: 'field' | 'office'; route: string }[]
}

/** The desktop's rank order (packages/tenant-ui shell/types.ts ROLE_RANK); `user` and `staff` are the field rung. */
const RANK = ['viewer', 'field', 'manager', 'admin', 'owner']
const ALIAS: Record<string, string> = { user: 'field', staff: 'field' }
export const meetsRole = (role: string | undefined, min: string | undefined): boolean => {
  if (!min) return true
  const have = RANK.indexOf(ALIAS[String(role || '')] || String(role || ''))
  const need = RANK.indexOf(min)
  return need < 0 ? true : have >= need
}
const allows = (can: (p: string) => boolean, p: string | string[] | undefined) => !p || (Array.isArray(p) ? p.some((x) => can(x)) : can(p))

export interface Seat { role: string | undefined; can: (permission: string) => boolean; hasFeature: (feature: string) => boolean }

export function mayOpenRow(row: MenuRow, seat: Seat): boolean {
  if (!meetsRole(seat.role, row.minRole)) return false
  if (!allows(seat.can, row.permission)) return false
  if (row.features && row.features.length && !row.features.some((f) => seat.hasFeature(f))) return false
  // the route's own gates (the desktop checks these when the address is typed in)
  if (!meetsRole(seat.role, row.routeRole ?? row.minRole)) return false
  return allows(seat.can, row.routePermission ?? row.permission)
}

export interface Shown extends MenuRow { open: { kind: 'native'; route: string } | { kind: 'web'; path: string } }
export interface Section { group: string; items: Shown[] }

const GROUP_ORDER = ['Home', 'Sell', 'Work', 'Projects', 'Clients & care', 'Scheduling', 'Caregivers', 'Visit records', 'Billing & payroll', 'Compliance', 'Communication', 'Money & reports', 'Customers', 'Equipment & records', 'Business & website', 'Help']

/** The seat's rows, flat, in the desktop's order. */
export function itemsFor(vertical: string, seat: Seat, field: boolean): Shown[] {
  return (MENU[vertical] || []).filter((r) => mayOpenRow(r, seat)).map((r) => {
    const n = (r.native || []).find((x) => !x.for || x.for === (field ? 'field' : 'office'))
    return { ...r, open: n ? { kind: 'native' as const, route: n.route } : { kind: 'web' as const, path: r.path } }
  })
}

/** Grouped for the screen, optionally narrowed by what was typed in the search box. */
export function sectionsFor(items: Shown[], search = ''): Section[] {
  const q = search.trim().toLowerCase()
  const kept = q ? items.filter((i) => i.label.toLowerCase().includes(q) || i.group.toLowerCase().includes(q)) : items
  return GROUP_ORDER.map((group) => ({ group, items: kept.filter((i) => i.group === group) })).filter((s) => s.items.length)
}

// What the people group's screens share: the row shapes the unified server answers (camelCase; each is read from the
// route named beside it) and the money format the template's screens used.

/** "$1,234.56" — the template's formatCurrency (Intl, USD; a missing amount is $0.00). */
export const money = (amount: unknown): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(amount) || 0)

/** A row of GET /api/caregivers (server/crm/homecare/hr/caregivers.ts): pay comes off for a reader without care-payroll:read. */
export interface CaregiverRow {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  isActive: boolean | null
  hireDate?: string | null
  defaultPayRate?: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  latitude: string | null
  longitude: string | null
  /** Not in the reply (the list is caregivers only); the template read it and it was absent there too. */
  role?: string | null
}

/** A row of GET /api/users/caregivers — the pickers' list. */
export interface CaregiverPick {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  role: string | null
  isActive: boolean | null
}

export const fullName = (p: { firstName?: string | null; lastName?: string | null } | null | undefined): string =>
  [p?.firstName, p?.lastName].filter(Boolean).join(' ')

/** The agency's name, which the server writes into the page (server/http/adminScreens.ts, meta company-name). */
export const pageCompanyName = (): string =>
  (typeof document !== 'undefined' && document.querySelector('meta[name="company-name"]')?.getAttribute('content')) || ''

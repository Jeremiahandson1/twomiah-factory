// What the clients group's screens share: the rows they read (as the unified server answers them — camelCase, lists
// as { data, pagination }) and the one way they load a whole list.
//
// The template's screens asked GET /api/clients and GET /api/caregivers for one page (no limit = 50, or ?limit=500) and
// showed only that page; an agency with more had clients missing from every picker with nothing said. allRows() walks
// the pages until the server says there are no more.
import type { CSSProperties } from 'react'
import { listAll } from '../lib/http'

/** A client as GET /api/clients and GET /api/clients/:id answer it (server/crm/homecare/clients/clients.ts). */
export interface Client {
  id: string
  firstName: string
  lastName: string
  dateOfBirth?: string | null
  gender?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  referredById?: string | null
  medicaidId?: string | null
  mcoMemberId?: string | null
  careTypeId?: string | null
  isPrivatePay?: boolean | null
  privatePayRate?: string | number | null
  privatePayRateType?: string | null
  billingNotes?: string | null
  weeklyAuthorizedUnits?: string | number | null
  evvWeeklyUnits?: number | null
  medicalConditions?: unknown
  medications?: unknown
  allergies?: unknown
  medicalNotes?: string | null
  assistanceNeeds?: string | null
  insuranceProvider?: string | null
  insuranceId?: string | null
  insuranceGroup?: string | null
  carePreferences?: string | null
  preferredCaregivers?: unknown
  doNotUseCaregivers?: unknown
  notes?: string | null
  serviceType?: string | null
  isActive?: boolean | null
  emergencyContacts?: EmergencyContact[]
}

/** A row of client_emergency_contacts. */
export interface EmergencyContact {
  id: string
  name: string
  phone: string
  relationship?: string | null
  email?: string | null
  isPrimary: boolean
}

/** A caregiver as GET /api/caregivers answers it (server/crm/homecare/hr/caregivers.ts). */
export interface Caregiver {
  id: string
  firstName: string
  lastName: string
  isActive?: boolean
}

/** A referral source / payer (GET /api/referral-sources). */
export interface ReferralSource {
  id: string
  name: string
  type?: string | null
  contactName?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}

/** A care type (GET /api/care-types). */
export interface CareType {
  id: string
  name: string
}

/** Every row of a paged list endpoint, page by page (lib/http.ts listAll). */
export async function allRows<T>(path: string, params: Record<string, string | number | boolean> = {}): Promise<T[]> {
  return (await listAll<T>(path, params)).data
}

/** "First Last" for a client or a caregiver row. */
export const fullName = (p: { firstName?: string | null; lastName?: string | null } | null | undefined): string =>
  `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim()

/** The template's blue-underlined section heading in a form, on the frame's blue ink (light and dark). */
export const SECTION_HEAD: CSSProperties = {
  borderBottom: '2px solid var(--hc-blue-ink)', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '1rem',
}

/** A small hint under a field. */
export const HINT: CSSProperties = { color: 'var(--hc-muted)', display: 'block', marginTop: '0.25rem' }

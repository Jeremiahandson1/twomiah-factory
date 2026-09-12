// Shared Contacts pages — the contract between a template and the vendored pages.
import type { InvoicingApi, InvoicingToast } from '../invoicing/types'

export type ContactsApi = InvoicingApi
export type ContactsToast = InvoicingToast

export interface ContactType { value: string; label: string }

export type QuickActionIcon = 'quote' | 'job' | 'invoice' | 'event' | 'patients' | 'appointment'
export interface QuickAction {
  label: string
  /** route; `:id` is replaced with the contact id */
  to: string
  icon?: QuickActionIcon
  /** only shown when hasFeature(feature) — omit for always */
  feature?: string
}

export interface ContactSections {
  projects?: boolean
  quotes?: boolean
  /** events venue (restaurant) — gated by `event_bookings` */
  events?: boolean
  /** field service / landscaping */
  equipment?: boolean
  sites?: boolean
  sms?: boolean
  /** vet: the owner's patients */
  patients?: boolean
  /** customer portal access panel (needs an email) */
  portal?: boolean
}

export interface ContactsConfig {
  /** Page title. Default "Contacts". */
  title?: string
  /** Types offered in the filter cards + form. Default lead/client/subcontractor/vendor. */
  types?: ContactType[]
  /** Noun on the convert button: "Convert to <Client>". Default "Client". */
  convertLabel?: string
  /** Row action that invites a vendor to the vendor portal (construction only). */
  vendorPortalInvite?: boolean
  sections?: ContactSections
  /** Feature id that gates the portal panel; `false` shows it whenever the contact has an email. Default 'client_portal'. */
  portalGate?: string | false
  /** Hide the projects / quotes / invoices lists + counts unless the matching feature is on (salon, events). */
  gateByFeature?: boolean
  /** Sidebar quick actions. Default: Create Quote, Schedule Job, Create Invoice. */
  quickActions?: QuickAction[]
  hasFeature?: (id: string) => boolean
}

export const DEFAULT_CONTACT_TYPES: ContactType[] = [
  { value: 'lead', label: 'Lead' },
  { value: 'client', label: 'Client' },
  { value: 'subcontractor', label: 'Subcontractor' },
  { value: 'vendor', label: 'Vendor' },
]

export const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  { label: 'Create Quote', to: '/crm/quotes?contactId=:id', icon: 'quote' },
  { label: 'Schedule Job', to: '/crm/jobs?contactId=:id', icon: 'job' },
  { label: 'Create Invoice', to: '/crm/invoices?contactId=:id', icon: 'invoice' },
]

export const DEFAULT_SECTIONS: ContactSections = { projects: true, quotes: true, portal: true }

export function resolveContactsConfig(c?: ContactsConfig) {
  const cfg = c || {}
  return {
    title: cfg.title || 'Contacts',
    types: cfg.types && cfg.types.length ? cfg.types : DEFAULT_CONTACT_TYPES,
    convertLabel: cfg.convertLabel || 'Client',
    vendorPortalInvite: !!cfg.vendorPortalInvite,
    sections: { ...DEFAULT_SECTIONS, ...(cfg.sections || {}) },
    portalGate: cfg.portalGate === undefined ? 'client_portal' : cfg.portalGate,
    gateByFeature: !!cfg.gateByFeature,
    quickActions: cfg.quickActions || DEFAULT_QUICK_ACTIONS,
    hasFeature: cfg.hasFeature || (() => true),
  }
}

export interface ContactsPageProps { api: ContactsApi; toast: ContactsToast; config?: ContactsConfig }

/** Same rule as the shared backend: phone punctuation only, at least 7 digits. */
export const isValidPhone = (v: unknown) => !v || (/^[0-9+()\-.\s]+$/.test(String(v)) && String(v).replace(/\D/g, '').length >= 7)

export interface ContactRow {
  id: string
  name: string
  type: string
  company?: string | null
  email?: string | null
  phone?: string | null
  mobile?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  source?: string | null
  notes?: string | null
  optedOutSms?: boolean | null
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

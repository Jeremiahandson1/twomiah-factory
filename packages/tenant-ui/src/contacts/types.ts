// Shared Contacts pages — the contract between a template and the vendored pages.
import type { ReactNode } from 'react'
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
  /**
   * Only shown to a seat holding this — the permission the page it opens will ask to save. Omitted, it is worked
   * out from the link (quickActionPermission): /crm/quotes → quotes:create, and so on. A plain navigation link
   * (Patients, Appointments) asks nothing. (T62: "Create Quote/Invoice … staff see that the server refuses")
   */
  permission?: string
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
  /**
   * store: the shopper's orders, newest first (the server's `orders` relation). Shown only when the reply carries the
   * list — a seat without orders:read is not sent it.
   */
  orders?: boolean
  /** customer portal access panel (needs an email) */
  portal?: boolean
  /** Every contact has these unless the vertical turns them off; each still asks its feature (SECTION_FEATURES). */
  invoices?: boolean
  jobs?: boolean
}

export interface ContactsConfig {
  /** Page title. Default "Contacts". */
  title?: string
  /** Types offered in the filter cards + form. Default lead/client/subcontractor/vendor. */
  types?: ContactType[]
  /** Noun on the convert button: "Convert to <Client>". Default "Client". */
  convertLabel?: string
  /** Noun on the add button and its dialog: "Add <Guest>", "Edit <Guest>". Default "Contact". */
  addLabel?: string
  /** Row action that invites a vendor to the vendor portal (construction only). */
  vendorPortalInvite?: boolean
  sections?: ContactSections
  /** Feature id that gates the portal panel; `false` shows it whenever the contact has an email. Default 'client_portal'. */
  portalGate?: string | false
  /**
   * Kept for the configs that still set it; it no longer changes anything. Every related list, count and quick action
   * is shown only when its feature is switched on (SECTION_FEATURES) — the rule every vertical now follows, not one a
   * vertical opts into. (Live tests 2026-10-22: a landscaper's contact read "Projects", a home-care agency's offered
   * "Create Quote" — links to features the business does not have.)
   */
  gateByFeature?: boolean
  /** Sidebar quick actions. Default: Create Quote, Schedule <Job>, Create Invoice — each behind its feature. */
  quickActions?: QuickAction[]
  /** What this trade calls a job: "Schedule <Service Call>", the "<Service Calls>" list. Default Job / Jobs. */
  jobLabels?: { singular: string; plural: string }
  /** What this trade calls a customer's service site: a landscaper's Property, Properties. Default Location / Locations. */
  siteLabels?: SiteLabels
  hasFeature?: (id: string) => boolean
  /**
   * May this person add or change a contact? Threaded in from the template's own auth context, the way hasFeature is —
   * a shared page must not reach for a provider a given vertical may not mount. Absent means "do not
   * ask", so a template that has not been rewired keeps every control it has today. (T30 M-R1)
   */
  can?: (permission: string) => boolean
  /**
   * The app's own panels for this contact, drawn in the main column after the related lists — the unified app's
   * bookings (each in the name its booker typed). Absent: nothing extra, as before.
   */
  panels?: (contactId: string) => ReactNode
}

/** A customer's service site, in the trade's words (contacts, quotes, jobs). */
export interface SiteLabels { singular: string; plural: string; /** The Add form's example name. */ namePlaceholder?: string }
export const DEFAULT_SITE_LABELS: SiteLabels = { singular: 'Location', plural: 'Locations' }

/**
 * THE FEATURE BEHIND EACH PART OF A CONTACT'S PAGE. A section the vertical has (config.sections) is shown only when this
 * feature is switched on too: the list, its count in the Summary, and the quick action that opens its page. Sections
 * missing here (sites, patients, orders) belong to the contact record itself; the texting panel keeps the
 * customer's opt-out and shows its thread only with Two-Way Texting on (ContactDetailPage `textingOn`).
 */
export const SECTION_FEATURES: Record<string, string> = {
  projects: 'projects', quotes: 'quotes', invoices: 'invoices', jobs: 'jobs', equipment: 'equipment_tracking', events: 'event_bookings',
}

export const DEFAULT_CONTACT_TYPES: ContactType[] = [
  { value: 'lead', label: 'Lead' },
  { value: 'client', label: 'Client' },
  { value: 'subcontractor', label: 'Subcontractor' },
  { value: 'vendor', label: 'Vendor' },
]

/** What a quick action's destination will ask to SAVE, by the page it opens. One table for every vertical's list. */
const CREATES_ON: [RegExp, string][] = [
  [/^\/crm\/quotes(\?|$)/, 'quotes:create'],
  [/^\/crm\/jobs(\?|$)/, 'jobs:create'],
  [/^\/crm\/invoices(\?|$)/, 'invoices:create'],
  // an event is created on contacts:create (routes/events.ts POST /)
  [/^\/crm\/events(\?|$)/, 'contacts:create'],
]
export const quickActionPermission = (a: QuickAction): string | undefined => a.permission ?? CREATES_ON.find(([re]) => re.test(a.to))?.[1]

/** The default quick actions, each behind the feature whose page it opens; the job one in the trade's word. */
export const defaultQuickActions = (jobSingular = 'Job'): QuickAction[] => [
  { label: 'Create Quote', to: '/crm/quotes?contactId=:id', icon: 'quote', feature: 'quotes' },
  { label: `Schedule ${jobSingular}`, to: '/crm/jobs?contactId=:id', icon: 'job', feature: 'jobs' },
  { label: 'Create Invoice', to: '/crm/invoices?contactId=:id', icon: 'invoice', feature: 'invoices' },
]
export const DEFAULT_QUICK_ACTIONS: QuickAction[] = defaultQuickActions()

/**
 * The feature a quick action needs: its own `feature`, else the one behind the page it opens — so a vertical's own
 * list that names no feature ("Create Invoice" on the salon's) is held to the same rule.
 */
export const quickActionFeature = (a: QuickAction): string | undefined =>
  a.feature ?? (/^\/crm\/quotes(\?|$)/.test(a.to) ? 'quotes' : /^\/crm\/jobs(\?|$)/.test(a.to) ? 'jobs' : /^\/crm\/invoices(\?|$)/.test(a.to) ? 'invoices' : /^\/crm\/events(\?|$)/.test(a.to) ? 'event_bookings' : undefined)

export const DEFAULT_SECTIONS: ContactSections = { projects: true, quotes: true, portal: true }

export function resolveContactsConfig(c?: ContactsConfig) {
  const cfg = c || {}
  const hasFeature = cfg.hasFeature || (() => true)
  const sections = { ...DEFAULT_SECTIONS, ...(cfg.sections || {}) } as ContactSections & Record<string, boolean | undefined>
  const jobLabels = cfg.jobLabels?.singular ? cfg.jobLabels : { singular: 'Job', plural: 'Jobs' }
  return {
    title: cfg.title || 'Contacts',
    types: cfg.types && cfg.types.length ? cfg.types : DEFAULT_CONTACT_TYPES,
    convertLabel: cfg.convertLabel || 'Client',
    addLabel: cfg.addLabel || 'Contact',
    vendorPortalInvite: !!cfg.vendorPortalInvite,
    sections,
    portalGate: cfg.portalGate === undefined ? 'client_portal' : cfg.portalGate,
    /**
     * Is this part of the page shown? The vertical has it (a section it set, or one every contact has — invoices, jobs)
     * AND the business has its feature on. One answer for the list, its Summary count and its quick action.
     */
    shows: (part: string): boolean => {
      const offered = part === 'invoices' || part === 'jobs' ? sections[part] !== false : !!sections[part]
      const feature = SECTION_FEATURES[part]
      return offered && (!feature || hasFeature(feature))
    },
    quickActions: (cfg.quickActions || defaultQuickActions(jobLabels.singular)).filter((a) => { const f = quickActionFeature(a); return !f || hasFeature(f) }),
    jobLabels,
    siteLabels: cfg.siteLabels?.singular ? cfg.siteLabels : DEFAULT_SITE_LABELS,
    hasFeature,
    can: cfg.can || (() => true),
    panels: cfg.panels,
  }
}

/**
 * A CUSTOMER PICKER LISTS CUSTOMERS. Every picker that chooses who is quoted, invoiced, booked or worked for asks the
 * server for customers only (GET /api/contacts?audience=customers — every contact but a vendor) and leaves vendors out
 * itself as well, for a server that does not know the word yet; a vendor already on a record stays shown so editing it
 * does not silently drop them. A vendor is who the business buys from. (Live tests 2026-10-22.)
 */
export const CUSTOMER_PICKER_PARAMS = { audience: 'customers' } as const
export const customersOnly = <T extends { id: string; type?: string | null }>(rows: T[], keep?: string | null): T[] =>
  rows.filter((c) => c.type !== 'vendor' || (!!keep && c.id === keep))

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

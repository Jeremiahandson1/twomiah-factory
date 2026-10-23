// The vertical's settings for the CRM screens (VerticalSettings.screens, apps/unified/verticals/<id>/settings.ts),
// which the server writes into the page as JSON (server/http/adminScreens.ts). Typed here by each shared screen's own
// config type, so a vertical that sets a wrong field is caught where it's read.
// Deep paths, not the package index (see ../shared.ts).
import type { ContactsConfig } from '@twomiah/tenant-ui/src/contacts/types'
import type { JobsConfig } from '@twomiah/tenant-ui/src/jobs/types'
import type { InvoicingConfig } from '@twomiah/tenant-ui/src/invoicing/types'
import type { DocumentsConfig } from '@twomiah/tenant-ui/src/files/types'
import type { EquipmentConfig } from '@twomiah/tenant-ui/src/equipment/types'
import type { PricebookConfig } from '@twomiah/tenant-ui/src/pricebook/types'
import type { ReportingConfig, JobsDashboardConfig, JobCostingConfig } from '@twomiah/tenant-ui/src/reporting/types'
import type { AgreementsConfig } from '@twomiah/tenant-ui/src/agreements/types'
import type { FleetConfig } from '@twomiah/tenant-ui/src/fleet/types'
import type { CommissionsConfig } from '@twomiah/tenant-ui/src/commissions/CommissionsPage'
import type { TechViewConfig } from '@twomiah/tenant-ui/src/tech/TechView'
import type { IntegrationsConfig } from '@twomiah/tenant-ui/src/settings/integrationsTypes'
import type { WarrantiesConfig } from '@twomiah/tenant-ui/src/warranties/types'

export interface VerticalScreens {
  contacts: ContactsConfig
  jobs: JobsConfig
  invoicing: InvoicingConfig
  documents: DocumentsConfig
  equipment: EquipmentConfig
  pricebook: PricebookConfig
  reporting: ReportingConfig
  dashboard: JobsDashboardConfig
  jobCosting: JobCostingConfig
  agreements: AgreementsConfig
  /** The warranty and claim forms' examples, in the trade's words (absent: neutral ones). */
  warranties: WarrantiesConfig
  fleet: FleetConfig
  commissions: CommissionsConfig
  tech: Omit<TechViewConfig, 'hasFeature'>
  time: Record<string, unknown>
  expenses: Record<string, unknown>
  team: Record<string, unknown>
  portal: Record<string, unknown>
  leads: Record<string, unknown>
  marketing: Record<string, unknown>
  messages: Record<string, unknown>
  reviews: Record<string, unknown>
  migration: Record<string, unknown>
  import: Record<string, unknown>
  settings: Record<string, unknown>
  /**
   * Parts & Materials (crm/pages/fieldservice/PartsInventory): the categories a part is filed under (absent: field
   * service's), and the part-name example in the trade's words (absent: a neutral one).
   */
  parts: { categories?: string[]; namePlaceholder?: string }
  /** The first-run wizard: the integrations its second step offers, by id (absent: all of them). */
  onboarding: {
    integrations?: string[]
    /** The vertical's own entries for that step (id, label, description, category, guideSteps), e.g. RV's marketplaces. */
    extra?: Array<{ id: string; label: string; description: string; category: string; guideSteps: string[]; open?: { to: string; label: string } }>
    /** Whose suggested addresses the branded-email step offers (packages/tenant-ui config/emailDefaults.ts); absent, 'crm'. */
    emailProduct?: string
  }
  /**
   * The vertical whose own dashboard replaces the shared jobs dashboard at /crm/dashboard ('salon': crm/verticals/salon.tsx
   * `dashboard`), as its /api/dashboard answers in that vertical's shape. Absent: the jobs dashboard. Read it with
   * `typeof … === 'string'`: an absent setting reads as an empty object here.
   */
  home?: string
  /**
   * The browser's Google Maps key (address search, satellite tiles), served at run time by the server
   * (GOOGLE_MAPS_BROWSER_KEY, restricted to the tenant's web addresses). Empty: no key — the screens fall back.
   */
  mapsBrowserKey?: string
  /**
   * The switch the call log and the CallRail key ride (server CrmSettings.callTrackingSwitch, served at run time):
   * 'ai_receptionist' puts the CallRail key in the AI Receptionist page's Settings tab, there being no Call Tracking page.
   */
  callTrackingSwitch?: 'call_tracking' | 'ai_receptionist'
  /**
   * The vertical whose own figures sit above the shared Reports page ('bar': the register's nights, crm/verticals/bar.tsx
   * `reportsAbove`). Absent: the shared page alone. Read it with `typeof … === 'string'`.
   */
  reportsAbove?: string
  /**
   * Whose screens /crm/appointments and /crm/reminders are, as the server's CrmSettings.appointments decides whose
   * /api/appointments and /api/reminders answer: 'practice' is the vet's (crm/verticals/vet.tsx registers them); absent,
   * the salon's (crm/verticals/salon.tsx). One route per path: a Route the other vertical also declares never matches.
   * Read it with `typeof … === 'string'`.
   */
  book?: string
  /**
   * What the trade calls a customer's service site, on every screen that shows one (the contact's page, the quote and job
   * forms): a landscaper's Property / Properties. Absent: Location / Locations. Read `.singular` before trusting it: an
   * absent setting reads as an empty object here.
   */
  sites: { singular?: string; plural?: string; namePlaceholder?: string }
  /**
   * The vertical's own words for stored codes — statuses, stages, types (packages/tenant-ui labels/codes.ts codeLabel):
   * registered once at startup (main.tsx). Absent: the shared words, then the code made readable.
   */
  codeLabels?: Record<string, string>
  /** The Schedule screen: `events` shows calendar appointments (/api/schedule-events) with "New Appointment" (RV). */
  schedule: { events?: boolean }
  /** Settings › Integrations: the vertical's words for its cards and which extra panels it shows (RV's call tracking). */
  integrations: Omit<IntegrationsConfig, 'leadSources'>
}

let cached: VerticalScreens | null = null

/** The settings the page was served with. Read once; a page without them (a test, a stale build) gets empty ones. */
export function verticalScreens(): VerticalScreens {
  if (cached) return cached
  let parsed: Partial<VerticalScreens> = {}
  try { parsed = JSON.parse(document.getElementById('vertical-screens')?.textContent || '{}') } catch { parsed = {} }
  const empty = {} as any
  cached = new Proxy(parsed as VerticalScreens, { get: (t, k: string) => (t as any)[k] ?? empty })
  return cached
}

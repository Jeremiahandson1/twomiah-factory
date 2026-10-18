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

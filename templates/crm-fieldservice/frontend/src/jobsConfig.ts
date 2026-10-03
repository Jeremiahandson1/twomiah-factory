// What this vertical does differently in the shared Jobs pages (see ./shared).
import type { JobsConfig } from './shared'

export const JOBS: JobsConfig = {
  labels: { singular: 'Service Call', plural: 'Service Calls', add: 'New Service Call' },
  equipment: true,
  sites: true,
  photos: true,
  /**
   * A service call can be billed: the detail page offers Invoice, which posts to
   * /api/jobs/:id/invoice. Mounted on this vertical because invoice.job_id exists here
   * (migration 0025) — see the shared jobs module's options.billing. (T41)
   */
  billing: true,
}

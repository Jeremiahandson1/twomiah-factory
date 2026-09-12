// What this vertical does differently in the shared Jobs pages (see ./shared).
import type { JobsConfig } from './shared'

export const JOBS: JobsConfig = {
  labels: { singular: 'Service Call', plural: 'Service Calls', add: 'New Service Call' },
  equipment: true,
  sites: true,
  photos: true,
}

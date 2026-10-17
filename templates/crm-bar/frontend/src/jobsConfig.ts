// What this vertical does differently in the shared Jobs pages (see ./shared).
import type { JobsConfig } from './shared'

export const JOBS: JobsConfig = {
  labels: { singular: 'Job', plural: 'Jobs', add: 'New Job' },
  equipment: true,
  sites: true,
  photos: true,
}

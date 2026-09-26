// What this vertical does differently in the shared Reports page (see ./shared).
import type { ReportingConfig } from './shared'

// A salon books appointments; neither jobs, quotes nor projects are offered to it.
export const REPORTING: ReportingConfig = { jobsLabel: 'Appointments', jobs: false, quotes: false, projects: false, team: true, eventsPipeline: false, dealership: false }

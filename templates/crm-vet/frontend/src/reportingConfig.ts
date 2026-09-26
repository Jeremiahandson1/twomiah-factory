// What this vertical does differently in the shared Reports page (see ./shared).
import type { ReportingConfig } from './shared'

// A clinic books appointments; the registry offers it neither jobs, quotes nor projects. `jobsLabel`
// is unused while `jobs` is false, but it is stated so a future field cannot arrive unanswered.
export const REPORTING: ReportingConfig = { jobsLabel: 'Appointments', jobs: false, quotes: false, projects: false, team: true, eventsPipeline: false, dealership: false }

// What this vertical does differently in the shared Reports page (see ./shared).
import type { ReportingConfig } from './shared'

// team: the productivity panel reads time entries, and the events CRM has no time tracking (T16/T17 L9).
export const REPORTING: ReportingConfig = { jobsLabel: 'Jobs', projects: false, team: false }

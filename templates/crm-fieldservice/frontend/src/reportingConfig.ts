// What this vertical does differently in the shared Reports page and home dashboard (see ./shared).
import type { ReportingConfig, JobsDashboardConfig } from './shared'

// A trade that runs service calls rather than projects — `projects` is not offered to this template.
export const REPORTING: ReportingConfig = { jobsLabel: 'Service Calls', jobs: true, quotes: true, projects: false, team: true, eventsPipeline: false, dealership: false }
export const DASHBOARD: JobsDashboardConfig = { jobsLabel: 'Service Calls', todayBoard: true, projects: false }

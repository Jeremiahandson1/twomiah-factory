// What this vertical does differently in the shared Reports page and home dashboard (see ./shared).
import type { ReportingConfig, JobCostingConfig, JobsDashboardConfig } from './shared'

// A trade that runs service calls rather than projects — `projects` is not offered to this template.
export const REPORTING: ReportingConfig = { jobsLabel: 'Service Calls', jobs: true, quotes: true, projects: false, team: true, eventsPipeline: false, dealership: false }
export const DASHBOARD: JobsDashboardConfig = { jobsLabel: 'Service Calls', todayBoard: true, projects: false }

// Job Costing names the vertical's work in its title and column headers. jobsLabel tracks
// REPORTING so the two can never drift; costingLabel is stated because jobsLabel is plural.
export const JOB_COSTING: JobCostingConfig = { jobsLabel: REPORTING.jobsLabel, costingLabel: 'Service Call Costing' }

// What this vertical does differently in the shared Reports page and home dashboard (see ./shared).
import type { ReportingConfig, JobCostingConfig, JobsDashboardConfig } from './shared'

// The general contractor: jobs, quotes and projects are all its own, and all offered in the registry.
export const REPORTING: ReportingConfig = { jobsLabel: 'Jobs', jobs: true, quotes: true, projects: true, team: true, eventsPipeline: false, dealership: false }
export const DASHBOARD: JobsDashboardConfig = { jobsLabel: 'Jobs', projects: true }

// Job Costing names the vertical's work in its title and column headers. jobsLabel tracks
// REPORTING so the two can never drift; costingLabel is stated because jobsLabel is plural.
export const JOB_COSTING: JobCostingConfig = { jobsLabel: REPORTING.jobsLabel, costingLabel: 'Job Costing' }

// What this vertical does differently in the shared Reports page and home dashboard (see ./shared).
import type { ReportingConfig, JobsDashboardConfig } from './shared'

// The general contractor: jobs, quotes and projects are all its own, and all offered in the registry.
export const REPORTING: ReportingConfig = { jobsLabel: 'Jobs', jobs: true, quotes: true, projects: true, team: true, eventsPipeline: false, dealership: false }
export const DASHBOARD: JobsDashboardConfig = { jobsLabel: 'Jobs', projects: true }

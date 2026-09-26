// What this vertical does differently in the shared Reports page and home dashboard (see ./shared).
import type { ReportingConfig, JobsDashboardConfig } from './shared'

// The generic CRM: jobs and quotes, no construction projects.
export const REPORTING: ReportingConfig = { jobsLabel: 'Jobs', jobs: true, quotes: true, projects: false, team: true, eventsPipeline: false, dealership: false }
export const DASHBOARD: JobsDashboardConfig = { jobsLabel: 'Jobs', todayBoard: true, projects: false }

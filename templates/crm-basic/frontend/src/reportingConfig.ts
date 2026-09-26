// What this vertical does differently in the shared Reports page and home dashboard (see ./shared).
import type { ReportingConfig, JobsDashboardConfig } from './shared'

export const REPORTING: ReportingConfig = { jobsLabel: 'Jobs', projects: false }
export const DASHBOARD: JobsDashboardConfig = { jobsLabel: 'Jobs', todayBoard: true, projects: false }

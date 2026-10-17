// What this vertical does differently in the shared Reports page and home dashboard (see ./shared).
import type { ReportingConfig, JobCostingConfig, JobsDashboardConfig } from './shared'

// A bar: no jobs, quotes or projects (the registry offers it none of them — Bar Run 1 found the Reports page
// showing "Jobs completed" and "Quote conversion"). Its sales are pages/bar/SalesReport.tsx, above the shared
// page; parties take the events pipeline, set per tenant by the wrapper from hasFeature('event_bookings'). team:
// the productivity panel is jobs completed and hours per person — tips by person are in the sales section, and hours on Time.
export const REPORTING: ReportingConfig = { jobsLabel: 'Jobs', jobs: false, quotes: false, projects: false, team: false, eventsPipeline: false, dealership: false }
export const DASHBOARD: JobsDashboardConfig = { jobsLabel: 'Jobs', todayBoard: true, projects: false }

// Job Costing names the vertical's work in its title and column headers. jobsLabel tracks
// REPORTING so the two can never drift; costingLabel is stated because jobsLabel is plural.
export const JOB_COSTING: JobCostingConfig = { jobsLabel: REPORTING.jobsLabel, costingLabel: 'Job Costing' }

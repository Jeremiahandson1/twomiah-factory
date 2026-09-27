// Shared Reports page + jobs-family dashboard — the contract between a template and the vendored pages.
import type { InvoicingApi } from '../invoicing/types'

export type ReportingApi = InvoicingApi

export interface ReportingConfig {
  /** Plural noun for jobs: "Jobs", "Service Calls". */
  jobsLabel?: string
  /** Show job cards + the job status chart (a salon or vet has no jobs). Default true. */
  jobs?: boolean
  /** Show quote conversion. Default true. */
  quotes?: boolean
  /** Show the project summary. Default true. */
  projects?: boolean
  /** Show team productivity. Default true. */
  team?: boolean
  /** Events venue: replace the job cards + chart with the events pipeline from /api/dashboard/stats. */
  eventsPipeline?: boolean
  /** Dealership (RV): units sold, front-end gross, close rate, sales pipeline and service from /api/dashboard/sales-report. */
  dealership?: boolean
}

export interface ReportsPageProps { api: ReportingApi; config?: ReportingConfig }

export const defaultReportingConfig: Required<ReportingConfig> = { jobsLabel: 'Jobs', jobs: true, quotes: true, projects: true, team: true, eventsPipeline: false, dealership: false }
export const resolveReportingConfig = (c?: ReportingConfig) => ({ ...defaultReportingConfig, ...(c || {}) })

/**
 * Job Costing's own vocabulary — deliberately NOT part of ReportingConfig.
 *
 * Every vertical must answer every field of ReportingConfig, which is what makes a new reporting
 * capability safe (check-vertical-vocabulary.ts rule 3). Job costing is offered to four templates out
 * of thirteen, so putting its label there would force a vet, a salon, a restaurant and a dealership to
 * name a page they can never open — the same contractor bleed that rule exists to stop, wearing a
 * different hat. It lives here, and only the entitled templates configure it.
 */
export interface JobCostingConfig {
  /** Plural noun for jobs, matching the vertical: "Jobs", "Service Calls". */
  jobsLabel?: string
  /**
   * The page's title, STATED rather than derived: `jobsLabel` is plural, so `${jobsLabel} Costing`
   * produces "Service Calls Costing". Each vertical says what it calls the thing.
   */
  costingLabel?: string
}

export interface JobCostingPageProps { api: ReportingApi; config?: JobCostingConfig }

export const defaultJobCostingConfig: Required<JobCostingConfig> = { jobsLabel: 'Jobs', costingLabel: 'Job Costing' }
export const resolveJobCostingConfig = (c?: JobCostingConfig) => ({ ...defaultJobCostingConfig, ...(c || {}) })

export interface JobsDashboardConfig {
  /** "Jobs" / "Service Calls" */
  jobsLabel?: string
  jobsPath?: string
  /** Show the "Today's board" strip (field service). Default false. */
  todayBoard?: boolean
  /** Show the Active Projects card. Default true. */
  projects?: boolean
}

export interface JobsDashboardPageProps {
  api: ReportingApi
  user?: { firstName?: string | null } | null
  company?: { name?: string | null } | null
  config?: JobsDashboardConfig
}

export const defaultJobsDashboardConfig: Required<JobsDashboardConfig> = { jobsLabel: 'Jobs', jobsPath: '/crm/jobs', todayBoard: false, projects: true }
export const resolveJobsDashboardConfig = (c?: JobsDashboardConfig) => ({ ...defaultJobsDashboardConfig, ...(c || {}) })

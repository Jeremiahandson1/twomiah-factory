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
}

export interface ReportsPageProps { api: ReportingApi; config?: ReportingConfig }

export const defaultReportingConfig: Required<ReportingConfig> = { jobsLabel: 'Jobs', jobs: true, quotes: true, projects: true, team: true, eventsPipeline: false }
export const resolveReportingConfig = (c?: ReportingConfig) => ({ ...defaultReportingConfig, ...(c || {}) })

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

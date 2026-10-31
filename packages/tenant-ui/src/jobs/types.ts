// Shared Jobs pages — the contract between a template and the vendored pages.
import type { InvoicingApi, InvoicingToast } from '../invoicing/types'
import { DEFAULT_SITE_LABELS, type SiteLabels } from '../contacts/types'

export type JobsApi = InvoicingApi & { request?: (path: string, init?: any) => Promise<any> }
export type JobsToast = InvoicingToast

export interface JobsConfig {
  /** Kinds of job the form offers in a "Job type" box (a business's own, e.g. for its checklists). Absent: no box. */
  jobTypes?: string[]
  /** Vertical vocabulary. Default Job / Jobs / Add Job. */
  labels?: { singular?: string; plural?: string; add?: string }
  /** Assigned To picker (GET /api/team). Default true. */
  assignee?: boolean
  /** Equipment picker on the form + equipment card on the detail page (fs / landscaping). */
  equipment?: boolean
  /** Service-location picker on the form (fs / landscaping). */
  sites?: boolean
  /** What the trade calls a service site (a landscaper's Property). Default Location. */
  siteLabels?: SiteLabels
  /** Photo gallery on the detail page (needs /api/jobs/:id/photos). */
  photos?: boolean
  /**
   * Where this business's job photos live, for adding, viewing and removing them on the job page (JobPhotosPanel):
   * 'job' = /api/jobs/:id/photos, 'library' = /api/photos by jobId. Absent: the view-only gallery above. (2026-10-22)
   */
  photoStore?: 'job' | 'library'
  /** The job's notes log on the detail page (JobNotesPanel, /api/comments/job/:id). Off unless the app mounts it. */
  notes?: boolean
  /** The business's zone, for when a note was written. */
  timeZone?: string
  statuses?: string[]
  priorities?: string[]
  hasFeature?: (id: string) => boolean
  /**
   * May this person raise a job, or see the roster? Threaded in from the template's own auth context, the way hasFeature is —
   * a shared page must not reach for a provider a given vertical may not mount. Absent means "do not
   * ask", so a template that has not been rewired keeps every control it has today. (T30 M-R1)
   */
  can?: (permission: string) => boolean
  /**
   * Offer "Invoice this job" on the detail page. (T41)
   *
   * Only where the backend mounts POST /api/jobs/:id/invoice — options.billing in the shared jobs
   * module, which in turn needs invoice.job_id (crm-fieldservice migration 0025). Off by default, so
   * no vertical is offered a button that would 404.
   *
   * Reported as "no job→invoice path": a quote converts to an invoice and to a job, but a job
   * converted to nothing, so a service call with no quote behind it could only be billed by hand —
   * and a hand-made invoice attaches to no work, leaving the job showing cost against no revenue.
   */
  billing?: boolean
  /**
   * A new job can repeat — every week, every few weeks or every month, for a number of visits or until a date — and
   * every visit is made on the calendar at once; the job page shows the series and stops it. Only where the server keeps
   * series (packages/tenant-backend jobs.ts tables.jobSeries — the unified app). Default false. (live test 2026-10-22)
   */
  repeat?: boolean
  /**
   * A new job must be for a customer: the form marks the field required and asks for one before it posts, and a job saved
   * without one shows a prompt to pick one when it is edited. The server refuses it too (tenant-backend jobs.ts
   * options.requireCustomer) — this is only the polite half. Default false: a template's form is unchanged.
   */
  requireCustomer?: boolean
  /** What this trade calls its customer, lower case ("customer", "client", "homeowner"). Used with requireCustomer. */
  customerWord?: string
  /**
   * A weekly repeat can pick its days of the week (Monday and Thursday). Needs the server's jobs.repeatWeekdays (tenant-backend
   * jobs.ts options). Default false: the repeat box is as it was. Landscaping only.
   */
  repeatWeekdays?: boolean
  /**
   * "Find a time" on the form (jobs/FindTime.tsx): the open slots inside people's shifts, around their booked jobs and
   * the drive between them — GET /api/availability/find, the unified app's Tech Availability. Default false.
   */
  findTime?: boolean
  /** An app's own panel at the top of the job's side column (the unified app's billing against the job's quote). */
  aside?: (job: Record<string, any>) => import('react').ReactNode
}

/**
 * Every status a job can hold — the server's JOB_STATUSES (tenant-backend jobs/jobs.ts), which GET /api/jobs also sends as
 * `statuses`; the page uses the server's once it has it, this until then. It was five of the eight, so a job converted
 * from a quote ('pending') or a booking awaiting its deposit showed a status the filter could not select (live test
 * 2026-10-22). apps/unified/tests/job-statuses.test.ts holds this to the server's list.
 */
export const DEFAULT_JOB_STATUSES = ['scheduled', 'pending', 'confirmed', 'dispatched', 'in_progress', 'on_hold', 'completed', 'cancelled']
export const DEFAULT_JOB_PRIORITIES = ['low', 'normal', 'high', 'urgent']
export const PRIORITY_COLORS: Record<string, string> = { low: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300', normal: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200', high: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200', urgent: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200' }

export function resolveJobsConfig(c?: JobsConfig) {
  const cfg = c || {}
  return {
    labels: { singular: cfg.labels?.singular || 'Job', plural: cfg.labels?.plural || 'Jobs', add: cfg.labels?.add || `Add ${cfg.labels?.singular || 'Job'}` },
    assignee: cfg.assignee !== false,
    equipment: !!cfg.equipment,
    sites: !!cfg.sites,
    siteLabels: cfg.siteLabels?.singular ? cfg.siteLabels : DEFAULT_SITE_LABELS,
    photos: !!cfg.photos,
    photoStore: cfg.photoStore,
    notes: !!cfg.notes,
    timeZone: cfg.timeZone,
    billing: !!cfg.billing,
    repeat: !!cfg.repeat,
    requireCustomer: !!cfg.requireCustomer,
    customerWord: cfg.customerWord || 'customer',
    jobTypes: cfg.jobTypes && cfg.jobTypes.length ? cfg.jobTypes : null,
    repeatWeekdays: !!cfg.repeat && !!cfg.repeatWeekdays,
    findTime: !!cfg.findTime,
    statuses: cfg.statuses && cfg.statuses.length ? cfg.statuses : DEFAULT_JOB_STATUSES,
    priorities: cfg.priorities && cfg.priorities.length ? cfg.priorities : DEFAULT_JOB_PRIORITIES,
    hasFeature: cfg.hasFeature || (() => true),
    can: cfg.can || (() => true),
  }
}

export interface JobsPageProps { api: JobsApi; toast: JobsToast; config?: JobsConfig }

export interface JobRow {
  id: string
  number: string
  title: string
  status: string
  priority: string
  description?: string | null
  scheduledDate?: string | null
  scheduledTime?: string | null
  estimatedHours?: string | number | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  notes?: string | null
  projectId?: string | null
  contactId?: string | null
  assignedToId?: string | null
  equipmentId?: string | null
  siteId?: string | null
  project?: { id: string; name: string } | null
  contact?: { id: string; name: string; phone?: string | null } | null
  /** set when the job is assigned to a roster-only crew member instead of a login user (T21 M12) */
  assignedToMemberId?: string | null
  assignedTo?: { id?: string; firstName: string; lastName: string; name?: string; kind?: 'user' | 'member' } | null
  /** Everyone on the job, lead first (GET /api/jobs, 2026-10-24: several people per job). */
  assignees?: Array<{ id: string; name?: string; firstName?: string; lastName?: string; kind?: 'user' | 'member'; lead?: boolean }>
  equipment?: { id: string; name: string; manufacturer?: string | null; model?: string | null; serialNumber?: string | null; location?: string | null } | null
  isOverdue?: boolean
  createdAt?: string
  /** The series this visit is in (GET /api/jobs/:id), where jobs repeat. */
  series?: { id: string; summary: string; status: string; index: number | null; total: number; upcoming: number } | null
  [key: string]: unknown
}

export interface JobPhoto { id: string; url: string; thumbnailUrl?: string | null; caption?: string | null; createdAt?: string }

// Shared Jobs pages — the contract between a template and the vendored pages.
import type { InvoicingApi, InvoicingToast } from '../invoicing/types'

export type JobsApi = InvoicingApi & { request?: (path: string, init?: any) => Promise<any> }
export type JobsToast = InvoicingToast

export interface JobsConfig {
  /** Vertical vocabulary. Default Job / Jobs / Add Job. */
  labels?: { singular?: string; plural?: string; add?: string }
  /** Assigned To picker (GET /api/team). Default true. */
  assignee?: boolean
  /** Equipment picker on the form + equipment card on the detail page (fs / landscaping). */
  equipment?: boolean
  /** Service-location picker on the form (fs / landscaping). */
  sites?: boolean
  /** Photo gallery on the detail page (needs /api/jobs/:id/photos). */
  photos?: boolean
  statuses?: string[]
  priorities?: string[]
  hasFeature?: (id: string) => boolean
}

export const DEFAULT_JOB_STATUSES = ['scheduled', 'dispatched', 'in_progress', 'completed', 'cancelled']
export const DEFAULT_JOB_PRIORITIES = ['low', 'normal', 'high', 'urgent']
export const PRIORITY_COLORS: Record<string, string> = { low: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300', normal: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200', high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-200', urgent: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200' }

export function resolveJobsConfig(c?: JobsConfig) {
  const cfg = c || {}
  return {
    labels: { singular: cfg.labels?.singular || 'Job', plural: cfg.labels?.plural || 'Jobs', add: cfg.labels?.add || `Add ${cfg.labels?.singular || 'Job'}` },
    assignee: cfg.assignee !== false,
    equipment: !!cfg.equipment,
    sites: !!cfg.sites,
    photos: !!cfg.photos,
    statuses: cfg.statuses && cfg.statuses.length ? cfg.statuses : DEFAULT_JOB_STATUSES,
    priorities: cfg.priorities && cfg.priorities.length ? cfg.priorities : DEFAULT_JOB_PRIORITIES,
    hasFeature: cfg.hasFeature || (() => true),
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
  assignedTo?: { id?: string; firstName: string; lastName: string } | null
  equipment?: { id: string; name: string; manufacturer?: string | null; model?: string | null; serialNumber?: string | null; location?: string | null } | null
  isOverdue?: boolean
  createdAt?: string
  [key: string]: unknown
}

export interface JobPhoto { id: string; url: string; thumbnailUrl?: string | null; caption?: string | null; createdAt?: string }

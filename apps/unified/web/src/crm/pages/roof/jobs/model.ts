import { money } from '@twomiah/tenant-ui/src/money'
import { verticalScreens } from '../../../vertical'
// What the jobs group's pages read, in one place: the pipeline's stages and the rows the server answers.
//
// The stages are the server's (apps/unified/server/crm/roof/validation.ts PIPELINE_STATUSES and TERMINAL_STATUSES),
// copied here because the browser cannot import the server: Advance steps along PIPELINE_STATUSES, so this list and that
// one must be the same list in the same order. The template carried the list three times (PipelineBoard STAGES, JobsPage
// STATUSES, ReportsPage STAGE_LABELS' keys); the pages here read it from this file.

/** The forward pipeline, in order (server/crm/roof/validation.ts PIPELINE_STATUSES). */
export const PIPELINE_STATUSES = [
  'lead', 'inspection_scheduled', 'inspected', 'measurement_ordered', 'proposal_sent',
  'signed', 'material_ordered', 'in_production', 'final_inspection', 'invoiced', 'collected',
] as const

/** The satellite measurement report's stage (server/crm/roof/validation.ts MEASUREMENT_STAGE). */
export const MEASUREMENT_STAGE = 'measurement_ordered'

/**
 * The stages this business's screens show (server/crm/roof/validation.ts pipelineFor): the measurement stage only while
 * Measurement Reports — a not-ready feature — is on, or while a job still stands in it, so no job leaves the board.
 */
export function pipelineFor(hasFeature: (id: string) => boolean, jobs: ReadonlyArray<{ status?: string | null }> = []): string[] {
  return PIPELINE_STATUSES.filter((s) => s !== MEASUREMENT_STAGE || hasFeature('measurement_reports') || jobs.some((j) => j.status === s))
}

/** Where a job ends when it is not paid (server/crm/roof/validation.ts TERMINAL_STATUSES). */
export const TERMINAL_STATUSES = ['lost', 'cancelled'] as const

/** Every status a roofing job may hold. */
export const JOB_STATUSES = [...PIPELINE_STATUSES, ...TERMINAL_STATUSES] as const

export const STAGE_LABELS: Record<string, string> = {
  lead: 'Lead',
  inspection_scheduled: 'Inspection Scheduled',
  inspected: 'Inspected',
  measurement_ordered: 'Measurement Ordered',
  proposal_sent: 'Proposal Sent',
  signed: 'Signed',
  material_ordered: 'Material Ordered',
  in_production: 'In Production',
  final_inspection: 'Final Inspection',
  invoiced: 'Invoiced',
  collected: 'Collected',
}

/** The company's names for its stages, as GET /api/roof-pipeline and the page answer (server/crm/roof/pipeline.ts). */
export interface PipelineNames {
  /** The company's name for every stage. */
  stageLabels: Record<string, string>
  /** Only the names the company changed. */
  overrides?: Record<string, string>
  boards: Array<{ id: 'retail' | 'insurance'; name: string; stageLabels: Record<string, string> }>
}

let names: PipelineNames | null | undefined
/** The company's names, or null where it has none (the feature is off, or the page was served without them). Read once. */
export function pipelineNames(): PipelineNames | null {
  if (names === undefined) {
    const p = verticalScreens().pipeline as Partial<PipelineNames> | null | undefined
    names = p && typeof p === 'object' && p.stageLabels && Array.isArray(p.boards) ? (p as PipelineNames) : null
  }
  return names
}
/** After the settings page saves: the screens that draw next draw the new names. */
export function setPipelineNames(n: PipelineNames | null) { names = n }

/** The board a job of this type is on: insurance jobs on Insurance, every other type on Retail. */
export const boardOf = (jobType: string | null | undefined): 'retail' | 'insurance' => (jobType === 'insurance' ? 'insurance' : 'retail')

/**
 * A stage's name: the board's own, else the company's, else the standard one (STAGE_LABELS), else the code made readable
 * (lost, cancelled). Pass the job's type for a job; pass a board id for a board's column; pass nothing for "everywhere".
 */
export function stageLabel(stage: string | null | undefined, jobTypeOrBoard?: string | null): string {
  const key = stage || ''
  const fallback = STAGE_LABELS[key] ?? formatStatus(key)
  const n = pipelineNames()
  if (!n) return fallback
  const board = jobTypeOrBoard ? n.boards.find((b) => b.id === boardOf(jobTypeOrBoard)) : undefined
  return board?.stageLabels[key] ?? n.stageLabels[key] ?? fallback
}

/** The job types the forms offer; the data may hold others (GET /api/jobs/types). */
export const JOB_TYPES = ['insurance', 'retail', 'commercial', 'new_construction', 'emergency']

export function formatStatus(s: string | null | undefined): string {
  return (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** A money figure as the template printed it: $1,234.50. */
export function dollars(v: unknown): string {
  return `${money(Number(v || 0))}`
}

/** A list reply (RULEBOOK §3), or a bare array from a shared module that still answers one. */
export function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[]
  const data = (r as { data?: unknown } | null)?.data
  return Array.isArray(data) ? (data as T[]) : []
}

/**
 * A job as GET /api/jobs (and /:id) answers it (server/crm/roof/jobs.ts). Money fields are absent for a seat without the
 * permission they sit under (packages/tenant-backend jobs/jobMoney.ts): estimatedValue under quotes:read; finalRevenue,
 * deductible, rcv, acv and approvedScope under invoices:read; materialCost and laborCost under margin:read.
 */
export interface RoofJob {
  id: string
  number: string | null
  title?: string | null
  status: string
  priority?: string | null
  jobType?: string | null
  source?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  notes?: string | null
  contactId?: string | null
  assignedSalesRepId?: string | null
  assignedCrewId?: string | null
  roofAge?: number | null
  roofType?: string | null
  stories?: number | null
  totalSquares?: string | number | null
  /** The job's day on the calendar (a day marker) and the company's wall-clock time that day (HH:MM). */
  scheduledDate?: string | null
  scheduledTime?: string | null
  claimNumber?: string | null
  insuranceCompany?: string | null
  adjusterName?: string | null
  adjusterPhone?: string | null
  dateOfLoss?: string | null
  deductible?: string | number | null
  rcv?: string | number | null
  acv?: string | number | null
  approvedScope?: string | null
  estimatedValue?: string | number | null
  finalRevenue?: string | number | null
  /** On the list: what the job's own quotes and invoices say it is worth (server/crm/roof/jobs.ts documentValues). */
  quotedValue?: string | number | null
  invoicedValue?: string | number | null
  lostReason?: string | null
  closedAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  /** { id, name } on the list. */
  contact?: { id: string; name?: string | null } | null
}

/**
 * What a job is worth, one rule for the Jobs list's Revenue column and every Reports figure: what it was paid
 * (finalRevenue), else what it was billed (its invoices), else what it was quoted (its quote, without tax), else the
 * office's estimate, else the claim's RCV. Reports read only the estimate and RCV, which a job made from the form never
 * has, so a job with a $9,125.75 invoice counted $0 (live test 2026-10-22).
 */
export function jobValue(j: Pick<RoofJob, 'finalRevenue' | 'invoicedValue' | 'quotedValue' | 'estimatedValue' | 'rcv'>): number | null {
  for (const v of [j.finalRevenue, j.invoicedValue, j.quotedValue, j.estimatedValue, j.rcv]) {
    if (v !== null && v !== undefined && v !== '' && Number(v) > 0) return Number(v)
  }
  return null
}

/** A person from GET /api/company/users (a team:read seat gets only id, names, role, isActive). */
export interface Person { id: string; firstName?: string | null; lastName?: string | null; email?: string | null }

/** A crew from GET /api/crews. */
export interface Crew { id: string; name: string }

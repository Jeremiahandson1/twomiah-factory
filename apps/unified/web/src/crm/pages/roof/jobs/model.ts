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

/** The job types the forms offer; the data may hold others (GET /api/jobs/types). */
export const JOB_TYPES = ['insurance', 'retail', 'commercial', 'new_construction', 'emergency']

export function formatStatus(s: string | null | undefined): string {
  return (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** A money figure as the template printed it: $1,234.50. */
export function dollars(v: unknown): string {
  return `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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
  lostReason?: string | null
  closedAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  /** { id, name } on the list. */
  contact?: { id: string; name?: string | null } | null
}

/** A person from GET /api/company/users (a team:read seat gets only id, names, role, isActive). */
export interface Person { id: string; firstName?: string | null; lastName?: string | null; email?: string | null }

/** A crew from GET /api/crews. */
export interface Crew { id: string; name: string }

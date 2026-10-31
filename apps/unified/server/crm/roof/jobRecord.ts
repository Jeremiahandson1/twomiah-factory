// What a roofing job's page reads beside the job row: its claim's facts, and its history (live test 2026-10-22).
//
//   · The claim's facts. A claim (insurance_claim, one per job) is where the carrier, the adjuster, the date of loss,
//     the deductible, RCV and ACV are written — the claim page is the only screen that edits them. The job row has
//     columns of the same names, which only the claim NUMBER was ever copied into, so the job page's Insurance card
//     showed "—" for everything else beside a filled-in claim. The claim is the one source: every job this module
//     answers carries its claim's facts (withClaimFacts), so no copy can fall behind and no stale row needs mending.
//   · The history. Advance, close and reopen record what happened as job_note rows, in the stored form their writers
//     below give them — status CODES, so a later rename of a stage's label never strands an old row. Those rows are
//     the timeline's, not the notes': the Notes card is what people wrote, the Timeline is what happened (stage moves,
//     photos, texts), each entry in one place, and a stage is shown by its name ("In Production"), never its code.
import { and, eq, inArray } from 'drizzle-orm'
import { insuranceClaim } from '../../db/schema/index.ts'
import { JOB_STATUSES } from './validation.ts'

/** The claim's facts the job carries (insurance_claim → the job's own columns of the same names). */
export const CLAIM_FACTS = ['claimNumber', 'insuranceCompany', 'adjusterName', 'adjusterPhone', 'dateOfLoss', 'deductible', 'rcv', 'acv'] as const

/**
 * Jobs with their claims' facts over the job's own columns: a fact the claim holds wins, one it leaves empty falls back
 * to the job's. Run BEFORE the job's money is withheld (deductible, RCV and ACV are money, jobMoney.ts), so a seat that
 * may not see them still does not.
 */
export async function withClaimFacts<T extends Record<string, any>>(db: any, companyId: string, rows: T[]): Promise<T[]> {
  const ids = rows.map((r) => r.id).filter(Boolean)
  if (!ids.length) return rows
  const claims = await db.select({
    jobId: insuranceClaim.jobId, claimNumber: insuranceClaim.claimNumber, insuranceCompany: insuranceClaim.insuranceCompany,
    adjusterName: insuranceClaim.adjusterName, adjusterPhone: insuranceClaim.adjusterPhone, dateOfLoss: insuranceClaim.dateOfLoss,
    deductible: insuranceClaim.deductible, rcv: insuranceClaim.rcv, acv: insuranceClaim.acv,
  }).from(insuranceClaim).where(and(eq(insuranceClaim.companyId, companyId), inArray(insuranceClaim.jobId, ids)))
  if (!claims.length) return rows
  const byJob = new Map<string, any>(claims.map((cl: any) => [cl.jobId, cl]))
  return rows.map((row) => {
    const claim = byJob.get(row.id)
    if (!claim) return row
    const out: Record<string, any> = { ...row }
    for (const k of CLAIM_FACTS) if (claim[k] !== null && claim[k] !== undefined && claim[k] !== '') out[k] = claim[k]
    return out as T
  })
}

/** One job with its claim's facts. */
export async function withClaimFactsOne<T extends Record<string, any>>(db: any, companyId: string, row: T): Promise<T> {
  return (await withClaimFacts(db, companyId, [row]))[0]
}

/** A stage's name, as every roofing screen shows it (web/src/crm/pages/roof/jobs/model.ts STAGE_LABELS). */
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
  lost: 'Lost',
  cancelled: 'Cancelled',
}
export const stageLabel = (s: string): string => STAGE_LABELS[s] ?? s

// The stored forms. Each writer and its reader below are the same pattern, so the two cannot drift.
export const statusChangeBody = (from: string, to: string) => `Status changed: ${from} → ${to}`
export const closedBody = (as: string, from: string, reason: string) => `Job closed as ${as} (from ${from}): ${reason}`
export const reopenedBody = (to: string, was: string, reason?: string | null) => `Job reopened to ${to} (was ${was}${reason ? `: ${reason}` : ''})`

const STATUS = /^Status changed: ([a-z_]+) → ([a-z_]+)$/
const CLOSED = /^Job closed as ([a-z_]+) \(from ([a-z_]+)\): ([\s\S]*)$/
const REOPENED = /^Job reopened to ([a-z_]+) \(was ([a-z_]+)(?:: ([\s\S]*))?\)$/
const known = (...codes: string[]) => codes.every((s) => (JOB_STATUSES as readonly string[]).includes(s))

export type JobEventKind = 'status_change' | 'closed' | 'reopened'

/**
 * A job_note row that records something that happened to the job, in words with stage names — or null for a note a
 * person wrote. Only the exact forms above whose codes are real stages count, so a note someone types that happens to
 * begin "Status changed:" stays their note. `label` names a stage (the company's own names, pipeline.ts); by default the
 * standard names. The stored note is always the code, so a rename reaches every old entry.
 */
export function jobEvent(body: string | null | undefined, label: (stage: string) => string = stageLabel): { kind: JobEventKind; text: string } | null {
  const b = String(body ?? '')
  let m = STATUS.exec(b)
  if (m && known(m[1], m[2])) return { kind: 'status_change', text: `Stage moved from ${label(m[1])} to ${label(m[2])}` }
  m = CLOSED.exec(b)
  if (m && known(m[1], m[2])) return { kind: 'closed', text: `Closed as ${label(m[1])} (was ${label(m[2])}): ${m[3]}` }
  m = REOPENED.exec(b)
  if (m && known(m[1], m[2])) return { kind: 'reopened', text: `Reopened at ${label(m[1])} (was ${label(m[2])}${m[3] ? `: ${m[3]}` : ''})` }
  return null
}

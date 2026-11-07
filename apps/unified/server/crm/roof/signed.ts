// A roofing job is Signed when its homeowner signs its proposal — not when someone remembers to press Advance (roofing live test
// 11/07: Hank signed Better for $9,500 and ROOF-0001 stayed at Inspection Scheduled, so Reports said 0 signed and a 0% close rate).
//
// Called after a quote is approved, by every door that approves one (the office marking it approved, the homeowner signing it
// from its private link or their portal) — server/modules/crm.ts afterApproval. It looks at the job the proposal was written for
// (quote.job_id) and, if that job is still being sold (any stage before Signed), moves it to Signed and does what Advance does
// there: a note on the job, the stage's text where it has one, the stage's after-steps and the commissions that wait for a signed
// contract. A job already Signed or further on, or closed (lost, cancelled), is left exactly as it is: nothing ever moves back.
import { and, eq } from 'drizzle-orm'
import { job, jobNote, quote, user } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import { statusChangeBody } from './jobRecord.ts'
import { AUTO_SMS, createStageEffects } from './stageEffects.ts'
import { PIPELINE_STATUSES } from './validation.ts'
import { createRoofCommissions } from './commissions.ts'

const SIGNED = 'signed'
/** The stages a job is still being sold in: every pipeline stage before Signed. */
export const BEFORE_SIGNED = PIPELINE_STATUSES.slice(0, (PIPELINE_STATUSES as readonly string[]).indexOf(SIGNED)) as readonly string[]

export function createRoofSigner(d: CrmDeps) {
  const { db } = d
  const { stageReached, textHomeowner } = createStageEffects(d)
  const commissions = createRoofCommissions(d)

  async function noteAuthor(companyId: string, row: any): Promise<string | null> {
    if (row.assignedSalesRepId) return row.assignedSalesRepId as string
    const [owner] = await db.select({ id: user.id }).from(user).where(and(eq(user.companyId, companyId), eq(user.role, 'owner'))).limit(1)
    return owner?.id ?? null
  }

  /** Returns true when this call moved the job to Signed. Idempotent: a second approval moves nothing. */
  async function signIfApproved(companyId: string, quoteId: string): Promise<boolean> {
    const [q] = await db.select({ jobId: quote.jobId, status: quote.status, number: quote.number }).from(quote)
      .where(and(eq(quote.id, quoteId), eq(quote.companyId, companyId))).limit(1)
    if (!q?.jobId || q.status !== 'approved') return false
    const [row] = await db.select().from(job).where(and(eq(job.id, q.jobId), eq(job.companyId, companyId))).limit(1)
    if (!row || !BEFORE_SIGNED.includes(String(row.status))) return false
    // The status check is in the write, so two approvals landing together move the job once.
    const [moved] = await db.update(job).set({ status: SIGNED, updatedAt: new Date() } as any)
      .where(and(eq(job.id, row.id), eq(job.companyId, companyId), eq(job.status, row.status))).returning()
    if (!moved) return false
    const author = await noteAuthor(companyId, row)
    if (author) {
      await db.insert(jobNote).values([
        { companyId, jobId: row.id, userId: author, isInternal: true, body: statusChangeBody(row.status, SIGNED) },
        { companyId, jobId: row.id, userId: author, isInternal: true, body: `Proposal ${q.number} was approved, so this job was moved to Signed automatically.` },
      ] as any)
    }
    if (AUTO_SMS[SIGNED]) { try { await textHomeowner(companyId, row, SIGNED) } catch { /* a text that can't go never holds up the job */ } }
    await stageReached(companyId, row.id, SIGNED)
    try { await commissions.earnForJob(companyId, row.id) } catch (err) { d.logger?.warn?.('[roof] commission not earned', { error: (err as Error).message }) }
    return true
  }

  return { signIfApproved }
}

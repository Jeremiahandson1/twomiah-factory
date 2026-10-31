// What a roof job is worth once the homeowner has chosen: a proposal with Good / Better / Best options is signed for the
// options PICKED — one of every pick-one set, the add-ons ticked — and that price (the quote's total without tax, as
// convert-to-job counts a job's value) becomes the job's estimated value. The quote's own total already is the picks'
// (packages/tenant-backend invoicing/quoteOptions.ts), so billing and the quote's "quoted value" follow without this; this
// keeps the job's own figure in step when the proposal was written for a job that already existed (quote.job_id). A quote
// without options leaves its job alone, as before.
import { and, eq } from 'drizzle-orm'
import { job, quote, quoteProposalOption } from '../../db/schema/index.ts'

export async function syncJobValueFromProposal(db: any, companyId: string, quoteId: string): Promise<{ jobId: string; value: string } | null> {
  const [q] = await db.select().from(quote).where(and(eq(quote.id, quoteId), eq(quote.companyId, companyId))).limit(1)
  if (!q?.jobId || q.status !== 'approved') return null
  // A proposal with only add-on options is signed with none of them ticked just as well: the job is worth what was signed.
  const options = await db.select({ chosen: quoteProposalOption.chosen }).from(quoteProposalOption).where(eq(quoteProposalOption.quoteId, quoteId))
  if (!options.length) return null
  const value = (Math.round((Number(q.total || 0) - Number(q.taxAmount || 0)) * 100) / 100).toFixed(2)
  await db.update(job).set({ estimatedValue: value, updatedAt: new Date() }).where(and(eq(job.id, q.jobId), eq(job.companyId, companyId)))
  return { jobId: q.jobId, value }
}

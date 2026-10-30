// A roofing job is Collected when its homeowner has paid the bill — not when someone remembers to press Advance.
//
// Called after money lands on an invoice, from both places it can: a payment typed in on the screen (the invoice routes'
// afterMoney) and a card or bank payment on the business's own Stripe (the Stripe service's afterInvoicePayment). It looks
// at the job the invoice belongs to and, if that job is waiting to be paid (stage Invoiced) and every invoice that went
// out on it is now paid in full, moves it to Collected and does what Advance does there: a note on the job, the "payment
// received" text, and the review request. A deposit invoice paid while the job is still being sold or built moves nothing.
import { and, eq } from 'drizzle-orm'
import { invoice, job, jobNote, user } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import { statusChangeBody } from './jobRecord.ts'
import { AUTO_SMS, createStageEffects } from './stageEffects.ts'

/** The stage a job waits in for its money, and the stage it is in once paid. */
const WAITING = 'invoiced'
const PAID = 'collected'
/** An invoice that never went out (draft) or was cancelled (void) does not have to be paid for the job to be. */
const NOT_BILLED = ['draft', 'void']

export function createRoofCollector(d: CrmDeps) {
  const { db } = d
  const { stageReached, textHomeowner } = createStageEffects(d)

  /** Whose name an automatic note goes under (job_note needs a person): the job's sales rep, else the company's owner. */
  async function noteAuthor(companyId: string, row: any): Promise<string | null> {
    if (row.assignedSalesRepId) return row.assignedSalesRepId as string
    const [owner] = await db.select({ id: user.id }).from(user).where(and(eq(user.companyId, companyId), eq(user.role, 'owner'))).limit(1)
    return owner?.id ?? null
  }

  /** Returns true when this call moved the job to Collected. Idempotent: a second call (a retried webhook) moves nothing. */
  async function collectIfPaid(invoiceId: string): Promise<boolean> {
    const [inv] = await db.select({ companyId: invoice.companyId, jobId: invoice.jobId }).from(invoice).where(eq(invoice.id, invoiceId)).limit(1)
    if (!inv?.jobId) return false
    const [row] = await db.select().from(job).where(and(eq(job.id, inv.jobId), eq(job.companyId, inv.companyId))).limit(1)
    if (!row || row.status !== WAITING) return false

    const billed = await db.select({ id: invoice.id, status: invoice.status }).from(invoice)
      .where(and(eq(invoice.companyId, inv.companyId), eq(invoice.jobId, row.id)))
    const issued = billed.filter((i: any) => !NOT_BILLED.includes(String(i.status)))
    if (issued.length === 0 || issued.some((i: any) => i.status !== 'paid')) return false

    // The status check is in the write, so two payments landing together move the job once, and a job the office has
    // already moved, closed or reopened is left as it is.
    const [moved] = await db.update(job).set({ status: PAID, updatedAt: new Date() } as any)
      .where(and(eq(job.id, row.id), eq(job.companyId, inv.companyId), eq(job.status, WAITING))).returning()
    if (!moved) return false

    const author = await noteAuthor(inv.companyId, row)
    if (author) {
      // The stage change in its stored form (the timeline reads it: jobRecord.ts STATUS), then why, as a note of its own.
      await db.insert(jobNote).values([
        { companyId: inv.companyId, jobId: row.id, userId: author, isInternal: true, body: statusChangeBody(WAITING, PAID) },
        { companyId: inv.companyId, jobId: row.id, userId: author, isInternal: true, body: 'Every invoice on this job is paid in full, so it was moved to Collected automatically.' },
      ] as any)
    }
    if (AUTO_SMS[PAID]) { try { await textHomeowner(inv.companyId, row, PAID) } catch { /* a text that can't go never holds up the job */ } }
    await stageReached(inv.companyId, row.id, PAID)
    return true
  }

  return { collectIfPaid }
}

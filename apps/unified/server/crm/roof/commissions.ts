// A roofing rep is paid when the job is paid: the commission a plan owes the job's SELLER, worked out once, on the whole job,
// at Collected.
//
// The shared earner (packages/tenant-backend commissions.ts createCommissionEarner) pays invoice by invoice, to the person
// ASSIGNED the job or the one who BOOKED it. A roof does not fit that, three ways:
//   · its seller is job.assignedSalesRepId — assigned_to_id is a crew's slot and created_by_id is whoever typed the lead in;
//   · a roof is billed in parts (a deposit, the balance, a supplement) and a rep's commission is on the contract, not on
//     each part, and not before the job is paid (a rep is not owed on a deposit for a job that then collapses);
//   · a % of GROSS PROFIT needs the job's costs, which the shared earner cannot know (it refuses margin plans outright).
// So a plan that pays 'job_sales_rep' (COMMISSION_AUTO_EARN_SALES_REP) is paid here, when the job is Collected — every invoice
// that went out is paid in full — on the numbers job costing shows (crm/field/jobCostingService.ts):
//   · % of the invoice, tiered, or flat — worked out on the contract: everything invoiced on the job, before sales tax;
//   · % of margin — worked out on the job's gross profit: that contract less what the job cost, which is the job's material
//     orders, its crew's pay, hours clocked, expenses and vendor bills (roof/jobCosts.ts). A job that made nothing earns
//     nothing on a margin plan (no row is made).
// It is called from the two ways a job gets there: money arriving on one of its invoices (roof/index.ts, after the job is
// moved to Collected) and the office moving the job to Collected by hand (jobs.ts Advance / the job form). One commission
// per plan per job, however often it is called: it hangs on the job's last-paid invoice under the shared earner's unique
// index (commission_auto_once) and is looked for before it is written. A voided or cancelled one is not made again.
//
// Costs entered AFTER Collected do not change a commission already earned — void it and record the corrected one by hand.
// A refund in full of the invoice it hangs on cancels it (the shared earner's refund handling); a refund of an earlier
// invoice does not.
import { and, asc, eq, ne } from 'drizzle-orm'
import { commission, commissionPlan, invoice, job, user } from '../../db/schema/index.ts'
import { commissionFor, planPaysPerson, COMMISSION_AUTO_EARN_SALES_REP } from '@twomiah/tenant-backend'
import type { CrmDeps } from '../deps.ts'
import { createJobCostingService } from '../field/jobCostingService.ts'

/** Not a bill the homeowner owes: a draft that never went out, a void one. Collected's own rule (collected.ts). */
const NOT_BILLED = ['draft', 'void']
const round2 = (n: number) => Math.round(n * 100) / 100
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function createRoofCommissions(d: CrmDeps) {
  const { db } = d
  const costing = createJobCostingService(d)

  /** Pay the job's sales rep what each of the company's plans owes. Returns how many commissions were made. */
  async function earnForJob(companyId: string, jobId: string): Promise<number> {
    const [row] = await db.select().from(job).where(and(eq(job.id, jobId), eq(job.companyId, companyId))).limit(1)
    if (!row || row.status !== 'collected' || !row.assignedSalesRepId) return 0
    if (!(await d.features.isFeatureEnabled(companyId, 'commission_tracking'))) return 0

    const [rep] = await db.select({ id: user.id, isActive: user.isActive }).from(user)
      .where(and(eq(user.id, row.assignedSalesRepId), eq(user.companyId, companyId))).limit(1)
    if (!rep || rep.isActive === false) return 0

    // Paid in full: every invoice that went out is paid. The last one paid is the anchor the commission hangs on.
    const billed = await db.select().from(invoice)
      .where(and(eq(invoice.companyId, companyId), eq(invoice.jobId, jobId), ne(invoice.status, 'void')))
      .orderBy(asc(invoice.paidAt), asc(invoice.id))
    const issued = billed.filter((i: any) => !NOT_BILLED.includes(String(i.status)))
    if (!issued.length || issued.some((i: any) => i.status !== 'paid')) return 0
    const anchor = issued[issued.length - 1]
    const paidAt = new Date(anchor.paidAt || row.updatedAt || Date.now())

    const plans = (await db.select().from(commissionPlan).where(and(eq(commissionPlan.companyId, companyId), eq(commissionPlan.isActive, true))))
    const paying = plans.filter((p: any) =>
      p.autoEarn === COMMISSION_AUTO_EARN_SALES_REP && p.autoSince && new Date(p.autoSince) <= paidAt
      && (!p.effectiveFrom || new Date(p.effectiveFrom) <= paidAt) && (!p.effectiveTo || new Date(p.effectiveTo) >= paidAt)
      && planPaysPerson(p, rep.id, plans))
    if (!paying.length) return 0

    // The numbers on the job-costing screen: the contract (invoiced before tax) and what the job cost.
    const { byJob } = await costing.attributeRevenue(companyId, [{ id: jobId, quoteId: row.quoteId, projectId: row.projectId }])
    const costs = (await costing.costsByJob(companyId, [jobId])).get(jobId)
    const contract = round2(byJob.get(jobId)?.revenue ?? 0)
    const profit = round2(contract - (costs?.totalCost ?? 0))

    let made = 0
    for (const plan of paying) {
      const already = await db.select({ id: commission.id }).from(commission)
        .where(and(eq(commission.companyId, companyId), eq(commission.jobId, jobId), eq(commission.planId, plan.id), eq(commission.userId, rep.id), eq(commission.source, 'auto'))).limit(1)
      if (already.length) continue
      const onProfit = plan.planType === 'percent_of_margin'
      const base = onProfit ? profit : contract
      if (base <= 0) continue
      const result = commissionFor(plan, base)
      if ('error' in result) continue
      const rows = await db.insert(commission).values({
        companyId, planId: plan.id, userId: rep.id, jobId, invoiceId: anchor.id,
        baseAmount: String(base), rateApplied: result.rate !== null ? String(result.rate) : null,
        commissionAmount: String(result.amount), earnedAt: paidAt, source: 'auto',
        notes: onProfit
          ? `Earned automatically when ${row.number || 'the job'} was paid in full: gross profit ${usd(profit)} (${usd(contract)} invoiced less ${usd(round2(contract - profit))} cost)`
          : `Earned automatically when ${row.number || 'the job'} was paid in full: the contract, ${usd(contract)} before tax`,
      } as any).onConflictDoNothing().returning({ id: commission.id })
      made += rows.length
    }
    return made
  }

  /** The step run after money lands on an invoice: the rep of that invoice's job, once the job is Collected. */
  async function earnForInvoice(invoiceId: string): Promise<number> {
    const [inv] = await db.select({ companyId: invoice.companyId, jobId: invoice.jobId }).from(invoice).where(eq(invoice.id, invoiceId)).limit(1)
    if (!inv?.jobId) return 0
    return earnForJob(inv.companyId, inv.jobId)
  }

  return { earnForJob, earnForInvoice }
}

export type RoofCommissions = ReturnType<typeof createRoofCommissions>

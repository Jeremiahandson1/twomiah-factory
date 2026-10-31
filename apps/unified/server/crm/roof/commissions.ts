// A roofing job's people are paid when the job is paid: the commission a plan owes the job's SELLER and the other people named on it
// — estimator, canvasser, office, production manager, sales manager — worked out once, on the whole job, at Collected.
//
// The shared earner (packages/tenant-backend commissions.ts createCommissionEarner) pays invoice by invoice, to the person
// ASSIGNED the job or the one who BOOKED it. A roof does not fit that, three ways:
//   · its seller is job.assignedSalesRepId — assigned_to_id is a crew's slot and created_by_id is whoever typed the lead in; the
//     others are named on the job for a role (job_person, ./jobPeople.ts);
//   · a roof is billed in parts (a deposit, the balance, a supplement) and a rep's commission is on the contract, not on
//     each part, and not before the job is paid (a rep is not owed on a deposit for a job that then collapses);
//   · a % of GROSS PROFIT needs the job's costs, which the shared earner cannot know (it refuses margin plans outright).
// So a plan that pays a job role ('job_sales_rep', 'job_estimator' … COMMISSION_AUTO_EARN_JOB_ROLES; one role per plan) is paid
// here, when the job is Collected — every invoice that went out is paid in full — on the numbers job costing shows
// (crm/field/jobCostingService.ts):
//   · each plan names what its rate is MEASURED ON (commission_plan.measured_on, commissions.ts measuredOnOf): the contract
//     (AccuLynx's total sales) — everything invoiced on the job, before sales tax; the job's gross profit — that contract less what
//     the job cost, which is the job's material orders, its crew's pay, hours clocked, expenses and vendor bills (roof/jobCosts.ts);
//     or its net profit — the gross profit less the commissions the job's other plans have paid out, so a manager's override can be
//     on what the job kept after the rep was paid. Net-profit plans are worked out LAST and read only the other plans' commissions,
//     so no plan is ever worked out on a profit it has itself reduced. A percentage and the brackets of a tiered plan are both read
//     against that figure, so "5% of the first $5,000 of profit, 8% above" is a plan (AccuLynx: rates by job-profit threshold). A
//     "% of margin" plan is on gross profit whatever it says. A flat amount ignores it. A job that made nothing earns nothing on a
//     profit plan (no row is made).
//   · every person holding the plan's role on the job whom the plan pays (planPaysPerson) earns it; a person who has left the team
//     does not.
// It is called from the two ways a job gets there: money arriving on one of its invoices (roof/index.ts, after the job is
// moved to Collected) and the office moving the job to Collected by hand (jobs.ts Advance / the job form), and when someone is added
// to a job that is already paid. One commission per plan per person per job, however often it is called: it hangs on the job's
// last-paid invoice under the shared earner's unique index (commission_auto_once) and is looked for before it is written. A voided
// or cancelled one is not made again.
//
// A company MINIMUM PROFIT (roof_money_setting, ./moneySettings.ts) — a share of the contract or dollars of gross profit — holds
// every plan: a job under it earns nothing until its figures clear it.
//
// Costs entered AFTER Collected do not change a commission already earned — void it and record the corrected one by hand.
// A refund in full of the invoice it hangs on cancels it (the shared earner's refund handling); a refund of an earlier
// invoice does not.
import { and, asc, eq, inArray, ne, notInArray } from 'drizzle-orm'
import { commission, commissionPlan, invoice, job, jobPerson, user } from '../../db/schema/index.ts'
import { commissionFor, jobRoleOfAutoEarn, measuredOnOf, planPaysPerson, COMMISSION_JOB_ROLE_WORDS, type CommissionJobRole } from '@twomiah/tenant-backend'
import type { CrmDeps } from '../deps.ts'
import { createJobCostingService } from '../field/jobCostingService.ts'
import { createRoofMoneySettings, type MinProfit } from './moneySettings.ts'

/** Not a bill the homeowner owes: a draft that never went out, a void one. Collected's own rule (collected.ts). */
const NOT_BILLED = ['draft', 'void']
const round2 = (n: number) => Math.round(n * 100) / 100
const ROLE_WORDS: Record<string, string> = Object.fromEntries(Object.entries(COMMISSION_JOB_ROLE_WORDS).map(([k, v]) => [k, v.toLowerCase()]))
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Is the job's profit under the company's floor? Percent is of the contract, dollars are of the gross profit. */
export function belowMinimumProfit(floor: MinProfit | null, contract: number, profit: number): boolean {
  if (!floor) return false
  if (floor.kind === 'percent') return contract <= 0 || (profit / contract) * 100 < floor.value
  return profit < floor.value
}

export function createRoofCommissions(d: CrmDeps) {
  const { db } = d
  const costing = createJobCostingService(d)
  const moneySettings = createRoofMoneySettings(d)

  /** Who holds each role on the job: the seller is the job's sales rep, the others are named on it (job_person). */
  async function peopleOf(companyId: string, row: any): Promise<Map<CommissionJobRole, string[]>> {
    const out = new Map<CommissionJobRole, string[]>()
    if (row.assignedSalesRepId) out.set('sales_rep', [row.assignedSalesRepId])
    const named = await db.select({ userId: jobPerson.userId, role: jobPerson.role }).from(jobPerson)
      .where(and(eq(jobPerson.companyId, companyId), eq(jobPerson.jobId, row.id))).orderBy(asc(jobPerson.createdAt), asc(jobPerson.id))
    for (const n of named as any[]) {
      const role = n.role as CommissionJobRole
      out.set(role, [...(out.get(role) || []), n.userId])
    }
    return out
  }

  /** What the job's other plans have already paid out: every live commission on it that is not on a net-profit plan. */
  async function paidOutByOthers(companyId: string, jobId: string, plans: any[]): Promise<number> {
    const rows = await db.select({ planId: commission.planId, amount: commission.commissionAmount }).from(commission)
      .where(and(eq(commission.companyId, companyId), eq(commission.jobId, jobId), notInArray(commission.status, ['void', 'cancelled'])))
    const byId = new Map(plans.map((p) => [p.id, p]))
    return round2((rows as any[]).reduce((sum, r) => {
      const p = r.planId ? byId.get(r.planId) : null
      return p && measuredOnOf(p) === 'net_profit' ? sum : sum + Number(r.amount || 0)
    }, 0))
  }

  /** Pay every person the company's plans owe on this job. Returns how many commissions were made. */
  async function earnForJob(companyId: string, jobId: string): Promise<number> {
    const [row] = await db.select().from(job).where(and(eq(job.id, jobId), eq(job.companyId, companyId))).limit(1)
    if (!row || row.status !== 'collected') return 0
    if (!(await d.features.isFeatureEnabled(companyId, 'commission_tracking'))) return 0

    const people = await peopleOf(companyId, row)
    const everyone = [...new Set([...people.values()].flat())]
    if (!everyone.length) return 0
    const live = await db.select({ id: user.id, isActive: user.isActive }).from(user)
      .where(and(eq(user.companyId, companyId), inArray(user.id, everyone)))
    const active = new Set((live as any[]).filter((u) => u.isActive !== false).map((u) => u.id))
    if (!active.size) return 0

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
      jobRoleOfAutoEarn(p.autoEarn) && p.autoSince && new Date(p.autoSince) <= paidAt
      && (!p.effectiveFrom || new Date(p.effectiveFrom) <= paidAt) && (!p.effectiveTo || new Date(p.effectiveTo) >= paidAt)
      && (people.get(jobRoleOfAutoEarn(p.autoEarn)!) || []).some((id) => active.has(id)))
    if (!paying.length) return 0

    // The numbers on the job-costing screen: the contract (invoiced before tax) and what the job cost.
    const { byJob } = await costing.attributeRevenue(companyId, [{ id: jobId, quoteId: row.quoteId, projectId: row.projectId }])
    const costs = (await costing.costsByJob(companyId, [jobId])).get(jobId)
    const contract = round2(byJob.get(jobId)?.revenue ?? 0)
    const profit = round2(contract - (costs?.totalCost ?? 0))

    // The company's minimum profit (roof_money_setting): a job that kept less than the floor pays no plan at all. It is looked at
    // again whenever the job is followed up, so a job held under the floor pays once its figures clear it.
    if (belowMinimumProfit((await moneySettings.read(companyId)).minProfit, contract, profit)) return 0

    // Plans measured on net profit go last: their figure is the gross profit less what the other plans pay out, so nothing is ever
    // worked out on a profit it has itself reduced.
    const ordered = [...paying].sort((a: any, b: any) => Number(measuredOnOf(a) === 'net_profit') - Number(measuredOnOf(b) === 'net_profit'))
    let made = 0
    for (const plan of ordered) {
      const role = jobRoleOfAutoEarn(plan.autoEarn)!
      const basis = measuredOnOf(plan)
      const net = basis === 'net_profit' ? round2(profit - (await paidOutByOthers(companyId, jobId, plans))) : null
      const base = basis === 'net_profit' ? net! : basis === 'gross_profit' ? profit : contract
      for (const personId of people.get(role) || []) {
        if (!active.has(personId) || !planPaysPerson(plan, personId, plans)) continue
        const already = await db.select({ id: commission.id }).from(commission)
          .where(and(eq(commission.companyId, companyId), eq(commission.jobId, jobId), eq(commission.planId, plan.id), eq(commission.userId, personId), eq(commission.source, 'auto'))).limit(1)
        if (already.length) continue
        if (base <= 0) continue
        const result = commissionFor(plan, base)
        if ('error' in result) continue
        const when = `when ${row.number || 'the job'} was paid in full${role === 'sales_rep' ? '' : ` as the ${ROLE_WORDS[role]}`}`
        const rows = await db.insert(commission).values({
          companyId, planId: plan.id, userId: personId, jobId, invoiceId: anchor.id,
          baseAmount: String(base), rateApplied: result.rate !== null ? String(result.rate) : null,
          commissionAmount: String(result.amount), earnedAt: paidAt, source: 'auto',
          notes: basis === 'net_profit'
            ? `Earned automatically ${when}: net profit ${usd(net!)} (gross profit ${usd(profit)} less ${usd(round2(profit - net!))} paid out to the others)`
            : basis === 'gross_profit'
              ? `Earned automatically ${when}: gross profit ${usd(profit)} (${usd(contract)} invoiced less ${usd(round2(contract - profit))} cost)`
              : `Earned automatically ${when}: the contract, ${usd(contract)} before tax`,
        } as any).onConflictDoNothing().returning({ id: commission.id })
        made += rows.length
      }
    }
    return made
  }

  /** The step run after money lands on an invoice: the people of that invoice's job, once the job is Collected. */
  async function earnForInvoice(invoiceId: string): Promise<number> {
    const [inv] = await db.select({ companyId: invoice.companyId, jobId: invoice.jobId }).from(invoice).where(eq(invoice.id, invoiceId)).limit(1)
    if (!inv?.jobId) return 0
    return earnForJob(inv.companyId, inv.jobId)
  }

  return { earnForJob, earnForInvoice }
}

export type RoofCommissions = ReturnType<typeof createRoofCommissions>

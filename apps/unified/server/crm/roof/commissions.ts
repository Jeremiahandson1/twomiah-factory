// A roofing job's people are paid when the job is paid: the commission a plan owes the job's SELLER and the other people named on it
// — estimator, canvasser, office, production manager, sales manager — worked out once, on the whole job, when the plan is ready.
//
// The shared earner (packages/tenant-backend commissions.ts createCommissionEarner) pays invoice by invoice, to the person
// ASSIGNED the job or the one who BOOKED it. A roof does not fit that, three ways:
//   · its seller is job.assignedSalesRepId — assigned_to_id is a crew's slot and created_by_id is whoever typed the lead in; the
//     others are named on the job for a role (job_person, ./jobPeople.ts);
//   · a roof is billed in parts (a deposit, the balance, a supplement) and a rep's commission is on the contract, not on
//     each part, and not before the job is paid (a rep is not owed on a deposit for a job that then collapses);
//   · a % of GROSS PROFIT needs the job's costs, which the shared earner cannot know (it refuses margin plans outright).
// So a plan that pays a job role ('job_sales_rep', 'job_estimator' … COMMISSION_AUTO_EARN_JOB_ROLES; one role per plan) is paid
// here, on the numbers job costing shows (crm/field/jobCostingService.ts). WHEN is the plan's trigger (commission_plan.trigger_on,
// AccuLynx's "ready to request"): Approved (the contract is signed), Completed (final inspection), Invoiced, or — the default, what
// every plan did — Collected: every invoice that went out is paid in full. An earlier trigger may add "only at a $0 balance" (every
// invoice that went out is paid). A plan measured on profit, or any plan while the company holds a minimum profit, waits for
// Completed at the earliest, because the costs are not known before. An earlier trigger applies to jobs started after the plan was
// switched on (effectiveTrigger); an older job waits to be paid. The contract before the job is paid is what was billed so far or
// the signed contract, whichever is more, worked out once:
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
import { commission, commissionPlan, invoice, job, jobPerson, quote, user } from '../../db/schema/index.ts'
import { commissionFor, jobRoleOfAutoEarn, measuredOnOf, planPaysPerson, COMMISSION_JOB_ROLE_WORDS, COMMISSION_TRIGGERS, type CommissionJobRole, type CommissionTrigger } from '@twomiah/tenant-backend'
import type { CrmDeps } from '../deps.ts'
import { createJobCostingService } from '../field/jobCostingService.ts'
import { createRoofMoneySettings, type MinProfit } from './moneySettings.ts'
import { PIPELINE_STATUSES } from './validation.ts'

/** Not a bill the homeowner owes: a draft that never went out, a void one. Collected's own rule (collected.ts). */
const NOT_BILLED = ['draft', 'void']
const round2 = (n: number) => Math.round(n * 100) / 100
const ROLE_WORDS: Record<string, string> = Object.fromEntries(Object.entries(COMMISSION_JOB_ROLE_WORDS).map(([k, v]) => [k, v.toLowerCase()]))
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** The job stage each trigger waits for (roofing's stage keys — never renamed; the company's own names are display only). */
export const TRIGGER_STAGE: Record<CommissionTrigger, string> = { approved: 'signed', completed: 'final_inspection', invoiced: 'invoiced', collected: 'collected' }
const TRIGGER_WORDS: Record<CommissionTrigger, string> = { approved: 'Approved', completed: 'Completed', invoiced: 'Invoiced', collected: 'Collected' }
/** A stage's place in the pipeline; -1 for a job that is lost or cancelled (no pipeline stage), so nothing is earned on it. */
const stageIndex = (stage: string) => (PIPELINE_STATUSES as readonly string[]).indexOf(stage)
export const stageReachedBy = (status: string, stage: string) => stageIndex(status) >= 0 && stageIndex(status) >= stageIndex(stage)
/**
 * The trigger a plan really waits for on THIS job. An earlier trigger applies to jobs started after the plan was switched on — a job
 * that was already past Approved then must not be paid for a stage it passed before there was a plan — so an older job waits for the
 * job to be paid, as every plan did.
 */
export function effectiveTrigger(plan: { triggerOn?: unknown; autoSince?: unknown }, jobRow: { createdAt?: unknown }): CommissionTrigger {
  const t = (COMMISSION_TRIGGERS as readonly string[]).includes(String(plan.triggerOn)) ? (plan.triggerOn as CommissionTrigger) : 'collected'
  if (t !== 'collected' && plan.autoSince && jobRow.createdAt && new Date(jobRow.createdAt as any) < new Date(plan.autoSince as any)) return 'collected'
  return t
}

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

  /** What the person has drawn in advance on this plan for this job: live draws (void and cancelled ones are not). */
  async function drawnBy(companyId: string, jobId: string, planId: string, userId: string): Promise<number> {
    const rows = await db.select({ amount: commission.commissionAmount }).from(commission)
      .where(and(eq(commission.companyId, companyId), eq(commission.jobId, jobId), eq(commission.planId, planId), eq(commission.userId, userId),
        eq(commission.source, 'draw'), notInArray(commission.status, ['void', 'cancelled'])))
    return round2((rows as any[]).reduce((sum, r) => sum + Number(r.amount || 0), 0))
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

  /** What the signed contract is worth before tax: the job's quote less its tax, else the job's own value. */
  async function signedValue(companyId: string, row: any): Promise<number> {
    if (row.quoteId) {
      const [qt] = await db.select({ total: quote.total, taxAmount: quote.taxAmount }).from(quote).where(and(eq(quote.id, row.quoteId), eq(quote.companyId, companyId))).limit(1)
      if (qt) return round2(Number(qt.total || 0) - Number(qt.taxAmount || 0))
    }
    return round2(Number(row.estimatedValue || 0))
  }

  /** Pay every person the company's plans owe on this job, for each plan that is ready. Returns how many commissions were made. */
  async function earnForJob(companyId: string, jobId: string): Promise<number> {
    const [row] = await db.select().from(job).where(and(eq(job.id, jobId), eq(job.companyId, companyId))).limit(1)
    if (!row || stageIndex(row.status) < 0) return 0
    if (!(await d.features.isFeatureEnabled(companyId, 'commission_tracking'))) return 0

    const people = await peopleOf(companyId, row)
    const everyone = [...new Set([...people.values()].flat())]
    if (!everyone.length) return 0
    const live = await db.select({ id: user.id, isActive: user.isActive }).from(user)
      .where(and(eq(user.companyId, companyId), inArray(user.id, everyone)))
    const active = new Set((live as any[]).filter((u) => u.isActive !== false).map((u) => u.id))
    if (!active.size) return 0

    // Paid in full: every invoice that went out is paid. The last one paid is the anchor a Collected commission hangs on.
    const billed = await db.select().from(invoice)
      .where(and(eq(invoice.companyId, companyId), eq(invoice.jobId, jobId), ne(invoice.status, 'void')))
      .orderBy(asc(invoice.paidAt), asc(invoice.id))
    const issued = billed.filter((i: any) => !NOT_BILLED.includes(String(i.status)))
    const paidInFull = issued.length > 0 && issued.every((i: any) => i.status === 'paid')
    const anchor = paidInFull ? issued[issued.length - 1] : null
    const paidAt = anchor ? new Date(anchor.paidAt || row.updatedAt || Date.now()) : null
    const now = new Date()

    const settings = await moneySettings.read(companyId)
    const plans = (await db.select().from(commissionPlan).where(and(eq(commissionPlan.companyId, companyId), eq(commissionPlan.isActive, true))))

    // A plan is ready when its trigger stage has been reached (and, for Paid or a $0-balance plan, every invoice that went out is
    // paid), it is inside its dates, and — if its figure is a profit, or the company holds a minimum profit — the work is done, so
    // the job's costs are known.
    const readyPlans = plans.flatMap((p: any) => {
      const role = jobRoleOfAutoEarn(p.autoEarn)
      if (!role || !p.autoSince || !(people.get(role) || []).some((id) => active.has(id))) return []
      const trigger = effectiveTrigger(p, row)
      if (!stageReachedBy(row.status, TRIGGER_STAGE[trigger])) return []
      if ((trigger === 'collected' || p.zeroBalanceOnly) && !paidInFull) return []
      if ((measuredOnOf(p) !== 'contract' || settings.minProfit) && !stageReachedBy(row.status, TRIGGER_STAGE.completed)) return []
      const when = trigger === 'collected' ? paidAt! : now
      if (new Date(p.autoSince) > when || (p.effectiveFrom && new Date(p.effectiveFrom) > when) || (p.effectiveTo && new Date(p.effectiveTo) < when)) return []
      return [{ plan: p, role, trigger, when }]
    })
    if (!readyPlans.length) return 0

    // The numbers on the job-costing screen: the contract and what the job cost. Paid, the contract is what was invoiced before
    // tax; before that it is what was billed so far or the signed contract, whichever is more.
    const { byJob } = await costing.attributeRevenue(companyId, [{ id: jobId, quoteId: row.quoteId, projectId: row.projectId }])
    const costs = (await costing.costsByJob(companyId, [jobId])).get(jobId)
    const invoiced = round2(byJob.get(jobId)?.revenue ?? 0)
    const signed = readyPlans.some((r: { trigger: CommissionTrigger }) => r.trigger !== 'collected') ? await signedValue(companyId, row) : 0
    const cost = costs?.totalCost ?? 0

    // Plans measured on net profit go last: their figure is the gross profit less what the other plans pay out, so nothing is ever
    // worked out on a profit it has itself reduced.
    const ordered = [...readyPlans].sort((a, b) => Number(measuredOnOf(a.plan) === 'net_profit') - Number(measuredOnOf(b.plan) === 'net_profit'))
    let made = 0
    for (const { plan, role, trigger, when } of ordered) {
      const contract = trigger === 'collected' ? invoiced : Math.max(invoiced, signed)
      const profit = round2(contract - cost)
      // The company's minimum profit (roof_money_setting): a job that kept less than the floor pays no plan at all. It is looked at
      // again whenever the job is followed up, so a job held under the floor pays once its figures clear it.
      if (belowMinimumProfit(settings.minProfit, contract, profit)) continue
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
        // What this person drew in advance on this plan (./commissionDraws.ts) comes off the commission: the draw and what is made
        // now add up to the commission, never more. A draw that is as much as the commission leaves nothing more to pay.
        const drawn = await drawnBy(companyId, jobId, plan.id, personId)
        const owing = round2(result.amount - drawn)
        if (owing <= 0) continue
        const reached = trigger === 'collected' ? 'was paid in full' : `reached ${TRIGGER_WORDS[trigger as CommissionTrigger]}${plan.zeroBalanceOnly ? ' with nothing owing' : ''}`
        const sentence = `Earned automatically when ${row.number || 'the job'} ${reached}${role === 'sales_rep' ? '' : ` as the ${ROLE_WORDS[role]}`}${drawn > 0 ? `; ${usd(drawn)} already drawn, so ${usd(owing)} of the ${usd(result.amount)} commission is paid now` : ''}`
        const rows = await db.insert(commission).values({
          companyId, planId: plan.id, userId: personId, jobId, invoiceId: trigger === 'collected' ? anchor?.id ?? null : null,
          baseAmount: String(base), rateApplied: result.rate !== null ? String(result.rate) : null,
          commissionAmount: String(owing), earnedAt: when, source: 'auto', earnKey: `job:${jobId}:${plan.id}:${personId}`,
          notes: basis === 'net_profit'
            ? `${sentence}: net profit ${usd(net!)} (gross profit ${usd(profit)} less ${usd(round2(profit - net!))} paid out to the others)`
            : basis === 'gross_profit'
              ? `${sentence}: gross profit ${usd(profit)} (${usd(contract)} ${trigger === 'collected' ? 'invoiced' : 'contract'} less ${usd(round2(contract - profit))} cost)`
              : `${sentence}: the contract, ${usd(contract)} before tax`,
        } as any).onConflictDoNothing().returning({ id: commission.id })
        made += rows.length
      }
    }
    return made
  }

  /** The step run after money lands on an invoice: the people of that invoice's job, for each plan that is ready. */
  async function earnForInvoice(invoiceId: string): Promise<number> {
    const [inv] = await db.select({ companyId: invoice.companyId, jobId: invoice.jobId }).from(invoice).where(eq(invoice.id, invoiceId)).limit(1)
    if (!inv?.jobId) return 0
    return earnForJob(inv.companyId, inv.jobId)
  }

  return { earnForJob, earnForInvoice }
}

export type RoofCommissions = ReturnType<typeof createRoofCommissions>

/**
 * Job Costing — estimate vs ACTUAL cost, per job and across jobs.
 *
 * ONE COST MODEL, ONE REVENUE MODEL  (T32 B3)
 * -------------------------------------------
 * The three endpoints below used to compute cost and revenue three different ways, and all three
 * ways were wrong:
 *
 *   · Revenue was attributed by `invoice.projectId`, so every job on a project claimed the WHOLE
 *     project's invoices and the roll-up total counted each one once per job. One $11,183 invoice on
 *     a two-job project read as $22,366 invoiced.
 *   · Revenue was `invoice.total`, which includes sales tax. Tax is collected for the state and is
 *     never the company's money, so it inflated both revenue and margin.
 *   · DRAFT and VOID invoices counted as revenue, although the rest of invoicing excludes both
 *     (see `stats` in packages/tenant-backend/src/invoicing/invoices.ts).
 *   · Vendor bills — real, entered, reconcilable spend, which /api/bills/summary/job/:jobId already
 *     reported per job — never reached job costing at all, so cost was understated and profit was
 *     overstated by whatever the job had been billed.
 *   · Labour was priced at the time entry's rate in the detail and at a FLAT $50/hour in the summary
 *     and the trend, so one job had two different costs depending which screen you opened.
 *   · The roll-up's totals row covered only the page of jobs it returned — 50 by default, 100 from
 *     the screen — out of however many matched. The headline figures described a subset and said
 *     nothing about it.
 *
 * So the money is computed in exactly two places now — `costsByJob` and `attributeRevenue` — and all
 * three endpoints read from them. A figure that appears on two screens comes from one function.
 *
 * WHAT IS DELIBERATELY NOT INVENTED
 * ---------------------------------
 * Hours logged by somebody with no hourly rate on the entry and no rate on their own record cannot
 * be priced. The old code priced them at $50. This reports them as `unratedLaborHours` and prices
 * them at nothing, because a cost the system made up is worse than a cost it admits it does not
 * know — the owner can see the hours and go set the rate.
 */

import { db } from '../../db/index.ts'
import {
  job,
  contact,
  project,
  quote,
  quoteLineItem,
  // The catalogue item a quote line was priced from — read for its labor_hours, so the estimate
  // knows how long the work takes rather than only what somebody typed on the job. (T42)
  pricebookItem,
  invoice,
  timeEntry,
  // Where a person's pay rate actually lives. jobCosting used to fall back to
  // user.hourly_rate, a column nothing in the codebase writes, so labour cost read $0 on every
  // entry that had no rate stamped on it. time.ts has always priced these hours off the roster. (T42)
  teamMember,
  inventoryUsage,
  inventoryItem,
  expense,
  user,
} from '../../db/schema.ts'
import * as dbSchema from '../../db/schema.ts'
import { eq, and, gte, lte, desc, sql, inArray, notInArray, or } from 'drizzle-orm'
import { notFound } from '../utils/errors.ts'

/**
 * Accounts payable is a base-CRM feature: `vendor_bill` exists in templates/crm and in no other
 * vertical, because only the contractor CRM sells AP.
 *
 * So the bill component is present when the table is and absent when it is not, and all four
 * templates that ship job costing run ONE implementation. Keeping a second, bill-free version of
 * this file is exactly how crm-basic, crm-fieldservice and crm-landscaping came to hold a
 * byte-identical copy of every fault listed above.
 */
const vendorBillTable: any = (dbSchema as any).vendorBill ?? null

/**
 * Statuses that are not revenue: a draft has not been raised, and a void one never was.
 * Mirrors invoicing's own stats rule rather than inventing a second one.
 */
const NOT_REVENUE = ['draft', 'void']

/** Statuses that are spend. Mirrors /api/bills/summary/job/:jobId exactly, so the two agree. */
const BILL_IS_SPEND = ['open', 'partial', 'paid']

/**
 * The most jobs the totals will scan. The whole point of this change is that the totals describe
 * every matching job rather than one page of them, so if a tenant ever exceeds this the answer says
 * so (`totalsTruncated`) instead of quietly describing a subset again.
 */
const TOTALS_CEILING = 5000

const num = (v: unknown) => Number(v || 0)
const round2 = (n: number) => Math.round(n * 100) / 100
const round1 = (n: number) => Math.round(n * 10) / 10
const uniq = <T,>(xs: T[]) => [...new Set(xs)]

/** inArray with an empty list is a SQL error in some drivers and always a pointless query. */
const chunks = <T,>(xs: T[], size = 500): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

export interface JobCost {
  laborHours: number
  /** Hours whose rate is unknown. Counted as hours, priced at nothing, reported so it can be fixed. */
  unratedLaborHours: number
  laborCost: number
  materialCost: number
  expenseCost: number
  subcontractorCost: number
  /** Vendor bills raised against the job, excluding void ones. */
  billedCost: number
  totalCost: number
}

const EMPTY_COST: JobCost = {
  laborHours: 0, unratedLaborHours: 0, laborCost: 0, materialCost: 0,
  expenseCost: 0, subcontractorCost: 0, billedCost: 0, totalCost: 0,
}

/**
 * Actual cost per job, from every ledger that holds job cost: time entries priced at the rate that
 * applies, inventory drawn against the job, expenses, and vendor bills.
 *
 * Set-based and grouped, so a hundred jobs is four queries rather than two hundred.
 */
export async function costsByJob(companyId: string, jobIds: string[]): Promise<Map<string, JobCost>> {
  const out = new Map<string, JobCost>()
  for (const id of jobIds) out.set(id, { ...EMPTY_COST })
  if (!jobIds.length) return out

  for (const ids of chunks(jobIds)) {
    /**
     * The rate that applies, in the order the detail view has always used it: the rate recorded on
     * the entry, else the person's own rate. COALESCE in SQL rather than in JavaScript so the
     * grouped sum and the per-row detail cannot drift apart.
     */
    const rate = sql`COALESCE(${timeEntry.hourlyRate}, ${user.hourlyRate}, NULLIF(${teamMember.hourlyRate}, 0))`
    const labour = await db.select({
      jobId: timeEntry.jobId,
      hours: sql<string>`COALESCE(SUM(${timeEntry.hours}), 0)`,
      cost: sql<string>`COALESCE(SUM(${timeEntry.hours} * COALESCE(${rate}, 0)), 0)`,
      unratedHours: sql<string>`COALESCE(SUM(CASE WHEN ${rate} IS NULL THEN ${timeEntry.hours} ELSE 0 END), 0)`,
    })
      .from(timeEntry)
      .leftJoin(user, eq(timeEntry.userId, user.id))
      .leftJoin(teamMember, and(eq(teamMember.companyId, companyId), sql`lower(${teamMember.email}) = lower(${user.email})`))
      .where(and(eq(timeEntry.companyId, companyId), inArray(timeEntry.jobId, ids)))
      .groupBy(timeEntry.jobId)

    const materials = await db.select({
      jobId: inventoryUsage.jobId,
      cost: sql<string>`COALESCE(SUM(${inventoryUsage.quantity} * COALESCE(${inventoryUsage.unitCost}, ${inventoryItem.unitCost}, 0)), 0)`,
    })
      .from(inventoryUsage)
      .leftJoin(inventoryItem, eq(inventoryUsage.itemId, inventoryItem.id))
      .where(and(eq(inventoryUsage.companyId, companyId), inArray(inventoryUsage.jobId, ids)))
      .groupBy(inventoryUsage.jobId)

    const expenses = await db.select({
      jobId: expense.jobId,
      total: sql<string>`COALESCE(SUM(${expense.amount}), 0)`,
      subcontractor: sql<string>`COALESCE(SUM(CASE WHEN ${expense.category} = 'subcontractor' THEN ${expense.amount} ELSE 0 END), 0)`,
    })
      .from(expense)
      .where(and(eq(expense.companyId, companyId), inArray(expense.jobId, ids)))
      .groupBy(expense.jobId)

    const bills = vendorBillTable
      ? await db.select({
          jobId: vendorBillTable.jobId,
          billed: sql<string>`COALESCE(SUM(${vendorBillTable.amount}), 0)`,
        })
          .from(vendorBillTable)
          .where(and(
            eq(vendorBillTable.companyId, companyId),
            inArray(vendorBillTable.jobId, ids),
            inArray(vendorBillTable.status, BILL_IS_SPEND),
          ))
          .groupBy(vendorBillTable.jobId)
      : []

    for (const r of labour) {
      const c = out.get(r.jobId as string); if (!c) continue
      c.laborHours = num(r.hours); c.laborCost = num(r.cost); c.unratedLaborHours = num(r.unratedHours)
    }
    for (const r of materials) { const c = out.get(r.jobId as string); if (c) c.materialCost = num(r.cost) }
    for (const r of expenses) {
      const c = out.get(r.jobId as string); if (!c) continue
      c.expenseCost = num(r.total); c.subcontractorCost = num(r.subcontractor)
    }
    for (const r of bills) { const c = out.get(r.jobId as string); if (c) c.billedCost = num(r.billed) }
  }

  // Subcontractor cost is a SLICE of expense cost, reported separately for the breakdown — adding it
  // again here would double-count every subcontractor invoice.
  for (const c of out.values()) {
    c.totalCost = round2(c.laborCost + c.materialCost + c.expenseCost + c.billedCost)
    c.laborCost = round2(c.laborCost); c.materialCost = round2(c.materialCost)
    c.expenseCost = round2(c.expenseCost); c.subcontractorCost = round2(c.subcontractorCost)
    c.billedCost = round2(c.billedCost)
    c.laborHours = round1(c.laborHours); c.unratedLaborHours = round1(c.unratedLaborHours)
  }
  return out
}

/** The minimum a job has to tell us for revenue to be attributable to it. */
export interface JobKey { id: string; quoteId: string | null; projectId: string | null }

interface InvoiceLite {
  id: string; number: string; status: string
  total: number; taxAmount: number; amountPaid: number; amountRefunded: number
  projectId: string | null; quoteId: string | null
}
/** Revenue is ex-tax: the tax line is the state's money passing through. */
const revenueOf = (inv: InvoiceLite) => inv.total - inv.taxAmount

export interface JobRevenue {
  /** Invoices raised against this job's own quote. Nobody else's. */
  directRevenue: number
  /** Project invoices that belong to no single job, shown on each job of the project. */
  sharedRevenue: number
  revenue: number
  salesTax: number
  /** Cash in, gross — a payment arrives with the tax in it. */
  collected: number
  invoiceIds: string[]
  invoices: InvoiceLite[]
}

export interface RevenueAttribution {
  byJob: Map<string, JobRevenue>
  /** Each invoice counted ONCE across the whole scope, which is what a totals row has to be. */
  distinct: { revenue: number; salesTax: number; collected: number; invoiceCount: number }
}

/**
 * Decide which invoice belongs to which job, and count each invoice once.
 *
 * An invoice raised from a job's quote is that job's alone. An invoice raised against the project is
 * the project's: it is shown on each of the project's jobs — hiding it would make a job look
 * uninvoiced — but it is counted once in any total.
 *
 * The attribution universe is every job on the projects involved, NOT just the jobs in scope. If a
 * status filter hides the job whose quote an invoice came from, that invoice is still that job's and
 * must not be handed out to its siblings as shared revenue.
 */
export async function attributeRevenue(companyId: string, inScope: JobKey[]): Promise<RevenueAttribution> {
  const byJob = new Map<string, JobRevenue>()
  for (const j of inScope) {
    byJob.set(j.id, { directRevenue: 0, sharedRevenue: 0, revenue: 0, salesTax: 0, collected: 0, invoiceIds: [], invoices: [] })
  }
  const distinct = { revenue: 0, salesTax: 0, collected: 0, invoiceCount: 0 }
  if (!inScope.length) return { byJob, distinct }

  const scopeProjects = uniq(inScope.map((j) => j.projectId).filter(Boolean) as string[])

  // Every job on those projects, so "is this invoice somebody's direct invoice?" has a true answer.
  let universe: JobKey[] = inScope.map((j) => ({ id: j.id, quoteId: j.quoteId, projectId: j.projectId }))
  for (const ids of chunks(scopeProjects)) {
    const siblings = await db.select({ id: job.id, quoteId: job.quoteId, projectId: job.projectId })
      .from(job)
      .where(and(eq(job.companyId, companyId), inArray(job.projectId, ids)))
    universe = universe.concat(siblings as JobKey[])
  }
  const seenJob = new Set<string>()
  universe = universe.filter((j) => (seenJob.has(j.id) ? false : (seenJob.add(j.id), true)))

  const quoteToJobs = new Map<string, string[]>()
  const projectToJobs = new Map<string, string[]>()
  for (const j of universe) {
    if (j.quoteId) quoteToJobs.set(j.quoteId, [...(quoteToJobs.get(j.quoteId) || []), j.id])
    if (j.projectId) projectToJobs.set(j.projectId, [...(projectToJobs.get(j.projectId) || []), j.id])
  }

  const quoteIds = [...quoteToJobs.keys()]
  const projectIds = [...projectToJobs.keys()]
  /**
   * The THIRD and most direct link: an invoice raised FOR this job. (T41)
   *
   * Revenue could only reach a job through its quote or its project, and a field-service call
   * frequently has neither — so billing a service call left the job showing cost against no
   * revenue, a pure loss on work that had been invoiced and paid. POST /api/jobs/:id/invoice now
   * stamps invoice.job_id, and this is the half that reads it.
   *
   * It is checked FIRST below, because it is the least ambiguous of the three: the invoice names
   * exactly one job, so the money is direct revenue and is never spread across a project's siblings.
   */
  const jobIds = universe.map((j) => j.id)
  if (!quoteIds.length && !projectIds.length && !jobIds.length) return { byJob, distinct }

  const links = [
    ...(jobIds.length ? [inArray(invoice.jobId, jobIds)] : []),
    ...(quoteIds.length ? [inArray(invoice.quoteId, quoteIds)] : []),
    ...(projectIds.length ? [inArray(invoice.projectId, projectIds)] : []),
  ]
  const rows = await db.select({
    id: invoice.id, number: invoice.number, status: invoice.status,
    total: invoice.total, taxAmount: invoice.taxAmount,
    amountPaid: invoice.amountPaid, amountRefunded: invoice.amountRefunded,
    projectId: invoice.projectId, quoteId: invoice.quoteId, jobId: invoice.jobId,
  })
    .from(invoice)
    .where(and(
      eq(invoice.companyId, companyId),
      notInArray(invoice.status, NOT_REVENUE),
      links.length === 1 ? links[0] : or(...links),
    ))

  for (const r of rows) {
    const inv: InvoiceLite = {
      id: r.id, number: r.number, status: r.status,
      total: num(r.total), taxAmount: num(r.taxAmount),
      amountPaid: num(r.amountPaid), amountRefunded: num(r.amountRefunded),
      projectId: r.projectId, quoteId: r.quoteId,
    }
    /**
     * Most specific link wins: the job the invoice names, then the quote behind the job, then the
     * project it sits on. An invoice stamped with a job_id is DIRECT revenue for exactly that job
     * and is never shared across a project's other calls — it names one piece of work. (T41)
     */
    const billedJob = r.jobId && byJob.has(r.jobId) ? [r.jobId] : undefined
    const viaQuote = inv.quoteId ? quoteToJobs.get(inv.quoteId) : undefined
    const direct = billedJob?.length ? billedJob : viaQuote
    const targets = direct?.length ? direct : (inv.projectId ? projectToJobs.get(inv.projectId) || [] : [])
    if (!targets.length) continue

    let countedOnce = false
    for (const jobId of targets) {
      const acc = byJob.get(jobId)
      if (!acc) continue // on a project, but filtered out of this report
      const amount = revenueOf(inv)
      if (direct?.length) acc.directRevenue = round2(acc.directRevenue + amount)
      else acc.sharedRevenue = round2(acc.sharedRevenue + amount)
      acc.revenue = round2(acc.directRevenue + acc.sharedRevenue)
      acc.salesTax = round2(acc.salesTax + inv.taxAmount)
      acc.collected = round2(acc.collected + inv.amountPaid - inv.amountRefunded)
      acc.invoiceIds.push(inv.id)
      acc.invoices.push(inv)
      countedOnce = true
    }
    if (countedOnce) {
      distinct.revenue = round2(distinct.revenue + revenueOf(inv))
      distinct.salesTax = round2(distinct.salesTax + inv.taxAmount)
      distinct.collected = round2(distinct.collected + inv.amountPaid - inv.amountRefunded)
      distinct.invoiceCount++
    }
  }
  return { byJob, distinct }
}

/**
 * What the quote said the work would COST us, split labour/material.
 *
 * THIS USED TO BE ZERO FOR EVERY QUOTE, AND THAT IS WHY MARGIN READ 100%. (T41)
 *
 * The two CASE expressions below have always keyed on `quote_line_item.type` — and nothing ever
 * wrote that column. The shared quote route's line schema had no `type` field, so every row was
 * NULL, so both sums were 0 on every quote in the fleet. Reported as "pricebook cost never reaches
 * job costing (100% margin)", and the deeper truth was worse than a wrong cost: there was no
 * estimate at all, and a 100% margin is what you get when you divide revenue by nothing.
 *
 * What it reads now, in order of what it actually knows:
 *
 *   1. unit_cost × quantity, when the line records a cost. This is a real cost — entered by hand or
 *      filled from the pricebook item's `cost` by the picker — and it is the only figure here that
 *      deserves the name.
 *   2. nothing, when the line records no cost. NOT the line's price: a line's `total` is what the
 *      CUSTOMER pays, and reporting it back as our cost would state a 0% margin on work that has
 *      not been costed, which is as wrong as 100% and harder to notice. Those lines are counted in
 *      `uncostedLines` instead, so a screen can say "3 lines have no cost recorded" rather than
 *      implying the job breaks even.
 *
 * That is the same principle as unratedLaborHours above: a cost the system made up is worse than a
 * cost it admits it does not know.
 */
async function estimatedCostsByQuote(quoteIds: string[]): Promise<Map<string, { labor: number; material: number; uncostedLines: number; laborHours: number }>> {
  const out = new Map<string, { labor: number; material: number; uncostedLines: number; laborHours: number }>()
  for (const ids of chunks(quoteIds)) {
    // `unit_cost` exists on templates that ran the quote-line-cost migration (crm-fieldservice
    // 0024). Addressed through the schema object so a template without it fails loudly at build
    // rather than silently summing a column that is not there.
    const lineCost = sql`${quoteLineItem.quantity} * ${quoteLineItem.unitCost}`
    const rows = await db.select({
      quoteId: quoteLineItem.quoteId,
      labor: sql<string>`COALESCE(SUM(CASE WHEN ${quoteLineItem.type} = 'labor' AND ${quoteLineItem.unitCost} IS NOT NULL THEN ${lineCost} ELSE 0 END), 0)`,
      material: sql<string>`COALESCE(SUM(CASE WHEN ${quoteLineItem.type} IN ('material', 'part') AND ${quoteLineItem.unitCost} IS NOT NULL THEN ${lineCost} ELSE 0 END), 0)`,
      // Anything not costed, whatever its type — including a costed line typed 'service'/'other',
      // which contributes to neither bucket and would otherwise vanish without trace.
      other: sql<string>`COALESCE(SUM(CASE WHEN ${quoteLineItem.unitCost} IS NOT NULL AND (${quoteLineItem.type} IS NULL OR ${quoteLineItem.type} NOT IN ('labor', 'material', 'part')) THEN ${lineCost} ELSE 0 END), 0)`,
      uncosted: sql<string>`COUNT(*) FILTER (WHERE ${quoteLineItem.unitCost} IS NULL)`,
      /**
       * HOW LONG THE CATALOGUE SAYS THE WORK TAKES. (T42 "pricebook labour hours ignored")
       *
       * The hours live on the pricebook item and the line records which item it was priced from, so
       * they are summed through that link — quantity × the item's labor_hours. Summed only where the
       * catalogue states them: a line from an item with no labor_hours contributes nothing rather
       * than a guess, exactly as an uncosted line contributes no cost.
       */
      laborHours: sql<string>`COALESCE(SUM(${quoteLineItem.quantity} * COALESCE(${pricebookItem.laborHours}, 0)), 0)`,
    })
      .from(quoteLineItem)
      .leftJoin(pricebookItem, eq(pricebookItem.id, quoteLineItem.pricebookItemId))
      .where(inArray(quoteLineItem.quoteId, ids))
      .groupBy(quoteLineItem.quoteId)
    for (const r of rows) {
      out.set(r.quoteId, {
        labor: num(r.labor),
        laborHours: round1(num(r.laborHours)),
        // A costed line that is neither labour nor material is still money out of the door; it is
        // reported with materials rather than dropped, because the alternative is an estimate that
        // silently excludes it.
        material: round2(num(r.material) + num(r.other)),
        uncostedLines: Number(r.uncosted || 0),
      })
    }
  }
  return out
}

/** Estimated revenue, ex-tax for the same reason actual revenue is: so the two are comparable. */
const estimatedRevenueOf = (q: { total?: unknown; taxAmount?: unknown } | null | undefined, fallback: unknown) =>
  q ? round2(num(q.total) - num(q.taxAmount)) : num(fallback)

/**
 * One job: estimate against actual, the variance, and every line behind the actual.
 */
export async function getJobCostAnalysis(jobId: string, companyId: string) {
  const [jobRow] = await db.select()
    .from(job)
    .where(and(eq(job.id, jobId), eq(job.companyId, companyId)))

  if (!jobRow) throw notFound('Job not found')

  let contactRow = null
  let projectRow = null
  let quoteRow = null

  if (jobRow.contactId) {
    const [c] = await db.select({ id: contact.id, name: contact.name })
      .from(contact).where(and(eq(contact.id, jobRow.contactId), eq(contact.companyId, companyId)))
    contactRow = c || null
  }
  if (jobRow.projectId) {
    const [p] = await db.select({ id: project.id, name: project.name, number: project.number })
      .from(project).where(and(eq(project.id, jobRow.projectId), eq(project.companyId, companyId)))
    projectRow = p || null
  }
  if (jobRow.quoteId) {
    const [q] = await db.select()
      .from(quote).where(and(eq(quote.id, jobRow.quoteId), eq(quote.companyId, companyId)))
    quoteRow = q || null
  }

  const key: JobKey = { id: jobRow.id, quoteId: jobRow.quoteId, projectId: jobRow.projectId }
  const [{ byJob }, costMap, estMap] = await Promise.all([
    attributeRevenue(companyId, [key]),
    costsByJob(companyId, [jobRow.id]),
    jobRow.quoteId ? estimatedCostsByQuote([jobRow.quoteId]) : Promise.resolve(new Map()),
  ])
  const rev = byJob.get(jobRow.id)!
  const cost = costMap.get(jobRow.id)!
  const est = estMap.get(jobRow.quoteId || '') || { labor: 0, material: 0, uncostedLines: 0, laborHours: 0 }

  // The lines behind each figure. The hourly rate here resolves the same way costsByJob's SQL does.
  const timeEntries = await db.select()
    .from(timeEntry)
    .leftJoin(user, eq(timeEntry.userId, user.id))
    .leftJoin(teamMember, and(eq(teamMember.companyId, companyId), sql`lower(${teamMember.email}) = lower(${user.email})`))
    .where(and(eq(timeEntry.jobId, jobId), eq(timeEntry.companyId, companyId)))

  const materialUsage = await db.select()
    .from(inventoryUsage)
    .leftJoin(inventoryItem, eq(inventoryUsage.itemId, inventoryItem.id))
    .where(and(eq(inventoryUsage.jobId, jobId), eq(inventoryUsage.companyId, companyId)))

  const expenses = await db.select()
    .from(expense)
    .where(and(eq(expense.jobId, jobId), eq(expense.companyId, companyId)))

  const bills: any[] = vendorBillTable
    ? await db.select({
        id: vendorBillTable.id, number: vendorBillTable.number, status: vendorBillTable.status,
        billDate: vendorBillTable.billDate, amount: vendorBillTable.amount, amountPaid: vendorBillTable.amountPaid,
        vendor: contact.name,
      })
        .from(vendorBillTable)
        .leftJoin(contact, eq(vendorBillTable.vendorId, contact.id))
        .where(and(
          eq(vendorBillTable.companyId, companyId),
          eq(vendorBillTable.jobId, jobId),
          inArray(vendorBillTable.status, BILL_IS_SPEND),
        ))
        .orderBy(desc(vendorBillTable.billDate))
    : []

  const estimatedRevenue = estimatedRevenueOf(quoteRow, jobRow.estimatedValue)
  /**
   * The catalogue's hours when the quote has them, the job's typed figure when it does not. (T42)
   *
   * Not added together: they are two answers to the same question, and a quote priced from the
   * catalogue is the better one. Falling back rather than overriding means a hand-typed estimate, and
   * every quote already in the system, keeps exactly the meaning it had.
   */
  const estimatedLaborHours = est.laborHours > 0 ? est.laborHours : num(jobRow.estimatedHours)
  const estimatedCost = round2(est.labor + est.material)

  const grossProfit = round2(rev.revenue - cost.totalCost)
  const grossMargin = rev.revenue > 0 ? (grossProfit / rev.revenue) * 100 : 0
  const estimatedProfit = round2(estimatedRevenue - estimatedCost)
  const estimatedMargin = estimatedRevenue > 0 ? (estimatedProfit / estimatedRevenue) * 100 : 0

  return {
    job: {
      id: jobRow.id,
      number: jobRow.number,
      title: jobRow.title,
      status: jobRow.status,
      contact: contactRow,
      project: projectRow,
    },

    estimated: {
      revenue: estimatedRevenue,
      laborCost: round2(est.labor),
      materialCost: round2(est.material),
      totalCost: estimatedCost,
      profit: estimatedProfit,
      margin: round1(estimatedMargin),
      laborHours: estimatedLaborHours,
      /**
       * Quote lines with no cost recorded. The estimate above excludes them rather than pricing
       * them at their selling price, so this is the difference between "this job is costed and the
       * margin is 100%" and "this job has not been costed". Without it the screen cannot tell the
       * reader which one it is looking at — which is how the 100% went unexplained. (T41)
       */
      uncostedLines: est.uncostedLines,
    },

    actual: {
      revenue: rev.revenue,
      /** Of that revenue, what came off this job's own quote and what it shares with the project. */
      directRevenue: rev.directRevenue,
      sharedRevenue: rev.sharedRevenue,
      /** Excluded from revenue on purpose: it is the state's money, reported so the figure ties out. */
      salesTax: rev.salesTax,
      collected: rev.collected,
      laborCost: cost.laborCost,
      materialCost: cost.materialCost,
      expenseCost: cost.expenseCost,
      subcontractorCost: cost.subcontractorCost,
      billedCost: cost.billedCost,
      totalCost: cost.totalCost,
      profit: grossProfit,
      margin: round1(grossMargin),
      laborHours: cost.laborHours,
      /** Hours with no rate on the entry and none on the person. Counted, not priced. */
      unratedLaborHours: cost.unratedLaborHours,
    },

    // Positive = over budget.
    variance: {
      cost: round2(cost.totalCost - estimatedCost),
      labor: round2(cost.laborCost - est.labor),
      material: round2(cost.materialCost - est.material),
      hours: round1(cost.laborHours - estimatedLaborHours),
      costPercent: estimatedCost > 0 ? round1(((cost.totalCost - estimatedCost) / estimatedCost) * 100) : 0,
    },

    laborDetail: timeEntries.map((e) => {
      // The same three steps the grouped SQL above uses, in the same order — a roster rate of 0
      // is a blank rather than "free", which is the rule time.ts applies too.
      const rosterRate = Number(e.team_member?.hourlyRate)
      const rate = e.time_entry.hourlyRate ?? e.user?.hourlyRate ?? (Number.isFinite(rosterRate) && rosterRate > 0 ? e.team_member!.hourlyRate : null)
      return {
        id: e.time_entry.id,
        date: e.time_entry.date,
        user: e.user ? `${e.user.firstName} ${e.user.lastName}` : 'Unknown',
        userName: e.user ? `${e.user.firstName} ${e.user.lastName}` : 'Unknown',
        hours: num(e.time_entry.hours),
        rate: rate === null ? null : num(rate),
        /** Null rate means unknown, not free — the screen says so rather than printing $0.00. */
        rateKnown: rate !== null,
        cost: round2(num(e.time_entry.hours) * num(rate)),
        description: e.time_entry.description,
      }
    }),

    materialDetail: materialUsage.map((u) => ({
      id: u.inventory_usage.id,
      date: u.inventory_usage.createdAt,
      item: u.inventory_item?.name || 'Unknown',
      name: u.inventory_item?.name || 'Unknown',
      sku: u.inventory_item?.sku,
      quantity: num(u.inventory_usage.quantity),
      unitCost: num(u.inventory_usage.unitCost ?? u.inventory_item?.unitCost),
      cost: round2(num(u.inventory_usage.quantity) * num(u.inventory_usage.unitCost ?? u.inventory_item?.unitCost)),
    })),

    expenseDetail: expenses.map((e) => ({
      id: e.id,
      date: e.date,
      category: e.category,
      vendor: e.vendor,
      description: e.description,
      amount: num(e.amount),
    })),

    billDetail: bills.map((b) => ({
      id: b.id,
      number: b.number,
      vendor: b.vendor,
      date: b.billDate,
      status: b.status,
      amount: num(b.amount),
      amountPaid: num(b.amountPaid),
    })),

    invoices: rev.invoices.map((i) => ({
      id: i.id, number: i.number, status: i.status,
      total: i.total, taxAmount: i.taxAmount, revenue: revenueOf(i),
      amountPaid: i.amountPaid, amountRefunded: i.amountRefunded,
      /** A project invoice appears on every job of the project; it is counted once in any total. */
      shared: !(i.quoteId && i.quoteId === jobRow.quoteId),
    })),
  }
}

/** The job columns every roll-up needs, and nothing more. */
const SUMMARY_JOB_COLUMNS = {
  id: job.id, number: job.number, title: job.title, status: job.status, type: job.type,
  createdAt: job.createdAt, completedAt: job.completedAt,
  estimatedValue: job.estimatedValue, estimatedHours: job.estimatedHours,
  quoteId: job.quoteId, projectId: job.projectId, assignedToId: job.assignedToId,
}

/**
 * Many jobs: the same costing rolled up.
 *
 * `jobs` is a PAGE. `totals` and `count` are not — they cover every job that matched the filters,
 * which is the whole point: a totals row that silently described the newest 50 of 118 jobs was the
 * most misleading thing on the screen.
 */
export async function getJobCostingSummary(
  companyId: string,
  { startDate, endDate, status, projectId, limit: queryLimit = 50 }:
    { startDate?: string; endDate?: string; status?: string; projectId?: string; limit?: number } = {},
) {
  const conditions = [eq(job.companyId, companyId)]
  if (startDate) conditions.push(gte(job.createdAt, new Date(startDate)))
  if (endDate) conditions.push(lte(job.createdAt, new Date(endDate)))
  if (status) conditions.push(eq(job.status, status))
  if (projectId) conditions.push(eq(job.projectId, projectId))

  const matched = await db.select({ ...SUMMARY_JOB_COLUMNS, contactName: contact.name, quoteTotal: quote.total, quoteTax: quote.taxAmount })
    .from(job)
    .leftJoin(contact, eq(job.contactId, contact.id))
    .leftJoin(quote, eq(job.quoteId, quote.id))
    .where(and(...conditions))
    .orderBy(desc(job.createdAt))
    .limit(TOTALS_CEILING + 1)

  const totalsTruncated = matched.length > TOTALS_CEILING
  const scope = totalsTruncated ? matched.slice(0, TOTALS_CEILING) : matched

  const keys: JobKey[] = scope.map((j) => ({ id: j.id, quoteId: j.quoteId, projectId: j.projectId }))
  const [{ byJob, distinct }, costMap, estMap] = await Promise.all([
    attributeRevenue(companyId, keys),
    costsByJob(companyId, scope.map((j) => j.id)),
    estimatedCostsByQuote(uniq(scope.map((j) => j.quoteId).filter(Boolean) as string[])),
  ])

  const rowFor = (j: typeof scope[number]) => {
    const rev = byJob.get(j.id) || { directRevenue: 0, sharedRevenue: 0, revenue: 0, salesTax: 0, collected: 0, invoiceIds: [], invoices: [] }
    const cost = costMap.get(j.id) || EMPTY_COST
    const est = estMap.get(j.quoteId || '') || { labor: 0, material: 0, uncostedLines: 0, laborHours: 0 }
    const estimatedRevenue = estimatedRevenueOf(j.quoteTotal != null ? { total: j.quoteTotal, taxAmount: j.quoteTax } : null, j.estimatedValue)
    const estimatedCost = round2(est.labor + est.material)
    const profit = round2(rev.revenue - cost.totalCost)
    return {
      id: j.id,
      number: j.number,
      title: j.title,
      status: j.status,
      contact: j.contactName,
      estimatedRevenue,
      estimatedCost,
      invoicedRevenue: rev.revenue,
      directRevenue: rev.directRevenue,
      /** Shown on every job of a project, counted once in `totals`. */
      sharedRevenue: rev.sharedRevenue,
      salesTax: rev.salesTax,
      collected: rev.collected,
      laborCost: cost.laborCost,
      materialCost: cost.materialCost,
      expenseCost: cost.expenseCost,
      billedCost: cost.billedCost,
      totalCost: cost.totalCost,
      profit,
      margin: rev.revenue > 0 ? round1((profit / rev.revenue) * 100) : 0,
      laborHours: cost.laborHours,
      unratedLaborHours: cost.unratedLaborHours,
      isProfitable: profit > 0,
      /** Actual against the quoted labour+material, not against an invented share of revenue. */
      variance: round2(cost.totalCost - estimatedCost),
    }
  }

  const all = scope.map(rowFor)
  const page = all.slice(0, Math.max(0, queryLimit))

  const totals = all.reduce(
    (acc, j) => ({
      ...acc,
      estimatedRevenue: round2(acc.estimatedRevenue + j.estimatedRevenue),
      totalCost: round2(acc.totalCost + j.totalCost),
      laborCost: round2(acc.laborCost + j.laborCost),
      billedCost: round2(acc.billedCost + j.billedCost),
      laborHours: round1(acc.laborHours + j.laborHours),
      unratedLaborHours: round1(acc.unratedLaborHours + j.unratedLaborHours),
      profitableCount: acc.profitableCount + (j.isProfitable ? 1 : 0),
    }),
    {
      estimatedRevenue: 0, invoicedRevenue: 0, totalCost: 0, laborCost: 0, billedCost: 0,
      profit: 0, laborHours: 0, unratedLaborHours: 0, profitableCount: 0,
      salesTax: 0, collected: 0, margin: 0, profitablePercent: 0,
    },
  )
  // Revenue comes from the DISTINCT invoice set, never from summing the job rows: a project invoice
  // shows on each of the project's jobs, and adding those up is how $11,183 became $22,366.
  totals.invoicedRevenue = distinct.revenue
  totals.salesTax = distinct.salesTax
  totals.collected = distinct.collected
  totals.profit = round2(totals.invoicedRevenue - totals.totalCost)
  totals.margin = totals.invoicedRevenue > 0 ? round1((totals.profit / totals.invoicedRevenue) * 100) : 0
  totals.profitablePercent = all.length > 0 ? Math.round((totals.profitableCount / all.length) * 100) : 0

  return {
    jobs: page,
    totals,
    /** Every job that matched — what `totals` describes. */
    count: all.length,
    /** How many of them are in `jobs`. */
    returned: page.length,
    truncated: page.length < all.length,
    /** True only if a tenant has more jobs than the totals will scan; the figures then exclude the rest. */
    totalsTruncated,
    invoiceCount: distinct.invoiceCount,
  }
}

/**
 * The same costing grouped — by month, by technician, by job type.
 *
 * Two changes beyond using the shared model. It no longer forces `status = 'completed'`: the screen
 * shows this table directly above a job list that the user filters by status, and the two silently
 * described different sets of jobs, so neither reconciled with the other or with the totals row.
 * And a project invoice shared by two jobs in the same group is counted ONCE in that group.
 */
export async function getProfitabilityByCategory(
  companyId: string,
  { groupBy = 'month', startDate, endDate, status }:
    { groupBy?: string; startDate?: string; endDate?: string; status?: string } = {},
) {
  // A job that has not finished has no completedAt, so the date it is grouped and filtered by is the
  // day it completed or, failing that, the day it was raised.
  const when = sql`COALESCE(${job.completedAt}, ${job.createdAt})`
  const conditions = [eq(job.companyId, companyId)]
  if (status) conditions.push(eq(job.status, status))
  if (startDate) conditions.push(gte(when, new Date(startDate)) as any)
  if (endDate) conditions.push(lte(when, new Date(endDate)) as any)

  const jobs = await db.select({
    ...SUMMARY_JOB_COLUMNS,
    techFirst: user.firstName,
    techLast: user.lastName,
  })
    .from(job)
    .leftJoin(user, eq(job.assignedToId, user.id))
    .where(and(...conditions))
    .orderBy(desc(job.createdAt))
    .limit(TOTALS_CEILING)

  const keys: JobKey[] = jobs.map((j) => ({ id: j.id, quoteId: j.quoteId, projectId: j.projectId }))
  const [{ byJob }, costMap] = await Promise.all([
    attributeRevenue(companyId, keys),
    costsByJob(companyId, jobs.map((j) => j.id)),
  ])

  const keyOf = (j: typeof jobs[number]) => {
    if (groupBy === 'technician') return j.techFirst ? `${j.techFirst} ${j.techLast}` : 'Unassigned'
    if (groupBy === 'type') return j.type || 'General'
    if (groupBy !== 'month') return 'All'
    const date = j.completedAt || j.createdAt
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  }

  const groups = new Map<string, { key: string; jobCount: number; revenue: number; cost: number; invoiceIds: Set<string> }>()
  for (const j of jobs) {
    const k = keyOf(j)
    let g = groups.get(k)
    if (!g) { g = { key: k, jobCount: 0, revenue: 0, cost: 0, invoiceIds: new Set() }; groups.set(k, g) }
    g.jobCount++
    g.cost = round2(g.cost + (costMap.get(j.id) || EMPTY_COST).totalCost)
    // Count each invoice once per group, however many of the group's jobs it is shown on.
    for (const inv of (byJob.get(j.id)?.invoices || [])) {
      if (g.invoiceIds.has(inv.id)) continue
      g.invoiceIds.add(inv.id)
      g.revenue = round2(g.revenue + revenueOf(inv))
    }
  }

  const results = [...groups.values()].map(({ invoiceIds, ...g }) => ({
    ...g,
    invoiceCount: invoiceIds.size,
    profit: round2(g.revenue - g.cost),
    margin: g.revenue > 0 ? round1(((g.revenue - g.cost) / g.revenue) * 100) : 0,
    avgJobRevenue: g.jobCount > 0 ? round2(g.revenue / g.jobCount) : 0,
  }))

  return results.sort((a, b) => {
    if (groupBy === 'month') return a.key.localeCompare(b.key)
    return b.profit - a.profit
  })
}

export default {
  getJobCostAnalysis,
  getJobCostingSummary,
  getProfitabilityByCategory,
  costsByJob,
  attributeRevenue,
}

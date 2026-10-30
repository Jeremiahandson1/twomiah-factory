// Job costing: estimate against ACTUAL cost, per job and across jobs. Moved from the CRM template's
// services/jobCosting.ts (templates/crm/backend/src/services), where every fault it fixed is written up (T32 B3,
// T42, T48, T49). The money is computed in two places, costsByJob and attributeRevenue, and every report reads them.
// Queries that carry SQL expressions are in server/data/jobCosting.ts. vendor_bill is always present in this app's
// schema, so the bill component is always on (the template looked the table up because other verticals lacked it).
import { and, desc, eq, gte, inArray, lte, notInArray, or } from 'drizzle-orm'
import {
  job, contact, project, quote, invoice, inventoryUsage, inventoryItem, expense, vendorBill,
} from '../../db/schema/index.ts'
import { notFound } from '../../http/errors.ts'
import * as q from '../../data/jobCosting.ts'
import type { CrmDeps } from '../deps.ts'
import { createRoofJobCosts, type RoofJobCost } from '../roof/jobCosts.ts'

/** Not revenue: a draft has not been raised, and a void one never was (invoicing's own stats rule). */
const NOT_REVENUE = ['draft', 'void']
/** Spend. Mirrors /api/bills/summary/job/:jobId exactly. */
const BILL_IS_SPEND = ['open', 'partial', 'paid']
/** The most jobs the totals scan; beyond it the answer says so (totalsTruncated). */
const TOTALS_CEILING = 5000

const num = (v: unknown) => Number(v || 0)
const round2 = (n: number) => Math.round(n * 100) / 100
const round1 = (n: number) => Math.round(n * 10) / 10
const uniq = <T,>(xs: T[]) => [...new Set(xs)]
const chunks = <T,>(xs: T[], size = 500): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

export interface JobCost {
  laborHours: number
  /** Hours whose rate is unknown: counted, priced at nothing, reported so it can be fixed. */
  unratedLaborHours: number
  laborCost: number
  materialCost: number
  expenseCost: number
  subcontractorCost: number
  /** Vendor bills raised against the job, excluding void ones. */
  billedCost: number
  totalCost: number
  /**
   * Roofing only (CrmSettings.roof): the material orders and the crew's pay that are INSIDE materialCost and laborCost
   * above, kept apart so the screen can show them, and the job's supplements. Absent for every other trade.
   */
  roof?: RoofJobCost & { crewBasis: 'clocked' | 'per_square' | 'unknown' }
}

const EMPTY_COST: JobCost = {
  laborHours: 0, unratedLaborHours: 0, laborCost: 0, materialCost: 0,
  expenseCost: 0, subcontractorCost: 0, billedCost: 0, totalCost: 0,
}

export interface JobKey { id: string; quoteId: string | null; projectId: string | null }

interface InvoiceLite {
  id: string; number: string; status: string
  total: number; taxAmount: number; amountPaid: number; amountRefunded: number
  projectId: string | null; quoteId: string | null
}
/** Revenue is ex-tax: the tax line is the state's money passing through. */
const revenueOf = (inv: InvoiceLite) => inv.total - inv.taxAmount

export interface JobRevenue {
  directRevenue: number
  sharedRevenue: number
  revenue: number
  salesTax: number
  collected: number
  invoiceIds: string[]
  invoices: InvoiceLite[]
}

export interface RevenueAttribution {
  byJob: Map<string, JobRevenue>
  /** Each invoice counted ONCE across the whole scope. */
  distinct: { revenue: number; salesTax: number; collected: number; invoiceCount: number }
}

/** Estimated revenue, ex-tax so it compares with actual. */
const estimatedRevenueOf = (qt: { total?: unknown; taxAmount?: unknown } | null | undefined, fallback: unknown) =>
  qt ? round2(num(qt.total) - num(qt.taxAmount)) : num(fallback)

/** The job columns every roll-up needs. */
const SUMMARY_JOB_COLUMNS = {
  id: job.id, number: job.number, title: job.title, status: job.status, type: job.type,
  createdAt: job.createdAt, completedAt: job.completedAt,
  estimatedValue: job.estimatedValue, estimatedHours: job.estimatedHours,
  quoteId: job.quoteId, projectId: job.projectId, assignedToId: job.assignedToId,
}

export function createJobCostingService(d: CrmDeps) {
  const { db } = d
  // A roofer's material orders, crew pay and supplements (roof/jobCosts.ts): in the costs only where the add-on is on.
  const roof = d.settings?.roof ? createRoofJobCosts(d) : null

  /** Actual cost per job from every ledger that holds job cost; set-based, four queries per 500 jobs. */
  async function costsByJob(companyId: string, jobIds: string[]): Promise<Map<string, JobCost>> {
    const out = new Map<string, JobCost>()
    for (const id of jobIds) out.set(id, { ...EMPTY_COST })
    if (!jobIds.length) return out

    for (const ids of chunks(jobIds)) {
      const labour = await q.labourByJob(db, companyId, ids)
      const materials = await q.materialCostByJob(db, companyId, ids)
      const expenses = await q.expenseCostByJob(db, companyId, ids)
      const bills = await q.billedCostByJob(db, companyId, ids)
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

    // Roofing: the supplier orders placed for the job and the crew's pay by the square join the materials and the labour.
    // A crew's pay counts only where nobody clocked time, or the same labour would be counted twice (roof/jobCosts.ts).
    if (roof) {
      const extra = await roof.roofCostsByJob(companyId, jobIds)
      for (const [id, r] of extra) {
        const c = out.get(id); if (!c) continue
        const clocked = c.laborHours > 0 || c.laborCost > 0
        const crewCost = clocked ? 0 : r.crewCost
        c.materialCost += r.materialOrderCost
        c.laborCost += crewCost
        c.roof = { ...r, crewCost, crewBasis: clocked ? 'clocked' : r.crewCostKnown ? 'per_square' : 'unknown' }
      }
    }

    // Subcontractor cost is a SLICE of expense cost, reported separately; adding it again would double-count.
    for (const c of out.values()) {
      c.totalCost = round2(c.laborCost + c.materialCost + c.expenseCost + c.billedCost)
      c.laborCost = round2(c.laborCost); c.materialCost = round2(c.materialCost)
      c.expenseCost = round2(c.expenseCost); c.subcontractorCost = round2(c.subcontractorCost)
      c.billedCost = round2(c.billedCost)
      c.laborHours = round1(c.laborHours); c.unratedLaborHours = round1(c.unratedLaborHours)
    }
    return out
  }

  /**
   * Which invoice belongs to which job, each counted once. An invoice from a job's quote is that job's alone; a
   * project invoice is shown on each of the project's jobs and counted once. The universe is every job on the
   * projects involved, so a filtered-out job's direct invoice is not handed to its siblings.
   */
  async function attributeRevenue(companyId: string, inScope: JobKey[]): Promise<RevenueAttribution> {
    const byJob = new Map<string, JobRevenue>()
    for (const j of inScope) {
      byJob.set(j.id, { directRevenue: 0, sharedRevenue: 0, revenue: 0, salesTax: 0, collected: 0, invoiceIds: [], invoices: [] })
    }
    const distinct = { revenue: 0, salesTax: 0, collected: 0, invoiceCount: 0 }
    if (!inScope.length) return { byJob, distinct }

    const scopeProjects = uniq(inScope.map((j) => j.projectId).filter(Boolean) as string[])
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
    // The most direct link: an invoice raised FOR the job (invoice.job_id, POST /api/jobs/:id/invoice). Revenue reached a
    // job only through its quote or project in the base CRM; a service call often has neither, so a billed call showed
    // cost against no revenue. From the field-service copy (T41), for every vertical now that the column is everyone's.
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
      // Most specific link wins: the job the invoice names (never shared across a project's other jobs), then the quote
      // behind the job, then the project it sits on.
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

  /** What each quote says the work costs, split labour/material (other costed lines with material). */
  async function estimatedCostsByQuote(quoteIds: string[]) {
    const out = new Map<string, { labor: number; material: number; uncostedLines: number; laborHours: number }>()
    for (const ids of chunks(quoteIds)) {
      for (const r of await q.quoteEstimateRows(db, ids)) {
        out.set(r.quoteId, {
          labor: num(r.labor),
          laborHours: round1(num(r.laborHours)),
          material: round2(num(r.material) + num(r.other)),
          uncostedLines: Number(r.uncosted || 0),
        })
      }
    }
    return out
  }

  /** One job: estimate against actual, the variance, and every line behind the actual. */
  async function getJobCostAnalysis(jobId: string, companyId: string) {
    const [jobRow] = await db.select().from(job).where(and(eq(job.id, jobId), eq(job.companyId, companyId)))
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
      const [qt] = await db.select().from(quote).where(and(eq(quote.id, jobRow.quoteId), eq(quote.companyId, companyId)))
      quoteRow = qt || null
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

    // The lines behind each figure; the hourly rate resolves the same way costsByJob's SQL does.
    const timeEntries: any[] = await q.jobTimeEntriesWithRates(db, companyId, jobId)
    const materialUsage: any[] = await db.select({ usage: inventoryUsage, item: inventoryItem })
      .from(inventoryUsage)
      .leftJoin(inventoryItem, eq(inventoryUsage.itemId, inventoryItem.id))
      .where(and(eq(inventoryUsage.jobId, jobId), eq(inventoryUsage.companyId, companyId)))
    const expenses: any[] = await db.select().from(expense).where(and(eq(expense.jobId, jobId), eq(expense.companyId, companyId)))
    const bills: any[] = await db.select({
      id: vendorBill.id, number: vendorBill.number, status: vendorBill.status,
      billDate: vendorBill.billDate, amount: vendorBill.amount, amountPaid: vendorBill.amountPaid,
      vendor: contact.name,
    })
      .from(vendorBill)
      .leftJoin(contact, eq(vendorBill.vendorId, contact.id))
      .where(and(eq(vendorBill.companyId, companyId), eq(vendorBill.jobId, jobId), inArray(vendorBill.status, BILL_IS_SPEND)))
      .orderBy(desc(vendorBill.billDate))

    // A roof's approved supplements are work the carrier agreed to pay for on top of the original: expected revenue.
    const estimatedRevenue = round2(estimatedRevenueOf(quoteRow, jobRow.estimatedValue) + (cost.roof?.supplements.approved ?? 0))
    // The catalogue's hours where the quote was priced from it, else whatever was typed on the job.
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
        uncostedLines: est.uncostedLines,
      },
      actual: {
        revenue: rev.revenue,
        directRevenue: rev.directRevenue,
        sharedRevenue: rev.sharedRevenue,
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
        // The entry's rate, else the person's, else a non-zero roster rate: a roster rate of 0 is a blank.
        const rosterRate = Number(e.teamMember?.hourlyRate)
        const rate = e.entry.hourlyRate ?? e.user?.hourlyRate ?? (Number.isFinite(rosterRate) && rosterRate > 0 ? e.teamMember!.hourlyRate : null)
        return {
          id: e.entry.id,
          date: e.entry.date,
          user: e.user ? `${e.user.firstName} ${e.user.lastName}` : 'Unknown',
          userName: e.user ? `${e.user.firstName} ${e.user.lastName}` : 'Unknown',
          hours: num(e.entry.hours),
          rate: rate === null ? null : num(rate),
          rateKnown: rate !== null,
          cost: round2(num(e.entry.hours) * num(rate)),
          description: e.entry.description,
        }
      }),
      materialDetail: materialUsage.map((u) => ({
        id: u.usage.id,
        date: u.usage.createdAt,
        item: u.item?.name || 'Unknown',
        name: u.item?.name || 'Unknown',
        sku: u.item?.sku,
        quantity: num(u.usage.quantity),
        unitCost: num(u.usage.unitCost ?? u.item?.unitCost),
        cost: round2(num(u.usage.quantity) * num(u.usage.unitCost ?? u.item?.unitCost)),
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
        // A project invoice appears on every job of the project; it is counted once in any total.
        shared: !(i.quoteId && i.quoteId === jobRow.quoteId),
      })),
      // Roofing: what its material orders, crew and supplements add (roof/jobCosts.ts). Absent for every other trade.
      ...(roof && cost.roof ? {
        roof: {
          materialOrderCost: cost.roof.materialOrderCost,
          crewCost: cost.roof.crewCost,
          crewBasis: cost.roof.crewBasis,
          crewName: cost.roof.crewName,
          squares: cost.roof.squares,
          payPerSquare: cost.roof.payPerSquare,
          supplements: cost.roof.supplements,
        },
        ...(await roof.roofDetail(companyId, jobId)),
        crewDetail: cost.roof.crewBasis === 'per_square' && cost.roof.crewName
          ? [{ crew: cost.roof.crewName, squares: cost.roof.squares, payPerSquare: cost.roof.payPerSquare, cost: cost.roof.crewCost }]
          : [],
      } : {}),
    }
  }

  /**
   * Many jobs, rolled up. `jobs` is a PAGE; `totals` and `count` cover every job that matched the filters.
   */
  async function getJobCostingSummary(
    companyId: string,
    { startDate, endDate, status, projectId, limit: queryLimit = 50 }:
      { startDate?: string; endDate?: string; status?: string; projectId?: string; limit?: number } = {},
  ) {
    const conditions = [eq(job.companyId, companyId)]
    if (startDate) conditions.push(gte(job.createdAt, new Date(startDate)))
    if (endDate) conditions.push(lte(job.createdAt, new Date(endDate)))
    if (status) conditions.push(eq(job.status, status))
    if (projectId) conditions.push(eq(job.projectId, projectId))

    const matched: any[] = await db.select({ ...SUMMARY_JOB_COLUMNS, contactName: contact.name, quoteTotal: quote.total, quoteTax: quote.taxAmount })
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

    const rowFor = (j: any) => {
      const rev = byJob.get(j.id) || { directRevenue: 0, sharedRevenue: 0, revenue: 0, salesTax: 0, collected: 0, invoiceIds: [], invoices: [] }
      const cost = costMap.get(j.id) || EMPTY_COST
      const est = estMap.get(j.quoteId || '') || { labor: 0, material: 0, uncostedLines: 0, laborHours: 0 }
      const estimatedRevenue = round2(estimatedRevenueOf(j.quoteTotal != null ? { total: j.quoteTotal, taxAmount: j.quoteTax } : null, j.estimatedValue) + (cost.roof?.supplements.approved ?? 0))
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
    // Revenue from the DISTINCT invoice set, never the sum of job rows (a project invoice shows on each job).
    totals.invoicedRevenue = distinct.revenue
    totals.salesTax = distinct.salesTax
    totals.collected = distinct.collected
    totals.profit = round2(totals.invoicedRevenue - totals.totalCost)
    totals.margin = totals.invoicedRevenue > 0 ? round1((totals.profit / totals.invoicedRevenue) * 100) : 0
    totals.profitablePercent = all.length > 0 ? Math.round((totals.profitableCount / all.length) * 100) : 0

    return {
      jobs: page,
      totals,
      count: all.length,
      returned: page.length,
      truncated: page.length < all.length,
      totalsTruncated,
      invoiceCount: distinct.invoiceCount,
    }
  }

  /**
   * The same costing grouped by month, technician or job type; no forced status, and a project invoice shared by two
   * jobs in one group counted once in it.
   */
  async function getProfitabilityByCategory(
    companyId: string,
    { groupBy = 'month', startDate, endDate, status }:
      { groupBy?: string; startDate?: string; endDate?: string; status?: string } = {},
  ) {
    const jobs: any[] = await q.jobsForProfitability(db, companyId, SUMMARY_JOB_COLUMNS, { status, startDate, endDate, ceiling: TOTALS_CEILING })

    const keys: JobKey[] = jobs.map((j) => ({ id: j.id, quoteId: j.quoteId, projectId: j.projectId }))
    const [{ byJob }, costMap] = await Promise.all([
      attributeRevenue(companyId, keys),
      costsByJob(companyId, jobs.map((j) => j.id)),
    ])

    const keyOf = (j: any) => {
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

  return { getJobCostAnalysis, getJobCostingSummary, getProfitabilityByCategory, costsByJob, attributeRevenue }
}

export type JobCostingService = ReturnType<typeof createJobCostingService>

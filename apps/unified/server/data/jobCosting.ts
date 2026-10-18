// Job costing: the queries of the CRM template's services/jobCosting.ts (templates/crm/backend/src/services) that carry
// SQL expressions (sums, the rate that applies, the date a job is grouped by). One named function per query, each
// returning camelCase objects; the arithmetic on them stays in crm/field/jobCostingService.ts.
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import {
  job, quoteLineItem, pricebookItem, timeEntry, teamMember, inventoryUsage, inventoryItem, expense, user, vendorBill,
} from '../db/schema/index.ts'

/** Statuses that are spend. Mirrors /api/bills/summary/job/:jobId, so the two agree. */
const BILL_IS_SPEND = ['open', 'partial', 'paid']

/** The roster row for a time entry's person: same company, same email (case-insensitive). */
const rosterJoin = (companyId: string) => and(eq(teamMember.companyId, companyId), sql`lower(${teamMember.email}) = lower(${user.email})`)

/**
 * Labour per job: hours, cost at the rate that applies (the entry's, else the person's, else a non-zero roster rate),
 * and the hours with no rate at all. COALESCE in SQL so the grouped sum and the per-row detail cannot drift apart.
 */
export async function labourByJob(db: any, companyId: string, jobIds: string[]) {
  const rate = sql`COALESCE(${timeEntry.hourlyRate}, ${user.hourlyRate}, NULLIF(${teamMember.hourlyRate}, 0))`
  return db.select({
    jobId: timeEntry.jobId,
    hours: sql<string>`COALESCE(SUM(${timeEntry.hours}), 0)`,
    cost: sql<string>`COALESCE(SUM(${timeEntry.hours} * COALESCE(${rate}, 0)), 0)`,
    unratedHours: sql<string>`COALESCE(SUM(CASE WHEN ${rate} IS NULL THEN ${timeEntry.hours} ELSE 0 END), 0)`,
  })
    .from(timeEntry)
    .leftJoin(user, eq(timeEntry.userId, user.id))
    .leftJoin(teamMember, rosterJoin(companyId))
    .where(and(eq(timeEntry.companyId, companyId), inArray(timeEntry.jobId, jobIds)))
    .groupBy(timeEntry.jobId) as Promise<Array<{ jobId: string | null; hours: string; cost: string; unratedHours: string }>>
}

/** Inventory drawn against each job, at the usage's cost else the item's. */
export async function materialCostByJob(db: any, companyId: string, jobIds: string[]) {
  return db.select({
    jobId: inventoryUsage.jobId,
    cost: sql<string>`COALESCE(SUM(${inventoryUsage.quantity} * COALESCE(${inventoryUsage.unitCost}, ${inventoryItem.unitCost}, 0)), 0)`,
  })
    .from(inventoryUsage)
    .leftJoin(inventoryItem, eq(inventoryUsage.itemId, inventoryItem.id))
    .where(and(eq(inventoryUsage.companyId, companyId), inArray(inventoryUsage.jobId, jobIds)))
    .groupBy(inventoryUsage.jobId) as Promise<Array<{ jobId: string | null; cost: string }>>
}

/** Expenses per job, and the subcontractor slice of them. */
export async function expenseCostByJob(db: any, companyId: string, jobIds: string[]) {
  return db.select({
    jobId: expense.jobId,
    total: sql<string>`COALESCE(SUM(${expense.amount}), 0)`,
    subcontractor: sql<string>`COALESCE(SUM(CASE WHEN ${expense.category} = 'subcontractor' THEN ${expense.amount} ELSE 0 END), 0)`,
  })
    .from(expense)
    .where(and(eq(expense.companyId, companyId), inArray(expense.jobId, jobIds)))
    .groupBy(expense.jobId) as Promise<Array<{ jobId: string | null; total: string; subcontractor: string }>>
}

/** Vendor bills per job that are spend (open, partial, paid). */
export async function billedCostByJob(db: any, companyId: string, jobIds: string[]) {
  return db.select({
    jobId: vendorBill.jobId,
    billed: sql<string>`COALESCE(SUM(${vendorBill.amount}), 0)`,
  })
    .from(vendorBill)
    .where(and(
      eq(vendorBill.companyId, companyId),
      inArray(vendorBill.jobId, jobIds),
      inArray(vendorBill.status, BILL_IS_SPEND),
    ))
    .groupBy(vendorBill.jobId) as Promise<Array<{ jobId: string | null; billed: string }>>
}

/**
 * What each quote's lines say the work costs (COST, never price: T49): labour (labor/service), material
 * (material/part), other costed lines, the lines with no cost, and the catalogue's labour hours.
 */
export async function quoteEstimateRows(db: any, quoteIds: string[]) {
  const lineCost = sql`${quoteLineItem.quantity} * ${quoteLineItem.unitCost}`
  return db.select({
    quoteId: quoteLineItem.quoteId,
    labor: sql<string>`COALESCE(SUM(CASE WHEN ${quoteLineItem.type} IN ('labor', 'service') AND ${quoteLineItem.unitCost} IS NOT NULL THEN ${lineCost} ELSE 0 END), 0)`,
    material: sql<string>`COALESCE(SUM(CASE WHEN ${quoteLineItem.type} IN ('material', 'part') AND ${quoteLineItem.unitCost} IS NOT NULL THEN ${lineCost} ELSE 0 END), 0)`,
    other: sql<string>`COALESCE(SUM(CASE WHEN ${quoteLineItem.unitCost} IS NOT NULL AND (${quoteLineItem.type} IS NULL OR ${quoteLineItem.type} NOT IN ('labor', 'service', 'material', 'part')) THEN ${lineCost} ELSE 0 END), 0)`,
    uncosted: sql<string>`COUNT(*) FILTER (WHERE ${quoteLineItem.unitCost} IS NULL)`,
    laborHours: sql<string>`COALESCE(SUM(${quoteLineItem.quantity} * COALESCE(${pricebookItem.laborHours}, 0)), 0)`,
  })
    .from(quoteLineItem)
    .leftJoin(pricebookItem, eq(pricebookItem.id, quoteLineItem.pricebookItemId))
    .where(inArray(quoteLineItem.quoteId, quoteIds))
    .groupBy(quoteLineItem.quoteId) as Promise<Array<{ quoteId: string; labor: string; material: string; other: string; uncosted: string; laborHours: string }>>
}

/** One job's time entries with the person and their roster rate (for the labour detail). */
export async function jobTimeEntriesWithRates(db: any, companyId: string, jobId: string) {
  return db.select({
    entry: timeEntry,
    user: { firstName: user.firstName, lastName: user.lastName, hourlyRate: user.hourlyRate },
    teamMember: { hourlyRate: teamMember.hourlyRate },
  })
    .from(timeEntry)
    .leftJoin(user, eq(timeEntry.userId, user.id))
    .leftJoin(teamMember, rosterJoin(companyId))
    .where(and(eq(timeEntry.jobId, jobId), eq(timeEntry.companyId, companyId)))
}

/**
 * The jobs a profitability table groups, filtered by the day each completed or, failing that, was raised; with the
 * assigned technician's name. Newest first, at most `ceiling`.
 */
export async function jobsForProfitability(
  db: any, companyId: string, columns: Record<string, any>,
  { status, startDate, endDate, ceiling }: { status?: string; startDate?: string; endDate?: string; ceiling: number },
) {
  const when = sql`COALESCE(${job.completedAt}, ${job.createdAt})`
  const conditions: any[] = [eq(job.companyId, companyId)]
  if (status) conditions.push(eq(job.status, status))
  if (startDate) conditions.push(gte(when, new Date(startDate)))
  if (endDate) conditions.push(lte(when, new Date(endDate)))
  return db.select({ ...columns, techFirst: user.firstName, techLast: user.lastName })
    .from(job)
    .leftJoin(user, eq(job.assignedToId, user.id))
    .where(and(...conditions))
    .orderBy(desc(job.createdAt))
    .limit(ceiling)
}

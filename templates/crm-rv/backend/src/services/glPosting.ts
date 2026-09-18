/**
 * GL Posting — native general ledger.
 *
 * Posts real revenue + COGS + gross profit to accounting_entry whenever a counter
 * sale completes or a repair order closes. This is the book of record for P&L and
 * department gross. A QuickBooks push can layer on later (postedToQb/qbRef) without
 * changing this — same swappable-rail pattern as financing/valuation.
 */
import { db } from '../../db/index.ts'
import { accountingEntry, counterSale, counterSaleLine, repairOrder, repairOrderPart } from '../../db/schema.ts'
import { and, eq, sql, desc, gte, lte } from 'drizzle-orm'

async function upsertEntry(companyId: string, e: {
  category: string
  sourceType: string
  sourceId: string
  ref?: string | null
  description?: string | null
  revenue: number
  cost: number
  tax?: number
  customerId?: string | null
}) {
  const gross = e.revenue - e.cost
  const [row] = await db.insert(accountingEntry).values({
    companyId,
    category: e.category,
    sourceType: e.sourceType,
    sourceId: e.sourceId,
    ref: e.ref ?? null,
    description: e.description ?? null,
    revenue: String(e.revenue),
    cost: String(e.cost),
    tax: String(e.tax ?? 0),
    grossProfit: String(gross),
    customerId: e.customerId ?? null,
  }).onConflictDoUpdate({
    target: [accountingEntry.companyId, accountingEntry.sourceType, accountingEntry.sourceId],
    set: {
      revenue: String(e.revenue), cost: String(e.cost), tax: String(e.tax ?? 0),
      grossProfit: String(gross), ref: e.ref ?? null, description: e.description ?? null,
      customerId: e.customerId ?? null, updatedAt: new Date(),
    },
  }).returning()
  return row
}

/** Post a completed counter sale to the GL. Idempotent. */
export async function postCounterSale(companyId: string, saleId: string) {
  const [sale] = await db.select().from(counterSale)
    .where(and(eq(counterSale.id, saleId), eq(counterSale.companyId, companyId))).limit(1)
  if (!sale) return null
  const lines = await db.select().from(counterSaleLine).where(eq(counterSaleLine.counterSaleId, saleId))
  const revenue = lines.reduce((s, l) => s + Number(l.totalPrice), 0)
  const cost = lines.reduce((s, l) => s + Number(l.unitCost) * l.quantity, 0)
  return upsertEntry(companyId, {
    category: 'parts',
    sourceType: 'counter_sale',
    sourceId: saleId,
    ref: sale.saleNumber,
    description: 'Parts counter sale',
    revenue,
    cost,
    tax: Number(sale.tax),
    customerId: sale.customerId,
  })
}

/** Post a repair order's parts to the GL. Idempotent. */
export async function postRepairOrderParts(companyId: string, roId: string) {
  const [ro] = await db.select().from(repairOrder)
    .where(and(eq(repairOrder.id, roId), eq(repairOrder.companyId, companyId))).limit(1)
  if (!ro) return null
  const lines = await db.select().from(repairOrderPart).where(eq(repairOrderPart.repairOrderId, roId))
  if (lines.length === 0) return null // no parts to post
  const revenue = lines.reduce((s, l) => s + Number(l.totalPrice), 0)
  const cost = lines.reduce((s, l) => s + Number(l.unitCost) * l.quantity, 0)
  return upsertEntry(companyId, {
    category: 'service',
    sourceType: 'repair_order',
    sourceId: roId,
    ref: ro.roNumber,
    description: 'Repair order parts',
    revenue,
    cost,
    customerId: ro.customerId,
  })
}

export async function listEntries(companyId: string, { limit = 100, from, to }: { limit?: number; from?: string; to?: string } = {}) {
  const conds = [eq(accountingEntry.companyId, companyId)]
  if (from) conds.push(gte(accountingEntry.entryDate, new Date(from)))
  if (to) conds.push(lte(accountingEntry.entryDate, new Date(to)))
  return db.select().from(accountingEntry).where(and(...conds)).orderBy(desc(accountingEntry.entryDate)).limit(limit)
}

/** P&L / gross summary across all posted entries. */
export async function summary(companyId: string) {
  const rows = await db.select({
    category: accountingEntry.category,
    revenue: sql<string>`coalesce(sum(${accountingEntry.revenue}), 0)`,
    cost: sql<string>`coalesce(sum(${accountingEntry.cost}), 0)`,
    gross: sql<string>`coalesce(sum(${accountingEntry.grossProfit}), 0)`,
    count: sql<number>`count(*)`,
  }).from(accountingEntry).where(eq(accountingEntry.companyId, companyId)).groupBy(accountingEntry.category)

  const byCategory = rows.map(r => ({
    category: r.category, revenue: Number(r.revenue), cost: Number(r.cost), grossProfit: Number(r.gross), count: Number(r.count),
  }))
  const totals = byCategory.reduce((a, r) => ({
    revenue: a.revenue + r.revenue, cost: a.cost + r.cost, grossProfit: a.grossProfit + r.grossProfit, count: a.count + r.count,
  }), { revenue: 0, cost: 0, grossProfit: 0, count: 0 })

  const [{ pending }] = await db.select({ pending: sql<number>`count(*)` }).from(accountingEntry)
    .where(and(eq(accountingEntry.companyId, companyId), eq(accountingEntry.postedToQb, false)))

  return { totals, byCategory, qbPending: Number(pending) }
}

/** Mark entries as pushed to QuickBooks (stub until QBO OAuth is connected). */
export async function syncToQb(companyId: string) {
  const pend = await db.select().from(accountingEntry)
    .where(and(eq(accountingEntry.companyId, companyId), eq(accountingEntry.postedToQb, false)))
  if (pend.length === 0) return { posted: 0, total: 0 }
  const total = pend.reduce((s, e) => s + Number(e.revenue), 0)
  await db.update(accountingEntry)
    .set({ postedToQb: true, qbRef: sql`'SYNC-' || ${accountingEntry.id}`, updatedAt: new Date() })
    .where(and(eq(accountingEntry.companyId, companyId), eq(accountingEntry.postedToQb, false)))
  return { posted: pend.length, total }
}

export default { postCounterSale, postRepairOrderParts, listEntries, summary, syncToQb }

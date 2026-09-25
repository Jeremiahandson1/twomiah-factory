/**
 * lib/inventory/stock.ts — inventory against the database.
 *
 * On hand is never typed in directly except by counting. Between counts it's
 * estimated: the last count + what's been received since − what the register
 * says was used since (recipes × paid items, and each tap pour's snapshot).
 * The arithmetic lives in costing.ts; this file gathers the rows.
 */
import { and, asc, desc, eq, gt, inArray, lte, ne, sql } from 'drizzle-orm'
import type { db as DB } from '../../db'
import {
  checkItems, checks, menuItems, menuSections, purchaseOrderLines, purchaseOrders, recipeLines, stockCountLines, stockCounts, stockItems, taps, vendors,
} from '../../db/schema'
import { slugify, sizesOf } from '../menu/sizes'
import { CATEGORIES, UNITS, costOf, costPct, engineerMenu, linesForSize, num, packsToOrder, theoreticalUse, unitCostCents, variance, type Sold } from './costing'

export class StockError extends Error { constructor(message: string, public status = 400) { super(message) } }

type Item = typeof stockItems.$inferSelect
const clean = (v: unknown, max: number) => { const s = String(v ?? '').trim().slice(0, max); return s || null }
const qtyOf = (v: unknown, what = 'amount') => {
  const n = Number(String(v ?? '').replace(/[^\d.\-]/g, ''))
  if (!Number.isFinite(n) || n < 0 || n > 1e7) throw new StockError(`Check the ${what}.`)
  return n
}

// ─── What the register sold ─────────────────────────────────────────────────
/** Paid items closed after `from` (and up to `to`), in the shape costing.ts wants. */
export async function soldBetween(db: typeof DB, from: Date | null, to: Date | null = null): Promise<Array<Sold & { closedAt: Date; name: string; unitPriceCents: number; sectionKind: string | null }>> {
  const conds = [eq(checks.status, 'paid'), ne(checkItems.state, 'void'), eq(checkItems.kind, 'item')]
  if (from) conds.push(gt(checks.closedAt, from))
  if (to) conds.push(lte(checks.closedAt, to))
  const rows = await db.select({
    menuItemId: checkItems.menuItemId, size: checkItems.size, qty: checkItems.qty, name: checkItems.name, unitPriceCents: checkItems.unitPriceCents,
    stockItemId: checkItems.stockItemId, stockQty: checkItems.stockQty, tapId: checkItems.tapId, closedAt: checks.closedAt, sectionKind: menuSections.kind,
  }).from(checkItems).innerJoin(checks, eq(checks.id, checkItems.checkId))
    .leftJoin(menuItems, eq(menuItems.id, checkItems.menuItemId)).leftJoin(menuSections, eq(menuSections.id, menuItems.sectionId))
    .where(and(...conds))
  return rows.map(r => ({
    menuItemId: r.menuItemId, sizeId: slugify(r.size || 'Regular'), qty: r.qty, stockItemId: r.stockItemId, stockQty: r.stockQty,
    closedAt: r.closedAt as Date, name: r.name, unitPriceCents: r.unitPriceCents, sectionKind: r.tapId ? 'drink' : r.sectionKind,
  }))
}

async function recipeMap(db: typeof DB) {
  const lines = await db.select().from(recipeLines)
  const m = new Map<string, Array<typeof recipeLines.$inferSelect>>()
  for (const l of lines) { const a = m.get(l.menuItemId) || []; a.push(l); m.set(l.menuItemId, a) }
  return m
}

// ─── Stock list with on-hand estimates ──────────────────────────────────────
export interface StockRow {
  id: string; name: string; category: string; unit: string; unitLabel: string; packName: string; packSize: number; packCostCents: number | null
  unitCostCents: number | null; vendorId: string | null; vendorName: string | null; parPacks: number | null; isActive: boolean
  lastCountAt: string | null; lastCountQty: number | null; receivedSince: number; usedSince: number
  onHand: number | null; onHandPacks: number | null; low: boolean; suggestPacks: number
}

export async function stockList(db: typeof DB, opts: { includeInactive?: boolean } = {}): Promise<StockRow[]> {
  const [items, vendorRows, doneCounts] = await Promise.all([
    db.select().from(stockItems).where(opts.includeInactive ? undefined : eq(stockItems.isActive, true)).orderBy(asc(stockItems.category), asc(stockItems.sortOrder), asc(stockItems.name)),
    db.select().from(vendors),
    db.select({ countId: stockCountLines.countId, stockItemId: stockCountLines.stockItemId, qty: stockCountLines.qty, at: stockCounts.finishedAt })
      .from(stockCountLines).innerJoin(stockCounts, eq(stockCounts.id, stockCountLines.countId)).where(eq(stockCounts.status, 'done')),
  ])
  // Latest finished count per item.
  const base = new Map<string, { qty: number; at: Date }>()
  for (const r of doneCounts) {
    const at = r.at as Date, prev = base.get(r.stockItemId)
    if (!prev || at > prev.at) base.set(r.stockItemId, { qty: num(r.qty), at })
  }
  const earliest = [...base.values()].reduce<Date | null>((m, b) => (!m || b.at < m ? b.at : m), null)
  const [sold, recipes, received] = await Promise.all([
    earliest ? soldBetween(db, earliest) : Promise.resolve([]),
    recipeMap(db),
    earliest ? db.select({ stockItemId: purchaseOrderLines.stockItemId, packs: purchaseOrderLines.receivedPacks, at: purchaseOrders.receivedAt })
      .from(purchaseOrderLines).innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.orderId))
      .where(and(eq(purchaseOrders.status, 'received'), gt(purchaseOrders.receivedAt, earliest))) : Promise.resolve([]),
  ])
  const vName = new Map(vendorRows.map(v => [v.id, v.name]))
  return items.map((it) => {
    const b = base.get(it.id)
    const size = num(it.packSize)
    let receivedSince = 0, usedSince = 0, onHand: number | null = null
    if (b) {
      receivedSince = received.filter(r => r.stockItemId === it.id && (r.at as Date) > b.at).reduce((n, r) => n + num(r.packs) * size, 0)
      usedSince = theoreticalUse(sold.filter(s => s.closedAt > b.at), recipes).get(it.id) || 0
      onHand = Math.round((b.qty + receivedSince - usedSince) * 1000) / 1000
    }
    const par = it.parPacks === null ? null : num(it.parPacks)
    const suggest = onHand === null ? 0 : packsToOrder(onHand, it.packSize, it.parPacks)
    return {
      id: it.id, name: it.name, category: it.category, unit: it.unit, unitLabel: UNITS[it.unit] || it.unit, packName: it.packName, packSize: size,
      packCostCents: it.packCostCents, unitCostCents: unitCostCents(it), vendorId: it.vendorId, vendorName: it.vendorId ? vName.get(it.vendorId) || null : null,
      parPacks: par, isActive: it.isActive, lastCountAt: b ? b.at.toISOString() : null, lastCountQty: b ? b.qty : null,
      receivedSince: Math.round(receivedSince * 1000) / 1000, usedSince: Math.round(usedSince * 1000) / 1000,
      onHand, onHandPacks: onHand === null || size <= 0 ? null : Math.round((onHand / size) * 100) / 100,
      low: suggest > 0, suggestPacks: suggest,
    }
  })
}

export async function saveStockItem(db: typeof DB, id: string | null, b: Record<string, unknown>): Promise<Item> {
  const name = clean(b.name, 80)
  if (!name) throw new StockError('Name it.')
  const category = CATEGORIES.some(c => c.id === b.category) ? String(b.category) : 'food'
  const unit = b.unit && UNITS[String(b.unit)] ? String(b.unit) : 'each'
  const packSize = qtyOf(b.packSize ?? 1, 'pack size')
  if (packSize <= 0) throw new StockError('A pack holds at least something.')
  const cost = b.packCostCents === null || b.packCostCents === undefined || String(b.packCostCents) === '' ? null : Math.round(qtyOf(b.packCostCents, 'price'))
  const par = b.parPacks === null || b.parPacks === undefined || String(b.parPacks) === '' ? null : qtyOf(b.parPacks, 'par')
  const vendorId = typeof b.vendorId === 'string' && /^[0-9a-f-]{36}$/i.test(b.vendorId) ? b.vendorId : null
  const values = {
    name, category, unit, packName: clean(b.packName, 40) || (unit === 'each' ? 'each' : UNITS[unit]), packSize: String(packSize), packCostCents: cost,
    parPacks: par === null ? null : String(par), vendorId, isActive: b.isActive === undefined ? true : !!b.isActive, updatedAt: new Date(),
  }
  if (id) {
    const [row] = await db.update(stockItems).set(values).where(eq(stockItems.id, id)).returning()
    if (!row) throw new StockError('That item is gone.', 404)
    return row
  }
  const [row] = await db.insert(stockItems).values(values).returning()
  return row
}

// ─── Vendors ────────────────────────────────────────────────────────────────
export async function saveVendor(db: typeof DB, id: string | null, b: Record<string, unknown>) {
  const name = clean(b.name, 80)
  if (!name) throw new StockError('Name the vendor.')
  const email = clean(b.email, 120)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new StockError("That email doesn't look right.")
  const values = { name, contact: clean(b.contact, 80), phone: clean(b.phone, 30), email, orderDays: clean(b.orderDays, 60), note: clean(b.note, 300), isActive: b.isActive === undefined ? true : !!b.isActive }
  if (id) {
    const [row] = await db.update(vendors).set(values).where(eq(vendors.id, id)).returning()
    if (!row) throw new StockError('That vendor is gone.', 404)
    return row
  }
  const [row] = await db.insert(vendors).values(values).returning()
  return row
}

// ─── Recipes, plate cost, menu engineering ──────────────────────────────────
export async function recipeBook(db: typeof DB) {
  const [sections, items, stock, recipes, tapRows] = await Promise.all([
    db.select().from(menuSections).orderBy(asc(menuSections.sortOrder)),
    db.select().from(menuItems).where(eq(menuItems.isActive, true)).orderBy(asc(menuItems.sortOrder), asc(menuItems.name)),
    db.select().from(stockItems),
    recipeMap(db),
    db.select().from(taps).where(eq(taps.isActive, true)).orderBy(asc(taps.lineNumber)),
  ])
  const stockMap = new Map(stock.map(s => [s.id, s]))
  const out = sections.map(s => ({
    id: s.id, name: s.name, kind: s.kind,
    items: items.filter(i => i.sectionId === s.id).map((i) => {
      const lines = recipes.get(i.id) || []
      return {
        id: i.id, name: i.name,
        lines: lines.map(l => ({ id: l.id, sizeId: l.sizeId, stockItemId: l.stockItemId, qty: num(l.qty), name: stockMap.get(l.stockItemId)?.name || '?', unit: UNITS[stockMap.get(l.stockItemId)?.unit || 'each'] })),
        sizes: sizesOf(i, s.description).map((z) => {
          const c = costOf(linesForSize(lines, z.id), stockMap)
          return { id: z.id, name: z.name, priceCents: z.priceCents, costCents: c.costCents, missing: c.missing, pct: costPct(c.costCents, z.priceCents), hasRecipe: linesForSize(lines, z.id).length > 0 }
        }),
      }
    }),
  })).filter(s => s.items.length)
  const pours = tapRows.map((t) => {
    const keg = t.stockItemId ? stockMap.get(t.stockItemId) : null
    const u = keg ? unitCostCents(keg) : null
    const costCents = u === null ? null : Math.round(u * num(t.pourOz))
    return { tapId: t.id, line: t.lineNumber, beer: t.beerName, priceCents: t.priceCents, stockItemId: t.stockItemId, stockName: keg?.name || null, pourOz: num(t.pourOz), costCents, pct: costPct(costCents, t.priceCents) }
  })
  return { sections: out, pours }
}

export async function setRecipe(db: typeof DB, menuItemId: string, sizeId: string | null, lines: Array<{ stockItemId: string; qty: unknown }>) {
  const [item] = await db.select({ id: menuItems.id }).from(menuItems).where(eq(menuItems.id, menuItemId)).limit(1)
  if (!item) throw new StockError('That menu item is gone.', 404)
  const clean = lines.filter(l => l && /^[0-9a-f-]{36}$/i.test(String(l.stockItemId))).map(l => ({ stockItemId: String(l.stockItemId), qty: qtyOf(l.qty, 'quantity') })).filter(l => l.qty > 0)
  if (clean.length) {
    const known = await db.select({ id: stockItems.id }).from(stockItems).where(inArray(stockItems.id, clean.map(l => l.stockItemId)))
    if (known.length !== new Set(clean.map(l => l.stockItemId)).size) throw new StockError('One of those stock items is gone.', 404)
  }
  const size = sizeId ? slugify(sizeId) : null
  await db.transaction(async (tx) => {
    await tx.delete(recipeLines).where(and(eq(recipeLines.menuItemId, menuItemId), size ? eq(recipeLines.sizeId, size) : sql`${recipeLines.sizeId} is null`))
    if (clean.length) await tx.insert(recipeLines).values(clean.map(l => ({ menuItemId, sizeId: size, stockItemId: l.stockItemId, qty: String(l.qty) })))
  })
}

export async function setTapPour(db: typeof DB, tapId: string, b: { stockItemId?: unknown; pourOz?: unknown }) {
  const set: Partial<typeof taps.$inferInsert> = { updatedAt: new Date() }
  if (b.stockItemId !== undefined) set.stockItemId = typeof b.stockItemId === 'string' && /^[0-9a-f-]{36}$/i.test(b.stockItemId) ? b.stockItemId : null
  if (b.pourOz !== undefined) { const oz = qtyOf(b.pourOz, 'pour'); if (oz <= 0 || oz > 64) throw new StockError('A pour is 1 to 64 oz.'); set.pourOz = String(oz) }
  const [row] = await db.update(taps).set(set).where(eq(taps.id, tapId)).returning()
  if (!row) throw new StockError('That tap is gone.', 404)
  return row
}

/** Popularity × margin over the last `days` of paid checks, per item and size. */
export async function menuEngineering(db: typeof DB, days = 30) {
  const from = new Date(Date.now() - days * 86400000)
  const [sold, book] = await Promise.all([soldBetween(db, from), recipeBook(db)])
  const cost = new Map<string, number | null>()
  for (const s of book.sections) for (const i of s.items) for (const z of i.sizes) cost.set(i.id + '|' + z.id, z.costCents)
  const agg = new Map<string, { name: string; sold: number; revenue: number; costCents: number | null; kind: string }>()
  for (const s of sold) {
    if (!s.menuItemId) continue
    const key = s.menuItemId + '|' + s.sizeId
    const a = agg.get(key) || { name: s.name + (s.sizeId !== 'regular' ? ` (${s.sizeId.replace(/-/g, ' ')})` : ''), sold: 0, revenue: 0, costCents: cost.get(key) ?? null, kind: s.sectionKind || 'food' }
    a.sold += s.qty; a.revenue += s.qty * s.unitPriceCents
    agg.set(key, a)
  }
  const rows = [...agg].filter(([, a]) => a.kind !== 'drink').map(([key, a]) => ({ key, name: a.name, sold: a.sold, priceCents: Math.round(a.revenue / a.sold), costCents: a.costCents }))
  return { days, ...engineerMenu(rows) }
}

// ─── Counting ───────────────────────────────────────────────────────────────
/** The count in progress (one at a time; several people can count into it). */
export async function currentCount(db: typeof DB, by: string, create = true) {
  let [c] = await db.select().from(stockCounts).where(eq(stockCounts.status, 'open')).orderBy(desc(stockCounts.startedAt)).limit(1)
  if (!c && create) [c] = await db.insert(stockCounts).values({ startedBy: by }).returning()
  if (!c) return null
  const lines = await db.select().from(stockCountLines).where(eq(stockCountLines.countId, c.id))
  return { ...c, lines: lines.map(l => ({ stockItemId: l.stockItemId, qty: num(l.qty), countedBy: l.countedBy, countedAt: l.countedAt })) }
}

/** Record one item: packs + loose units → units. Blank clears it. */
export async function countItem(db: typeof DB, countId: string, stockItemId: string, input: { packs?: unknown; units?: unknown; clear?: boolean }, by: string) {
  const [c] = await db.select().from(stockCounts).where(eq(stockCounts.id, countId)).limit(1)
  if (!c || c.status !== 'open') throw new StockError('That count is finished. Start a new one.', 409)
  const [it] = await db.select().from(stockItems).where(eq(stockItems.id, stockItemId)).limit(1)
  if (!it) throw new StockError('That item is gone.', 404)
  if (input.clear) { await db.delete(stockCountLines).where(and(eq(stockCountLines.countId, countId), eq(stockCountLines.stockItemId, stockItemId))); return null }
  const packs = input.packs === undefined || String(input.packs) === '' ? 0 : qtyOf(input.packs, 'count')
  const units = input.units === undefined || String(input.units) === '' ? 0 : qtyOf(input.units, 'count')
  const qty = Math.round((packs * num(it.packSize) + units) * 1000) / 1000
  await db.insert(stockCountLines).values({ countId, stockItemId, qty: String(qty), countedBy: by })
    .onConflictDoUpdate({ target: [stockCountLines.countId, stockCountLines.stockItemId], set: { qty: String(qty), countedBy: by, countedAt: new Date() } })
  return qty
}

export async function finishCount(db: typeof DB, countId: string, by: string) {
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(stockCountLines).where(eq(stockCountLines.countId, countId))
  if (!n?.n) throw new StockError('Nothing counted yet.')
  const [c] = await db.update(stockCounts).set({ status: 'done', finishedAt: new Date(), finishedBy: by }).where(and(eq(stockCounts.id, countId), eq(stockCounts.status, 'open'))).returning()
  if (!c) throw new StockError('That count is already finished.', 409)
  return c
}

export async function countHistory(db: typeof DB) {
  const rows = await db.select({ id: stockCounts.id, status: stockCounts.status, startedAt: stockCounts.startedAt, finishedAt: stockCounts.finishedAt, finishedBy: stockCounts.finishedBy, items: sql<number>`(select count(*)::int from stock_count_lines l where l.count_id = "stock_counts"."id")` })
    .from(stockCounts).orderBy(desc(stockCounts.startedAt)).limit(50)
  return rows
}

/**
 * This count against the one before it: what should have been used, what was,
 * the difference in dollars, and food cost / pour cost for the period.
 */
export async function countReport(db: typeof DB, countId: string) {
  const [c] = await db.select().from(stockCounts).where(eq(stockCounts.id, countId)).limit(1)
  if (!c || c.status !== 'done' || !c.finishedAt) throw new StockError('Finish the count first.', 409)
  const [prev] = await db.select().from(stockCounts).where(and(eq(stockCounts.status, 'done'), sql`${stockCounts.finishedAt} < ${c.finishedAt}`)).orderBy(desc(stockCounts.finishedAt)).limit(1)
  if (!prev?.finishedAt) return { count: c, previous: null, rows: [], totals: null }
  const lineMap = async (id: string) => new Map((await db.select().from(stockCountLines).where(eq(stockCountLines.countId, id))).map(l => [l.stockItemId, num(l.qty)]))
  const [start, end, items, sold, recipes, rec] = await Promise.all([
    lineMap(prev.id), lineMap(c.id), db.select().from(stockItems), soldBetween(db, prev.finishedAt, c.finishedAt), recipeMap(db),
    db.select({ stockItemId: purchaseOrderLines.stockItemId, packs: purchaseOrderLines.receivedPacks }).from(purchaseOrderLines).innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.orderId))
      .where(and(eq(purchaseOrders.status, 'received'), gt(purchaseOrders.receivedAt, prev.finishedAt), lte(purchaseOrders.receivedAt, c.finishedAt))),
  ])
  const size = new Map(items.map(i => [i.id, num(i.packSize)]))
  const received = new Map<string, number>()
  for (const r of rec) received.set(r.stockItemId, (received.get(r.stockItemId) || 0) + num(r.packs) * (size.get(r.stockItemId) || 0))
  const rows = variance(items, start, end, received, theoreticalUse(sold, recipes))
  const sum = (xs: Array<number | null>) => xs.reduce<number>((n, x) => n + (x || 0), 0)
  const drinkCats = new Set(['beer', 'liquor', 'wine'])
  const foodUsed = sum(rows.filter(r => r.category === 'food').map(r => r.actualCents))
  const drinkUsed = sum(rows.filter(r => drinkCats.has(r.category)).map(r => r.actualCents))
  const foodSales = sold.filter(s => s.sectionKind !== 'drink').reduce((n, s) => n + s.qty * s.unitPriceCents, 0)
  const drinkSales = sold.filter(s => s.sectionKind === 'drink').reduce((n, s) => n + s.qty * s.unitPriceCents, 0)
  return {
    count: c, previous: prev, rows,
    totals: {
      varianceCents: sum(rows.map(r => r.varianceCents)), foodUsedCents: foodUsed, drinkUsedCents: drinkUsed, foodSalesCents: foodSales, drinkSalesCents: drinkSales,
      foodCostPct: costPct(foodUsed, foodSales), pourCostPct: costPct(drinkUsed, drinkSales),
    },
  }
}

// ─── Purchase orders ────────────────────────────────────────────────────────
export async function orderList(db: typeof DB) {
  const [orders, lines, vendorRows, items] = await Promise.all([
    db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.createdAt)).limit(60),
    db.select().from(purchaseOrderLines),
    db.select().from(vendors),
    db.select().from(stockItems),
  ])
  const vName = new Map(vendorRows.map(v => [v.id, v])), iName = new Map(items.map(i => [i.id, i]))
  return orders.map(o => {
    const ls = lines.filter(l => l.orderId === o.id).map(l => ({ ...l, packs: num(l.packs), receivedPacks: l.receivedPacks === null ? null : num(l.receivedPacks), name: iName.get(l.stockItemId)?.name || '?', packName: iName.get(l.stockItemId)?.packName || '' }))
    return { ...o, vendor: o.vendorId ? vName.get(o.vendorId) || null : null, lines: ls, totalCents: ls.reduce((n, l) => n + Math.round(l.packs * (l.packCostCents || 0)), 0) }
  })
}

/** One draft per vendor for everything below par. Items with no vendor go on one "no vendor" draft. */
export async function draftFromLow(db: typeof DB, by: string) {
  const low = (await stockList(db)).filter(r => r.suggestPacks > 0)
  if (!low.length) throw new StockError('Nothing is below par.')
  const byVendor = new Map<string, StockRow[]>()
  for (const r of low) { const k = r.vendorId || ''; byVendor.set(k, [...(byVendor.get(k) || []), r]) }
  const made: string[] = []
  for (const [vendorId, rows] of byVendor) {
    const [po] = await db.insert(purchaseOrders).values({ vendorId: vendorId || null, createdBy: by }).returning()
    await db.insert(purchaseOrderLines).values(rows.map(r => ({ orderId: po.id, stockItemId: r.id, packs: String(r.suggestPacks), packCostCents: r.packCostCents })))
    made.push(po.id)
  }
  return made
}

export async function saveOrder(db: typeof DB, id: string | null, b: { vendorId?: unknown; note?: unknown; lines?: Array<{ stockItemId: string; packs: unknown; packCostCents?: unknown }> }, by: string) {
  if (id) {
    const [o] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1)
    if (!o) throw new StockError('That order is gone.', 404)
    if (o.status !== 'draft' && o.status !== 'sent') throw new StockError('That order is closed.', 409)
  }
  const vendorId = typeof b.vendorId === 'string' && /^[0-9a-f-]{36}$/i.test(b.vendorId) ? b.vendorId : null
  const lines = (b.lines || []).filter(l => /^[0-9a-f-]{36}$/i.test(String(l.stockItemId))).map(l => ({ stockItemId: String(l.stockItemId), packs: qtyOf(l.packs, 'quantity'), packCostCents: l.packCostCents === undefined || l.packCostCents === null || String(l.packCostCents) === '' ? null : Math.round(qtyOf(l.packCostCents, 'price')) })).filter(l => l.packs > 0)
  if (!lines.length) throw new StockError('Put something on the order.')
  return db.transaction(async (tx) => {
    let orderId = id
    if (orderId) await tx.update(purchaseOrders).set({ vendorId, note: clean(b.note, 300) }).where(eq(purchaseOrders.id, orderId))
    else [{ id: orderId }] = await tx.insert(purchaseOrders).values({ vendorId, note: clean(b.note, 300), createdBy: by }).returning({ id: purchaseOrders.id })
    await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, orderId!))
    await tx.insert(purchaseOrderLines).values(lines.map(l => ({ orderId: orderId!, stockItemId: l.stockItemId, packs: String(l.packs), packCostCents: l.packCostCents })))
    return orderId!
  })
}

export async function setOrderStatus(db: typeof DB, id: string, status: 'sent' | 'cancelled') {
  const [o] = await db.update(purchaseOrders).set({ status, ...(status === 'sent' ? { sentAt: new Date() } : {}) })
    .where(and(eq(purchaseOrders.id, id), inArray(purchaseOrders.status, ['draft', 'sent']))).returning()
  if (!o) throw new StockError('That order is closed.', 409)
  return o
}

/** Receive what came in. Each line: packs received and the price on the invoice (becomes the item's price). */
export async function receiveOrder(db: typeof DB, id: string, received: Array<{ lineId: string; packs: unknown; packCostCents?: unknown }>, by: string) {
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1)
    if (!o) throw new StockError('That order is gone.', 404)
    if (o.status === 'received' || o.status === 'cancelled') throw new StockError('That order is closed.', 409)
    const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, id))
    const given = new Map(received.map(r => [String(r.lineId), r]))
    for (const l of lines) {
      const r = given.get(l.id)
      const packs = r ? qtyOf(r.packs, 'quantity') : num(l.packs)   // not mentioned = came in as ordered
      const cost = r && r.packCostCents !== undefined && r.packCostCents !== null && String(r.packCostCents) !== '' ? Math.round(qtyOf(r.packCostCents, 'price')) : l.packCostCents
      await tx.update(purchaseOrderLines).set({ receivedPacks: String(packs), receivedCostCents: cost }).where(eq(purchaseOrderLines.id, l.id))
      if (cost !== null && packs > 0) await tx.update(stockItems).set({ packCostCents: cost, updatedAt: new Date() }).where(eq(stockItems.id, l.stockItemId))
    }
    const [done] = await tx.update(purchaseOrders).set({ status: 'received', receivedAt: new Date(), receivedBy: by }).where(eq(purchaseOrders.id, id)).returning()
    return done
  })
}

export function orderEmailHtml(o: { number: number; note: string | null; lines: Array<{ name: string; packs: number; packName: string }> }, company: string, address: string): string {
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] || ch))
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;padding:20px;">
  <p>Order #${o.number} from ${esc(company)}${address ? ', ' + esc(address) : ''}.</p>
  <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:15px;">${o.lines.map(l => `<tr><td style="border-bottom:1px solid #ddd;text-align:right;">${esc(l.packs)}</td><td style="border-bottom:1px solid #ddd;">${esc(l.packName)}</td><td style="border-bottom:1px solid #ddd;">${esc(l.name)}</td></tr>`).join('')}</table>
  ${o.note ? `<p>${esc(o.note)}</p>` : ''}<p>Reply to this email with any changes. Thanks.</p></body></html>`
}

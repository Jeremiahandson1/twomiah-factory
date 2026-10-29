// Stock against the database (routes/barStock.ts; the arithmetic is services/barCosting.ts).
//
// On hand is never typed in directly except by counting. Between counts it is estimated: the last count + what was
// received since − what the register says was used since (recipes × paid items, and each tap pour's snapshot).
// Every row is the company's; every id a request names (a vendor, a stock item, a menu item, a tap) is looked up in
// this company before it is used. Ported from website-premium-bar's lib/inventory/stock.ts (Amber Inn, 9/28).
//
// Moved from templates/crm-bar/backend/src/services/barStock.ts, made with the app's database; the PO counter, the
// line count and the count before this one are server/data/bar.ts.
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne } from 'drizzle-orm'
import {
  barCheck, barCheckItem, barMenuItem, barMenuSection, barPurchaseOrder, barPurchaseOrderLine, barRecipeLine,
  barStockCount, barStockCountLine, barStockItem, barTap, barVendor,
} from '../../db/schema/index.ts'
import { countLineTotal, finishedCountBefore, nextPoNumber } from '../../data/bar.ts'
import { slugify, sizesOf } from './barMenuSizes.ts'
import { CATEGORIES, UNITS, costOf, costPct, engineerMenu, linesForSize, num, packsToOrder, theoreticalUse, unitCostCents, variance, type Sold } from './barCosting.ts'
import { tapSizes } from './barTapSizes.ts'
import { onTheWayCondition } from './tileConditions.ts'
import type { BarDb } from './db.ts'

type Tx = any
export class StockError extends Error { constructor(message: string, public status = 400) { super(message) } }

const clean = (v: unknown, max: number) => { const s = String(v ?? '').trim().slice(0, max); return s || null }
const qtyOf = (v: unknown, what = 'amount') => {
  const n = Number(String(v ?? '').replace(/[^\d.\-]/g, ''))
  if (!Number.isFinite(n) || n < 0 || n > 1e7) throw new StockError(`Check the ${what}.`)
  return n
}

// ─── Stock list with on-hand estimates ──────────────────────────────────────
export interface StockRow {
  id: string; name: string; category: string; unit: string; unitLabel: string; packName: string; packSize: number; packCostCents: number | null
  unitCostCents: number | null; vendorId: string | null; vendorName: string | null; parPacks: number | null; isActive: boolean
  lastCountAt: string | null; lastCountQty: number | null; receivedSince: number; usedSince: number
  onHand: number | null; onHandPacks: number | null; low: boolean; suggestPacks: number
}

export function orderEmailHtml(o: { number: number; note: string | null; lines: Array<{ name: string; packs: number; packName: string }> }, companyName: string, address: string): string {
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] || ch))
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;padding:20px;">
  <p>Order #${o.number} from ${esc(companyName)}${address ? ', ' + esc(address) : ''}.</p>
  <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:15px;">${o.lines.map(l => `<tr><td style="border-bottom:1px solid #ddd;text-align:right;">${esc(l.packs)}</td><td style="border-bottom:1px solid #ddd;">${esc(l.packName)}</td><td style="border-bottom:1px solid #ddd;">${esc(l.name)}</td></tr>`).join('')}</table>
  ${o.note ? `<p>${esc(o.note)}</p>` : ''}<p>Reply to this email with any changes. Thanks.</p></body></html>`
}

export function createBarStock(db: BarDb) {
async function ownVendor(companyId: string, v: unknown, tx: Tx = db): Promise<string | null> {
  if (!v || typeof v !== 'string') return null
  const [r] = await tx.select({ id: barVendor.id }).from(barVendor).where(and(eq(barVendor.id, v), eq(barVendor.companyId, companyId))).limit(1)
  if (!r) throw new StockError('That vendor is gone.', 404)
  return r.id
}
async function ownStockIds(companyId: string, ids: string[], tx: Tx = db): Promise<void> {
  const want = [...new Set(ids)]
  if (!want.length) return
  const rows = await tx.select({ id: barStockItem.id }).from(barStockItem).where(and(eq(barStockItem.companyId, companyId), inArray(barStockItem.id, want)))
  if (rows.length !== want.length) throw new StockError('One of those stock items is gone.', 404)
}

// ─── What the register sold ─────────────────────────────────────────────────
/** Paid food and drink lines on checks closed after `from` (and up to `to`), in the shape barCosting wants. */
async function soldBetween(companyId: string, from: Date | null, to: Date | null = null): Promise<Array<Sold & { closedAt: Date; name: string; unitPriceCents: number; sectionKind: string | null }>> {
  const conds = [eq(barCheck.companyId, companyId), eq(barCheck.status, 'paid'), ne(barCheckItem.state, 'void'), eq(barCheckItem.kind, 'item')]
  if (from) conds.push(gt(barCheck.closedAt, from))
  if (to) conds.push(lte(barCheck.closedAt, to))
  const rows = await db.select({
    menuItemId: barCheckItem.menuItemId, size: barCheckItem.size, qty: barCheckItem.qty, name: barCheckItem.name, unitPriceCents: barCheckItem.unitPriceCents,
    stockItemId: barCheckItem.stockItemId, stockQty: barCheckItem.stockQty, tapId: barCheckItem.tapId, closedAt: barCheck.closedAt, sectionKind: barMenuSection.kind,
  }).from(barCheckItem).innerJoin(barCheck, eq(barCheck.id, barCheckItem.checkId))
    .leftJoin(barMenuItem, eq(barMenuItem.id, barCheckItem.menuItemId)).leftJoin(barMenuSection, eq(barMenuSection.id, barMenuItem.sectionId))
    .where(and(...conds))
  return rows.map(r => ({
    menuItemId: r.menuItemId, sizeId: slugify(r.size || 'Regular'), qty: r.qty, stockItemId: r.stockItemId, stockQty: r.stockQty,
    closedAt: r.closedAt as Date, name: r.name, unitPriceCents: r.unitPriceCents, sectionKind: r.tapId ? 'drink' : r.sectionKind,
  }))
}

async function recipeMap(companyId: string) {
  const lines = await db.select().from(barRecipeLine).where(eq(barRecipeLine.companyId, companyId))
  const m = new Map<string, Array<typeof barRecipeLine.$inferSelect>>()
  for (const l of lines) { const a = m.get(l.menuItemId) || []; a.push(l); m.set(l.menuItemId, a) }
  return m
}

// ─── Stock list with on-hand estimates (StockRow, above) ─────────────────────
async function stockList(companyId: string, opts: { includeInactive?: boolean } = {}): Promise<StockRow[]> {
  const [items, vendorRows, doneCounts] = await Promise.all([
    db.select().from(barStockItem).where(opts.includeInactive ? eq(barStockItem.companyId, companyId) : and(eq(barStockItem.companyId, companyId), eq(barStockItem.isActive, true)))
      .orderBy(asc(barStockItem.category), asc(barStockItem.sortOrder), asc(barStockItem.name)),
    db.select().from(barVendor).where(eq(barVendor.companyId, companyId)),
    db.select({ stockItemId: barStockCountLine.stockItemId, qty: barStockCountLine.qty, at: barStockCount.finishedAt })
      .from(barStockCountLine).innerJoin(barStockCount, eq(barStockCount.id, barStockCountLine.countId))
      .where(and(eq(barStockCount.companyId, companyId), eq(barStockCount.status, 'done'))),
  ])
  // The latest finished count per item.
  const base = new Map<string, { qty: number; at: Date }>()
  for (const r of doneCounts) {
    const at = r.at as Date, prev = base.get(r.stockItemId)
    if (!prev || at > prev.at) base.set(r.stockItemId, { qty: num(r.qty), at })
  }
  const earliest = [...base.values()].reduce<Date | null>((m, b) => (!m || b.at < m ? b.at : m), null)
  const [sold, recipes, received] = await Promise.all([
    earliest ? soldBetween(companyId, earliest) : Promise.resolve([]),
    recipeMap(companyId),
    earliest ? db.select({ stockItemId: barPurchaseOrderLine.stockItemId, packs: barPurchaseOrderLine.receivedPacks, at: barPurchaseOrder.receivedAt })
      .from(barPurchaseOrderLine).innerJoin(barPurchaseOrder, eq(barPurchaseOrder.id, barPurchaseOrderLine.orderId))
      .where(and(eq(barPurchaseOrder.companyId, companyId), eq(barPurchaseOrder.status, 'received'), gt(barPurchaseOrder.receivedAt, earliest))) : Promise.resolve([]),
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

async function saveStockItem(companyId: string, id: string | null, b: Record<string, unknown>) {
  const name = clean(b.name, 80)
  if (!name) throw new StockError('Name it.')
  const category = CATEGORIES.some(c => c.id === b.category) ? String(b.category) : 'food'
  const unit = b.unit && UNITS[String(b.unit)] ? String(b.unit) : 'each'
  const packSize = qtyOf(b.packSize ?? 1, 'pack size')
  if (packSize <= 0) throw new StockError('A pack holds at least something.')
  const cost = b.packCostCents === null || b.packCostCents === undefined || String(b.packCostCents) === '' ? null : Math.round(qtyOf(b.packCostCents, 'price'))
  const par = b.parPacks === null || b.parPacks === undefined || String(b.parPacks) === '' ? null : qtyOf(b.parPacks, 'par')
  const values = {
    name, category, unit, packName: clean(b.packName, 40) || (unit === 'each' ? 'each' : UNITS[unit]), packSize: String(packSize), packCostCents: cost,
    parPacks: par === null ? null : String(par), vendorId: await ownVendor(companyId, b.vendorId), isActive: b.isActive === undefined ? true : !!b.isActive, updatedAt: new Date(),
  }
  if (id) {
    const [row] = await db.update(barStockItem).set(values).where(and(eq(barStockItem.id, id), eq(barStockItem.companyId, companyId))).returning()
    if (!row) throw new StockError('That item is gone.', 404)
    return row
  }
  const [row] = await db.insert(barStockItem).values({ ...values, companyId }).returning()
  return row
}

// ─── Vendors ────────────────────────────────────────────────────────────────
async function saveVendor(companyId: string, id: string | null, b: Record<string, unknown>) {
  const name = clean(b.name, 80)
  if (!name) throw new StockError('Name the vendor.')
  const email = clean(b.email, 120)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new StockError("That email doesn't look right.")
  const values = { name, contactName: clean(b.contactName ?? b.contact, 80), phone: clean(b.phone, 30), email, orderDays: clean(b.orderDays, 60), note: clean(b.note, 300), isActive: b.isActive === undefined ? true : !!b.isActive }
  if (id) {
    const [row] = await db.update(barVendor).set(values).where(and(eq(barVendor.id, id), eq(barVendor.companyId, companyId))).returning()
    if (!row) throw new StockError('That vendor is gone.', 404)
    return row
  }
  const [row] = await db.insert(barVendor).values({ ...values, companyId }).returning()
  return row
}

async function vendorList(companyId: string) {
  return db.select().from(barVendor).where(eq(barVendor.companyId, companyId)).orderBy(asc(barVendor.name))
}

// ─── Recipes, plate cost, menu engineering ──────────────────────────────────
async function recipeBook(companyId: string) {
  const [sections, items, stock, recipes, tapRows] = await Promise.all([
    db.select().from(barMenuSection).where(eq(barMenuSection.companyId, companyId)).orderBy(asc(barMenuSection.sortOrder)),
    db.select().from(barMenuItem).where(and(eq(barMenuItem.companyId, companyId), eq(barMenuItem.isActive, true))).orderBy(asc(barMenuItem.sortOrder), asc(barMenuItem.name)),
    db.select().from(barStockItem).where(eq(barStockItem.companyId, companyId)),
    recipeMap(companyId),
    db.select().from(barTap).where(and(eq(barTap.companyId, companyId), eq(barTap.isActive, true))).orderBy(asc(barTap.lineNumber)),
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
    // Each pour size costed on its own ounces (a pitcher is not a pint); one entry when the tap has a single pour.
    const sizes = tapSizes(t).map((z) => { const c = u === null ? null : Math.round(u * z.oz); return { id: z.id, name: z.name, oz: z.oz, priceCents: z.priceCents, costCents: c, pct: costPct(c, z.priceCents) } })
    return { tapId: t.id, line: t.lineNumber, beer: t.beerName, priceCents: t.priceCents, stockItemId: t.stockItemId, stockName: keg?.name || null, pourOz: num(t.pourOz), costCents, pct: costPct(costCents, t.priceCents), sizes }
  })
  return { sections: out, pours }
}

async function setRecipe(companyId: string, menuItemId: string, sizeId: string | null, lines: Array<{ stockItemId: string; qty: unknown }>) {
  const [item] = await db.select({ id: barMenuItem.id }).from(barMenuItem).where(and(eq(barMenuItem.id, menuItemId), eq(barMenuItem.companyId, companyId))).limit(1)
  if (!item) throw new StockError('That menu item is gone.', 404)
  const want = (Array.isArray(lines) ? lines : []).filter(l => l && typeof l.stockItemId === 'string').map(l => ({ stockItemId: String(l.stockItemId), qty: qtyOf(l.qty, 'quantity') })).filter(l => l.qty > 0)
  await ownStockIds(companyId, want.map(l => l.stockItemId))
  const size = sizeId ? slugify(sizeId) : null
  await db.transaction(async (tx: Tx) => {
    await tx.delete(barRecipeLine).where(and(eq(barRecipeLine.companyId, companyId), eq(barRecipeLine.menuItemId, menuItemId), size ? eq(barRecipeLine.sizeId, size) : isNull(barRecipeLine.sizeId)))
    if (want.length) await tx.insert(barRecipeLine).values(want.map(l => ({ menuItemId, sizeId: size, stockItemId: l.stockItemId, qty: String(l.qty), companyId })))
  })
}

async function setTapPour(companyId: string, tapId: string, b: { stockItemId?: unknown; pourOz?: unknown }) {
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (b.stockItemId !== undefined) {
    const id = typeof b.stockItemId === 'string' && b.stockItemId ? b.stockItemId : null
    if (id) await ownStockIds(companyId, [id])
    set.stockItemId = id
  }
  if (b.pourOz !== undefined) {
    const oz = qtyOf(b.pourOz, 'pour'); if (oz <= 0 || oz > 64) throw new StockError('A pour is 1 to 64 oz.'); set.pourOz = String(oz)
    // pour_oz is the tap's FIRST size when it has sizes (services/barTapSizes.ts) — keep the two the same.
    const [cur] = await db.select({ sizes: barTap.sizes }).from(barTap).where(and(eq(barTap.id, tapId), eq(barTap.companyId, companyId))).limit(1)
    if (Array.isArray(cur?.sizes) && cur.sizes.length) set.sizes = (cur.sizes as any[]).map((z, i) => (i === 0 ? { ...z, oz } : z))
  }
  const [row] = await db.update(barTap).set(set).where(and(eq(barTap.id, tapId), eq(barTap.companyId, companyId))).returning()
  if (!row) throw new StockError('That tap is gone.', 404)
  return row
}

/** Popularity × margin over the last `days` of paid checks, per item and size (food; drinks are pour cost). */
async function menuEngineering(companyId: string, days = 30) {
  const from = new Date(Date.now() - days * 86400000)
  const [sold, book] = await Promise.all([soldBetween(companyId, from), recipeBook(companyId)])
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
async function currentCount(companyId: string, byName: string, create = true) {
  let [c] = await db.select().from(barStockCount).where(and(eq(barStockCount.companyId, companyId), eq(barStockCount.status, 'open'))).orderBy(desc(barStockCount.startedAt)).limit(1)
  if (!c && create) [c] = await db.insert(barStockCount).values({ startedByName: byName, companyId }).returning()
  if (!c) return null
  const lines = await db.select().from(barStockCountLine).where(and(eq(barStockCountLine.companyId, companyId), eq(barStockCountLine.countId, c.id)))
  return { ...c, lines: lines.map(l => ({ stockItemId: l.stockItemId, qty: num(l.qty), countedByName: l.countedByName, countedAt: l.countedAt })) }
}

/** Record one item: packs + loose units → units. `clear` takes it back off the count. */
async function countItem(companyId: string, countId: string, stockItemId: string, input: { packs?: unknown; units?: unknown; clear?: boolean }, byName: string) {
  const [c] = await db.select().from(barStockCount).where(and(eq(barStockCount.id, countId), eq(barStockCount.companyId, companyId))).limit(1)
  if (!c || c.status !== 'open') throw new StockError('That count is finished. Start a new one.', 409)
  const [it] = await db.select().from(barStockItem).where(and(eq(barStockItem.id, stockItemId), eq(barStockItem.companyId, companyId))).limit(1)
  if (!it) throw new StockError('That item is gone.', 404)
  if (input.clear) { await db.delete(barStockCountLine).where(and(eq(barStockCountLine.countId, countId), eq(barStockCountLine.stockItemId, stockItemId))); return null }
  const packs = input.packs === undefined || String(input.packs) === '' ? 0 : qtyOf(input.packs, 'count')
  const units = input.units === undefined || String(input.units) === '' ? 0 : qtyOf(input.units, 'count')
  const qty = Math.round((packs * num(it.packSize) + units) * 1000) / 1000
  await db.insert(barStockCountLine).values({ countId, stockItemId, qty: String(qty), countedByName: byName, companyId })
    .onConflictDoUpdate({ target: [barStockCountLine.countId, barStockCountLine.stockItemId], set: { qty: String(qty), countedByName: byName, countedAt: new Date() } })
  return qty
}

async function finishCount(companyId: string, countId: string, byName: string) {
  if (!(await countLineTotal(db, companyId, countId))) throw new StockError('Nothing counted yet.')
  const [c] = await db.update(barStockCount).set({ status: 'done', finishedAt: new Date(), finishedByName: byName })
    .where(and(eq(barStockCount.id, countId), eq(barStockCount.companyId, companyId), eq(barStockCount.status, 'open'))).returning()
  if (!c) throw new StockError('That count is already finished.', 409)
  return c
}

async function countHistory(companyId: string) {
  const counts = await db.select().from(barStockCount).where(eq(barStockCount.companyId, companyId)).orderBy(desc(barStockCount.startedAt)).limit(50)
  const lines = counts.length ? await db.select({ countId: barStockCountLine.countId }).from(barStockCountLine).where(and(eq(barStockCountLine.companyId, companyId), inArray(barStockCountLine.countId, counts.map(c => c.id)))) : []
  return counts.map(c => ({ id: c.id, status: c.status, startedAt: c.startedAt, finishedAt: c.finishedAt, finishedByName: c.finishedByName, items: lines.filter(l => l.countId === c.id).length }))
}

/** This count against the one before it: what should have been used, what was, the difference in dollars, food and pour cost. */
async function countReport(companyId: string, countId: string) {
  const [c] = await db.select().from(barStockCount).where(and(eq(barStockCount.id, countId), eq(barStockCount.companyId, companyId))).limit(1)
  if (!c || c.status !== 'done' || !c.finishedAt) throw new StockError('Finish the count first.', 409)
  const prev = await finishedCountBefore(db, companyId, c.finishedAt)
  if (!prev?.finishedAt) return { count: c, previous: null, rows: [], totals: null }
  const lineMap = async (id: string) => new Map((await db.select().from(barStockCountLine).where(and(eq(barStockCountLine.companyId, companyId), eq(barStockCountLine.countId, id)))).map(l => [l.stockItemId, num(l.qty)]))
  const [start, end, items, sold, recipes, rec] = await Promise.all([
    lineMap(prev.id), lineMap(c.id), db.select().from(barStockItem).where(eq(barStockItem.companyId, companyId)), soldBetween(companyId, prev.finishedAt, c.finishedAt), recipeMap(companyId),
    db.select({ stockItemId: barPurchaseOrderLine.stockItemId, packs: barPurchaseOrderLine.receivedPacks }).from(barPurchaseOrderLine).innerJoin(barPurchaseOrder, eq(barPurchaseOrder.id, barPurchaseOrderLine.orderId))
      .where(and(eq(barPurchaseOrder.companyId, companyId), eq(barPurchaseOrder.status, 'received'), gt(barPurchaseOrder.receivedAt, prev.finishedAt), lte(barPurchaseOrder.receivedAt, c.finishedAt))),
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

// ─── Purchase orders (numbered by data/bar.ts nextPoNumber: a counter that only goes forwards) ─────────

/** `onTheWay` is the home screen's "Orders on the way" (tileConditions.ts): every order sent and not yet in, not just the latest 60. */
async function orderList(companyId: string, onTheWay = false) {
  const [orders, lines, vendorRows, items] = await Promise.all([
    onTheWay
      ? db.select().from(barPurchaseOrder).where(and(eq(barPurchaseOrder.companyId, companyId), onTheWayCondition(barPurchaseOrder))).orderBy(desc(barPurchaseOrder.createdAt))
      : db.select().from(barPurchaseOrder).where(eq(barPurchaseOrder.companyId, companyId)).orderBy(desc(barPurchaseOrder.createdAt)).limit(60),
    db.select().from(barPurchaseOrderLine).where(eq(barPurchaseOrderLine.companyId, companyId)),
    db.select().from(barVendor).where(eq(barVendor.companyId, companyId)),
    db.select().from(barStockItem).where(eq(barStockItem.companyId, companyId)),
  ])
  const vName = new Map(vendorRows.map(v => [v.id, v])), iName = new Map(items.map(i => [i.id, i]))
  return orders.map(o => {
    const ls = lines.filter(l => l.orderId === o.id).map(l => ({ ...l, packs: num(l.packs), receivedPacks: l.receivedPacks === null ? null : num(l.receivedPacks), name: iName.get(l.stockItemId)?.name || '?', packName: iName.get(l.stockItemId)?.packName || '' }))
    return { ...o, vendor: o.vendorId ? vName.get(o.vendorId) || null : null, lines: ls, totalCents: ls.reduce((n, l) => n + Math.round(l.packs * (l.packCostCents || 0)), 0) }
  })
}

/** One draft per vendor for everything below par. Items with no vendor go on one "no vendor" draft. */
async function draftFromLow(companyId: string, byName: string) {
  const low = (await stockList(companyId)).filter(r => r.suggestPacks > 0)
  if (!low.length) throw new StockError('Nothing is below par.')
  const byVendor = new Map<string, StockRow[]>()
  for (const r of low) { const k = r.vendorId || ''; byVendor.set(k, [...(byVendor.get(k) || []), r]) }
  return db.transaction(async (tx: Tx) => {
    const made: string[] = []
    for (const [vendorId, rows] of byVendor) {
      const [po] = await tx.insert(barPurchaseOrder).values({ number: await nextPoNumber(tx, companyId), vendorId: vendorId || null, createdByName: byName, companyId }).returning()
      await tx.insert(barPurchaseOrderLine).values(rows.map(r => ({ orderId: po.id, stockItemId: r.id, packs: String(r.suggestPacks), packCostCents: r.packCostCents, companyId })))
      made.push(po.id)
    }
    return made
  })
}

async function saveOrder(companyId: string, id: string | null, b: { vendorId?: unknown; note?: unknown; lines?: Array<{ stockItemId: string; packs: unknown; packCostCents?: unknown }> }, byName: string) {
  if (id) {
    const [o] = await db.select().from(barPurchaseOrder).where(and(eq(barPurchaseOrder.id, id), eq(barPurchaseOrder.companyId, companyId))).limit(1)
    if (!o) throw new StockError('That order is gone.', 404)
    if (o.status !== 'draft' && o.status !== 'sent') throw new StockError('That order is closed.', 409)
  }
  const vendorId = await ownVendor(companyId, b.vendorId)
  const lines = (b.lines || []).filter(l => l && typeof l.stockItemId === 'string').map(l => ({ stockItemId: String(l.stockItemId), packs: qtyOf(l.packs, 'quantity'), packCostCents: l.packCostCents === undefined || l.packCostCents === null || String(l.packCostCents) === '' ? null : Math.round(qtyOf(l.packCostCents, 'price')) })).filter(l => l.packs > 0)
  if (!lines.length) throw new StockError('Put something on the order.')
  await ownStockIds(companyId, lines.map(l => l.stockItemId))
  return db.transaction(async (tx: Tx) => {
    let orderId = id
    if (orderId) await tx.update(barPurchaseOrder).set({ vendorId, note: clean(b.note, 300) }).where(eq(barPurchaseOrder.id, orderId))
    else [{ id: orderId }] = await tx.insert(barPurchaseOrder).values({ number: await nextPoNumber(tx, companyId), vendorId, note: clean(b.note, 300), createdByName: byName, companyId }).returning({ id: barPurchaseOrder.id })
    await tx.delete(barPurchaseOrderLine).where(eq(barPurchaseOrderLine.orderId, orderId!))
    await tx.insert(barPurchaseOrderLine).values(lines.map(l => ({ orderId: orderId!, stockItemId: l.stockItemId, packs: String(l.packs), packCostCents: l.packCostCents, companyId })))
    return orderId!
  })
}

async function setOrderStatus(companyId: string, id: string, status: 'sent' | 'cancelled') {
  const [o] = await db.update(barPurchaseOrder).set({ status, ...(status === 'sent' ? { sentAt: new Date() } : {}) })
    .where(and(eq(barPurchaseOrder.id, id), eq(barPurchaseOrder.companyId, companyId), inArray(barPurchaseOrder.status, ['draft', 'sent']))).returning()
  if (!o) throw new StockError('That order is closed.', 409)
  return o
}

/** Receive what came in. Each line: packs received and the price on the invoice (becomes the item's price). */
async function receiveOrder(companyId: string, id: string, received: Array<{ lineId: string; packs: unknown; packCostCents?: unknown }>, byName: string) {
  return db.transaction(async (tx: Tx) => {
    const [o] = await tx.select().from(barPurchaseOrder).where(and(eq(barPurchaseOrder.id, id), eq(barPurchaseOrder.companyId, companyId))).limit(1).for('update')
    if (!o) throw new StockError('That order is gone.', 404)
    if (o.status === 'received' || o.status === 'cancelled') throw new StockError('That order is closed.', 409)
    const lines = await tx.select().from(barPurchaseOrderLine).where(eq(barPurchaseOrderLine.orderId, id))
    const given = new Map((Array.isArray(received) ? received : []).map(r => [String(r.lineId), r]))
    for (const l of lines) {
      const r = given.get(l.id)
      const packs = r ? qtyOf(r.packs, 'quantity') : num(l.packs)   // not mentioned = came in as ordered
      const cost = r && r.packCostCents !== undefined && r.packCostCents !== null && String(r.packCostCents) !== '' ? Math.round(qtyOf(r.packCostCents, 'price')) : l.packCostCents
      await tx.update(barPurchaseOrderLine).set({ receivedPacks: String(packs), receivedCostCents: cost }).where(eq(barPurchaseOrderLine.id, l.id))
      if (cost !== null && packs > 0) await tx.update(barStockItem).set({ packCostCents: cost, updatedAt: new Date() }).where(and(eq(barStockItem.id, l.stockItemId), eq(barStockItem.companyId, companyId)))
    }
    const [done] = await tx.update(barPurchaseOrder).set({ status: 'received', receivedAt: new Date(), receivedByName: byName }).where(eq(barPurchaseOrder.id, id)).returning()
    return done as typeof barPurchaseOrder.$inferSelect
  })
}

return {
  soldBetween, stockList, saveStockItem, saveVendor, vendorList, recipeBook, setRecipe, setTapPour, menuEngineering, currentCount,
  countItem, finishCount, countHistory, countReport, orderList, draftFromLow, saveOrder, setOrderStatus, receiveOrder,
}
}
export type BarStock = ReturnType<typeof createBarStock>

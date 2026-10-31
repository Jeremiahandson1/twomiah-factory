// Retail stock management (salon row 12; hidden feature `salon_retail`; docs/parity/salon-retail-stock.md). On top of retail.ts:
//
//   SUPPLIERS        who the salon buys from (name, contact, email, phone).
//   LOCATIONS        places stock is kept. The first is made on first use; stock with no place named is in it.
//   LOW STOCK        an email the moment a product reaches its level (once for each time it falls to it: it must climb above the level
//                    before it can alert again), and a summary every Monday from 9 am on the shop's clock.
//   PURCHASE ORDERS  drafted from what is low (the reorder quantity per product), edited, emailed to the supplier, and received into
//                    stock line by line (part now, the rest later); the received cost updates the product's cost.
//   TRANSFERS        units moved between two places, as two stock moves that share a transfer.
//   COUNTS           a counted number per product; the difference is written as a correction ("Stock count").
//   BARCODE          a product is found by what a scanner reads (the barcode, or the SKU).
//   RETURNS          after a refund, units can go back on the shelf (never more than were sold on that sale, never twice).
import { Hono } from 'hono'
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { companyRowTimeZone } from '@twomiah/tenant-backend'
import { company, invoice, reminderLog, salonPurchaseOrder, salonPurchaseOrderLine, salonRetailProduct, salonRetailSale, salonStockLocation, salonStockMove, salonSupplier, user } from '../../db/schema/index.ts'
import { defaultStockLocation, lockRetailProduct, retailOnHand, retailOnHandAt, retailProductsByCode, retailReturnedOn } from '../../data/salon.ts'
import { escHtml } from '../../core/email.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { shopClock } from '../lowStockDigest.ts'
import { siteOrigin } from '../../booking/happenings.ts'

type Tx = any
export class StockError extends Error { constructor(message: string, public status: 400 | 404 | 409 = 400, public code?: string, public field?: string) { super(message) } }

const text = (v: unknown, max: number): string | null => { const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max); return s || null }
const nameOf = (u: any) => [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || u?.email || 'Staff'
const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const whole = (v: unknown, field: string, label: string, { min = 1, max = 100_000 } = {}): number => {
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw new StockError(`${label} must be a whole number from ${min} to ${max.toLocaleString('en-US')}.`, 400, 'BAD_QUANTITY', field)
  return n
}

export const LOW_KIND = 'salon_retail_low'
export const WEEKLY_KIND = 'salon_retail_weekly'
/** The hour of the shop's Monday the summary is first sent. */
export const SUMMARY_HOUR = 9

export function createRetailStock(d: CrmDeps) {
  const { db, logger } = d

  // ─── Suppliers ─────────────────────────────────────────────────────────────────────────────
  const supplierView = (r: typeof salonSupplier.$inferSelect) => ({ id: r.id, name: r.name, contactName: r.contactName, email: r.email, phone: r.phone, notes: r.notes, active: r.active })
  async function suppliers(companyId: string) {
    const rows = await db.select().from(salonSupplier).where(eq(salonSupplier.companyId, companyId)).orderBy(asc(salonSupplier.name)).limit(500)
    return rows.map(supplierView)
  }
  function readSupplier(b: Record<string, unknown>, partial: boolean) {
    const out: Partial<typeof salonSupplier.$inferInsert> = {}
    if (!partial || b.name !== undefined) { const n = text(b.name, 120); if (!n) throw new StockError('Give the supplier a name.', 400, 'NAME_REQUIRED', 'name'); out.name = n }
    if (b.contactName !== undefined) out.contactName = text(b.contactName, 120)
    if (b.email !== undefined) {
      const e = text(b.email, 200)
      if (e && !EMAIL.test(e)) throw new StockError('That email address does not look right.', 400, 'BAD_EMAIL', 'email')
      out.email = e ? e.toLowerCase() : null
    }
    if (b.phone !== undefined) out.phone = text(b.phone, 40)
    if (b.notes !== undefined) out.notes = text(b.notes, 500)
    if (b.active !== undefined) out.active = !!b.active
    return out
  }
  async function createSupplier(companyId: string, b: Record<string, unknown>) {
    const [row] = await db.insert(salonSupplier).values({ ...readSupplier(b, false), companyId } as any).returning()
    return supplierView(row)
  }
  async function updateSupplier(companyId: string, id: string, b: Record<string, unknown>) {
    const v = readSupplier(b, true)
    if (!Object.keys(v).length) throw new StockError('Nothing to change.')
    const [row] = await db.update(salonSupplier).set(v).where(and(eq(salonSupplier.id, id), eq(salonSupplier.companyId, companyId))).returning()
    if (!row) throw new StockError('That supplier is gone.', 404)
    return supplierView(row)
  }

  // ─── Places ────────────────────────────────────────────────────────────────────────────────
  async function locations(companyId: string) {
    await defaultStockLocation(db, companyId)
    const rows = await db.select().from(salonStockLocation).where(eq(salonStockLocation.companyId, companyId)).orderBy(asc(salonStockLocation.createdAt), asc(salonStockLocation.id)).limit(100)
    return rows.map((r: any, i: number) => ({ id: r.id, name: r.name, active: r.active, first: i === 0 }))
  }
  async function createLocation(companyId: string, b: Record<string, unknown>) {
    const name = text(b.name, 80)
    if (!name) throw new StockError('Give the place a name.', 400, 'NAME_REQUIRED', 'name')
    await defaultStockLocation(db, companyId)
    const named = await db.select({ name: salonStockLocation.name }).from(salonStockLocation).where(eq(salonStockLocation.companyId, companyId)).limit(100)
    if (named.some((r: any) => String(r.name).toLowerCase() === name.toLowerCase())) throw new StockError('There is already a place with that name.', 409, 'DUPLICATE', 'name')
    const [row] = await db.insert(salonStockLocation).values({ companyId, name }).returning()
    return { id: row.id, name: row.name, active: row.active, first: false }
  }
  /** A place the request names, checked to be this salon's; none named = the first. */
  async function placeOf(exec: any, companyId: string, raw: unknown, field = 'locationId'): Promise<string> {
    if (raw === undefined || raw === null || raw === '') return defaultStockLocation(exec, companyId)
    const [row] = await exec.select({ id: salonStockLocation.id, active: salonStockLocation.active }).from(salonStockLocation).where(and(eq(salonStockLocation.id, String(raw)), eq(salonStockLocation.companyId, companyId))).limit(1)
    if (!row) throw new StockError('That place was not found.', 404, 'NO_LOCATION', field)
    if (!row.active) throw new StockError('That place is not in use any more.', 409, 'LOCATION_OFF', field)
    return row.id
  }

  // ─── Barcode ───────────────────────────────────────────────────────────────────────────────
  /** What a scanner sent, as a code: digits and letters only, so a stray scanner suffix or space does not matter. */
  const codeOf = (raw: unknown) => String(raw ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  /** A product by its barcode, or failing that its SKU. Products taken off the shelf are found too (a count includes them). */
  async function byCode(companyId: string, raw: unknown) {
    const code = codeOf(raw)
    if (code.length < 3) throw new StockError('That code is too short to be a barcode.', 400, 'BAD_CODE')
    const rows = await retailProductsByCode(db, companyId, code)
    // A barcode match beats an SKU match when both exist.
    const hit = rows.find((r) => r.barcode && codeOf(r.barcode) === code) ?? rows[0]
    if (!hit) throw new StockError('No product has that barcode or SKU.', 404, 'NO_PRODUCT')
    const have = await retailOnHand(db, companyId, [hit.id])
    return { id: hit.id, name: hit.name, brand: hit.brand, sku: hit.sku, barcode: hit.barcode, priceCents: hit.priceCents, active: hit.active, onHand: have.get(hit.id) ?? 0 }
  }

  // ─── Counting ──────────────────────────────────────────────────────────────────────────────
  /** A stock count at one place: for each product counted, the difference from the system is written as a correction. */
  async function count(companyId: string, b: Record<string, unknown>, actor: any) {
    const raw = b.counts
    if (!Array.isArray(raw) || !raw.length) throw new StockError('Count at least one product.', 400, 'NO_ITEMS')
    if (raw.length > 500) throw new StockError('Count 500 products or fewer at a time.', 400, 'TOO_MANY')
    const seen = new Set<string>()
    const items = raw.map((r: any) => {
      const productId = String(r?.productId ?? '')
      if (seen.has(productId)) throw new StockError('A product is in the count twice.', 400, 'DUPLICATE')
      seen.add(productId)
      return { productId, counted: whole(r?.counted, 'counted', 'A count', { min: 0 }) }
    })
    return db.transaction(async (tx: Tx) => {
      const place = await placeOf(tx, companyId, b.locationId)
      const ids = [...seen].sort()
      for (const id of ids) { if (!(await lockRetailProduct(tx, companyId, id))) throw new StockError('One of those products is gone.', 404, 'NO_PRODUCT') }
      const have = await retailOnHandAt(tx, companyId, place, ids)
      const changed: Array<{ productId: string; was: number; now: number }> = []
      for (const it of items) {
        const was = have.get(it.productId) ?? 0
        if (was === it.counted) continue
        await tx.insert(salonStockMove).values({ companyId, productId: it.productId, quantity: it.counted - was, kind: 'adjust', note: `Stock count: counted ${it.counted}, system said ${was}`, byName: nameOf(actor), locationId: place })
        changed.push({ productId: it.productId, was, now: it.counted })
      }
      return { counted: items.length, changed }
    })
  }

  // ─── Transfers ─────────────────────────────────────────────────────────────────────────────
  async function transfer(companyId: string, b: Record<string, unknown>, actor: any) {
    const quantity = whole(b.quantity, 'quantity', 'The number of units')
    const note = text(b.note, 160)
    return db.transaction(async (tx: Tx) => {
      const from = await placeOf(tx, companyId, b.fromLocationId, 'fromLocationId')
      const to = await placeOf(tx, companyId, b.toLocationId, 'toLocationId')
      if (from === to) throw new StockError('Choose two different places.', 400, 'SAME_PLACE', 'toLocationId')
      const productId = String(b.productId ?? '')
      const product = await lockRetailProduct(tx, companyId, productId)
      if (!product) throw new StockError('That product is gone.', 404, 'NO_PRODUCT')
      const there = (await retailOnHandAt(tx, companyId, from, [productId])).get(productId) ?? 0
      if (quantity > there) throw new StockError(there > 0 ? `Only ${there} of ${product.name} at that place.` : `${product.name} is out of stock at that place.`, 409, 'BELOW_ZERO', 'quantity')
      const transferId = `tr_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
      const by = nameOf(actor)
      await tx.insert(salonStockMove).values([
        { companyId, productId, quantity: -quantity, kind: 'transfer_out', note, byName: by, locationId: from, transferId },
        { companyId, productId, quantity, kind: 'transfer_in', note, byName: by, locationId: to, transferId },
      ])
      return { transferId, productId, quantity, fromLocationId: from, toLocationId: to }
    })
  }

  /** Where each product's units are right now (only places that hold any). */
  async function stockByPlace(companyId: string) {
    const places = await locations(companyId)
    const out = new Map<string, Array<{ locationId: string; name: string; onHand: number }>>()
    for (const pl of places) {
      const have = await retailOnHandAt(db, companyId, pl.id, null)
      for (const [pid, n] of have) { if (n === 0) continue; out.set(pid, [...(out.get(pid) ?? []), { locationId: pl.id, name: pl.name, onHand: n }]) }
    }
    return { places, byProduct: out }
  }

  // ─── Low stock ─────────────────────────────────────────────────────────────────────────────
  interface LowItem { id: string; name: string; brand: string | null; sku: string | null; onHand: number; reorderAt: number; reorderQty: number | null; supplierName: string | null }
  async function lowItems(companyId: string): Promise<LowItem[]> {
    const rows: Array<typeof salonRetailProduct.$inferSelect> = await db.select().from(salonRetailProduct)
      .where(and(eq(salonRetailProduct.companyId, companyId), eq(salonRetailProduct.active, true), isNotNull(salonRetailProduct.reorderAt))).limit(2000)
    if (!rows.length) return []
    const have = await retailOnHand(db, companyId, null)
    const sup = new Map<string, string>((await db.select({ id: salonSupplier.id, name: salonSupplier.name }).from(salonSupplier).where(eq(salonSupplier.companyId, companyId))).map((r: any) => [r.id, r.name]))
    return rows.filter((p) => (have.get(p.id) ?? 0) <= (p.reorderAt as number))
      .map((p) => ({ id: p.id, name: p.name, brand: p.brand, sku: p.sku, onHand: have.get(p.id) ?? 0, reorderAt: p.reorderAt as number, reorderQty: p.reorderQty, supplierName: p.supplierId ? sup.get(p.supplierId) ?? null : null }))
      .sort((a, b) => a.onHand - b.onHand || a.name.localeCompare(b.name))
  }

  /** Who is told: the people who run the salon (active owners, admins, managers); the salon's own address when there is none. */
  async function runners(companyId: string, ownersOnly = false): Promise<string[]> {
    const roles = ownersOnly ? ['owner'] : ['owner', 'admin', 'manager']
    const rows = await db.select({ email: user.email }).from(user).where(and(eq(user.companyId, companyId), eq(user.isActive, true), inArray(user.role, roles)))
    const list: string[] = rows.map((r: any) => String(r.email || "").trim()).filter(Boolean)
    if (list.length) return [...new Set(list)]
    const [co] = await db.select({ email: company.email }).from(company).where(eq(company.id, companyId)).limit(1)
    return co?.email ? [co.email] : []
  }
  async function salonName(companyId: string) {
    const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    return co?.name || 'Your salon'
  }
  const itemLine = (i: LowItem) => `<li><strong>${escHtml([i.brand, i.name].filter(Boolean).join(' '))}</strong>${i.sku ? ` (${escHtml(i.sku)})` : ''}: ${i.onHand <= 0 ? '<strong>none left</strong>' : `<strong>${i.onHand} left</strong>`}, reorder at ${i.reorderAt}${i.reorderQty ? ` (usual order ${i.reorderQty})` : ''}${i.supplierName ? ` from ${escHtml(i.supplierName)}` : ''}</li>`

  /**
   * Tell the salon about products that have just reached their level. A product is told about ONCE for each time it falls to its level:
   * the claim (reminder_log, one row per product) is made in one statement so two passes cannot both send, and it is given back when the
   * product climbs above its level again, so the next fall alerts again. A send that fails gives its claims back for the next pass.
   */
  async function alertLow(companyId: string): Promise<{ sent: number; products: number }> {
    try {
      if (!(await d.features.isFeatureEnabled(companyId, 'salon_retail'))) return { sent: 0, products: 0 }
      const low = await lowItems(companyId)
      const lowIds = new Set(low.map((l) => l.id))
      const held = await db.select({ id: reminderLog.id, subjectId: reminderLog.subjectId }).from(reminderLog).where(and(eq(reminderLog.companyId, companyId), eq(reminderLog.kind, LOW_KIND)))
      // Back above its level (or taken off the shelf): the next time it falls, it alerts again.
      const recovered = held.filter((h: any) => !lowIds.has(h.subjectId)).map((h: any) => h.id)
      if (recovered.length) await db.delete(reminderLog).where(inArray(reminderLog.id, recovered))
      const fresh: LowItem[] = []
      const claimedIds: string[] = []
      for (const item of low) {
        const row = await db.insert(reminderLog).values({ companyId, kind: LOW_KIND, subjectId: item.id, step: 'low', status: 'sent' })
          .onConflictDoNothing({ target: [reminderLog.companyId, reminderLog.kind, reminderLog.subjectId, reminderLog.step] }).returning({ id: reminderLog.id })
        if (row.length) { fresh.push(item); claimedIds.push(row[0].id) }
      }
      if (!fresh.length) return { sent: 0, products: 0 }
      const to = await runners(companyId)
      if (!to.length) { await db.delete(reminderLog).where(inArray(reminderLog.id, claimedIds)); return { sent: 0, products: 0 } }
      const salon = await salonName(companyId)
      let sent = 0
      try {
        for (const address of to) {
          await d.services.emailService.sendRaw({
            to: address, fromName: salon,
            subject: fresh.length === 1 ? `Low stock: ${[fresh[0].brand, fresh[0].name].filter(Boolean).join(' ')}` : `Low stock: ${fresh.length} products to reorder`,
            html: `<h2>${fresh.length === 1 ? 'One product has' : `${fresh.length} products have`} reached ${fresh.length === 1 ? 'its' : 'their'} reorder level</h2><ul style="line-height:1.7">${fresh.map(itemLine).join('')}</ul><p>You get this once each time a product falls to its level. <a href="${escHtml(siteOrigin())}/crm/salon-retail">Open Retail</a> to draft a purchase order.</p>`,
          })
          sent++
        }
      } catch (e: any) {
        if (sent === 0) await db.delete(reminderLog).where(inArray(reminderLog.id, claimedIds))
        throw e
      }
      return { sent, products: fresh.length }
    } catch (e: any) {
      logger.warn('[salon-retail] low-stock email failed', { error: e?.message })
      return { sent: 0, products: 0 }
    }
  }

  /** What the stock on hand is worth, at cost and at the shelf price. */
  async function stockValue(companyId: string) {
    const rows: Array<typeof salonRetailProduct.$inferSelect> = await db.select().from(salonRetailProduct).where(and(eq(salonRetailProduct.companyId, companyId), eq(salonRetailProduct.active, true))).limit(5000)
    const have = await retailOnHand(db, companyId, null)
    let cost = 0, retail = 0, units = 0, uncosted = 0
    for (const p of rows) {
      const n = Math.max(0, have.get(p.id) ?? 0)
      units += n; retail += n * p.priceCents
      if (p.costCents == null) { if (n > 0) uncosted++ } else cost += n * p.costCents
    }
    return { costCents: cost, retailCents: retail, units, productsWithoutCost: uncosted, products: rows.length }
  }

  /**
   * The Monday summary to the owner: from 9 am on the shop's clock, once a week (reminder_log: company + kind + the Monday's date). It lists what
   * is low, what the stock is worth and the purchase orders still waiting for stock. Returns 'sent' | 'not_monday' | 'too_early' | 'already_sent' | 'off' | 'no_recipient' | 'failed'.
   */
  async function weeklySummary(companyId: string, now = new Date()): Promise<string> {
    try {
      if (!(await d.features.isFeatureEnabled(companyId, 'salon_retail'))) return 'off'
      const [co] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
      if (!co) return 'off'
      const { day, hour } = shopClock(companyRowTimeZone(co), now)
      if (new Date(`${day}T12:00:00Z`).getUTCDay() !== 1) return 'not_monday'
      if (hour < SUMMARY_HOUR) return 'too_early'
      const to = await runners(companyId, true)
      if (!to.length) return 'no_recipient'
      const claim = await db.insert(reminderLog).values({ companyId, kind: WEEKLY_KIND, subjectId: companyId, step: day, status: 'sending', sentTo: to.join(', ') })
        .onConflictDoNothing({ target: [reminderLog.companyId, reminderLog.kind, reminderLog.subjectId, reminderLog.step] }).returning({ id: reminderLog.id })
      if (!claim.length) return 'already_sent'
      try {
        const [low, value, open] = await Promise.all([lowItems(companyId), stockValue(companyId), db.select({ n: salonPurchaseOrder.number, status: salonPurchaseOrder.status }).from(salonPurchaseOrder).where(and(eq(salonPurchaseOrder.companyId, companyId), inArray(salonPurchaseOrder.status, ['sent', 'partial']))).limit(50)])
        const salon = await salonName(companyId)
        for (const address of to) {
          await d.services.emailService.sendRaw({
            to: address, fromName: salon, subject: `Your weekly retail stock summary${low.length ? ` — ${low.length} to reorder` : ''}`,
            html: `<h2>Retail stock, week of ${escHtml(day)}</h2>
<p>${low.length ? `<strong>${low.length}</strong> product${low.length === 1 ? ' is' : 's are'} at or below the reorder level:` : 'Nothing is at or below its reorder level.'}</p>${low.length ? `<ul style="line-height:1.7">${low.map(itemLine).join('')}</ul>` : ''}
<p>Stock on hand: <strong>${value.units}</strong> unit${value.units === 1 ? '' : 's'}, worth <strong>${money(value.costCents)}</strong> at cost and <strong>${money(value.retailCents)}</strong> at the shelf price${value.productsWithoutCost ? ` (${value.productsWithoutCost} product${value.productsWithoutCost === 1 ? ' has' : 's have'} no cost entered, so the cost figure is short)` : ''}.</p>
<p>${open.length ? `Waiting for stock: ${open.map((o: any) => escHtml(o.n)).join(', ')}.` : 'No purchase orders are waiting for stock.'}</p>`,
          })
        }
        await db.update(reminderLog).set({ status: 'sent', updatedAt: new Date() }).where(eq(reminderLog.id, claim[0].id))
        return 'sent'
      } catch (e: any) {
        await db.delete(reminderLog).where(eq(reminderLog.id, claim[0].id))
        throw e
      }
    } catch (e: any) {
      logger.warn('[salon-retail] weekly summary failed', { error: e?.message })
      return 'failed'
    }
  }

  // ─── Purchase orders ───────────────────────────────────────────────────────────────────────
  async function nextNumber(tx: Tx, companyId: string): Promise<string> {
    const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(salonPurchaseOrder).where(eq(salonPurchaseOrder.companyId, companyId))
    let n = Number(row?.n ?? 0) + 1
    for (;;) {
      const number = `PO-${String(n).padStart(4, '0')}`
      const [taken] = await tx.select({ id: salonPurchaseOrder.id }).from(salonPurchaseOrder).where(and(eq(salonPurchaseOrder.companyId, companyId), eq(salonPurchaseOrder.number, number))).limit(1)
      if (!taken) return number
      n++
    }
  }
  async function orderView(companyId: string, id: string) {
    const [po] = await db.select().from(salonPurchaseOrder).where(and(eq(salonPurchaseOrder.id, id), eq(salonPurchaseOrder.companyId, companyId))).limit(1)
    if (!po) throw new StockError('That purchase order was not found.', 404)
    const [sup] = await db.select().from(salonSupplier).where(eq(salonSupplier.id, po.supplierId)).limit(1)
    const lines = await db.select({ id: salonPurchaseOrderLine.id, productId: salonPurchaseOrderLine.productId, quantity: salonPurchaseOrderLine.quantity, received: salonPurchaseOrderLine.received, unitCostCents: salonPurchaseOrderLine.unitCostCents, name: salonRetailProduct.name, brand: salonRetailProduct.brand, sku: salonRetailProduct.sku })
      .from(salonPurchaseOrderLine).innerJoin(salonRetailProduct, eq(salonPurchaseOrderLine.productId, salonRetailProduct.id)).where(eq(salonPurchaseOrderLine.purchaseOrderId, id)).orderBy(asc(salonRetailProduct.name))
    return {
      id: po.id, number: po.number, status: po.status, note: po.note, locationId: po.locationId, sentAt: po.sentAt, sentTo: po.sentTo, createdAt: po.createdAt, createdByName: po.createdByName,
      supplier: sup ? { id: sup.id, name: sup.name, email: sup.email } : null,
      lines: lines.map((l: any) => ({ id: l.id, productId: l.productId, name: [l.brand, l.name].filter(Boolean).join(' '), sku: l.sku, quantity: l.quantity, received: l.received, unitCostCents: l.unitCostCents })),
      totalCents: lines.reduce((t: number, l: any) => t + (l.unitCostCents ?? 0) * l.quantity, 0),
    }
  }
  async function orders(companyId: string) {
    const rows = await db.select({ id: salonPurchaseOrder.id }).from(salonPurchaseOrder).where(eq(salonPurchaseOrder.companyId, companyId)).orderBy(desc(salonPurchaseOrder.createdAt)).limit(100)
    const out = []
    for (const r of rows) out.push(await orderView(companyId, r.id))
    return out
  }

  /**
   * Draft purchase orders from what is low: one per supplier, with each product's reorder quantity (or, with none set, enough to climb back
   * above its level). A supplier's open draft is added to instead of a second one made; a product already on a draft or an order waiting
   * for stock is not proposed again. Products with no supplier are returned for the person to assign.
   */
  async function draftFromLow(companyId: string, b: Record<string, unknown>, actor: any) {
    const only = Array.isArray(b.productIds) ? new Set((b.productIds as unknown[]).map(String)) : null
    const low = (await lowItems(companyId)).filter((l) => !only || only.has(l.id))
    if (!low.length) throw new StockError('Nothing is at or below its reorder level.', 409, 'NOTHING_LOW')
    const products: Array<typeof salonRetailProduct.$inferSelect> = await db.select().from(salonRetailProduct).where(and(eq(salonRetailProduct.companyId, companyId), inArray(salonRetailProduct.id, low.map((l) => l.id))))
    const byId = new Map(products.map((p) => [p.id, p]))
    const waiting = new Set<string>((await db.select({ productId: salonPurchaseOrderLine.productId }).from(salonPurchaseOrderLine).innerJoin(salonPurchaseOrder, eq(salonPurchaseOrderLine.purchaseOrderId, salonPurchaseOrder.id))
      .where(and(eq(salonPurchaseOrder.companyId, companyId), inArray(salonPurchaseOrder.status, ['draft', 'sent', 'partial'])))).map((r: any) => r.productId))
    const unassigned: string[] = [], alreadyOrdered: string[] = []
    const perSupplier = new Map<string, LowItem[]>()
    for (const l of low) {
      const p = byId.get(l.id)!
      if (!p.supplierId) { unassigned.push(l.name); continue }
      if (waiting.has(l.id)) { alreadyOrdered.push(l.name); continue }
      perSupplier.set(p.supplierId, [...(perSupplier.get(p.supplierId) ?? []), l])
    }
    if (!perSupplier.size) {
      throw new StockError(unassigned.length ? 'None of the low products has a supplier yet. Choose a supplier on each product first.' : 'Everything that is low is already on an order.', 409, 'NOTHING_TO_ORDER')
    }
    const made = await db.transaction(async (tx: Tx) => {
      const out: string[] = []
      for (const [supplierId, items] of perSupplier) {
        let [po] = await tx.select().from(salonPurchaseOrder).where(and(eq(salonPurchaseOrder.companyId, companyId), eq(salonPurchaseOrder.supplierId, supplierId), eq(salonPurchaseOrder.status, 'draft'))).orderBy(asc(salonPurchaseOrder.createdAt)).limit(1)
        if (!po) {
          ;[po] = await tx.insert(salonPurchaseOrder).values({ companyId, supplierId, number: await nextNumber(tx, companyId), status: 'draft', locationId: await defaultStockLocation(tx, companyId), createdByName: nameOf(actor) }).returning()
        }
        for (const it of items) {
          const p = byId.get(it.id)!
          const quantity = p.reorderQty && p.reorderQty > 0 ? p.reorderQty : Math.max(1, it.reorderAt - it.onHand + 1)
          await tx.insert(salonPurchaseOrderLine).values({ companyId, purchaseOrderId: po.id, productId: p.id, quantity, unitCostCents: p.costCents }).onConflictDoNothing()
        }
        out.push(po.id)
      }
      return out
    })
    const list = []
    for (const id of made) list.push(await orderView(companyId, id))
    return { orders: list, unassigned, alreadyOrdered }
  }

  async function createOrder(companyId: string, b: Record<string, unknown>, actor: any) {
    const [sup] = await db.select().from(salonSupplier).where(and(eq(salonSupplier.id, String(b.supplierId ?? '')), eq(salonSupplier.companyId, companyId))).limit(1)
    if (!sup) throw new StockError('Choose a supplier.', 400, 'NO_SUPPLIER', 'supplierId')
    const id = await db.transaction(async (tx: Tx) => {
      const [po] = await tx.insert(salonPurchaseOrder).values({ companyId, supplierId: sup.id, number: await nextNumber(tx, companyId), status: 'draft', locationId: await placeOf(tx, companyId, b.locationId), note: text(b.note, 500), createdByName: nameOf(actor) }).returning()
      return po.id as string
    })
    return orderView(companyId, id)
  }

  /** Lock one order for the length of the caller's transaction. */
  async function lockOrder(tx: Tx, companyId: string, id: string) {
    const [po] = await tx.select().from(salonPurchaseOrder).where(and(eq(salonPurchaseOrder.id, id), eq(salonPurchaseOrder.companyId, companyId))).limit(1).for('update')
    if (!po) throw new StockError('That purchase order was not found.', 404)
    return po as typeof salonPurchaseOrder.$inferSelect
  }

  /** Set what a draft orders: lines added, changed or removed (quantity 0), the note, and where the stock will arrive. */
  async function editOrder(companyId: string, id: string, b: Record<string, unknown>) {
    await db.transaction(async (tx: Tx) => {
      const po = await lockOrder(tx, companyId, id)
      if (po.status !== 'draft') throw new StockError('Only a draft can be changed. This order has been sent.', 409, 'NOT_DRAFT')
      const patch: Partial<typeof salonPurchaseOrder.$inferInsert> = {}
      if (b.note !== undefined) patch.note = text(b.note, 500)
      if (b.locationId !== undefined) patch.locationId = await placeOf(tx, companyId, b.locationId)
      if (Object.keys(patch).length) await tx.update(salonPurchaseOrder).set(patch).where(eq(salonPurchaseOrder.id, id))
      if (b.lines !== undefined) {
        if (!Array.isArray(b.lines)) throw new StockError('The lines are a list.', 400, 'BAD_LINES')
        for (const raw of b.lines as any[]) {
          const productId = String(raw?.productId ?? '')
          const [p] = await tx.select({ id: salonRetailProduct.id, supplierId: salonRetailProduct.supplierId }).from(salonRetailProduct).where(and(eq(salonRetailProduct.id, productId), eq(salonRetailProduct.companyId, companyId))).limit(1)
          if (!p) throw new StockError('One of those products is gone.', 404, 'NO_PRODUCT')
          const quantity = Number(raw?.quantity)
          if (quantity === 0) { await tx.delete(salonPurchaseOrderLine).where(and(eq(salonPurchaseOrderLine.purchaseOrderId, id), eq(salonPurchaseOrderLine.productId, productId))); continue }
          whole(quantity, 'quantity', 'The quantity', { min: 1 })
          const cost = raw?.unitCostCents === undefined || raw?.unitCostCents === null || raw?.unitCostCents === '' ? undefined : whole(raw.unitCostCents, 'unitCostCents', 'The cost', { min: 0, max: 1_000_000 })
          const existing = await tx.select({ id: salonPurchaseOrderLine.id }).from(salonPurchaseOrderLine).where(and(eq(salonPurchaseOrderLine.purchaseOrderId, id), eq(salonPurchaseOrderLine.productId, productId))).limit(1)
          if (existing.length) await tx.update(salonPurchaseOrderLine).set({ quantity, ...(cost !== undefined ? { unitCostCents: cost } : {}) }).where(eq(salonPurchaseOrderLine.id, existing[0].id))
          else await tx.insert(salonPurchaseOrderLine).values({ companyId, purchaseOrderId: id, productId, quantity, unitCostCents: cost ?? null })
        }
      }
    })
    return orderView(companyId, id)
  }

  /** Email the order to the supplier. Needs the supplier's address and at least one line; the order is then 'sent' and no longer a draft. */
  async function sendOrder(companyId: string, id: string, actor: any) {
    const claimed = await db.transaction(async (tx: Tx) => {
      const po = await lockOrder(tx, companyId, id)
      if (po.status !== 'draft') throw new StockError(po.status === 'cancelled' ? 'That order was cancelled.' : 'That order has already been sent.', 409, 'NOT_DRAFT')
      const [sup] = await tx.select().from(salonSupplier).where(eq(salonSupplier.id, po.supplierId)).limit(1)
      if (!sup?.email) throw new StockError(`Add an email address for ${sup?.name ?? 'the supplier'} first, so the order can be sent.`, 409, 'NO_SUPPLIER_EMAIL')
      const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(salonPurchaseOrderLine).where(eq(salonPurchaseOrderLine.purchaseOrderId, id))
      if (!Number(n?.n)) throw new StockError('Add at least one product to the order.', 409, 'NO_LINES')
      await tx.update(salonPurchaseOrder).set({ status: 'sent', sentAt: new Date(), sentTo: sup.email }).where(eq(salonPurchaseOrder.id, id))
      return { po, sup }
    })
    const view = await orderView(companyId, id)
    const salon = await salonName(companyId)
    try {
      await d.services.emailService.sendRaw({
        to: claimed.sup.email as string, fromName: salon, subject: `Purchase order ${view.number} from ${salon}`,
        html: `<p>Hello${claimed.sup.contactName ? ' ' + escHtml(claimed.sup.contactName) : ''},</p><p>Please supply the following to ${escHtml(salon)}.</p>
<table style="border-collapse:collapse" cellpadding="6"><tr><th align="left">Product</th><th align="left">SKU</th><th align="right">Quantity</th><th align="right">Unit cost</th></tr>${view.lines.map((l: any) => `<tr><td>${escHtml(l.name)}</td><td>${escHtml(l.sku || '')}</td><td align="right">${l.quantity}</td><td align="right">${l.unitCostCents == null ? '' : money(l.unitCostCents)}</td></tr>`).join('')}</table>
${view.totalCents ? `<p>Order total at these costs: <strong>${money(view.totalCents)}</strong></p>` : ''}${view.note ? `<p>${escHtml(view.note)}</p>` : ''}<p>Order reference: <strong>${escHtml(view.number)}</strong>. Please reply to this email to confirm.</p>`,
      })
    } catch (e: any) {
      // Not sent: the order goes back to a draft so it can be tried again.
      await db.update(salonPurchaseOrder).set({ status: 'draft', sentAt: null, sentTo: null }).where(eq(salonPurchaseOrder.id, id))
      logger.warn('[salon-retail] purchase order email failed', { error: e?.message })
      throw new StockError('The order could not be emailed. It is still a draft; try again.', 409, 'EMAIL_FAILED')
    }
    void actor
    return view
  }

  /**
   * Receive part or all of an order, line by line: each line says how many arrived (never more than is still owed) and, optionally, what each
   * cost. The units go into stock at the order's place under the product's lock; a cost entered becomes the product's cost. The order is
   * 'partial' until every line is complete, then 'received'.
   */
  async function receiveOrder(companyId: string, id: string, b: Record<string, unknown>, actor: any) {
    if (!Array.isArray(b.lines) || !b.lines.length) throw new StockError('Say what arrived on at least one line.', 400, 'NO_LINES')
    const lines = (b.lines as any[]).map((r) => ({ lineId: String(r?.lineId ?? ''), quantity: whole(r?.quantity, 'quantity', 'The number received'), cost: r?.unitCostCents === undefined || r?.unitCostCents === null || r?.unitCostCents === '' ? undefined : whole(r.unitCostCents, 'unitCostCents', 'The cost', { min: 0, max: 1_000_000 }) }))
    if (new Set(lines.map((l) => l.lineId)).size !== lines.length) throw new StockError('A line is in the delivery twice.', 400, 'DUPLICATE')
    await db.transaction(async (tx: Tx) => {
      const po = await lockOrder(tx, companyId, id)
      if (po.status === 'draft') throw new StockError('Send the order before receiving it.', 409, 'NOT_SENT')
      if (po.status === 'cancelled') throw new StockError('That order was cancelled.', 409, 'CANCELLED')
      if (po.status === 'received') throw new StockError('That order has already been received in full.', 409, 'ALREADY_RECEIVED')
      const place = po.locationId ?? await defaultStockLocation(tx, companyId)
      // Products locked in one fixed order.
      const rows = await tx.select().from(salonPurchaseOrderLine).where(and(eq(salonPurchaseOrderLine.purchaseOrderId, id), inArray(salonPurchaseOrderLine.id, lines.map((l) => l.lineId)))).orderBy(asc(salonPurchaseOrderLine.productId))
      if (rows.length !== lines.length) throw new StockError('One of those lines is not on this order.', 404, 'NO_LINE')
      const byLine = new Map<string, typeof salonPurchaseOrderLine.$inferSelect>(rows.map((r: any) => [r.id, r]))
      for (const l of lines) {
        const row = byLine.get(l.lineId)!
        const owed = row.quantity - row.received
        if (l.quantity > owed) throw new StockError(owed > 0 ? `Only ${owed} more are expected on that line.` : 'That line has been received in full.', 409, 'OVER_RECEIVE', 'quantity')
      }
      for (const row of rows) await lockRetailProduct(tx, companyId, row.productId)
      for (const l of lines) {
        const row = byLine.get(l.lineId)!
        await tx.insert(salonStockMove).values({ companyId, productId: row.productId, quantity: l.quantity, kind: 'received', note: `Received on ${po.number}`, byName: nameOf(actor), locationId: place, purchaseOrderId: id })
        await tx.update(salonPurchaseOrderLine).set({ received: row.received + l.quantity, ...(l.cost !== undefined ? { unitCostCents: l.cost } : {}) }).where(eq(salonPurchaseOrderLine.id, row.id))
        if (l.cost !== undefined) await tx.update(salonRetailProduct).set({ costCents: l.cost }).where(eq(salonRetailProduct.id, row.productId))
      }
      const after = await tx.select({ quantity: salonPurchaseOrderLine.quantity, received: salonPurchaseOrderLine.received }).from(salonPurchaseOrderLine).where(eq(salonPurchaseOrderLine.purchaseOrderId, id))
      const complete = after.every((r: any) => r.received >= r.quantity)
      await tx.update(salonPurchaseOrder).set({ status: complete ? 'received' : 'partial' }).where(eq(salonPurchaseOrder.id, id))
    })
    void alertLow(companyId)
    return orderView(companyId, id)
  }

  async function cancelOrder(companyId: string, id: string) {
    await db.transaction(async (tx: Tx) => {
      const po = await lockOrder(tx, companyId, id)
      if (po.status === 'received' || po.status === 'cancelled') throw new StockError(`That order is already ${po.status}.`, 409, 'CLOSED')
      const [got] = await tx.select({ n: sql<number>`coalesce(sum(${salonPurchaseOrderLine.received}), 0)::int` }).from(salonPurchaseOrderLine).where(eq(salonPurchaseOrderLine.purchaseOrderId, id))
      if (Number(got?.n) > 0) throw new StockError('Part of this order has been received, so it cannot be cancelled.', 409, 'PART_RECEIVED')
      await tx.update(salonPurchaseOrder).set({ status: 'cancelled' }).where(eq(salonPurchaseOrder.id, id))
    })
    return orderView(companyId, id)
  }

  // ─── Refund → back on the shelf ────────────────────────────────────────────────────────────
  /** The retail on a sale: what was sold, and how many are already back on the shelf. */
  async function saleRetail(companyId: string, invoiceId: string) {
    const [inv] = await db.select().from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId))).limit(1)
    if (!inv) throw new StockError('That sale was not found.', 404)
    const sold = await db.select({ productId: salonRetailSale.productId, quantity: sql<number>`sum(${salonRetailSale.quantity})::int`, name: salonRetailProduct.name, brand: salonRetailProduct.brand })
      .from(salonRetailSale).innerJoin(salonRetailProduct, eq(salonRetailSale.productId, salonRetailProduct.id)).where(eq(salonRetailSale.invoiceId, invoiceId)).groupBy(salonRetailSale.productId, salonRetailProduct.name, salonRetailProduct.brand)
    const back = await retailReturnedOn(db, companyId, invoiceId)
    return {
      refunded: Number(inv.amountRefunded || 0) > 0.005,
      lines: sold.map((r: any) => ({ productId: r.productId, name: [r.brand, r.name].filter(Boolean).join(' '), sold: Number(r.quantity), returned: back.get(r.productId) ?? 0, canReturn: Math.max(0, Number(r.quantity) - (back.get(r.productId) ?? 0)) })),
    }
  }

  /** Put units back on the shelf after a refund — the person's choice, since a returned bottle may not be fit to resell. Never more than were sold. */
  async function returnToShelf(companyId: string, invoiceId: string, b: Record<string, unknown>, actor: any) {
    if (!Array.isArray(b.items) || !b.items.length) throw new StockError('Choose what goes back on the shelf.', 400, 'NO_ITEMS')
    const items = (b.items as any[]).map((r) => ({ productId: String(r?.productId ?? ''), quantity: whole(r?.quantity, 'quantity', 'The number of units', { max: 99 }) }))
    if (new Set(items.map((i) => i.productId)).size !== items.length) throw new StockError('A product is listed twice.', 400, 'DUPLICATE')
    await db.transaction(async (tx: Tx) => {
      const [inv] = await tx.select().from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId))).limit(1).for('update')
      if (!inv) throw new StockError('That sale was not found.', 404)
      if (inv.status === 'void') throw new StockError('A void sale already gave its units back.', 409, 'VOID')
      if (!(Number(inv.amountRefunded || 0) > 0.005)) throw new StockError('Only a sale that has been refunded can put units back. Refund it first.', 409, 'NOT_REFUNDED')
      const sold = await tx.select({ productId: salonRetailSale.productId, quantity: sql<number>`sum(${salonRetailSale.quantity})::int`, locationId: sql<string | null>`max(${salonRetailSale.locationId})` }).from(salonRetailSale).where(eq(salonRetailSale.invoiceId, invoiceId)).groupBy(salonRetailSale.productId)
      const soldBy = new Map<string, { quantity: number; locationId: string | null }>(sold.map((r: any) => [r.productId, { quantity: Number(r.quantity), locationId: r.locationId }]))
      for (const it of items.sort((a, b2) => a.productId.localeCompare(b2.productId))) await lockRetailProduct(tx, companyId, it.productId)
      const back = await retailReturnedOn(tx, companyId, invoiceId)
      for (const it of items) {
        const s = soldBy.get(it.productId)
        if (!s) throw new StockError('That product was not on this sale.', 404, 'NOT_ON_SALE')
        const left = s.quantity - (back.get(it.productId) ?? 0)
        if (it.quantity > left) throw new StockError(left > 0 ? `Only ${left} can still go back on the shelf from this sale.` : 'Everything sold has already gone back on the shelf.', 409, 'OVER_RETURN', 'quantity')
        await tx.insert(salonStockMove).values({ companyId, productId: it.productId, quantity: it.quantity, kind: 'returned', note: `Back on the shelf after a refund of ${inv.number}`, byName: nameOf(actor), locationId: s.locationId, invoiceId })
      }
    })
    return saleRetail(companyId, invoiceId)
  }

  return {
    suppliers, createSupplier, updateSupplier, locations, createLocation, placeOf, byCode, count, transfer, stockByPlace,
    lowItems, alertLow, stockValue, weeklySummary, runners,
    orders, orderView, draftFromLow, createOrder, editOrder, sendOrder, receiveOrder, cancelOrder, saleRetail, returnToShelf,
  }
}
export type RetailStock = ReturnType<typeof createRetailStock>

/** /api/salon-retail-stock (behind `salon_retail`). The same inventory rights as the catalogue: read to see, create/update to change. */
export function createRetailStockRoutes(d: CrmDeps, r: RetailStock) {
  const { requirePermission, requireAnyPermission } = d.permissions
  const app = new Hono<AppEnv>()
  const body = async (c: any) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  async function act(c: any, status: 200 | 201, fn: () => Promise<object>) {
    try { return one(c, { ok: true, ...(await fn()) }, status) }
    catch (e: any) {
      if (e instanceof StockError) return fail(c, e.status, e.message, e.code, e.field ? { [e.field]: e.message } : undefined)
      d.logger.error('[salon-retail-stock]', { error: e?.message || String(e) })
      return fail(c, 500, 'That did not save. Try again.')
    }
  }
  const nocache = (c: any) => c.header('Cache-Control', 'no-store')
  const user = (c: any) => c.get('user') as any
  // A barcode at the till is read by the seats that sell, so finding a product by it asks the selling rights as well as the inventory right.
  const mayScan = requireAnyPermission(['inventory:read', 'invoices:update', 'retail:sell'])

  app.get('/suppliers', requirePermission('inventory:read'), async (c) => { nocache(c); return one(c, { suppliers: await r.suppliers(user(c).companyId) }) })
  app.post('/suppliers', requirePermission('inventory:create'), async (c) => { const b = await body(c); return act(c, 201, async () => { const supplier = await r.createSupplier(user(c).companyId, b); d.audit.log({ req: c, action: 'create', entity: 'salon_supplier', entityId: supplier.id, entityName: supplier.name }); return { supplier } }) })
  app.patch('/suppliers/:id', requirePermission('inventory:update'), async (c) => { const b = await body(c); return act(c, 200, async () => { const supplier = await r.updateSupplier(user(c).companyId, c.req.param('id'), b); d.audit.log({ req: c, action: 'update', entity: 'salon_supplier', entityId: supplier.id, entityName: supplier.name, changes: b }); return { supplier } }) })

  app.get('/locations', requirePermission('inventory:read'), async (c) => { nocache(c); return one(c, { locations: await r.locations(user(c).companyId) }) })
  app.post('/locations', requirePermission('inventory:create'), async (c) => { const b = await body(c); return act(c, 201, async () => ({ location: await r.createLocation(user(c).companyId, b) })) })
  app.get('/by-place', requirePermission('inventory:read'), async (c) => {
    nocache(c)
    const { places, byProduct } = await r.stockByPlace(user(c).companyId)
    return one(c, { places, stock: Object.fromEntries(byProduct) })
  })

  app.get('/scan', mayScan, async (c) => { nocache(c); return act(c, 200, async () => ({ product: await r.byCode(user(c).companyId, c.req.query('code')) })) })
  app.post('/count', requirePermission('inventory:update'), async (c) => { const b = await body(c); return act(c, 200, async () => { const out = await r.count(user(c).companyId, b, user(c)); d.audit.log({ req: c, action: 'update', entity: 'salon_stock_count', entityId: user(c).companyId, changes: { counted: out.counted, changed: out.changed.length } }); void r.alertLow(user(c).companyId); return out }) })
  app.post('/transfers', requirePermission('inventory:update'), async (c) => { const b = await body(c); return act(c, 201, async () => { const out = await r.transfer(user(c).companyId, b, user(c)); d.audit.log({ req: c, action: 'update', entity: 'salon_stock_transfer', entityId: out.transferId, changes: { quantity: out.quantity } }); void r.alertLow(user(c).companyId); return out }) })

  app.get('/low', requirePermission('inventory:read'), async (c) => { nocache(c); return one(c, { products: await r.lowItems(user(c).companyId), value: await r.stockValue(user(c).companyId) }) })

  app.get('/orders', requirePermission('inventory:read'), async (c) => { nocache(c); return one(c, { orders: await r.orders(user(c).companyId) }) })
  app.get('/orders/:id', requirePermission('inventory:read'), async (c) => { nocache(c); return act(c, 200, async () => ({ order: await r.orderView(user(c).companyId, c.req.param('id')) })) })
  app.post('/orders', requirePermission('inventory:create'), async (c) => { const b = await body(c); return act(c, 201, async () => ({ order: await r.createOrder(user(c).companyId, b, user(c)) })) })
  app.post('/orders/from-low', requirePermission('inventory:create'), async (c) => { const b = await body(c); return act(c, 201, async () => r.draftFromLow(user(c).companyId, b, user(c))) })
  app.patch('/orders/:id', requirePermission('inventory:update'), async (c) => { const b = await body(c); return act(c, 200, async () => ({ order: await r.editOrder(user(c).companyId, c.req.param('id'), b) })) })
  app.post('/orders/:id/send', requirePermission('inventory:update'), async (c) => act(c, 200, async () => { const order = await r.sendOrder(user(c).companyId, c.req.param('id'), user(c)); d.audit.log({ req: c, action: 'update', entity: 'salon_purchase_order', entityId: order.id, entityName: order.number, changes: { sentTo: order.sentTo } }); return { order } }))
  app.post('/orders/:id/receive', requirePermission('inventory:update'), async (c) => { const b = await body(c); return act(c, 200, async () => { const order = await r.receiveOrder(user(c).companyId, c.req.param('id'), b, user(c)); d.audit.log({ req: c, action: 'update', entity: 'salon_purchase_order', entityId: order.id, entityName: order.number, changes: { received: b.lines } }); return { order } }) })
  app.post('/orders/:id/cancel', requirePermission('inventory:update'), async (c) => act(c, 200, async () => ({ order: await r.cancelOrder(user(c).companyId, c.req.param('id')) })))

  // After a refund: which retail units are on the sale and may go back on the shelf, and putting them back.
  const mayReturn = requireAnyPermission(['payments:delete', 'inventory:update'])
  app.get('/sales/:invoiceId/retail', requireAnyPermission(['invoices:read', 'inventory:read']), async (c) => { nocache(c); return act(c, 200, () => r.saleRetail(user(c).companyId, c.req.param('invoiceId'))) })
  app.post('/sales/:invoiceId/return-to-shelf', mayReturn, async (c) => { const b = await body(c); return act(c, 200, async () => { const out = await r.returnToShelf(user(c).companyId, c.req.param('invoiceId'), b, user(c)); d.audit.log({ req: c, action: 'update', entity: 'invoice', entityId: c.req.param('invoiceId'), changes: { retailBackOnShelf: b.items } }); return out }) })
  return app
}

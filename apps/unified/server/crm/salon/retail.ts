// Retail at the desk (salon gap #7, second half; hidden feature `salon_retail`; docs/parity/salon-chair-checkout.md).
//
//   PRODUCTS  what the salon sells off the shelf: name, brand, price, what it cost (managers only), a reorder level.
//   STOCK     on hand = what came in (received, corrected) less the units on sales that stand. It is never stored as a number, so a
//             void sale gives its units back by itself and two screens cannot disagree.
//   SELL      a product goes on a sale as a "retail" line (the type the commission plans and the retail report already read), the sale
//             is re-totalled with the sale's own tax rate, and the units are taken in the same transaction under the product's row
//             lock — two desks selling the last bottle are served one after the other, and the second is told there is none.
//   REMOVE    taking the line off an unpaid sale gives the units back.
//
// A retail line changed through the general invoice edit form is rewritten by that form (it keeps no product link): its units go back on the
// shelf and the line stays as a plain one. The Sell panel is where retail is added and removed. A refund does not put units back (the
// bottle may not be); a manager corrects the count with a stock adjustment. No money moves here: payment is taken the usual ways.
import { Hono } from 'hono'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { retotalInvoice } from '@twomiah/tenant-backend'
import { company, contact, invoice, invoiceLineItem, salonRetailProduct, salonRetailSale, salonStockMove } from '../../db/schema/index.ts'
import { lockRetailProduct, retailOnHand } from '../../data/salon.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import type { SalonServices } from './services.ts'

type Tx = any
export type RetailProduct = typeof salonRetailProduct.$inferSelect

export class RetailError extends Error { constructor(message: string, public status: 400 | 404 | 409 = 400, public code?: string, public field?: string) { super(message) } }

const MAX_PRICE_CENTS = 1_000_000
const MAX_UNITS_PER_LINE = 99
const MAX_LINES_PER_CALL = 20
/** Statuses a sale can still take another line in. A paid, void or refunded sale is closed: start a new sale. */
const CLOSED = new Set(['paid', 'void', 'refunded'])

const text = (v: unknown, max: number): string | null => { const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max); return s || null }
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const nameOf = (u: any) => [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || u?.email || 'Staff'
const lineName = (p: { brand: string | null; name: string }) => [p.brand, p.name].filter(Boolean).join(' ').slice(0, 200)

function cents(v: unknown, field: string, label: string, { min = 0, required = true }: { min?: number; required?: boolean } = {}): number | null {
  if (v === undefined || v === null || v === '') { if (required) throw new RetailError(`Enter ${label}.`, 400, 'BAD_AMOUNT', field); return null }
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > MAX_PRICE_CENTS) throw new RetailError(`${label[0].toUpperCase()}${label.slice(1)} must be between $${(min / 100).toFixed(2)} and $${(MAX_PRICE_CENTS / 100).toLocaleString('en-US')}.`, 400, 'BAD_AMOUNT', field)
  return n
}

export function createSalonRetail(d: CrmDeps, s: SalonServices) {
  const { db, logger } = d
  const live = d.realtime

  const view = (p: RetailProduct, onHand: number, manage: boolean) => ({
    id: p.id, name: p.name, brand: p.brand, sku: p.sku, priceCents: p.priceCents, active: p.active, onHand,
    low: p.reorderAt != null && onHand <= p.reorderAt,
    ...(manage ? { costCents: p.costCents, reorderAt: p.reorderAt } : {}),
  })

  /** Products with their stock. `manage` adds cost and the reorder level and includes products taken off the shelf. */
  async function list(companyId: string, manage: boolean) {
    const rows: RetailProduct[] = await db.select().from(salonRetailProduct)
      .where(manage ? eq(salonRetailProduct.companyId, companyId) : and(eq(salonRetailProduct.companyId, companyId), eq(salonRetailProduct.active, true)))
      .orderBy(asc(salonRetailProduct.brand), asc(salonRetailProduct.name)).limit(1000)
    const stock = await retailOnHand(db, companyId, null)
    return rows.map((p) => view(p, stock.get(p.id) ?? 0, manage))
  }

  function readProduct(b: Record<string, unknown>, partial: boolean) {
    const out: Partial<typeof salonRetailProduct.$inferInsert> = {}
    if (!partial || b.name !== undefined) {
      const name = text(b.name, 120)
      if (!name) throw new RetailError('Give the product a name.', 400, 'NAME_REQUIRED', 'name')
      out.name = name
    }
    if (b.brand !== undefined) out.brand = text(b.brand, 80)
    if (b.sku !== undefined) out.sku = text(b.sku, 40)
    if (!partial || b.priceCents !== undefined) out.priceCents = cents(b.priceCents, 'priceCents', 'a price', { min: 1 }) as number
    if (b.costCents !== undefined) out.costCents = cents(b.costCents, 'costCents', 'a cost', { required: false })
    if (b.reorderAt !== undefined) {
      if (b.reorderAt === null || b.reorderAt === '') out.reorderAt = null
      else { const n = Number(b.reorderAt); if (!Number.isInteger(n) || n < 0 || n > 100_000) throw new RetailError('The reorder level is a whole number of units.', 400, 'BAD_REORDER', 'reorderAt'); out.reorderAt = n }
    }
    if (b.active !== undefined) out.active = !!b.active
    return out
  }

  async function createProduct(companyId: string, b: Record<string, unknown>, actor: any) {
    const values = readProduct(b, false)
    const [row] = await db.insert(salonRetailProduct).values({ ...values, companyId } as any).returning()
    // Opening stock is the first stock-in, so the history starts at the beginning.
    const opening = b.openingStock === undefined || b.openingStock === '' ? 0 : Number(b.openingStock)
    if (!Number.isInteger(opening) || opening < 0 || opening > 100_000) throw new RetailError('Opening stock is a whole number of units.', 400, 'BAD_QUANTITY', 'openingStock')
    if (opening > 0) await db.insert(salonStockMove).values({ companyId, productId: row.id, quantity: opening, kind: 'received', note: 'Opening stock', byName: nameOf(actor) })
    return view(row, opening, true)
  }

  async function updateProduct(companyId: string, id: string, b: Record<string, unknown>) {
    const values = readProduct(b, true)
    if (!Object.keys(values).length) throw new RetailError('Nothing to change.')
    const [row] = await db.update(salonRetailProduct).set(values).where(and(eq(salonRetailProduct.id, id), eq(salonRetailProduct.companyId, companyId))).returning()
    if (!row) throw new RetailError('That product is gone.', 404)
    return view(row, (await retailOnHand(db, companyId, [id])).get(id) ?? 0, true)
  }

  /** Stock in, or a correction (a count that did not match, breakage). Under the product's lock, so the count cannot be taken below zero by two at once. */
  async function moveStock(companyId: string, productId: string, b: Record<string, unknown>, actor: any) {
    const kind = b.kind === 'adjust' ? 'adjust' : b.kind === 'received' || b.kind === undefined ? 'received' : null
    if (!kind) throw new RetailError('Choose stock received or a correction.', 400, 'BAD_KIND', 'kind')
    const quantity = Number(b.quantity)
    if (!Number.isInteger(quantity) || quantity === 0 || Math.abs(quantity) > 100_000) throw new RetailError('Enter how many units, as a whole number.', 400, 'BAD_QUANTITY', 'quantity')
    if (kind === 'received' && quantity < 0) throw new RetailError('Stock received is a positive number. To take units off the count, make a correction.', 400, 'BAD_QUANTITY', 'quantity')
    const note = text(b.note, 160)
    if (kind === 'adjust' && !note) throw new RetailError('Say why the count changed.', 400, 'REASON_REQUIRED', 'note')
    return db.transaction(async (tx: Tx) => {
      const product = await lockRetailProduct(tx, companyId, productId)
      if (!product) throw new RetailError('That product is gone.', 404)
      const have = (await retailOnHand(tx, companyId, [productId])).get(productId) ?? 0
      if (have + quantity < 0) throw new RetailError(`Only ${have} on the shelf, so the count cannot go down by ${Math.abs(quantity)}.`, 409, 'BELOW_ZERO', 'quantity')
      await tx.insert(salonStockMove).values({ companyId, productId, quantity, kind, note, byName: nameOf(actor) })
      return view(product, have + quantity, true)
    })
  }

  // ─── Selling ──────────────────────────────────────────────────────────────────────────────────
  interface Item { productId: string; quantity: number }
  function readItems(raw: unknown): Item[] {
    if (!Array.isArray(raw) || !raw.length) throw new RetailError('Choose at least one product.', 400, 'NO_ITEMS')
    if (raw.length > MAX_LINES_PER_CALL) throw new RetailError(`Add ${MAX_LINES_PER_CALL} products or fewer at a time.`, 400, 'TOO_MANY')
    return raw.map((r: any) => {
      const quantity = Number(r?.quantity ?? 1)
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_UNITS_PER_LINE) throw new RetailError(`Sell 1 to ${MAX_UNITS_PER_LINE} of a product at a time.`, 400, 'BAD_QUANTITY')
      return { productId: String(r?.productId ?? ''), quantity }
    })
  }

  /** The sale's totals worked again from ALL its lines, written in the caller's transaction. */
  async function retotal(tx: Tx, inv: typeof invoice.$inferSelect): Promise<void> {
    const lines = await tx.select({ description: invoiceLineItem.description, quantity: invoiceLineItem.quantity, unitPrice: invoiceLineItem.unitPrice }).from(invoiceLineItem).where(eq(invoiceLineItem.invoiceId, inv.id))
    const out = retotalInvoice(inv, lines.map((l: any) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })), Number(inv.taxRate), Number(inv.discount))
    if ('error' in out) throw new RetailError(out.error, 409, 'TOTAL_BELOW_PAID')
    await tx.update(invoice).set({ ...out.fields, updatedAt: new Date() } as any).where(eq(invoice.id, inv.id))
  }

  /**
   * Put products on a sale. With `invoiceId`: on that open sale (its own tax rate applies). Without: on a new sale for the client
   * (`contactId`, optional — a walk-in buys a bottle), taxed at the salon's default rate. Returns the sale and what each line cost.
   */
  async function sell(companyId: string, input: { invoiceId?: unknown; contactId?: unknown; items: unknown }, actor: any) {
    const items = readItems(input.items)
    const want = new Map<string, number>()
    for (const it of items) want.set(it.productId, (want.get(it.productId) ?? 0) + it.quantity)
    const ids = [...want.keys()].sort()
    const outcome = await db.transaction(async (tx: Tx) => {
      // Products locked in one fixed order, so two sales of the same two products cannot wait on each other.
      const products = new Map<string, RetailProduct>()
      for (const id of ids) {
        const p = await lockRetailProduct(tx, companyId, id)
        if (!p || !p.active) throw new RetailError('One of those products is not on sale any more.', 404, 'NO_PRODUCT')
        products.set(id, p)
      }
      const stock = await retailOnHand(tx, companyId, ids)
      for (const id of ids) {
        const have = stock.get(id) ?? 0, p = products.get(id)!
        if (want.get(id)! > have) throw new RetailError(have > 0 ? `Only ${have} of ${lineName(p)} on the shelf.` : `${lineName(p)} is out of stock.`, 409, 'OUT_OF_STOCK')
      }
      let inv: typeof invoice.$inferSelect, created = false
      if (input.invoiceId) {
        const [row] = await tx.select().from(invoice).where(and(eq(invoice.id, String(input.invoiceId)), eq(invoice.companyId, companyId))).limit(1).for('update')
        if (!row) throw new RetailError('That sale was not found.', 404)
        if (CLOSED.has(row.status)) throw new RetailError(row.status === 'paid' ? 'That sale is already paid. Start a new sale for the products.' : 'That sale is closed. Start a new sale for the products.', 409, 'SALE_CLOSED')
        const [gift] = await tx.select({ id: invoiceLineItem.id }).from(invoiceLineItem).where(and(eq(invoiceLineItem.invoiceId, row.id), eq(invoiceLineItem.type, 'gift_card'))).limit(1)
        if (gift) throw new RetailError('A gift card sale holds only the card. Start a new sale for the products.', 409, 'GIFT_CARD_SALE')
        inv = row
      } else {
        let contactId: string | null = null
        if (input.contactId) {
          const [found] = await tx.select({ id: contact.id }).from(contact).where(and(eq(contact.id, String(input.contactId)), eq(contact.companyId, companyId))).limit(1)
          if (!found) throw new RetailError('That client was not found.', 404)
          contactId = String(input.contactId)
        }
        const [co] = await tx.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
        const rate = Number((co?.settings as any)?.defaultTaxRate)
        const taxRate = Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : 0
        ;[inv] = await tx.insert(invoice).values({
          companyId, contactId, number: await s.checkout.nextInvoiceNumber(companyId, tx), status: 'open', subtotal: '0', taxRate: String(taxRate), taxAmount: '0',
          discount: '0', total: '0', amountPaid: '0', dueDate: new Date(), sentAt: null, notes: 'Retail sold at the desk',
        } as any).returning()
        created = true
      }
      const [last] = await tx.select({ n: sql<number>`coalesce(max(${invoiceLineItem.sortOrder}), -1)` }).from(invoiceLineItem).where(eq(invoiceLineItem.invoiceId, inv.id))
      let order = Number(last?.n ?? -1) + 1
      const added: Array<{ lineId: string; name: string; quantity: number; totalCents: number }> = []
      for (const it of items) {
        const p = products.get(it.productId)!
        const total = round2((p.priceCents * it.quantity) / 100)
        const [line] = await tx.insert(invoiceLineItem).values({
          invoiceId: inv.id, description: lineName(p), type: 'retail', quantity: String(it.quantity), unitPrice: (p.priceCents / 100).toFixed(2), total: total.toFixed(2), sortOrder: order++,
        } as any).returning()
        await tx.insert(salonRetailSale).values({ companyId, productId: p.id, invoiceId: inv.id, lineItemId: line.id, quantity: it.quantity })
        added.push({ lineId: line.id, name: lineName(p), quantity: it.quantity, totalCents: Math.round(total * 100) })
      }
      await retotal(tx, inv)
      const [after] = await tx.select().from(invoice).where(eq(invoice.id, inv.id)).limit(1)
      return { sale: after as typeof invoice.$inferSelect, created, added }
    })
    live.emitToCompany(companyId, outcome.created ? live.EVENTS.INVOICE_CREATED : live.EVENTS.INVOICE_UPDATED, outcome.sale)
    try {
      await d.audit.log({ action: outcome.created ? 'create' : 'update', entity: 'invoice', entityId: outcome.sale.id, entityName: outcome.sale.number, companyId, req: { user: actor }, metadata: { retail: outcome.added.map((a: { quantity: number; name: string }) => `${a.quantity} × ${a.name}`) } })
    } catch (e: any) { logger.warn('[salon-retail] sale not audited', { error: e?.message }) }
    return { invoiceId: outcome.sale.id, invoiceNumber: outcome.sale.number, totalCents: Math.round(Number(outcome.sale.total) * 100), created: outcome.created, lines: outcome.added }
  }

  /** Take a retail line off an unpaid sale; its units go back on the shelf (they are on the sale's line, and the line is gone). */
  async function removeLine(companyId: string, lineId: string, actor: any) {
    const done = await db.transaction(async (tx: Tx) => {
      const [sale] = await tx.select().from(salonRetailSale).where(and(eq(salonRetailSale.lineItemId, lineId), eq(salonRetailSale.companyId, companyId))).limit(1)
      if (!sale) throw new RetailError('That product is not on a sale any more.', 404)
      const [inv] = await tx.select().from(invoice).where(and(eq(invoice.id, sale.invoiceId), eq(invoice.companyId, companyId))).limit(1).for('update')
      if (!inv) throw new RetailError('That sale was not found.', 404)
      if (CLOSED.has(inv.status)) throw new RetailError('That sale is closed. Refund it instead of taking a product off.', 409, 'SALE_CLOSED')
      await tx.delete(salonRetailSale).where(eq(salonRetailSale.id, sale.id))
      await tx.delete(invoiceLineItem).where(eq(invoiceLineItem.id, lineId))
      await retotal(tx, inv)
      const [after] = await tx.select().from(invoice).where(eq(invoice.id, inv.id)).limit(1)
      return after as typeof invoice.$inferSelect
    })
    live.emitToCompany(companyId, live.EVENTS.INVOICE_UPDATED, done)
    try {
      await d.audit.log({ action: 'update', entity: 'invoice', entityId: done.id, entityName: done.number, companyId, req: { user: actor }, metadata: { retailLineRemoved: lineId } })
    } catch (e: any) { logger.warn('[salon-retail] removal not audited', { error: e?.message }) }
    return { invoiceId: done.id, totalCents: Math.round(Number(done.total) * 100) }
  }

  /** The stock history of one product, newest first (received, corrected and sold). */
  async function history(companyId: string, productId: string) {
    const moves = await db.select().from(salonStockMove).where(and(eq(salonStockMove.companyId, companyId), eq(salonStockMove.productId, productId))).orderBy(desc(salonStockMove.at)).limit(100)
    const sold = await db.select({ quantity: salonRetailSale.quantity, at: salonRetailSale.createdAt, number: invoice.number, status: invoice.status })
      .from(salonRetailSale).innerJoin(invoice, eq(salonRetailSale.invoiceId, invoice.id))
      .where(and(eq(salonRetailSale.companyId, companyId), eq(salonRetailSale.productId, productId))).orderBy(desc(salonRetailSale.createdAt)).limit(100)
    return {
      moves: moves.map((m: any) => ({ kind: m.kind, quantity: m.quantity, note: m.note, by: m.byName, at: m.at })),
      sales: sold.map((r: any) => ({ quantity: r.quantity, at: r.at, sale: r.number, void: r.status === 'void' })),
    }
  }

  return { list, createProduct, updateProduct, moveStock, sell, removeLine, history }
}
export type SalonRetail = ReturnType<typeof createSalonRetail>

/** /api/salon-retail (behind `salon_retail`). Selling asks the rights a sale does; the catalogue and the count ask the inventory rights a manager holds. */
export function createSalonRetailRoutes(d: CrmDeps, r: SalonRetail) {
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  async function act(c: any, status: 200 | 201, fn: () => Promise<object>) {
    try { return one(c, { ok: true, ...(await fn()) }, status) }
    catch (e: any) {
      if (e instanceof RetailError) return fail(c, e.status, e.message, e.code, e.field ? { [e.field]: e.message } : undefined)
      d.logger.error('[salon-retail]', { error: e?.message || String(e) })
      return fail(c, 500, 'That did not save. Try again.')
    }
  }
  const body = async (c: any) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>

  // What can be sold now, with the count: for the seat that takes the payment. Cost is not in it.
  app.get('/', requirePermission('invoices:read'), async (c) => {
    c.header('Cache-Control', 'no-store')
    return one(c, { products: await r.list((c.get('user') as any).companyId, false) })
  })
  // The whole catalogue with cost, reorder level and products taken off the shelf.
  app.get('/manage', requirePermission('inventory:read'), async (c) => {
    c.header('Cache-Control', 'no-store')
    return one(c, { products: await r.list((c.get('user') as any).companyId, true) })
  })
  app.get('/products/:id/history', requirePermission('inventory:read'), async (c) => {
    c.header('Cache-Control', 'no-store')
    return act(c, 200, () => r.history((c.get('user') as any).companyId, c.req.param('id')))
  })
  app.post('/products', requirePermission('inventory:create'), async (c) => {
    const u = c.get('user') as any
    const b = await body(c)
    return act(c, 201, async () => {
      const product = await r.createProduct(u.companyId, b, u)
      d.audit.log({ req: c, action: 'create', entity: 'salon_retail_product', entityId: product.id, entityName: product.name })
      return { product }
    })
  })
  app.patch('/products/:id', requirePermission('inventory:update'), async (c) => {
    const u = c.get('user') as any
    const b = await body(c)
    return act(c, 200, async () => {
      const product = await r.updateProduct(u.companyId, c.req.param('id'), b)
      d.audit.log({ req: c, action: 'update', entity: 'salon_retail_product', entityId: product.id, entityName: product.name, changes: b })
      return { product }
    })
  })
  app.post('/products/:id/stock', requirePermission('inventory:update'), async (c) => {
    const u = c.get('user') as any
    const b = await body(c)
    return act(c, 200, async () => {
      const product = await r.moveStock(u.companyId, c.req.param('id'), b, u)
      d.audit.log({ req: c, action: 'update', entity: 'salon_retail_product', entityId: product.id, entityName: product.name, changes: { stock: { kind: b.kind ?? 'received', quantity: b.quantity, note: b.note } } })
      return { product }
    })
  })
  // On a sale that is already open.
  app.post('/sell', requirePermission('invoices:update'), async (c) => {
    const u = c.get('user') as any
    const b = await body(c)
    if (!b.invoiceId) return fail(c, 400, 'Which sale?', 'NO_SALE', { invoiceId: 'Which sale?' })
    return act(c, 200, () => r.sell(u.companyId, b as any, u))
  })
  // On a new sale (a walk-in buying a bottle): a sale is made, so both rights.
  app.post('/sell/new', requirePermission('invoices:create'), requirePermission('invoices:update'), async (c) => {
    const u = c.get('user') as any
    const b = await body(c)
    return act(c, 201, () => r.sell(u.companyId, { contactId: b.contactId, items: b.items }, u))
  })
  app.delete('/lines/:lineId', requirePermission('invoices:update'), async (c) => {
    const u = c.get('user') as any
    return act(c, 200, () => r.removeLine(u.companyId, c.req.param('lineId'), u))
  })
  return app
}

// Ordering from the supplier at /api/material-supply (feature material_supply — not ready, hidden): the supplier's own price lists,
// an order priced from one and locked to it, the order sent to the supplier by email, and the supplier APIs as far as they can go
// before a partner agreement. docs/parity/roof-material-list.md #9–#11.
//
//   GET    /price-lists                  the company's supplier price lists (?supplier=)                  margin:read
//   GET    /price-lists/:id              one, with its items                                              margin:read
//   POST   /price-lists                  save one — items typed in, or a spreadsheet pasted as `csv`      inventory:create + margin:read
//   PUT    /price-lists/:id              change it (its items are replaced when items / csv are sent)     inventory:update + margin:read
//   DELETE /price-lists/:id              delete it; orders priced from it keep their prices, unlocked    inventory:delete + margin:read
//   POST   /orders/:id/price             price the order from the supplier's list and lock it            inventory:update
//   DELETE /orders/:id/price             take the supplier's pricing off the order                       inventory:update
//
// What a supplier charges the business is the business's cost, so the price lists are for a seat that may see costs (margin:read),
// and an order's prices are withheld from any other seat exactly as every material read does (materials.ts).
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, desc, eq } from 'drizzle-orm'
import { material, supplierPriceItem, supplierPriceList } from '../../../db/schema/index.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { canSeeWith } from '../../deps.ts'
import { clearPricing, dollarsToCents, parsePriceCsv, priceLines, sameSupplier, totalOf, type OrderLine, type ParsedItem, type PriceItem } from '../supplierPricing.ts'
import { withoutMaterialMoney } from './materials.ts'

const MAX_ITEMS = 5000

const itemSchema = z.object({
  code: z.string().trim().max(40).optional(),
  sku: z.string().trim().max(60).optional(),
  description: z.string().trim().min(1, 'Each item needs a description.').max(200),
  unit: z.string().trim().max(30).optional(),
  price: z.union([z.string(), z.number()]),
})
const listSchema = z.object({
  supplier: z.string().trim().min(1, 'Enter the supplier.').max(120),
  name: z.string().trim().min(1, 'Name the price list.').max(120),
  active: z.boolean().optional(),
  note: z.string().trim().max(1000).optional(),
  items: z.array(itemSchema).max(MAX_ITEMS).optional(),
  /** A spreadsheet pasted in: a header row (description, price, and optionally sku, unit, code) and one item a row. */
  csv: z.string().max(1_000_000).optional(),
})

export const shapeItem = (r: any) => ({ id: r.id, code: r.code ?? null, sku: r.sku ?? null, description: r.description, unit: r.unit, unitPriceCents: r.unitPriceCents })
const shapeList = (r: any, extra: Record<string, unknown> = {}) => ({
  id: r.id, supplier: r.supplier, name: r.name, active: r.active, note: r.note ?? null,
  createdAt: new Date(r.createdAt).toISOString(), updatedAt: new Date(r.updatedAt).toISOString(), ...extra,
})

export function createMaterialSupplyRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const canSee = canSeeWith(d.permissions)
  const app = new Hono<AppEnv>()
  const needCost = requirePermission('margin:read')
  const maySeeCost = async (c: any) => { const u = c.get('user'); try { return !!(await canSee(u.role, 'margin:read', u.userId)) } catch { return false } }

  const ownList = async (companyId: string, id: string) =>
    (await db.select().from(supplierPriceList).where(and(eq(supplierPriceList.id, id), eq(supplierPriceList.companyId, companyId))).limit(1))[0]
  const itemsOf = async (listId: string): Promise<PriceItem[]> =>
    (await db.select().from(supplierPriceItem).where(eq(supplierPriceItem.priceListId, listId)).orderBy(asc(supplierPriceItem.sortOrder), asc(supplierPriceItem.id))).map(shapeItem)
  const ownOrder = async (companyId: string, id: string) =>
    (await db.select().from(material).where(and(eq(material.id, id), eq(material.companyId, companyId))).limit(1))[0]

  /** The items a request carries, as cents — or the sentence that says what is wrong with them. */
  function itemsFrom(v: z.infer<typeof listSchema>): { items?: ParsedItem[]; error?: string } {
    if (v.csv !== undefined && v.items !== undefined) return { error: 'Send the items or the pasted list, not both.' }
    if (v.csv !== undefined) {
      const parsed = parsePriceCsv(v.csv)
      if (parsed.errors.length) return { error: parsed.errors.slice(0, 5).join(' ') + (parsed.errors.length > 5 ? ` (and ${parsed.errors.length - 5} more)` : '') }
      if (parsed.items.length > MAX_ITEMS) return { error: `A price list holds at most ${MAX_ITEMS} items.` }
      return { items: parsed.items }
    }
    if (v.items !== undefined) {
      const out: ParsedItem[] = []
      for (const [i, it] of v.items.entries()) {
        const cents = dollarsToCents(it.price)
        if (cents === null) return { error: `Item ${i + 1}: "${it.price}" is not a price.` }
        out.push({ code: it.code || null, sku: it.sku || null, description: it.description, unit: it.unit || 'ea', unitPriceCents: cents })
      }
      return { items: out }
    }
    return {}
  }
  const insertItems = (tx: any, listId: string, items: ParsedItem[]) =>
    items.length ? tx.insert(supplierPriceItem).values(items.map((it, i) => ({ priceListId: listId, ...it, sortOrder: i }))) : Promise.resolve()

  app.get('/price-lists', needCost, async (c) => {
    const me = c.get('user')
    const supplier = c.req.query('supplier')
    const rows = await db.select().from(supplierPriceList).where(eq(supplierPriceList.companyId, me.companyId)).orderBy(desc(supplierPriceList.updatedAt), desc(supplierPriceList.id))
    const mine = supplier ? rows.filter((r: any) => sameSupplier(r.supplier, supplier)) : rows
    const counts = new Map<string, number>()
    for (const r of mine) counts.set(r.id, (await db.select({ id: supplierPriceItem.id }).from(supplierPriceItem).where(eq(supplierPriceItem.priceListId, r.id))).length)
    return list(c, mine.map((r: any) => shapeList(r, { itemCount: counts.get(r.id) ?? 0 })), { page: 1, limit: mine.length || 1, total: mine.length })
  })

  app.get('/price-lists/:id', needCost, async (c) => {
    const found = await ownList(c.get('user').companyId, c.req.param('id'))
    if (!found) return fail(c, 404, 'Price list not found')
    const items = await itemsOf(found.id)
    return one(c, shapeList(found, { itemCount: items.length, items }))
  })

  app.post('/price-lists', requirePermission('inventory:create'), needCost, async (c) => {
    const me = c.get('user')
    const parsed = listSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const got = itemsFrom(parsed.data)
    if (got.error) return fail(c, 400, got.error, 'bad_items')
    const made = await db.transaction(async (tx: any) => {
      const [row] = await tx.insert(supplierPriceList).values({ companyId: me.companyId, supplier: parsed.data.supplier, name: parsed.data.name, active: parsed.data.active ?? true, note: parsed.data.note || null }).returning()
      await insertItems(tx, row.id, got.items ?? [])
      return row
    })
    return one(c, shapeList(made, { itemCount: got.items?.length ?? 0 }), 201)
  })

  app.put('/price-lists/:id', requirePermission('inventory:update'), needCost, async (c) => {
    const me = c.get('user')
    const found = await ownList(me.companyId, c.req.param('id'))
    if (!found) return fail(c, 404, 'Price list not found')
    const parsed = listSchema.partial().safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const v = parsed.data
    const got = itemsFrom(v as z.infer<typeof listSchema>)
    if (got.error) return fail(c, 400, got.error, 'bad_items')
    const saved = await db.transaction(async (tx: any) => {
      const set: Record<string, unknown> = { updatedAt: new Date() }
      for (const k of ['supplier', 'name', 'active'] as const) if (v[k] !== undefined) set[k] = v[k]
      if (v.note !== undefined) set.note = v.note || null
      const [row] = await tx.update(supplierPriceList).set(set as any).where(and(eq(supplierPriceList.id, found.id), eq(supplierPriceList.companyId, me.companyId))).returning()
      if (got.items) {
        await tx.delete(supplierPriceItem).where(eq(supplierPriceItem.priceListId, found.id))
        await insertItems(tx, found.id, got.items)
      }
      return row
    })
    return one(c, shapeList(saved, { itemCount: (await itemsOf(found.id)).length }))
  })

  app.delete('/price-lists/:id', requirePermission('inventory:delete'), needCost, async (c) => {
    const me = c.get('user')
    const found = await ownList(me.companyId, c.req.param('id'))
    if (!found) return fail(c, 404, 'Price list not found')
    // An order priced from it keeps the prices it was given (the foreign key lets go); only the lock goes with the list.
    await db.delete(supplierPriceList).where(and(eq(supplierPriceList.id, found.id), eq(supplierPriceList.companyId, me.companyId)))
    return c.body(null, 204)
  })

  // ── pricing an order ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** An order can be priced, or have pricing taken off, until it has gone to the supplier. */
  const EDITABLE = ['not_ordered', 'ready_to_send', 'rejected']

  const shape = async (c: any, row: any) => ((await maySeeCost(c)) ? row : withoutMaterialMoney(row))

  app.post('/orders/:id/price', requirePermission('inventory:update'), async (c) => {
    const me = c.get('user')
    const order = await ownOrder(me.companyId, c.req.param('id'))
    if (!order) return fail(c, 404, 'Material order not found')
    if (!EDITABLE.includes(order.orderStatus)) return fail(c, 409, 'This order has already gone to the supplier at its prices. Make a new order to price it again.', 'order_not_editable')
    const body = ((await c.req.json().catch(() => null)) ?? {}) as { priceListId?: unknown }
    let chosen: any
    if (typeof body.priceListId === 'string' && body.priceListId) {
      chosen = await ownList(me.companyId, body.priceListId)
      if (!chosen) return fail(c, 404, 'Price list not found')
      if (!sameSupplier(chosen.supplier, order.supplier)) return fail(c, 409, `That price list is ${chosen.supplier}’s; this order is for ${order.supplier}. Change the order’s supplier first.`, 'wrong_supplier')
    } else {
      const lists = await db.select().from(supplierPriceList).where(and(eq(supplierPriceList.companyId, me.companyId), eq(supplierPriceList.active, true))).orderBy(desc(supplierPriceList.updatedAt), desc(supplierPriceList.id))
      chosen = lists.find((l: any) => sameSupplier(l.supplier, order.supplier))
      if (!chosen) return fail(c, 404, `There is no price list for ${order.supplier}. Add one under Price lists.`, 'no_price_list')
    }
    const priced = priceLines(Array.isArray(order.lineItems) ? (order.lineItems as OrderLine[]) : [], await itemsOf(chosen.id), chosen.id)
    const [saved] = await db.update(material).set({ lineItems: priced.lines, totalCost: priced.total.toFixed(2), priceListId: chosen.id, updatedAt: new Date() } as any)
      .where(and(eq(material.id, order.id), eq(material.companyId, me.companyId))).returning()
    return one(c, { order: await shape(c, saved), priceList: { id: chosen.id, name: chosen.name, supplier: chosen.supplier }, unmatched: priced.unmatched, pricedLines: priced.lines.length - priced.unmatched.length })
  })

  app.delete('/orders/:id/price', requirePermission('inventory:update'), async (c) => {
    const me = c.get('user')
    const order = await ownOrder(me.companyId, c.req.param('id'))
    if (!order) return fail(c, 404, 'Material order not found')
    if (!EDITABLE.includes(order.orderStatus)) return fail(c, 409, 'This order has already gone to the supplier at its prices.', 'order_not_editable')
    const lines = clearPricing(Array.isArray(order.lineItems) ? (order.lineItems as OrderLine[]) : [])
    const [saved] = await db.update(material).set({ lineItems: lines, totalCost: totalOf(lines).toFixed(2), priceListId: null, updatedAt: new Date() } as any)
      .where(and(eq(material.id, order.id), eq(material.companyId, me.companyId))).returning()
    return one(c, await shape(c, saved))
  })

  return app
}

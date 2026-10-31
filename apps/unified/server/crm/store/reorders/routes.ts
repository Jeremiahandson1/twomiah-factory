// "Draft a reorder" at /api/admin/reorders (access 'user', behind the hidden feature store_reorders; 2026-10-31, parity row 4
// against Shopify's purchase orders). From what the Low stock list and the daily low-stock email already show, the owner gets a
// purchase order per supplier — the low options, how many to order, the supplier's cost for each — edits it, emails it to the
// supplier, and books what arrives against it (a part delivery too), which puts the units on the shelf.
//
// Costs are the shop's own (margin:read, a manager's or the owner's): the whole group asks it, as its Menu row does; changing
// anything also asks products:update. All money is integer cents.
//   GET    /suggestions        what to order now, by supplier (and the low options that have no supplier yet)
//   POST   /draft              { supplierId, variantIds? } → a draft order of that supplier's suggestions
//   GET    /                   the orders (?status=)          GET /:id   one, with its lines
//   PUT    /:id                edit a DRAFT: supplier, note, expected day, each line's count and cost (a count of 0 drops the line)
//   POST   /:id/send           { to? } email a draft to the supplier (its address, or the one typed) → sent
//   POST   /:id/receive        { lines:[{ lineId, quantity }] } book what came in → partly_received | received
//   POST   /:id/cancel         a draft, or a sent order nothing has come in against (orders are never deleted: a number is used once)
//   GET/POST /suppliers   PUT/DELETE /suppliers/:id   the people the shop buys from
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { Context } from 'hono'
import { storePurchaseOrder, storePurchaseOrderLine, storeProductVariant, storeSupplier } from '../../../db/schema/store.ts'
import { linesOf, nextPurchaseOrderNumber, receiveAgainst, reorderCandidates, suggestedQuantity } from '../../../data/storeReorders.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'

const cents = z.number().int().min(0).max(100_000_000)
const qty = z.number().int().min(0).max(1_000_000)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-05')
const email = z.string().trim().email('That is not an email address').max(200)
const supplierSchema = z.object({
  name: z.string().trim().min(1, 'Give the supplier a name').max(120),
  email: z.union([email, z.literal('')]).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
}).strict()
const editSchema = z.object({
  supplierId: z.string().min(1).max(64).optional(),
  notes: z.string().max(2000).nullable().optional(),
  expectedOn: z.union([day, z.literal('')]).nullable().optional(),
  lines: z.array(z.object({ id: z.string().min(1).max(64), quantity: qty, unitCostCents: cents })).max(500).optional(),
}).strict()

const bad = (c: Context, sentence: string, error: z.ZodError) => {
  const fields: Record<string, string> = {}
  for (const i of error.issues) { const k = i.path.join('.'); if (k && !fields[k]) fields[k] = i.message }
  return fail(c, 400, sentence, 'validation_failed', fields)
}
const totalOf = (lines: Array<{ quantity: number; unitCostCents: number }>) => lines.reduce((s, l) => s + l.quantity * l.unitCostCents, 0)

export function createReorderRoutes(d: CrmDeps, core: StoreCore) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const own = (c: Context) => (c as any).get('user').companyId as string
  app.use('*', requirePermission('margin:read'))
  const write = requirePermission('products:update')

  const supplierOf = async (companyId: string, id: string) => (await db.select().from(storeSupplier).where(and(eq(storeSupplier.id, id), eq(storeSupplier.companyId, companyId))).limit(1))[0] ?? null
  const orderOf = async (companyId: string, id: string) => (await db.select().from(storePurchaseOrder).where(and(eq(storePurchaseOrder.id, id), eq(storePurchaseOrder.companyId, companyId))).limit(1))[0] ?? null
  const whole = async (companyId: string, po: any) => {
    const [lines, supplier] = await Promise.all([linesOf(db, po.id), supplierOf(companyId, po.supplierId)])
    return { ...po, supplierName: supplier?.name ?? null, supplierEmail: supplier?.email ?? null, lines, totalCents: totalOf(lines) }
  }

  // ── suppliers ──────────────────────────────────────────────────────────────
  app.get('/suppliers', async (c) => {
    const rows = await db.select().from(storeSupplier).where(eq(storeSupplier.companyId, own(c))).orderBy(asc(storeSupplier.name)).limit(500)
    return listAll(c, rows)
  })
  app.post('/suppliers', write, async (c) => {
    const parsed = supplierSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return bad(c, 'Check the supplier: it needs a name, and the email must be an address.', parsed.error)
    const clash = await db.select({ id: storeSupplier.id }).from(storeSupplier).where(and(eq(storeSupplier.companyId, own(c)), eq(storeSupplier.name, parsed.data.name))).limit(1)
    if (clash.length) return fail(c, 409, 'You already have a supplier with that name.', 'duplicate', { name: 'Already used' })
    const [row] = await db.insert(storeSupplier).values({ companyId: own(c), name: parsed.data.name, email: parsed.data.email || null, phone: parsed.data.phone || null, notes: parsed.data.notes || null }).returning()
    await d.audit.log({ action: 'create', entity: 'store_supplier', entityId: row.id, entityName: row.name, companyId: own(c), req: c })
    return one(c, row, 201)
  })
  app.put('/suppliers/:id', write, async (c) => {
    const parsed = supplierSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return bad(c, 'Check the supplier: it needs a name, and the email must be an address.', parsed.error)
    const cur = await supplierOf(own(c), c.req.param('id'))
    if (!cur) return fail(c, 404, 'Not found')
    if (parsed.data.name !== cur.name) {
      const clash = await db.select({ id: storeSupplier.id }).from(storeSupplier).where(and(eq(storeSupplier.companyId, own(c)), eq(storeSupplier.name, parsed.data.name))).limit(1)
      if (clash.length) return fail(c, 409, 'You already have a supplier with that name.', 'duplicate', { name: 'Already used' })
    }
    const [row] = await db.update(storeSupplier).set({ name: parsed.data.name, email: parsed.data.email || null, phone: parsed.data.phone || null, notes: parsed.data.notes || null, updatedAt: new Date() }).where(eq(storeSupplier.id, cur.id)).returning()
    await d.audit.log({ action: 'update', entity: 'store_supplier', entityId: row.id, entityName: row.name, companyId: own(c), req: c })
    return one(c, row)
  })
  app.delete('/suppliers/:id', write, async (c) => {
    const cur = await supplierOf(own(c), c.req.param('id'))
    if (!cur) return fail(c, 404, 'Not found')
    const used = await db.select({ id: storePurchaseOrder.id }).from(storePurchaseOrder).where(eq(storePurchaseOrder.supplierId, cur.id)).limit(1)
    if (used.length) return fail(c, 409, `${cur.name} has purchase orders, so it cannot be removed. Keep it, or cancel and delete its orders first.`, 'in_use')
    await db.update(storeProductVariant).set({ supplierId: null }).where(eq(storeProductVariant.supplierId, cur.id))
    await db.delete(storeSupplier).where(eq(storeSupplier.id, cur.id))
    await d.audit.log({ action: 'delete', entity: 'store_supplier', entityId: cur.id, entityName: cur.name, companyId: own(c), req: c })
    return c.body(null, 204)
  })

  // ── what to order ──────────────────────────────────────────────────────────
  app.get('/suggestions', async (c) => {
    const companyId = own(c)
    const [candidates, suppliers] = await Promise.all([reorderCandidates(db, companyId), db.select().from(storeSupplier).where(eq(storeSupplier.companyId, companyId)).orderBy(asc(storeSupplier.name))])
    const groups = new Map<string | null, any>()
    const group = (id: string | null, name: string | null, mail: string | null) => { if (!groups.has(id)) groups.set(id, { supplierId: id, supplierName: name, supplierEmail: mail, lines: [], totalCents: 0 }); return groups.get(id) }
    for (const s of suppliers) group(s.id, s.name, s.email)
    let covered = 0
    for (const cand of candidates) {
      const suggested = suggestedQuantity(cand)
      if (suggested <= 0) { covered++; continue }
      const g = group(cand.supplierId, cand.supplierName, suppliers.find((s: any) => s.id === cand.supplierId)?.email ?? null)
      const unitCostCents = cand.costCents ?? 0
      g.lines.push({ variantId: cand.variantId, sku: cand.sku, productName: cand.productName, variantName: cand.variantName, quantity: cand.quantity, lowStockAt: cand.lowStockAt, onOrder: cand.onOrder, suggested, unitCostCents, hasCost: cand.costCents != null })
      g.totalCents += suggested * unitCostCents
    }
    const list = [...groups.values()].filter((g) => g.lines.length)
    list.sort((a, b) => (a.supplierId === null ? 1 : 0) - (b.supplierId === null ? 1 : 0) || String(a.supplierName).localeCompare(String(b.supplierName)))
    return one(c, { groups: list, coveredByOpenOrders: covered, suppliers: suppliers.map((s: any) => ({ id: s.id, name: s.name })), currency: (await core.settings(companyId)).currency })
  })

  app.post('/draft', write, async (c) => {
    const companyId = own(c)
    const parsed = z.object({ supplierId: z.string().min(1).max(64), variantIds: z.array(z.string().min(1).max(64)).max(500).optional() }).strict().safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return bad(c, 'Choose the supplier to draft the order for.', parsed.error)
    const supplier = await supplierOf(companyId, parsed.data.supplierId)
    if (!supplier) return fail(c, 400, 'That supplier is not one of yours. Choose another.', 'validation_failed', { supplierId: 'Not found' })
    const chosen = parsed.data.variantIds ? new Set(parsed.data.variantIds) : null
    const lines = (await reorderCandidates(db, companyId))
      .filter((cand) => (chosen ? chosen.has(cand.variantId) : cand.supplierId === supplier.id))
      .map((cand) => ({ cand, suggested: suggestedQuantity(cand) })).filter((x) => x.suggested > 0)
    if (!lines.length) return fail(c, 409, chosen ? 'Nothing needs ordering among those: they are not low, or are already on an order.' : `Nothing from ${supplier.name} needs ordering now: nothing of theirs is low, or it is already on an order.`, 'nothing_to_order')
    // A number is taken, the order written; a clash with a concurrent draft takes the next number.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const number = await nextPurchaseOrderNumber(db, companyId)
        const made = await db.transaction(async (tx: any) => {
          const [po] = await tx.insert(storePurchaseOrder).values({ companyId, number, supplierId: supplier.id, createdById: (c as any).get('user').userId ?? null }).returning()
          await tx.insert(storePurchaseOrderLine).values(lines.map(({ cand, suggested }) => ({ purchaseOrderId: po.id, variantId: cand.variantId, sku: cand.sku, name: cand.variantName && cand.variantName !== 'Default' ? `${cand.productName} — ${cand.variantName}` : cand.productName, quantity: suggested, unitCostCents: cand.costCents ?? 0 })))
          return po
        })
        await d.audit.log({ action: 'create', entity: 'store_purchase_order', entityId: made.id, entityName: made.number, companyId, req: c })
        return one(c, await whole(companyId, made), 201)
      } catch (e: any) { if (!/unique|duplicate/i.test(String(e?.message)) || attempt === 4) throw e }
    }
    return fail(c, 409, 'Another order was being drafted at the same moment. Try again.', 'conflict')
  })

  // ── the orders ─────────────────────────────────────────────────────────────
  app.get('/', async (c) => {
    const companyId = own(c)
    const status = c.req.query('status')
    const rows = await db.select().from(storePurchaseOrder).where(status ? and(eq(storePurchaseOrder.companyId, companyId), eq(storePurchaseOrder.status, status)) : eq(storePurchaseOrder.companyId, companyId)).orderBy(desc(storePurchaseOrder.createdAt)).limit(200)
    return listAll(c, await Promise.all(rows.map((r: any) => whole(companyId, r))))
  })
  app.get('/:id', async (c) => {
    const po = await orderOf(own(c), c.req.param('id'))
    if (!po) return fail(c, 404, 'Not found')
    return one(c, await whole(own(c), po))
  })

  app.put('/:id', write, async (c) => {
    const companyId = own(c)
    const parsed = editSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return bad(c, 'Check the order: counts and costs are whole numbers, and the day looks like 2026-11-05.', parsed.error)
    const po = await orderOf(companyId, c.req.param('id'))
    if (!po) return fail(c, 404, 'Not found')
    if (po.status !== 'draft') return fail(c, 409, `${po.number} has been ${po.status === 'cancelled' ? 'cancelled' : 'sent'}, so it can no longer be edited.`, 'not_a_draft')
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (parsed.data.supplierId) {
      if (!(await supplierOf(companyId, parsed.data.supplierId))) return fail(c, 400, 'That supplier is not one of yours. Choose another.', 'validation_failed', { supplierId: 'Not found' })
      set.supplierId = parsed.data.supplierId
    }
    if (parsed.data.notes !== undefined) set.notes = parsed.data.notes || null
    if (parsed.data.expectedOn !== undefined) set.expectedOn = parsed.data.expectedOn || null
    await db.transaction(async (tx: any) => {
      await tx.update(storePurchaseOrder).set(set).where(eq(storePurchaseOrder.id, po.id))
      for (const l of parsed.data.lines ?? []) {
        if (l.quantity === 0) await tx.delete(storePurchaseOrderLine).where(and(eq(storePurchaseOrderLine.id, l.id), eq(storePurchaseOrderLine.purchaseOrderId, po.id)))
        else await tx.update(storePurchaseOrderLine).set({ quantity: l.quantity, unitCostCents: l.unitCostCents }).where(and(eq(storePurchaseOrderLine.id, l.id), eq(storePurchaseOrderLine.purchaseOrderId, po.id)))
      }
    })
    await d.audit.log({ action: 'update', entity: 'store_purchase_order', entityId: po.id, entityName: po.number, companyId, req: c })
    return one(c, await whole(companyId, (await orderOf(companyId, po.id))!))
  })

  app.post('/:id/send', write, async (c) => {
    const companyId = own(c)
    const parsed = z.object({ to: email.optional() }).strict().safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return bad(c, 'That is not an email address.', parsed.error)
    const po = await orderOf(companyId, c.req.param('id'))
    if (!po) return fail(c, 404, 'Not found')
    if (po.status !== 'draft') return fail(c, 409, `${po.number} has already been ${po.status === 'cancelled' ? 'cancelled' : 'sent'}.`, 'not_a_draft')
    const supplier = await supplierOf(companyId, po.supplierId)
    const to = parsed.data.to || supplier?.email
    if (!to) return fail(c, 400, `${supplier?.name ?? 'The supplier'} has no email address. Type one to send this to, or add it to the supplier.`, 'no_recipient', { to: 'Needed' })
    const lines = await linesOf(db, po.id)
    if (!lines.length) return fail(c, 400, 'This order has no lines. Cancel it, or draft it again.', 'empty_order')
    const co = await core.shop()
    const settings = await core.settings(companyId)
    const sent = await core.mail(to, 'storePurchaseOrder', { number: po.number, supplierName: supplier?.name ?? '', lines, totalCents: totalOf(lines), currency: settings.currency, notes: po.notes, expectedOn: po.expectedOn, shopEmail: co?.email ?? null }, co?.email)
    if (!sent) return fail(c, 502, 'The email could not be sent, so the order is still a draft. Try again in a moment.', 'email_failed')
    const [row] = await db.update(storePurchaseOrder).set({ status: 'sent', sentAt: new Date(), sentTo: to, updatedAt: new Date() }).where(and(eq(storePurchaseOrder.id, po.id), eq(storePurchaseOrder.status, 'draft'))).returning()
    await d.audit.log({ action: 'update', entity: 'store_purchase_order', entityId: po.id, entityName: po.number, metadata: { description: `${po.number} emailed to ${to}` }, companyId, req: c })
    return one(c, await whole(companyId, row ?? po))
  })

  app.post('/:id/receive', write, async (c) => {
    const companyId = own(c)
    const parsed = z.object({ lines: z.array(z.object({ lineId: z.string().min(1).max(64), quantity: qty })).min(1).max(500) }).strict().safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return bad(c, 'Say how many of each line came in.', parsed.error)
    const po = await orderOf(companyId, c.req.param('id'))
    if (!po) return fail(c, 404, 'Not found')
    if (!['sent', 'partly_received'].includes(po.status)) return fail(c, 409, po.status === 'draft' ? `${po.number} has not been sent yet. Send it first, or edit the counts.` : `${po.number} is ${po.status === 'received' ? 'already fully received' : 'cancelled'}.`, 'wrong_state')
    if (!parsed.data.lines.some((l) => l.quantity > 0)) return fail(c, 400, 'Enter at least one count above zero.', 'validation_failed')
    const result = await receiveAgainst(db, companyId, po.id, parsed.data.lines)
    if ('problem' in result) return fail(c, 409, result.problem, 'too_many')
    await d.audit.log({ action: 'update', entity: 'store_purchase_order', entityId: po.id, entityName: po.number, metadata: { description: `${po.number}: ${result.booked} received, stock updated (${result.status === 'received' ? 'complete' : 'part'})` }, companyId, req: c })
    return one(c, await whole(companyId, (await orderOf(companyId, po.id))!))
  })

  app.post('/:id/cancel', write, async (c) => {
    const companyId = own(c)
    const po = await orderOf(companyId, c.req.param('id'))
    if (!po) return fail(c, 404, 'Not found')
    if (!['draft', 'sent'].includes(po.status)) return fail(c, 409, po.status === 'cancelled' ? `${po.number} is already cancelled.` : `${po.number} has stock booked against it, so it cannot be cancelled.`, 'wrong_state')
    const [row] = await db.update(storePurchaseOrder).set({ status: 'cancelled', updatedAt: new Date() }).where(and(eq(storePurchaseOrder.id, po.id), inArray(storePurchaseOrder.status, ['draft', 'sent']))).returning()
    await d.audit.log({ action: 'update', entity: 'store_purchase_order', entityId: po.id, entityName: po.number, metadata: { description: `${po.number} cancelled` }, companyId, req: c })
    return one(c, await whole(companyId, row ?? po))
  })

  return app
}

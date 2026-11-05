// /api/stock — STOCK AND COSTING, behind the bar_stock feature (barStock.ts, barCosting.ts).
//
//   The count (bar:register — the bartender walks the walk-in with a phone; blind, no expected numbers):
//     GET  /count                     the count in progress and what to count
//     POST /count/item                { stockItemId, packs, units, clear }
//     POST /count/finish
//   Everything else is a manager's (bar:update — the same as the menu and the taps; it shows costs):
//     GET  /items · POST /items · PATCH /items/:id          stock items with on hand, par, low
//     GET  /vendors · POST /vendors · PATCH /vendors/:id
//     GET  /recipes · PUT /recipes/:menuItemId { sizeId, lines } · PATCH /taps/:id { stockItemId, pourOz }
//     GET  /engineering?days=30       stars, plowhorses, puzzles, dogs
//     GET  /counts · GET /counts/:id/report                 variance, food cost %, pour cost %
//     GET  /orders · POST /orders · PUT /orders/:id · POST /orders/draft-low
//     POST /orders/:id/send { email } · POST /orders/:id/cancel · POST /orders/:id/receive { lines }
//   Invoice scanning (restaurant-bar parity #7; also behind bar_invoice_scan, not ready; bar:update):
//     POST /invoices (multipart file, vendorId?)  ·  GET /invoices  ·  GET /invoices/:id  ·  GET /invoices/:id/file
//     PATCH /invoices/:id { vendorId, invoiceNumber, invoiceDate, lines }   the person's corrections
//     POST /invoices/:id/confirm { allowDuplicate }   the one thing that changes counts and costs  ·  POST /invoices/:id/discard
//
// Moved from templates/crm-bar/backend/src/routes/barStock.ts; paths, permissions and answers as they were. The order
// email goes through the app's email (the template's sendRaw).
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { checkFilter } from '@twomiah/tenant-backend'
import { company } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, listAll, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { CATEGORIES, PACK_PRESETS, UNITS } from './barCosting.ts'
import { StockError, orderEmailHtml } from './barStock.ts'
import { MAX_INVOICE_BYTES } from './barInvoices.ts'
import type { BarServices } from './services.ts'
import { ORDER_TILES } from './tileConditions.ts'

type Ctx = any
const body = async (c: Ctx) => (await c.req.json().catch(() => ({}))) as Record<string, any>
const companyOf = (c: Ctx) => (c.get('user') as { companyId: string }).companyId

export function createBarStockRoutes(d: CrmDeps, bar: BarServices) {
  const { db, audit, logger } = d
  const { requirePermission } = d.permissions
  const on = d.features.requireEnabledFeature('bar_stock')
  const manage = [on, requirePermission('bar:update')] as const
  const counter = [on, requirePermission('bar:register')] as const
  const scanning = [on, d.features.requireEnabledFeature('bar_invoice_scan'), requirePermission('bar:update')] as const
  const { actorOf } = bar.managers
  const { invoices } = bar
  const {
    countHistory, countItem, countReport, currentCount, draftFromLow, finishCount, menuEngineering, orderList,
    receiveOrder, recipeBook, saveOrder, saveStockItem, saveVendor, setOrderStatus, setRecipe, setTapPour, stockList, vendorList,
  } = bar.stock
  const app = new Hono<AppEnv>()

  async function run(c: Ctx, fn: () => Promise<unknown>) {
    try {
      c.header('Cache-Control', 'no-store')
      return one(c, await fn() as object)
    } catch (e: any) {
      if (e instanceof StockError) return fail(c, e.status as any, e.message)
      logger.error('[stock]', { error: e?.message || String(e) })
      return fail(c, 500, 'That did not save. Try again.')
    }
  }

  // ── The count ──
  app.get('/count', ...counter, async (c) => {
    const actor = await actorOf(c)
    return run(c, async () => {
      const [stock, count] = await Promise.all([stockList(actor.companyId), currentCount(actor.companyId, actor.name, false)])
      // Blind: what to count and in what packs, never what the system expects to find.
      // The bottle weights ride along for the scale (parity row 15); they say nothing about what is expected.
      return { categories: CATEGORIES, count, stock: stock.map(r => ({ id: r.id, name: r.name, category: r.category, unitLabel: r.unitLabel, packName: r.packName, packSize: r.packSize, bottleTareGrams: r.bottleTareGrams, bottleFullGrams: r.bottleFullGrams })) }
    })
  })
  app.post('/count/item', ...counter, async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    if (!b.stockItemId) return fail(c, 400, 'Which item?')
    // Counting open bottles by how full they are is the venue's choice (stock_fill_levels, not ready): off, only packs and units.
    if ((b.fills !== undefined || b.weightsGrams !== undefined) && !(await d.features.isFeatureEnabled(actor.companyId, 'stock_fill_levels'))) return fail(c, 400, 'Counting open bottles by how full they are is not switched on for this business.')
    return run(c, async () => {
      const count = await currentCount(actor.companyId, actor.name)
      const qty = await countItem(actor.companyId, count!.id, String(b.stockItemId), { packs: b.packs, units: b.units, clear: !!b.clear, fills: b.fills, weightsGrams: b.weightsGrams }, actor.name)
      return { ok: true, qty, countId: count!.id }
    })
  })
  app.post('/count/finish', ...counter, async (c) => {
    const actor = await actorOf(c)
    return run(c, async () => {
      const count = await currentCount(actor.companyId, actor.name, false)
      if (!count) throw new StockError('Nothing counted yet.')
      const finished = await finishCount(actor.companyId, count.id, actor.name)
      audit.log({ req: c, action: 'update', entity: 'bar_stock_count', entityId: finished.id, entityName: 'Stock count', changes: { status: 'done' } })
      return { ok: true, count: finished }
    })
  })

  // ── Stock items and vendors ──
  app.get('/items', ...manage, async (c) => {
    const companyId = companyOf(c)
    return run(c, async () => ({ stock: await stockList(companyId, { includeInactive: c.req.query('all') === '1' }), vendors: await vendorList(companyId), categories: CATEGORIES, units: UNITS, presets: PACK_PRESETS }))
  })
  app.post('/items', ...manage, async (c) => { const companyId = companyOf(c); const b = await body(c); return run(c, async () => ({ item: await saveStockItem(companyId, null, b) })) })
  app.patch('/items/:id', ...manage, async (c) => { const companyId = companyOf(c); const b = await body(c); return run(c, async () => ({ item: await saveStockItem(companyId, c.req.param('id'), b) })) })
  app.get('/vendors', ...manage, async (c) => { const companyId = companyOf(c); return run(c, async () => ({ vendors: await vendorList(companyId) })) })
  app.post('/vendors', ...manage, async (c) => { const companyId = companyOf(c); const b = await body(c); return run(c, async () => ({ vendor: await saveVendor(companyId, null, b) })) })
  app.patch('/vendors/:id', ...manage, async (c) => { const companyId = companyOf(c); const b = await body(c); return run(c, async () => ({ vendor: await saveVendor(companyId, c.req.param('id'), b) })) })

  // ── Recipes, pours, menu engineering ──
  app.get('/recipes', ...manage, async (c) => {
    const companyId = companyOf(c)
    return run(c, async () => ({ ...(await recipeBook(companyId)), stock: (await stockList(companyId)).map(s => ({ id: s.id, name: s.name, unit: s.unit, unitLabel: s.unitLabel, category: s.category, unitCostCents: s.unitCostCents })) }))
  })
  app.put('/recipes/:menuItemId', ...manage, async (c) => {
    const companyId = companyOf(c); const b = await body(c)
    return run(c, async () => { await setRecipe(companyId, c.req.param('menuItemId'), b.sizeId ? String(b.sizeId) : null, Array.isArray(b.lines) ? b.lines : []); return { ok: true } })
  })
  app.patch('/taps/:id', ...manage, async (c) => { const companyId = companyOf(c); const b = await body(c); return run(c, async () => ({ tap: await setTapPour(companyId, c.req.param('id'), b) })) })
  app.get('/engineering', ...manage, async (c) => {
    const companyId = companyOf(c)
    return run(c, () => menuEngineering(companyId, Math.min(365, Math.max(7, Number(c.req.query('days')) || 30))))
  })

  // ── Counts and their reports ──
  app.get('/counts', ...manage, async (c) => {
    const actor = await actorOf(c)
    return run(c, async () => ({ counts: await countHistory(actor.companyId), current: await currentCount(actor.companyId, actor.name, false) }))
  })
  app.get('/counts/:id/report', ...manage, async (c) => { const companyId = companyOf(c); return run(c, () => countReport(companyId, c.req.param('id'))) })

  // ── Purchase orders ──
  // ?tile=on_the_way is the home screen's "Orders on the way" (tileConditions.ts — the dashboard's count calls the same).
  app.get('/orders', ...manage, async (c) => {
    const bad = checkFilter(c, 'tile', c.req.query('tile'), ORDER_TILES); if (bad) return bad
    const companyId = companyOf(c); const onTheWay = c.req.query('tile') === 'on_the_way'
    return run(c, async () => ({ orders: await orderList(companyId, onTheWay) }))
  })
  app.post('/orders', ...manage, async (c) => { const actor = await actorOf(c); const b = await body(c); return run(c, async () => ({ id: await saveOrder(actor.companyId, null, b as any, actor.name) })) })
  app.put('/orders/:id', ...manage, async (c) => { const actor = await actorOf(c); const b = await body(c); return run(c, async () => ({ id: await saveOrder(actor.companyId, c.req.param('id'), b as any, actor.name) })) })
  app.post('/orders/draft-low', ...manage, async (c) => { const actor = await actorOf(c); return run(c, async () => ({ ids: await draftFromLow(actor.companyId, actor.name) })) })
  app.post('/orders/:id/cancel', ...manage, async (c) => { const companyId = companyOf(c); return run(c, async () => ({ order: await setOrderStatus(companyId, c.req.param('id'), 'cancelled') })) })
  app.post('/orders/:id/send', ...manage, async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    return run(c, async () => {
      const o = (await orderList(actor.companyId)).find((x: { id: string }) => x.id === c.req.param('id'))
      if (!o) throw new StockError('That order is gone.', 404)
      let emailed = false
      if (b.email) {
        if (!o.vendor?.email) throw new StockError('That vendor has no email on file.')
        const [co] = await db.select({ name: company.name, address: company.address, city: company.city, state: company.state }).from(company).where(eq(company.id, actor.companyId)).limit(1)
        const name = co?.name || 'The bar'
        const sent = await d.services.emailService.sendRaw({ to: o.vendor.email, subject: `Order #${o.number} from ${name}`, html: orderEmailHtml(o, name, [co?.address, co?.city, co?.state].filter(Boolean).join(', ')) }).catch(() => null)
        if (!sent?.success) throw new StockError('The email did not go. The order is still a draft.', 502)
        emailed = true
      }
      const order = await setOrderStatus(actor.companyId, o.id, 'sent')
      audit.log({ req: c, action: 'update', entity: 'bar_purchase_order', entityId: o.id, entityName: `Order #${o.number}`, changes: { status: 'sent', emailed } })
      return { order, emailed }
    })
  })
  app.post('/orders/:id/receive', ...manage, async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    return run(c, async () => {
      const order = await receiveOrder(actor.companyId, c.req.param('id'), Array.isArray(b.lines) ? b.lines : [], actor.name)
      audit.log({ req: c, action: 'update', entity: 'bar_purchase_order', entityId: order.id, entityName: `Order #${order.number}`, changes: { status: 'received' } })
      return { order }
    })
  })

  // ── Invoices read from a photo or PDF: read, matched, checked by a person, and only then received ──
  app.post('/invoices', ...scanning, async (c) => {
    const actor = await actorOf(c)
    const form = await c.req.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) return fail(c, 400, 'Choose a photo or a PDF of the invoice.')
    if (file.size > MAX_INVOICE_BYTES) return fail(c, 413, 'That file is over 10 MB. Take the photo again at a lower quality, or send the PDF a page at a time.')
    const vendorId = form?.get('vendorId')
    return run(c, async () => {
      const scan = await invoices.scan(actor, { bytes: Buffer.from(await file.arrayBuffer()), name: file.name }, typeof vendorId === 'string' ? vendorId : null)
      audit.log({ req: c, action: 'create', entity: 'bar_invoice_scan', entityId: scan.id, entityName: `Invoice ${scan.invoiceNumber || scan.supplierName || ''}`.trim(), changes: { lines: scan.lines.length } })
      return scan
    })
  })
  app.get('/invoices', ...scanning, async (c) => {
    const companyId = companyOf(c)
    try { c.header('Cache-Control', 'no-store'); return listAll(c, await invoices.list(companyId)) }
    catch (e: any) { logger.error('[stock]', { error: e?.message || String(e) }); return fail(c, 500, 'That did not load. Try again.') }
  })
  app.get('/invoices/:id', ...scanning, async (c) => { const companyId = companyOf(c); return run(c, () => invoices.get(companyId, c.req.param('id'))) })
  app.get('/invoices/:id/file', ...scanning, async (c) => {
    const companyId = companyOf(c)
    try {
      const f = await invoices.fileOf(companyId, c.req.param('id'))
      return c.body(f.body as any, 200, { 'Content-Type': f.contentType, 'Cache-Control': 'private, no-store', 'Content-Disposition': `inline; filename="${f.name.replace(/[^\w.\- ]/g, '_')}"` })
    } catch (e: any) {
      if (e instanceof StockError) return fail(c, e.status as any, e.message)
      logger.error('[stock]', { error: e?.message || String(e) }); return fail(c, 500, 'That did not load. Try again.')
    }
  })
  app.patch('/invoices/:id', ...scanning, async (c) => { const actor = await actorOf(c); const b = await body(c); return run(c, () => invoices.update(actor, c.req.param('id'), b)) })
  app.post('/invoices/:id/confirm', ...scanning, async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    return run(c, async () => {
      const received = await invoices.confirm(actor, c.req.param('id'), { allowDuplicate: b.allowDuplicate === true })
      audit.log({ req: c, action: 'update', entity: 'bar_invoice_scan', entityId: received.scanId, entityName: `Order #${received.orderNumber}`, changes: { status: 'confirmed', lines: received.lines, totalCents: received.totalCents, priceChanges: received.costChanges.length } })
      return received
    })
  })
  app.post('/invoices/:id/discard', ...scanning, async (c) => {
    const actor = await actorOf(c)
    return run(c, async () => {
      await invoices.discard(actor, c.req.param('id'))
      audit.log({ req: c, action: 'update', entity: 'bar_invoice_scan', entityId: c.req.param('id'), entityName: 'Invoice', changes: { status: 'discarded' } })
      return { success: true }
    })
  })

  return app
}

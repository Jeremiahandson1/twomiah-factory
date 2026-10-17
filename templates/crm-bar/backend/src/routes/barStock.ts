// STOCK AND COSTING — /api/stock behind the bar_stock feature (services/barStock.ts, barCosting.ts).
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
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { requireEnabledFeature } from '../middleware/enabledFeature.ts'
import audit from '../services/audit.ts'
import { sendRaw } from '../services/email.ts'
import { actorOf } from '../services/barManagers.ts'
import { CATEGORIES, PACK_PRESETS, UNITS } from '../services/barCosting.ts'
import {
  StockError, countHistory, countItem, countReport, currentCount, draftFromLow, finishCount, menuEngineering, orderEmailHtml, orderList,
  receiveOrder, recipeBook, saveOrder, saveStockItem, saveVendor, setOrderStatus, setRecipe, setTapPour, stockList, vendorList,
} from '../services/barStock.ts'

type Ctx = any
const app = new Hono()
app.use('*', authenticate)
const on = requireEnabledFeature('bar_stock')
const manage = [on, requirePermission('bar:update')] as const
const counter = [on, requirePermission('bar:register')] as const
const body = async (c: Ctx) => (await c.req.json().catch(() => ({}))) as Record<string, any>

async function run(c: Ctx, fn: () => Promise<unknown>) {
  try {
    c.header('Cache-Control', 'no-store')
    return c.json(await fn())
  } catch (e: any) {
    if (e instanceof StockError) return c.json({ error: e.message }, e.status)
    console.error('[stock]', e?.message || e)
    return c.json({ error: 'That did not save. Try again.' }, 500)
  }
}

// ── The count ──
app.get('/count', ...counter, async (c) => {
  const actor = await actorOf(c)
  return run(c, async () => {
    const [stock, count] = await Promise.all([stockList(actor.companyId), currentCount(actor.companyId, actor.name, false)])
    // Blind: what to count and in what packs, never what the system expects to find.
    return { categories: CATEGORIES, count, stock: stock.map(r => ({ id: r.id, name: r.name, category: r.category, unitLabel: r.unitLabel, packName: r.packName, packSize: r.packSize })) }
  })
})
app.post('/count/item', ...counter, async (c) => {
  const actor = await actorOf(c); const b = await body(c)
  if (!b.stockItemId) return c.json({ error: 'Which item?' }, 400)
  return run(c, async () => {
    const count = await currentCount(actor.companyId, actor.name)
    const qty = await countItem(actor.companyId, count!.id, String(b.stockItemId), { packs: b.packs, units: b.units, clear: !!b.clear }, actor.name)
    return { ok: true, qty, countId: count!.id }
  })
})
app.post('/count/finish', ...counter, async (c) => {
  const actor = await actorOf(c)
  return run(c, async () => {
    const count = await currentCount(actor.companyId, actor.name, false)
    if (!count) throw new StockError('Nothing counted yet.')
    const done = await finishCount(actor.companyId, count.id, actor.name)
    audit.log({ req: c, action: 'update', entity: 'bar_stock_count', entityId: done.id, entityName: 'Stock count', changes: { status: 'done' } })
    return { ok: true, count: done }
  })
})

// ── Stock items and vendors ──
app.get('/items', ...manage, async (c) => {
  const { companyId } = c.get('user') as any
  return run(c, async () => ({ stock: await stockList(companyId, { includeInactive: c.req.query('all') === '1' }), vendors: await vendorList(companyId), categories: CATEGORIES, units: UNITS, presets: PACK_PRESETS }))
})
app.post('/items', ...manage, async (c) => { const { companyId } = c.get('user') as any; const b = await body(c); return run(c, async () => ({ item: await saveStockItem(companyId, null, b) })) })
app.patch('/items/:id', ...manage, async (c) => { const { companyId } = c.get('user') as any; const b = await body(c); return run(c, async () => ({ item: await saveStockItem(companyId, c.req.param('id'), b) })) })
app.get('/vendors', ...manage, async (c) => { const { companyId } = c.get('user') as any; return run(c, async () => ({ vendors: await vendorList(companyId) })) })
app.post('/vendors', ...manage, async (c) => { const { companyId } = c.get('user') as any; const b = await body(c); return run(c, async () => ({ vendor: await saveVendor(companyId, null, b) })) })
app.patch('/vendors/:id', ...manage, async (c) => { const { companyId } = c.get('user') as any; const b = await body(c); return run(c, async () => ({ vendor: await saveVendor(companyId, c.req.param('id'), b) })) })

// ── Recipes, pours, menu engineering ──
app.get('/recipes', ...manage, async (c) => {
  const { companyId } = c.get('user') as any
  return run(c, async () => ({ ...(await recipeBook(companyId)), stock: (await stockList(companyId)).map(s => ({ id: s.id, name: s.name, unit: s.unit, unitLabel: s.unitLabel, category: s.category, unitCostCents: s.unitCostCents })) }))
})
app.put('/recipes/:menuItemId', ...manage, async (c) => {
  const { companyId } = c.get('user') as any; const b = await body(c)
  return run(c, async () => { await setRecipe(companyId, c.req.param('menuItemId'), b.sizeId ? String(b.sizeId) : null, Array.isArray(b.lines) ? b.lines : []); return { ok: true } })
})
app.patch('/taps/:id', ...manage, async (c) => { const { companyId } = c.get('user') as any; const b = await body(c); return run(c, async () => ({ tap: await setTapPour(companyId, c.req.param('id'), b) })) })
app.get('/engineering', ...manage, async (c) => {
  const { companyId } = c.get('user') as any
  return run(c, () => menuEngineering(companyId, Math.min(365, Math.max(7, Number(c.req.query('days')) || 30))))
})

// ── Counts and their reports ──
app.get('/counts', ...manage, async (c) => {
  const actor = await actorOf(c)
  return run(c, async () => ({ counts: await countHistory(actor.companyId), current: await currentCount(actor.companyId, actor.name, false) }))
})
app.get('/counts/:id/report', ...manage, async (c) => { const { companyId } = c.get('user') as any; return run(c, () => countReport(companyId, c.req.param('id'))) })

// ── Purchase orders ──
app.get('/orders', ...manage, async (c) => { const { companyId } = c.get('user') as any; return run(c, async () => ({ orders: await orderList(companyId) })) })
app.post('/orders', ...manage, async (c) => { const actor = await actorOf(c); const b = await body(c); return run(c, async () => ({ id: await saveOrder(actor.companyId, null, b as any, actor.name) })) })
app.put('/orders/:id', ...manage, async (c) => { const actor = await actorOf(c); const b = await body(c); return run(c, async () => ({ id: await saveOrder(actor.companyId, c.req.param('id'), b as any, actor.name) })) })
app.post('/orders/draft-low', ...manage, async (c) => { const actor = await actorOf(c); return run(c, async () => ({ ids: await draftFromLow(actor.companyId, actor.name) })) })
app.post('/orders/:id/cancel', ...manage, async (c) => { const { companyId } = c.get('user') as any; return run(c, async () => ({ order: await setOrderStatus(companyId, c.req.param('id'), 'cancelled') })) })
app.post('/orders/:id/send', ...manage, async (c) => {
  const actor = await actorOf(c); const b = await body(c)
  return run(c, async () => {
    const o = (await orderList(actor.companyId)).find(x => x.id === c.req.param('id'))
    if (!o) throw new StockError('That order is gone.', 404)
    let emailed = false
    if (b.email) {
      if (!o.vendor?.email) throw new StockError('That vendor has no email on file.')
      const [co] = await db.select({ name: company.name, address: company.address, city: company.city, state: company.state }).from(company).where(eq(company.id, actor.companyId)).limit(1)
      const name = co?.name || 'The bar'
      const sent = await sendRaw({ to: o.vendor.email, subject: `Order #${o.number} from ${name}`, html: orderEmailHtml(o, name, [co?.address, co?.city, co?.state].filter(Boolean).join(', ')) }).catch(() => null)
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

export default app

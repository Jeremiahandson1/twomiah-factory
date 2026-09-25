/**
 * routes/admin-inventory.ts — inventory for the owner, under /api/admin/inventory
 * (same login as the rest of the admin; admin role).
 *
 *   GET   /stock                      stock items with estimated on hand, par, low
 *   POST  /stock · PATCH /stock/:id   add / edit a stock item
 *   GET   /vendors · POST · PATCH /vendors/:id
 *   GET   /recipes                    every menu item size: recipe, plate cost, cost %; the taps' pour cost
 *   PUT   /recipes/:menuItemId        { sizeId|null, lines: [{ stockItemId, qty }] }
 *   PATCH /taps/:id                   { stockItemId, pourOz }
 *   GET   /engineering?days=30        stars / plowhorses / puzzles / dogs
 *   GET   /counts                     history + the count in progress
 *   GET   /counts/:id/report          variance, food cost %, pour cost %
 *   GET   /orders · POST /orders · PUT /orders/:id
 *   POST  /orders/draft-low           a draft per vendor for everything below par
 *   POST  /orders/:id/send            { email: true } emails the vendor (if set up); marks sent
 *   POST  /orders/:id/cancel · POST /orders/:id/receive { lines: [{ lineId, packs, packCostCents }] }
 */
import { Hono } from 'hono'
import { db } from '../db'
import { settings as settingsTbl, vendors } from '../db/schema'
import { sendEmail } from '../lib/email'
import { CATEGORIES, PACK_PRESETS, UNITS } from '../lib/inventory/costing'
import {
  StockError, countHistory, countReport, currentCount, draftFromLow, menuEngineering, orderEmailHtml, orderList, receiveOrder, recipeBook,
  saveOrder, saveStockItem, saveVendor, setOrderStatus, setRecipe, setTapPour, stockList,
} from '../lib/inventory/stock'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function inventoryAdminRoutes(auth: any, requireAdmin: any, audit: (c: any, e: { action: string; target?: string; meta?: any }) => Promise<void>) {
  const app = new Hono<any>()
  const who = (c: any) => String(c.get('userEmail') || 'admin')
  const body = async (c: any) => (await c.req.json().catch(() => ({}))) as Record<string, any>
  const run = async (c: any, fn: () => Promise<unknown>) => {
    try { c.header('Cache-Control', 'no-store'); return c.json(await fn()) } catch (e) {
      if (e instanceof StockError) return c.json({ error: e.message }, e.status as any)
      throw e
    }
  }
  const idOk = (c: any, name = 'id') => UUID.test(c.req.param(name) || '')
  const guard = [auth, requireAdmin] as const

  app.get('/stock', ...guard, (c) => run(c, async () => ({
    stock: await stockList(db, { includeInactive: c.req.query('all') === '1' }),
    vendors: await db.select().from(vendors).orderBy(vendors.name),
    categories: CATEGORIES, units: UNITS, presets: PACK_PRESETS,
  })))
  app.post('/stock', ...guard, async (c) => { const b = await body(c); return run(c, async () => ({ item: await saveStockItem(db, null, b) })) })
  app.patch('/stock/:id', ...guard, async (c) => { if (!idOk(c)) return c.json({ error: 'Which item?' }, 400); const b = await body(c); return run(c, async () => ({ item: await saveStockItem(db, c.req.param('id'), b) })) })

  app.get('/vendors', ...guard, (c) => run(c, async () => ({ vendors: await db.select().from(vendors).orderBy(vendors.name) })))
  app.post('/vendors', ...guard, async (c) => { const b = await body(c); return run(c, async () => ({ vendor: await saveVendor(db, null, b) })) })
  app.patch('/vendors/:id', ...guard, async (c) => { if (!idOk(c)) return c.json({ error: 'Which vendor?' }, 400); const b = await body(c); return run(c, async () => ({ vendor: await saveVendor(db, c.req.param('id'), b) })) })

  app.get('/recipes', ...guard, (c) => run(c, async () => ({ ...(await recipeBook(db)), stock: (await stockList(db)).map(s => ({ id: s.id, name: s.name, unit: s.unit, unitLabel: s.unitLabel, category: s.category, unitCostCents: s.unitCostCents })) })))
  app.put('/recipes/:menuItemId', ...guard, async (c) => {
    if (!idOk(c, 'menuItemId')) return c.json({ error: 'Which item?' }, 400)
    const b = await body(c)
    return run(c, async () => { await setRecipe(db, c.req.param('menuItemId'), b.sizeId ? String(b.sizeId) : null, Array.isArray(b.lines) ? b.lines : []); return { ok: true } })
  })
  app.patch('/taps/:id', ...guard, async (c) => { if (!idOk(c)) return c.json({ error: 'Which tap?' }, 400); const b = await body(c); return run(c, async () => ({ tap: await setTapPour(db, c.req.param('id'), b) })) })
  app.get('/engineering', ...guard, (c) => run(c, async () => menuEngineering(db, Math.min(365, Math.max(7, Number(c.req.query('days')) || 30)))))

  app.get('/counts', ...guard, (c) => run(c, async () => ({ counts: await countHistory(db), current: await currentCount(db, who(c), false) })))
  app.get('/counts/:id/report', ...guard, (c) => { if (!idOk(c)) return c.json({ error: 'Which count?' }, 400); return run(c, () => countReport(db, c.req.param('id'))) })

  app.get('/orders', ...guard, (c) => run(c, async () => ({ orders: await orderList(db) })))
  app.post('/orders', ...guard, async (c) => { const b = await body(c); return run(c, async () => ({ id: await saveOrder(db, null, b as any, who(c)) })) })
  app.put('/orders/:id', ...guard, async (c) => { if (!idOk(c)) return c.json({ error: 'Which order?' }, 400); const b = await body(c); return run(c, async () => ({ id: await saveOrder(db, c.req.param('id'), b as any, who(c)) })) })
  app.post('/orders/draft-low', ...guard, (c) => run(c, async () => ({ ids: await draftFromLow(db, who(c)) })))
  app.post('/orders/:id/cancel', ...guard, (c) => { if (!idOk(c)) return c.json({ error: 'Which order?' }, 400); return run(c, async () => ({ order: await setOrderStatus(db, c.req.param('id'), 'cancelled') })) })
  app.post('/orders/:id/send', ...guard, async (c) => {
    if (!idOk(c)) return c.json({ error: 'Which order?' }, 400)
    const b = await body(c)
    return run(c, async () => {
      const o = (await orderList(db)).find(x => x.id === c.req.param('id'))
      if (!o) throw new StockError('That order is gone.', 404)
      let emailed = false
      if (b.email) {
        if (!o.vendor?.email) throw new StockError('That vendor has no email on file.')
        if (!process.env.RESEND_API_KEY) throw new StockError('Email is not set up on this site yet (RESEND_API_KEY).', 503)
        const [s] = await db.select().from(settingsTbl).limit(1)
        const company = s?.companyName || 'The bar'
        emailed = await sendEmail({ to: o.vendor.email, subject: `Order #${o.number} from ${company}`, html: orderEmailHtml(o, company, [s?.streetAddress, s?.addressLocality, s?.addressRegion].filter(Boolean).join(', ')) })
        if (!emailed) throw new StockError('The email service refused it. The order is still a draft.', 502)
      }
      const order = await setOrderStatus(db, o.id, 'sent')
      await audit(c, { action: 'inventory.order.sent', target: `#${o.number}`, meta: { emailed } })
      return { order, emailed }
    })
  })
  app.post('/orders/:id/receive', ...guard, async (c) => {
    if (!idOk(c)) return c.json({ error: 'Which order?' }, 400)
    const b = await body(c)
    return run(c, async () => ({ order: await receiveOrder(db, c.req.param('id'), Array.isArray(b.lines) ? b.lines : [], who(c)) }))
  })

  return app
}

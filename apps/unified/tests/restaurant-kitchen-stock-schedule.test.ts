// A restaurant can switch on the bar's Stock & Costing and Schedule (restaurant-bar-depth #8), in the kitchen's words, and they
// WORK on a restaurant tenant: the count, the variance against what its own register sold, a purchase order received, the
// week built and published with its labor cost, and a clock-in by PIN. Each on the real server (bootFood, vertical restaurant).
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'
import { getFeaturesForTemplate, getDefaultFeaturesForTemplate } from '@twomiah/tenant-backend'

let k: Awaited<ReturnType<typeof bootFood>>
let items: Awaited<ReturnType<typeof k.menu>>
const BASE = ['contacts', 'invoices', 'dashboard', 'event_bookings', 'bar_menu', 'bar_register', 'bar_tonight']
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => {
  k = await bootFood({ vertical: 'restaurant', features: BASE })
  items = await k.menu()
}, 60_000)
afterAll(() => k.restore())

describe('offered to a restaurant, opt-in, in the kitchen\'s words', () => {
  test('the features list names them for a restaurant and does not switch them on by default', async () => {
    const mine = Object.fromEntries(getFeaturesForTemplate('crm-restaurant').map((f: any) => [f.id, f]))
    expect(mine.bar_stock.name).toBe('Kitchen Stock & Costing'); expect(mine.bar_schedule.name).toBe('Staff Schedule')
    expect(getDefaultFeaturesForTemplate('crm-restaurant')).not.toContain('bar_stock')
    expect(getDefaultFeaturesForTemplate('crm-restaurant')).not.toContain('bar_schedule')
    // The bar is unchanged: its starting set still has both.
    expect(getDefaultFeaturesForTemplate('crm-bar')).toContain('bar_stock')
    const cat = await k.O('GET', '/api/company/features/catalog')
    const byId = Object.fromEntries(cat.json.features.map((f: any) => [f.id, f]))
    expect(byId.bar_stock?.name).toBe('Kitchen Stock & Costing'); expect(byId.bar_schedule?.name).toBe('Staff Schedule')
    expect([byId.bar_stock.core, byId.bar_schedule.core]).toEqual([false, false])
  })

  test('off, the routes are closed; on, a manager reaches them and the floor seat is held to its rights', async () => {
    expect((await k.M('GET', '/api/stock/items')).status).toBe(403)
    expect((await k.M('GET', '/api/schedule/week')).status).toBe(403)
    await k.features([...BASE, 'bar_stock', 'bar_schedule', 'time_tracking'])
    expect((await k.M('GET', '/api/stock/items')).status).toBe(200)
    expect((await k.M('GET', '/api/schedule/week')).status).toBe(200)
    expect((await k.B('GET', '/api/stock/items')).status).toBe(403)
    expect((await k.B('GET', '/api/schedule/week')).status).toBe(403)
  })
})

describe('stock: a count, what the register sold, the receiving, and the difference', () => {
  let patty = '', vendor = ''
  test('stock item, recipe, first count', async () => {
    const v = await k.M('POST', '/api/stock/vendors', { name: 'Badger Foodservice', email: 'orders@badger.test' })
    expect(v.status).toBe(200); vendor = v.json.vendor.id
    const it = await k.M('POST', '/api/stock/items', { name: 'Burger patties', category: 'food', unit: 'each', packName: 'case', packSize: 40, packCostCents: 12000, parPacks: 3, vendorId: vendor })
    expect(it.status).toBe(200); patty = it.json.item.id
    expect((await k.M('PUT', `/api/stock/recipes/${items.burger.id}`, { lines: [{ stockItemId: patty, qty: 1 }] })).status).toBe(200)
    // The floor seat counts blind: it is shown what to count, never what the system expects.
    const sheet = await k.B('GET', '/api/stock/count')
    expect(sheet.status).toBe(200); expect(JSON.stringify(sheet.json)).not.toMatch(/expected|onHand|variance/)
    expect((await k.B('POST', '/api/stock/count/item', { stockItemId: patty, packs: 2 })).json.qty).toBe(80)
    expect((await k.B('POST', '/api/stock/count/finish')).status).toBe(200)
  })

  test('the register sells five burgers, a case arrives, the second count is short two: the report names the difference in dollars', async () => {
    await wait(30)
    for (let n = 0; n < 5; n++) {
      const chk = await k.B('POST', '/api/register/check', { kind: 'walkup', label: `Walk-up ${n}` })
      expect(chk.status).toBe(200)
      const add = await k.B('POST', `/api/register/check/${chk.json.check.id}/items`, { menuItemId: items.burger.id })
      expect(add.status).toBe(200)
      const total = add.json.check.totalCents ?? add.json.check.subtotalCents ?? 1200
      expect((await k.B('POST', `/api/register/check/${chk.json.check.id}/pay`, { tender: 'cash', amountCents: total })).status).toBe(200)
    }
    // A purchase order to the supplier, sent by email and received a day later.
    const po = await k.M('POST', '/api/stock/orders', { vendorId: vendor, lines: [{ stockItemId: patty, packs: 1 }] })
    expect(po.status).toBe(200)
    expect((await k.M('POST', `/api/stock/orders/${po.json.id}/send`, { email: true })).json.emailed).toBe(true)
    expect(k.mails.some((m) => m.to === 'orders@badger.test')).toBe(true)
    const list = (await k.M('GET', '/api/stock/orders')).json.orders
    const received = await k.M('POST', `/api/stock/orders/${po.json.id}/receive`, { lines: list[0].lines.map((l: any) => ({ lineId: l.id, packs: 1, packCostCents: 12400 })) })
    expect(received.status).toBe(200)
    expect((await k.M('GET', '/api/stock/items')).json.stock.find((s: any) => s.id === patty).packCostCents).toBe(12400)
    // 80 counted + 40 received - 5 sold = 115 expected; 113 on the shelf.
    await wait(30)
    expect((await k.B('POST', '/api/stock/count/item', { stockItemId: patty, packs: 2, units: 33 })).json.qty).toBe(113)
    const fin = await k.B('POST', '/api/stock/count/finish')
    expect(fin.status).toBe(200)
    const report = await k.M('GET', `/api/stock/counts/${fin.json.count.id}/report`)
    expect(report.status).toBe(200)
    const row = report.json.rows.find((r: any) => r.stockItemId === patty)
    expect(row).toMatchObject({ start: 80, received: 40, end: 113, actual: 7, expected: 5, varianceUnits: 2 })
    expect(row.varianceCents).toBe(2 * 310)   // $124.00 a case of 40 = 310 cents a patty
    expect((await k.B('GET', `/api/stock/counts/${fin.json.count.id}/report`)).status).toBe(403)
  })

  test('what is below par drafts into an order for the supplier', async () => {
    const drafted = await k.M('POST', '/api/stock/orders/draft-low')
    expect(drafted.status).toBe(200); expect(drafted.json.ids.length).toBe(1)
  })
})

describe('schedule: build the week, see the cost, publish, clock in', () => {
  test('a shift for the bartender seat, the labor cost shown before publishing, then published to the staff', async () => {
    const day = new Date().toISOString().slice(0, 10)
    const add = await k.M('POST', '/api/schedule/shifts', { userId: k.ids.bartender, day, start: '10:00', end: '18:00', position: 'Line' })
    expect(add.status).toBe(200)
    expect((await k.B('POST', '/api/schedule/shifts', { userId: k.ids.bartender, day, start: '10:00', end: '12:00' })).status).toBe(403)
    const week = await k.M('GET', `/api/schedule/week?day=${day}`)
    expect(week.status).toBe(200)
    expect(week.json.shifts.length).toBe(1)
    expect(JSON.stringify(week.json)).toMatch(/labor/i)
    expect((await k.B('GET', '/api/schedule/published')).json.weeks[0].published).toBe(false)
    const pub = await k.M('POST', '/api/schedule/publish', { day })
    expect(pub.status).toBe(200); expect(pub.json.shifts).toBe(1)
    const mine = (await k.B('GET', '/api/schedule/published')).json.weeks[0]
    expect(mine.published).toBe(true); expect(mine.shifts[0].name).toBeTruthy()
  })

  test('time off is asked for and decided', async () => {
    const day = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
    const ask = await k.B('POST', '/api/schedule/time-off', { day, note: 'Wedding' })
    expect(ask.status).toBe(200)
    const pending = (await k.M('GET', '/api/schedule/time-off')).json
    const id = (pending.requests || pending)[0].id
    expect((await k.B('PUT', `/api/schedule/time-off/${id}`, { status: 'approved' })).status).toBe(403)
    expect((await k.M('PUT', `/api/schedule/time-off/${id}`, { status: 'approved' })).status).toBe(200)
  })

  test('clocking in on the counter tablet by PIN, and out again', async () => {
    expect((await k.B('PUT', '/api/register/pin', { pin: '1357' })).status).toBe(200)
    const inn = await k.M('POST', '/api/register/clock', { pin: '1357' })
    expect(inn.status).toBe(200); expect(inn.json.action).toBe('in')
    expect((await k.M('GET', '/api/register/clock')).json.on.length).toBe(1)
    // A punch out within seconds is thrown away as a slip; two hours into the shift it is a real one.
    await (k.t.db as any).update(k.S.timeEntry).set({ clockIn: new Date(Date.now() - 2 * 3600_000) }).where(eq(k.S.timeEntry.companyId, k.companyId))
    const out = await k.M('POST', '/api/register/clock', { pin: '1357' })
    expect(out.json.action).toBe('out')
    expect((await k.M('GET', '/api/register/clock')).json.on.length).toBe(0)
  })
})

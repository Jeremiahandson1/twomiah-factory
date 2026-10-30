// Gap 1 against Shopify (2026-10-30): the store's sales reports at /api/admin/sales-reports — sales over time, top
// products, repeat customers and the average order, on the shop's own days, from the same orders the Dashboard counts.
//   · the figures are worked out here by hand from fixed orders (a cancelled and an unfinished order never count, a
//     refund comes off, a return takes its units off the product, the shop's midnight is not UTC's);
//   · over all time the report agrees with the Dashboard's own stats;
//   · the report is behind store_sales_reports (registered not ready): off, the API refuses even the owner;
//   · and behind revenue:read: the staff seat is refused whatever the switch says.
import { describe, test, expect, beforeAll } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { bootStore } from './storeKit.ts'
import { FEATURE_MAP } from '@twomiah/tenant-backend'

let k: Awaited<ReturnType<typeof bootStore>>
const URL = '/api/admin/sales-reports'
const W = '?from=2026-10-01&to=2026-10-07'

beforeAll(async () => {
  k = await bootStore()
  const { t, S, companyId } = k
  const ins = async (table: any, values: any) => ((await (t.db as any).insert(table).values(values).returning()) as any[])[0]
  // A shop in Chicago: October is UTC-5, so 04:30Z on the 4th is 11:30pm on the 3rd.
  await (t.db as any).update(S.company).set({ timezone: 'America/Chicago' }).where(eq(S.company.id, companyId))
  const feeder = (await k.product({ slug: 'feeder', name: 'Window feeder', sku: 'FEED-1', priceCents: 1500 })).product
  const seed = (await k.product({ slug: 'seed', name: 'Seed mix', sku: 'SEED-1', priceCents: 1500 })).product
  const suet = (await k.product({ slug: 'suet', name: 'Suet cake', sku: 'SUET-1', priceCents: 2000 })).product
  const person = async (name: string) => (await ins(S.contact, { companyId, name, email: `${name.toLowerCase()}@example.com`, type: 'customer' }))
  const [A, B, C, D, E, F] = await Promise.all(['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Flo'].map(person))
  let n = 0
  const order = async (who: any, status: string, totalCents: number, at: string, refundedCents: number, lines: Array<[any, number, number, number?]>) => {
    n++
    const o = await ins(S.storeOrder, {
      companyId, contactId: who.id, orderNumber: `R-${n}`, provider: 'stripe', providerSessionId: `cs_report_${n}`, status,
      customerEmail: who.email, customerName: who.name, subtotalCents: totalCents, totalCents, refundedCents, createdAt: new Date(at),
    })
    for (const [p, qty, price, back] of lines) {
      await ins(S.storeOrderItem, { orderId: o.id, productId: p.id, productName: p.name, variantName: 'Default', sku: `S${n}-${p.slug}`, unitPriceCents: price, quantity: qty, lineTotalCents: qty * price, refundedQuantity: back ?? 0 })
    }
    return o
  }
  // In the window (Oct 1–7, Chicago days):
  await order(A, 'paid', 5000, '2026-10-04T04:30:00Z', 0, [[feeder, 2, 1500], [suet, 1, 2000]]) // Oct 3, 11:30pm
  await order(A, 'shipped', 3000, '2026-10-06T15:00:00Z', 1000, [[feeder, 2, 1500, 1], [seed, 1, 1500]]) // one feeder came back
  await order(B, 'delivered', 2000, '2026-10-02T12:00:00Z', 0, [[seed, 1, 1500]])
  await order(C, 'refunded', 1500, '2026-10-05T12:00:00Z', 1500, [[suet, 1, 2000, 1]]) // a sale, then all of it back
  await order(E, 'paid', 1000, '2026-10-08T04:30:00Z', 0, [[feeder, 1, 1500]]) // Oct 7, 11:30pm
  // Never counted: a cancelled order and an unfinished checkout.
  await order(C, 'cancelled', 9999, '2026-10-03T12:00:00Z', 0, [[feeder, 10, 1500]])
  await order(D, 'pending', 7777, '2026-10-03T13:00:00Z', 0, [[feeder, 10, 1500]])
  // Outside the window: Bo ordered before it (so Bo is a returning shopper); Flo's order is the 8th by the shop's clock.
  await order(B, 'paid', 4000, '2026-09-15T12:00:00Z', 0, [[seed, 2, 2000]])
  await order(F, 'paid', 8888, '2026-10-08T05:30:00Z', 0, [[feeder, 5, 1500]])
  await (t.db as any).update(S.company).set({ enabledFeatures: ['dashboard', 'orders', 'products', 'contacts', 'store_sales_reports'] }).where(eq(S.company.id, companyId))
  t.services.features.forgetFeatures()
}, 120_000)

describe('the sales reports', () => {
  test('are registered not ready: offered to the store, switched on by no plan', () => {
    const f = FEATURE_MAP.store_sales_reports
    expect(f.hidden).toBe(true)
    expect(f.templates).toEqual(['crm-store'])
  })

  test('the totals, the average order and the days are worked out on the shop\'s clock, minus refunds', async () => {
    const r = await k.as('owner')('GET', URL + W)
    expect(r.status).toBe(200)
    const d = r.json
    expect(d.timeZone).toBe('America/Chicago')
    expect(d.bucket).toBe('day')
    // Five sales; the cancelled and the unfinished are not among them, nor Bo's September order, nor Flo's on the 8th.
    expect(d.totals).toEqual({ orders: 5, customers: 4, grossCents: 12500, refundedCents: 2500, netCents: 10000, averageOrderCents: 2500 })
    // Ada's 11:30pm order is the 3rd (not the 4th), Ed's is the 7th (not the 8th).
    expect(d.series).toEqual([
      { period: '2026-10-02', orders: 1, grossCents: 2000, refundedCents: 0, netCents: 2000 },
      { period: '2026-10-03', orders: 1, grossCents: 5000, refundedCents: 0, netCents: 5000 },
      { period: '2026-10-05', orders: 1, grossCents: 1500, refundedCents: 1500, netCents: 0 },
      { period: '2026-10-06', orders: 1, grossCents: 3000, refundedCents: 1000, netCents: 2000 },
      { period: '2026-10-07', orders: 1, grossCents: 1000, refundedCents: 0, netCents: 1000 },
    ])
  })

  test('top products: what stayed sold, by what it brought in (a returned unit comes off)', async () => {
    const d = (await k.as('owner')('GET', URL + W)).json
    expect(d.topProducts.map((p: any) => [p.name, p.units, p.salesCents])).toEqual([
      ['Window feeder', 4, 6000], // 2 + (2 − 1 back) + 1; the cancelled and unfinished tens are not counted
      ['Seed mix', 2, 3000],
      ['Suet cake', 1, 2000], // Cy's suet was returned, so only Ada's counts
    ])
  })

  test('repeat customers: Ada ordered twice in the window, Bo had ordered before it; Cy and Ed are new', async () => {
    const d = (await k.as('owner')('GET', URL + W)).json
    expect(d.repeat).toMatchObject({ customers: 4, repeat: 2, firstTime: 2, repeatRate: 0.5, repeatNetCents: 9000 })
    expect(d.repeat.top.map((r: any) => [r.name, r.orders, r.netCents])).toEqual([['Ada', 2, 7000], ['Bo', 1, 2000]])
  })

  test('over all time they agree with the Dashboard\'s own figures', async () => {
    const stats = (await k.as('owner')('GET', '/api/admin/orders/stats')).json
    const d = (await k.as('owner')('GET', URL + '?from=2026-01-01&to=2026-12-31')).json
    expect(d.bucket).toBe('month')
    expect(d.totals.orders).toBe(stats.paidCount)
    expect(d.totals.grossCents).toBe(stats.revenueCents)
    expect(d.totals.refundedCents).toBe(stats.refundedCents)
    expect(d.totals.netCents).toBe(stats.netCents)
  })

  test('a window that is not dates, is backwards, is too long, or groups by nothing is refused with a sentence', async () => {
    const o = k.as('owner')
    for (const bad of ['?from=yesterday', '?from=2026-10-07&to=2026-10-01', '?from=2025-01-01&to=2026-10-07', '?from=2026-10-01&to=2026-10-07&bucket=hour', '?from=2026-02-30&to=2026-03-02']) {
      const r = await o('GET', URL + bad)
      expect({ bad, status: r.status, code: r.json.code }).toEqual({ bad, status: 400, code: 'validation_failed' })
    }
  })

  test('a manager reads them; the staff seat is refused (the takings are revenue:read)', async () => {
    expect((await k.as('manager')('GET', URL + W)).status).toBe(200)
    const staff = await k.as('staff')('GET', URL + W)
    expect(staff.status).toBe(403)
    expect(JSON.stringify(staff.json)).not.toContain('12500')
  })

  test('the menu row and the typed-in address ask what the server asks: the same switch and the same permission', () => {
    const web = (p: string) => fs.readFileSync(path.join(import.meta.dir, '..', 'web', 'src', p), 'utf8')
    const orders = web('crm/pages/store/orders/index.tsx')
    expect(orders).toMatch(/to: '\/crm\/sales'[^\n]*features: \['store_sales_reports'\][^\n]*permission: 'revenue:read'/)
    expect(orders).toMatch(/'\/crm\/sales': 'revenue:read'/)
    expect(orders).toMatch(/routeGates[^\n]*'\/crm\/sales': \['store_sales_reports'\]/)
    expect(web('shell.ts')).toContain('...storeRouteGates')
  })

  test('with the switch off, the API refuses even the owner', async () => {
    const { t, S, companyId } = k
    await (t.db as any).update(S.company).set({ enabledFeatures: ['dashboard', 'orders', 'products', 'contacts'] }).where(eq(S.company.id, companyId))
    t.services.features.forgetFeatures()
    try {
      const r = await k.as('owner')('GET', URL + W)
      expect(r.status).toBe(403)
      expect(r.json.code).toBe('FEATURE_NOT_ENABLED')
    } finally {
      await (t.db as any).update(S.company).set({ enabledFeatures: ['dashboard', 'orders', 'products', 'contacts', 'store_sales_reports'] }).where(eq(S.company.id, companyId))
      t.services.features.forgetFeatures()
    }
  })
})

// Parity row 1 against Shopify (2026-10-31): the sales report and its CSV cut by VARIANT (size / colour) — units, net sales,
// cost and margin per option, on the shop's own days and net of refunds, beside the by-product view.
//   · two options of one product are two rows, and the by-product view still adds them up;
//   · a returned unit comes off, a cancelled and an unfinished order never count, and the shop's midnight is not UTC's;
//   · the cost a line kept when it sold is the cost used (a later edit does not move it); an option with no cost says so —
//     "no cost", never zero; the margin is the profit over the costed sales;
//   · an option removed since is still listed, by the names and SKU it had when it sold;
//   · a seat that sees takings but not cost (the viewer) is sent no cost, profit or margin; staff are refused;
//   · the CSV has the same rows; it is behind the same switch as the rest of the reports.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootStore } from './storeKit.ts'

let k: Awaited<ReturnType<typeof bootStore>>
const REPORTS = '/api/admin/sales-reports'
const W = '?from=2026-10-01&to=2026-10-07'

beforeAll(async () => {
  k = await bootStore()
  const { t, S, companyId } = k
  const ins = async (table: any, values: any) => ((await (t.db as any).insert(table).values(values).returning()) as any[])[0]
  await (t.db as any).update(S.company).set({ timezone: 'America/Chicago' }).where(eq(S.company.id, companyId))
  const tee = await ins(S.storeProduct, { companyId, slug: 'tee', name: 'Feeder tee', status: 'active', kind: 'physical' })
  const small = await ins(S.storeProductVariant, { productId: tee.id, sku: 'TEE-S', name: 'Small', priceCents: 2000, inventoryQty: 50 })
  const large = await ins(S.storeProductVariant, { productId: tee.id, sku: 'TEE-L', name: 'Large', priceCents: 2000, inventoryQty: 50 })
  const mug = (await k.product({ slug: 'mug', name: 'Mug', sku: 'MUG-1', priceCents: 1000 }))
  const who = await ins(S.contact, { companyId, name: 'Ada', email: 'ada@example.com', type: 'customer' })
  let n = 0
  type Line = { p: any; v?: any; qty: number; price: number; cost?: number | null; back?: number; sku?: string; names?: [string, string] }
  const order = async (status: string, at: string, lines: Line[]) => {
    n++
    const total = lines.reduce((s, l) => s + l.qty * l.price, 0)
    const o = await ins(S.storeOrder, { companyId, contactId: who.id, orderNumber: `V-${n}`, provider: 'stripe', providerSessionId: `cs_variant_${n}`, status, customerEmail: who.email, customerName: who.name, subtotalCents: total, totalCents: total, refundedCents: 0, createdAt: new Date(at) })
    for (const l of lines) {
      await ins(S.storeOrderItem, { orderId: o.id, productId: l.p.id, variantId: l.v?.id ?? null, productName: l.names?.[0] ?? l.p.name, variantName: l.names?.[1] ?? l.v?.name ?? 'Default', sku: l.sku ?? l.v?.sku, unitPriceCents: l.price, quantity: l.qty, lineTotalCents: l.qty * l.price, refundedQuantity: l.back ?? 0, unitCostCents: l.cost ?? null })
    }
  }
  const m = { p: mug.product, v: mug.variant }
  // In the window (Oct 1–7, Chicago days): 04:30Z on the 4th is 11:30pm on the 3rd.
  await order('paid', '2026-10-04T04:30:00Z', [{ p: tee, v: small, qty: 2, price: 2000, cost: 800 }, { p: tee, v: large, qty: 1, price: 2000, cost: 800 }, { ...m, qty: 1, price: 1000 }])
  await order('shipped', '2026-10-06T15:00:00Z', [{ p: tee, v: small, qty: 3, price: 2000, cost: 800, back: 1 }, { ...m, qty: 2, price: 1000 }]) // one small came back
  await order('delivered', '2026-10-08T04:30:00Z', [{ p: tee, v: large, qty: 2, price: 2000, cost: 900 }]) // Oct 7, 11:30pm; the cost had moved by then
  await order('paid', '2026-10-02T12:00:00Z', [{ p: tee, qty: 1, price: 2500, cost: 1000, sku: 'TEE-OLD', names: ['Feeder tee', 'XL'] }]) // an option removed since (no variant row)
  // Never counted: cancelled, unfinished. Outside the window: the 8th by the shop's clock.
  await order('cancelled', '2026-10-03T12:00:00Z', [{ p: tee, v: large, qty: 10, price: 2000 }])
  await order('pending', '2026-10-03T13:00:00Z', [{ p: tee, v: small, qty: 10, price: 2000 }])
  await order('paid', '2026-10-08T05:30:00Z', [{ p: tee, v: small, qty: 5, price: 2000, cost: 800 }])
  await (t.db as any).update(S.company).set({ enabledFeatures: ['dashboard', 'orders', 'products', 'contacts', 'store_sales_reports'] }).where(eq(S.company.id, companyId))
  t.services.features.forgetFeatures()
}, 120_000)

describe('sales by variant', () => {
  test('one row per option: units, net sales, cost, profit and margin — returned units off, only counted orders, on the shop\'s days', async () => {
    const r = await k.as('owner')('GET', REPORTS + W)
    expect(r.status).toBe(200)
    expect(r.json.variants.map((v: any) => [v.productName, v.variantName, v.sku, v.units, v.salesCents, v.costCents, v.profitCents, v.marginPercent])).toEqual([
      ['Feeder tee', 'Small', 'TEE-S', 4, 8000, 3200, 4800, 60],        // 2 + (3 − 1 back); the 8th-by-the-shop's-clock five are not here
      ['Feeder tee', 'Large', 'TEE-L', 3, 6000, 2600, 3400, 56.7],     // 1 at 800 + 2 at 900; the cancelled ten are not here
      ['Mug', 'Default', 'MUG-1', 3, 3000, null, null, null],           // no cost stored: "no cost", not zero
      ['Feeder tee', 'XL', 'TEE-OLD', 1, 2500, 1000, 1500, 60],         // an option removed since is still listed by the names it sold under
    ])
  })

  test('the by-product view beside it still adds the options up', async () => {
    const r = await k.as('owner')('GET', REPORTS + W)
    expect(r.json.topProducts.find((p: any) => p.name === 'Feeder tee')).toMatchObject({ units: 8, salesCents: 16500 })
  })

  test('a seat that sees takings but not cost is sent units and sales only — no cost, profit or margin', async () => {
    const { t, S, companyId } = k
    await (t.db as any).insert(S.user).values({ email: 'viewer@test.example', passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: 'v', lastName: 'Seat', role: 'viewer', companyId })
    const tok = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'viewer@test.example', password: 'Seat-pass-1' } })).json()).accessToken
    const r = await k.pub('GET', REPORTS + W, undefined, { Authorization: `Bearer ${tok}` })
    expect(r.status).toBe(200)
    expect(r.json.variants).toHaveLength(4)
    expect(r.json.variants.every((v: any) => !('costCents' in v) && !('profitCents' in v) && !('marginPercent' in v))).toBe(true)
    const csv = await k.pub('GET', `${REPORTS}/export?report=variants&from=2026-10-01&to=2026-10-07`, undefined, { Authorization: `Bearer ${tok}` })
    expect(csv.text.split('\r\n')[0]).toBe('Product,Option,SKU,Units sold,Net sales')
  })

  test('the CSV carries the same rows (and the manager reads it; staff are refused)', async () => {
    const csv = await k.as('owner')('GET', `${REPORTS}/export?report=variants&from=2026-10-01&to=2026-10-07`)
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-disposition')).toContain('variants-2026-10-01-to-2026-10-07.csv')
    expect(csv.text.split('\r\n').slice(0, 5)).toEqual([
      'Product,Option,SKU,Units sold,Net sales,Cost,Profit,Margin %',
      'Feeder tee,Small,TEE-S,4,80.00,32.00,48.00,60',
      'Feeder tee,Large,TEE-L,3,60.00,26.00,34.00,56.7',
      'Mug,Default,MUG-1,3,30.00,no cost,no cost,no cost',
      'Feeder tee,XL,TEE-OLD,1,25.00,10.00,15.00,60',
    ])
    expect((await k.as('manager')('GET', `${REPORTS}/export?report=variants&from=2026-10-01&to=2026-10-07`)).status).toBe(200)
    expect((await k.as('staff')('GET', `${REPORTS}/export?report=variants`)).status).toBe(403)
    expect((await k.as('staff')('GET', REPORTS + W)).status).toBe(403)
  })

  test('with the switch off, the by-variant report is refused with the rest', async () => {
    const { t, S, companyId } = k
    await (t.db as any).update(S.company).set({ enabledFeatures: ['dashboard', 'orders', 'products', 'contacts'] }).where(eq(S.company.id, companyId))
    t.services.features.forgetFeatures()
    try {
      expect((await k.as('owner')('GET', REPORTS + W)).status).toBe(403)
      expect((await k.as('owner')('GET', `${REPORTS}/export?report=variants`)).status).toBe(403)
    } finally {
      await (t.db as any).update(S.company).set({ enabledFeatures: ['dashboard', 'orders', 'products', 'contacts', 'store_sales_reports'] }).where(eq(S.company.id, companyId))
      t.services.features.forgetFeatures()
    }
  })
})

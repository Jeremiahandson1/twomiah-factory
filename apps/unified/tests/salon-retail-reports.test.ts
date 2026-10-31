// Retail reports (salon row 13; server crm/salon/retailMargins.ts, reports.ts GET /api/salon-reports/retail-products, data/salon.ts retailLinesSold):
// retail by brand, category, supplier, SKU and stylist, each with units, net, cost, margin and margin %, and what the stock on hand is worth.
// Every figure below is worked by hand from the sales set up in the first test (cents):
//
//   A ana  Gloss x2 (20.00 each, cost 8.00)                              paid 40.00                    net 4000  cost 1600
//   B ana  Mask x1 (30.00, cost 12.00) + Gloss x1, 10.00 discount        paid 40.00  (factor 40/50)    Mask net 2400 cost 1200, Gloss net 1600 cost 800
//   C bea  Mask x2, 30.00 refunded of 60.00, none put back               net 3000  cost 2400
//   D bea  Gloss x2, fully refunded, both put back on the shelf          net 0     cost 0
//   E bea  Gloss x1, fully refunded, NOT put back                        net 0     cost 800 (a loss)
//   F ana  Dye x1 (10.00, no cost entered)                               net 1000  uncosted
//   G ana  a hand-typed 8.00 retail line on a visit, no product          net 800   uncosted, no brand
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'invoices', 'salon_retail', 'salon_reports']
const PASSWORD = 'Margins-1031-xx'

describe('salon: retail reports with margins', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', ana = '', bea = '', cut = ''
  let gloss = '', mask = '', dye = ''
  const tokens: Record<string, string> = {}
  let ip = 0, hour = 7
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}`, 'x-forwarded-for': `10.9.0.${++ip}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  const wall = (d: string, hm: string) => {
    const guess = new Date(`${d}T${hm}:00Z`)
    const parts = tzParts(guess, TZ)
    const offsetMin = (guess.getTime() - new Date(`${parts.date}T${String(Math.floor(parts.minutes / 60)).padStart(2, '0')}:${String(parts.minutes % 60).padStart(2, '0')}:00Z`).getTime()) / 60000
    return new Date(guess.getTime() + offsetMin * 60000).toISOString()
  }
  const newProduct = async (b: Record<string, unknown>) => { const r = await as('owner', '/api/salon-retail/products', 'POST', b); expect(r.status).toBe(201); return r.body.product.id as string }
  const invoiceOf = async (id: string) => (await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, id)))[0]
  const pay = async (id: string) => expect((await as('owner', `/api/invoices/${id}/payments`, 'POST', { amount: Number((await invoiceOf(id)).total), method: 'cash' })).status).toBeLessThan(300)
  const walkIn = async (stylistId: string, items: Array<{ productId: string; quantity: number }>) => {
    const r = await as('owner', '/api/salon-retail/sell/new', 'POST', { items, stylistId })
    expect(r.status).toBe(201)
    return r.body.invoiceId as string
  }
  const refund = async (id: string, amount: number) => expect((await as('owner', `/api/invoices/${id}/refund`, 'POST', { amount, method: 'cash' })).status).toBeLessThan(300)
  const report = async (q = '') => { const r = await as('owner', `/api/salon-reports/retail-products${q}`); expect(r.status).toBe(200); return r.body as any }
  const pick = (rows: any[], name: string) => rows.find((g) => g.name === name)
  const shape = (g: any) => g && [g.units, g.netCents, g.costCents, g.marginCents, g.marginPercent]

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ, name: 'Glow Studio', settings: { defaultTaxRate: 0 } } as any).where(eq(t.schema.company.id, co))
    await features(FEATURES)
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    for (const key of ['ana', 'bea']) {
      const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role: 'field', companyId: co })
      if (key === 'ana') ana = u.id; else bea = u.id
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${key}@test.example`, password: PASSWORD } })).json()) as any).accessToken
    }
    cut = (await as('owner', '/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 100 })).body.id
    const s1 = (await as('owner', '/api/salon-retail-stock/suppliers', 'POST', { name: 'Salon Wholesale' })).body.supplier.id
    const s2 = (await as('owner', '/api/salon-retail-stock/suppliers', 'POST', { name: 'Color House' })).body.supplier.id
    gloss = await newProduct({ name: 'Gloss', brand: 'Aveda', category: 'Styling', sku: 'GL-1', supplierId: s1, priceCents: 2000, costCents: 800, openingStock: 10 })
    mask = await newProduct({ name: 'Mask', brand: 'Aveda', category: 'Care', sku: 'MK-1', supplierId: s1, priceCents: 3000, costCents: 1200, openingStock: 10 })
    dye = await newProduct({ name: 'Dye', brand: 'Wella', category: 'Color', sku: 'DY-1', supplierId: s2, priceCents: 1000, openingStock: 5 })
  }, 120_000)

  test('closed until the feature; only people who may read reports see it', async () => {
    await features(FEATURES.filter((f) => f !== 'salon_reports'))
    expect((await as('owner', '/api/salon-reports/retail-products')).status).not.toBe(200)
    await features(FEATURES)
    expect((await as('owner', '/api/salon-reports/retail-products')).status).toBe(200)
    expect((await as('ana', '/api/salon-reports/retail-products')).status).toBe(403)
    expect((await as('owner', '/api/salon-reports/retail-products?from=2026-03-01&to=2026-02-01')).status).toBe(400)
  })

  test('nothing sold yet: empty groups, no margin, and the stock is already worth something', async () => {
    const r = await report()
    expect([r.total.units, r.total.netCents, r.total.marginCents, r.total.marginPercent]).toEqual([0, 0, null, null])
    expect(r.byBrand).toEqual([])
    // 10 Gloss at 8.00 + 10 Mask at 12.00 = 200.00 at cost; 10 x 20.00 + 10 x 30.00 + 5 x 10.00 = 550.00 at the shelf; Dye has no cost
    expect(r.stock).toMatchObject({ costCents: 20000, retailCents: 55000, units: 25, productsWithoutCost: 1 })
  })

  test('hand-worked sales: discount share, partial and full refunds, put back or not, uncosted and hand-typed lines', async () => {
    const A = await walkIn(ana, [{ productId: gloss, quantity: 2 }]); await pay(A)
    const B = await walkIn(ana, [{ productId: mask, quantity: 1 }, { productId: gloss, quantity: 1 }])
    await t.db.update(t.schema.invoice).set({ discount: '10', total: '40' } as any).where(eq(t.schema.invoice.id, B))
    await pay(B)
    const C = await walkIn(bea, [{ productId: mask, quantity: 2 }]); await pay(C); await refund(C, 30)
    const D = await walkIn(bea, [{ productId: gloss, quantity: 2 }]); await pay(D); await refund(D, 40)
    expect((await as('owner', `/api/salon-retail-stock/sales/${D}/return-to-shelf`, 'POST', { items: [{ productId: gloss, quantity: 2 }] })).status).toBe(200)
    const E = await walkIn(bea, [{ productId: gloss, quantity: 1 }]); await pay(E); await refund(E, 20)
    const F = await walkIn(ana, [{ productId: dye, quantity: 1 }]); await pay(F)
    // G: a visit invoice (100.00 cut) with a retail line typed by hand
    const client = await ins(t.schema.contact, { companyId: co, name: 'Hand Client', email: 'hand@example.com', type: 'client' })
    const made = await as('owner', '/api/appointments', 'POST', { contactId: client.id, startTime: wall(addDays(today(), -1), `${String(hour++).padStart(2, '0')}:00`), serviceId: cut, stylistId: ana })
    expect((await as('owner', `/api/appointments/${made.body.id}`, 'PUT', { status: 'completed' })).status).toBe(200)
    const [G] = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.appointmentId, made.body.id))
    await ins(t.schema.invoiceLineItem, { invoiceId: G.id, description: 'Scrunchie', type: 'retail', quantity: '1', unitPrice: '8', total: '8', sortOrder: 9 })
    await t.db.update(t.schema.invoice).set({ subtotal: '108', total: '108' } as any).where(eq(t.schema.invoice.id, G.id))
    await pay(G.id)

    const r = await report()
    // everything: net 4000+4000+3000+0+0+1000+800 = 12800; costed net 11000; cost 1600+2000+2400+0+800 = 6800; margin 4200 = 38.2%
    expect(r.total).toMatchObject({ units: 11, grossCents: 22800, discountCents: 1000, refundedCents: 9000, netCents: 12800, costCents: 6800, uncostedNetCents: 1800, marginCents: 4200, marginPercent: 38.2 })
    // brand
    expect(shape(pick(r.byBrand, 'Aveda'))).toEqual([9, 11000, 6800, 4200, 38.2])
    expect(shape(pick(r.byBrand, 'Wella'))).toEqual([1, 1000, 0, null, null])             // no cost was ever entered: no margin is invented
    expect(shape(pick(r.byBrand, 'No brand'))).toEqual([1, 800, 0, null, null])           // the hand-typed line has revenue and nothing else
    // category: Styling = Gloss (A 4000/1600, B 1600/800, D 0/0, E 0/800); Care = Mask (B 2400/1200, C 3000/2400)
    expect(shape(pick(r.byCategory, 'Styling'))).toEqual([6, 5600, 3200, 2400, 42.9])
    expect(shape(pick(r.byCategory, 'Care'))).toEqual([3, 5400, 3600, 1800, 33.3]);
    // supplier
    expect(shape(pick(r.bySupplier, 'Salon Wholesale'))).toEqual([9, 11000, 6800, 4200, 38.2])
    expect(pick(r.bySupplier, 'Color House').netCents).toBe(1000)
    expect(pick(r.bySupplier, 'No supplier').netCents).toBe(800)
    // SKU: Gloss lost money on the sale that came back without being put back, and made it up elsewhere
    const g = r.bySku.find((x: any) => x.name.includes('Gloss'))
    expect([g.name, ...shape(g)]).toEqual(['Aveda Gloss (GL-1)', 6, 5600, 3200, 2400, 42.9])
    expect(r.bySku.find((x: any) => x.name.includes('Mask')).marginCents).toBe(1800)
    expect(r.bySku.find((x: any) => x.name === 'Scrunchie (not linked to a product)').netCents).toBe(800)
    // refund detail on a SKU: Mask 2 units refunded half
    expect(r.bySku.find((x: any) => x.name.includes('Mask'))).toMatchObject({ grossCents: 9000, discountCents: 600, refundedCents: 3000 })
  })

  test('by stylist: the stylist named on the line, net of discounts and refunds', async () => {
    const r = await report()
    const a = r.byStylist.find((x: any) => x.name === 'ana Tester'), b = r.byStylist.find((x: any) => x.name === 'bea Tester')
    // ana: A 4000 + B 4000 + F 1000 + G 800 = 9800 (costed 8000, cost 3600 -> 4400, 55%)
    expect([a.units, a.netCents, a.costCents, a.marginCents, a.marginPercent]).toEqual([6, 9800, 3600, 4400, 55])
    // bea: C 3000 + D 0 + E 0; cost 2400 + 0 + 800 -> margin -200, -6.7%
    expect([b.units, b.netCents, b.costCents, b.marginCents, b.marginPercent]).toEqual([5, 3000, 3200, -200, -6.7])
  })

  test('cost is what the unit cost when it was sold; stock value follows the cost now', async () => {
    expect((await as('owner', `/api/salon-retail/products/${mask}`, 'PATCH', { costCents: 1500 })).status).toBe(200)
    const r = await report()
    expect(r.total.costCents).toBe(6800)                                                  // old sales keep the old cost
    // on hand: Gloss 10-2-1-2+2-1 = 6, Mask 10-1-2 = 7, Dye 5-1 = 4
    expect(r.stock).toMatchObject({ costCents: 6 * 800 + 7 * 1500, retailCents: 6 * 2000 + 7 * 3000 + 4 * 1000, units: 17, productsWithoutCost: 1 })
  })

  test('the window decides which sales count', async () => {
    const old = await report(`?from=${addDays(today(), -400)}&to=${addDays(today(), -300)}`)
    expect([old.total.units, old.byBrand]).toEqual([0, []])
    expect((await report(`?from=${today()}&to=${today()}`)).total.netCents).toBe(12800 - 800 + 800)   // all paid today except G, which was paid today too
  })
})

// SALES BY STAFF (Shopify POS's attributed staff and its Sales by staff report; live test 11/12 — a counter sale and a draft order
// did not say who made them, so the store had no Sales by staff report). Through the real server as the store:
//   · a counter sale is credited to the person ringing it up, or to whoever "Sold by" names; a line can be credited to someone else;
//   · someone not on the team (another company's, a viewer seat, a stranger id) is refused, and nothing is made;
//   · a draft order is credited to whoever made it; an online-store order to no one;
//   · Store › Sales › Sales by staff adds each person's lines up (a line's own staff first, else its order's), returns off, and
//     leaves the online store out.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', owner = '', ownerId = '', mara = '', vic = '', other = ''
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const sell = async (body: any) => json(await call('/api/admin/counter-sales', { method: 'POST', json: body }))
const S = () => t.schema as any
const itemsOf = async (orderId: string) => (await (t.db as any).select().from(S().storeOrderItem).where(eq(S().storeOrderItem.orderId, orderId)))

beforeAll(async () => {
  t = await bootTenant({ vertical: 'store' })
  const s = await seedOwner(t)
  companyId = s.company.id
  ownerId = s.owner.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['store_counter', 'store_sales_reports', 'store_report_schedules'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  ;(t.services.crm.emailService as any).send = async () => ({ success: true })
  owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
  const seat = async (email: string, firstName: string, role: string, co = companyId) => ((await (t.db as any).insert(S().user).values({ email, passwordHash: 'x', firstName, lastName: 'Seat', role, companyId: co }).returning())[0]).id
  mara = await seat('mara@test.example', 'Mara', 'manager')
  vic = await seat('vic@test.example', 'Vic', 'viewer')
  const [co2] = await (t.db as any).insert(S().company).values({ name: 'Elsewhere', slug: 'elsewhere' }).returning()
  other = await seat('other@test.example', 'Otto', 'manager', co2.id)
  await (t.db as any).insert(S().storeSettings).values({ companyId, currency: 'usd', flatShippingCents: 0, taxRateBps: 0, pickupEnabled: true })
  const product = async (slug: string, sku: string, priceCents: number) => {
    const [p] = await (t.db as any).insert(S().storeProduct).values({ companyId, slug, name: slug, status: 'active' }).returning()
    await (t.db as any).insert(S().storeProductVariant).values({ productId: p.id, sku, name: 'Default', priceCents, inventoryQty: 100 })
  }
  await product('mug', 'MUG-1', 2000)
  await product('bowl', 'BOWL-1', 1500)
}, 120_000)

test('the "Sold by" picker lists the team, viewers and other companies left out', async () => {
  const r = await json(await call('/api/admin/counter-sales/staff'))
  expect(r.status).toBe(200)
  expect(r.body.me).toBe(ownerId)
  expect(r.body.data.map((p: any) => p.name)).toEqual(['Mara Seat', 'Olive Owner'])
})

test('a counter sale is credited to the person ringing it up, or to whoever "Sold by" names; a line to someone else', async () => {
  const mine = await sell({ items: [{ sku: 'MUG-1', quantity: 1 }], paidBy: 'cash' })
  expect(mine.status).toBe(201)
  expect(mine.body.order).toMatchObject({ staffUserId: ownerId, staffName: 'Olive Owner' })

  const hers = await sell({ items: [{ sku: 'MUG-1', quantity: 2 }, { sku: 'BOWL-1', quantity: 1, soldBy: ownerId }], paidBy: 'card', soldBy: mara })
  expect(hers.status).toBe(201)
  expect(hers.body.order).toMatchObject({ staffUserId: mara, staffName: 'Mara Seat' })
  const lines = await itemsOf(hers.body.order.id)
  expect(lines.find((l: any) => l.sku === 'MUG-1')).toMatchObject({ staffUserId: null, staffName: null })
  expect(lines.find((l: any) => l.sku === 'BOWL-1')).toMatchObject({ staffUserId: ownerId, staffName: 'Olive Owner' })
  // The order's history says who.
  const audit = (await (t.db as any).select().from(S().auditLog)).filter((a: any) => a.entityId === hers.body.order.id)
  expect(audit.some((a: any) => /by Mara Seat, paid by card/.test(a.metadata?.description || ''))).toBe(true)
})

test('someone not on the team is refused and nothing is made', async () => {
  const before = (await (t.db as any).select().from(S().storeOrder)).length
  for (const id of [vic, other, 'nobody']) {
    const r = await sell({ items: [{ sku: 'MUG-1', quantity: 1 }], paidBy: 'cash', soldBy: id })
    expect([r.status, r.body.code]).toEqual([400, 'validation_failed'])
    const l = await sell({ items: [{ sku: 'MUG-1', quantity: 1, soldBy: id }], paidBy: 'cash' })
    expect(l.status).toBe(400)
  }
  expect((await (t.db as any).select().from(S().storeOrder)).length).toBe(before)
})

test('a draft order is credited to whoever made it', async () => {
  const [who] = await (t.db as any).insert(S().contact).values({ companyId, name: 'Dana Buyer', email: 'dana@example.com', type: 'client' }).returning()
  const r = await json(await call('/api/admin/draft-orders', { method: 'POST', json: { contactId: who.id, items: [{ sku: 'BOWL-1', quantity: 2 }], delivery: 'pickup', paidInPerson: 'cash' } }))
  expect(r.status).toBe(201)
  expect(r.body.order).toMatchObject({ staffUserId: ownerId, staffName: 'Olive Owner', source: 'draft' })
})

test('Sales by staff: each person\'s lines, a line\'s own staff first, returns off, the online store left out', async () => {
  // An online-store order, credited to no one, and a returned bowl on Mara's sale.
  const [o] = await (t.db as any).insert(S().storeOrder).values({ companyId, orderNumber: 'ORD-WEB1', provider: 'square', providerSessionId: 'sq_web1', status: 'paid', customerEmail: 'web@example.com', subtotalCents: 9900, totalCents: 9900, currency: 'usd' }).returning()
  await (t.db as any).insert(S().storeOrderItem).values({ orderId: o.id, productName: 'mug', variantName: 'Default', sku: 'MUG-1', unitPriceCents: 9900, quantity: 1, lineTotalCents: 9900 })
  const r = await json(await call('/api/admin/sales-reports/table?tab=staff'))
  expect(r.status).toBe(200)
  expect(r.body.title).toBe('Sales by staff')
  const by = (name: string) => r.body.rows.find((x: any) => x.name === name)
  // Olive: her own mug ($20) + the bowl on Mara's sale ($15) + the draft's two bowls ($30) = $65 over 3 orders, 4 units.
  expect(by('Olive Owner')).toMatchObject({ orders: 3, units: 4, gross: 65, returned: 0, net: 65 })
  // Mara: the two mugs on her sale ($40).
  expect(by('Mara Seat')).toMatchObject({ orders: 1, units: 2, gross: 40, net: 40 })
  expect(r.body.rows.length).toBe(2)
  expect(r.body.totals).toMatchObject({ orders: 4, units: 6, net: 105 })

  // A returned mug on Mara's sale comes off her net.
  const [mugLine] = (await (t.db as any).select().from(S().storeOrderItem)).filter((l: any) => l.staffUserId === null && l.sku === 'MUG-1' && l.quantity === 2)
  await (t.db as any).update(S().storeOrderItem).set({ refundedQuantity: 1 }).where(eq(S().storeOrderItem.id, mugLine.id))
  const after = await json(await call('/api/admin/sales-reports/table?tab=staff'))
  expect(after.body.rows.find((x: any) => x.name === 'Mara Seat')).toMatchObject({ units: 1, gross: 40, returned: 20, net: 20 })
})

test("a walk-in's order shows no stand-in email, and is logged once, in plain words (live test 11/12)", async () => {
  const r = await sell({ items: [{ sku: 'BOWL-1', quantity: 1 }], paidBy: 'cash' })
  expect(r.status).toBe(201)
  const order = await json(await call(`/api/admin/orders/${r.body.order.id}`))
  expect(order.body.customerEmail).toBeNull()
  const history = await json(await call(`/api/admin/orders/${r.body.order.id}/history`))
  const what = history.body.data.map((h: any) => h.what)
  expect(what.some((w: string) => /^Sold at the counter by Olive Owner, paid by cash$/.test(w))).toBe(true)
  expect(what.some((w: string) => /not paid yet/.test(w))).toBe(false)
  expect(what.some((w: string) => /paid — \$15\.00 in person$/.test(w))).toBe(true)
  expect(what.join(' ')).not.toContain('in_person')
  // Sales by customer: walk-ins are one row with no email; the store's customers do not count them as someone who came back.
  const byCustomer = await json(await call('/api/admin/sales-reports/table?tab=customers'))
  expect(JSON.stringify(byCustomer.body)).not.toContain('pending@checkout')
})

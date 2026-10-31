// Retail at the desk (salon gap #7, second half; server/crm/salon/retail.ts, hidden feature `salon_retail`). Products with a count on hand, sold onto a
// client's sale as a "retail" line (the type commissions and the retail report read), stock taken under a row lock so the last bottle is sold once,
// units back on the shelf when the line comes off or the sale is voided, and stock received/corrected by a manager with who and why.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'invoices']
const PASSWORD = 'Retail-1030-xx'

describe('salon: retail with stock', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', ana = '', cut = '', shampoo = '', mask = ''
  const tokens: Record<string, string> = {}
  let ip = 0, hour = 7
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}`, 'x-forwarded-for': `10.7.0.${++ip}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  const day = addDays(today(), -2)
  const wall = (d: string, hm: string) => {
    const guess = new Date(`${d}T${hm}:00Z`)
    const parts = tzParts(guess, TZ)
    const offsetMin = (guess.getTime() - new Date(`${parts.date}T${String(Math.floor(parts.minutes / 60)).padStart(2, '0')}:${String(parts.minutes % 60).padStart(2, '0')}:00Z`).getTime()) / 60000
    return new Date(guess.getTime() + offsetMin * 60000).toISOString()
  }
  /** A completed $100 cut by Ana (raises the bill: an open sale with one service line). */
  async function visitSale() {
    const client = await ins(t.schema.contact, { companyId: co, name: `Client ${ip}`, email: `c${ip}-${hour}@example.com`, type: 'client' })
    hour += 1
    const made = await as('owner', '/api/appointments', 'POST', { contactId: client.id, startTime: wall(day, `${String(hour).padStart(2, '0')}:00`), serviceId: cut, stylistId: ana })
    expect(made.status).toBe(201)
    expect((await as('owner', `/api/appointments/${made.body.id}`, 'PUT', { status: 'completed' })).status).toBe(200)
    const [inv] = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.appointmentId, made.body.id))
    return inv.id as string
  }
  const invoiceOf = async (id: string) => (await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, id)))[0]
  const linesOf = async (id: string) => (await t.db.select().from(t.schema.invoiceLineItem).where(eq(t.schema.invoiceLineItem.invoiceId, id))) as any[]
  const onHand = async (id: string) => ((await as('owner', '/api/salon-retail')).body.products as any[]).find((p) => p.id === id)?.onHand
  const sell = (invoiceId: string, productId: string, quantity = 1, who = 'owner') => as(who, '/api/salon-retail/sell', 'POST', { invoiceId, items: [{ productId, quantity }] })

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ, settings: { defaultTaxRate: 10 } } as any).where(eq(t.schema.company.id, co))
    await features(FEATURES)
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    for (const [key, role] of [['ana', 'field'], ['manager', 'manager']] as const) {
      const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role, companyId: co })
      if (key === 'ana') ana = u.id
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${key}@test.example`, password: PASSWORD } })).json()) as any).accessToken
    }
    cut = (await as('owner', '/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 100 })).body.id
  }, 120_000)

  test('closed until the salon is given the feature; then the server decides who sells and who keeps the catalogue', async () => {
    expect((await as('owner', '/api/salon-retail')).status).not.toBe(200)
    await features([...FEATURES, 'salon_retail'])
    expect((await as('owner', '/api/salon-retail')).status).toBe(200)
    // A stylist holds neither the sale rights nor the inventory rights.
    for (const [path, method, body] of [['/api/salon-retail', 'GET'], ['/api/salon-retail/manage', 'GET'], ['/api/salon-retail/products', 'POST', { name: 'x', priceCents: 100 }], ['/api/salon-retail/sell', 'POST', { invoiceId: 'a', items: [] }], ['/api/salon-retail/sell/new', 'POST', { items: [] }], ['/api/salon-retail/lines/abc', 'DELETE']] as const) {
      expect([path, (await as('ana', path, method, body)).status]).toEqual([path, 403])
    }
  })

  test('products: validated, with opening stock, cost kept from the till, low-stock flagged', async () => {
    expect((await as('owner', '/api/salon-retail/products', 'POST', { priceCents: 1800 })).status).toBe(400)                 // no name
    expect((await as('owner', '/api/salon-retail/products', 'POST', { name: 'Free', priceCents: 0 })).status).toBe(400)       // no price
    expect((await as('owner', '/api/salon-retail/products', 'POST', { name: 'Odd', priceCents: 12.5 })).status).toBe(400)
    expect((await as('owner', '/api/salon-retail/products', 'POST', { name: 'Odd', priceCents: 1800, openingStock: -1 })).status).toBe(400)
    expect(((await as('manager', '/api/salon-retail/manage')).body.products as any[])).toHaveLength(0)                        // a refused product leaves nothing behind
    const a = await as('manager', '/api/salon-retail/products', 'POST', { name: 'Repair Shampoo', brand: 'Olaplex', priceCents: 3000, costCents: 1500, reorderAt: 2, openingStock: 3 })
    expect(a.status).toBe(201)
    shampoo = a.body.product.id
    mask = (await as('owner', '/api/salon-retail/products', 'POST', { name: 'Hair Mask', priceCents: 2500, openingStock: 1 })).body.product.id
    const sold = (await as('owner', '/api/salon-retail')).body.products as any[]
    expect(sold.map((p) => [p.name, p.onHand]).sort()).toEqual([['Hair Mask', 1], ['Repair Shampoo', 3]])
    expect(sold.some((p) => 'costCents' in p || 'reorderAt' in p)).toBe(false)                                                // cost is for the people who keep the catalogue
    const manage = (await as('manager', '/api/salon-retail/manage')).body.products as any[]
    expect(manage.find((p) => p.id === shampoo)).toMatchObject({ costCents: 1500, reorderAt: 2, low: false, onHand: 3 })
  })

  test('selling puts a retail line on the sale with its tax and takes the units; a paid, void or gift-card sale refuses', async () => {
    const sale = await visitSale()
    const before = await invoiceOf(sale)
    expect(Number(before.total)).toBe(110)                                                                                    // $100 cut + 10% tax
    const out = await sell(sale, shampoo, 2)
    expect(out.status).toBe(200)
    expect(out.body.lines).toEqual([expect.objectContaining({ name: 'Olaplex Repair Shampoo', quantity: 2, totalCents: 6000 })])
    const lines = await linesOf(sale)
    expect(lines.filter((l) => l.type === 'retail')).toHaveLength(1)
    expect(lines.find((l) => l.type === 'retail')).toMatchObject({ description: 'Olaplex Repair Shampoo', quantity: '2.00', unitPrice: '30.00' })
    const after = await invoiceOf(sale)
    expect(Number(after.subtotal)).toBe(160)
    expect(Number(after.total)).toBe(176)                                                                                     // (100 + 60) + 10%
    expect(await onHand(shampoo)).toBe(1)
    expect(((await as('manager', '/api/salon-retail/manage')).body.products as any[]).find((p) => p.id === shampoo).low).toBe(true)   // 1 <= reorder level 2
    // Paid in full: closed to more retail ("start a new sale").
    expect((await as('owner', `/api/invoices/${sale}/payments`, 'POST', { amount: 176, method: 'cash' })).status).toBeLessThan(300)
    expect((await sell(sale, mask)).status).toBe(409)
    expect(await onHand(mask)).toBe(1)
    // A gift card sale holds only the card.
    await features([...FEATURES, 'salon_retail', 'salon_gift_cards'])
    const gift = (await as('owner', '/api/salon-gift-cards/sell', 'POST', { amountCents: 5000, method: 'cash' })).body.invoiceId
    expect((await sell(gift, mask)).status).toBe(409)
    expect((await sell('no-such-sale', mask)).status).toBe(404)
    expect((await as('owner', '/api/salon-retail/sell', 'POST', { items: [{ productId: mask, quantity: 1 }] })).status).toBe(400)  // which sale?
  })

  test('the last bottle is sold once: two desks at the same instant, one is told it is gone; nothing oversells', async () => {
    expect(await onHand(mask)).toBe(1)
    const a = await visitSale(), b = await visitSale()
    const [x, y] = await Promise.all([sell(a, mask), sell(b, mask, 1, 'manager')])
    expect([x.status, y.status].sort()).toEqual([200, 409])
    const loser = x.status === 409 ? x : y
    expect(loser.body.error ?? loser.body.message).toMatch(/out of stock/i)
    expect(await onHand(mask)).toBe(0)
    expect((await sell(a, mask)).status).toBe(409)
    // More than is there: told how many are.
    const c = await visitSale()
    const many = await sell(c, shampoo, 5)
    expect(many.status).toBe(409)
    expect(JSON.stringify(many.body)).toContain('Only 1')
    expect((await linesOf(c)).filter((l) => l.type === 'retail')).toHaveLength(0)                                             // refused whole: no line, no half-sale
    expect(await onHand(shampoo)).toBe(1)
    // Bad quantities.
    expect((await sell(c, shampoo, 0)).status).toBe(400)
    expect((await sell(c, shampoo, 1.5)).status).toBe(400)
    expect((await sell(c, shampoo, 100)).status).toBe(400)
  })

  test('taking a line off an unpaid sale, or voiding the sale, puts the units back; a paid sale cannot lose a line', async () => {
    const sale = await visitSale()
    expect((await sell(sale, shampoo, 1)).status).toBe(200)
    expect(await onHand(shampoo)).toBe(0)
    const line = (await linesOf(sale)).find((l) => l.type === 'retail')
    const removed = await as('owner', `/api/salon-retail/lines/${line.id}`, 'DELETE')
    expect(removed.status).toBe(200)
    expect(await onHand(shampoo)).toBe(1)
    expect(Number((await invoiceOf(sale)).total)).toBe(110)                                                                    // back to the cut and its tax
    expect((await as('owner', `/api/salon-retail/lines/${line.id}`, 'DELETE')).status).toBe(404)                              // already off
    // Void the sale: the units come back by themselves.
    expect((await sell(sale, shampoo, 1)).status).toBe(200)
    expect(await onHand(shampoo)).toBe(0)
    expect((await as('owner', `/api/invoices/${sale}/void`, 'POST', { reason: 'client left' })).status).toBeLessThan(300)
    expect(await onHand(shampoo)).toBe(1)
    // Paid: the line stays (refund the sale instead).
    const paid = await visitSale()
    expect((await sell(paid, shampoo, 1)).status).toBe(200)
    const paidLine = (await linesOf(paid)).find((l) => l.type === 'retail')
    expect((await as('owner', `/api/invoices/${paid}/payments`, 'POST', { amount: Number((await invoiceOf(paid)).total), method: 'cash' })).status).toBeLessThan(300)
    expect((await as('owner', `/api/salon-retail/lines/${paidLine.id}`, 'DELETE')).status).toBe(409)
    expect(await onHand(shampoo)).toBe(0)
  })

  test('a walk-in buys a bottle: a new sale at the salon\'s tax rate, for a client or none; the sale rights are needed to make one', async () => {
    const stock = await as('manager', `/api/salon-retail/products/${shampoo}/stock`, 'POST', { quantity: 5 })
    expect(stock.status).toBe(200)
    const walkIn = await as('manager', '/api/salon-retail/sell/new', 'POST', { items: [{ productId: shampoo, quantity: 2 }] })
    expect(walkIn.status).toBe(201)
    expect(walkIn.body).toMatchObject({ created: true, totalCents: 6600 })                                                       // 2 × $30 + 10%
    const inv = await invoiceOf(walkIn.body.invoiceId)
    expect(inv).toMatchObject({ status: 'open', contactId: null })
    expect(await onHand(shampoo)).toBe(3)
    const client = await ins(t.schema.contact, { companyId: co, name: 'Walk In', type: 'client' })
    const named = await as('owner', '/api/salon-retail/sell/new', 'POST', { contactId: client.id, items: [{ productId: shampoo, quantity: 1 }] })
    expect((await invoiceOf(named.body.invoiceId)).contactId).toBe(client.id)
    expect((await as('owner', '/api/salon-retail/sell/new', 'POST', { contactId: 'nobody', items: [{ productId: shampoo, quantity: 1 }] })).status).toBe(404)
    expect(await onHand(shampoo)).toBe(2)
  })

  test('stock received and corrected: who and why on every change; the count never goes below zero; a product taken off the shelf cannot be sold', async () => {
    expect((await as('manager', `/api/salon-retail/products/${shampoo}/stock`, 'POST', { quantity: -1 })).status).toBe(400)     // received is positive
    expect((await as('manager', `/api/salon-retail/products/${shampoo}/stock`, 'POST', { kind: 'adjust', quantity: -1 })).status).toBe(400)   // a correction says why
    expect((await as('manager', `/api/salon-retail/products/${shampoo}/stock`, 'POST', { kind: 'adjust', quantity: -3, note: 'count' })).status).toBe(409)   // only 2 there
    expect((await as('manager', `/api/salon-retail/products/${shampoo}/stock`, 'POST', { kind: 'adjust', quantity: -1, note: 'dropped one' })).status).toBe(200)
    expect(await onHand(shampoo)).toBe(1)
    const history = (await as('manager', `/api/salon-retail/products/${shampoo}/history`)).body
    expect(history.moves.find((m: any) => m.kind === 'adjust')).toMatchObject({ quantity: -1, note: 'dropped one', by: expect.stringContaining('manager') })
    expect(history.sales.length).toBeGreaterThan(0)
    expect(history.sales.some((s: any) => s.void)).toBe(true)
    // Off the shelf: not listed for the till, not sellable, still in the catalogue.
    expect((await as('manager', `/api/salon-retail/products/${mask}`, 'PATCH', { active: false })).status).toBe(200)
    expect(((await as('owner', '/api/salon-retail')).body.products as any[]).some((p) => p.id === mask)).toBe(false)
    expect(((await as('manager', '/api/salon-retail/manage')).body.products as any[]).some((p) => p.id === mask)).toBe(true)
    expect((await as('manager', `/api/salon-retail/products/${mask}/stock`, 'POST', { quantity: 4 })).status).toBe(200)
    expect((await sell(await visitSale(), mask)).status).toBe(404)
  })

  test('the stylist of the visit earns retail commission on the line, and the retail report counts it once the sale is paid', async () => {
    await features([...FEATURES, 'salon_retail', 'salon_commissions', 'salon_reports'])
    expect((await as('owner', '/api/commissions/plans', 'POST', { name: 'Retail 10', appliesToRole: 'technician', autoEarn: 'visit_stylist', planType: 'percent_of_invoice', percentRate: 10, salesKind: 'retail' })).status).toBeLessThan(300)
    const sale = await visitSale()
    expect((await sell(sale, shampoo, 1)).status).toBe(200)
    expect((await as('owner', `/api/invoices/${sale}/payments`, 'POST', { amount: Number((await invoiceOf(sale)).total), method: 'cash' })).status).toBeLessThan(300)
    let rows: any[] = []
    for (let i = 0; i < 40; i++) {
      rows = ((await as('owner', `/api/commissions?userId=${ana}`)).body.data as any[]).filter((r) => r.invoiceId === sale && r.status !== 'cancelled')
      if (rows.length) break
      await Bun.sleep(50)
    }
    expect(rows.map((r) => [r.baseAmount, r.commissionAmount])).toEqual([['30.00', '3.00']])
    const report = (await as('owner', '/api/salon-reports/retail')).body
    expect(report.byItem.find((i: any) => i.name === 'Olaplex Repair Shampoo')?.units).toBeGreaterThanOrEqual(1)
    expect(report.byStylist.find((s: any) => s.name === 'ana Tester')?.total).toBeGreaterThanOrEqual(30)
  })

  test('editing the lines on the general invoice form rewrites them: the units go back on the shelf instead of leaving a phantom sale', async () => {
    const sale = await visitSale()
    expect((await as('manager', `/api/salon-retail/products/${shampoo}/stock`, 'POST', { quantity: 2 })).status).toBe(200)
    const before = await onHand(shampoo)
    expect((await sell(sale, shampoo, 1)).status).toBe(200)
    expect(await onHand(shampoo)).toBe(before - 1)
    const edit = await as('owner', `/api/invoices/${sale}`, 'PUT', { lineItems: [{ description: 'Cut', quantity: 1, unitPrice: 100 }] })
    expect(edit.status).toBe(200)
    expect(await onHand(shampoo)).toBe(before)
  })
})

// Retail stock management (salon row 12; server crm/salon/retailStock.ts, retail.ts, commissions.ts, hidden feature `salon_retail`): the low-stock
// email when a product reaches its level and the Monday summary, suppliers and purchase orders (drafted from low stock, emailed, received line by
// line), barcode lookup, counts, transfers between places, units back on the shelf after a refund, a walk-in sale credited to a stylist (so retail
// commission is earned), and a retail line that survives the general invoice edit.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'invoices', 'salon_retail']
const PASSWORD = 'Retail-1031-xx'

describe('salon: retail stock management', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', ana = '', cut = ''
  const tokens: Record<string, string> = {}
  let ip = 0, hour = 7
  const mails: Array<{ to: string; subject: string; html: string }> = []
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}`, 'x-forwarded-for': `10.8.0.${++ip}` } })
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
  async function visitSale(stylist = ana) {
    const client = await ins(t.schema.contact, { companyId: co, name: `Client ${ip}`, email: `c${ip}-${hour}@example.com`, type: 'client' })
    hour += 1
    const made = await as('owner', '/api/appointments', 'POST', { contactId: client.id, startTime: wall(day, `${String(hour).padStart(2, '0')}:00`), serviceId: cut, stylistId: stylist })
    expect(made.status).toBe(201)
    expect((await as('owner', `/api/appointments/${made.body.id}`, 'PUT', { status: 'completed' })).status).toBe(200)
    const [inv] = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.appointmentId, made.body.id))
    return inv.id as string
  }
  const invoiceOf = async (id: string) => (await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, id)))[0]
  const linesOf = async (id: string) => (await t.db.select().from(t.schema.invoiceLineItem).where(eq(t.schema.invoiceLineItem.invoiceId, id))) as any[]
  const product = async (id: string) => ((await as('owner', '/api/salon-retail/manage')).body.products as any[]).find((p) => p.id === id)
  const onHand = async (id: string) => (await product(id))?.onHand
  const newProduct = async (b: Record<string, unknown>) => { const r = await as('owner', '/api/salon-retail/products', 'POST', { priceCents: 3000, ...b }); expect(r.status).toBe(201); return r.body.product.id as string }
  const jobs = () => (t.services.crm as any).retailStockJobs as { alertLow(c: string): Promise<{ sent: number; products: number }>; weeklySummary(c: string, now?: Date): Promise<string> }
  const waitMail = async (n: number) => { for (let i = 0; i < 100 && mails.length < n; i++) await Bun.sleep(20) }
  const quiet = async () => { await Bun.sleep(120) }
  const pay = (id: string, amount: number) => as('owner', `/api/invoices/${id}/payments`, 'POST', { amount, method: 'cash' })

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ, name: 'Glow Studio', settings: { defaultTaxRate: 0 } } as any).where(eq(t.schema.company.id, co))
    await features(FEATURES)
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    for (const [key, role] of [['ana', 'field'], ['manager', 'manager']] as const) {
      const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role, companyId: co })
      if (key === 'ana') ana = u.id
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${key}@test.example`, password: PASSWORD } })).json()) as any).accessToken
    }
    cut = (await as('owner', '/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 100 })).body.id
    ;(t.services.crm.emailService as any).sendRaw = async (m: any) => { mails.push({ to: m.to, subject: m.subject, html: m.html }) }
  }, 120_000)

  test('closed until the feature; the server decides who keeps suppliers, orders, counts and transfers', async () => {
    await features(FEATURES.filter((f) => f !== 'salon_retail'))
    expect((await as('owner', '/api/salon-retail-stock/suppliers')).status).not.toBe(200)
    await features(FEATURES)
    expect((await as('owner', '/api/salon-retail-stock/suppliers')).status).toBe(200)
    for (const [path, method, body] of [['/api/salon-retail-stock/suppliers', 'GET'], ['/api/salon-retail-stock/suppliers', 'POST', { name: 'x' }], ['/api/salon-retail-stock/orders', 'GET'], ['/api/salon-retail-stock/orders/from-low', 'POST', {}],
      ['/api/salon-retail-stock/transfers', 'POST', {}], ['/api/salon-retail-stock/count', 'POST', {}], ['/api/salon-retail-stock/low', 'GET'], ['/api/salon-retail-stock/scan?code=ABC123', 'GET']] as const) {
      expect([path, (await as('ana', path, method, body)).status]).toEqual([path, 403])
    }
  })

  test('product fields: category, barcode (one product each), reorder quantity and supplier are checked', async () => {
    const sup = await as('owner', '/api/salon-retail-stock/suppliers', 'POST', { name: 'Salon Wholesale', email: 'orders@wholesale.example', contactName: 'Pat' })
    expect(sup.status).toBe(201)
    expect((await as('owner', '/api/salon-retail-stock/suppliers', 'POST', { email: 'x@y.example' })).status).toBe(400)              // no name
    expect((await as('owner', '/api/salon-retail-stock/suppliers', 'POST', { name: 'Bad', email: 'not-an-email' })).status).toBe(400)
    const a = await as('owner', '/api/salon-retail/products', 'POST', { name: 'Gloss', brand: 'Aveda', priceCents: 2500, category: 'Styling', barcode: '0123456789012', reorderAt: 2, reorderQty: 6, supplierId: sup.body.supplier.id, openingStock: 5 })
    expect(a.status).toBe(201)
    expect([a.body.product.category, a.body.product.barcode, a.body.product.reorderQty, a.body.product.supplierId]).toEqual(['Styling', '0123456789012', 6, sup.body.supplier.id])
    expect((await as('owner', '/api/salon-retail/products', 'POST', { name: 'Twin', priceCents: 1000, barcode: '0123456789012' })).body.code).toBe('BARCODE_TAKEN')
    expect((await as('owner', '/api/salon-retail/products', 'POST', { name: 'Odd', priceCents: 1000, reorderQty: 0 })).status).toBe(400)
    expect((await as('owner', '/api/salon-retail/products', 'POST', { name: 'Odd', priceCents: 1000, supplierId: 'nope' })).status).toBe(404)
    expect((await as('owner', '/api/salon-retail/products', 'POST', { name: 'Odd', priceCents: 1000, barcode: 'ab' })).status).toBe(400)
    expect((await as('owner', `/api/salon-retail/products/${a.body.product.id}`, 'PATCH', { supplierId: 'someone-elses' })).status).toBe(404)
  })

  test('barcode lookup: the scanner\'s code finds the product by barcode or SKU, ignoring spaces and dashes; unknown codes say so', async () => {
    const id = await newProduct({ name: 'Mask', sku: 'MSK-100', barcode: '5012345678900', openingStock: 4 })
    const byCode = await as('manager', '/api/salon-retail-stock/scan?code=5012345678900')
    expect([byCode.status, byCode.body.product.id, byCode.body.product.onHand]).toEqual([200, id, 4])
    expect((await as('manager', '/api/salon-retail-stock/scan?code=msk%20100')).body.product.id).toBe(id)                // SKU, loosely typed
    expect((await as('manager', '/api/salon-retail-stock/scan?code=5012345678901')).body.code).toBe('NO_PRODUCT')
    expect((await as('manager', '/api/salon-retail-stock/scan?code=1')).status).toBe(400)
    // the front desk (retail:sell, no inventory right) can scan at the till
    expect((await as('owner', '/api/salon-retail-stock/scan?code=MSK100')).status).toBe(200)
  })

  test('low stock: ONE email each time a product reaches its level — not again while it stays low, again after it recovers', async () => {
    mails.length = 0
    const sup = (await as('owner', '/api/salon-retail-stock/suppliers')).body.suppliers[0].id
    const id = await newProduct({ name: 'Serum', brand: 'Kerastase', reorderAt: 2, reorderQty: 5, supplierId: sup, openingStock: 4 })
    await quiet(); expect(mails).toHaveLength(0)                                                          // 4 on hand, level 2
    const sale = await visitSale()
    expect((await as('owner', '/api/salon-retail/sell', 'POST', { invoiceId: sale, items: [{ productId: id, quantity: 2 }] })).status).toBe(200)   // 2 left = at the level
    await waitMail(2)
    const to = mails.map((m) => m.to).sort()
    expect(to).toEqual(['manager@test.example', 'owner@test.example'])                                    // the people who run the salon
    expect(mails[0].subject).toBe('Low stock: Kerastase Serum')
    expect(mails[0].html).toContain('2 left')
    expect(mails[0].html).toContain('reorder at 2')
    expect(mails[0].html).toContain('Salon Wholesale')
    // still low: another unit sold, a timed pass, a second sale — no second email
    const sale2 = await visitSale()
    await as('owner', '/api/salon-retail/sell', 'POST', { invoiceId: sale2, items: [{ productId: id, quantity: 1 }] })
    await quiet(); await jobs().alertLow(co); await quiet()
    expect(mails).toHaveLength(2)
    // stock arrives above the level, then it falls again: a new email
    expect((await as('owner', `/api/salon-retail/products/${id}/stock`, 'POST', { kind: 'received', quantity: 10 })).status).toBe(200)
    await quiet(); expect(mails).toHaveLength(2)
    const sale3 = await visitSale()
    await as('owner', '/api/salon-retail/sell', 'POST', { invoiceId: sale3, items: [{ productId: id, quantity: 10 }] })
    await waitMail(4)
    expect(mails).toHaveLength(4)
    // a product with no level is never listed; the low list answers the same question
    const low = (await as('manager', '/api/salon-retail-stock/low')).body
    expect(low.products.map((p: any) => p.name)).toContain('Serum')
    expect(low.products.map((p: any) => p.name)).not.toContain('Mask')
  })

  test('Monday summary: the owner only, from 9 am Monday on the shop\'s clock, once a week', async () => {
    mails.length = 0
    const monday = (hm: string) => new Date(`2026-11-02T${hm}:00Z`)                       // Monday 2 Nov 2026; Chicago is UTC-6 then
    expect(await jobs().weeklySummary(co, monday('14:59'))).toBe('too_early')              // 8:59 am
    expect(await jobs().weeklySummary(co, new Date('2026-11-03T16:00:00Z'))).toBe('not_monday')
    expect(mails).toHaveLength(0)
    expect(await jobs().weeklySummary(co, monday('15:00'))).toBe('sent')                   // 9:00 am
    expect(mails.map((m) => m.to)).toEqual(['owner@test.example'])
    expect(mails[0].subject).toContain('weekly retail stock summary')
    expect(mails[0].html).toContain('Serum')
    expect(mails[0].html).toContain('worth')
    expect(await jobs().weeklySummary(co, monday('18:00'))).toBe('already_sent')
    expect(mails).toHaveLength(1)
    expect(await jobs().weeklySummary(co, new Date('2026-11-09T16:00:00Z'))).toBe('sent')   // next Monday
    await features(FEATURES.filter((f) => f !== 'salon_retail'))
    expect(await jobs().weeklySummary(co, new Date('2026-11-16T16:00:00Z'))).toBe('off')
    await features(FEATURES)
  })

  test('purchase orders: drafted from low stock by supplier, edited, emailed, received part now and the rest later; cost follows the delivery', async () => {
    const sup2 = (await as('owner', '/api/salon-retail-stock/suppliers', 'POST', { name: 'No Email Co' })).body.supplier.id
    const supId = (await as('owner', '/api/salon-retail-stock/suppliers')).body.suppliers.find((s: any) => s.name === 'Salon Wholesale').id
    const lowA = await newProduct({ name: 'PO Spray', reorderAt: 3, reorderQty: 8, supplierId: supId, costCents: 900, openingStock: 1 })
    const lowB = await newProduct({ name: 'PO Oil', reorderAt: 3, supplierId: supId, costCents: 1100, openingStock: 0 })       // no reorder quantity: enough to get above the level
    const lowC = await newProduct({ name: 'PO Brush', reorderAt: 3, reorderQty: 2, supplierId: sup2, openingStock: 1 })
    const noSup = await newProduct({ name: 'PO Orphan', reorderAt: 3, openingStock: 0 })
    const made = await as('owner', '/api/salon-retail-stock/orders/from-low', 'POST', { productIds: [lowA, lowB, lowC, noSup] })
    expect(made.status).toBe(201)
    expect(made.body.unassigned).toEqual(['PO Orphan'])
    expect(made.body.orders).toHaveLength(2)                                                                  // one per supplier
    const po = made.body.orders.find((o: any) => o.supplier.name === 'Salon Wholesale')
    expect(po.status).toBe('draft')
    expect(po.number).toMatch(/^PO-\d{4}$/)
    const qty = Object.fromEntries(po.lines.map((l: any) => [l.name, l.quantity]))
    expect(qty).toEqual({ 'PO Oil': 4, 'PO Spray': 8 })                                                     // 8 = its reorder quantity; 4 = back above the level (3 - 0 + 1)
    // asking again does not double up: everything is already on a draft
    const again = await as('owner', '/api/salon-retail-stock/orders/from-low', 'POST', { productIds: [lowA, lowB] })
    expect(again.body.code).toBe('NOTHING_TO_ORDER')
    // an order to a supplier with no email cannot be sent; the draft stays
    const noMail = made.body.orders.find((o: any) => o.supplier.name === 'No Email Co')
    expect((await as('owner', `/api/salon-retail-stock/orders/${noMail.id}/send`, 'POST', {})).body.code).toBe('NO_SUPPLIER_EMAIL')
    // edit the draft
    const spray = po.lines.find((l: any) => l.name === 'PO Spray')
    const edit = await as('owner', `/api/salon-retail-stock/orders/${po.id}`, 'PATCH', { note: 'Deliver to the back door', lines: [{ productId: lowA, quantity: 10, unitCostCents: 950 }, { productId: lowB, quantity: 0 }] })
    expect(edit.status).toBe(200)
    expect(edit.body.order.lines.map((l: any) => [l.name, l.quantity, l.unitCostCents])).toEqual([['PO Spray', 10, 950]])
    expect((await as('owner', `/api/salon-retail-stock/orders/${po.id}/receive`, 'POST', { lines: [{ lineId: spray.id, quantity: 1 }] })).body.code).toBe('NOT_SENT')
    // send: emailed to the supplier with the lines
    mails.length = 0
    const sent = await as('owner', `/api/salon-retail-stock/orders/${po.id}/send`, 'POST', {})
    expect([sent.status, sent.body.order.status, sent.body.order.sentTo]).toEqual([200, 'sent', 'orders@wholesale.example'])
    expect(mails.filter((m) => m.to === 'orders@wholesale.example')).toHaveLength(1)
    expect(mails.find((m) => m.to === 'orders@wholesale.example')!.html).toContain('PO Spray')
    expect(mails.find((m) => m.to === 'orders@wholesale.example')!.html).toContain('Deliver to the back door')
    expect((await as('owner', `/api/salon-retail-stock/orders/${po.id}/send`, 'POST', {})).body.code).toBe('NOT_DRAFT')
    expect((await as('owner', `/api/salon-retail-stock/orders/${po.id}`, 'PATCH', { note: 'late' })).body.code).toBe('NOT_DRAFT')
    // receive 4 of 10 now
    const before = await onHand(lowA)
    const part = await as('owner', `/api/salon-retail-stock/orders/${po.id}/receive`, 'POST', { lines: [{ lineId: spray.id, quantity: 4, unitCostCents: 975 }] })
    expect([part.status, part.body.order.status, part.body.order.lines[0].received]).toEqual([200, 'partial', 4])
    expect(await onHand(lowA)).toBe(before + 4)
    expect((await product(lowA)).costCents).toBe(975)                                                       // the delivery's cost is the product's cost
    expect((await as('owner', `/api/salon-retail-stock/orders/${po.id}/receive`, 'POST', { lines: [{ lineId: spray.id, quantity: 7 }] })).body.code).toBe('OVER_RECEIVE')
    expect(await onHand(lowA)).toBe(before + 4)                                                              // a refused delivery moved nothing
    expect((await as('owner', `/api/salon-retail-stock/orders/${po.id}/cancel`, 'POST', {})).body.code).toBe('PART_RECEIVED')
    const rest = await as('owner', `/api/salon-retail-stock/orders/${po.id}/receive`, 'POST', { lines: [{ lineId: spray.id, quantity: 6 }] })
    expect([rest.body.order.status, await onHand(lowA)]).toEqual(['received', before + 10])
    expect((await as('owner', `/api/salon-retail-stock/orders/${po.id}/receive`, 'POST', { lines: [{ lineId: spray.id, quantity: 1 }] })).body.code).toBe('ALREADY_RECEIVED')
    const history = (await as('owner', `/api/salon-retail/products/${lowA}/history`)).body
    expect(history.moves.filter((m: any) => m.note === `Received on ${po.number}`).map((m: any) => m.quantity).sort()).toEqual([4, 6])
    // an untouched draft can be cancelled
    expect((await as('owner', `/api/salon-retail-stock/orders/${noMail.id}/cancel`, 'POST', {})).body.order.status).toBe('cancelled')
  })

  test('counts and transfers: a count writes the difference; stock moves between places; a sale comes off the place it names', async () => {
    const id = await newProduct({ name: 'Shared Toner', openingStock: 6 })
    const places = (await as('owner', '/api/salon-retail-stock/locations')).body.locations
    expect(places.map((p: any) => p.name)).toEqual(['Main shop'])
    const back = await as('owner', '/api/salon-retail-stock/locations', 'POST', { name: 'Second chair room' })
    expect(back.status).toBe(201)
    expect((await as('owner', '/api/salon-retail-stock/locations', 'POST', { name: 'second chair ROOM' })).status).toBe(409)
    const main = places[0].id, room = back.body.location.id
    // a count: counted 5, the system said 6 -> a correction of -1 that says so
    const counted = await as('manager', '/api/salon-retail-stock/count', 'POST', { counts: [{ productId: id, counted: 5 }] })
    expect(counted.body.changed).toEqual([{ productId: id, was: 6, now: 5 }])
    expect((await as('manager', `/api/salon-retail/products/${id}/history`)).body.moves.find((m: any) => m.kind === 'adjust').note).toContain('counted 5, system said 6')
    expect((await as('manager', '/api/salon-retail-stock/count', 'POST', { counts: [{ productId: id, counted: 5 }] })).body.changed).toEqual([])          // nothing differs, nothing written
    expect((await as('manager', '/api/salon-retail-stock/count', 'POST', { counts: [{ productId: id, counted: -1 }] })).status).toBe(400)
    // transfer 3 to the second place
    expect((await as('manager', '/api/salon-retail-stock/transfers', 'POST', { productId: id, fromLocationId: main, toLocationId: main, quantity: 1 })).body.code).toBe('SAME_PLACE')
    expect((await as('manager', '/api/salon-retail-stock/transfers', 'POST', { productId: id, fromLocationId: main, toLocationId: room, quantity: 9 })).body.code).toBe('BELOW_ZERO')
    expect((await as('manager', '/api/salon-retail-stock/transfers', 'POST', { productId: id, fromLocationId: main, toLocationId: 'nowhere', quantity: 1 })).status).toBe(404)
    const moved = await as('manager', '/api/salon-retail-stock/transfers', 'POST', { productId: id, fromLocationId: main, toLocationId: room, quantity: 3, note: 'Second room opens' })
    expect(moved.status).toBe(201)
    const byPlace = (await as('manager', '/api/salon-retail-stock/by-place')).body.stock[id]
    expect(Object.fromEntries(byPlace.map((p: any) => [p.name, p.onHand]))).toEqual({ 'Main shop': 2, 'Second chair room': 3 })
    expect(await onHand(id)).toBe(5)                                                                          // a transfer changes where, not how many
    // selling from the second place: only what is there
    const sale = await visitSale()
    const over = await as('owner', '/api/salon-retail/sell', 'POST', { invoiceId: sale, locationId: room, items: [{ productId: id, quantity: 4 }] })
    expect(over.body.code).toBe('OUT_OF_STOCK')
    expect((await as('owner', '/api/salon-retail/sell', 'POST', { invoiceId: sale, locationId: room, items: [{ productId: id, quantity: 3 }] })).status).toBe(200)
    const after = (await as('manager', '/api/salon-retail-stock/by-place')).body.stock[id]
    expect(Object.fromEntries(after.map((p: any) => [p.name, p.onHand]))).toEqual({ 'Main shop': 2 })       // the room is empty now
    expect(await onHand(id)).toBe(2)
    // a void sale gives them back to the room it took them from
    expect((await as('owner', `/api/invoices/${sale}/void`, 'POST', { reason: 'client left' })).status).toBeLessThan(300)
    expect(Object.fromEntries(((await as('manager', '/api/salon-retail-stock/by-place')).body.stock[id]).map((p: any) => [p.name, p.onHand]))).toEqual({ 'Main shop': 2, 'Second chair room': 3 })
  })

  test('after a refund the person chooses whether units go back on the shelf — never more than were sold, never before a refund', async () => {
    const id = await newProduct({ name: 'Returnable Balm', priceCents: 2000, openingStock: 5 })
    const sale = await visitSale()
    await as('owner', '/api/salon-retail/sell', 'POST', { invoiceId: sale, items: [{ productId: id, quantity: 2 }] })
    expect(await onHand(id)).toBe(3)
    expect((await as('owner', `/api/salon-retail-stock/sales/${sale}/return-to-shelf`, 'POST', { items: [{ productId: id, quantity: 1 }] })).body.code).toBe('NOT_REFUNDED')
    expect((await pay(sale, Number((await invoiceOf(sale)).total))).status).toBeLessThan(300)
    expect((await as('owner', `/api/invoices/${sale}/refund`, 'POST', { amount: 20, method: 'cash', notes: 'one balm came back' })).status).toBeLessThan(300)
    expect(await onHand(id)).toBe(3)                                                                          // a refund alone does not put units back
    const view = (await as('owner', `/api/salon-retail-stock/sales/${sale}/retail`)).body
    expect([view.refunded, view.lines[0].sold, view.lines[0].canReturn]).toEqual([true, 2, 2])
    expect((await as('ana', `/api/salon-retail-stock/sales/${sale}/return-to-shelf`, 'POST', { items: [{ productId: id, quantity: 1 }] })).status).toBe(403)
    const back = await as('owner', `/api/salon-retail-stock/sales/${sale}/return-to-shelf`, 'POST', { items: [{ productId: id, quantity: 1 }] })
    expect([back.status, back.body.lines[0].returned, back.body.lines[0].canReturn]).toEqual([200, 1, 1])
    expect(await onHand(id)).toBe(4)
    expect((await as('owner', `/api/salon-retail-stock/sales/${sale}/return-to-shelf`, 'POST', { items: [{ productId: id, quantity: 2 }] })).body.code).toBe('OVER_RETURN')
    expect((await as('owner', `/api/salon-retail-stock/sales/${sale}/return-to-shelf`, 'POST', { items: [{ productId: 'other', quantity: 1 }] })).status).toBe(404)
    expect(await onHand(id)).toBe(4)
    expect((await as('owner', `/api/salon-retail-stock/sales/${sale}/return-to-shelf`, 'POST', { items: [{ productId: id, quantity: 1 }] })).status).toBe(200)
    expect(await onHand(id)).toBe(5)
    expect((await as('owner', `/api/salon-retail-stock/sales/${sale}/return-to-shelf`, 'POST', { items: [{ productId: id, quantity: 1 }] })).body.code).toBe('OVER_RETURN')
  })

  test('a walk-in retail sale names a stylist, so retail commission is earned for that stylist', async () => {
    await features([...FEATURES, 'salon_commissions'])
    const plan = await as('owner', '/api/commissions/plans', 'POST', { name: 'Retail 10', planType: 'percent_of_invoice', percentRate: 10, salesKind: 'retail', appliesToRole: 'technician', autoEarn: 'visit_stylist' })
    expect(plan.status).toBe(201)
    const id = await newProduct({ name: 'Walk-in Wax', priceCents: 2000, openingStock: 5 })
    expect((await as('owner', '/api/salon-retail/sell/new', 'POST', { items: [{ productId: id, quantity: 1 }], stylistId: 'nobody' })).status).toBe(404)
    expect(await onHand(id)).toBe(5)                                                                          // refused: nothing left behind
    const sold = await as('owner', '/api/salon-retail/sell/new', 'POST', { items: [{ productId: id, quantity: 2 }], stylistId: ana })
    expect(sold.status).toBe(201)
    const [row] = await t.db.select().from(t.schema.salonRetailSale).where(eq(t.schema.salonRetailSale.invoiceId, sold.body.invoiceId))
    expect(row.stylistId).toBe(ana)
    expect((await pay(sold.body.invoiceId, Number((await invoiceOf(sold.body.invoiceId)).total))).status).toBeLessThan(300)
    for (let i = 0; i < 50; i++) { const c = await t.db.select().from(t.schema.commission).where(eq(t.schema.commission.invoiceId, sold.body.invoiceId)); if (c.length) break; await Bun.sleep(40) }
    const earned = await t.db.select().from(t.schema.commission).where(eq(t.schema.commission.invoiceId, sold.body.invoiceId))
    expect(earned.map((c: any) => [c.userId, Number(c.baseAmount), Number(c.commissionAmount)])).toEqual([[ana, 40, 4]])
    // a walk-in sale that names nobody earns nobody
    const anon = await as('owner', '/api/salon-retail/sell/new', 'POST', { items: [{ productId: id, quantity: 1 }] })
    await pay(anon.body.invoiceId, Number((await invoiceOf(anon.body.invoiceId)).total)); await quiet()
    expect(await t.db.select().from(t.schema.commission).where(eq(t.schema.commission.invoiceId, anon.body.invoiceId))).toHaveLength(0)
    await features(FEATURES)
  })

  test('editing a sale in the general invoice form keeps its retail product links (type, units, shelf count); a units change is checked against the shelf', async () => {
    const id = await newProduct({ name: 'Edit Gel', priceCents: 1500, openingStock: 3 })
    const sale = await visitSale()
    await as('owner', '/api/salon-retail/sell', 'POST', { invoiceId: sale, items: [{ productId: id, quantity: 1 }] })
    const lines = (await linesOf(sale)).sort((a, b) => a.sortOrder - b.sortOrder)
    const form = (retailQty: number) => lines.map((l) => ({ description: l.description, quantity: l.type === 'retail' ? retailQty : Number(l.quantity), unitPrice: Number(l.unitPrice) }))
    // an edit that leaves the product alone (a service price change) keeps the link and the count
    const edited = await as('owner', `/api/invoices/${sale}`, 'PUT', { lineItems: form(1).map((l, i) => (i === 0 ? { ...l, unitPrice: 90 } : l)) })
    expect(edited.status).toBe(200)
    const after = await linesOf(sale)
    expect(after.find((l) => l.description.includes('Edit Gel')).type).toBe('retail')
    const links = await t.db.select().from(t.schema.salonRetailSale).where(eq(t.schema.salonRetailSale.invoiceId, sale))
    expect(links.map((l: any) => [l.productId, l.quantity])).toEqual([[id, 1]])
    expect(await onHand(id)).toBe(2)
    // more units: taken from the shelf
    expect((await as('owner', `/api/invoices/${sale}`, 'PUT', { lineItems: form(2) })).status).toBe(200)
    expect(await onHand(id)).toBe(1)
    // more than the shelf has: refused, and the sale is exactly as it was
    const refused = await as('owner', `/api/invoices/${sale}`, 'PUT', { lineItems: form(9) })
    expect(refused.status).toBe(409)
    expect(refused.body.error).toContain('on the shelf')
    expect(await onHand(id)).toBe(1)
    expect(Number((await linesOf(sale)).find((l) => l.description.includes('Edit Gel')).quantity)).toBe(2)
    // taking the product out in the form gives its units back
    expect((await as('owner', `/api/invoices/${sale}`, 'PUT', { lineItems: form(2).filter((l) => !l.description.includes('Edit Gel')) })).status).toBe(200)
    expect(await onHand(id)).toBe(3)
    expect(await t.db.select().from(t.schema.salonRetailSale).where(eq(t.schema.salonRetailSale.invoiceId, sale))).toHaveLength(0)
  })
})

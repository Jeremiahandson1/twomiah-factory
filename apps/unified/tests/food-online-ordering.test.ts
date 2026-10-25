// Online ordering for pickup (crm/bar/barOrders.ts, barFoodPublicRoutes.ts, site /order): the website's menu and cart,
// taken only while the kitchen is open (less the lead time) and not paused, priced on the server, paid on a Stripe
// Checkout page on the business's own account; a paid order — and only a paid one — is a check and one grill ticket,
// the guest told "Order received" then and "Ready for pickup" when staff mark it ready (a text only where they asked
// for texts and have not opted out, else email). Stripe as documented, answered in tests/foodKit.ts.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'

let k: Awaited<ReturnType<typeof bootFood>>
let items: Awaited<ReturnType<typeof k.menu>>
const FEATURES = ['contacts', 'bar_menu', 'bar_register', 'bar_tonight', 'online_ordering']
const tickets = async () => (await k.B('GET', '/api/grill/state')).json.open as Array<{ id: string; label: string; source: string }>
const kitchen = (open: boolean) => k.M('PUT', '/api/bar/tonight', { kitchenOpen: open, kitchenClosesAt: open ? new Date(Date.now() + 4 * 3600_000).toISOString() : null })
const ordering = () => k.pub('GET', '/api/public/food/ordering')
const place = (b: Record<string, unknown>) => k.pub('POST', '/api/public/food/orders', b)

beforeAll(async () => {
  k = await bootFood({ features: FEATURES })
  await (k.t.db as any).update(k.S.company).set({ settings: { defaultTaxRate: 5.5 } }).where(eq(k.S.company.id, k.companyId))
  items = await k.menu()
  expect((await kitchen(true)).status).toBe(200)
}, 60_000)
afterAll(() => k.restore())

describe('when the website takes orders', () => {
  test('only with the business Stripe account connected, not paused, and the kitchen open', async () => {
    await (k.t.db as any).update(k.S.company).set({ integrations: {} }).where(eq(k.S.company.id, k.companyId))
    expect((await ordering()).json).toMatchObject({ offered: true, open: false, reason: 'Online ordering is not set up yet. Call us or come in to order.' })
    await (k.t.db as any).update(k.S.company).set({ integrations: { stripeAccountId: 'acct_biz' } }).where(eq(k.S.company.id, k.companyId))
    const a = (await ordering()).json
    expect(a.open).toBe(true)
    expect(a.slots[0].label).toMatch(/^As soon as possible \(about \d{1,2}:\d{2} [AP]M\)$/)
    // The soonest pickup is the lead time (20 minutes) away, at least.
    expect(new Date(a.slots[0].at).getTime() - Date.now()).toBeGreaterThanOrEqual(20 * 60_000 - 1000)
    expect(a.menu.flatMap((s: any) => s.items).map((i: any) => i.name).sort()).toEqual(['Burger', 'Soda'])
    // A bartender may not pause it; a manager does, and the website says so.
    expect((await k.B('PUT', '/api/food/settings', { ordering: { paused: true } })).status).toBe(403)
    expect((await k.M('PUT', '/api/food/settings', { ordering: { paused: true } })).status).toBe(200)
    expect((await ordering()).json.reason).toBe('We are not taking online orders right now. Call us or come in to order.')
    expect((await place({ name: 'Pat', phone: '7155550199', lines: [{ menuItemId: items.soda.id }] })).status).toBe(409)
    expect((await k.M('PUT', '/api/food/settings', { ordering: { paused: false } })).status).toBe(200)
    await kitchen(false)
    expect((await ordering()).json.open).toBe(false)
    await kitchen(true)
  })
})

describe('an order', () => {
  let sessionId = ''
  let orderId = ''

  test('is checked and priced on the server; the Checkout page is on the business account', async () => {
    const slot = (await ordering()).json.slots[1].at
    expect((await place({ phone: '7155550199', lines: [{ menuItemId: items.soda.id }] })).status).toBe(400)
    expect((await place({ name: 'Pat', lines: [{ menuItemId: items.soda.id }] })).status).toBe(400)
    expect((await place({ name: 'Pat', phone: '7155550199', pickupAt: '2020-01-01T00:00:00.000Z', lines: [{ menuItemId: items.soda.id }] })).status).toBe(409)
    const r = await place({ name: 'Pat', phone: '715-555-0199', smsConsent: true, pickupAt: slot, lines: [{ menuItemId: items.burger.id, modifierIds: ['modbacon01'], qty: 2, unitPriceCents: 1 }] })
    expect(r.status).toBe(200)
    expect(r.json.url).toMatch(/^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_/)
    orderId = r.json.orderId
    const s = k.stripe.posts('/v1/checkout/sessions').at(-1)!
    expect(s.account).toBe('acct_biz')
    // 2 × ($12.00 + $2.00) = $28.00, tax 5.5% = $1.54.
    expect([s.params.get('line_items[0][quantity]'), s.params.get('line_items[0][price_data][unit_amount]'), s.params.get('line_items[1][price_data][unit_amount]'), s.params.get('line_items[1][price_data][product_data][name]')]).toEqual(['2', '1400', '154', 'Sales tax'])
    expect(s.params.get('success_url')).toBe('https://bar.test/order/done?session_id={CHECKOUT_SESSION_ID}')
    sessionId = [...k.stripe.sessions.keys()].at(-1)!
    // "Text me about my order": the consent is kept.
    const consent = await (k.t.db as any).select().from(k.S.smsConsent).where(and(eq(k.S.smsConsent.companyId, k.companyId), eq(k.S.smsConsent.phone, '+17155550199')))
    expect(consent.length).toBe(1)
    expect(consent[0].wording).toContain('Text me about my order.')
  })

  test('unpaid, it is nothing: no check, no ticket', async () => {
    const c = await k.pub('GET', `/api/public/food/orders/confirm?session_id=${sessionId}`)
    expect(c.json.order.status).toBe('awaiting_payment')
    expect(await tickets()).toEqual([])
    expect((await k.B('GET', '/api/food/orders')).json.orders).toEqual([])
  })

  test('paid: one check, one grill ticket "Online · Pat", "Order received" by text — once', async () => {
    k.stripe.paySession(sessionId)
    const before = k.texts.length
    const c = await k.pub('GET', `/api/public/food/orders/confirm?session_id=${sessionId}`)
    expect(c.json.order).toMatchObject({ status: 'received', name: 'Pat', totalCents: 2954 })
    expect(c.json.order.number).toBeGreaterThan(0)
    const t = await tickets()
    expect(t.map((x) => [x.label, x.source])).toEqual([['Online · Pat', 'web']])
    const o = (await k.B('GET', '/api/food/orders')).json.orders[0]
    const check = (await k.B('GET', `/api/register/check/${o.checkId}`)).json.check
    expect([check.status, check.kind, check.payments.length, check.payments[0].tender, check.payments[0].amountCents]).toEqual(['paid', 'online', 1, 'card_online', 2954])
    expect(k.texts.length).toBe(before + 1)
    expect(k.texts.at(-1)!.to).toBe('715-555-0199')
    expect(k.texts.at(-1)!.message).toMatch(new RegExp(`^Test Builders: thanks, Pat! Order #${o.number} is in for pickup about \\d{1,2}:\\d{2} [AP]M\\. We will tell you when it is ready\\. Reply STOP to opt out\\.$`))
    // Back again (a refresh): nothing twice.
    await k.pub('GET', `/api/public/food/orders/confirm?session_id=${sessionId}`)
    expect((await k.B('GET', `/api/register/check/${o.checkId}`)).json.check.payments.length).toBe(1)
    expect(k.texts.length).toBe(before + 1)
  })

  test('staff mark it ready (the guest is told), then picked up', async () => {
    const before = k.texts.length
    const r = await k.B('POST', `/api/food/orders/${orderId}/ready`)
    expect(r.json.order.status).toBe('ready')
    expect(k.texts.length).toBe(before + 1)
    expect(k.texts.at(-1)!.message).toContain('is ready for pickup at 214 Water St.')
    expect((await k.B('POST', `/api/food/orders/${orderId}/ready`)).status).toBe(409)
    expect((await k.B('POST', `/api/food/orders/${orderId}/collected`)).json.order.status).toBe('collected')
    // Picked up is the end: it cannot be made "ready" again (and the guest texted twice).
    expect((await k.B('POST', `/api/food/orders/${orderId}/ready`)).status).toBe(409)
  })

  test('a guest who paid and never came back is found from the Orders screen; told by email when texts are not theirs', async () => {
    const r = await place({ name: 'Sam', email: 'sam@example.com', phone: '7155550111', lines: [{ menuItemId: items.soda.id }] })
    const sid = [...k.stripe.sessions.keys()].at(-1)!
    k.stripe.paySession(sid)
    const mailsBefore = k.mails.length, textsBefore = k.texts.length
    // The sweep runs at most every 20 seconds; the grill's look above was recent, so let it pass.
    await new Promise((res) => setTimeout(res, 20_500))
    const list = (await k.B('GET', '/api/food/orders')).json.orders
    expect(list.find((o: any) => o.id === r.json.orderId).status).toBe('received')
    // Sam did not tick "Text me": an email, no text.
    expect(k.texts.length).toBe(textsBefore)
    expect(k.mails.length).toBe(mailsBefore + 1)
    expect(k.mails.at(-1)!.to).toBe('sam@example.com')
    expect(k.mails.at(-1)!.subject).toMatch(/^Order #\d+ received — Test Builders$/)
  }, 60_000)

  test('a number that said STOP is not texted "ready"', async () => {
    const r = await place({ name: 'Lee', phone: '7155550122', email: 'lee@example.com', smsConsent: true, lines: [{ menuItemId: items.soda.id }] })
    const sid = [...k.stripe.sessions.keys()].at(-1)!
    k.stripe.paySession(sid)
    await k.pub('GET', `/api/public/food/orders/confirm?session_id=${sid}`)
    // STOP withdraws the consent (site/smsConsent.ts withdrawConsent).
    await (k.t.db as any).delete(k.S.smsConsent).where(and(eq(k.S.smsConsent.companyId, k.companyId), eq(k.S.smsConsent.phone, '+17155550122')))
    const textsBefore = k.texts.length
    await k.B('POST', `/api/food/orders/${r.json.orderId}/ready`)
    expect(k.texts.length).toBe(textsBefore)
    expect(k.mails.at(-1)!.subject).toMatch(/is ready for pickup/)
  })

  test('the website has the Order page and nav item; with the feature off there is neither', async () => {
    const page = await k.pub('GET', '/order')
    expect(page.status).toBe(200)
    expect(page.text).toContain('id="order-root"')
    expect(page.text).toContain('<script src="/scripts/order.js" defer></script>')
    expect(page.text).toContain('href="/order"')
    expect((await k.pub('GET', '/scripts/order.js')).text).toContain('/api/public/food/orders')
    await k.features(['contacts', 'bar_menu', 'bar_register', 'bar_tonight'])
    expect((await k.pub('GET', '/order')).status).toBe(404)
    expect((await place({ name: 'Pat', phone: '7155550199', lines: [{ menuItemId: items.soda.id }] })).status).toBe(404)
    expect((await k.B('GET', '/api/food/orders')).status).toBe(403)
    await k.features(FEATURES)
  })
})

// Gap 7 against Shopify's customer accounts (2026-10-30): shoppers sign in (an emailed link or a six-digit code — no
// password), see their own orders, keep addresses, order again, and a wholesale customer is charged their group's
// prices — all behind store_accounts (registered not ready), against the real server.
//   · SEPARATE FROM STAFF: its own cookie; a staff token does not open it and its cookie opens nothing of the staff's;
//   · NO LIST OF CUSTOMERS: asking to sign in answers the same words for a known email and an unknown one;
//   · the link is used by pressing Sign in (a POST), once; the code gets five tries — simultaneous guesses included —
//     and a newer sign-in cancels the older; both expire;
//   · a shopper reads only their own orders (another's is 404, whatever its id); a change must be JSON from the shop's
//     own pages;
//   · the group's prices are charged at checkout to the signed-in shopper — never to a guest who types the email — and
//     the shopper's saved address opens the payment page filled in.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootStore } from './storeKit.ts'
import { FEATURE_MAP, getDefaultFeaturesForTemplate } from '@twomiah/tenant-backend'
import { MAX_ADDRESSES, MAX_CODE_TRIES, MAX_SIGNINS_PER_HOUR } from '../server/crm/store/accounts/shopperAccounts.ts'
import { SIGN_IN_SENT } from '../server/crm/store/accounts/routes.ts'

let k: Awaited<ReturnType<typeof bootStore>>
const A = '/api/public/account'
const db = () => k.t.db as any
const ON = ['dashboard', 'orders', 'products', 'contacts', 'store_accounts']
const features = async (list: string[]) => {
  await db().update(k.S.company).set({ enabledFeatures: list }).where(eq(k.S.company.id, k.companyId))
  k.t.services.features.forgetFeatures()
}
let mug: any
let gone: any
let ann: any
let bob: any
let annOrder: any
let bobOrder: any
let seq = 0

async function order(who: any, o: { number: string; status?: string; lines: Array<[any, number, number]>; paymentIntent?: string }) {
  const subtotal = o.lines.reduce((n, [, q, p]) => n + q * p, 0)
  const [row] = await db().insert(k.S.storeOrder).values({
    companyId: k.companyId, contactId: who.id, orderNumber: o.number, provider: 'stripe', providerSessionId: `cs_acct_${++seq}`, providerPaymentId: o.paymentIntent ?? `pi_${o.number}`,
    status: o.status ?? 'paid', customerEmail: who.email, customerName: who.name, subtotalCents: subtotal, totalCents: subtotal, internalNote: 'staff only note', recoveryToken: 'secret-token', trackingNumber: o.status === 'shipped' ? '1Z999' : null, trackingCarrier: o.status === 'shipped' ? 'UPS' : null,
  }).returning()
  for (const [p, qty, price] of o.lines) {
    await db().insert(k.S.storeOrderItem).values({ orderId: row.id, productId: p.product.id, variantId: p.variant.id, productName: p.product.name, variantName: 'Default', sku: p.variant.sku, unitPriceCents: price, quantity: qty, lineTotalCents: qty * price })
  }
  return row
}
const mailsTo = (email: string) => k.mails.filter((m) => m.to.toLowerCase() === email.toLowerCase() && m.template === 'storeSignIn')
const loginsOf = async (contactId: string) => (await db().select().from(k.S.shopperLogin).where(eq(k.S.shopperLogin.contactId, contactId))) as any[]
const cookieOf = (res: { headers: Headers }) => (res.headers.get('set-cookie') || '').split(';')[0]
const json = { 'content-type': 'application/json' }
/** Sign in as this customer the way a person does (ask, then type the code), returning the cookie header to send. */
async function signIn(email: string) {
  // The hourly cap is its own test's business; here each sign-in starts clean.
  const who = email.toLowerCase() === 'bob@example.com' ? bob : ann
  await db().delete(k.S.shopperLogin).where(eq(k.S.shopperLogin.contactId, who.id))
  const before = mailsTo(email).length
  await k.pub('POST', `${A}/sign-in`, { email })
  await k.settle()
  const mail = mailsTo(email)[before]
  const res = await k.pub('POST', `${A}/verify`, { email, code: mail.data.code })
  expect(res.status).toBe(200)
  return { cookie: cookieOf(res), mail }
}
const asShopper = (cookie: string) => (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => k.pub(method, A + path, body, { cookie, ...extra })

beforeAll(async () => {
  k = await bootStore()
  await db().insert(k.S.storeSettings).values({ companyId: k.companyId, currency: 'usd', flatShippingCents: 0, taxRateBps: 0 })
  await k.connectStripe()
  mug = await k.product({ slug: 'mug', name: 'Mug', sku: 'MUG-1', priceCents: 2000, qty: 5 })
  gone = await k.product({ slug: 'old-bowl', name: 'Old bowl', sku: 'BOWL-1', priceCents: 1500 })
  ;[ann] = await db().insert(k.S.contact).values({ companyId: k.companyId, name: 'Ann Able', email: 'Ann@Example.com', type: 'customer' }).returning()
  ;[bob] = await db().insert(k.S.contact).values({ companyId: k.companyId, name: 'Bob Baker', email: 'bob@example.com', type: 'customer' }).returning()
  await db().insert(k.S.contact).values({ companyId: k.companyId, name: 'Lee Lead', email: 'lee@example.com', type: 'lead' })
  annOrder = await order(ann, { number: 'A-1', status: 'shipped', lines: [[mug, 2, 2000], [gone, 1, 1500]] })
  await order(ann, { number: 'A-2', status: 'pending', lines: [[mug, 1, 2000]] })
  bobOrder = await order(bob, { number: 'B-1', lines: [[mug, 1, 2000]] })
  const [group] = await db().insert(k.S.storeCustomerGroup).values({ companyId: k.companyId, name: 'Wholesale', percentOff: 25 }).returning()
  await db().insert(k.S.storeCustomerGroupMember).values({ companyId: k.companyId, groupId: group.id, contactId: ann.id })
  await db().update(k.S.storeProduct).set({ status: 'archived' }).where(eq(k.S.storeProduct.id, gone.product.id))
  await features(ON)
}, 120_000)
afterAll(() => k.restore())

describe('offered, never switched on', () => {
  test('registered not ready and offered to the store; off, every path is 404', async () => {
    const f = FEATURE_MAP.store_accounts
    expect(f.hidden).toBe(true)
    expect(f.templates).toEqual(['crm-store'])
    expect(getDefaultFeaturesForTemplate('crm-store')).not.toContain('store_accounts')
    await features(['dashboard', 'orders', 'products', 'contacts'])
    expect((await k.pub('POST', `${A}/sign-in`, { email: 'ann@example.com' })).status).toBe(404)
    expect((await k.pub('GET', `${A}/me`)).status).toBe(404)
    expect((await k.pub('GET', '/api/public/status')).json.accounts).toBe(false)
    await features(ON)
    expect((await k.pub('GET', '/api/public/status')).json.accounts).toBe(true)
  })
})

describe('signing in', () => {
  test('the answer is the same for a customer and for anyone else; only a customer is sent anything', async () => {
    const known = await k.pub('POST', `${A}/sign-in`, { email: ' ANN@example.com ' })
    const unknown = await k.pub('POST', `${A}/sign-in`, { email: 'nobody@example.com' })
    const lead = await k.pub('POST', `${A}/sign-in`, { email: 'lee@example.com' })
    await k.settle()
    expect(known.status).toBe(200)
    expect({ status: unknown.status, json: unknown.json }).toEqual({ status: known.status, json: known.json })
    expect({ status: lead.status, json: lead.json }).toEqual({ status: known.status, json: known.json })
    expect(known.json.message).toBe(SIGN_IN_SENT)
    expect(mailsTo('ann@example.com').length).toBe(1)
    expect(mailsTo('nobody@example.com').length).toBe(0)
    expect(mailsTo('lee@example.com').length).toBe(0)
    expect((await db().select().from(k.S.shopperLogin)).length).toBe(1)
    // A wrong-shaped email is the shopper's mistake to fix, and tells nothing about anyone.
    expect((await k.pub('POST', `${A}/sign-in`, { email: 'not-an-email' })).status).toBe(400)
  })

  test('the stored link and code are hashes: the table opens nothing', async () => {
    const mail = mailsTo('ann@example.com')[0]
    const token = new URL(mail.data.link).searchParams.get('token')!
    const [row] = await loginsOf(ann.id)
    expect(JSON.stringify(row)).not.toContain(token)
    expect(JSON.stringify(row)).not.toContain(mail.data.code)
    expect(mail.data.code).toMatch(/^\d{6}$/)
    expect(mail.data.link).toContain('/account/confirm?token=')
  })

  test('the link is used by pressing Sign in (POST), once, and starts an httpOnly session of its own', async () => {
    const mail = mailsTo('ann@example.com')[0]
    const token = new URL(mail.data.link).searchParams.get('token')!
    // Opening the link (a mail scanner does) is a GET: it spends nothing.
    expect((await k.pub('GET', `${A}/verify?token=${token}`)).status).not.toBe(200)
    const res = await k.pub('POST', `${A}/verify`, { token })
    expect(res.status).toBe(200)
    const set = res.headers.get('set-cookie') || ''
    expect(set).toMatch(/^shopper_session=/)
    expect(set).toContain('HttpOnly')
    expect(set).toMatch(/SameSite=Lax/i)
    expect(set).not.toContain('tw_access')
    expect((await k.pub('POST', `${A}/verify`, { token })).status).toBe(400) // used
    expect((await asShopper(cookieOf(res))('GET', '/me')).json).toMatchObject({ name: 'Ann Able', email: 'Ann@Example.com', group: 'Wholesale' })
  })

  test('the code: five tries at most, simultaneous guesses included; then a new sign-in is needed', async () => {
    await db().delete(k.S.shopperLogin).where(eq(k.S.shopperLogin.contactId, bob.id))
    await k.pub('POST', `${A}/sign-in`, { email: 'bob@example.com' })
    await k.settle()
    const mail = mailsTo('bob@example.com').at(-1)!
    const wrong = mail.data.code === '000000' ? '111111' : '000000'
    // Twenty guesses at once: the count is claimed before each is looked at, so only five are.
    const burst = await Promise.all(Array.from({ length: 20 }, () => k.pub('POST', `${A}/verify`, { email: 'bob@example.com', code: wrong })))
    expect(burst.every((r) => r.status === 400)).toBe(true)
    const [row] = (await loginsOf(bob.id)).filter((l) => !l.consumedAt)
    expect(row.attempts).toBeLessThanOrEqual(MAX_CODE_TRIES)
    // The right code is no good once the tries are spent...
    for (let i = 0; i < MAX_CODE_TRIES; i++) await k.pub('POST', `${A}/verify`, { email: 'bob@example.com', code: wrong })
    expect((await k.pub('POST', `${A}/verify`, { email: 'bob@example.com', code: mail.data.code })).status).toBe(400)
    // ...a new sign-in is, and it cancels the older one.
    await k.pub('POST', `${A}/sign-in`, { email: 'bob@example.com' })
    await k.settle()
    const fresh = mailsTo('bob@example.com').at(-1)!
    expect((await k.pub('POST', `${A}/verify`, { email: 'bob@example.com', code: fresh.data.code })).status).toBe(200)
  })

  test('an older sign-in stops working when a newer one is asked for; an expired one does not work', async () => {
    await k.pub('POST', `${A}/sign-in`, { email: 'ann@example.com' }); await k.settle()
    await k.pub('POST', `${A}/sign-in`, { email: 'ann@example.com' }); await k.settle()
    const [older, newer] = mailsTo('ann@example.com').slice(-2)
    expect((await k.pub('POST', `${A}/verify`, { email: 'ann@example.com', code: older.data.code })).status).toBe(400)
    await db().update(k.S.shopperLogin).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(k.S.shopperLogin.contactId, ann.id))
    expect((await k.pub('POST', `${A}/verify`, { email: 'ann@example.com', code: newer.data.code })).status).toBe(400)
  })

  test('only so many sign-in emails an hour to one customer; the form still answers as ever', async () => {
    await db().delete(k.S.shopperLogin).where(eq(k.S.shopperLogin.contactId, ann.id))
    const before = mailsTo('ann@example.com').length
    for (let i = 0; i < MAX_SIGNINS_PER_HOUR + 3; i++) {
      const r = await k.pub('POST', `${A}/sign-in`, { email: 'ann@example.com' })
      expect(r.status).toBe(200)
      await k.settle(20)
    }
    await k.settle()
    expect(mailsTo('ann@example.com').length - before).toBe(MAX_SIGNINS_PER_HOUR)
  })
})

describe("a shopper's session is not the staff's", () => {
  test("the shopper's cookie opens nothing of the back office, and a staff token opens nothing of the account", async () => {
    const { cookie } = await signIn('bob@example.com')
    expect((await asShopper(cookie)('GET', '/me')).status).toBe(200)
    for (const path of ['/api/admin/orders', '/api/auth/me', '/api/admin/settings']) {
      const r = await k.pub('GET', path, undefined, { cookie })
      expect([401, 403]).toContain(r.status)
    }
    const staff = await k.pub('GET', `${A}/me`, undefined, { authorization: `Bearer ${k.tokens.owner}` })
    expect(staff.status).toBe(401)
    const staffCookie = await k.pub('GET', `${A}/me`, undefined, { cookie: `tw_access=${k.tokens.owner}` })
    expect(staffCookie.status).toBe(401)
  })

  test('signing out ends that browser\'s session; a forged or altered cookie is nobody', async () => {
    const { cookie } = await signIn('bob@example.com')
    expect((await asShopper(cookie)('POST', '/sign-out', {})).status).toBe(200)
    expect((await asShopper(cookie)('GET', '/me')).status).toBe(401)
    expect((await asShopper('shopper_session=not-a-real-token')('GET', '/me')).status).toBe(401)
    const real = (await signIn('bob@example.com')).cookie
    expect((await asShopper(real + 'x')('GET', '/me')).status).toBe(401)
  })

  test('a change must be JSON from the shop’s own pages', async () => {
    const { cookie } = await signIn('bob@example.com')
    const me = asShopper(cookie)
    const body = JSON.stringify({ name: 'Bob', address: { line1: '1 Elm', city: 'Eau Claire', postalCode: '54701', country: 'US' } })
    const foreign = await k.pub('POST', `${A}/addresses`, body, { cookie, ...json, origin: 'https://evil.example' })
    expect(foreign.status).toBe(403)
    const form = await k.pub('POST', `${A}/addresses`, 'name=Bob', { cookie, 'content-type': 'application/x-www-form-urlencoded' })
    expect(form.status).toBe(415)
    const own = await k.pub('POST', `${A}/addresses`, body, { cookie, ...json, origin: 'https://shop.test' })
    expect(own.status).toBe(201)
    expect((await me('GET', '/addresses')).json.data.length).toBe(1)
  })
})

describe('their own orders, and only theirs', () => {
  test("Ann sees her paid orders — not the unfinished one, not Bob's — without anything of the staff's", async () => {
    const { cookie } = await signIn('ann@example.com')
    const r = await asShopper(cookie)('GET', '/orders')
    expect(r.status).toBe(200)
    expect(r.json.data.map((o: any) => o.orderNumber)).toEqual(['A-1'])
    const o = r.json.data[0]
    expect(o).toMatchObject({ status: 'shipped', totalCents: 5500, tracking: { carrier: 'UPS', number: '1Z999' } })
    expect(o.items.map((i: any) => [i.productName, i.quantity]).sort()).toEqual([['Mug', 2], ['Old bowl', 1]])
    for (const secret of ['staff only note', 'secret-token', 'recoveryToken', 'internalNote', 'supplier']) expect(r.text).not.toContain(secret)
  })

  test("another shopper's order is not there, by its id, its detail or its reorder", async () => {
    const { cookie } = await signIn('ann@example.com')
    const me = asShopper(cookie)
    expect((await me('GET', `/orders/${bobOrder.id}`)).status).toBe(404)
    expect((await me('POST', `/orders/${bobOrder.id}/reorder`, {})).status).toBe(404)
    expect((await me('GET', `/orders/${annOrder.id}`)).status).toBe(200)
    expect((await me('GET', '/orders/not-an-id')).status).toBe(404)
    // Nobody signed in sees nothing.
    expect((await k.pub('GET', `${A}/orders`)).status).toBe(401)
    expect((await k.pub('GET', `${A}/orders/${annOrder.id}`)).status).toBe(401)
  })

  test('order again: the option as it is today — her group price, what is still sold, what is not', async () => {
    const { cookie } = await signIn('ann@example.com')
    const r = await asShopper(cookie)('POST', `/orders/${annOrder.id}/reorder`, {})
    expect(r.status).toBe(200)
    expect(r.json.items).toEqual([expect.objectContaining({ sku: 'MUG-1', quantity: 2, priceCents: 1500, maxQty: 5 })])
    expect(r.json.skipped).toEqual([{ name: 'Old bowl', reason: 'No longer sold' }])
    // Only 1 left: she is offered 1 and told.
    await db().update(k.S.storeProductVariant).set({ inventoryQty: 1 }).where(eq(k.S.storeProductVariant.id, mug.variant.id))
    const few = await asShopper(cookie)('POST', `/orders/${annOrder.id}/reorder`, {})
    expect(few.json.items[0]).toMatchObject({ quantity: 1, note: 'Only 1 left' })
    await db().update(k.S.storeProductVariant).set({ inventoryQty: 5 }).where(eq(k.S.storeProductVariant.id, mug.variant.id))
  })
})

describe('saved addresses', () => {
  test('the first is the default; a new default replaces it; the rest are capped; each is only its owner’s', async () => {
    const ann2 = await signIn('ann@example.com')
    const me = asShopper(ann2.cookie)
    const a = (line1: string, extra: Record<string, unknown> = {}) => ({ name: 'Ann Able', address: { line1, city: 'Eau Claire', state: 'WI', postalCode: '54701', country: 'us' }, ...extra })
    const home = await me('POST', '/addresses', a('1 Home St'))
    expect(home.json).toMatchObject({ isDefault: true, address: { line1: '1 Home St', country: 'US' } })
    const work = await me('POST', '/addresses', a('2 Work Ave', { isDefault: true, label: 'Work' }))
    const list = (await me('GET', '/addresses')).json.data
    expect(list.map((x: any) => [x.address.line1, x.isDefault])).toEqual([['2 Work Ave', true], ['1 Home St', false]])
    expect((await me('POST', '/addresses', { name: 'Ann', address: { line1: 'no city' } })).status).toBe(400)
    const bobs = await asShopper((await signIn('bob@example.com')).cookie)('GET', '/addresses')
    expect(bobs.json.data.map((x: any) => x.address.line1)).toEqual(['1 Elm'])
    const bobAddress = bobs.json.data[0]
    expect((await me('PUT', `/addresses/${bobAddress.id}`, a('hijacked'))).status).toBe(404)
    expect((await me('DELETE', `/addresses/${bobAddress.id}`, {})).status).toBe(404)
    // Removing the default hands it to the one that is left.
    expect((await me('DELETE', `/addresses/${work.json.id}`, {})).status).toBe(200)
    expect((await me('GET', '/addresses')).json.data.map((x: any) => [x.address.line1, x.isDefault])).toEqual([['1 Home St', true]])
    for (let i = 0; i < MAX_ADDRESSES - 1; i++) expect((await me('POST', '/addresses', a(`${i} Road`))).status).toBe(201)
    expect((await me('POST', '/addresses', a('one too many'))).status).toBe(400)
  })
})

describe("a wholesale customer's prices, online", () => {
  test("the prices endpoint tells a signed-in group member their prices; nobody else is told anything", async () => {
    const ann2 = await signIn('ann@example.com')
    const r = await asShopper(ann2.cookie)('GET', '/prices?skus=MUG-1,BOWL-1')
    expect(r.json).toEqual({ group: 'Wholesale', prices: { 'MUG-1': 1500, 'BOWL-1': 1125 } })
    expect(r.headers.get('cache-control')).toContain('no-store')
    expect((await asShopper((await signIn('bob@example.com')).cookie)('GET', '/prices?skus=MUG-1')).json).toEqual({ group: null, prices: {} })
    expect((await k.pub('GET', `${A}/prices?skus=MUG-1`)).json).toEqual({ group: null, prices: {} })
  })

  test('at checkout the signed-in member pays the group price, as herself, with her address on the payment page; a guest typing her email pays the shop price', async () => {
    const { cookie } = await signIn('ann@example.com')
    await db().delete(k.S.shopperAddress).where(and(eq(k.S.shopperAddress.contactId, ann.id), eq(k.S.shopperAddress.line1 as any, 'x'))).catch(() => {})
    const member = await k.pub('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 2 }], customerEmail: 'someone-else@example.com' }, { cookie })
    expect(member.status).toBe(200)
    const call = k.stripe.last('/v1/checkout/sessions')!
    expect(call.params.get('line_items[0][price_data][unit_amount]')).toBe('1500')
    // The account's email, not the typed one; a Stripe Customer carries her default address.
    expect(call.params.get('customer_email')).toBeNull()
    expect(call.params.get('customer')).toMatch(/^cus_/)
    const cust = k.stripe.calls.filter((x) => x.path === '/v1/customers').at(-1)!
    expect(cust.params.get('shipping[address][line1]')).toBe('1 Home St')
    expect(cust.params.get('email')).toBe('Ann@Example.com')
    const placed = (await db().select().from(k.S.storeOrder).where(eq(k.S.storeOrder.status, 'pending'))).filter((o: any) => o.contactId === ann.id).at(-1)
    expect(placed).toMatchObject({ customerEmail: 'Ann@Example.com', customerName: 'Ann Able', subtotalCents: 3000, totalCents: 3000 })
    expect(placed.customerGroupId).toBeTruthy()

    const guest = await k.pub('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 1 }], customerEmail: 'ann@example.com' })
    expect(guest.status).toBe(200)
    expect(k.stripe.last('/v1/checkout/sessions')!.params.get('line_items[0][price_data][unit_amount]')).toBe('2000')
    expect(k.stripe.last('/v1/checkout/sessions')!.params.get('customer_email')).toBe('ann@example.com')
  })

  test('with accounts off, a stale cookie buys at the shop price', async () => {
    const { cookie } = await signIn('ann@example.com')
    await features(['dashboard', 'orders', 'products', 'contacts'])
    const r = await k.pub('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 1 }] }, { cookie })
    expect(r.status).toBe(200)
    expect(k.stripe.last('/v1/checkout/sessions')!.params.get('line_items[0][price_data][unit_amount]')).toBe('2000')
    await features(ON)
  })
})

describe("the shopper's pages on the shop's website", () => {
  test('with accounts on: /account and the emailed link\'s page are the shop\'s, private and out of search; the script and the header link are served', async () => {
    const page = await k.pub('GET', '/account')
    expect(page.status).toBe(200)
    expect(page.text).toContain('id="account-root"')
    expect(page.text).not.toContain('data-confirm')
    expect(page.headers.get('cache-control')).toContain('no-store')
    expect(page.headers.get('x-robots-tag')).toContain('noindex')
    const confirm = await k.pub('GET', '/account/confirm?token=abc')
    expect(confirm.status).toBe(200)
    expect(confirm.text).toContain('data-confirm="1"')
    // The token in the address is never written into the page.
    expect(confirm.text).not.toContain('abc')
    const js = await k.pub('GET', '/scripts/account.js')
    expect(js.status).toBe(200)
    expect(js.headers.get('content-type')).toContain('javascript')
    expect(js.text).toContain('/api/public/account')
    // The page shows returns and store credit when the shop has them on, and reads the server's plain-string errors.
    expect(js.text).toMatch(/api\(["']POST["'], ["']\/returns["']/)
    expect(js.text).toContain('Return items')
    expect(js.text).toMatch(/typeof e === ["']string["']/)
    expect(js.text).not.toContain('error.message')
    const shop = await k.pub('GET', '/shop')
    expect(shop.text).toContain('data-account-link')
  })

  test('with accounts off, the shop has no /account page', async () => {
    await features(['dashboard', 'orders', 'products', 'contacts'])
    expect((await k.pub('GET', '/account')).status).toBe(404)
    expect((await k.pub('GET', '/account/confirm?token=abc')).status).toBe(404)
    await features(ON)
  })
})

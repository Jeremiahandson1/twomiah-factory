// The card reader on the register (crm/bar/barTerminal.ts, barFoodRoutes.ts): Stripe Terminal's server-driven flow on
// the business's own connected account, against Stripe's API as documented (tests/foodKit.ts) — a simulated reader
// registered by its code, the amount sent to it, the payment on the check only once Stripe confirms it, a decline, a
// cancel, a timeout, tips on the reader, refunds back through Stripe (a manager's), and the old manual card record
// with no reader. Seats sign in for real; permissions are the server's.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { arr, bootFood } from './foodKit.ts'

let k: Awaited<ReturnType<typeof bootFood>>
const FEATURES = ['contacts', 'bar_menu', 'bar_register', 'card_reader']
let items: Awaited<ReturnType<typeof k.menu>>
let readerId = ''

/** A walk-up with one burger ($12.00 + 5.5% tax = $12.66). */
async function checkWithBurger(who: 'B' | 'M' | 'O' = 'B') {
  const open = await k[who]('POST', '/api/register/check', { kind: 'walkup' })
  expect(open.status).toBe(200)
  const id = open.json.check.id
  expect((await k[who]('POST', `/api/register/check/${id}/items`, { menuItemId: items.burger.id })).status).toBe(200)
  return id as string
}
const balance = async (id: string) => (await k.B('GET', `/api/register/check/${id}`)).json.check.totals.balanceCents as number

beforeAll(async () => {
  k = await bootFood({ features: FEATURES })
  await (k.t.db as any).update(k.S.company).set({ settings: { defaultTaxRate: 5.5 } }).where(eq(k.S.company.id, k.companyId))
  items = await k.menu()
}, 60_000)
afterAll(() => k.restore())

describe('registering a reader', () => {
  test('needs the business Stripe account connected, then the business address (Stripe Terminal requires a location)', async () => {
    await (k.t.db as any).update(k.S.company).set({ integrations: {} }).where(eq(k.S.company.id, k.companyId))
    const none = await k.O('POST', '/api/food/readers', { code: 'simulated-wpe', label: 'Front bar' })
    expect(none.status).toBe(409)
    expect(none.json.code).toBe('STRIPE_NOT_CONNECTED')
    await (k.t.db as any).update(k.S.company).set({ integrations: { stripeAccountId: 'acct_biz' }, address: null }).where(eq(k.S.company.id, k.companyId))
    const noAddress = await k.O('POST', '/api/food/readers', { code: 'simulated-wpe', label: 'Front bar' })
    expect(noAddress.json.code).toBe('ADDRESS_NEEDED')
    await (k.t.db as any).update(k.S.company).set({ address: '214 Water St' }).where(eq(k.S.company.id, k.companyId))
  })

  test('a bartender may not add one (bar:update); a manager adds the simulated reader by its code, on the business account', async () => {
    expect((await k.B('POST', '/api/food/readers', { code: 'simulated-wpe' })).status).toBe(403)
    const bad = await k.M('POST', '/api/food/readers', { code: 'wrong-code' })
    expect(bad.status).toBe(400)
    expect(bad.json.error).toBe('The registration code is invalid or has expired.')
    const r = await k.M('POST', '/api/food/readers', { code: 'simulated-wpe', label: 'Front bar' })
    expect(r.status).toBe(200)
    expect(r.json.reader).toMatchObject({ label: 'Front bar', deviceType: 'simulated_wisepos_e', simulated: true })
    readerId = r.json.reader.id
    const loc = k.stripe.posts('/v1/terminal/locations')
    expect(loc.length).toBe(1)
    expect(loc[0].account).toBe('acct_biz')
    expect(loc[0].params.get('address[line1]')).toBe('214 Water St')
    expect(loc[0].params.get('address[postal_code]')).toBe('54703')
    const reg = k.stripe.posts('/v1/terminal/readers').at(-1)!
    expect(reg.account).toBe('acct_biz')
    expect(reg.params.get('location')).toMatch(/^tml_/)
    // A bartender sees the readers (to pick one) and the register offers it.
    const list = await k.B('GET', '/api/food/readers')
    expect(list.json.readers.map((x: any) => [x.label, x.status])).toEqual([['Front bar', 'online']])
    const state = await k.B('GET', '/api/register/state')
    expect(state.json.cardReader.readers).toEqual([{ id: readerId, label: 'Front bar', simulated: true }])
  })

  test('Register Settings says plainly there is no offline mode', async () => {
    const s = await k.B('GET', '/api/food/settings')
    expect(s.status).toBe(200)
    expect(s.json.offline).toEqual({ available: false })
    expect(s.json.stripe).toEqual({ platform: true, connected: true })
  })
})

describe('a card on the reader', () => {
  test('the amount goes to the reader; nothing is on the check until Stripe confirms; then once, with the tip', async () => {
    const id = await checkWithBurger()
    expect(await balance(id)).toBe(1266)
    const too = await k.B('POST', '/api/food/terminal/charge', { checkId: id, readerId, amountCents: 1267 })
    expect(too.status).toBe(400)
    const sent = await k.B('POST', '/api/food/terminal/charge', { checkId: id, readerId, amountCents: 1266 })
    expect(sent.status).toBe(200)
    const charge = sent.json.charge
    expect(charge.status).toBe('pending')
    const pi = k.stripe.posts('/v1/payment_intents').at(-1)!
    expect(pi.account).toBe('acct_biz')
    expect(pi.params.get('amount')).toBe('1266')
    expect(arr(pi.params, 'payment_method_types')).toEqual(['card_present'])
    const proc = k.stripe.posts(`/v1/terminal/readers/${k.stripe.readers.keys().next().value}/process_payment_intent`).at(-1)!
    expect(proc.params.get('process_config[skip_tipping]')).toBe('true')
    // Still owed while the guest is at the reader; and nothing else may be paid on it meanwhile.
    expect((await k.B('GET', `/api/food/terminal/charge/${charge.id}`)).json.charge.status).toBe('pending')
    expect(await balance(id)).toBe(1266)
    const cash = await k.B('POST', `/api/register/check/${id}/pay`, { tender: 'cash', amountCents: 500 })
    expect(cash.status).toBe(409)
    // The guest taps the card (Stripe's simulated reader), adding a $2.00 tip.
    const paid = await k.B('POST', `/api/food/terminal/charge/${charge.id}/simulate`, { outcome: 'approve', tipCents: 200 })
    expect(paid.json.charge).toMatchObject({ status: 'succeeded', amountCents: 1266, tipCents: 200 })
    const check = (await k.B('GET', `/api/register/check/${id}`)).json.check
    expect(check.status).toBe('paid')
    expect(check.payments.map((p: any) => [p.tender, p.amountCents, p.tipCents, p.stripeAccount])).toEqual([['card_terminal', 1266, 200, 'acct_biz']])
    expect(check.payments[0].providerPaymentId).toMatch(/^pi_/)
    // Asked again: written once.
    await k.B('GET', `/api/food/terminal/charge/${charge.id}`)
    expect((await k.B('GET', `/api/register/check/${id}`)).json.check.payments.length).toBe(1)
  })

  test('a declined card: the reader says so, nothing is recorded, and it can be tried again', async () => {
    const id = await checkWithBurger()
    const c1 = (await k.B('POST', '/api/food/terminal/charge', { checkId: id, readerId, amountCents: 1266 })).json.charge
    const declined = await k.B('POST', `/api/food/terminal/charge/${c1.id}/simulate`, { outcome: 'decline' })
    expect(declined.json.charge).toMatchObject({ status: 'failed', failure: 'Your card was declined.' })
    expect(await balance(id)).toBe(1266)
    const c2 = await k.B('POST', '/api/food/terminal/charge', { checkId: id, readerId, amountCents: 1266 })
    expect(c2.status).toBe(200)
    await k.B('POST', `/api/food/terminal/charge/${c2.json.charge.id}/simulate`, { outcome: 'approve' })
    expect(await balance(id)).toBe(0)
  })

  test('cancel at the register stops the reader and cancels the PaymentIntent', async () => {
    const id = await checkWithBurger()
    const c = (await k.B('POST', '/api/food/terminal/charge', { checkId: id, readerId, amountCents: 600 })).json.charge
    const before = k.stripe.calls.length
    const r = await k.B('POST', `/api/food/terminal/charge/${c.id}/cancel`)
    expect(r.json.charge.status).toBe('canceled')
    const after = k.stripe.calls.slice(before).map((x) => x.path)
    expect(after.some((p) => p.endsWith('/cancel_action'))).toBe(true)
    expect(after.some((p) => /\/v1\/payment_intents\/[^/]+\/cancel$/.test(p))).toBe(true)
    expect(await balance(id)).toBe(1266)
  })

  test('a reader that waits too long times out; an offline reader is refused up front', async () => {
    const id = await checkWithBurger()
    const c = (await k.B('POST', '/api/food/terminal/charge', { checkId: id, readerId, amountCents: 1266 })).json.charge
    await (k.t.db as any).update(k.S.barTerminalCharge).set({ createdAt: new Date(Date.now() - 4 * 60_000) }).where(eq(k.S.barTerminalCharge.id, c.id))
    const r = await k.B('GET', `/api/food/terminal/charge/${c.id}`)
    expect(r.json.charge.status).toBe('timed_out')
    k.stripe.state.offline = true
    const off = await k.B('POST', '/api/food/terminal/charge', { checkId: id, readerId, amountCents: 1266 })
    k.stripe.state.offline = false
    expect(off.status).toBe(409)
    expect(off.json.code).toBe('READER_UNAVAILABLE')
    expect(await balance(id)).toBe(1266)
  })

  test('tips on the reader: switched on by a manager, the reader is asked for a tip on the amount', async () => {
    expect((await k.B('PUT', '/api/food/settings', { tipping: true })).status).toBe(403)
    const on = await k.M('PUT', '/api/food/settings', { tipping: true })
    expect(on.status).toBe(200)
    expect(on.json.settings.terminal.tipping).toBe(true)
    expect(arr(k.stripe.posts('/v1/terminal/configurations').at(-1)!.params, 'tipping[usd][percentages]')).toEqual(['15', '18', '20'])
    const id = await checkWithBurger()
    const c = (await k.B('POST', '/api/food/terminal/charge', { checkId: id, readerId, amountCents: 1266 })).json.charge
    const proc = k.stripe.calls.filter((x) => x.path.endsWith('/process_payment_intent')).at(-1)!
    expect(proc.params.get('process_config[tipping][amount_eligible]')).toBe('1266')
    expect(proc.params.get('process_config[skip_tipping]')).toBeNull()
    // A reader busy with a payment cannot be removed; cancelled, it is free again.
    expect((await k.M('DELETE', `/api/food/readers/${readerId}`)).status).toBe(409)
    expect((await k.B('POST', `/api/food/terminal/charge/${c.id}/cancel`)).json.charge.status).toBe('canceled')
  })
})

describe('refunds and the manual record', () => {
  test('a Stripe payment is refunded, never voided; a bartender may not refund; a manager may, back through Stripe', async () => {
    const id = await checkWithBurger()
    const c = (await k.B('POST', '/api/food/terminal/charge', { checkId: id, readerId, amountCents: 1266 })).json.charge
    await k.B('POST', `/api/food/terminal/charge/${c.id}/simulate`, { outcome: 'approve' })
    const pay = (await k.B('GET', `/api/register/check/${id}`)).json.check.payments[0]
    expect((await k.B('POST', `/api/food/payment/${pay.id}/refund`, { amountCents: 500, reason: 'Cold fries' })).status).toBe(403)
    expect((await k.M('POST', `/api/food/payment/${pay.id}/refund`, { amountCents: 500 })).status).toBe(400)
    const r = await k.M('POST', `/api/food/payment/${pay.id}/refund`, { amountCents: 500, reason: 'Cold fries' })
    expect(r.status).toBe(200)
    const refund = k.stripe.posts('/v1/refunds').at(-1)!
    expect([refund.account, refund.params.get('amount'), refund.params.get('payment_intent')]).toEqual(['acct_biz', '500', pay.providerPaymentId])
    expect(r.json.check.status).toBe('paid')
    expect(r.json.check.payments[0].refundedCents).toBe(500)
    expect((await k.M('POST', `/api/food/payment/${pay.id}/refund`, { amountCents: 767, reason: 'again' })).status).toBe(400)
    // The night's summary shows it.
    const day = await k.M('GET', '/api/register/day')
    expect(day.json.summary.refunds).toEqual({ count: 1, cents: 500 })
  })

  test('on an open check only the whole payment comes back, and the balance is owed again; Void is refused for it', async () => {
    const id = await checkWithBurger()
    expect((await k.B('POST', `/api/register/check/${id}/items`, { menuItemId: items.soda.id })).status).toBe(200)
    const c = (await k.B('POST', '/api/food/terminal/charge', { checkId: id, readerId, amountCents: 1000 })).json.charge
    await k.B('POST', `/api/food/terminal/charge/${c.id}/simulate`, { outcome: 'approve' })
    const pay = (await k.B('GET', `/api/register/check/${id}`)).json.check.payments[0]
    const v = await k.M('POST', `/api/register/payment/${pay.id}/void`, { reason: 'Wrong amount' })
    expect(v.status).toBe(409)
    expect((await k.M('POST', `/api/food/payment/${pay.id}/refund`, { amountCents: 400, reason: 'Wrong amount' })).status).toBe(409)
    const r = await k.M('POST', `/api/food/payment/${pay.id}/refund`, { reason: 'Wrong amount' })
    expect(r.status).toBe(200)
    expect(r.json.check.totals.balanceCents).toBe(1583)
  })

  test('with no reader, Card is still the manual "run it on the reader, then record it"', async () => {
    const rm = await k.M('DELETE', `/api/food/readers/${readerId}`)
    expect(rm.status).toBe(200)
    expect((await k.B('GET', '/api/register/state')).json.cardReader.readers).toEqual([])
    const id = await checkWithBurger()
    const r = await k.B('POST', `/api/register/check/${id}/pay`, { tender: 'card_external', amountCents: 1266, tipCents: 100 })
    expect(r.status).toBe(200)
    expect(r.json.check.status).toBe('paid')
  })

  test('with card_reader switched off, the reader routes are closed', async () => {
    await k.features(['contacts', 'bar_menu', 'bar_register'])
    expect((await k.M('GET', '/api/food/readers')).status).toBe(403)
    expect((await k.B('GET', '/api/register/state')).json.cardReader.readers).toEqual([])
    await k.features(FEATURES)
  })

  test('long tabs are the owner\'s switch: off, New tab is refused', async () => {
    expect((await k.B('PUT', '/api/food/settings', { tabs: false })).status).toBe(403)
    expect((await k.M('PUT', '/api/food/settings', { tabs: false })).status).toBe(200)
    expect((await k.B('POST', '/api/register/check', { kind: 'tab', label: 'Mike' })).status).toBe(403)
    expect((await k.B('GET', '/api/register/state')).json.tabs).toBe(false)
    expect((await k.M('PUT', '/api/food/settings', { tabs: true })).status).toBe(200)
    expect((await k.B('POST', '/api/register/check', { kind: 'tab', label: 'Mike' })).status).toBe(200)
  })
})

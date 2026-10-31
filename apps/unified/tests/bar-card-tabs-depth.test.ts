// Card tabs depth (restaurant-bar parity row 14, Toast): the guest chooses the tip on the reader as the tab closes; a tab
// open longer than the venue's window is released by itself; a tab held by Tap to Pay on the phone (the hold made here,
// the card collected by the SDK, the hold read back from Stripe before it counts) closes and releases by the ordinary
// routes. Fake Stripe as in bar-card-tabs.test.ts; no reader and no phone were used. Fails without the change: no
// close-on-reader, no /tab/phone, no tabHoldHours.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { bootFood } from './foodKit.ts'

let k: Awaited<ReturnType<typeof bootFood>>
let items: Awaited<ReturnType<typeof k.menu>>
let readerId = ''
const ON = ['contacts', 'bar_menu', 'bar_register', 'card_reader', 'bar_tab_preauth', 'tap_to_pay', 'online_payments']
const openCheck = async (label: string) => {
  const chk = (await k.B('POST', '/api/register/check', { kind: 'tab', label })).json.check
  await k.B('POST', `/api/register/check/${chk.id}/items`, { menuItemId: items.burger.id })
  return (await k.B('GET', `/api/register/check/${chk.id}`)).json.check
}
const holdOnReader = async (checkId: string, amountCents: number) => {
  const started = await k.B('POST', '/api/food/terminal/tab', { checkId, readerId, amountCents })
  expect(started.status).toBe(200)
  await k.B('POST', `/api/food/terminal/charge/${started.json.charge.id}/simulate`, { outcome: 'approve' })
  const t = (await k.B('GET', `/api/food/terminal/tab?checkId=${checkId}`)).json.tab
  expect(t.status).toBe('authorized')
  return t
}

describe('card tabs depth', () => {
  beforeAll(async () => {
    k = await bootFood({ features: ON })
    items = await k.menu()
    readerId = (await k.M('POST', '/api/food/readers', { code: 'simulated-wpe', label: 'Front bar' })).json.reader.id
  }, 120_000)
  afterAll(() => k?.restore())

  test('the tip on the reader at close: refused until tipping is on; then a sale for the balance goes to the reader, the guest tips, the check is paid with the tip and the hold goes', async () => {
    const chk = await openCheck('Mike')
    const tab = await holdOnReader(chk.id, 5000)
    const off = await k.B('POST', `/api/food/terminal/tab/${tab.id}/close-on-reader`, { readerId })
    expect(off.status).toBe(409); expect(off.json.error).toContain('Ask for a tip on the reader')
    expect((await k.M('PUT', '/api/food/settings', { tipping: true })).status).toBe(200)
    const on = await k.B('POST', `/api/food/terminal/tab/${tab.id}/close-on-reader`, { readerId })
    expect(on.status).toBe(200)
    expect(on.json.charge).toMatchObject({ kind: 'sale', status: 'pending', amountCents: chk.totals.balanceCents, checkId: chk.id })
    // The reader was asked with tipping, not skip_tipping.
    const sent = k.stripe.calls.filter((c) => c.method === 'POST' && /process_payment_intent$/.test(c.path)).pop()!
    expect(sent.params.get('process_config[tipping][amount_eligible]')).toBe(String(chk.totals.balanceCents))
    expect(sent.params.get('process_config[skip_tipping]')).toBeNull()
    // The guest picks a $3.00 tip on the reader and taps.
    await k.B('POST', `/api/food/terminal/charge/${on.json.charge.id}/simulate`, { outcome: 'approve', tipCents: 300 })
    const polled = await k.B('GET', `/api/food/terminal/charge/${on.json.charge.id}`)
    expect(polled.json.charge).toMatchObject({ status: 'succeeded', tipCents: 300 })
    const paid = (await k.B('GET', `/api/register/check/${chk.id}`)).json.check
    expect(paid.status).toBe('paid'); expect(paid.totals.tipCents).toBe(300)
    expect(paid.payments.find((p: any) => p.tender === 'card_terminal')).toMatchObject({ amountCents: chk.totals.balanceCents, tipCents: 300 })
    // The hold is released with the check (Stripe was asked to cancel the hold's PaymentIntent).
    expect((await k.B('GET', `/api/food/terminal/tab?checkId=${chk.id}`)).json.tab).toBeNull()
    expect(k.stripe.calls.some((c) => c.method === 'POST' && /^\/v1\/payment_intents\/pi_.*\/cancel$/.test(c.path))).toBe(true)
    // A tab that is not open cannot be closed on the reader.
    expect((await k.B('POST', `/api/food/terminal/tab/${tab.id}/close-on-reader`, { readerId })).status).toBe(409)
  })

  test('the saved-card window: a tab open longer than the venue\'s hours is released by the hourly pass; the setting is the owner\'s and checked', async () => {
    expect((await k.M('GET', '/api/food/settings')).json.settings.terminal.tabHoldHours).toBe(24)
    expect((await k.M('PUT', '/api/food/settings', { terminal: { tabHoldHours: 0 } })).status).toBe(400)
    expect((await k.M('PUT', '/api/food/settings', { terminal: { tabHoldHours: 6 } })).status).toBe(200)
    const chk = await openCheck('Dana')
    const tab = await holdOnReader(chk.id, 4000)
    const row = (await (k.t.db as any).select().from(k.S.barTerminalCharge).where((await import('drizzle-orm')).eq(k.S.barTerminalCharge.id, tab.id)))[0]
    expect(row.status).toBe('authorized')
    // The pass the hourly job runs, by hand with the clock moved: five hours in, still held; seven, released. A bartender may not run it.
    expect((await k.B('POST', '/api/food/terminal/tabs/sweep', {})).status).toBe(403)
    const sweep = async (hoursLater: number) => (await k.M('POST', '/api/food/terminal/tabs/sweep', { now: new Date(row.createdAt.getTime() + hoursLater * 3600_000).toISOString() })).json
    expect((await sweep(5)).released).toBe(0)
    expect((await k.B('GET', `/api/food/terminal/tab?checkId=${chk.id}`)).json.tab.status).toBe('authorized')
    expect((await sweep(7)).released).toBe(1)
    expect((await k.B('GET', `/api/food/terminal/tab?checkId=${chk.id}`)).json.tab).toBeNull()
    expect((await k.B('GET', `/api/register/check/${chk.id}`)).json.check.status).toBe('open')   // the check stays; only the card went
  })

  test('a tab held by Tap to Pay on the phone: the hold is made here, counts once Stripe says it is in place, and closes with a tip by the ordinary route', async () => {
    await k.features(ON.filter((f) => f !== 'tap_to_pay'))
    const chk = await openCheck('Phone guest')
    expect((await k.B('POST', '/api/food/terminal/tab/phone', { checkId: chk.id, amountCents: 3000 })).status).toBe(403)
    await k.features(ON)
    expect((await k.B('POST', '/api/food/terminal/tab/phone', { checkId: chk.id, amountCents: 50 })).json.error).toContain('$1 to $1,000')
    const started = await k.B('POST', '/api/food/terminal/tab/phone', { checkId: chk.id, amountCents: 3000 })
    expect(started.status).toBe(200)
    expect(started.json.charge).toMatchObject({ kind: 'preauth', status: 'pending', amountCents: 3000, readerId: null, readerLabel: 'This phone' })
    expect(started.json.clientSecret).toContain('_secret')
    const made = k.stripe.calls.filter((c) => c.method === 'POST' && c.path === '/v1/payment_intents').pop()!
    expect(made.params.get('capture_method')).toBe('manual'); expect(made.params.get('payment_method_types[0]')).toBe('card_present'); expect(made.account).toBe('acct_biz')
    // Not yet tapped: the hold does not count.
    const early = await k.B('POST', `/api/food/terminal/tab/phone/${started.json.charge.id}/authorized`)
    expect(early.status).toBe(409); expect(early.json.error).toContain('Tap the card again')
    // The phone's SDK collected the card: Stripe now holds it (requires_capture).
    const piId = made ? [...k.stripe.intents.values()].pop().id : ''
    const pi = k.stripe.intents.get(piId)
    Object.assign(pi, { status: 'requires_capture', latest_charge: { id: `ch_${piId}`, payment_method_details: { card_present: { brand: 'visa', last4: '4242', cardholder_name: 'PHONE GUEST', capture_before: Math.floor(Date.now() / 1000) + 6 * 86400 } } } })
    const ok = await k.B('POST', `/api/food/terminal/tab/phone/${started.json.charge.id}/authorized`)
    expect(ok.status).toBe(200)
    expect(ok.json.charge).toMatchObject({ status: 'authorized', card: { brand: 'visa', last4: '4242' } })
    const list = (await k.B('GET', '/api/food/tabs')).json.checks
    expect(list.find((c: any) => c.id === chk.id).tab).toMatchObject({ id: started.json.charge.id, status: 'authorized' })
    expect((await k.B('POST', '/api/food/terminal/tab/phone', { checkId: chk.id, amountCents: 3000 })).status).toBe(409)   // one tab per check
    // Closed with a $2.00 tip: a capture, no reader.
    const closed = await k.B('POST', `/api/food/terminal/tab/${started.json.charge.id}/close`, { tipCents: 200 })
    expect(closed.status).toBe(200)
    expect(closed.json).toMatchObject({ paidCents: chk.totals.balanceCents, tipCents: 200, leftCents: 0 })
    expect((await k.B('GET', `/api/register/check/${chk.id}`)).json.check.status).toBe('paid')
  })
})

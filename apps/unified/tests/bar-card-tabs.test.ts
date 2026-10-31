// A card held for a tab on the counter reader (restaurant-bar-depth #12): the reader holds the card (manual capture, on the
// business's own Stripe account), nothing is taken until the tab is closed with the tip, a voided or otherwise-paid check
// lets the hold go, and the tab is Stripe's own documented flow (tests/foodKit.ts answers it as its docs describe).
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { arr, bootFood } from './foodKit.ts'

let k: Awaited<ReturnType<typeof bootFood>>
let items: Awaited<ReturnType<typeof k.menu>>
let readerId = ''
let V: (method: string, path: string, body?: unknown) => Promise<any>
const ON = ['contacts', 'bar_menu', 'bar_register', 'card_reader', 'bar_tab_preauth']

async function check(...menuItems: string[]) {
  const id = (await k.B('POST', '/api/register/check', { kind: 'walkup' })).json.check.id as string
  for (const m of menuItems) expect((await k.B('POST', `/api/register/check/${id}/items`, { menuItemId: m })).status).toBe(200)
  return id
}
const view = async (id: string) => (await k.B('GET', `/api/register/check/${id}`)).json.check
const balance = async (id: string) => (await view(id)).totals.balanceCents as number
/** Hold a card on a check: the reader is sent the hold, the guest taps. */
async function hold(checkId: string, amountCents: number) {
  const started = await k.B('POST', '/api/food/terminal/tab', { checkId, readerId, amountCents })
  expect(started.status).toBe(200)
  const tapped = await k.B('POST', `/api/food/terminal/charge/${started.json.charge.id}/simulate`, { outcome: 'approve' })
  expect(tapped.json.charge.status).toBe('authorized')
  return tapped.json.charge as { id: string }
}
const intent = (chargeId: string) => k.t.db.select().from((k.S as any).barTerminalCharge).where(eq((k.S as any).barTerminalCharge.id, chargeId)).then((r: any[]) => k.stripe.intents.get(r[0].paymentIntentId))

beforeAll(async () => {
  k = await bootFood({ features: ON.filter((f) => f !== 'bar_tab_preauth') })
  await (k.t.db as any).update(k.S.company).set({ settings: { defaultTaxRate: 5.5 } }).where(eq(k.S.company.id, k.companyId))
  items = await k.menu()
  // A seat with no register at all (a viewer).
  const [u] = await (k.t.db as any).insert(k.S.user).values({ email: 'viewer@bar.test', passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: 'View', lastName: 'Seat', role: 'viewer', companyId: k.companyId }).returning()
  const login = await k.t.call('/api/auth/login', { method: 'POST', json: { email: u.email, password: 'Seat-pass-1' } })
  const tok = (await login.json()).accessToken
  V = async (method, path, body) => { const r = await k.t.call(path, { method, headers: { Authorization: `Bearer ${tok}`, host: 'bar.test' }, ...(body === undefined ? {} : { json: body }) }); const text = await r.text(); let j: any = text; try { j = JSON.parse(text) } catch {} return { status: r.status, json: j } }
  const r = await k.M('POST', '/api/food/readers', { code: 'simulated-wpe', label: 'Front bar' })
  readerId = r.json.reader.id
}, 60_000)
afterAll(() => k.restore())

describe('who may put a card on a tab', () => {
  test('switched off, the routes are refused; on, a seat with no register is refused and a bartender is not', async () => {
    const id = await check(items.burger.id)
    expect((await k.B('POST', '/api/food/terminal/tab', { checkId: id, readerId, amountCents: 5000 })).status).toBe(403)
    expect((await k.B('GET', '/api/register/state')).json.cardReader.cardTabs).toBe(false)
    await k.features(ON)
    expect((await k.B('GET', '/api/register/state')).json.cardReader.cardTabs).toBe(true)
    expect((await V('POST', '/api/food/terminal/tab', { checkId: id, readerId, amountCents: 5000 })).status).toBe(403)
    expect((await V('GET', `/api/food/terminal/tab?checkId=${id}`)).status).toBe(403)
    expect((await V('POST', '/api/food/terminal/tab/x/close', {})).status).toBe(403)
    expect((await V('POST', '/api/food/terminal/tab/x/release', {})).status).toBe(403)
    expect((await k.B('GET', `/api/food/terminal/tab?checkId=${id}`)).json.tab).toBeNull()
  })
})

describe('holding the card', () => {
  test('the reader is sent a hold with manual capture on the business account; nothing is on the check; the tab shows the card', async () => {
    const id = await check(items.burger.id)
    const started = await k.B('POST', '/api/food/terminal/tab', { checkId: id, readerId, amountCents: 5000 })
    expect(started.status).toBe(200)
    expect(started.json.charge).toMatchObject({ kind: 'preauth', status: 'pending', amountCents: 5000 })
    const pi = k.stripe.posts('/v1/payment_intents').at(-1)!
    expect(pi.account).toBe('acct_biz')
    expect(pi.params.get('amount')).toBe('5000')
    expect(pi.params.get('capture_method')).toBe('manual')
    expect(arr(pi.params, 'payment_method_types')).toEqual(['card_present'])
    expect(pi.params.get('payment_method_options[card_present][request_incremental_authorization_support]')).toBe('true')
    const proc = k.stripe.posts(`/v1/terminal/readers/${k.stripe.readers.keys().next().value}/process_payment_intent`).at(-1)!
    expect(proc.params.get('process_config[skip_tipping]')).toBe('true')
    // A second tab on a check that already has one is refused; the amount must be sensible.
    expect((await k.B('POST', '/api/food/terminal/tab', { checkId: id, readerId, amountCents: 5000 })).status).toBe(409)
    const other = await check(items.soda.id)
    expect((await k.B('POST', '/api/food/terminal/tab', { checkId: other, readerId, amountCents: 50 })).status).toBe(400)
    expect((await k.B('POST', '/api/food/terminal/tab', { checkId: other, readerId, amountCents: 200000 })).status).toBe(400)
    // The guest taps: held, with the card and when the hold lapses. Still nothing paid, and the check can still be added to.
    const tapped = await k.B('POST', `/api/food/terminal/charge/${started.json.charge.id}/simulate`, { outcome: 'approve' })
    expect(tapped.json.charge).toMatchObject({ status: 'authorized', card: { brand: 'visa', last4: '4242', holder: 'MIKE TESTER' } })
    expect(Date.parse(tapped.json.charge.captureBefore)).toBeGreaterThan(Date.now())
    expect((await view(id)).payments).toEqual([])
    expect((await k.B('POST', `/api/register/check/${id}/items`, { menuItemId: items.soda.id })).status).toBe(200)
    expect((await k.B('GET', `/api/food/terminal/tab?checkId=${id}`)).json.tab).toMatchObject({ id: started.json.charge.id, status: 'authorized' })
    // Not captured: Stripe still has it as requires_capture.
    expect((await intent(started.json.charge.id)).status).toBe('requires_capture')
    // Put away for the next tests.
    expect((await k.B('POST', `/api/food/terminal/tab/${started.json.charge.id}/release`)).status).toBe(200)
  })

  test('a declined card holds nothing and leaves the check free for another try', async () => {
    const id = await check(items.burger.id)
    const s = await k.B('POST', '/api/food/terminal/tab', { checkId: id, readerId, amountCents: 5000 })
    const declined = await k.B('POST', `/api/food/terminal/charge/${s.json.charge.id}/simulate`, { outcome: 'decline' })
    expect(declined.json.charge).toMatchObject({ status: 'failed', failure: 'Your card was declined.' })
    expect((await intent(s.json.charge.id)).status).toBe('canceled')
    expect((await k.B('GET', `/api/food/terminal/tab?checkId=${id}`)).json.tab).toBeNull()
    const again = await k.B('POST', '/api/food/terminal/tab', { checkId: id, readerId, amountCents: 5000 })
    expect(again.status).toBe(200)
    await k.B('POST', `/api/food/terminal/charge/${again.json.charge.id}/cancel`)   // leave the reader free
  })
})

describe('closing the tab', () => {
  test('the check and the tip are taken from the hold in one capture, recorded once, and the check is paid', async () => {
    const id = await check(items.burger.id)
    const tab = await hold(id, 5000)
    await k.B('POST', `/api/register/check/${id}/items`, { menuItemId: items.soda.id })
    const owed = await balance(id)
    expect(owed).toBeGreaterThan(1266)
    const before = k.stripe.calls.length
    const closed = await k.B('POST', `/api/food/terminal/tab/${tab.id}/close`, { tipCents: 300 })
    expect(closed.status).toBe(200)
    expect(closed.json).toMatchObject({ paidCents: owed, tipCents: 300, leftCents: 0 })
    const cap = k.stripe.calls.slice(before).find((c) => c.path.endsWith('/capture'))!
    expect(cap.account).toBe('acct_biz')
    expect(cap.params.get('amount_to_capture')).toBe(String(owed + 300))
    const c = await view(id)
    expect(c.status).toBe('paid')
    expect(c.payments.map((p: any) => [p.tender, p.amountCents, p.tipCents, p.stripeAccount])).toEqual([['card_terminal', owed, 300, 'acct_biz']])
    expect((await intent(tab.id)).amount_received).toBe(owed + 300)
    // Closed again: refused, and nothing more is taken.
    const again = await k.B('POST', `/api/food/terminal/tab/${tab.id}/close`, { tipCents: 300 })
    expect(again.status).toBe(409)
    expect((await view(id)).payments.length).toBe(1)
    // No call anywhere left the business's own Stripe account.
    expect(k.stripe.calls.filter((x) => x.path.startsWith('/v1/payment_intents')).every((x) => x.account === 'acct_biz')).toBe(true)
    // A tip that is plainly a typo is refused before any money moves.
    const id2 = await check(items.soda.id); const t2 = await hold(id2, 2000)
    expect((await k.B('POST', `/api/food/terminal/tab/${t2.id}/close`, { tipCents: 99999 })).status).toBe(400)
    expect((await intent(t2.id)).status).toBe('requires_capture')
    await k.B('POST', `/api/food/terminal/tab/${t2.id}/release`)
  })

  test('over the hold, the card is asked to raise it as the tab is captured; when the card refuses, nothing is taken until the bartender closes it for the hold', async () => {
    // Raised: the hold is $20, the tab is more.
    const a = await check(items.burger.id, items.burger.id)
    const ta = await hold(a, 2000)
    const owedA = await balance(a)
    expect(owedA).toBeGreaterThan(2000)
    expect((await k.B('POST', `/api/food/terminal/tab/${ta.id}/close`, { tipCents: 0 })).status).toBe(200)
    expect((await view(a)).status).toBe('paid')
    expect((await intent(ta.id)).amount_received).toBe(owedA)
    // Refused by the card.
    const b = await check(items.burger.id, items.burger.id)
    const tb = await hold(b, 2000)
    const owedB = await balance(b)
    k.stripe.state.declineIncrement = true
    try {
      const refused = await k.B('POST', `/api/food/terminal/tab/${tb.id}/close`, { tipCents: 0 })
      expect(refused.status).toBe(409)
      expect(refused.json.code).toBe('TAB_OVER_HOLD')
      expect(refused.json.error).toContain('$20.00')
      expect((await view(b)).payments).toEqual([])
      expect((await k.B('GET', `/api/food/terminal/tab?checkId=${b}`)).json.tab.status).toBe('authorized')
      const partial = await k.B('POST', `/api/food/terminal/tab/${tb.id}/close`, { tipCents: 0, partial: true })
      expect(partial.status).toBe(200)
      expect(partial.json).toMatchObject({ paidCents: 2000, tipCents: 0, leftCents: owedB - 2000 })
      const c = await view(b)
      expect(c.status).toBe('open')
      expect(c.totals.balanceCents).toBe(owedB - 2000)
      expect((await intent(tb.id)).amount_received).toBe(2000)
      // The rest in cash, and the check is paid.
      expect((await k.B('POST', `/api/register/check/${b}/pay`, { tender: 'cash', amountCents: owedB - 2000 })).status).toBe(200)
      expect((await view(b)).status).toBe('paid')
    } finally { k.stripe.state.declineIncrement = false }
  })
})

describe('letting the hold go', () => {
  test('releasing a tab cancels the PaymentIntent, charges nothing, and it cannot then be closed', async () => {
    const id = await check(items.soda.id)
    const tab = await hold(id, 3000)
    const r = await k.B('POST', `/api/food/terminal/tab/${tab.id}/release`)
    expect(r.status).toBe(200)
    expect(r.json.charge.status).toBe('released')
    expect((await intent(tab.id)).status).toBe('canceled')
    expect((await k.B('POST', `/api/food/terminal/tab/${tab.id}/close`, {})).status).toBe(409)
    expect((await view(id)).payments).toEqual([])
    expect((await k.B('GET', `/api/food/terminal/tab?checkId=${id}`)).json.tab).toBeNull()
  })

  test('voiding the check releases the hold; so does paying the check another way', async () => {
    const v = await check(items.soda.id)
    const tv = await hold(v, 3000)
    expect((await k.B('POST', `/api/register/check/${v}/void`, { reason: 'Guest left' })).status).toBe(200)
    expect((await intent(tv.id)).status).toBe('canceled')
    const row = (await (k.t.db as any).select().from(k.S.barTerminalCharge).where(eq(k.S.barTerminalCharge.id, tv.id)))[0]
    expect(row.status).toBe('released')
    expect((await k.B('POST', `/api/food/terminal/tab/${tv.id}/close`, {})).status).toBe(409)

    const p = await check(items.soda.id)
    const tp = await hold(p, 3000)
    expect((await k.B('POST', `/api/register/check/${p}/pay`, { tender: 'cash', amountCents: await balance(p) })).status).toBe(200)
    expect((await view(p)).status).toBe('paid')
    expect((await intent(tp.id)).status).toBe('canceled')
    expect((await (k.t.db as any).select().from(k.S.barTerminalCharge).where(eq(k.S.barTerminalCharge.id, tp.id)))[0].status).toBe('released')
  })

  test('a card read on the reader waiting for the guest can be cancelled, and a tab cannot be closed before the card is read', async () => {
    const id = await check(items.soda.id)
    const s = await k.B('POST', '/api/food/terminal/tab', { checkId: id, readerId, amountCents: 3000 })
    expect((await k.B('POST', `/api/food/terminal/tab/${s.json.charge.id}/close`, {})).status).toBe(409)
    const c = await k.B('POST', `/api/food/terminal/charge/${s.json.charge.id}/cancel`)
    expect(c.json.charge.status).toBe('canceled')
    expect((await intent(s.json.charge.id)).status).toBe('canceled')
  })
})

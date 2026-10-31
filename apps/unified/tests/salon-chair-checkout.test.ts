// Checkout at the chair (salon gap #7; server/crm/salon/chairCheckout.ts, hidden feature `chair_checkout`). A client pays on a Stripe card reader on the
// SALON'S OWN Stripe account; the tip is chosen at the desk and recorded for the stylist; a split bill is cash + gift card + card. Run against Stripe's
// SIMULATED Terminal reader (the fake in foodKit.ts answers the API as Stripe documents it) — no hardware, nothing leaves the machine.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootFood } from './foodKit.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'invoices']

describe('salon: checkout at the chair (card reader, tips, split tender)', () => {
  let k: Awaited<ReturnType<typeof bootFood>>
  let t: any, S: any, co = '', ana = '', cut = ''
  let ip = 0, hour = 7
  const as = async (who: 'owner' | 'manager' | 'bartender', path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${k.tokens[who]}`, 'x-forwarded-for': `10.9.0.${++ip}`, host: 'bar.test' } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const day = addDays(today(), -2)
  const wall = (d: string, hm: string) => {
    const guess = new Date(`${d}T${hm}:00Z`)
    const parts = tzParts(guess, TZ)
    const offsetMin = (guess.getTime() - new Date(`${parts.date}T${String(Math.floor(parts.minutes / 60)).padStart(2, '0')}:${String(parts.minutes % 60).padStart(2, '0')}:00Z`).getTime()) / 60000
    return new Date(guess.getTime() + offsetMin * 60000).toISOString()
  }
  /** A completed $100 cut by Ana for a new client: raises the bill (a sale the reader can take). */
  async function visitSale() {
    const client = await ins(S.contact, { companyId: co, name: `Client ${ip}`, email: `c${ip}-${hour}@example.com`, type: 'client' })
    hour += 1
    // Twelve working hours a day, then the day before — a long file books many visits.
    const slot = hour - 8
    const made = await as('owner', '/api/appointments', 'POST', { contactId: client.id, startTime: wall(addDays(day, -Math.floor(slot / 12)), `${String(8 + (slot % 12)).padStart(2, '0')}:00`), serviceId: cut, stylistId: ana })
    expect(made.status).toBe(201)
    expect((await as('owner', `/api/appointments/${made.body.id}`, 'PUT', { status: 'completed' })).status).toBe(200)
    const [inv] = await t.db.select().from(S.invoice).where(eq(S.invoice.appointmentId, made.body.id))
    return inv.id as string
  }
  const invoiceOf = async (id: string) => (await t.db.select().from(S.invoice).where(eq(S.invoice.id, id)))[0]
  const paymentsOf = async (id: string) => (await t.db.select().from(S.payment).where(eq(S.payment.invoiceId, id))) as any[]
  const reader = async (code = 'simulated-wpe', label = 'Front desk') => (await as('owner', '/api/chair-checkout/readers', 'POST', { code, label }))
  let readerId = ''
  const startCard = (invoiceId: string, extra: Record<string, unknown> = {}) => as('owner', '/api/chair-checkout/charges', 'POST', { invoiceId, readerId, ...extra })
  /** The guest tapped and Stripe has it: the PaymentIntent succeeded and the reader is free again — before anyone here has asked. */
  const stripeTookIt = (pi: any) => { Object.assign(pi, { status: 'succeeded', amount_received: pi.amount, amount_details: { tip: {} } }); for (const r of k.stripe.readers.values()) r.action = null }
  const tap = (chargeId: string, outcome: 'approve' | 'decline' = 'approve', tipCents = 0) => as('owner', `/api/chair-checkout/charges/${chargeId}/simulate`, 'POST', { outcome, tipCents })

  beforeAll(async () => {
    k = await bootFood({ vertical: 'salon', features: FEATURES, sharedStripe: true })
    t = k.t; S = k.S; co = k.companyId
    await t.db.update(S.company).set({ timezone: TZ }).where(eq(S.company.id, co))
    ana = (await ins(S.user, { email: 'ana@test.example', passwordHash: await Bun.password.hash('Ana-pass-1', 'bcrypt'), firstName: 'Ana', lastName: 'Stylist', role: 'field', companyId: co })).id
    cut = (await as('owner', '/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 100 })).body.id
  }, 120_000)
  afterAll(() => k.restore())

  test('closed until the salon is given the feature; then the server — not the screen — decides who may pair a reader or take a card', async () => {
    expect((await as('owner', '/api/chair-checkout/readers')).status).not.toBe(200)
    await k.features([...FEATURES, 'chair_checkout'])
    expect((await as('owner', '/api/chair-checkout/readers')).status).toBe(200)
    const sale = await visitSale()
    // A stylist holds no invoice rights: no reader list, no card.
    expect((await as('bartender', '/api/chair-checkout/readers')).status).toBe(403)
    expect((await as('bartender', '/api/chair-checkout/charges', 'POST', { invoiceId: sale, readerId: 'x' })).status).toBe(403)
    // A manager takes payments but does not configure: pairing a reader and handing it a test card are the owner's.
    expect((await as('manager', '/api/chair-checkout/readers', 'POST', { code: 'simulated-wpe' })).status).toBe(403)
    expect((await as('manager', '/api/chair-checkout/readers')).status).toBe(200)
    expect((await as('manager', '/api/chair-checkout/charges/abc/simulate', 'POST', { outcome: 'approve' })).status).toBe(403)
    expect((await as('bartender', '/api/chair-checkout/readers/abc', 'DELETE')).status).toBe(403)
  })

  test('a reader is paired by its code on the salon\'s OWN Stripe account; one Location is made, once', async () => {
    expect((await reader('not-a-code')).status).toBe(400)
    const first = await reader('simulated-wpe', 'Front desk')
    expect(first.status).toBe(201)
    expect(first.body.reader.simulated).toBe(true)
    readerId = first.body.reader.id
    const second = await reader('quick-brown-fox', 'Colour bar')
    expect(second.status).toBe(201)
    expect(second.body.reader.simulated).toBe(false)
    // The bad code reached Stripe and was refused there (and cost a spare Location); the good ones share ONE Location.
    expect(k.stripe.posts('/v1/terminal/readers')).toHaveLength(3)
    const made = k.stripe.posts('/v1/terminal/locations')
    expect(made.length).toBeLessThanOrEqual(2)
    const third = await reader('simulated-wpe', 'Spare')
    expect(third.status).toBe(201)
    expect(k.stripe.posts('/v1/terminal/locations')).toHaveLength(made.length)
    expect((await as('owner', `/api/chair-checkout/readers/${third.body.reader.id}`, 'DELETE')).status).toBe(200)
    // Every call Stripe saw was on the salon's connected account, never the platform's.
    expect(k.stripe.calls.length).toBeGreaterThan(0)
    expect(k.stripe.calls.every((c) => c.account === 'acct_biz')).toBe(true)
    const list = await as('manager', '/api/chair-checkout/readers')
    expect(list.body.readers.map((r: any) => r.label).sort()).toEqual(['Colour bar', 'Front desk'])
  })

  test('card with a tip: the sale is paid once, the tip is recorded for the stylist and shows on the tips report', async () => {
    const sale = await visitSale()
    expect((await invoiceOf(sale)).status).toBe('open')
    const started = await startCard(sale, { tipCents: 1800 })
    expect(started.status).toBe(201)
    expect(started.body.charge).toMatchObject({ status: 'pending', amountCents: 10000, tipCents: 1800 })
    // The card is charged the sale and the tip together; Stripe is told which is which.
    const pi = [...k.stripe.intents.values()].pop()
    expect(pi.amount).toBe(11800)
    expect(pi.metadata.twomiah_invoice).toBe(sale)
    expect(await paymentsOf(sale)).toHaveLength(0)           // nothing is recorded until Stripe says so
    const done = await tap(started.body.charge.id)
    expect(done.body.charge.status).toBe('succeeded')
    const pays = await paymentsOf(sale)
    expect(pays).toHaveLength(1)
    expect(pays[0]).toMatchObject({ method: 'card', reference: pi.id })
    expect(Number(pays[0].amount)).toBe(100)
    expect(Number(pays[0].tipAmount)).toBe(18)
    expect((await invoiceOf(sale)).status).toBe('paid')
    // Polling again — however often — writes nothing more.
    for (let i = 0; i < 3; i++) await as('owner', `/api/chair-checkout/charges/${started.body.charge.id}`)
    expect(await paymentsOf(sale)).toHaveLength(1)
    // A sale that is paid refuses another card.
    expect((await startCard(sale)).status).toBe(409)
    // The tip goes to the stylist of the visit.
    const tips = await as('owner', '/api/salon-reports/tips')
    expect(tips.status).not.toBe(200)                          // reports are their own (hidden) feature
    await k.features([...FEATURES, 'chair_checkout', 'salon_reports'])
    const rep = (await as('owner', '/api/salon-reports/tips')).body
    expect(rep.total).toBe(18)
    expect(rep.stylists).toEqual([expect.objectContaining({ id: ana, name: 'Ana Stylist', tips: 18, payments: 1 })])
  })

  test('the client can choose the tip on the reader\'s own screen: it is recorded as the tip; a typed tip and a reader tip together are refused', async () => {
    // The location carries a tipping configuration (15 / 18 / 20 %) made on the salon's account when it was created.
    const cfg = k.stripe.posts('/v1/terminal/configurations')
    expect(cfg.length).toBeGreaterThan(0)
    expect([...cfg[0].params.entries()].filter(([key]) => key.startsWith('tipping[usd][percentages]')).map(([, v]) => v)).toEqual(['15', '18', '20'])
    expect(cfg[0].account).toBe('acct_biz')
    expect(k.stripe.calls.some((c) => c.path.startsWith('/v1/terminal/locations/') && c.params.get('configuration_overrides'))).toBe(true)
    const sale = await visitSale()
    expect((await startCard(sale, { tipOnReader: true, tipCents: 500 })).status).toBe(400)
    const started = await startCard(sale, { tipOnReader: true })
    expect(started.status).toBe(201)
    const sentToReader = k.stripe.posts(`/v1/terminal/readers/${[...k.stripe.readers.keys()][0]}/process_payment_intent`).pop()!
    expect(sentToReader.params.get('process_config[skip_tipping]')).toBeNull()          // the reader is allowed to ask
    expect(started.body.charge.tipCents).toBe(0)
    const done = await tap(started.body.charge.id, 'approve', 2000)                      // the client picked $20 on the reader
    expect(done.body.charge).toMatchObject({ status: 'succeeded', tipCents: 2000 })
    const [pay] = await paymentsOf(sale)
    expect([Number(pay.amount), Number(pay.tipAmount)]).toEqual([100, 20])
    // A tip typed at the desk, by contrast, hides the reader's tip screen.
    const other = await visitSale()
    await startCard(other, { tipCents: 300 })
    expect(k.stripe.posts(`/v1/terminal/readers/${[...k.stripe.readers.keys()][0]}/process_payment_intent`).pop()!.params.get('process_config[skip_tipping]')).toBe('true')
    await as('owner', `/api/chair-checkout/charges/${(await t.db.select().from(S.salonTerminalCharge).where(eq(S.salonTerminalCharge.invoiceId, other)))[0].id}/cancel`, 'POST')
  })

  test('six polls at the same instant after the reader approves still write one payment', async () => {
    const sale = await visitSale()
    const started = (await startCard(sale, { tipCents: 500 })).body.charge
    const pi = [...k.stripe.intents.values()].pop()
    stripeTookIt(pi)   // the guest tapped; nobody has asked yet
    const polls = await Promise.all(Array.from({ length: 6 }, () => as('owner', `/api/chair-checkout/charges/${started.id}`)))
    expect(polls.every((p) => p.body.charge.status === 'succeeded')).toBe(true)
    const pays = await paymentsOf(sale)
    expect(pays).toHaveLength(1)
    expect(Number(pays[0].tipAmount)).toBe(5)
  })

  test('a decline takes nothing and leaves the sale open to try again; cancel and timeout take nothing either', async () => {
    const sale = await visitSale()
    const a = (await startCard(sale)).body.charge
    const declined = await tap(a.id, 'decline')
    expect(declined.body.charge).toMatchObject({ status: 'failed', failure: 'Your card was declined.' })
    expect(await paymentsOf(sale)).toHaveLength(0)
    expect((await invoiceOf(sale)).status).toBe('open')
    // Cancelled at the desk: the reader is stopped and the PaymentIntent cancelled.
    const b = (await startCard(sale)).body.charge
    const piB = [...k.stripe.intents.values()].pop()
    const cancelled = await as('owner', `/api/chair-checkout/charges/${b.id}/cancel`, 'POST')
    expect(cancelled.body.charge.status).toBe('canceled')
    expect(piB.status).toBe('canceled')
    // Left too long on the reader: given up, cancelled, nothing taken.
    const c = (await startCard(sale)).body.charge
    const piC = [...k.stripe.intents.values()].pop()
    await t.db.update(S.salonTerminalCharge).set({ createdAt: new Date(Date.now() - 10 * 60_000) }).where(eq(S.salonTerminalCharge.id, c.id))
    const late = await as('owner', `/api/chair-checkout/charges/${c.id}`)
    expect(late.body.charge.status).toBe('timed_out')
    expect(piC.status).toBe('canceled')
    expect(await paymentsOf(sale)).toHaveLength(0)
    // …and after all that the same sale still takes the card.
    const d = (await startCard(sale)).body.charge
    expect((await tap(d.id)).body.charge.status).toBe('succeeded')
    expect((await invoiceOf(sale)).status).toBe('paid')
  })

  test('cancelling a card that went through in the same instant records it instead of losing it', async () => {
    const sale = await visitSale()
    const c = (await startCard(sale)).body.charge
    const pi = [...k.stripe.intents.values()].pop()
    Object.assign(pi, { status: 'succeeded', amount_received: pi.amount })   // the reader still shows its action: cancelling it must not lose the money
    const out = await as('owner', `/api/chair-checkout/charges/${c.id}/cancel`, 'POST')
    expect(out.body.charge.status).toBe('succeeded')
    expect(await paymentsOf(sale)).toHaveLength(1)
  })

  test('an offline reader, a second card on the same sale, a wrong amount and a bad tip are all refused before any money moves', async () => {
    const sale = await visitSale()
    k.stripe.state.offline = true
    const intentsBefore = k.stripe.intents.size
    const offline = await startCard(sale)
    k.stripe.state.offline = false
    expect(offline.status).toBe(409)
    expect(offline.body.code ?? offline.body.error?.code).toBe('READER_UNAVAILABLE')
    expect([...k.stripe.intents.values()].filter((p) => p.status === 'requires_payment_method')).toHaveLength(0)   // the PaymentIntent it made was cancelled
    expect(k.stripe.intents.size).toBe(intentsBefore + 1)
    expect(await t.db.select().from(S.salonTerminalCharge).where(eq(S.salonTerminalCharge.invoiceId, sale))).toHaveLength(0)
    expect((await startCard(sale, { amountCents: 20 })).status).toBe(400)         // under 50 cents
    expect((await startCard(sale, { amountCents: 10001 })).status).toBe(400)      // more than is owing
    expect((await startCard(sale, { tipCents: -5 })).status).toBe(400)
    expect((await startCard(sale, { tipCents: 1.5 })).status).toBe(400)
    expect((await startCard('no-such-sale')).status).toBe(404)
    expect((await as('owner', '/api/chair-checkout/charges', 'POST', { invoiceId: sale, readerId: 'no-such-reader' })).status).toBe(404)
    const first = await startCard(sale, { amountCents: 4000 })
    expect(first.status).toBe(201)
    expect((await startCard(sale, { amountCents: 1000 })).status).toBe(409)      // one card at a time on a sale
    await as('owner', `/api/chair-checkout/charges/${first.body.charge.id}/cancel`, 'POST')
  })

  test('a split bill: cash, a gift card and the reader each take their part, and the sale closes once', async () => {
    await k.features([...FEATURES, 'chair_checkout', 'salon_reports', 'salon_gift_cards'])
    const sale = await visitSale()
    expect((await as('owner', `/api/invoices/${sale}/payments`, 'POST', { amount: 30, method: 'cash' })).status).toBeLessThan(300)
    const card = (await as('owner', '/api/salon-gift-cards/sell', 'POST', { amountCents: 2000, method: 'cash' })).body.card
    expect((await as('owner', '/api/salon-gift-cards/redeem', 'POST', { code: card.code, invoiceId: sale })).status).toBe(200)
    expect((await invoiceOf(sale)).status).toBe('partial')
    // The reader's default is what is still owing — $50 — and a tip on top.
    const c = (await startCard(sale, { tipCents: 1000 })).body.charge
    expect(c.amountCents).toBe(5000)
    expect((await tap(c.id)).body.charge.status).toBe('succeeded')
    const pays = await paymentsOf(sale)
    expect(pays.map((p) => [p.method, Number(p.amount), Number(p.tipAmount)]).sort()).toEqual([['card', 50, 10], ['cash', 30, 0], ['gift_card', 20, 0]])
    const inv = await invoiceOf(sale)
    expect(inv.status).toBe('paid')
    expect(Number(inv.amountPaid)).toBe(100)
  })

  test('a card taken after the sale was paid another way is recorded, not lost; a card taken on a voided sale is marked for a person to refund', async () => {
    const sale = await visitSale()
    const c = (await startCard(sale)).body.charge
    expect((await as('owner', `/api/invoices/${sale}/payments`, 'POST', { amount: 100, method: 'cash' })).status).toBeLessThan(300)
    expect((await tap(c.id)).body.charge.status).toBe('succeeded')           // Stripe took it: it is on the books
    expect((await paymentsOf(sale)).map((p) => p.method).sort()).toEqual(['card', 'cash'])

    const voided = await visitSale()
    const v = (await startCard(voided)).body.charge
    expect((await as('owner', `/api/invoices/${voided}/void`, 'POST', { reason: 'wrong client' })).status).toBeLessThan(300)
    const out = await tap(v.id)
    expect(out.body.charge.status).toBe('needs_review')
    expect(out.body.charge.failure).toContain('Refund it in Stripe')
    expect(await paymentsOf(voided)).toHaveLength(0)
  })

  test('a reader payment is refunded back to the card through Stripe on the salon\'s account — a refund written on the sale alone would send no money', async () => {
    const sale = await visitSale()
    const c = (await startCard(sale, { tipCents: 700 })).body.charge
    expect((await tap(c.id)).body.charge.status).toBe('succeeded')
    const [pay] = await paymentsOf(sale)
    const url = `/api/chair-checkout/payments/${pay.id}/refund`
    // The right a refund asks for is the owner's; a reason is required; more than the sale amount is refused.
    expect((await as('manager', url, 'POST', { reason: 'unhappy' })).status).toBe(403)
    expect((await as('owner', url, 'POST', {})).status).toBe(400)
    expect((await as('owner', url, 'POST', { reason: 'too much', amountCents: 10001 })).status).toBe(400)
    const part = await as('owner', url, 'POST', { reason: 'unhappy with the colour', amountCents: 4000 })
    expect(part.status).toBe(200)
    const sent = k.stripe.posts('/v1/refunds').pop()!
    expect(sent.params.get('payment_intent')).toBe(pay.reference)
    expect(sent.account).toBe('acct_biz')
    expect(Number(sent.params.get('amount'))).toBe(4000)
    expect(Number((await invoiceOf(sale)).amountRefunded)).toBe(40)
    // The rest comes back — and, because that makes the payment fully refunded, the $7 tip with it (follow-up 10/30); a third try finds nothing left.
    expect((await as('owner', url, 'POST', { reason: 'the rest' })).status).toBe(200)
    expect(Number(k.stripe.posts('/v1/refunds').pop()!.params.get('amount'))).toBe(6700)
    expect((await invoiceOf(sale)).status).toBe('refunded')
    expect((await as('owner', url, 'POST', { reason: 'again' })).status).toBe(409)
    // A payment that was not the reader's is not refunded here.
    const cash = await visitSale()
    expect((await as('owner', `/api/invoices/${cash}/payments`, 'POST', { amount: 100, method: 'cash' })).status).toBeLessThan(300)
    expect((await as('owner', `/api/chair-checkout/payments/${(await paymentsOf(cash))[0].id}/refund`, 'POST', { reason: 'x' })).status).toBe(404)
  })

  /** What the tips report says Ana took, net of tips given back. */
  const anaTips = async () => ((await as('owner', '/api/salon-reports/tips')).body.stylists as any[]).find((x) => x.id === ana)?.tips ?? 0
  /** A $100 reader payment with a $7 tip typed at the desk. */
  async function paidWithTip() {
    const sale = await visitSale()
    const c = (await startCard(sale, { tipCents: 700 })).body.charge
    expect((await tap(c.id)).body.charge.status).toBe('succeeded')
    return { sale, pay: (await paymentsOf(sale)).find((p: any) => Number(p.amount) > 0), url: '' }
  }

  test('a FULL refund to the card gives the tip back with it, and takes it off the stylist\'s tips — whether or not the person ticks anything', async () => {
    await k.features([...FEATURES, 'chair_checkout', 'salon_reports'])
    const before = await anaTips()
    const { sale, pay } = await paidWithTip()
    expect(await anaTips()).toBe(before + 7)
    const url = `/api/chair-checkout/payments/${pay.id}/refund`
    // Ticking "leave the tip" does not matter on a full refund: the whole payment goes back, tip included.
    const full = await as('owner', url, 'POST', { reason: 'client unhappy', includeTip: false })
    expect(full.status).toBe(200)
    expect([full.body.refundedCents, full.body.tipRefundedCents]).toEqual([10000, 700])
    const sent = k.stripe.posts('/v1/refunds').pop()!
    expect(sent.account).toBe('acct_biz')
    expect(Number(sent.params.get('amount'))).toBe(10700)                         // the sale AND the tip came off the card
    const rows = await paymentsOf(sale)
    const back = rows.find((p: any) => Number(p.amount) < 0)
    expect([Number(back.amount), Number(back.tipAmount)]).toEqual([-100, -7])       // the refund line carries the tip as a negative tip
    expect(await anaTips()).toBe(before)                                          // off the stylist's tips
    expect((await as('owner', url, 'POST', { reason: 'again' })).status).toBe(409)  // nothing is returned twice
  })

  test('a PARTIAL refund lets the person choose: without the tick the tip stays; with it the whole tip goes back once, and the last of the sale takes nothing more', async () => {
    const before = await anaTips()
    const { sale, pay } = await paidWithTip()
    const url = `/api/chair-checkout/payments/${pay.id}/refund`
    // Partial, tip left alone (the default).
    const keep = await as('owner', url, 'POST', { reason: 'goodwill', amountCents: 3000 })
    expect([keep.status, keep.body.tipRefundedCents, Number(k.stripe.posts('/v1/refunds').pop()!.params.get('amount'))]).toEqual([200, 0, 3000])
    expect(await anaTips()).toBe(before + 7)
    // Partial, tip chosen: $20 of the sale and the whole $7 tip.
    const withTip = await as('owner', url, 'POST', { reason: 'service redone', amountCents: 2000, includeTip: true })
    expect([withTip.status, withTip.body.tipRefundedCents, Number(k.stripe.posts('/v1/refunds').pop()!.params.get('amount'))]).toEqual([200, 700, 2700])
    expect(await anaTips()).toBe(before)
    // Choosing it again returns nothing more; the rest of the sale ($50) goes back with no second tip.
    const again = await as('owner', url, 'POST', { reason: 'a little more', amountCents: 1000, includeTip: true })
    expect([again.status, again.body.tipRefundedCents, Number(k.stripe.posts('/v1/refunds').pop()!.params.get('amount'))]).toEqual([200, 0, 1000])
    const rest = await as('owner', url, 'POST', { reason: 'the rest' })
    expect([rest.status, rest.body.tipRefundedCents, Number(k.stripe.posts('/v1/refunds').pop()!.params.get('amount'))]).toEqual([200, 0, 4000])
    const net = (await paymentsOf(sale)).reduce((n: number, p: any) => n + Number(p.tipAmount), 0)
    expect(net).toBe(0)                                                            // taken 7, returned 7 — once
    expect((await invoiceOf(sale)).status).toBe('refunded')
  })

  test('the sale\'s ordinary refund (cash, or a card taken some other way) follows the same rule: a full refund returns the tip, a partial one only when ticked', async () => {
    const before = await anaTips()
    const sale = await visitSale()
    expect((await as('owner', `/api/invoices/${sale}/payments`, 'POST', { amount: 100, method: 'cash', tipAmount: 10 })).status).toBeLessThan(300)
    expect(await anaTips()).toBe(before + 10)
    // Partial without the tick: tip stays. Partial with it: the $10 goes back. Then the rest of the sale: nothing more.
    const p1 = await as('owner', `/api/invoices/${sale}/refund`, 'POST', { amount: 30, reason: 'goodwill' })
    expect([p1.status, p1.body.tipReturned]).toEqual([200, 0])
    expect(await anaTips()).toBe(before + 10)
    const p2 = await as('owner', `/api/invoices/${sale}/refund`, 'POST', { amount: 20, reason: 'redo', returnTip: true })
    expect([p2.status, p2.body.tipReturned]).toEqual([200, 10])
    expect(await anaTips()).toBe(before)
    const rest = await as('owner', `/api/invoices/${sale}/refund`, 'POST', { amount: 50, reason: 'the rest' })
    expect([rest.status, rest.body.tipReturned]).toEqual([200, 0])
    // And a sale refunded in one go gives its tip back without being asked.
    const whole = await visitSale()
    expect((await as('owner', `/api/invoices/${whole}/payments`, 'POST', { amount: 100, method: 'cash', tipAmount: 12 })).status).toBeLessThan(300)
    const all = await as('owner', `/api/invoices/${whole}/refund`, 'POST', { amount: 100, reason: 'full' })
    expect([all.status, all.body.tipReturned]).toEqual([200, 12])
    expect(await anaTips()).toBe(before)
  })

  // 10/30 follow-up: a refund the owner makes in Stripe's OWN dashboard reaches us as charge.refunded (forwarded by the Factory).
  // The charge was the sale plus the tip, so a full refund there gives the tip back too — off the stylist's tips — as the app's
  // own refund does (tenant-backend payments/stripe.ts handleChargeRefunded); a part refund within the sale leaves the tip.
  test("a refund made in Stripe's own dashboard splits into the sale and the tip", async () => {
    await k.features([...FEATURES, 'chair_checkout', 'salon_reports'])
    process.env.FACTORY_SYNC_KEY = process.env.FACTORY_SYNC_KEY || 'factory-key'
    const refunded = (pi: string, amount: number, full: boolean) => t.call('/api/stripe/factory-event', {
      method: 'POST', headers: { 'X-Factory-Key': process.env.FACTORY_SYNC_KEY! },
      json: { event: { type: 'charge.refunded', account: 'acct_biz', data: { object: { id: `ch_${pi}`, payment_intent: pi, amount: 10700, amount_refunded: amount, refunded: full, metadata: {} } } } },
    })
    const before = await anaTips()
    // full: $107 back at Stripe
    const a = await paidWithTip()
    expect(await anaTips()).toBe(before + 7)
    k.stripe.dashboardRefund(a.pay.reference, 10700)
    expect((await refunded(a.pay.reference, 10700, true)).status).toBe(200)
    const backA = (await paymentsOf(a.sale)).filter((p: any) => Number(p.amount) < 0)
    expect(backA.map((p: any) => [Number(p.amount), Number(p.tipAmount)])).toEqual([[-100, -7]])
    expect((await invoiceOf(a.sale)).status).toBe('refunded')
    expect(await anaTips()).toBe(before)
    // the same event again (Stripe retries) records nothing more
    expect((await refunded(a.pay.reference, 10700, true)).status).toBe(200)
    expect((await paymentsOf(a.sale)).filter((p: any) => Number(p.amount) < 0)).toHaveLength(1)
    // part: $30 back at Stripe — all of it sale, the tip stays
    const b = await paidWithTip()
    k.stripe.dashboardRefund(b.pay.reference, 3000)
    expect((await refunded(b.pay.reference, 3000, false)).status).toBe(200)
    const backB = (await paymentsOf(b.sale)).filter((p: any) => Number(p.amount) < 0)
    expect(backB.map((p: any) => [Number(p.amount), Number(p.tipAmount || 0)])).toEqual([[-30, 0]])
    expect(await anaTips()).toBe(before + 7)
  })

  test('a reader from another Stripe account is not used; with no Stripe key on the server the desk is told so; a reader on a pending payment cannot be removed', async () => {
    const sale = await visitSale()
    await t.db.update(S.company).set({ integrations: { stripeAccountId: 'acct_other' } }).where(eq(S.company.id, co))
    t.services.features.forgetFeatures()
    const wrong = await startCard(sale)
    expect(wrong.status).toBe(409)
    await t.db.update(S.company).set({ integrations: { stripeAccountId: 'acct_biz' } }).where(eq(S.company.id, co))
    t.services.features.forgetFeatures()
    // No platform Stripe: no key, and no client handed in (this suite hands one in for the dashboard-refund webhook).
    const key = process.env.STRIPE_SECRET_KEY
    const handed = (t.services.crm as any).testStripeClient
    delete process.env.STRIPE_SECRET_KEY
    ;(t.services.crm as any).testStripeClient = undefined
    const none = await startCard(sale)
    process.env.STRIPE_SECRET_KEY = key
    ;(t.services.crm as any).testStripeClient = handed
    expect(none.status).toBe(503)
    const c = (await startCard(sale)).body.charge
    expect((await as('owner', `/api/chair-checkout/readers/${readerId}`, 'DELETE')).status).toBe(409)
    await as('owner', `/api/chair-checkout/charges/${c.id}/cancel`, 'POST')
    expect((await as('owner', `/api/chair-checkout/readers/${readerId}`, 'DELETE')).status).toBe(200)
  })
})

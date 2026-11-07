// Checkout at the chair on the PHONE (salon parity row 26; Square): Tap to Pay (tap_to_pay, hidden) takes the visit's sale and its tip on the stylist's
// or the desk's phone, into the SALON'S OWN Stripe account, through the very charge the card reader uses (server/crm/salon/chairCheckout.ts): the
// phone gets the PaymentIntent's client secret, taps, and asks; nothing is recorded until Stripe says the PaymentIntent succeeded (polled twice,
// written once); a decline the phone saw is sent back and the PaymentIntent cancelled; part on the card and part another way is a split; the
// refund to the card is the reader's. The fake in foodKit.ts answers Stripe's API as Stripe documents it — nothing leaves the machine.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootFood } from './foodKit.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'invoices', 'chair_checkout']

describe('salon: Tap to Pay at the chair, on the phone', () => {
  let k: Awaited<ReturnType<typeof bootFood>>
  let t: any, S: any, co = '', ana = '', cut = ''
  let ip = 0, hour = 7
  const as = async (who: 'owner' | 'manager' | 'bartender', path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${k.tokens[who]}`, 'x-forwarded-for': `10.11.0.${++ip}`, host: 'bar.test' } })
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
  /** A completed $100 cut by Ana: the visit and the sale it raised. */
  async function visitSale(): Promise<{ appointmentId: string; invoiceId: string }> {
    const client = await ins(S.contact, { companyId: co, name: `Client ${ip}`, email: `tap${ip}-${hour}@example.com`, type: 'client' })
    hour += 1
    const made = await as('owner', '/api/appointments', 'POST', { contactId: client.id, startTime: wall(day, `${String(hour).padStart(2, '0')}:00`), serviceId: cut, stylistId: ana })
    expect(made.status).toBe(201)
    expect((await as('owner', `/api/appointments/${made.body.id}`, 'PUT', { status: 'completed' })).status).toBe(200)
    const [inv] = await t.db.select().from(S.invoice).where(eq(S.invoice.appointmentId, made.body.id))
    return { appointmentId: made.body.id, invoiceId: inv.id }
  }
  const invoiceOf = async (id: string) => (await t.db.select().from(S.invoice).where(eq(S.invoice.id, id)))[0]
  const paymentsOf = async (id: string) => (await t.db.select().from(S.payment).where(eq(S.payment.invoiceId, id))) as any[]
  const phoneCharge = (invoiceId: string, extra: Record<string, unknown> = {}, who: 'owner' | 'manager' = 'owner') => as(who, '/api/chair-checkout/phone/charges', 'POST', { invoiceId, ...extra })
  /** The client tapped on the phone and Stripe confirmed it (the SDK's processPaymentIntent): the PaymentIntent succeeded. */
  const tapped = (piId: string) => { const pi = k.stripe.intents.get(piId); Object.assign(pi, { status: 'succeeded', amount_received: pi.amount }) }
  const piOf = (secret: string) => [...k.stripe.intents.values()].find((p: any) => p.client_secret === secret)

  beforeAll(async () => {
    k = await bootFood({ vertical: 'salon', features: FEATURES, sharedStripe: true })
    t = k.t; S = k.S; co = k.companyId
    await t.db.update(S.company).set({ timezone: TZ }).where(eq(S.company.id, co))
    ana = (await ins(S.user, { email: 'ana@test.example', passwordHash: await Bun.password.hash('Ana-pass-1', 'bcrypt'), firstName: 'Ana', lastName: 'Stylist', role: 'field', companyId: co })).id
    cut = (await as('owner', '/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 100 })).body.id
  }, 120_000)
  afterAll(() => k.restore())

  test('closed without Tap to Pay; with it, a stylist (no card right) still cannot; the token is on the salon’s own account', async () => {
    const { invoiceId } = await visitSale()
    const off = await phoneCharge(invoiceId)
    expect([off.status, off.body.code]).toEqual([403, 'FEATURE_NOT_ENABLED'])
    await k.features([...FEATURES, 'tap_to_pay'])
    expect((await as('bartender', '/api/chair-checkout/phone/connection-token', 'POST')).status).toBe(403)
    expect((await as('bartender', '/api/chair-checkout/phone/charges', 'POST', { invoiceId })).status).toBe(403)
    const before = k.stripe.calls.length
    const tok = await as('manager', '/api/chair-checkout/phone/connection-token', 'POST')
    expect(tok.status).toBe(200)
    expect(tok.body.secret).toMatch(/^pst_test_/)
    expect(tok.body.locationId).toMatch(/^tml_/)
    expect(k.stripe.calls.slice(before).every((c) => c.account === 'acct_biz')).toBe(true)
  })

  test('the finished visit’s sale; the tap with a tip is recorded once, only when Stripe says it succeeded', async () => {
    const { appointmentId, invoiceId } = await visitSale()
    const sale = await as('manager', `/api/chair-checkout/visits/${appointmentId}/sale`)
    expect(sale.body).toMatchObject({ invoiceId, balanceCents: 10000, status: 'open' })
    expect((await as('manager', '/api/chair-checkout/visits/nope/sale')).body.code).toBe('NO_SALE')
    const started = await phoneCharge(invoiceId, { tipCents: 1500, key: 'k1' }, 'manager')
    expect(started.status).toBe(201)
    expect(started.body.charge).toMatchObject({ status: 'pending', amountCents: 10000, tipCents: 1500, source: 'phone', readerId: null, readerLabel: 'Tap to Pay on the phone' })
    const pi = piOf(started.body.charge.clientSecret)
    expect([pi.amount, pi.payment_method_types, pi.metadata.twomiah_invoice, pi.metadata.twomiah_source]).toEqual([11500, ['card_present'], invoiceId, 'phone'])
    // the same press again (a dropped answer): the same PaymentIntent and charge, not a second
    const again = await phoneCharge(invoiceId, { tipCents: 1500, key: 'k1' }, 'manager')
    expect([again.status, again.body.charge.id, again.body.charge.clientSecret]).toEqual([201, started.body.charge.id, started.body.charge.clientSecret])
    // asked before the tap: still pending, nothing recorded on the phone's word
    expect((await as('manager', `/api/chair-checkout/charges/${started.body.charge.id}`)).body.charge.status).toBe('pending')
    expect(await paymentsOf(invoiceId)).toHaveLength(0)
    tapped(pi.id)
    const done = await as('manager', `/api/chair-checkout/charges/${started.body.charge.id}`)
    expect(done.body.charge.status).toBe('succeeded')
    for (let i = 0; i < 3; i++) await as('manager', `/api/chair-checkout/charges/${started.body.charge.id}`)
    const pays = await paymentsOf(invoiceId)
    expect(pays.map((p) => [p.method, p.reference, Number(p.amount), Number(p.tipAmount), p.notes])).toEqual([['card', pi.id, 100, 15, 'Tap to Pay (phone)']])
    expect((await invoiceOf(invoiceId)).status).toBe('paid')
    // a paid sale takes no more
    expect((await phoneCharge(invoiceId, { key: 'k2' })).body.code).toBe('SALE_CLOSED')
  })

  test('a decline the phone saw: the card network’s words, the PaymentIntent cancelled, nothing recorded; a new tap after it works', async () => {
    const { invoiceId } = await visitSale()
    const first = await phoneCharge(invoiceId, { key: 'd1' })
    const declined = await as('owner', `/api/chair-checkout/phone/charges/${first.body.charge.id}/declined`, 'POST', { message: 'Your card was declined.' })
    expect(declined.body.charge).toMatchObject({ status: 'failed', failure: 'Your card was declined.' })
    expect(piOf(first.body.charge.clientSecret).status).toBe('canceled')
    expect(await paymentsOf(invoiceId)).toHaveLength(0)
    const second = await phoneCharge(invoiceId, { key: 'd2' })
    expect(second.status).toBe(201)
    tapped(piOf(second.body.charge.clientSecret).id)
    expect((await as('owner', `/api/chair-checkout/charges/${second.body.charge.id}`)).body.charge.status).toBe('succeeded')
    // the phone lost the answer and called it declined, but Stripe has it: it is recorded, not cancelled
    const third = await visitSale()
    const late = await phoneCharge(third.invoiceId, { key: 'd3' })
    tapped(piOf(late.body.charge.clientSecret).id)
    const said = await as('owner', `/api/chair-checkout/phone/charges/${late.body.charge.id}/declined`, 'POST', { message: 'Connection lost' })
    expect(said.body.charge.status).toBe('succeeded')
    expect(await paymentsOf(third.invoiceId)).toHaveLength(1)
  })

  test('a split: part on the phone, the rest in cash; a payment left waiting by this person is let go, another person’s is not taken over', async () => {
    const { invoiceId } = await visitSale()
    const part = await phoneCharge(invoiceId, { amountCents: 6000, key: 's1' })
    expect((await phoneCharge(invoiceId, { amountCents: 20000, key: 's9' })).body.code).toBe('OVER_DUE')
    // the manager can't start another while the owner's is waiting
    expect((await phoneCharge(invoiceId, { amountCents: 6000, key: 'm1' }, 'manager')).body.code).toBe('ALREADY_PENDING')
    // the owner closed the app mid-tap and starts again: the old one is let go
    const restart = await phoneCharge(invoiceId, { amountCents: 6000, key: 's2' })
    expect(restart.body.charge.id).not.toBe(part.body.charge.id)
    expect((await as('owner', `/api/chair-checkout/charges/${part.body.charge.id}`)).body.charge.status).toBe('canceled')
    tapped(piOf(restart.body.charge.clientSecret).id)
    expect((await as('owner', `/api/chair-checkout/charges/${restart.body.charge.id}`)).body.charge.status).toBe('succeeded')
    expect((await invoiceOf(invoiceId)).status).toBe('partial')
    expect((await as('owner', `/api/chair-checkout/visits/${(await invoiceOf(invoiceId)).appointmentId}/sale`)).body.balanceCents).toBe(4000)
  })

  test('the refund to the card is the reader’s: through Stripe on the salon’s account, then on the sale', async () => {
    const { invoiceId } = await visitSale()
    const c = await phoneCharge(invoiceId, { key: 'r1', tipCents: 1000 })
    tapped(piOf(c.body.charge.clientSecret).id)
    const done = await as('owner', `/api/chair-checkout/charges/${c.body.charge.id}`)
    const r = await as('owner', `/api/chair-checkout/payments/${done.body.charge.paymentId}/refund`, 'POST', { reason: 'Unhappy with the cut' })
    expect(r.status).toBe(200)
    expect([r.body.refundedCents, r.body.tipRefundedCents]).toEqual([10000, 1000])
    expect((await invoiceOf(invoiceId)).status).toBe('refunded')
  })
})

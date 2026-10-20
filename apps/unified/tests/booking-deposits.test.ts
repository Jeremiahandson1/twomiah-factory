// Card deposits for bookings, through the real server against a fake Stripe (booking/deposits.ts, payments/stripe.ts
// createBookingDepositCheckout and onBookingDeposit). The deposit is taken on the business's CONNECTED account and
// nowhere else; without one the booking stands without a deposit. The customer goes to Stripe's page and back to
// their booking; Stripe's payment, forwarded by the Factory (/api/stripe/factory-event), confirms it; a late payment
// for a time someone else took is refunded on the business's account; the customer can open the page again.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { addDays, tzParts } from '@twomiah/tenant-backend'

/** A fake Stripe: what the payment code asked of it, and on which account. */
const calls: Array<{ what: string; args: any; opts: any }> = []
let made = 0
const fakeStripe = {
  checkout: { sessions: { create: async (args: any, opts: any) => { calls.push({ what: 'checkout', args, opts }); made++; return { id: 'cs_' + made, url: 'https://checkout.stripe.com/c/pay/cs_' + made } } } },
  refunds: { create: async (args: any, opts: any) => { calls.push({ what: 'refund', args, opts }); return { id: 're_1' } } },
}

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', owner = '', day = ''
const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const row = async (token: string) => (await t.db.select().from(t.schema.booking).where(eq(t.schema.booking.token, token)))[0]
const book = (time: string, email = 'pat@example.com') => t.call('/api/book/services/consultation', { method: 'POST', json: { date: day, time, name: 'Pat Jones', email, phone: '608-555-0100', address: '12 Main St', zip: '53593' } })
const paid = (bookingId: string, pi: string) => t.call('/api/stripe/factory-event', {
  method: 'POST', headers: { 'X-Factory-Key': 'factory-key' },
  json: { event: { type: 'payment_intent.succeeded', account: 'acct_biz', data: { object: { id: pi, amount: 2500, metadata: { booking_id: bookingId, company_id: companyId, kind: 'booking_deposit' } } } } },
})

beforeAll(async () => {
  process.env.FACTORY_SYNC_KEY = 'factory-key'
  process.env.SITE_URL = 'https://acme.example'
  t = await bootTenant({ stripe: fakeStripe })
  const s = await seedOwner(t)
  companyId = s.company.id
  owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  await as('/api/company/features', { method: 'PUT', json: { features: ['online_booking'] } })
  await as('/api/booking/settings', { method: 'PATCH', json: { timezone: 'America/Chicago', leadTimeMinutes: 60, maxDaysOut: 30 } })
  await as('/api/booking/services', { method: 'POST', json: { name: 'Consultation', durationMinutes: 60, price: 100, depositPercent: 25, slotStepMinutes: 60 } })
  await as('/api/booking/hours', { method: 'PUT', json: { hours: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, start: '08:00', end: '16:00' })) } })
  let d = addDays(tzParts(new Date(), 'America/Chicago').date, 3)
  while ([0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())) d = addDays(d, 1)
  day = d
})

describe('without a connected Stripe account', () => {
  test('no deposit is taken anywhere — the booking stands without one', async () => {
    const r = await book('08:00')
    expect(r.status).toBe(201)
    const body = await r.json()
    expect(body.deposit).toBeNull()
    expect(calls).toEqual([])
    const b = await row(body.token)
    expect([b.status, b.depositStatus]).toEqual(['confirmed', 'none'])
  })
})

describe('with the business\'s own connected account', () => {
  beforeAll(async () => {
    await t.db.update(t.schema.company).set({ integrations: { stripeAccountId: 'acct_biz' } }).where(eq(t.schema.company.id, companyId))
  })

  test('the customer is sent to Stripe\'s page for the deposit, on the business\'s account, and back to their booking', async () => {
    const r = await book('09:00')
    const body = await r.json()
    expect(body.status).toBe('pending')
    expect(body.deposit).toEqual({ amount: 25, url: 'https://checkout.stripe.com/c/pay/cs_1' })
    const c = calls.at(-1)!
    expect(c.what).toBe('checkout')
    expect(c.opts).toEqual({ stripeAccount: 'acct_biz' })
    expect(c.args.line_items[0].price_data.unit_amount).toBe(2500)
    expect(c.args.payment_intent_data.metadata).toMatchObject({ booking_id: (await row(body.token)).id, company_id: companyId, kind: 'booking_deposit' })
    expect(c.args.success_url).toBe(`https://acme.example/booking/${body.token}?deposit=paid`)
    expect(c.args.cancel_url).toBe(`https://acme.example/booking/${body.token}?deposit=cancelled`)
    // Stripe's own minimum for a payment page is 30 minutes; the booking's hold is 30
    expect(c.args.expires_at * 1000 - Date.now()).toBeGreaterThan(30 * 60_000)
    // The booking's page shows what is owed and the way to pay it
    const page = await (await t.call(`/booking/${body.token}`)).text()
    expect(page).toContain('Pay the $25 deposit')
    expect(page).toContain('not paid yet')
  })

  test('Stripe\'s payment, forwarded by the Factory, confirms the booking; told twice, once', async () => {
    const token = (await (await book('10:00')).json()).token
    const b = await row(token)
    const r = await paid(b.id, 'pi_10')
    expect(r.status).toBe(200)
    const after = await row(token)
    expect([after.status, after.depositStatus, after.paymentIntentId]).toEqual(['confirmed', 'paid', 'pi_10'])
    expect((await paid(b.id, 'pi_10')).status).toBe(200)
    expect((await row(token)).depositStatus).toBe('paid')
    expect(await (await t.call(`/booking/${token}?deposit=paid`)).text()).toContain('your deposit is paid')
    // the Factory's key is required
    expect((await t.call('/api/stripe/factory-event', { method: 'POST', json: { event: { type: 'payment_intent.succeeded', data: { object: {} } } } })).status).toBe(401)
  })

  test('paid after its hold ran out and the time was taken: refunded on the business\'s account', async () => {
    const token = (await (await book('11:00')).json()).token
    const b = await row(token)
    // the hold runs out (as if 31 minutes had passed) and someone else books that hour
    await t.db.update(t.schema.booking).set({ createdAt: new Date(Date.now() - 31 * 60_000) }).where(eq(t.schema.booking.id, b.id))
    await t.call(`/api/book/services/consultation/times?date=${day}`)
    expect((await row(token)).status).toBe('cancelled')
    await t.db.update(t.schema.company).set({ integrations: {} }).where(eq(t.schema.company.id, companyId))
    expect((await book('11:00', 'other@example.com')).status).toBe(201)
    await t.db.update(t.schema.company).set({ integrations: { stripeAccountId: 'acct_biz' } }).where(eq(t.schema.company.id, companyId))
    calls.length = 0
    expect((await paid(b.id, 'pi_11')).status).toBe(200)
    expect(calls).toEqual([{ what: 'refund', args: { payment_intent: 'pi_11' }, opts: { stripeAccount: 'acct_biz' } }])
    const after = await row(token)
    expect([after.status, after.depositStatus]).toEqual(['cancelled', 'refunded'])
  })

  test('the customer opens the payment page again from their booking; once the hold is gone, they are told', async () => {
    const token = (await (await book('12:00')).json()).token
    calls.length = 0
    const again = await t.call(`/booking/${token}/pay`)
    expect(again.status).toBe(303)
    expect(again.headers.get('location')).toMatch(/^https:\/\/checkout\.stripe\.com\//)
    expect(calls.map((c) => c.what)).toEqual(['checkout'])
    const b = await row(token)
    await t.db.update(t.schema.booking).set({ createdAt: new Date(Date.now() - 31 * 60_000) }).where(eq(t.schema.booking.id, b.id))
    const late = await t.call(`/booking/${token}/pay`)
    expect(late.status).toBe(303)
    expect(decodeURIComponent(late.headers.get('location')!)).toContain('please book again')
  })
})

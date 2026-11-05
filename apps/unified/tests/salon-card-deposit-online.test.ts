// Card, deposit and prepayment at online booking (salon parity row 5; Fresha, Square Appointments, Boulevard).
//   • a service with a deposit ALSO keeps the card for the fee policy — on ONE Stripe page, after the client ticks the policy;
//   • a service can take its whole price at booking ("Take the full price online"), on the salon's own Stripe, and the visit's sale
//     is already paid at the chair;
//   • a card that arrives after the hold ran out restores the booking when its time is still free, else the client is told in
//     words and offered times.
// Real server, fake Stripe (the salon's own connected account).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const weekdayOf = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
function next(dow: number, ahead = 3) { let d = addDays(today(), ahead); while (weekdayOf(d) !== dow) d = addDays(d, 1); return d }

let made = 0
const sessionCalls: Array<{ args: any; opts: any }> = []
const sessionMeta: Record<string, Record<string, string>> = {}
const sessionMode: Record<string, string> = {}
const fakeStripe = {
  customers: { retrieve: async (id: string) => ({ id, deleted: false }), create: async () => ({ id: 'cus_1' }) },
  checkout: {
    sessions: {
      create: async (args: any, opts: any) => {
        sessionCalls.push({ args, opts }); made++
        const id = 'cs_' + made; sessionMeta[id] = args.metadata; sessionMode[id] = args.mode
        return { id, url: `https://checkout.stripe.com/c/${args.mode}/${id}` }
      },
      retrieve: async (id: string) => sessionMode[id] === 'payment'
        ? { id, mode: 'payment', customer: 'cus_1', metadata: sessionMeta[id], payment_intent: { payment_method: { id: 'pm_' + id, type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2031 } } } }
        : { id, mode: 'setup', customer: 'cus_x', metadata: sessionMeta[id], setup_intent: { payment_method: { id: 'pm_' + id, type: 'card', card: { brand: 'visa', last4: '1111', exp_month: 12, exp_year: 2031 } } } },
    },
  },
  refunds: { create: async () => ({ id: 're_1' }) },
  paymentIntents: { retrieve: async () => ({ metadata: {} }), create: async () => { throw new Error('nothing is charged at booking') } },
}

describe('salon: card, deposit and prepayment at online booking', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = ''
  const owner = { token: '' }
  const as = async (path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${owner.token}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  let ip = 0, hour = 8
  const day = next(2, 5)
  const online = async (slug: string, email: string, time?: string) => {
    hour += 1; ip += 1
    const r = await t.call(`/api/book/services/${slug}`, { method: 'POST', headers: { 'x-forwarded-for': `10.7.0.${ip}` }, json: { date: day, time: time ?? `${String(hour).padStart(2, '0')}:00`, name: 'Online Client', email, phone: '608-555-0170' } })
    return { status: r.status, body: (await r.json()) as any }
  }
  // the client came in: the visit is today (a future visit can't be closed)
  const cameIn = (id: string) => t.db.update(t.schema.appointment).set({ startTime: new Date(Date.now() - 3600_000), endTime: new Date(Date.now() - 1800_000) } as any).where(eq(t.schema.appointment.id, id))
  const bookingOf = async (token: string) => (await t.db.select().from(t.schema.booking).where(eq(t.schema.booking.token, token)))[0]
  const policy = (cardRequirement: string) => as('/api/card-on-file/policy', 'PUT', { cardRequirement, noShowFeeAmount: 20 })
  // anyone looking at the day's times releases a hold that ran out
  const release = () => t.call(`/api/book/services/cut/times?date=${day}`, { headers: { 'x-forwarded-for': '10.8.0.1' } })
  const page = async (token: string, query = '') => { const r = await t.call(`/booking/${token}${query}`); return { status: r.status, html: await r.text() } }
  const post = (path: string, body: Record<string, string>) => t.call(path, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() } as any)
  const factory = (event: any) => t.call('/api/stripe/factory-event', { method: 'POST', headers: { 'X-Factory-Key': 'factory-key' }, json: { event: { account: 'acct_salon', ...event } } })
  const deposit = (bookingId: string, pi: string, cents: number) => factory({ type: 'payment_intent.succeeded', data: { object: { id: pi, amount: cents, metadata: { booking_id: bookingId, company_id: co, kind: 'booking_deposit' } } } })
  const depositSession = (sid: string) => factory({ type: 'checkout.session.completed', data: { object: { id: sid, mode: 'payment', metadata: sessionMeta[sid] } } })
  const cardSession = (sid: string) => factory({ type: 'checkout.session.completed', data: { object: { id: sid, mode: 'setup', metadata: sessionMeta[sid] } } })

  beforeAll(async () => {
    process.env.FACTORY_SYNC_KEY = 'factory-key'
    process.env.SITE_URL = 'https://acme.example'
    t = await bootTenant({ vertical: 'salon', stripe: fakeStripe })
    const s = await seedOwner(t)
    co = s.company.id
    owner.token = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    await t.db.update(t.schema.company).set({ timezone: TZ, email: 'salon@example.com', integrations: { stripeAccountId: 'acct_salon' }, enabledFeatures: ['online_booking', 'contacts', 'client_profiles', 'salon_booking', 'service_menu', 'card_on_file', 'invoices'] } as any).where(eq(t.schema.company.id, co))
    t.services.features.forgetFeatures()
    expect((await as('/api/booking/settings', 'PATCH', { enabled: true, leadTimeMinutes: 0 })).status).toBe(200)
    expect((await as('/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 40, bookableOnline: true })).status).toBe(201)
    expect((await as('/api/service-menu', 'POST', { name: 'Blowout', category: 'hair', durationMin: 30, price: 60, bookableOnline: true, prepayOnline: true })).status).toBe(201)
    const [cut] = await t.db.select().from(t.schema.bookingService).where(eq(t.schema.bookingService.slug, 'cut'))
    expect((await as(`/api/booking/services/${cut.id}`, 'PATCH', { depositPercent: 25 })).status).toBe(200)
  }, 120_000)

  test('a deposit AND a card to keep: one Stripe page, after the client ticks the policy', async () => {
    expect((await policy('all')).status).toBe(200)
    const r = await online('cut', 'both@example.com')
    expect(r.status).toBe(201)
    expect(r.body.needsCard).toBe(true)
    expect(r.body.deposit).toBeNull()                   // no Stripe page yet: the policy comes first
    expect(sessionCalls).toHaveLength(0)
    const row = await bookingOf(r.body.token)
    expect([row.status, row.depositStatus, row.depositAmount, row.keepCard]).toEqual(['pending', 'pending', '10.00', true])
    // the booking's page: the policy in words, the tick, one button for both
    const p = await page(r.body.token)
    expect(p.html).toContain('no-show fee of $20')
    expect(p.html).toContain('Pay the $10 deposit and keep my card')
    expect(p.html).toMatch(/<form[^>]*action="\/booking\/[^"]+\/pay"/)
    // no way round the tick: the link, and the form without it, open nothing
    const viaLink = await t.call(`/booking/${r.body.token}/pay`, { redirect: 'manual' } as any)
    expect(viaLink.headers.get('location')).toContain('error=')
    const noTick = await post(`/booking/${r.body.token}/pay`, {})
    expect(noTick.headers.get('location')).toContain('error=')
    expect(sessionCalls).toHaveLength(0)
    // with the tick: ONE page, a payment that keeps the card, on the salon's own account
    const go = await post(`/booking/${r.body.token}/pay`, { agree: '1' })
    expect(go.status).toBe(303)
    expect(go.headers.get('location')).toStartWith('https://checkout.stripe.com/c/payment/')
    expect(sessionCalls).toHaveLength(1)
    const { args, opts } = sessionCalls[0]
    expect(opts.stripeAccount).toBe('acct_salon')
    expect([args.mode, args.customer, args.payment_intent_data.setup_future_usage, args.metadata.save_card]).toEqual(['payment', 'cus_1', 'off_session', '1'])
    expect(args.line_items[0].price_data.unit_amount).toBe(1000)
    const sid = go.headers.get('location')!.split('/').pop()!
    // Stripe: the page finished — the card is kept with the client's agreement, and the deposit confirms the booking
    expect((await depositSession(sid)).status).toBe(200)
    const card = (await t.db.select().from(t.schema.clientCard)).find((c: any) => c.paymentMethodId === 'pm_' + sid)!
    expect([card.consentVia, card.last4, card.contactId]).toEqual(['client_online', '4242', row.contactId])
    expect(card.consentText).toContain('no-show fee of $20')
    expect((await deposit(row.id, 'pi_both', 1000)).status).toBe(200)
    const after = await bookingOf(r.body.token)
    expect([after.status, after.depositStatus]).toEqual(['confirmed', 'paid'])
    // Stripe repeating the card event keeps one card
    await depositSession(sid)
    expect((await t.db.select().from(t.schema.clientCard)).filter((c: any) => c.paymentMethodId === 'pm_' + sid)).toHaveLength(1)
  })

  test('a client with a card already, or a salon that asks for none, pays the deposit alone — straight to Stripe, nothing kept', async () => {
    sessionCalls.length = 0
    const again = await online('cut', 'both@example.com')                   // the client above, now with a card
    expect(again.body.needsCard).toBeUndefined()
    expect(again.body.deposit.url).toStartWith('https://checkout.stripe.com/c/payment/')
    expect(sessionCalls[0].args.payment_intent_data.setup_future_usage).toBeUndefined()
    expect(sessionCalls[0].args.metadata.save_card).toBeUndefined()
    expect((await policy('off')).status).toBe(200)
    sessionCalls.length = 0
    const off = await online('cut', 'plain-deposit@example.com')
    expect(off.body.needsCard).toBeUndefined()
    expect(off.body.deposit.url).toContain('checkout.stripe.com')
    expect(sessionCalls[0].args.customer).toBeUndefined()
    expect((await bookingOf(off.body.token)).keepCard).toBe(false)
  })

  test('"Take the full price online": a fixed price only; the whole price is asked on Stripe; the visit\'s sale is already paid at the chair', async () => {
    // refused on a "from" price and on no price
    const from = await as('/api/service-menu', 'POST', { name: 'Colour', category: 'colour', durationMin: 60, price: 120, priceIsFrom: true, bookableOnline: true, prepayOnline: true })
    expect([from.status, from.body.code]).toEqual([400, 'PREPAY_NEEDS_PRICE'])
    expect(from.body.error ?? from.body.message).toContain('"from" price')
    const none = await as('/api/service-menu', 'POST', { name: 'Free chat', category: 'other', durationMin: 15, bookableOnline: true, prepayOnline: true })
    expect([none.status, none.body.code]).toEqual([400, 'PREPAY_NEEDS_PRICE'])
    const menu = (await as('/api/service-menu')).body
    const blowout = (menu.data ?? menu).find((m: any) => m.name === 'Blowout')
    expect((await as(`/api/service-menu/${blowout.id}`, 'PUT', { priceIsFrom: true })).status).toBe(400)
    // booking it: the whole price, said as a payment (not a deposit)
    sessionCalls.length = 0
    const r = await online('blowout', 'prepay@example.com')
    expect(r.status).toBe(201)
    expect(r.body.deposit.url).toStartWith('https://checkout.stripe.com/c/payment/')
    expect(sessionCalls[0].args.line_items[0].price_data.unit_amount).toBe(6000)
    expect(sessionCalls[0].args.line_items[0].price_data.product_data.name).toBe('Payment for Blowout')
    const row = await bookingOf(r.body.token)
    expect(row.depositAmount).toBe('60.00')
    expect((await page(r.body.token)).html).toContain('Pay $60')
    // paid → confirmed
    expect((await deposit(row.id, 'pi_prepay', 6000)).status).toBe(200)
    expect((await bookingOf(r.body.token)).status).toBe('confirmed')
    // the visit is closed: its sale carries the online payment, so nothing is left to take
    const appt = (await t.db.select().from(t.schema.appointment).where(eq(t.schema.appointment.id, row.appointmentId as string)))[0]
    await cameIn(appt.id)
    expect((await as(`/api/appointments/${appt.id}`, 'PUT', { status: 'completed' })).status).toBe(200)
    const [inv] = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.appointmentId, appt.id))
    expect([inv.status, inv.amountPaid, inv.total]).toEqual(['paid', '60.00', '60.00'])
    const pays = await t.db.select().from(t.schema.payment).where(eq(t.schema.payment.invoiceId, inv.id))
    expect(pays.map((p: any) => [p.method, p.reference, p.amount])).toEqual([['card', 'pi_prepay', '60.00']])
    // closing again, or the completion running twice, never pays it twice
    await as(`/api/appointments/${appt.id}`, 'PUT', { status: 'completed' })
    expect((await t.db.select().from(t.schema.payment).where(eq(t.schema.payment.invoiceId, inv.id)))).toHaveLength(1)
  })

  test('a deposit on a service without full prepayment is credited to the visit\'s sale too — only the rest is owed at the chair', async () => {
    const r = await online('cut', 'deposit-credit@example.com')
    const row = await bookingOf(r.body.token)
    expect(row.depositAmount).toBe('10.00')
    await deposit(row.id, 'pi_dep', 1000)
    const appt = (await t.db.select().from(t.schema.appointment).where(eq(t.schema.appointment.id, row.appointmentId as string)))[0]
    await cameIn(appt.id)
    expect((await as(`/api/appointments/${appt.id}`, 'PUT', { status: 'completed' })).status).toBe(200)
    const [inv] = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.appointmentId, appt.id))
    expect([inv.status, inv.amountPaid, inv.total]).toEqual(['partial', '10.00', '40.00'])
  })

  test('a card that arrives after the hold ran out: the booking comes back when its time is still free', async () => {
    expect((await policy('all')).status).toBe(200)
    const [cutSvc] = await t.db.select().from(t.schema.bookingService).where(eq(t.schema.bookingService.slug, 'cut'))
    await as(`/api/booking/services/${cutSvc.id}`, 'PATCH', { depositPercent: null })
    const r = await online('cut', 'late@example.com')
    expect(r.body.needsCard).toBe(true)
    const row0 = await bookingOf(r.body.token)
    await t.db.update(t.schema.booking).set({ createdAt: new Date(Date.now() - 3 * 3600_000) } as any).where(eq(t.schema.booking.token, r.body.token))
    await release()
    expect((await bookingOf(r.body.token)).status).toBe('cancelled')
    const sid = 'cs_late_free'; sessionMeta[sid] = { kind: 'card_on_file', company_id: co, contact_id: row0.contactId as string, booking_token: r.body.token, consent_via: 'client_online' }
    sessionMode[sid] = 'setup'
    expect((await cardSession(sid)).status).toBe(200)
    const back = await bookingOf(r.body.token)
    expect([back.status, back.depositStatus, back.cancelledReason]).toEqual(['confirmed', 'none', null])
    // and its visit is on the Book again
    const appt = (await t.db.select().from(t.schema.appointment).where(eq(t.schema.appointment.id, row0.appointmentId as string)))[0]
    expect(appt.status).toBe('scheduled')
    expect((await page(r.body.token, '?card=saved')).html).toContain('your booking is confirmed')
  })

  test('…and when someone took the time meanwhile, the card is kept, the booking stays released, and the client is told with times to choose', async () => {
    const r = await online('cut', 'later@example.com')
    const row0 = await bookingOf(r.body.token)
    await t.db.update(t.schema.booking).set({ createdAt: new Date(Date.now() - 3 * 3600_000) } as any).where(eq(t.schema.booking.token, r.body.token))
    await release()
    expect((await bookingOf(r.body.token)).status).toBe('cancelled')
    // someone else books exactly that time
    const when = tzParts(row0.startAt, TZ)
    const hm = `${String(Math.floor(when.minutes / 60)).padStart(2, '0')}:${String(when.minutes % 60).padStart(2, '0')}`
    const taken = await online('cut', 'thief@example.com', hm)
    expect(taken.status).toBe(201)
    const sid = 'cs_late_taken'; sessionMeta[sid] = { kind: 'card_on_file', company_id: co, contact_id: row0.contactId as string, booking_token: r.body.token, consent_via: 'client_online' }
    sessionMode[sid] = 'setup'
    expect((await cardSession(sid)).status).toBe(200)
    expect((await bookingOf(r.body.token)).status).toBe('cancelled')
    expect((await t.db.select().from(t.schema.clientCard)).some((c: any) => c.paymentMethodId === 'pm_' + sid)).toBe(true)
    const p = await page(r.body.token, '?card=saved')
    expect(p.html).toContain('hold ran out before it arrived')
    expect(p.html).toContain('Choose a new time')
    expect(p.html).toContain('book-late-times')
  })
})

// The card step at online booking (salon gap #1, the half clients see; server/booking/engine.ts card hold, crm/salon/onlineBooking.ts
// card, booking/pages.ts). With the salon's option on, a client booking online has their time HELD until their card is kept on
// Stripe's own page (the salon's own account); nothing is charged. Off — the default — online booking is exactly as before.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const weekdayOf = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
function next(dow: number, ahead = 3) { let d = addDays(today(), ahead); while (weekdayOf(d) !== dow) d = addDays(d, 1); return d }

let sessions = 0
const sessionMeta: Record<string, Record<string, string>> = {}
const sessionCalls: Array<{ args: any; opts: any }> = []
const fakeStripe = {
  customers: { retrieve: async (id: string) => ({ id, deleted: false }), create: async () => ({ id: 'cus_1' }) },
  checkout: {
    sessions: {
      create: async (args: any, opts: any) => { sessionCalls.push({ args, opts }); sessions++; const id = 'cs_' + sessions; sessionMeta[id] = args.metadata; return { id, url: 'https://checkout.stripe.com/c/setup/' + id } },
      retrieve: async (id: string) => ({ id, mode: 'setup', customer: 'cus_x', metadata: sessionMeta[id], setup_intent: { payment_method: { id: 'pm_' + id, type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2031 } } } }),
    },
  },
  paymentIntents: { create: async () => { throw new Error('nothing is charged by the card step') } },
}

describe('salon: the card step at online booking', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = ''
  const owner = { token: '' }
  const sent: Array<{ to: string; name: string }> = []
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${owner.token}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  let hour = 9
  const day = next(2, 3)
  let ip = 0
  const online = async (email: string) => {
    hour += 1; ip += 1
    const r = await t.call('/api/book/services/cut', { method: 'POST', headers: { 'x-forwarded-for': `10.1.0.${ip}` }, json: { date: day, time: `${String(hour).padStart(2, '0')}:00`, name: 'Online Client', email, phone: '608-555-0170' } })
    return { status: r.status, body: (await r.json()) as any }
  }
  const bookingOf = async (token: string) => (await t.db.select().from(t.schema.booking).where(eq(t.schema.booking.token, token)))[0]
  const policy = (cardRequirement: string) => as('/api/card-on-file/policy', 'PUT', { cardRequirement, noShowFeeAmount: 20 })
  const cardEvent = (sid: string) => t.call('/api/stripe/factory-event', {
    method: 'POST', headers: { 'X-Factory-Key': 'factory-key' },
    json: { event: { type: 'checkout.session.completed', account: 'acct_salon', data: { object: { id: sid, mode: 'setup', metadata: sessionMeta[sid] } } } },
  })
  const page = async (token: string, query = '') => { const r = await t.call(`/booking/${token}${query}`); return { status: r.status, html: await r.text() } }
  const form = (token: string, body: Record<string, string>) => t.call(`/booking/${token}/card`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() } as any)

  beforeAll(async () => {
    process.env.FACTORY_SYNC_KEY = 'factory-key'
    t = await bootTenant({ vertical: 'salon', stripe: fakeStripe })
    const s = await seedOwner(t)
    co = s.company.id
    owner.token = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    await t.db.update(t.schema.company).set({ timezone: TZ, email: 'salon@example.com', integrations: { stripeAccountId: 'acct_salon' }, enabledFeatures: ['online_booking', 'contacts', 'client_profiles', 'salon_booking', 'service_menu', 'card_on_file', 'invoices'] } as any).where(eq(t.schema.company.id, co))
    t.services.features.forgetFeatures()
    expect((await as('/api/booking/settings', 'PATCH', { enabled: true, leadTimeMinutes: 0 })).status).toBe(200)
    expect((await as('/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 40, bookableOnline: true })).status).toBe(201)
    const real = t.services.email.send.bind(t.services.email)
    ;(t.services.email as any).send = async (to: string, name: string, data: any) => { sent.push({ to, name }); return real(to, name, data) }
  }, 120_000)

  test('off by default: an online booking stands at once, with no card asked', async () => {
    const r = await online('plain@example.com')
    expect(r.status).toBe(201)
    expect(r.body.needsCard).toBeUndefined()
    expect(r.body.status).toBe('confirmed')
    expect(sessionCalls).toHaveLength(0)
  })

  test('all clients: the time is held, the policy is shown, a tick is needed, and Stripe is on the salon\'s own account', async () => {
    expect((await policy('all')).status).toBe(200)
    sent.length = 0
    const r = await online('fresh@example.com')
    expect(r.status).toBe(201)
    expect(r.body.needsCard).toBe(true)
    expect(r.body.status).toBe('pending')
    const row = await bookingOf(r.body.token)
    expect([row.status, row.depositStatus, row.depositAmount]).toEqual(['pending', 'pending', null])
    expect(sent.filter((m) => m.name === 'bookingConfirmed')).toHaveLength(0)     // not confirmed yet
    // the booking's page: the policy in words, the button
    const p = await page(r.body.token)
    expect(p.html).toContain('Waiting for your card')
    expect(p.html).toContain('no-show fee of $20')
    expect(p.html).toContain('Add my card')
    // without the tick: refused, no Stripe page made
    const noTick = await form(r.body.token, {})
    expect(noTick.status).toBe(303)
    expect(noTick.headers.get('location')).toContain('error=')
    expect(sessionCalls).toHaveLength(0)
    // with it: on to Stripe, the salon's own account, the booking named so its card finds it
    const go = await form(r.body.token, { agree: '1' })
    expect(go.status).toBe(303)
    const loc = go.headers.get('location')!
    expect(loc).toStartWith('https://checkout.stripe.com/c/setup/')
    expect(sessionCalls).toHaveLength(1)
    expect(sessionCalls[0].opts.stripeAccount).toBe('acct_salon')
    const sid = loc.split('/').pop()!
    expect(sessionMeta[sid].booking_token).toBe(r.body.token)
    // Stripe says the page was finished: the booking stands, the card is kept with the agreement, and the client is told
    expect((await cardEvent(sid)).status).toBe(200)
    expect((await bookingOf(r.body.token)).status).toBe('confirmed')
    const cards = await t.db.select().from(t.schema.clientCard)
    const card = cards.find((c: any) => c.paymentMethodId === 'pm_' + sid)!
    expect([card.consentVia, card.last4]).toEqual(['client_online', '4242'])
    expect(card.consentText).toContain('no-show fee of $20')
    expect(sent.filter((m) => m.name === 'bookingConfirmed')).toHaveLength(1)
    const appt = await t.db.select().from(t.schema.appointment).where(eq(t.schema.appointment.id, (await bookingOf(r.body.token)).appointmentId as string))
    expect(appt[0].status).toBe('scheduled')
    // Stripe repeating it changes nothing
    await cardEvent(sid)
    expect(sent.filter((m) => m.name === 'bookingConfirmed')).toHaveLength(1)
    expect((await page(r.body.token, '?card=saved')).html).toContain('your booking is confirmed')
  })

  test('a client who already has a card on file is not asked again; "new clients" asks only those with no history', async () => {
    const again = await online('fresh@example.com')            // the client from the test above, with a card now
    expect(again.body.needsCard).toBeUndefined()
    expect(again.body.status).toBe('confirmed')
    expect((await policy('new_clients')).status).toBe(200)
    // has a visit booked already (no card): not "new"
    const past = await ins(t.schema.contact, { companyId: co, name: 'Regular Reg', email: 'regular@example.com', type: 'client' })
    await ins(t.schema.appointment, { companyId: co, contactId: past.id, status: 'completed', startTime: new Date(Date.now() - 30 * 86400000), endTime: new Date(Date.now() - 30 * 86400000 + 3600000) })
    expect((await online('regular@example.com')).body.needsCard).toBeUndefined()
    // brand new: asked
    expect((await online('newbie@example.com')).body.needsCard).toBe(true)
  })

  test('a hold that runs out is released: the booking is cancelled, its time is free, and nothing was charged', async () => {
    expect((await policy('all')).status).toBe(200)
    const r = await online('slowpoke@example.com')
    expect(r.body.needsCard).toBe(true)
    await t.db.update(t.schema.booking).set({ createdAt: new Date(Date.now() - 3 * 3600_000) } as any).where(eq(t.schema.booking.token, r.body.token))
    const p = await page(r.body.token)
    expect(p.html).toContain('hold ran out')
    expect(p.html).not.toContain('Add my card')
    // trying the card button, or anyone looking at that day's times, releases it
    const refused = await form(r.body.token, { agree: '1' })
    expect(refused.headers.get('location')).toContain('error=')
    const row = await bookingOf(r.body.token)
    expect([row.status, row.depositStatus]).toEqual(['cancelled', 'expired'])
    expect(sessionCalls.filter((c) => c.args.metadata.booking_token === r.body.token)).toHaveLength(0)
    // a late card (Stripe page finished after the release) does not bring it back
    const sid = 'cs_late'; sessionMeta[sid] = { kind: 'card_on_file', company_id: co, contact_id: row.contactId as string, booking_token: r.body.token, consent_via: 'client_online' }
    await cardEvent(sid)
    expect((await bookingOf(r.body.token)).status).toBe('cancelled')
  })

  test('switched off in every other way: option off, Card on file off, or no Stripe link — online booking stands at once', async () => {
    expect((await policy('off')).status).toBe(200)
    expect((await online('o1@example.com')).body.needsCard).toBeUndefined()
    expect((await policy('all')).status).toBe(200)
    await t.db.update(t.schema.company).set({ enabledFeatures: ['online_booking', 'contacts', 'client_profiles', 'salon_booking', 'service_menu', 'invoices'] } as any).where(eq(t.schema.company.id, co))
    t.services.features.forgetFeatures()
    expect((await online('o2@example.com')).body.needsCard).toBeUndefined()
    await t.db.update(t.schema.company).set({ enabledFeatures: ['online_booking', 'contacts', 'client_profiles', 'salon_booking', 'service_menu', 'card_on_file', 'invoices'], integrations: {} } as any).where(eq(t.schema.company.id, co))
    t.services.features.forgetFeatures()
    expect((await online('o3@example.com')).body.needsCard).toBeUndefined()
    expect(fakeStripe.paymentIntents.create).toBeDefined()
  })
})

// Bookings through the real server: the feature switch closes every door (the public one with a 404), each seat
// gets what its permissions say, and a customer books, sees, moves and cancels from the website — the pages, the
// public API and the plain cancel form. Plus the guards that stand alone: webhook addresses must be public https,
// and every message renders.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { outboundUrlProblem, isPrivateAddress } from '../server/core/outboundUrl.ts'
import { createBookingWebhooks } from '../server/booking/webhooks.ts'
import { bookingTemplates } from '../server/booking/emails.ts'
import { zonedWallTimeToUtc, addDays, tzParts } from '@twomiah/tenant-backend'

let t: Awaited<ReturnType<typeof bootTenant>>
const tokens: Record<string, string> = {}
let companyId = ''
const signIn = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
/** A weekday at least two days out, in Chicago. */
let day = ''

beforeAll(async () => {
  t = await bootTenant()
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  for (const [role, email] of [['manager', 'manager@test.example'], ['field', 'staff@test.example']] as const) {
    await t.db.insert(t.schema.user).values({ email, passwordHash: await Bun.password.hash('Pass-word-1', 'bcrypt'), firstName: role, lastName: 'X', role, companyId })
  }
  tokens.owner = await signIn('owner@test.example', seeded.password)
  tokens.manager = await signIn('manager@test.example', 'Pass-word-1')
  tokens.staff = await signIn('staff@test.example', 'Pass-word-1')
  let d = addDays(tzParts(new Date(), 'America/Chicago').date, 2)
  while ([0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())) d = addDays(d, 1)
  day = d
})

describe('the feature switch', () => {
  test('off: the public doors are not there, the owner is told it is switched off', async () => {
    expect((await t.call('/api/book/services')).status).toBe(404)
    expect((await t.call('/book')).status).toBe(404)
    const r = await as('owner', '/api/booking/settings')
    expect(r.status).toBe(403)
    expect((await r.json()).code).toBe('FEATURE_NOT_ENABLED')
  })

  test('on: they open', async () => {
    expect((await as('owner', '/api/company/features', { method: 'PUT', json: { features: ['online_booking'] } })).status).toBe(200)
    expect((await as('owner', '/api/booking/settings')).status).toBe(200)
    expect((await t.call('/api/book/services')).status).toBe(200)
  })
})

describe('who may do what', () => {
  test('the owner sets up services and hours', async () => {
    expect((await as('owner', '/api/booking/settings', { method: 'PATCH', json: { timezone: 'America/Chicago', leadTimeMinutes: 60, maxDaysOut: 30 } })).status).toBe(200)
    const svc = await as('owner', '/api/booking/services', { method: 'POST', json: { name: 'Gutter cleaning', durationMinutes: 60, price: 120, slotStepMinutes: 60 } })
    expect(svc.status).toBe(201)
    expect((await svc.json()).slug).toBe('gutter-cleaning')
    const hours = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, start: '08:00', end: '16:00' }))
    expect((await as('owner', '/api/booking/hours', { method: 'PUT', json: { hours } })).status).toBe(200)
  })

  test('a manager runs the book (hours, days off) but not the services or switches', async () => {
    expect((await as('manager', '/api/booking/days-off', { method: 'POST', json: { date: addDays(day, 1), reason: 'Training' } })).status).toBe(201)
    expect((await as('manager', '/api/booking/services', { method: 'POST', json: { name: 'Nope', durationMinutes: 30 } })).status).toBe(403)
    expect((await as('manager', '/api/booking/settings', { method: 'PATCH', json: { enabled: false } })).status).toBe(403)
  })

  test('staff see the bookings and change nothing', async () => {
    expect((await as('staff', '/api/booking/bookings')).status).toBe(200)
    expect((await as('staff', '/api/booking/hours', { method: 'PUT', json: { hours: [] } })).status).toBe(403)
  })

  test('signed out, the owner\'s API is closed', async () => {
    expect((await t.call('/api/booking/bookings')).status).toBe(401)
  })
})

describe('a customer books from the website', () => {
  let token = ''

  test('the services page and the picker render; the days come from the server', async () => {
    const list = await (await t.call('/book')).text()
    expect(list).toContain('Gutter cleaning')
    const picker = await (await t.call('/book/gutter-cleaning')).text()
    expect(picker).toContain('data-service="gutter-cleaning"')
    expect(picker).toContain('/scripts/book-flow.js')
    const js = await t.call('/scripts/book-flow.js')
    expect(js.headers.get('content-type')).toContain('javascript')
    expect(await js.text()).not.toContain(': string') // served as JavaScript, not TypeScript
    const dates = (await (await t.call('/api/book/services/gutter-cleaning/dates')).json()).data
    expect(dates).toContain(day)
    expect(dates).not.toContain(addDays(day, 1)) // the manager's day off
  })

  test('books a time: a token, the confirmation page, the time taken', async () => {
    const times = (await (await t.call(`/api/book/services/gutter-cleaning/times?date=${day}`)).json()).data
    expect(times[0]).toMatchObject({ time: '08:00', label: '8 AM' })
    const r = await t.call('/api/book/services/gutter-cleaning', { method: 'POST', json: { date: day, time: '08:00', name: 'Sam Lee', email: 'sam@example.com', phone: '608-555-0101', address: '1 Elm St' } })
    expect(r.status).toBe(201)
    token = (await r.json()).token
    const done = await (await t.call(`/book/done?token=${token}`)).text()
    expect(done).toContain('sam@example.com')
    expect(done).toContain('8:00 AM')
    const after = (await (await t.call(`/api/book/services/gutter-cleaning/times?date=${day}`)).json()).data.map((x: any) => x.time)
    expect(after).not.toContain('08:00')
  })

  test('the same time again is refused with the reason, and the booking page is private', async () => {
    const r = await t.call('/api/book/services/gutter-cleaning', { method: 'POST', json: { date: day, time: '08:00', name: 'Ann', email: 'ann@example.com', phone: '1', address: 'x' } })
    expect(r.status).toBe(409)
    expect((await r.json()).code).toBe('taken')
    const page = await t.call(`/booking/${token}`)
    expect(page.headers.get('x-robots-tag')).toContain('noindex')
    expect(await page.text()).toContain('Reschedule')
    expect((await t.call('/booking/not-a-token')).status).toBe(404)
  })

  test('a filled honeypot or an instant submit is turned away', async () => {
    const bot = await t.call('/api/book/services/gutter-cleaning', { method: 'POST', json: { date: day, time: '09:00', name: 'Bot', email: 'bot@example.com', phone: '1', address: 'x', website: 'spam' } })
    expect(bot.status).toBe(400)
  })

  test('moves it; its own old time doesn\'t block it; the calendar file follows', async () => {
    const own = (await (await t.call(`/api/book/services/gutter-cleaning/times?date=${day}&token=${token}`)).json()).data.map((x: any) => x.time)
    expect(own).toContain('08:00')
    const r = await t.call(`/api/book/bookings/${token}/reschedule`, { method: 'POST', json: { date: day, time: '10:00' } })
    expect(r.status).toBe(200)
    const ics = await (await t.call(`/booking/${token}/ics`)).text()
    expect(ics).toContain('DTSTART:' + zonedWallTimeToUtc(day, '10:00', 'America/Chicago').toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'))
  })

  test('cancels with the plain form (no JavaScript needed)', async () => {
    const r = await t.call(`/booking/${token}/cancel`, { method: 'POST' })
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe(`/booking/${token}?cancelled=1`)
    const [b] = await t.db.select().from(t.schema.booking).where(eq(t.schema.booking.token, token))
    expect(b.status).toBe('cancelled')
    expect(await (await t.call(`/booking/${token}`)).text()).toContain('Cancelled')
  })

  test('the waitlist takes a name and email', async () => {
    const r = await t.call('/api/book/services/gutter-cleaning/waitlist', { method: 'POST', json: { name: 'Wendy', email: 'wendy@example.com' } })
    expect(r.status).toBe(200)
    expect(((await (await as('owner', '/api/booking/waitlist')).json()).data as any[]).map((w) => w.customerEmail)).toContain('wendy@example.com')
  })
})

describe('the owner\'s book', () => {
  test('staff booking, moving and closing out through the API', async () => {
    const svc = (await (await as('owner', '/api/booking/services')).json()).data[0]
    const made = await as('manager', '/api/booking/bookings', { method: 'POST', json: { serviceId: svc.id, date: day, time: '13:00', name: 'Desk Booking', email: 'desk@example.com' } })
    expect(made.status).toBe(201)
    const b = await made.json()
    expect(b.source).toBe('staff')
    const moved = await as('manager', `/api/booking/bookings/${b.id}`, { method: 'PATCH', json: { date: day, time: '14:00' } })
    expect(moved.status).toBe(200)
    const early = await as('manager', `/api/booking/bookings/${b.id}`, { method: 'PATCH', json: { status: 'completed' } })
    expect(early.status).toBe(400)
    const list = await (await as('staff', `/api/booking/bookings?from=${day}`)).json()
    expect(list.pagination.total).toBeGreaterThan(0)
  })

  test('the calendar feed is private and rotates', async () => {
    const s = await (await as('owner', '/api/booking/settings/feed-token', { method: 'POST' })).json()
    const feed = await t.call(`/api/book/feed/${s.icalFeedToken}.ics`)
    expect(feed.status).toBe(200)
    expect(await feed.text()).toContain('BEGIN:VCALENDAR')
    await as('owner', '/api/booking/settings/feed-token', { method: 'POST' })
    expect((await t.call(`/api/book/feed/${s.icalFeedToken}.ics`)).status).toBe(404)
  })

  test('the numbers and the customers answer', async () => {
    expect((await as('owner', '/api/booking/analytics')).status).toBe(200)
    const customers = (await (await as('owner', '/api/booking/customers')).json()).data
    expect(customers.map((c: any) => c.email)).toContain('sam@example.com')
  })

  test("the Factory's scheduled pass needs its key", async () => {
    delete process.env.FACTORY_SYNC_KEY
    expect((await t.call('/api/internal/booking-jobs', { method: 'POST' })).status).toBe(503)
    process.env.FACTORY_SYNC_KEY = 'factory-key-for-test'
    const r = await t.call('/api/internal/booking-jobs', { method: 'POST', headers: { 'X-Factory-Key': 'factory-key-for-test' } })
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ reminders: expect.any(Number), rebooks: expect.any(Number), reviews: expect.any(Number) })
  })

  test('a webhook address must be on the public internet', async () => {
    const r = await as('owner', '/api/booking/webhooks', { method: 'POST', json: { url: 'https://127.0.0.1/hook' } })
    expect(r.status).toBe(400)
    expect((await as('owner', '/api/booking/webhooks', { method: 'POST', json: { url: 'http://example.com/hook' } })).status).toBe(400)
  })
})

describe('outbound addresses', () => {
  test('private, loopback, link-local and metadata addresses are refused', async () => {
    for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.5.4', '192.168.1.1', '100.64.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1']) expect(isPrivateAddress(ip)).toBe(true)
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) expect(isPrivateAddress(ip)).toBe(false)
    expect(await outboundUrlProblem('https://localhost/x')).toContain('public internet')
    expect(await outboundUrlProblem('https://user:pw@8.8.8.8/x')).toContain('password')
    expect(await outboundUrlProblem('ftp://8.8.8.8/x')).toContain('https')
    expect(await outboundUrlProblem('https://8.8.8.8/x')).toBeNull()
  })

  test('a delivery is signed, filtered by event, and recorded', async () => {
    const sent: Array<{ url: string; init: any }> = []
    const hooks = createBookingWebhooks({ db: t.db, logger: { warn: () => {} } as any, fetch: (async (url: string, init: any) => { sent.push({ url, init }); return new Response('ok', { status: 200 }) }) as any, checkUrl: async () => null })
    const [w] = await t.db.insert(t.schema.bookingWebhook).values({ companyId, url: 'https://hooks.example/b', secret: 's3cret', events: ['booking.cancelled'] }).returning()
    await hooks.deliver(companyId, 'booking.created', { id: 'x' })
    expect(sent.length).toBe(0)
    await hooks.deliver(companyId, 'booking.cancelled', { id: 'x' })
    expect(sent.length).toBe(1)
    const sig = require('node:crypto').createHmac('sha256', 's3cret').update(sent[0].init.body).digest('hex')
    expect(sent[0].init.headers['X-Twomiah-Signature']).toBe('sha256=' + sig)
    const [after] = await t.db.select().from(t.schema.bookingWebhook).where(eq(t.schema.bookingWebhook.id, w.id))
    expect(after.lastStatus).toBe(200)
  })
})

test('every booking message renders, with the business\'s words where it set them', () => {
  const m = { serviceName: 'Gutter cleaning', when: 'Tuesday, November 3, 2026 at 8:00 AM CST', customerName: 'Sam <b>', customerEmail: 'sam@example.com', manageUrl: 'https://site.example/booking/tok', bookUrl: 'https://site.example/book/gutters', reviewLink: 'https://g.page/r', subject: 'See you {when}', intro: 'Hi {customerName}!' }
  const b = { companyName: 'Westridge', colourOnWhite: '#9a3412' }
  for (const [name, tpl] of Object.entries(bookingTemplates)) {
    const out = tpl(m, b, '')
    expect(out.subject.length).toBeGreaterThan(3)
    expect(out.html).not.toContain('<b>') // the customer's name is escaped
    expect(out.text.length, name).toBeGreaterThan(10)
  }
  expect(bookingTemplates.bookingConfirmed(m, b, '').subject).toBe('See you Tuesday, November 3, 2026 at 8:00 AM CST')
})

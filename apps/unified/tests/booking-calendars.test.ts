// People's own Google and Outlook calendars (server/booking/calendars.ts), on a real database against fake Google and
// Microsoft servers: tokens are stored encrypted and only for a real person; busy time on a calendar is not offered,
// the engine's own events excepted; a booking goes on its person's calendar (or the first one linked), moves with it,
// comes off when cancelled; an expiring token is refreshed and saved; the Factory's door and the owner's routes.
// The clock stands at Monday 2 Nov 2026, 09:00 Chicago.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createBookingEngine } from '../server/booking/engine.ts'
import { createCalendars } from '../server/booking/calendars.ts'
import { decrypt } from '../server/core/crypto.ts'

process.env.ENCRYPTION_KEY ||= 'test-encryption-key'
const NOW = Date.parse('2026-11-02T15:00:00Z')
const quiet = { info() {}, warn() {}, error() {}, debug() {} } as any

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', ownerId = '', staffId = ''

/** A fake Google + Microsoft: events per access token, every call recorded. */
const calls: Array<{ method: string; url: string; body?: any; auth?: string }> = []
const events: Record<string, Array<{ id: string; start: string; end: string; extra?: Record<string, unknown> }>> = {}
let refreshes = 0
const fakeFetch = (async (input: any, init: any = {}) => {
  const url = String(input), method = init.method || 'GET'
  const auth = String(init.headers?.Authorization || '').replace('Bearer ', '')
  const body = typeof init.body === 'string' ? (() => { try { return JSON.parse(init.body) } catch { return init.body } })() : init.body
  calls.push({ method, url, body, auth })
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } })
  if (url.startsWith('https://oauth2.googleapis.com/token') || url.startsWith('https://login.microsoftonline.com/')) {
    refreshes++
    return json({ access_token: 'fresh-' + refreshes, expires_in: 3600, ...(url.includes('microsoft') ? { refresh_token: 'ms-refresh-2' } : {}) })
  }
  if (url.includes('googleapis.com/calendar/v3') && method === 'GET') {
    return json({ items: (events[auth] || []).map((e) => ({ id: e.id, start: { dateTime: e.start }, end: { dateTime: e.end }, ...e.extra })) })
  }
  if (url.includes('graph.microsoft.com/v1.0/me/calendarView')) {
    return json({ value: (events[auth] || []).map((e) => ({ id: e.id, start: { dateTime: e.start.replace('Z', '') }, end: { dateTime: e.end.replace('Z', '') }, showAs: 'busy', ...e.extra })) })
  }
  if (method === 'POST') return json({ id: 'ev-' + calls.length })
  if (method === 'PATCH') return url.includes('gone') ? json({}, 404) : json({ id: 'patched' })
  if (method === 'DELETE') return new Response(null, { status: 204 })
  return json({}, 404)
}) as unknown as typeof fetch

let clock = NOW
const cal = () => createCalendars({ db: t.db, logger: quiet, fetch: fakeFetch, now: () => clock })
const engine = (c = cal()) => createBookingEngine({ db: t.db, requireAddressDefault: false, now: () => clock, externalBusy: c.externalBusy, onHappening: (h) => c.onHappening(h) })
const settle = () => new Promise((r) => setTimeout(r, 30))
const who = { name: 'Pat Jones', email: 'pat@example.com', phone: '608-555-0100' }
const conn = (userId: string, provider: string) => t.db.select().from(t.schema.calendarConnection).where(eq(t.schema.calendarConnection.userId, userId)).then((r: any[]) => r.find((x) => x.provider === provider))
const bookingRow = (id: string) => t.db.select().from(t.schema.booking).where(eq(t.schema.booking.id, id)).then((r: any[]) => r[0])

beforeAll(async () => {
  t = await bootTenant()
  const s = await seedOwner(t)
  companyId = s.company.id; ownerId = s.owner.id
  const [staff] = await t.db.insert(t.schema.user).values({ companyId, email: 'crew@example.com', firstName: 'Sam', lastName: 'Crew', role: 'field', passwordHash: 'x' }).returning()
  staffId = staff.id
  const e = engine()
  await e.updateSettings(companyId, { timezone: 'America/Chicago', leadTimeMinutes: 60, maxDaysOut: 14 })
  await e.setHours(companyId, [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, start: '09:00', end: '17:00' })))
  await e.createService(companyId, { name: 'Estimate', durationMinutes: 60, slotStepMinutes: 60 })
})

describe('linking a calendar (the Factory\'s callback)', () => {
  test('tokens are stored encrypted, for a real person only; linking again replaces the link', async () => {
    const c = cal()
    expect(await c.storeTokens({ userId: 'nobody', accessToken: 'x' })).toEqual({ error: 'No such person' })
    expect(await c.storeTokens({ userId: ownerId })).toEqual({ error: 'userId and accessToken are required' })
    await c.storeTokens({ userId: ownerId, provider: 'google', accessToken: 'g-old', refreshToken: 'g-refresh', expiresInSec: 3600, externalAccountEmail: 'owner@gmail.com' })
    await c.storeTokens({ userId: ownerId, provider: 'google', accessToken: 'owner-google', refreshToken: 'g-refresh', expiresInSec: 3600, externalAccountEmail: 'owner@gmail.com' })
    const row = await conn(ownerId, 'google')
    expect(row.accessTokenEnc).not.toContain('owner-google')
    expect(decrypt(row.accessTokenEnc)).toBe('owner-google')
    expect(row.companyId).toBe(companyId)
    expect(row.calendarId).toBe('primary')
    expect((await c.connectionsOf(ownerId)).map((x: any) => [x.provider, x.accountEmail])).toEqual([['google', 'owner@gmail.com']])
    expect(JSON.stringify(await c.connectionsOf(ownerId))).not.toContain('Enc')
  })
})

describe('busy time on a calendar', () => {
  test('is not offered; free, all-day and cancelled events take no time', async () => {
    events['owner-google'] = [
      { id: 'dentist', start: '2026-11-04T16:00:00Z', end: '2026-11-04T18:00:00Z' }, // 10–12 Chicago
      { id: 'free', start: '2026-11-04T20:00:00Z', end: '2026-11-04T21:00:00Z', extra: { transparency: 'transparent' } },
      { id: 'gone', start: '2026-11-04T21:00:00Z', end: '2026-11-04T22:00:00Z', extra: { status: 'cancelled' } },
    ]
    const times = (await engine().availableTimes(companyId, 'estimate', '2026-11-04')).map((x) => x.time)
    expect(times).toEqual(['09:00', '12:00', '13:00', '14:00', '15:00', '16:00'])
  })
  test('a calendar that can\'t be read blocks nothing', async () => {
    const broken = (async () => new Response('', { status: 500 })) as unknown as typeof fetch
    const e = createBookingEngine({ db: t.db, requireAddressDefault: false, now: () => clock, externalBusy: createCalendars({ db: t.db, logger: quiet, fetch: broken, now: () => clock }).externalBusy })
    expect((await e.availableTimes(companyId, 'estimate', '2026-11-04')).length).toBe(8)
  })
})

describe('bookings on the calendar', () => {
  test('a booking with nobody goes on the first calendar linked, and its own event never blocks itself', async () => {
    calls.length = 0
    const { booking: b } = await engine().book(companyId, { service: 'estimate', date: '2026-11-05', time: '09:00', ...who }, { by: 'customer' })
    await settle()
    const post = calls.find((x) => x.method === 'POST' && x.url.includes('/calendars/primary/events'))!
    expect(post.auth).toBe('owner-google')
    expect(post.url).toContain('sendUpdates=none')
    expect(post.body.summary).toContain('Estimate')
    expect(post.body.description).toContain('pat@example.com')
    expect(post.body.attendees).toBeUndefined() // the customer gets our confirmation, not a second invitation
    expect(post.body.start.dateTime).toBe('2026-11-05T15:00:00.000Z')
    const row = await bookingRow(b.id)
    expect(row.externalProvider).toBe('google')
    expect(row.externalEventId).toBeTruthy()
    // The calendar now shows the booking; the engine knows it as its own
    events['owner-google'].push({ id: row.externalEventId, start: '2026-11-05T15:00:00Z', end: '2026-11-05T16:00:00Z' })
    const free = (await engine().availableTimes(companyId, 'estimate', '2026-11-05')).map((x) => x.time)
    expect(free).not.toContain('09:00') // taken by the booking itself
    expect(free).toContain('10:00')
  })

  test('moved, its event moves; cancelled, it comes off', async () => {
    const e = engine()
    const { booking: b } = await e.book(companyId, { service: 'estimate', date: '2026-11-06', time: '09:00', ...who }, { by: 'customer' })
    await settle()
    const eventId = (await bookingRow(b.id)).externalEventId
    calls.length = 0
    const moved = await e.reschedule(companyId, await bookingRow(b.id), '2026-11-06', '13:00', { by: 'customer' })
    await settle()
    const patch = calls.find((x) => x.method === 'PATCH')!
    expect(patch.url).toContain('/events/' + eventId)
    expect(patch.body.start.dateTime).toBe('2026-11-06T19:00:00.000Z')
    calls.length = 0
    await e.cancel(companyId, await bookingRow(moved.id), { by: 'customer' })
    await settle()
    expect(calls.find((x) => x.method === 'DELETE')!.url).toContain('/events/' + eventId)
    const row = await bookingRow(b.id)
    expect(row.externalEventId).toBeNull()
    expect(row.externalProvider).toBeNull()
  })

  test('a booking with a person goes on that person\'s calendar — Outlook here, refreshed when its token runs out', async () => {
    await cal().storeTokens({ userId: staffId, provider: 'outlook', accessToken: 'crew-ms', refreshToken: 'ms-refresh-1', expiresInSec: 30 })
    process.env.OUTLOOK_CALENDAR_CLIENT_ID = 'ms-id'; process.env.OUTLOOK_CALENDAR_CLIENT_SECRET = 'ms-secret'
    calls.length = 0
    const { booking: b } = await engine().book(companyId, { service: 'estimate', date: '2026-11-09', time: '10:00', ...who }, { by: 'staff', assignedUserId: staffId })
    await settle()
    const refresh = calls.find((x) => x.url.includes('login.microsoftonline.com'))!
    expect(String(refresh.body)).toContain('refresh_token=ms-refresh-1')
    const post = calls.find((x) => x.method === 'POST' && x.url === 'https://graph.microsoft.com/v1.0/me/events')!
    expect(post.auth).toMatch(/^fresh-/)
    expect(post.body.subject).toContain('Estimate')
    expect(post.body.start).toEqual({ dateTime: '2026-11-09T16:00:00', timeZone: 'UTC' })
    expect(post.body.attendees).toBeUndefined()
    const row = await bookingRow(b.id)
    expect(row.assignedUserId).toBe(staffId)
    expect(row.externalProvider).toBe('outlook')
    // the new tokens are saved, encrypted; Microsoft's new refresh token replaces the old
    const saved = await conn(staffId, 'outlook')
    expect(decrypt(saved.accessTokenEnc)).toMatch(/^fresh-/)
    expect(decrypt(saved.refreshTokenEnc)).toBe('ms-refresh-2')
    expect(saved.expiresAt.getTime()).toBeGreaterThan(NOW + 3000_000)
  })

  test('a person\'s Outlook busy time blocks only that person', async () => {
    events['fresh-' + refreshes] = [{ id: 'crew-busy', start: '2026-11-10T15:00:00Z', end: '2026-11-10T23:00:00Z' }]
    const busy = await cal().externalBusy(companyId, new Date('2026-11-10T06:00:00Z'), new Date('2026-11-11T06:00:00Z'))
    expect(busy.filter((x) => x.eventId === 'crew-busy').map((x) => x.userId)).toEqual([staffId])
  })

  test('with no calendar linked nothing is called', async () => {
    const t2 = await bootTenant()
    const s2 = await seedOwner(t2)
    const c2 = createCalendars({ db: t2.db, logger: quiet, fetch: fakeFetch, now: () => clock })
    const e2 = createBookingEngine({ db: t2.db, requireAddressDefault: false, now: () => clock, externalBusy: c2.externalBusy, onHappening: (h) => c2.onHappening(h) })
    await e2.setHours(s2.company.id, [4].map((d) => ({ dayOfWeek: d, start: '09:00', end: '17:00' })))
    await e2.createService(s2.company.id, { name: 'Estimate', durationMinutes: 60, slotStepMinutes: 60 })
    calls.length = 0
    await e2.book(s2.company.id, { service: 'estimate', date: '2026-11-05', time: '10:00', ...who }, { by: 'customer' })
    await settle()
    expect(calls).toEqual([])
  })
})

describe('the routes', () => {
  test('the Factory\'s door takes tokens only with its key', async () => {
    process.env.FACTORY_SYNC_KEY = 'factory-key'
    const post = (key?: string) => t.call('/api/internal/calendar/store-tokens', { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'X-Factory-Key': key } : {}) }, body: JSON.stringify({ userId: staffId, provider: 'google', accessToken: 'crew-google' }) })
    expect((await post()).status).toBe(401)
    expect((await post('wrong')).status).toBe(401)
    const ok = await post('factory-key')
    expect(ok.status).toBe(200)
    expect(decrypt((await conn(staffId, 'google')).accessTokenEnc)).toBe('crew-google')
  })

  test('a person sees and removes only their own links; the link goes through the Factory and back to the settings page', async () => {
    const owner = await seedOwnerLogin()
    const auth = { Authorization: 'Bearer ' + owner }
    process.env.FACTORY_URL = 'https://factory.example'; process.env.TENANT_ID = 'tenant-1'
    const mine = await (await t.call('/api/booking/calendar/connections', { headers: auth })).json()
    expect(mine.data.map((x: any) => x.provider)).toEqual(['google'])
    const link = await (await t.call('/api/booking/calendar/outlook/connect-url', { headers: { ...auth, Host: 'app.acme.com', 'X-Forwarded-Proto': 'https' } })).json()
    const u = new URL(link.url)
    expect(u.origin + u.pathname).toBe('https://factory.example/calendar/outlook/auth')
    expect(u.searchParams.get('tenant')).toBe('tenant-1')
    expect(u.searchParams.get('user')).toBe(ownerId)
    expect(u.searchParams.get('return')).toBe('https://app.acme.com/crm/bookings/settings')
    expect((await t.call('/api/booking/calendar/yahoo/connect-url', { headers: auth })).status).toBe(404)
    // Only a calendar whose sign-in app the Factory has is offered: no Microsoft app, no Outlook button or link.
    const providers = async () => (await (await t.call('/api/booking/calendar/providers', { headers: auth })).json()).providers
    const ms = process.env.OUTLOOK_CALENDAR_CLIENT_ID
    delete process.env.OUTLOOK_CALENDAR_CLIENT_ID; delete process.env.GOOGLE_CALENDAR_CLIENT_ID
    expect(await providers()).toEqual([])
    expect((await t.call('/api/booking/calendar/outlook/connect-url', { headers: auth })).status).toBe(503)
    process.env.GOOGLE_CALENDAR_CLIENT_ID = 'g-id'
    expect(await providers()).toEqual(['google'])
    process.env.OUTLOOK_CALENDAR_CLIENT_ID = ms
    expect(await providers()).toEqual(['google', 'outlook'])
    const crewLink = (await conn(staffId, 'google')).id
    expect((await t.call('/api/booking/calendar/connections/' + crewLink, { method: 'DELETE', headers: auth })).status).toBe(404)
    expect(await conn(staffId, 'google')).toBeTruthy()
    const ownLink = mine.data[0].id
    expect((await t.call('/api/booking/calendar/connections/' + ownLink, { method: 'DELETE', headers: auth })).status).toBe(200)
    expect(await conn(ownerId, 'google')).toBeUndefined()
  })
})

/** The seeded owner's access token, with online booking switched on. */
async function seedOwnerLogin() {
  const [co] = await t.db.select().from(t.schema.company).where(eq(t.schema.company.id, companyId))
  await t.db.update(t.schema.company).set({ enabledFeatures: [...new Set([...((co.enabledFeatures as string[] | null) || []), 'online_booking'])] }).where(eq(t.schema.company.id, companyId))
  const [o] = await t.db.select().from(t.schema.user).where(eq(t.schema.user.id, ownerId))
  const r = await t.call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: o.email, password: 'Correct-horse-1' }) })
  return (await r.json()).accessToken as string
}

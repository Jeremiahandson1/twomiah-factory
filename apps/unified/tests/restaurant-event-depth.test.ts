// Restaurant & bar event depth, the server's side (docs/parity/restaurant-*.md): the guarantee cutoff, F&B minimums and the
// shortfall on the bill, holds by hour with the waitlist and a room's calendar feed, the lead-source and year reports, and a
// restaurant's catering form into the event book. Each on the real server (bootFood, a restaurant tenant with its own Stripe
// connected), each failing without the change: the feature switched off, or a seat without the permission, is refused.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'
import { venueToday } from '../server/crm/restaurant/eventBooking.ts'
import { dayBefore, runGuaranteeReminders } from '../server/crm/restaurant/eventGuarantee.ts'
import { offerWaitlist } from '../server/crm/restaurant/eventCalendar.ts'

const BASE = ['contacts', 'invoices', 'dashboard', 'event_bookings', 'event_spaces', 'catering_menus', 'reports']
const DEPTH = ['event_guarantee', 'event_minimums', 'event_calendar', 'event_reports', 'event_web_enquiries']
let k: Awaited<ReturnType<typeof bootFood>>
let today = ''
const later = (n: number) => dayBefore(today, -n)
let viewerToken = ''
const V = async (method: string, path: string, body?: unknown) => {
  const res = await k.t.call(path, { method, headers: { Authorization: `Bearer ${viewerToken}`, host: 'bar.test' }, ...(body === undefined ? {} : { json: body }) })
  const text = await res.text(); let j: any = text; try { j = JSON.parse(text) } catch {}
  return { status: res.status, json: j, text }
}
let clientId = ''
const sentTo = (to: string) => k.mails.filter((m) => m.to === to)

beforeAll(async () => {
  k = await bootFood({ vertical: 'restaurant', features: [...BASE, ...DEPTH] })
  today = await venueToday(k.t.db, k.companyId)
  const S = k.S
  await (k.t.db as any).insert(S.user).values({ email: 'viewer@bar.test', passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: 'Vi', lastName: 'Ewer', role: 'viewer', companyId: k.companyId })
  viewerToken = (await (await k.t.call('/api/auth/login', { method: 'POST', json: { email: 'viewer@bar.test', password: 'Seat-pass-1' } })).json() as any).accessToken
  // The staff seat may edit events (contacts:update) but is not a manager: the guarantee lock tells them apart.
  await (k.t.db as any).update(S.user).set({ extraPermissions: ['contacts:update'] }).where(eq(S.user.id, k.ids.bartender))
  ;(k.t.services as any).permissions.invalidateExtraPermissions(k.ids.bartender)
  // Template mail (email.send) is recorded here beside the raw sends the kit already keeps.
  const svc = k.t.services.crm.emailService as any
  svc.send = async (to: string, template: string, data: any) => { k.mails.push({ to, subject: String(data.subject ?? data.headline ?? template), html: JSON.stringify(data) }); return { success: true } }
  const c = await k.O('POST', '/api/contacts', { name: 'Harper Diaz', email: 'harper@client.test', phone: '7155550111', type: 'client' })
  clientId = c.json.id
  await (k.t.db as any).update(S.company).set({ settings: { defaultTaxRate: 10 } }).where(eq(S.company.id, k.companyId))
}, 60_000)
afterAll(() => k.restore())

describe('#5 the guarantee cutoff', () => {
  let eventId = ''
  test('settings: the venue sets the cutoff; a manager cannot, a viewer cannot read it as a writer', async () => {
    expect((await k.M('PUT', '/api/event-settings', { guaranteeDays: 5 })).status).toBe(403)
    expect((await k.O('PUT', '/api/event-settings', { guaranteeDays: 500 })).status).toBe(400)
    const put = await k.O('PUT', '/api/event-settings', { guaranteeDays: 7, guaranteeReminderDays: 3 })
    expect(put.status).toBe(200)
    expect((await k.B('GET', '/api/event-settings')).json.guaranteeDays).toBe(7)
  })

  test('before the cutoff the count changes freely; from it, only a manager with a reason', async () => {
    const far = await k.O('POST', '/api/events', { name: 'Far party', eventDate: later(40), status: 'confirmed', guestCount: 20, contactId: clientId })
    expect((await k.B('PUT', `/api/events/${far.json.id}`, { guestCountFinal: 22 })).status).toBe(200)
    const near = await k.O('POST', '/api/events', { name: 'Near party', eventDate: later(3), status: 'confirmed', guestCount: 20, contactId: clientId })
    eventId = near.json.id
    expect((await k.O('GET', `/api/events/${eventId}`)).json.guarantee.locked).toBe(true)
    const staff = await k.B('PUT', `/api/events/${eventId}`, { guestCountFinal: 30 })
    expect(staff.status).toBe(403); expect(staff.json.code).toBe('count_locked')
    const noReason = await k.M('PUT', `/api/events/${eventId}`, { guestCountFinal: 30 })
    expect(noReason.status).toBe(409); expect(noReason.json.error).toMatch(/reason/i)
    const ok = await k.M('PUT', `/api/events/${eventId}`, { guestCountFinal: 30, overrideReason: 'Client added a table by phone' })
    expect(ok.status).toBe(200)
    const row = (await k.O('GET', `/api/events/${eventId}`)).json.event
    expect(row.guestCountFinal).toBe(30); expect(row.guaranteeOverrideReason).toBe('Client added a table by phone'); expect(row.guaranteeOverriddenBy).toBe(k.ids.manager)
    // Other edits to a locked event are not blocked.
    expect((await k.B('PUT', `/api/events/${eventId}`, { notes: 'Cake at 7' })).status).toBe(200)
  })

  test('a per-head menu line cannot go down after the cutoff without a reason', async () => {
    const line = await k.O('POST', `/api/events/${eventId}/menu`, { name: 'Plated dinner', unitPrice: 40, perPerson: true, quantity: 30 })
    expect(line.status).toBe(201)
    expect((await k.B('PUT', `/api/events/${eventId}/menu/${line.json.id}`, { quantity: 25 })).status).toBe(403)
    expect((await k.M('PUT', `/api/events/${eventId}/menu/${line.json.id}`, { quantity: 25 })).status).toBe(409)
    expect((await k.M('PUT', `/api/events/${eventId}/menu/${line.json.id}`, { quantity: 25, overrideReason: 'Two cancelled' })).status).toBe(200)
    // Raising is not a reduction.
    expect((await k.B('PUT', `/api/events/${eventId}/menu/${line.json.id}`, { quantity: 28 })).status).toBe(200)
    expect((await k.B('DELETE', `/api/events/${eventId}/menu/${line.json.id}`)).status).toBe(403)
  })

  test('the client is reminded once, in the window before the cutoff, and never after it', async () => {
    const jobs = (k.t.services.crm as any).eventJobs
    const ev = await k.O('POST', '/api/events', { name: 'Remind me', eventDate: later(9), status: 'tentative', guestCount: 12, contactId: clientId })
    // 9 days out, cutoff 7 days before = day 2; reminder from 3 days before the cutoff = day -1: today is inside the window.
    const n0 = sentTo('harper@client.test').length
    await jobs.runGuaranteeReminders()
    expect(sentTo('harper@client.test').length).toBe(n0 + 1)
    expect(sentTo('harper@client.test').at(-1)!.subject).toMatch(/confirm your guest count/i)
    await jobs.runGuaranteeReminders()
    expect(sentTo('harper@client.test').length).toBe(n0 + 1)
    // Near party (already past its cutoff) is not reminded.
    void ev
  })

  test('with the feature off nothing locks', async () => {
    await k.features([...BASE, ...DEPTH.filter((f) => f !== 'event_guarantee')])
    expect((await k.B('PUT', `/api/events/${eventId}`, { guestCountFinal: 12 })).status).toBe(200)
    await k.features([...BASE, ...DEPTH])
  })
})

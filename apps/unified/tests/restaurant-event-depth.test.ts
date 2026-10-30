// Restaurant & bar event depth, the server's side (docs/parity/restaurant-*.md): the guarantee cutoff, F&B minimums and the
// shortfall on the bill, holds by hour with the waitlist and a room's calendar feed, the lead-source and year reports, and a
// restaurant's catering form into the event book. Each on the real server (bootFood, a restaurant tenant with its own Stripe
// connected), each failing without the change: the feature switched off, or a seat without the permission, is refused.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'
import { venueToday } from '../server/crm/restaurant/eventBooking.ts'
import { dayBefore, runGuaranteeReminders } from '../server/crm/restaurant/eventGuarantee.ts'

const BASE = ['contacts', 'invoices', 'dashboard', 'event_bookings', 'event_spaces', 'catering_menus', 'reports']
const DEPTH = ['event_guarantee', 'event_minimums', 'event_calendar', 'event_reports', 'event_web_enquiries', 'event_proposals', 'event_payment_automation']
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

// A date whose weekday is `dow` (0 = Sunday), at least `from` days out.
const nextDow = (dow: number, from = 20) => { for (let n = from; n < from + 7; n++) if (new Date(later(n) + 'T12:00:00Z').getUTCDay() === dow) return later(n); return later(from) }
const invoiceOf = async (eventId: string) => {
  const ev = (await k.O('GET', `/api/events/${eventId}`)).json
  return ev.invoice ? { ...(await k.O('GET', `/api/invoices/${ev.invoice.id}`)).json, ev } : { ev }
}

describe('#6 food and beverage minimums', () => {
  let roomId = ''
  test('rules by day of week and season; the most specific one that fits the date applies', async () => {
    const sp = await k.O('POST', '/api/event-spaces', { name: 'Terrace', capacitySeated: 60 })
    roomId = sp.json.id
    // A read-only seat can neither write rules nor read them (invoices:read gates a price).
    expect((await V('POST', '/api/event-minimums', { spaceId: roomId, amount: 3000 })).status).toBe(403)
    expect((await k.O('POST', '/api/event-minimums', { spaceId: roomId, amount: 0 })).status).toBe(400)
    expect((await k.O('POST', '/api/event-minimums', { spaceId: roomId, amount: 3000, seasonStart: '05-01' })).status).toBe(400)
    expect((await k.O('POST', '/api/event-minimums', { spaceId: roomId, amount: 3000, daysOfWeek: [9] })).status).toBe(400)
    expect((await k.O('POST', '/api/event-minimums', { spaceId: roomId, label: 'Any night', amount: 3000 })).status).toBe(201)
    expect((await k.O('POST', '/api/event-minimums', { spaceId: roomId, label: 'Saturdays', amount: 5000, daysOfWeek: [6] })).status).toBe(201)
    expect((await k.B('GET', '/api/event-minimums')).status).toBe(403)
  })

  test('a short menu puts the shortfall on the invoice as its own line, and tax follows the venue setting', async () => {
    const sat = nextDow(6)
    const ev = await k.O('POST', '/api/events', { name: 'Saturday dinner', eventDate: sat, status: 'confirmed', guestCount: 30, contactId: clientId, spaceId: roomId })
    expect(ev.status).toBe(201)
    expect((await k.O('POST', `/api/events/${ev.json.id}/menu`, { name: 'Plated dinner', unitPrice: 100, quantity: 30 })).status).toBe(201)
    expect((await k.O('POST', `/api/events/${ev.json.id}/payments`, { label: 'Deposit', amount: 500 })).status).toBe(201)
    const got = await k.O('GET', `/api/events/${ev.json.id}`)
    // Saturday rule ($5,000) beats the any-night rule ($3,000); $3,000 of food leaves $2,000 short.
    expect(got.json.totals.minimum.required).toBe(5000)
    expect(got.json.totals.minimum.shortfall).toBe(2000)
    const inv = await invoiceOf(ev.json.id)
    const lines = (inv.lineItems || inv.items || inv.lines) as any[]
    const short = lines.find((l) => /minimum shortfall/i.test(l.description))
    expect(short).toBeTruthy(); expect(Number(short.unitPrice)).toBe(2000)
    // Taxed (the default): 10% on the whole $5,000.
    expect(Number(inv.total)).toBe(5500)
    await k.O('PUT', '/api/event-settings', { shortfallTaxed: false })
    await k.O('PUT', `/api/events/${ev.json.id}/menu/${(await k.O('GET', `/api/events/${ev.json.id}`)).json.menu[0].id}`, { quantity: 30 })
    await k.O('PUT', `/api/events/${ev.json.id}`, { notes: 'touch' })
    expect(Number((await invoiceOf(ev.json.id)).total)).toBe(5300)
    await k.O('PUT', '/api/event-settings', { shortfallTaxed: true })
  })

  test('spending up to the minimum removes the line; a weeknight falls to the any-night rule; staff without the right cannot see the figure', async () => {
    const sat = nextDow(6, 40)
    const ev = await k.O('POST', '/api/events', { name: 'Big Saturday', eventDate: sat, status: 'confirmed', contactId: clientId, spaceId: roomId })
    const line = await k.O('POST', `/api/events/${ev.json.id}/menu`, { name: 'Feast', unitPrice: 100, quantity: 40 })
    await k.O('POST', `/api/events/${ev.json.id}/payments`, { label: 'Deposit', amount: 100 })
    expect((await k.O('GET', `/api/events/${ev.json.id}`)).json.totals.minimum.shortfall).toBe(1000)
    await k.O('PUT', `/api/events/${ev.json.id}/menu/${line.json.id}`, { quantity: 50 })
    const after = (await k.O('GET', `/api/events/${ev.json.id}`)).json
    expect(after.totals.minimum.shortfall).toBe(0)
    const inv = await invoiceOf(ev.json.id)
    expect(((inv.lineItems || inv.items || inv.lines) as any[]).some((l) => /shortfall/i.test(l.description))).toBe(false)
    const tue = nextDow(2, 60)
    const wk = await k.O('POST', '/api/events', { name: 'Tuesday', eventDate: tue, status: 'confirmed', contactId: clientId, spaceId: roomId })
    expect((await k.O('GET', `/api/events/${wk.json.id}`)).json.totals.minimum.required).toBe(3000)
    // The floor seat reads the event but not the money.
    expect((await k.B('GET', `/api/events/${wk.json.id}`)).json.totals).toBeUndefined()
  })

  test('with the feature off no shortfall is charged', async () => {
    await k.features([...BASE, ...DEPTH.filter((f) => f !== 'event_minimums')])
    expect((await k.O('GET', '/api/event-minimums')).status).toBe(403)
    const ev = await k.O('POST', '/api/events', { name: 'Off', eventDate: nextDow(6, 80), status: 'confirmed', contactId: clientId, spaceId: roomId })
    expect((await k.O('GET', `/api/events/${ev.json.id}`)).json.totals.minimum?.shortfall ?? 0).toBe(0)
    await k.features([...BASE, ...DEPTH])
  })
})

describe('#4 the room calendar: holds by hour, the waitlist, the feed', () => {
  let roomId = ''
  const day = () => later(100)
  test('lunch and dinner can share a room on one day; overlapping hours cannot; with the feature off the day is one booking', async () => {
    const sp = await k.O('POST', '/api/event-spaces', { name: 'Cellar', capacitySeated: 24 })
    roomId = sp.json.id
    const lunch = await k.O('POST', '/api/events', { name: 'Lunch', eventDate: day(), status: 'confirmed', spaceId: roomId, startTime: '11:00', endTime: '14:00' })
    expect(lunch.status).toBe(201)
    const dinner = await k.O('POST', '/api/events', { name: 'Dinner', eventDate: day(), status: 'confirmed', spaceId: roomId, startTime: '18:00', endTime: '22:00' })
    expect(dinner.status).toBe(201)
    const overlap = await k.O('POST', '/api/events', { name: 'Brunch', eventDate: day(), status: 'confirmed', spaceId: roomId, startTime: '13:00', endTime: '16:00' })
    expect(overlap.status).toBe(409)
    expect(JSON.stringify(overlap.json)).not.toContain(day())
    await k.features([...BASE, ...DEPTH.filter((f) => f !== 'event_calendar')])
    const off = await k.O('POST', '/api/events', { name: 'Evening', eventDate: day(), status: 'confirmed', spaceId: roomId, startTime: '15:00', endTime: '17:00' })
    expect(off.status).toBe(409)
    await k.features([...BASE, ...DEPTH])
  })

  test('the grid by room for a range, for any seat that can read events', async () => {
    const g = await k.B('GET', `/api/event-calendar?from=${day()}&to=${day()}`)
    expect(g.status).toBe(200)
    expect(g.json.events.filter((e: any) => e.spaceId === roomId).map((e: any) => e.startTime).sort()).toEqual(['11:00', '18:00'])
    expect(g.json.spaces.some((s: any) => s.id === roomId)).toBe(true)
    expect((await k.O('GET', `/api/event-calendar?from=${day()}&to=2099-01-01`)).status).toBe(400)
    expect((await V('GET', `/api/event-calendar?from=${day()}&to=${day()}`)).status).toBe(200)
  })

  test('a guest can wait for a held hour; an open hour is refused; letting the hold go offers it, once, in order', async () => {
    const open = await k.O('POST', '/api/event-waitlist', { spaceId: roomId, eventDate: day(), startTime: '15:00', endTime: '17:00', name: 'Open slot' })
    expect(open.status).toBe(409); expect(open.json.code).toBe('space_open')
    const a = await k.O('POST', '/api/event-waitlist', { spaceId: roomId, eventDate: day(), startTime: '18:30', endTime: '21:00', name: 'First in line', email: 'first@wait.test' })
    const b = await k.O('POST', '/api/event-waitlist', { spaceId: roomId, eventDate: day(), startTime: '19:00', endTime: '21:00', name: 'Second', email: 'second@wait.test' })
    expect(a.status).toBe(201); expect(b.status).toBe(201)
    expect((await V('POST', '/api/event-waitlist', { spaceId: roomId, eventDate: day(), name: 'x' })).status).toBe(403)
    const dinner = (await k.O('GET', `/api/event-calendar?from=${day()}&to=${day()}`)).json.events.find((e: any) => e.name === 'Dinner')
    expect((await k.O('PUT', `/api/events/${dinner.id}`, { status: 'cancelled' })).status).toBe(200)
    const list = (await k.O('GET', '/api/event-waitlist?status=offered')).json
    expect((list.data || list).map((w: any) => w.name)).toEqual(['First in line'])
    expect(sentTo('first@wait.test').length).toBe(1); expect(sentTo('second@wait.test').length).toBe(0)
    await k.O('PUT', `/api/events/${dinner.id}`, { status: 'cancelled' })
    expect(sentTo('first@wait.test').length).toBe(1)
  })

  test('each room has a secret calendar feed: no client details, no money, a new link kills the old one', async () => {
    expect((await k.B('GET', '/api/event-calendar/feeds')).status).toBe(200)
    expect((await V('GET', '/api/event-calendar/feeds')).status).toBe(403)
    const feeds = (await k.O('GET', '/api/event-calendar/feeds')).json
    const mine = (feeds.data || feeds).find((f: any) => f.spaceId === roomId)
    const res = await k.t.call(mine.path, { headers: { host: 'bar.test' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/calendar')
    const ics = await res.text()
    expect(ics).toContain('SUMMARY:Lunch'); expect(ics).toContain(`DTSTART:${day().replace(/-/g, '')}T110000`)
    expect(ics.toLowerCase()).not.toContain('harper'); expect(ics).not.toContain('client.test')
    const fresh = (await k.O('POST', `/api/event-calendar/feeds/${roomId}/reset`)).json
    expect((await k.t.call(mine.path, { headers: { host: 'bar.test' } })).status).toBe(404)
    expect((await k.t.call(fresh.path, { headers: { host: 'bar.test' } })).status).toBe(200)
    expect((await k.t.call('/api/event-feed/nothing.ics', { headers: { host: 'bar.test' } })).status).toBe(404)
  })
})

describe('#7 where enquiries come from', () => {
  test('the source is a short list; the report counts enquiries, booked and lost by source and the value of what booked', async () => {
    const bad = await k.O('POST', '/api/events', { name: 'Odd', eventDate: later(150), source: 'a billboard' })
    expect(bad.status).toBe(400)
    const mk = (name: string, source: string, extra: any = {}) => k.O('POST', '/api/events', { name, eventDate: later(160), source, contactId: clientId, ...extra })
    const w1 = await mk('W1', 'website'); const w2 = await mk('W2', 'website'); const kn = await mk('K1', 'the_knot')
    expect([w1, w2, kn].every((r) => r.status === 201)).toBe(true)
    await k.O('PUT', `/api/events/${w1.json.id}`, { status: 'confirmed', quotedTotal: 4000 })
    await k.O('PUT', `/api/events/${w2.json.id}`, { status: 'lost' })
    await k.O('PUT', `/api/events/${kn.json.id}`, { status: 'confirmed', quotedTotal: 1500 })
    const rep = await k.O('GET', `/api/event-reports/sources?from=${today}&to=${today}`)
    expect(rep.status).toBe(200)
    const web = rep.json.sources.find((s: any) => s.source === 'website')
    expect(web).toMatchObject({ enquiries: 2, booked: 1, lost: 1, conversion: 50, bookedValue: 4000 })
    expect(rep.json.sources.find((s: any) => s.source === 'the_knot')).toMatchObject({ enquiries: 1, booked: 1, bookedValue: 1500 })
    expect((await k.B('GET', `/api/event-reports/sources?from=${today}&to=${today}`)).status).toBe(403)
    // A seat that can read reports but not invoices sees the counts, never the value.
    const years = await k.O('GET', `/api/event-reports/years?year=${today.slice(0, 4)}`)
    expect(years.json.months).toHaveLength(12)
    expect(years.json.totals.booked).toBeGreaterThanOrEqual(2)
    expect(years.json.totals.value).toBeGreaterThanOrEqual(5500)
    expect((await k.O('GET', '/api/event-reports/years?year=1800')).status).toBe(400)
  })

  test('with the feature off the source stays the free text it always was', async () => {
    await k.features([...BASE, ...DEPTH.filter((f) => f !== 'event_reports')])
    expect((await k.O('POST', '/api/events', { name: 'Free text', eventDate: later(170), source: 'a billboard' })).status).toBe(201)
    await k.features([...BASE, ...DEPTH])
  })
})

describe('#3 the catering form goes into the event book', () => {
  let ip = 0
  const post = (body: Record<string, unknown>) => k.t.call('/api/leads', { method: 'POST', json: { t: String(Date.now() - 10_000), ...body }, headers: { 'X-Forwarded-For': `198.51.100.${++ip}` } })
  const evs = () => (k.t.db as any).select().from(k.S.event).where(eq(k.S.event.companyId, k.companyId))
  test('a form with a real date opens an enquiry (holding no room) for that guest with the head count and the note', async () => {
    const date = later(200)
    const before = (await evs()).length
    const r = await post({ name: 'Morgan Lee', email: 'morgan@lee.test', phone: '(715) 555-0199', message: 'Rehearsal lunch', formType: 'catering', eventDate: date, headcount: 45, venueType: 'Wedding', venue: 'Lakeside Hall' })
    expect(r.status).toBe(200)
    const made = (await evs()).filter((e: any) => e.name.includes('Morgan'))
    expect(made.length).toBe(1); expect((await evs()).length).toBe(before + 1)
    expect(made[0]).toMatchObject({ status: 'enquiry', guestCount: 45, source: 'website' })
    expect(String(made[0].eventDate).slice(0, 10)).toBe(date)
    expect(made[0].notes).toContain('Lakeside Hall')
  })
  test('no date, or a day that does not exist: an ordinary lead, never dropped; with the feature off it is a lead too', async () => {
    const before = (await evs()).length
    expect((await post({ name: 'No Date', email: 'nd@x.test', phone: '7155550150', message: 'Call me', formType: 'catering', headcount: 20 })).status).toBe(200)
    expect((await post({ name: 'Bad Date', email: 'bd@x.test', phone: '7155550151', message: 'Hi', formType: 'catering', eventDate: '2027-02-30', headcount: 20 })).status).toBe(200)
    await k.features([...BASE, ...DEPTH.filter((f) => f !== 'event_web_enquiries')])
    expect((await post({ name: 'Off Switch', email: 'os@x.test', phone: '7155550152', message: 'Hi', formType: 'catering', eventDate: later(210), headcount: 20 })).status).toBe(200)
    await k.features([...BASE, ...DEPTH])
    expect((await evs()).length).toBe(before)
    const guests = await (k.t.db as any).select().from(k.S.contact).where(eq(k.S.contact.companyId, k.companyId))
    expect(guests.some((g: any) => g.email === 'nd@x.test')).toBe(true)
  })
})

describe('#1 proposal, choices, e-signature, booked', () => {
  const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  let roomId = '', eventId = '', propId = '', token = '', mainId = '', mainSteak = '', mainFish = '', optId = ''
  const link = (p = '') => `/api/proposal-links/${token}${p}`
  test('built from the event with choices, sent by email to the client; only a seat that can edit money builds or sends', async () => {
    roomId = (await k.O('POST', '/api/event-spaces', { name: 'Loft', capacitySeated: 50 })).json.id
    const ev = await k.O('POST', '/api/events', { name: 'Diaz Rehearsal', eventDate: later(120), status: 'tentative', guestCount: 20, spaceId: roomId, contactId: clientId, startTime: '17:00', endTime: '21:00' })
    eventId = ev.json.id
    await k.O('POST', `/api/events/${eventId}/menu`, { name: 'Welcome drink', unitPrice: 10, quantity: 20 })
    await k.O('POST', `/api/events/${eventId}/payments`, { label: 'Deposit', amount: 200, dueDate: later(30) })
    const options = [{ title: 'Choose your main', kind: 'single', required: true, choices: [{ label: 'Steak', price: 40 }, { label: 'Fish', price: 32 }] }]
    expect((await k.B('POST', '/api/event-proposals', { eventId, options })).status).toBe(403)
    expect((await V('POST', '/api/event-proposals', { eventId, options })).status).toBe(403)
    expect((await k.O('POST', '/api/event-proposals', { eventId, options: [{ title: '', choices: [] }] })).status).toBe(400)
    const made = await k.O('POST', '/api/event-proposals', { eventId, message: 'Looking forward to it', options })
    expect(made.status).toBe(201); propId = made.json.id
    optId = made.json.options[0].id; mainSteak = made.json.options[0].choices[0].id; mainFish = made.json.options[0].choices[1].id; mainId = optId
    expect((await k.O('PUT', `/api/event-proposals/${propId}`, { message: 'Edited while a draft' })).status).toBe(200)
    const n0 = sentTo('harper@client.test').length
    const sent = await k.O('POST', `/api/event-proposals/${propId}/send`)
    expect(sent.status).toBe(200); token = sent.json.publicToken ?? sent.json.path.split('/').pop()
    expect(sentTo('harper@client.test').length).toBe(n0 + 1)
    expect((await k.O('PUT', `/api/event-proposals/${propId}`, { message: 'too late' })).status).toBe(409)
    // The link is the secret: staff who cannot edit money never see it.
    expect((await V('GET', `/api/event-proposals/${propId}`)).json.publicToken).toBeUndefined()
  })

  test('the guest opens it with no sign-in, sees the price with their choice, and cannot pick what is not offered', async () => {
    const v = await k.pub('GET', link())
    expect(v.status).toBe(200)
    expect(v.json.brand.name).toBeTruthy(); expect(v.json.event.dateWords).toMatch(/\d{4}/)
    expect(JSON.stringify(v.json)).not.toMatch(/signatureHash|signedIp|publicToken|companyId/)
    const base = v.json.total
    const pick = await k.pub('PUT', link('/choices'), { selections: { [optId]: [mainSteak] } })
    expect(pick.status).toBe(200)
    // 20 guests x $40 = $800 more, plus 10% tax.
    expect(Math.round((pick.json.total - base) * 100) / 100).toBe(880)
    expect((await k.pub('PUT', link('/choices'), { selections: { [optId]: ['nonsense-id'] } })).status).toBe(400)
    expect((await k.pub('PUT', link('/choices'), { selections: { [optId]: [mainSteak, mainFish] } })).status).toBe(400)
    expect((await k.pub('GET', `/api/proposal-links/${'0'.repeat(64)}`)).status).toBe(404)
  })

  test('signing needs the drawn signature, the typed name, a required choice and consent; it books the event, makes the menu lines and keeps the evidence', async () => {
    expect((await k.pub('POST', link('/accept'), { signedBy: 'Harper Diaz', consent: true, selections: { [optId]: [mainSteak] } })).status).toBe(400)
    expect((await k.pub('POST', link('/accept'), { signature: SIG, consent: true, selections: { [optId]: [mainSteak] } })).status).toBe(400)
    expect((await k.pub('POST', link('/accept'), { signature: SIG, signedBy: 'Harper Diaz', selections: { [optId]: [mainSteak] } })).status).toBe(400)
    const noChoice = await k.pub('POST', link('/accept'), { signature: SIG, signedBy: 'Harper Diaz', consent: true, selections: {} })
    expect(noChoice.status).toBe(400); expect(noChoice.json.error).toMatch(/choose/i)
    expect((await k.O('GET', `/api/events/${eventId}`)).json.event.status).toBe('tentative')
    const ok = await k.pub('POST', link('/accept'), { signature: SIG, signedBy: 'Harper Diaz', consent: true, selections: { [optId]: [mainSteak] } })
    expect(ok.status).toBe(200); expect(ok.json.status).toBe('accepted')
    const got = (await k.O('GET', `/api/events/${eventId}`)).json
    expect(got.event.status).toBe('confirmed'); expect(got.event.bookedAt).toBeTruthy()
    expect(got.menu.some((l: any) => /Steak/.test(l.name) && l.quantity === 20)).toBe(true)
    expect(got.invoice).toBeTruthy()
    const prop = (await k.O('GET', `/api/event-proposals/${propId}`)).json
    expect(prop).toMatchObject({ status: 'accepted', signedBy: 'Harper Diaz' })
    expect(prop.signatureHash).toMatch(/^[0-9a-f]{64}$/); expect(prop.consentAt).toBeTruthy()
    // The audit trail carries the signing too.
    const audits = await (k.t.db as any).select().from(k.S.auditLog).where(eq(k.S.auditLog.entityId, propId))
    expect(audits.some((a: any) => a.action === 'event_proposal.signed')).toBe(true)
    // A signed proposal cannot be signed or declined again.
    expect((await k.pub('POST', link('/accept'), { signature: SIG, signedBy: 'X', consent: true, selections: { [optId]: [mainFish] } })).status).toBe(409)
    expect((await k.pub('POST', link('/decline'), {})).status).toBe(409)
  })

  test('a PDF copy with the signature, for the guest and for staff who can read money', async () => {
    const g = await k.t.call(link('/pdf'), { headers: { host: 'bar.test' } })
    expect(g.status).toBe(200); expect(g.headers.get('content-type')).toBe('application/pdf')
    expect(Buffer.from(await g.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-')
    expect((await k.O('GET', `/api/event-proposals/${propId}/pdf`)).status).toBe(200)
    expect((await k.B('GET', `/api/event-proposals/${propId}/pdf`)).status).toBe(403)
  })

  test('a proposal goes stale when the date moves, a sent one is replaced by the next, a decline is kept, and a taken room refuses the signing', async () => {
    const mk = async (name: string, date: string, start: string, end: string, status = 'tentative') => {
      const ev = (await k.O('POST', '/api/events', { name, eventDate: date, status, guestCount: 10, spaceId: roomId, contactId: clientId, startTime: start, endTime: end })).json
      const p = (await k.O('POST', '/api/event-proposals', { eventId: ev.id })).json
      const sent = (await k.O('POST', `/api/event-proposals/${p.id}/send`)).json
      return { ev, p, tok: sent.publicToken ?? sent.path.split('/').pop() }
    }
    const a = await mk('Stale one', later(130), '12:00', '15:00')
    await k.O('PUT', `/api/events/${a.ev.id}`, { eventDate: later(131) })
    expect((await k.O('GET', `/api/event-proposals/${a.p.id}`)).json.stale).toBe(true)
    const stale = await k.pub('POST', `/api/proposal-links/${a.tok}/accept`, { signature: SIG, signedBy: 'H', consent: true })
    expect(stale.status).toBe(409); expect(stale.json.code).toBe('proposal_stale')
    // Re-sending replaces the earlier link.
    const again = (await k.O('POST', '/api/event-proposals', { eventId: a.ev.id })).json
    await k.O('POST', `/api/event-proposals/${again.id}/send`)
    expect((await k.pub('GET', `/api/proposal-links/${a.tok}`)).json.status).toBe('superseded')
    // Declined, with the reason kept.
    const b = await mk('Decline one', later(140), '12:00', '15:00')
    expect((await k.pub('POST', `/api/proposal-links/${b.tok}/decline`, { reason: 'Went elsewhere' })).json.status).toBe('declined')
    expect((await k.O('GET', `/api/event-proposals/${b.p.id}`)).json.declineReason).toBe('Went elsewhere')
    // Someone else takes the hours before the guest signs: refused, and still unsigned.
    const c = await mk('Taken one', later(150), '12:00', '15:00', 'enquiry') // an enquiry holds nothing
    expect((await k.O('POST', '/api/events', { name: 'Rival', eventDate: later(150), status: 'confirmed', spaceId: roomId, startTime: '13:00', endTime: '16:00' })).status).toBe(201)
    const taken = await k.pub('POST', `/api/proposal-links/${c.tok}/accept`, { signature: SIG, signedBy: 'H', consent: true })
    expect(taken.status).toBe(409); expect(taken.json.code).toBe('space_held')
    expect((await k.O('GET', `/api/event-proposals/${c.p.id}`)).json.status).not.toBe('accepted')
  })

  test('with the feature off the guest link and the builder are gone', async () => {
    await k.features([...BASE, ...DEPTH.filter((f) => f !== 'event_proposals')])
    expect((await k.pub('GET', link())).status).toBeGreaterThanOrEqual(400)
    expect((await k.O('GET', '/api/event-proposals')).status).toBe(403)
    await k.features([...BASE, ...DEPTH])
  })
})

describe('#2 reminders, a pay link per instalment, a card on file — on the venue\'s own Stripe', () => {
  const jobs = () => (k.t.services.crm as any).eventJobs
  const ALL = [...BASE, ...DEPTH, 'online_payments']
  let eventId = '', depositId = '', balanceId = '', token = '', balToken = ''
  const subjects = () => sentTo('harper@client.test').map((m) => m.subject)
  const setDue = (id: string, dueDate: string) => k.O('PUT', `/api/events/${eventId}/payments/${id}`, { dueDate })
  beforeAll(async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_food'
    await k.features(ALL)
    const ev = await k.O('POST', '/api/events', { name: 'Diaz Anniversary', eventDate: later(60), status: 'confirmed', guestCount: 10, contactId: clientId })
    eventId = ev.json.id
    await k.O('POST', `/api/events/${eventId}/menu`, { name: 'Dinner', unitPrice: 1000, quantity: 1 })
    depositId = (await k.O('POST', `/api/events/${eventId}/payments`, { label: 'Deposit', amount: 300, dueDate: later(5) })).json.id
    balanceId = (await k.O('POST', `/api/events/${eventId}/payments`, { label: 'Balance', amount: 800, dueDate: later(40) })).json.id
  })

  test('a reminder goes before it is due, on the day, and once after — each once, and not to a client who unsubscribed', async () => {
    const n0 = subjects().length
    expect(await jobs().runPaymentReminders()).toBe(1)
    expect(subjects().at(-1)).toMatch(/Deposit: \$300\.00/)
    expect(await jobs().runPaymentReminders()).toBe(0)
    await setDue(depositId, today)
    expect(await jobs().runPaymentReminders()).toBe(1)
    expect(await jobs().runPaymentReminders()).toBe(0)
    await setDue(depositId, dayBefore(today, 4))
    expect(await jobs().runPaymentReminders()).toBe(1)
    expect(subjects().at(-1)).toMatch(/past due/)
    expect(await jobs().runPaymentReminders()).toBe(0)
    expect(subjects().length).toBe(n0 + 3)
    // Switched off: nothing is sent.
    await k.features(ALL.filter((f) => f !== 'event_payment_automation'))
    expect(await jobs().runPaymentReminders()).toBe(0)
    await k.features(ALL)
  })

  test('staff see the reminders and the pay link only with the right; a manager can send one now', async () => {
    expect((await k.B('GET', `/api/event-payments/${eventId}`)).status).toBe(403)
    const asView = (await V('GET', `/api/event-payments/${eventId}`)).json
    expect(asView.instalments.every((i: any) => !i.payPath)).toBe(true)
    const own = (await k.O('GET', `/api/event-payments/${eventId}`)).json
    expect(own.cardsOn).toBe(true)
    token = own.instalments.find((i: any) => i.id === depositId).payPath.split('/').pop()
    balToken = own.instalments.find((i: any) => i.id === balanceId).payPath.split('/').pop()
    expect((await V('POST', `/api/event-payments/${eventId}/remind/${depositId}`)).status).toBe(403)
    const n0 = subjects().length
    expect((await k.M('POST', `/api/event-payments/${eventId}/remind/${depositId}`)).status).toBe(200)
    expect(subjects().length).toBe(n0 + 1)
  })

  test('the pay link charges what is still owed on THAT instalment, on the venue\'s own Stripe account, and records it once', async () => {
    const v = await k.pub('GET', `/api/event-pay/${token}`)
    expect(v.status).toBe(200); expect(v.json).toMatchObject({ label: 'Deposit', owed: 300, canPayByCard: true })
    expect(JSON.stringify(v.json)).not.toMatch(/companyId|invoiceId/)
    const intent = await k.pub('POST', `/api/event-pay/${token}/intent`, {})
    expect(intent.status).toBe(200); expect(intent.json.amount).toBe(30000); expect(intent.json.stripeAccount).toBe('acct_biz')
    const made = k.stripe.calls.filter((c) => c.method === 'POST' && c.path === '/v1/payment_intents').at(-1)!
    expect(made.account).toBe('acct_biz')
    expect((await k.pub('POST', `/api/event-pay/${token}/confirm`, { paymentIntentId: intent.json.paymentIntentId })).status).toBe(409)
    // A payment made for the Balance cannot be passed off as the Deposit.
    const other = await k.pub('POST', `/api/event-pay/${balToken}/intent`, {})
    k.stripe.succeedIntent(other.json.paymentIntentId)
    expect((await k.pub('POST', `/api/event-pay/${token}/confirm`, { paymentIntentId: other.json.paymentIntentId })).status).toBe(400)
    k.stripe.succeedIntent(intent.json.paymentIntentId)
    const paid = await k.pub('POST', `/api/event-pay/${token}/confirm`, { paymentIntentId: intent.json.paymentIntentId })
    expect(paid.json.success).toBe(true)
    const again = await k.pub('POST', `/api/event-pay/${token}/confirm`, { paymentIntentId: intent.json.paymentIntentId })
    expect(again.json.duplicate).toBe(true)
    const t = (await k.O('GET', `/api/events/${eventId}`)).json.totals
    expect(t.paid).toBe(300)
    expect((await k.pub('POST', `/api/event-pay/${token}/intent`, {})).status).toBe(409)
    expect((await k.pub('GET', `/api/event-pay/${'a'.repeat(48)}`)).status).toBe(404)
  })

  test('with cards off for the venue the link says so and takes nothing', async () => {
    await k.features(ALL.filter((f) => f !== 'online_payments'))
    const r = await k.pub('POST', `/api/event-pay/${balToken}/intent`, {})
    expect(r.status).toBe(409); expect(r.json.code).toBe('cards_off')
    await k.features(ALL)
  })

  test('a card left for the event needs consent, is saved by Stripe not us, and is charged on the due date, once a day', async () => {
    expect((await k.pub('POST', `/api/event-pay/${balToken}/autopay`, {})).status).toBe(400)
    const si = await k.pub('POST', `/api/event-pay/${balToken}/autopay`, { consent: true })
    expect(si.status).toBe(200)
    expect((await k.pub('POST', `/api/event-pay/${balToken}/autopay/confirm`, { setupIntentId: si.json.setupIntentId })).status).toBe(409)
    k.stripe.completeSetup(si.json.setupIntentId, 'pm_good')
    expect((await k.pub('POST', `/api/event-pay/${balToken}/autopay/confirm`, { setupIntentId: si.json.setupIntentId })).json.success).toBe(true)
    const auto = (await k.O('GET', `/api/event-payments/${eventId}`)).json.autopay
    expect(auto).toMatchObject({ status: 'active', brand: 'visa', last4: '4242' }); expect(auto.consentAt).toBeTruthy()
    // Not due yet: nothing is charged.
    expect(await jobs().runAutopay()).toBe(0)
    await setDue(balanceId, today)
    const calls0 = k.stripe.posts('/v1/payment_intents').length
    expect(await jobs().runAutopay()).toBe(1)
    const charge = k.stripe.posts('/v1/payment_intents').at(-1)!
    expect(charge.account).toBe('acct_biz'); expect(charge.params.get('off_session')).toBe('true'); expect(charge.params.get('payment_method')).toBe('pm_good'); expect(charge.params.get('amount')).toBe('80000')
    expect(k.stripe.posts('/v1/payment_intents').length).toBe(calls0 + 1)
    expect((await k.O('GET', `/api/events/${eventId}`)).json.totals.paid).toBe(1100)
    expect(await jobs().runAutopay()).toBe(0)
  })

  test('a declined card is recorded, the client is told with a way to pay, it is not hammered the same day, and stopping removes the card', async () => {
    const ev = await k.O('POST', '/api/events', { name: 'Decline Do', eventDate: later(70), status: 'confirmed', contactId: clientId })
    await k.O('POST', `/api/events/${ev.json.id}/menu`, { name: 'Dinner', unitPrice: 500, quantity: 1 })
    const inst = await k.O('POST', `/api/events/${ev.json.id}/payments`, { label: 'Deposit', amount: 200, dueDate: today })
    const tok = (await k.O('GET', `/api/event-payments/${ev.json.id}`)).json.instalments[0].payPath.split('/').pop()
    const si = await k.pub('POST', `/api/event-pay/${tok}/autopay`, { consent: true })
    k.stripe.completeSetup(si.json.setupIntentId, 'pm_declined')
    await k.pub('POST', `/api/event-pay/${tok}/autopay/confirm`, { setupIntentId: si.json.setupIntentId })
    const n0 = subjects().length
    expect(await jobs().runAutopay()).toBe(0)
    expect(subjects().length).toBe(n0 + 1); expect(subjects().at(-1)).toMatch(/could not charge your card/i)
    const row = (await k.O('GET', `/api/event-payments/${ev.json.id}`)).json.instalments.find((i: any) => i.id === inst.json.id)
    expect(row.autopayStatus).toBe('failed'); expect(row.autopayError).toMatch(/declined/i)
    const calls = k.stripe.posts('/v1/payment_intents').length
    expect(await jobs().runAutopay()).toBe(0)
    expect(k.stripe.posts('/v1/payment_intents').length).toBe(calls)
    // Stopping: the staff seat without the right is refused; the owner's stop detaches the card at Stripe and ends the charging.
    expect((await k.B('POST', `/api/event-payments/${ev.json.id}/autopay/stop`)).status).toBe(403)
    expect((await k.O('POST', `/api/event-payments/${ev.json.id}/autopay/stop`)).status).toBe(200)
    expect(k.stripe.detached).toContain('pm_declined')
    expect((await k.O('GET', `/api/event-payments/${ev.json.id}`)).json.autopay.status).toBe('stopped')
  })

  test('nothing in this feature ever touches the platform\'s own Stripe account', () => {
    const mine = k.stripe.calls.filter((c) => ['/v1/customers', '/v1/setup_intents', '/v1/payment_intents'].includes(c.path) && c.method === 'POST')
    expect(mine.length).toBeGreaterThan(4)
    expect(mine.every((c) => c.account === 'acct_biz')).toBe(true)
    expect(k.stripe.calls.filter((c) => c.path.startsWith('/v1/payment_methods') && c.method === 'POST').every((c) => c.account === 'acct_biz')).toBe(true)
  })
})

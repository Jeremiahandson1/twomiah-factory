// Restaurant & bar parity #5 (docs/parity/restaurant-4-room-calendar.md): an event is moved on the calendar (another day, hour or room)
// under the SAME overlap / hold / guarantee rules as an edit, after an in-page confirm; and a hold carries an end day (the venue's
// default, or its own), a reminder before it lapses, and is released on a timer and offered to the waitlist in order.
// On the real server (bootFood, a restaurant tenant); each test fails without the change.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'
import { venueToday } from '../server/crm/restaurant/eventBooking.ts'
import { dayBefore } from '../server/crm/restaurant/eventGuarantee.ts'

const BASE = ['contacts', 'invoices', 'dashboard', 'event_bookings', 'event_spaces', 'catering_menus', 'reports']
const DEPTH = ['event_calendar', 'event_guarantee', 'event_hold_expiry']
let k: Awaited<ReturnType<typeof bootFood>>
let today = ''
const later = (n: number) => dayBefore(today, -n)
let clientId = '', loftId = '', cellarId = ''
const mailsTo = (to: string) => k.mails.filter((m) => m.to === to)
const jobs = () => (k.t.services.crm as any).eventJobs
const row = async (id: string) => ((await (k.t.db as any).select().from(k.S.event).where(eq(k.S.event.id, id)))[0]) as any
const mk = async (body: Record<string, unknown>) => { const r = await k.O('POST', '/api/events', { contactId: clientId, ...body }); expect(r.status).toBe(201); return r.json as any }
const check = (id: string, to: Record<string, unknown>) => k.O('POST', '/api/event-calendar/move-check', { eventId: id, ...to })

beforeAll(async () => {
  k = await bootFood({ vertical: 'restaurant', features: [...BASE, ...DEPTH] })
  today = await venueToday(k.t.db, k.companyId)
  const svc = k.t.services.crm.emailService as any
  svc.send = async (to: string, template: string, data: any) => { k.mails.push({ to, subject: String(data.subject ?? data.headline ?? template), html: JSON.stringify(data) }); return { success: true } }
  await (k.t.db as any).update(k.S.company).set({ email: 'events@venue.test', name: 'The Loft Venue' }).where(eq(k.S.company.id, k.companyId))
  clientId = (await k.O('POST', '/api/contacts', { name: 'Harper Diaz', email: 'harper@client.test', phone: '7155550111', type: 'client' })).json.id
  loftId = (await k.O('POST', '/api/event-spaces', { name: 'The Loft', seatedCapacity: 50 })).json.id
  cellarId = (await k.O('POST', '/api/event-spaces', { name: 'The Cellar', seatedCapacity: 12 })).json.id
  await k.O('PUT', '/api/event-settings', { guaranteeDays: 7 })
}, 60_000)
afterAll(() => k.restore())

describe('moving an event on the calendar: the same rules as editing, checked before and confirmed', () => {
  const day = () => later(60)
  let lunch: any, dinner: any
  test('the check is read-only and only a seat that may edit events can ask; a taken slot is refused exactly as the edit refuses it', async () => {
    lunch = await mk({ name: 'Lunch', eventDate: day(), status: 'confirmed', spaceId: loftId, startTime: '11:00', endTime: '14:00', guestCount: 20 })
    dinner = await mk({ name: 'Dinner', eventDate: day(), status: 'confirmed', spaceId: loftId, startTime: '18:00', endTime: '22:00', guestCount: 20 })
    expect((await k.B('POST', '/api/event-calendar/move-check', { eventId: dinner.id, startTime: '12:00', endTime: '16:00' })).status).toBe(403)
    const bad = await check(dinner.id, { startTime: '12:00', endTime: '16:00' })
    expect(bad.status).toBe(200)
    expect(bad.json).toMatchObject({ ok: false, blocked: { code: 'space_held' } })
    expect(bad.json.blocked.message).toMatch(/already held.*Lunch/)
    // The edit that makes the move gives the same answer.
    const edit = await k.O('PUT', `/api/events/${dinner.id}`, { startTime: '12:00', endTime: '16:00' })
    expect(edit.status).toBe(409); expect(edit.json.code).toBe('space_held')
    const free = await check(dinner.id, { startTime: '15:00', endTime: '19:00' })
    expect(free.json).toMatchObject({ ok: true, blocked: null })
    // Asking changed nothing.
    expect(await row(dinner.id)).toMatchObject({ startTime: '18:00', endTime: '22:00' })
    expect((await check(dinner.id, { startTime: '25:00' })).json.blocked.code).toBe('invalid')
    expect((await check(dinner.id, { spaceId: 'elsewhere' })).json.blocked.code).toBe('space_missing')
    expect((await check(dinner.id, {})).json.blocked.code).toBe('no_change')
    expect((await k.O('POST', '/api/event-calendar/move-check', { eventId: 'nope', eventDate: day() })).status).toBe(404)
  })

  test('another hour, another day and another room all go through the edit, with the warnings an edit gives', async () => {
    expect((await k.O('PUT', `/api/events/${dinner.id}`, { startTime: '15:00', endTime: '19:00' })).status).toBe(200)
    // A smaller room warns (the edit saves it, as it always did); a past day warns.
    const small = await check(dinner.id, { spaceId: cellarId })
    expect(small.json.ok).toBe(true); expect(small.json.warnings.join(' ')).toMatch(/more than The Cellar holds/)
    const past = await check(dinner.id, { eventDate: dayBefore(today, 3) })
    expect(past.json.ok).toBe(true); expect(past.json.warnings.join(' ')).toMatch(/in the past/)
    const moved = await k.O('PUT', `/api/events/${dinner.id}`, { eventDate: later(61), spaceId: cellarId, startTime: '18:00', endTime: '21:00' })
    expect(moved.status).toBe(200)
    expect(await row(dinner.id)).toMatchObject({ spaceId: cellarId, startTime: '18:00' })
    expect(String((await row(dinner.id)).eventDate).slice(0, 10)).toBe(later(61))
  })

  test('an enquiry holds nothing, so it moves anywhere; a cancelled event cannot be moved', async () => {
    const enq = await mk({ name: 'Enquiry', eventDate: day(), status: 'enquiry', spaceId: loftId, startTime: '11:00', endTime: '14:00' })
    expect((await check(enq.id, { startTime: '12:00', endTime: '13:00' })).json.ok).toBe(true)
    const gone = await mk({ name: 'Called off', eventDate: later(70), status: 'cancelled' })
    expect((await check(gone.id, { eventDate: later(71) })).json.blocked.code).toBe('not_movable')
  })

  test('what a move sets in motion is said first: the waitlist, the guarantee cutoff, a proposal already sent', async () => {
    const held = await mk({ name: 'Held brunch', eventDate: later(80), status: 'confirmed', spaceId: loftId, startTime: '09:00', endTime: '12:00', guestCount: 10 })
    await k.O('POST', '/api/event-waitlist', { spaceId: loftId, eventDate: later(80), startTime: '09:30', endTime: '11:00', name: 'Waiting Wendy', email: 'wendy@wait.test' })
    const c1 = (await check(held.id, { eventDate: later(81) })).json
    expect(c1.notes.join(' ')).toMatch(/1 guest is waiting/)
    // Inside the cutoff the count is locked; a later day opens it again.
    const near = await mk({ name: 'Near party', eventDate: later(3), status: 'confirmed', spaceId: cellarId, startTime: '10:00', endTime: '12:00', guestCount: 8 })
    expect((await check(near.id, { eventDate: later(40) })).json.notes.join(' ')).toMatch(/open again/)
    const far = await mk({ name: 'Far party', eventDate: later(40), status: 'confirmed', spaceId: cellarId, startTime: '14:00', endTime: '16:00', guestCount: 8 })
    expect((await check(far.id, { eventDate: later(2) })).json.notes.join(' ')).toMatch(/already locked/)
    // The move releases the old slot to the first guest waiting for it.
    expect((await k.O('PUT', `/api/events/${held.id}`, { eventDate: later(81) })).status).toBe(200)
    expect(mailsTo('wendy@wait.test').length).toBe(1)
    expect(mailsTo('wendy@wait.test')[0].subject).toMatch(/is open on/)
  })

  test('with the feature off the check is gone', async () => {
    expect((await check(dinner.id, { startTime: '17:00', endTime: '19:00' })).status).toBe(200)
    await k.features([...BASE, ...DEPTH.filter((f) => f !== 'event_calendar')])
    expect([403, 404]).toContain((await check(dinner.id, { startTime: '17:00', endTime: '19:00' })).status)
    await k.features([...BASE, ...DEPTH])
  })
})

describe('holds that expire: a default length, an end day for one hold, a reminder, a release and the waitlist', () => {
  let h1: any
  test('the venue sets how long a hold lasts; a manager cannot; a new hold gets that end day, capped at the event day', async () => {
    expect((await k.M('PUT', '/api/event-settings', { holdDays: 5 })).status).toBe(403)
    expect((await k.O('PUT', '/api/event-settings', { holdDays: 999 })).status).toBe(400)
    expect((await k.O('PUT', '/api/event-settings', { holdReminderDays: 31 })).status).toBe(400)
    expect((await k.O('PUT', '/api/event-settings', { holdRemindClient: 'yes' })).status).toBe(400)
    expect((await k.O('PUT', '/api/event-settings', { holdDays: 5, holdReminderDays: 2 })).status).toBe(200)
    h1 = await mk({ name: 'Hold one', eventDate: later(40), status: 'tentative', spaceId: loftId, startTime: '18:00', endTime: '22:00' })
    expect(h1.holdUntil).toBe(later(5))
    const soon = await mk({ name: 'Hold soon', eventDate: later(2), status: 'tentative', spaceId: cellarId, startTime: '18:00', endTime: '20:00' })
    expect(soon.holdUntil).toBe(later(2))
    // Not a hold: no end day.
    expect((await mk({ name: 'Plain enquiry', eventDate: later(41), status: 'enquiry' })).holdUntil).toBeNull()
    // An enquiry that becomes a hold gets the default; a hold that is confirmed loses it.
    const enq = await mk({ name: 'Becomes hold', eventDate: later(42), status: 'enquiry' })
    expect((await k.O('PUT', `/api/events/${enq.id}`, { status: 'tentative' })).json.holdUntil).toBe(later(5))
    expect((await k.O('PUT', `/api/events/${enq.id}`, { status: 'confirmed' })).json.holdUntil).toBeNull()
  })

  test('one hold can have its own end day or none; a past day, a day after the event, or a non-hold is refused', async () => {
    expect((await k.O('PUT', `/api/events/${h1.id}`, { holdUntil: later(9) })).json.holdUntil).toBe(later(9))
    expect((await k.O('PUT', `/api/events/${h1.id}`, { holdUntil: dayBefore(today, 1) })).status).toBe(400)
    expect((await k.O('PUT', `/api/events/${h1.id}`, { holdUntil: later(400) })).status).toBe(400)
    expect((await k.O('PUT', `/api/events/${h1.id}`, { holdUntil: '2026-02-30' })).status).toBe(400)
    const none = await k.O('PUT', `/api/events/${h1.id}`, { holdUntil: null })
    expect(none.status).toBe(200); expect(none.json.holdUntil).toBeNull()
    expect((await k.O('PUT', `/api/events/${h1.id}`, { holdUntil: later(7) })).status).toBe(200)
    const plain = await mk({ name: 'Not held', eventDate: later(43), status: 'enquiry' })
    expect((await k.O('PUT', `/api/events/${plain.id}`, { holdUntil: later(3) })).status).toBe(400)
    // A hold moved to an earlier day cannot outlast it.
    expect((await k.O('PUT', `/api/events/${h1.id}`, { eventDate: later(4) })).json.holdUntil).toBe(later(4))
    expect((await k.O('PUT', `/api/events/${h1.id}`, { eventDate: later(40), holdUntil: later(7) })).json.holdUntil).toBe(later(7))
  })

  test('the team is reminded once, in the window before the end day — the coordinator when there is one, else the venue — and the client only if the venue asks', async () => {
    const near = await mk({ name: 'Reminder near', eventDate: later(30), status: 'tentative', holdUntil: later(1), coordinatorId: k.ids.manager, spaceId: loftId, startTime: '09:00', endTime: '11:00' })
    const far = await mk({ name: 'Reminder far', eventDate: later(30), status: 'tentative', holdUntil: later(12), spaceId: cellarId, startTime: '09:00', endTime: '11:00' })
    const before = k.mails.length
    expect(await jobs().runHoldReminders()).toBeGreaterThanOrEqual(1)
    const sent = k.mails.slice(before)
    expect(sent.some((m) => m.to === 'manager@bar.test' && /Hold ending.*Reminder near/.test(m.subject))).toBe(true)
    expect(sent.some((m) => /Reminder far/.test(m.subject))).toBe(false)
    expect(sent.some((m) => m.to === 'harper@client.test')).toBe(false)
    expect((await row(near.id)).holdReminderSentAt).toBeTruthy(); expect((await row(far.id)).holdReminderSentAt).toBeNull()
    const again = k.mails.length
    await jobs().runHoldReminders()
    expect(k.mails.slice(again).filter((m) => /Reminder near/.test(m.subject)).length).toBe(0)
    // With the venue's yes the client is told too, unless they unsubscribed; changing the end day earns a new reminder.
    await k.O('PUT', '/api/event-settings', { holdRemindClient: true })
    expect((await k.O('PUT', `/api/events/${near.id}`, { holdUntil: later(2) })).status).toBe(200)
    expect((await row(near.id)).holdReminderSentAt).toBeNull()
    const n0 = mailsTo('harper@client.test').length
    await jobs().runHoldReminders()
    expect(mailsTo('harper@client.test').length).toBe(n0 + 1)
    expect(mailsTo('harper@client.test').at(-1)!.subject).toMatch(/Your date is held until/)
    await k.O('PUT', '/api/event-settings', { holdRemindClient: false })
  })

  test('a lapsed hold is released: back to an enquiry holding nothing, the slot offered to the first waiting guest, and told to the team', async () => {
    const room = await mk({ name: 'Lapsing hold', eventDate: later(50), status: 'tentative', spaceId: loftId, startTime: '18:00', endTime: '22:00', coordinatorId: k.ids.manager })
    await k.O('POST', '/api/event-waitlist', { spaceId: loftId, eventDate: later(50), startTime: '18:30', endTime: '21:00', name: 'First in line', email: 'first@wait.test' })
    await k.O('POST', '/api/event-waitlist', { spaceId: loftId, eventDate: later(50), startTime: '19:00', endTime: '21:00', name: 'Second', email: 'second@wait.test' })
    // Time passes: the last day was yesterday.
    await (k.t.db as any).update(k.S.event).set({ holdUntil: dayBefore(today, 1) }).where(eq(k.S.event.id, room.id))
    const blocked = await k.O('POST', '/api/events', { name: 'Gala', eventDate: later(50), status: 'confirmed', spaceId: loftId, startTime: '19:00', endTime: '21:00' })
    expect(blocked.status).toBe(409)
    expect(await jobs().runHoldReleases()).toBe(1)
    expect(await row(room.id)).toMatchObject({ status: 'enquiry', holdUntil: null })
    expect((await row(room.id)).holdReleasedAt).toBeTruthy()
    expect(mailsTo('first@wait.test').length).toBe(1); expect(mailsTo('second@wait.test').length).toBe(0)
    const offered = (await k.O('GET', '/api/event-waitlist?status=offered')).json.data.map((w: any) => w.name)
    expect(offered).toContain('First in line'); expect(offered).not.toContain('Second')
    expect(mailsTo('manager@bar.test').some((m) => /Hold released.*Lapsing hold/.test(m.subject))).toBe(true)
    // The room is free again, and the released event is not picked up a second time.
    expect((await k.O('POST', '/api/events', { name: 'Gala', eventDate: later(50), status: 'confirmed', spaceId: loftId, startTime: '19:00', endTime: '21:00' })).status).toBe(201)
    expect(await jobs().runHoldReleases()).toBe(0)
    const page = (await k.O('GET', `/api/events/${room.id}`)).json.event
    expect(page.holdReleasedAt).toBeTruthy()
  })

  test('a hold that has not reached its end day, or has no end day, or has money on it, is not released', async () => {
    const live = await mk({ name: 'Still held', eventDate: later(55), status: 'tentative', holdUntil: later(3) })
    const open = await mk({ name: 'Open ended', eventDate: later(56), status: 'tentative', holdUntil: later(3) })
    await k.O('PUT', `/api/events/${open.id}`, { holdUntil: null })
    const paid = await mk({ name: 'Paid hold', eventDate: later(57), status: 'tentative', holdUntil: later(3) })
    await k.O('POST', `/api/events/${paid.id}/menu`, { name: 'Dinner', unitPrice: 1000, quantity: 1 })
    await k.O('POST', `/api/events/${paid.id}/payments`, { label: 'Deposit', amount: 300, dueDate: later(5) })
    const inv = (await k.O('GET', `/api/events/${paid.id}`)).json.invoice
    expect((await k.O('POST', `/api/invoices/${inv.id}/payments`, { amount: 300, method: 'cash' })).status).toBe(201)
    await (k.t.db as any).update(k.S.event).set({ holdUntil: dayBefore(today, 2) }).where(eq(k.S.event.id, paid.id))
    expect(await jobs().runHoldReleases()).toBe(0)
    expect(await row(live.id)).toMatchObject({ status: 'tentative' })
    expect(await row(open.id)).toMatchObject({ status: 'tentative' })
    expect(await row(paid.id)).toMatchObject({ status: 'tentative', holdUntil: null })
  })

  test('with the feature off nothing lapses and a posted end day is ignored', async () => {
    const off = await mk({ name: 'Lapsed while off', eventDate: later(65), status: 'tentative', holdUntil: later(3) })
    await (k.t.db as any).update(k.S.event).set({ holdUntil: dayBefore(today, 1) }).where(eq(k.S.event.id, off.id))
    await k.features([...BASE, ...DEPTH.filter((f) => f !== 'event_hold_expiry')])
    expect(await jobs().runHoldReleases()).toBe(0)
    expect(await jobs().runHoldReminders()).toBe(0)
    expect(await row(off.id)).toMatchObject({ status: 'tentative' })
    const made = await mk({ name: 'No expiry while off', eventDate: later(66), status: 'tentative', holdUntil: later(3) })
    expect(made.holdUntil).toBeNull()
    await k.features([...BASE, ...DEPTH])
  })
})

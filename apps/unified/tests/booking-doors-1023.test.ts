// The field-service retest of 2026-10-23 (T24), held at every door that takes or moves a booking:
//   M1 — the owner's own create (POST /api/booking/bookings) took 5 Jan 2027 and day 32 on a 30-day window;
//   M2 — it took a booking with no phone where the business asks for one;
//   L1 — four bookings under different names with one email: one contact, named after the first, and no screen said
//        whose name each booking carried;
//   and "bookings don't create a job or appear on the Schedule": Convert to job, linked, the job following the booking.
// Public doors keep customerRules; staff doors are held to the same phone and window, and past the window only with
// "Book outside the hours" — recorded on the booking with who ticked it.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { addDays, tzParts } from '@twomiah/tenant-backend'

let t: Awaited<ReturnType<typeof bootTenant>>
let token = '', ownerId = '', companyId = '', serviceId = ''
const TZ = 'America/Chicago'
let today = '', day = ''
const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const err = async (r: Response) => ((await r.json()) as any).error as string
const desk = (b: Record<string, unknown>) => as('/api/booking/bookings', { method: 'POST', json: { serviceId, name: 'Desk Customer', email: 'desk@example.com', phone: '608-555-0100', address: '1 Elm St', ...b } })
// Through Settings › Features' own door, so the feature gate's cache is dropped as it is for the owner.
const features = async (list: string[]) => expect((await as('/api/company/features', { method: 'PUT', json: { features: list } })).status).toBe(200)
const ALL = ['online_booking', 'contacts', 'jobs', 'scheduling', 'team']

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  ownerId = s.owner.id; companyId = s.company.id
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  await features(ALL)
  expect((await as('/api/booking/settings', { method: 'PATCH', json: { timezone: TZ, enabled: true, maxDaysOut: 30, leadTimeMinutes: 60, requirePhone: true } })).status).toBe(200)
  const svc = await (await as('/api/booking/services', { method: 'POST', json: { name: 'Furnace Check', durationMinutes: 90, slotStepMinutes: 30 } })).json()
  serviceId = svc.id
  expect((await as('/api/booking/hours', { method: 'PUT', json: { hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, start: '08:00', end: '18:00' })) } })).status).toBe(200)
  today = tzParts(new Date(), TZ).date
  day = addDays(today, 3)
}, 60_000)

describe('M1: the staff create holds the booking window unless staff say otherwise, and says so on the booking', () => {
  test('5 Jan 2027-style far dates and day 32 are refused at the desk, naming the window and the way past it', async () => {
    for (const d of [addDays(today, 74), addDays(today, 32)]) {
      const r = await desk({ date: d, time: '10:00' })
      expect(r.status).toBe(400)
      const e = await err(r)
      expect(e).toContain('booking window (30 days ahead)')
      expect(e).toContain('Book outside the hours')
    }
    // Day 30 is the window's last day: taken.
    expect((await desk({ date: addDays(today, 30), time: '10:00' })).status).toBe(201)
  })

  test('ticked on purpose, it is taken — and the booking records who booked it outside the rules', async () => {
    const r = await desk({ date: addDays(today, 74), time: '10:00', override: true })
    expect(r.status).toBe(201)
    const b = await r.json()
    expect(b.overrideByUserId).toBe(ownerId)
    expect(b.overrideAt).toBeTruthy()
    expect(b.overrideByName).toBe('Olive Owner')
    // A booking made inside the rules carries no mark.
    const plain = await (await desk({ date: day, time: '08:00' })).json()
    expect(plain.overrideByUserId).toBeNull()
  })

  test('a staff move past the window is refused unless ticked; ticked, it moves and is recorded', async () => {
    const b = await (await desk({ email: 'move@example.com', date: day, time: '12:00' })).json()
    const far = addDays(today, 45)
    const r = await as(`/api/booking/bookings/${b.id}`, { method: 'PATCH', json: { date: far, time: '10:00' } })
    expect(r.status).toBe(400)
    expect(await err(r)).toContain('booking window')
    const ok = await as(`/api/booking/bookings/${b.id}`, { method: 'PATCH', json: { date: far, time: '10:00', override: true } })
    expect(ok.status).toBe(200)
    const moved = await ok.json()
    expect(tzParts(new Date(moved.startAt), TZ).date).toBe(far)
    expect(moved.overrideByUserId).toBe(ownerId)
  })

  test('a staff move into the past is refused unless ticked', async () => {
    const b = await (await desk({ email: 'past@example.com', date: day, time: '13:30' })).json()
    const r = await as(`/api/booking/bookings/${b.id}`, { method: 'PATCH', json: { date: addDays(today, -2), time: '10:00' } })
    expect(r.status).toBe(400)
  })

  test('a repeating booking: its first visit is held to the window (nothing is written); later visits run past it by design', async () => {
    const before = (await t.db.select().from(t.schema.bookingSeries)).length
    const far = await as('/api/booking/series', { method: 'POST', json: { serviceId, name: 'Series Sam', email: 'series@example.com', phone: '608-555-0177', date: addDays(today, 40), time: '09:00', frequency: 'weekly', occurrencesCount: 3 } })
    expect(far.status).toBe(400)
    expect(await err(far)).toContain('booking window')
    expect((await t.db.select().from(t.schema.bookingSeries)).length).toBe(before)
    const ok = await as('/api/booking/series', { method: 'POST', json: { serviceId, name: 'Series Sam', email: 'series@example.com', phone: '608-555-0177', date: addDays(today, 5), time: '09:00', frequency: 'monthly', occurrencesCount: 3 } })
    expect(ok.status).toBe(201)
    const s = await ok.json()
    expect(s.booked).toBe(3)
    expect(s.skipped).toEqual([])
  })
})

describe('M2: a booking the desk makes for a customer needs the phone the business asks for', () => {
  test('no phone is refused at the desk, ticked box or not; with one it is taken', async () => {
    for (const extra of [{}, { override: true }]) {
      const r = await desk({ phone: '', email: 'nophone@example.com', date: day, time: '15:00', ...extra })
      expect(r.status).toBe(400)
      expect(await err(r)).toContain('phone number')
    }
    expect((await desk({ email: 'nophone@example.com', date: day, time: '15:00' })).status).toBe(201)
  })

  test('the phone cannot be taken off a booking afterwards', async () => {
    const b = await (await desk({ email: 'strip@example.com', date: day, time: '16:30' })).json()
    const r = await as(`/api/booking/bookings/${b.id}`, { method: 'PATCH', json: { customerPhone: '' } })
    expect(r.status).toBe(400)
    expect(await err(r)).toContain('phone number')
    expect((await as(`/api/booking/bookings/${b.id}`, { method: 'PATCH', json: { customerPhone: '608-555-0199' } })).status).toBe(200)
  })

  test('a repeating booking with no phone is refused before anything is written', async () => {
    const r = await as('/api/booking/series', { method: 'POST', json: { serviceId, name: 'No Phone', email: 'np-series@example.com', date: addDays(today, 6), time: '09:00', frequency: 'weekly', occurrencesCount: 2 } })
    expect(r.status).toBe(400)
    expect(await err(r)).toContain('phone number')
  })

  test('the public doors are unchanged: create, move and waitlist hold the window and the phone', async () => {
    const pub = (b: Record<string, unknown>) => t.call('/api/book/services/furnace-check', { method: 'POST', json: { name: 'Web Wren', email: 'web@example.com', phone: '608-555-0111', address: '2 Oak', time: '10:00', ...b } })
    expect((await pub({ date: addDays(today, 32) })).status).toBe(400)
    expect((await pub({ date: day, phone: '' })).status).toBe(400)
    expect((await t.call('/api/book/services/furnace-check/waitlist', { method: 'POST', json: { name: 'W', email: 'w@example.com', phone: '', from: day } })).status).toBe(400)
    const made = await pub({ date: addDays(today, 4) })
    expect(made.status).toBe(201)
    const { token: tok } = await made.json()
    expect((await t.call(`/api/book/bookings/${tok}/reschedule`, { method: 'POST', json: { date: addDays(today, 32), time: '10:00' } })).status).toBe(400)
  })
})

describe("the booking pages' tab titles follow the site's rule (site/menu.ts pageTitle)", () => {
  test('"Book Furnace Check — Business", not "Book Furnace Check · Business"', async () => {
    const html = await (await t.call('/book/furnace-check')).text()
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? ''
    expect(title).toBe('Book Furnace Check — Test Builders')
    expect(/<title>([^<]*)<\/title>/.exec(await (await t.call('/book')).text())?.[1]).toBe('Book online — Test Builders')
  })
})

describe('L1: each booking keeps the name its booker typed; one email is one contact', () => {
  test('four names, one email: one contact named as first booked, every booking its own name, the link said', async () => {
    const names = ['Alex Booker', 'Sam Booker', 'Jo Booker', 'Max Booker']
    const ids: string[] = []
    for (const [i, name] of names.entries()) {
      const r = await t.call('/api/book/services/furnace-check', { method: 'POST', json: { name, email: 'family@example.com', phone: '608-555-0142', address: '3 Pine', date: addDays(today, 6 + i), time: '11:00' } })
      expect(r.status).toBe(201)
    }
    const contacts = await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.email, 'family@example.com'))
    expect(contacts).toHaveLength(1)
    expect(contacts[0].name).toBe('Alex Booker')
    const listed = (await (await as(`/api/booking/bookings?contactId=${contacts[0].id}`)).json()).data
    expect(listed.map((b: any) => b.customerName).sort()).toEqual([...names].sort())
    for (const b of listed) { expect(b.contactName).toBe('Alex Booker'); ids.push(b.id) }
    const one = await (await as(`/api/booking/bookings/${listed.find((b: any) => b.customerName === 'Jo Booker').id}`)).json()
    expect(one.customerName).toBe('Jo Booker')
    expect(one.contactName).toBe('Alex Booker')
    // The bookings' customers list shows every name used under the email, latest first.
    const fam = ((await (await as('/api/booking/customers')).json()).data as any[]).find((c) => c.email === 'family@example.com')
    expect(fam.names).toEqual(['Max Booker', 'Jo Booker', 'Sam Booker', 'Alex Booker'])
    expect(fam.bookings).toBe(4)
  })
})

describe('Convert to job: the booking becomes a job on the schedule, linked, and the job follows it', () => {
  let b: any
  const cday = () => addDays(today, 12)
  test('a booking becomes one job — its day, clock time, length, person, customer and address — and only once', async () => {
    b = await (await desk({ name: 'Job Jordan', email: 'jordan@example.com', date: cday(), time: '14:00', notes: 'Side door' })).json()
    const r = await as(`/api/booking/bookings/${b.id}/job`, { method: 'POST' })
    expect(r.status).toBe(201)
    const made = await r.json()
    expect(made.number).toMatch(/^JOB-\d{5}$/)
    const [j] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, made.id))
    expect(j.bookingId).toBe(b.id)
    expect(j.contactId).toBe(b.contactId)
    expect(j.title).toBe('Furnace Check')
    expect(j.status).toBe('scheduled')
    expect(j.scheduledDate?.toISOString()).toBe(`${cday()}T00:00:00.000Z`)
    expect(j.scheduledTime).toBe('14:00')
    expect(Number(j.estimatedHours)).toBe(1.5)
    expect(j.address).toBe('1 Elm St')
    expect(j.description).toContain('Booked by Job Jordan')
    expect(j.description).toContain('Side door')
    const again = await as(`/api/booking/bookings/${b.id}/job`, { method: 'POST' })
    expect(again.status).toBe(409)
    expect(await err(again)).toContain(made.number)
    // The booking and the list say which job it became; the jobs list has it on its day.
    expect((await (await as(`/api/booking/bookings/${b.id}`)).json()).job.number).toBe(made.number)
    const listed = (await (await as(`/api/booking/bookings?from=${cday()}T00:00:00Z&to=${addDays(cday(), 1)}T12:00:00Z`)).json()).data
    expect(listed.find((x: any) => x.id === b.id).job.id).toBe(made.id)
    const jobs = (await (await as(`/api/jobs?startDate=${cday()}T00:00:00.000Z&endDate=${addDays(cday(), 1)}T00:00:00.000Z`)).json()).data
    expect(jobs.some((x: any) => x.id === made.id)).toBe(true)
  })

  test('the job holds no second slot online while the booking holds the time', async () => {
    const times = ((await (await t.call(`/api/book/services/furnace-check/times?date=${cday()}`)).json()).data as any[]).map((x) => x.time)
    expect(times).not.toContain('14:00')
    // Only the booking's own 90 minutes (and the run-up a 90-minute visit needs) are gone: 15:30 on is free.
    expect(times).toContain('15:30')
    expect(times).toContain('12:30')
  })

  test('moved, the job moves; cancelled, the job is cancelled', async () => {
    const to = addDays(today, 16)
    expect((await as(`/api/booking/bookings/${b.id}`, { method: 'PATCH', json: { date: to, time: '09:30' } })).status).toBe(200)
    let [j] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.bookingId, b.id))
    expect(j.scheduledDate?.toISOString()).toBe(`${to}T00:00:00.000Z`)
    expect(j.scheduledTime).toBe('09:30')
    expect((await as(`/api/booking/bookings/${b.id}`, { method: 'PATCH', json: { status: 'cancelled' } })).status).toBe(200)
    ;[j] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.bookingId, b.id))
    expect(j.status).toBe('cancelled')
  })

  test('a job already under way is the crew\'s: a booking move leaves it alone', async () => {
    const x = await (await desk({ email: 'underway@example.com', date: addDays(today, 13), time: '10:30' })).json()
    const made = await (await as(`/api/booking/bookings/${x.id}/job`, { method: 'POST' })).json()
    await t.db.update(t.schema.job).set({ status: 'in_progress' }).where(eq(t.schema.job.id, made.id))
    expect((await as(`/api/booking/bookings/${x.id}`, { method: 'PATCH', json: { date: addDays(today, 17), time: '10:30' } })).status).toBe(200)
    const [j] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, made.id))
    expect(j.scheduledTime).toBe('10:30')
    expect(j.scheduledDate?.toISOString()).toBe(`${addDays(today, 13)}T00:00:00.000Z`)
  })

  test('a cancelled booking is refused', async () => {
    const x = await (await desk({ email: 'gone@example.com', date: addDays(today, 14), time: '10:00' })).json()
    await as(`/api/booking/bookings/${x.id}`, { method: 'PATCH', json: { status: 'cancelled' } })
    const r = await as(`/api/booking/bookings/${x.id}/job`, { method: 'POST' })
    expect(r.status).toBe(409)
    expect(await err(r)).toContain('cancelled')
  })

  test('a business without jobs (a salon) has no door to convert through', async () => {
    const s2 = await bootTenant({ vertical: 'salon' })
    const o = await seedOwner(s2)
    const tok = (await (await s2.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: o.password } })).json()).accessToken
    const as2 = (path: string, init: any = {}) => s2.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } })
    expect((await as2('/api/company/features', { method: 'PUT', json: { features: ['online_booking', 'contacts'] } })).status).toBe(200)
    await as2('/api/booking/settings', { method: 'PATCH', json: { timezone: TZ, enabled: true } })
    const svc = await (await as2('/api/booking/services', { method: 'POST', json: { name: 'Cut', durationMinutes: 30 } })).json()
    await as2('/api/booking/hours', { method: 'PUT', json: { hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, start: '09:00', end: '17:00' })) } })
    const b2 = await (await as2('/api/booking/bookings', { method: 'POST', json: { serviceId: svc.id, name: 'Client', email: 'c@example.com', phone: '608-555-0155', date: day, time: '10:00' } })).json()
    expect(b2.id).toBeTruthy()
    const r = await as2(`/api/booking/bookings/${b2.id}/job`, { method: 'POST' })
    expect(r.status).toBe(404)
    expect((await s2.db.select().from(s2.schema.job)).length).toBe(0)
  }, 60_000)
})

describe("a salon's online booking lands in The Book (the salon's schedule), and The Book holds its time online", () => {
  let s2: Awaited<ReturnType<typeof bootTenant>>
  let as2: (path: string, init?: any) => Response | Promise<Response>
  let stylistId = ''
  const sday = () => addDays(today, 4)
  const times = async () => ((await (await s2.call(`/api/book/services/cut/times?date=${sday()}`)).json()).data as any[]).map((x) => x.time)
  beforeAll(async () => {
    s2 = await bootTenant({ vertical: 'salon' })
    const o = await seedOwner(s2)
    stylistId = o.owner.id
    const tok = (await (await s2.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: o.password } })).json()).accessToken
    as2 = (path: string, init: any = {}) => s2.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } })
    expect((await as2('/api/company/features', { method: 'PUT', json: { features: ['online_booking', 'contacts', 'salon_booking'] } })).status).toBe(200)
    await as2('/api/booking/settings', { method: 'PATCH', json: { timezone: TZ, enabled: true, leadTimeMinutes: 0 } })
    await as2('/api/booking/services', { method: 'POST', json: { name: 'Cut', durationMinutes: 60, slotStepMinutes: 60, price: 45 } })
    await as2('/api/booking/hours', { method: 'PUT', json: { hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, start: '09:00', end: '17:00', userId: stylistId })) } })
  }, 60_000)

  test('booked online, it is an appointment in The Book with the client, the stylist, the time and the price', async () => {
    const r = await s2.call('/api/book/services/cut', { method: 'POST', json: { name: 'Robin Client', email: 'robin@example.com', phone: '608-555-0160', date: sday(), time: '10:00' } })
    expect(r.status).toBe(201)
    const [b] = await s2.db.select().from(s2.schema.booking)
    expect(b.appointmentId).toBeTruthy()
    const book = (await (await as2(`/api/appointments?from=${sday()}T00:00:00Z&to=${addDays(sday(), 1)}T12:00:00Z`)).json()).data as any[]
    const a = book.find((x) => x.id === b.appointmentId)
    expect(a).toBeTruthy()
    expect(a.contactId).toBe(b.contactId)
    expect(a.stylistId).toBe(stylistId)
    expect(new Date(a.startTime).toISOString()).toBe(b.startAt.toISOString())
    expect(Number(a.quotedPrice)).toBe(45)
    expect(a.notes).toContain('Online booking: Cut')
    expect(await times()).not.toContain('10:00')
  })

  test('a desk appointment in The Book takes that time off the booking page', async () => {
    expect(await times()).toContain('13:00')
    const walkIn = await (await as2('/api/contacts', { method: 'POST', json: { name: 'Walk In', type: 'client' } })).json()
    const made = await as2('/api/appointments', { method: 'POST', json: { contactId: walkIn.id, stylistId, startTime: new Date(`${sday()}T13:00:00-05:00`).toISOString(), endTime: new Date(`${sday()}T14:00:00-05:00`).toISOString(), notes: 'Walk-in' } })
    expect(made.status).toBe(201)
    expect(await times()).not.toContain('13:00')
  })

  test('moved, the appointment moves; cancelled, it is cancelled', async () => {
    const [b] = await s2.db.select().from(s2.schema.booking)
    expect((await as2(`/api/booking/bookings/${b.id}`, { method: 'PATCH', json: { date: sday(), time: '15:00' } })).status).toBe(200)
    let [a] = await s2.db.select().from(s2.schema.appointment).where(eq(s2.schema.appointment.id, b.appointmentId!))
    expect(a.startTime.toISOString()).toBe(new Date(`${sday()}T15:00:00-05:00`).toISOString())
    expect((await as2(`/api/booking/bookings/${b.id}`, { method: 'PATCH', json: { status: 'cancelled' } })).status).toBe(200)
    ;[a] = await s2.db.select().from(s2.schema.appointment).where(eq(s2.schema.appointment.id, b.appointmentId!))
    expect(a.status).toBe('cancelled')
  })
})

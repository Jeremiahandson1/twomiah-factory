// The booking engine (server/booking/engine.ts) on a real database: settings refuse garbage, the free days and times
// follow the hours, notice and window, a booking claims its time and links its person, refusals name the reason, a
// customer's changes stop at the cut-off, staff close out only what has started, and a deposit holds its time until
// paid or expired. The clock stands still at Monday 2 Nov 2026, 09:00 in Chicago.
//
// PGlite has one connection, so the per-day lock can't be shown racing here (it serialises anyway); the lock is the
// CRMs' engine's, proven on Postgres in their suite (fieldservice t58d: first customer wins, second gets "taken").
import { describe, test, expect, beforeAll, afterEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createBookingEngine, BookingError, type BookingHappening } from '../server/booking/engine.ts'

const NOW = Date.parse('2026-11-02T15:00:00Z') // Monday 09:00 America/Chicago
let clock = NOW
let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let ownerId = ''
const happenings: BookingHappening[] = []
let provider: 'ok' | 'fail' | 'none' = 'none'
const opened: Array<{ bookingId: string; token: string; amount: number; expiresAt: Date; description: string }> = []

const engine = () => createBookingEngine({
  db: t.db, requireAddressDefault: false, now: () => clock,
  onHappening: (h) => { happenings.push(h) },
  deposits: provider === 'none' ? undefined : {
    checkout: async (a) => { opened.push(a); return provider === 'ok' ? { url: 'https://checkout.stripe.com/c/pay/cs_' + opened.length, reference: 'cs_' + opened.length } : null },
  },
})
const refusal = async (p: Promise<unknown>) => { try { await p; return null } catch (e) { return e instanceof BookingError ? e : (() => { throw e })() } }
const who = { name: 'Pat Jones', email: 'Pat@Example.com', phone: '608-555-0100' }

beforeAll(async () => {
  t = await bootTenant()
  const s = await seedOwner(t)
  companyId = s.company.id
  ownerId = s.owner.id
  const e = engine()
  await e.updateSettings(companyId, { timezone: 'America/Chicago', leadTimeMinutes: 120, maxDaysOut: 14 })
  // Monday–Friday 9–12 and 13–17 for "anyone".
  await e.setHours(companyId, [1, 2, 3, 4, 5].flatMap((d) => [{ dayOfWeek: d, start: '09:00', end: '12:00' }, { dayOfWeek: d, start: '13:00', end: '17:00' }]))
  await e.createService(companyId, { name: 'Lawn mowing', durationMinutes: 60, price: 80, slotStepMinutes: 60, bufferAfterMinutes: 30 })
})

describe('settings', () => {
  test('garbage is refused, not turned into a default', async () => {
    expect((await refusal(engine().updateSettings(companyId, { leadTimeMinutes: 'abc' })))?.message).toContain('must be a number')
    expect((await refusal(engine().updateSettings(companyId, { timezone: 'Mars/Olympus' })))?.message).toContain('not recognised')
    expect((await refusal(engine().updateSettings(companyId, { reviewLink: 'http://x.example' })))?.message).toContain('https')
  })
})

describe('services', () => {
  test('a slug is made from the name and must be unique', async () => {
    const svc = await engine().serviceBySlug(companyId, 'lawn-mowing')
    expect(svc?.name).toBe('Lawn mowing')
    expect((await refusal(engine().createService(companyId, { name: 'Lawn Mowing!' })))?.status).toBe(409)
  })

  test('a deposit is an amount or a percent of a price, not both', async () => {
    expect((await refusal(engine().createService(companyId, { name: 'Bad', depositAmount: 20, depositPercent: 10, price: 100 })))?.message).toContain('not both')
    expect((await refusal(engine().createService(companyId, { name: 'Bad two', depositPercent: 10 })))?.message).toContain('price')
  })
})

describe('free days and times', () => {
  test('weekdays only, within the window, today included only where the notice allows', async () => {
    const days = await engine().availableDates(companyId, 'lawn-mowing')
    expect(days[0]).toBe('2026-11-02')
    expect(days).not.toContain('2026-11-07') // Saturday
    expect(days.at(-1)! <= '2026-11-16').toBe(true)
  })

  test('today: nothing inside two hours\' notice; the lunch break is not offered', async () => {
    const times = (await engine().availableTimes(companyId, 'lawn-mowing', '2026-11-02')).map((x) => x.time)
    expect(times).toEqual(['13:00', '14:00', '15:00']) // 11:00 is inside the notice; 16:00 + 30 min clean-up passes 17:00
  })

  test('a date that isn\'t a day is refused for being one', async () => {
    expect((await refusal(engine().availableTimes(companyId, 'lawn-mowing', '2026-02-30')))?.message).toContain('not a real date')
  })
})

describe('booking', () => {
  test('a customer books: their person is made, the time is claimed, the happening is told', async () => {
    const r = await engine().book(companyId, { service: 'lawn-mowing', date: '2026-11-03', time: '09:00', ...who }, { by: 'customer' })
    expect(r.booking.status).toBe('confirmed')
    expect(r.booking.customerEmail).toBe('pat@example.com')
    expect(r.booking.token.length).toBeGreaterThan(30)
    const [c] = await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.id, r.booking.contactId!))
    expect(c.email).toBe('pat@example.com')
    expect(happenings.at(-1)?.event).toBe('booking.created')
    const times = (await engine().availableTimes(companyId, 'lawn-mowing', '2026-11-03')).map((x) => x.time)
    // 9–10 is taken and its 30 minutes' clean-up keeps 10:00 off; 11:00 never fits before the noon break with its
    // own clean-up after it.
    expect(times).toEqual(['13:00', '14:00', '15:00'])
  })

  test('the same person booking again is linked to the same record', async () => {
    const r = await engine().book(companyId, { service: 'lawn-mowing', date: '2026-11-03', time: '14:00', ...who, name: 'Pat J.' }, { by: 'customer' })
    const first = (await engine().listBookings(companyId, { page: 1, limit: 10 })).rows.find((b: { startAt: Date }) => b.startAt.toISOString().startsWith('2026-11-03T15'))
    expect(r.booking.contactId).toBe(first!.contactId)
  })

  test('each refusal says which thing is wrong', async () => {
    const e = engine()
    expect((await refusal(e.book(companyId, { service: 'lawn-mowing', date: '2026-11-03', time: '09:00', ...who }, { by: 'customer' })))?.code).toBe('taken')
    const off = await refusal(e.book(companyId, { service: 'lawn-mowing', date: '2026-11-05', time: '03:00', ...who }, { by: 'customer' }))
    expect(off?.code).toBe('not_offered')
    expect(off?.message).toContain('Open: 9 AM, 10 AM, 1 PM, 2 PM, 3 PM.')
    // 3 November is full after the two bookings above: the refusal says so rather than listing nothing.
    expect((await refusal(e.book(companyId, { service: 'lawn-mowing', date: '2026-11-03', time: '03:00', ...who }, { by: 'customer' })))?.message).toContain('the rest of the day is full')
    expect((await refusal(e.book(companyId, { service: 'lawn-mowing', date: '2026-11-07', time: '09:00', ...who }, { by: 'customer' })))?.code).toBe('closed')
    expect((await refusal(e.book(companyId, { service: 'lawn-mowing', date: '2026-11-02', time: '09:00', ...who }, { by: 'customer' })))?.code).toBe('notice')
    expect((await refusal(e.book(companyId, { service: 'lawn-mowing', date: '2026-12-30', time: '09:00', ...who }, { by: 'customer' })))?.message).toContain('within 14 days')
    expect((await refusal(e.book(companyId, { service: 'lawn-mowing', date: '2026-11-04', time: '09:00', ...who, phone: '' }, { by: 'customer' })))?.message).toContain('phone')
  })

  test('a banned address is refused plainly, not given a fake success', async () => {
    await t.db.insert(t.schema.bookingBan).values({ companyId, email: 'troll@example.com' })
    const r = await refusal(engine().book(companyId, { service: 'lawn-mowing', date: '2026-11-04', time: '09:00', name: 'T', email: 'TROLL@example.com', phone: '1' }, { by: 'customer' }))
    expect(r?.code).toBe('refused')
  })

  test('staff can book over the hours only when they say so', async () => {
    const e = engine()
    expect((await refusal(e.book(companyId, { service: 'lawn-mowing', date: '2026-11-07', time: '10:00', ...who }, { by: 'staff' })))?.code).toBe('closed')
    const r = await e.book(companyId, { service: 'lawn-mowing', date: '2026-11-07', time: '10:00', ...who }, { by: 'staff', override: true })
    expect(r.booking.source).toBe('staff')
  })

  test("someone's own calendar blocks their time", async () => {
    const e = createBookingEngine({ db: t.db, requireAddressDefault: false, now: () => clock, externalBusy: async () => [{ userId: ownerId, start: new Date('2026-11-05T15:00:00Z'), end: new Date('2026-11-05T17:00:00Z'), eventId: 'ev1' }] })
    const times = (await e.availableTimes(companyId, 'lawn-mowing', '2026-11-05')).map((x) => x.time)
    expect(times).toEqual(['13:00', '14:00', '15:00'])
  })
})

describe("changing it", () => {
  test('the customer moves it to a free time; a taken time is refused; it doesn\'t block itself', async () => {
    const e = engine()
    const { booking: b } = await e.book(companyId, { service: 'lawn-mowing', date: '2026-11-06', time: '09:00', ...who }, { by: 'customer' })
    expect((await refusal(e.reschedule(companyId, b, '2026-11-03', '09:00', { by: 'customer' })))?.code).toBe('taken')
    const moved = await e.reschedule(companyId, b, '2026-11-06', '09:00', { by: 'customer' })
    expect(moved.startAt.toISOString()).toBe('2026-11-06T15:00:00.000Z')
    const later = await e.reschedule(companyId, moved, '2026-11-06', '13:00', { by: 'customer' })
    expect(happenings.at(-1)?.event).toBe('booking.rescheduled')
    expect(happenings.at(-1)?.previousStartAt?.toISOString()).toBe('2026-11-06T15:00:00.000Z')
    expect(later.startAt.toISOString()).toBe('2026-11-06T19:00:00.000Z')
  })

  test('inside the cut-off the customer is sent to the phone; staff can still change it', async () => {
    const e = engine()
    const { booking: b } = await e.book(companyId, { service: 'lawn-mowing', date: '2026-11-04', time: '13:00', ...who }, { by: 'customer' })
    clock = Date.parse('2026-11-04T18:30:00Z') // 12:30 that day: 30 minutes before
    expect((await refusal(e.cancel(companyId, b, { by: 'customer' })))?.code).toBe('cutoff')
    const c = await e.cancel(companyId, b, { by: 'staff', reason: 'rain' })
    expect(c.status).toBe('cancelled')
    expect(c.cancelledReason).toBe('rain')
    clock = NOW
  })

  test('completed and no-show only once the visit has started', async () => {
    const e = engine()
    const { booking: b } = await e.book(companyId, { service: 'lawn-mowing', date: '2026-11-09', time: '09:00', ...who }, { by: 'customer' })
    expect((await refusal(e.setStatus(companyId, b, 'completed')))?.message).toContain("hasn't started")
    clock = Date.parse('2026-11-09T16:00:00Z')
    expect((await e.setStatus(companyId, b, 'completed')).status).toBe('completed')
    expect(happenings.at(-1)?.event).toBe('booking.completed')
    clock = NOW
  })
})

describe('deposits', () => {
  afterEach(() => { clock = NOW })
  test('a deposit holds the time as pending; unpaid past the hold, the time is released', async () => {
    provider = 'ok'
    const e = engine()
    await e.createService(companyId, { name: 'Consultation', durationMinutes: 60, price: 100, depositPercent: 25, slotStepMinutes: 60 })
    const r = await e.book(companyId, { service: 'consultation', date: '2026-11-10', time: '09:00', ...who }, { by: 'customer' })
    expect(r.booking.status).toBe('pending')
    expect(r.booking.depositAmount).toBe('25.00')
    // Stripe's page for it, held as long as the time is: 25 of the 100 price, the hold from the booking's own clock
    expect(r.deposit?.url).toMatch(/^https:\/\/checkout\.stripe\.com\//)
    expect(opened.at(-1)).toMatchObject({ bookingId: r.booking.id, token: r.booking.token, amount: 25, description: 'Deposit for Consultation' })
    expect(opened.at(-1)!.expiresAt.getTime()).toBe(NOW + 30 * 60_000)
    expect(r.booking.paymentIntentId).toBe('cs_' + opened.length)
    expect((await e.availableTimes(companyId, 'consultation', '2026-11-10')).map((x) => x.time)).not.toContain('09:00')
    clock = NOW + 31 * 60_000
    expect((await e.availableTimes(companyId, 'consultation', '2026-11-10')).map((x) => x.time)).toContain('09:00')
    const [gone] = await t.db.select().from(t.schema.booking).where(eq(t.schema.booking.id, r.booking.id))
    expect([gone.status, gone.depositStatus]).toEqual(['cancelled', 'expired'])
    clock = NOW
  })

  const row = async (id: string) => (await t.db.select().from(t.schema.booking).where(eq(t.schema.booking.id, id)))[0]

  test('paid in time, the hold becomes a booking — once, however often Stripe tells us', async () => {
    provider = 'ok'
    const e = engine()
    const r = await e.book(companyId, { service: 'consultation', date: '2026-11-10', time: '10:00', ...who }, { by: 'customer' })
    happenings.length = 0
    expect(await e.depositPaid(companyId, r.booking.id, 'pi_1')).toBe('done')
    const b = await row(r.booking.id)
    expect([b.status, b.depositStatus, b.paymentIntentId]).toEqual(['confirmed', 'paid', 'pi_1'])
    expect(happenings.map((h) => h.event)).toEqual(['booking.created'])
    expect(await e.depositPaid(companyId, r.booking.id, 'pi_1')).toBe('done')
    expect(happenings.length).toBe(1)
    expect(await e.depositPaid(companyId, 'no-such-booking', 'pi_x')).toBe('unknown')
  })

  test('paid after its hold ran out: confirmed again if the time is still free and ahead', async () => {
    provider = 'ok'
    const e = engine()
    const r = await e.book(companyId, { service: 'consultation', date: '2026-11-16', time: '09:00', ...who }, { by: 'customer' })
    clock = NOW + 45 * 60_000
    await e.availableTimes(companyId, 'consultation', '2026-11-16') // the hold is released
    expect((await row(r.booking.id)).status).toBe('cancelled')
    expect(await e.depositPaid(null, r.booking.id, 'pi_late')).toBe('done')
    const b = await row(r.booking.id)
    expect([b.status, b.depositStatus, b.cancelledReason]).toEqual(['confirmed', 'paid', null])
    clock = NOW
  })

  test('paid after its hold ran out and the time was taken: refunded, and recorded so', async () => {
    provider = 'ok'
    const e = engine()
    const r = await e.book(companyId, { service: 'consultation', date: '2026-11-16', time: '13:00', ...who }, { by: 'customer' })
    clock = NOW + 45 * 60_000
    await e.availableTimes(companyId, 'consultation', '2026-11-16')
    provider = 'none'
    await engine().book(companyId, { service: 'consultation', date: '2026-11-16', time: '13:00', name: 'Someone Else', email: 'else@example.com', phone: '608-555-0199' }, { by: 'customer' })
    expect(await e.depositPaid(null, r.booking.id, 'pi_late2')).toBe('refund')
    await e.depositRefunded(null, r.booking.id, 'pi_late2')
    const b = await row(r.booking.id)
    expect([b.status, b.depositStatus, b.paymentIntentId]).toEqual(['cancelled', 'refunded', 'pi_late2'])
    expect(await e.depositPaid(null, r.booking.id, 'pi_late2')).toBe('done') // a retry changes nothing
    clock = NOW
  })

  test('a booking someone cancelled is not brought back by a payment: refunded', async () => {
    provider = 'ok'
    const e = engine()
    const r = await e.book(companyId, { service: 'consultation', date: '2026-11-12', time: '09:00', ...who }, { by: 'customer' })
    await e.cancel(companyId, r.booking, { by: 'customer' })
    expect(await e.depositPaid(companyId, r.booking.id, 'pi_c')).toBe('refund')
  })

  test('the customer can open the payment page again while the time is held, not after', async () => {
    provider = 'ok'
    const e = engine()
    const r = await e.book(companyId, { service: 'consultation', date: '2026-11-12', time: '10:00', ...who }, { by: 'customer' })
    const before = opened.length
    const url = await e.depositPage(companyId, r.booking)
    expect(url).toBe('https://checkout.stripe.com/c/pay/cs_' + (before + 1))
    expect((await row(r.booking.id)).paymentIntentId).toBe('cs_' + (before + 1))
    expect(opened.at(-1)!.expiresAt.getTime()).toBe(NOW + 30 * 60_000) // not extended
    clock = NOW + 31 * 60_000
    expect(await e.depositPage(companyId, r.booking)).toBeNull()
    clock = NOW
  })

  test('a deposit that can\'t be taken leaves the booking standing, not quietly cancelled later', async () => {
    provider = 'fail'
    const e = engine()
    const r = await e.book(companyId, { service: 'consultation', date: '2026-11-10', time: '11:00', ...who }, { by: 'customer' })
    expect([r.booking.status, r.booking.depositStatus]).toEqual(['confirmed', 'none'])
    clock = NOW + 60 * 60_000
    await e.availableTimes(companyId, 'consultation', '2026-11-10')
    const [still] = await t.db.select().from(t.schema.booking).where(eq(t.schema.booking.id, r.booking.id))
    expect(still.status).toBe('confirmed')
    clock = NOW
    provider = 'none'
  })
})

describe('daylight saving', () => {
  test('a 9:00 booking on the day the clocks go back is 9:00 local', async () => {
    clock = Date.parse('2026-10-26T15:00:00Z')
    const e = engine()
    // 2026-11-01 is a Sunday; open it for this test.
    await e.setHours(companyId, [0, 1, 2, 3, 4, 5].flatMap((d) => [{ dayOfWeek: d, start: '09:00', end: '12:00' }, { dayOfWeek: d, start: '13:00', end: '17:00' }]))
    const r = await e.book(companyId, { service: 'lawn-mowing', date: '2026-11-01', time: '09:00', ...who }, { by: 'customer' })
    expect(r.booking.startAt.toISOString()).toBe('2026-11-01T15:00:00.000Z') // CST, after the change
    clock = NOW
  })
})

// From the field-service CRM's suite (t58 booking-keeps-service-name, t59 require-address), whose bookings these are now.
describe('what the owner reads back, and the address question', () => {
  test("the owner's list keeps what each booking was for", async () => {
    const { rows } = await engine().listBookings(companyId, { page: 1, limit: 100 })
    const mowing = rows.filter((b: { serviceName?: string | null }) => b.serviceName === 'Lawn mowing')
    expect(mowing.length).toBeGreaterThan(0)
  })

  test("asking for the address is the owner's switch; unset, it is the vertical's answer", async () => {
    const e = engine()
    const at = (date: string) => ({ service: 'lawn-mowing', date, time: '13:00', ...who })
    // This vertical's answer is "no" (requireAddressDefault: false): no address needed.
    expect((await e.book(companyId, at('2026-11-11'), { by: 'customer' })).booking.status).toBe('confirmed')
    // The owner turns it on: the server refuses a booking without one, and takes one with it.
    await e.updateSettings(companyId, { requireAddress: true })
    expect((await refusal(e.book(companyId, at('2026-11-12'), { by: 'customer' })))?.message).toContain('address')
    expect((await e.book(companyId, { ...at('2026-11-12'), address: '12 Main St', zip: '53593' }, { by: 'customer' })).booking.customerAddress).toBe('12 Main St')
    // Unset again, a vertical whose answer is "yes" asks for it.
    await e.updateSettings(companyId, { requireAddress: null })
    const asks = createBookingEngine({ db: t.db, requireAddressDefault: true, now: () => clock })
    expect((await refusal(asks.book(companyId, at('2026-11-13'), { by: 'customer' })))?.message).toContain('address')
  })
})

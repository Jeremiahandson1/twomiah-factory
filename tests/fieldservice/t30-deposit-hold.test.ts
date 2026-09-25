// Field Service T30 — a booking waiting on its deposit held its slot forever.
//
// The release exists and always has: expireStaleDepositHolds() cancels a pending booking whose deposit is
// still unpaid past the hold window. It was only ever called from getAvailableSlots, so it ran as a SIDE
// EFFECT of somebody asking for that one day's times. A customer arriving by a direct link, a second tab,
// or the API went straight to createBooking and met a hold that had expired hours ago and had never been
// asked to leave.
//
// Both edges matter and they pull against each other: an abandoned hold must release, and a LIVE one must
// still block — releasing early would double-book somebody who is mid-payment.
//
// Driven through the PUBLIC routes, because that is the surface a customer meets and the service is not
// exported on its own.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, onlineBooking, bookingSettings, bookableService, job } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()

const SLUG = 't30dep'
const [co] = await db.insert(company).values({ name: 'T30 Deposit Co', slug: SLUG, email: 't30dep@test.local', settings: { timezone: 'UTC' }, enabledFeatures: ['online_booking', 'jobs', 'contacts'] } as any).returning()
await db.insert(user).values({ email: 'owner-t30dep@test.local', passwordHash: 'x', firstName: 'Ada', lastName: 'Owner', role: 'owner', companyId: co.id } as any)

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
await db.insert(bookingSettings).values({
  companyId: co.id, enabled: true, timezone: 'UTC', slotDurationMinutes: 60, maxDaysOut: 30, leadTimeDays: 0, concurrentBookings: 1,
  workingHours: Object.fromEntries(DAYS.map((d) => [d, { enabled: true, start: '09:00', end: '17:00' }])),
} as any)
const [service] = await db.insert(bookableService).values({ companyId: co.id, name: 'Deposit Service', durationMinutes: 60, price: '100.00', depositRequired: true, depositAmount: '25.00', active: true } as any).returning()

const app = new Hono()
app.route('/api/booking', (await import('./src/routes/booking.ts')).default)
app.onError(errorHandler)

const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
const TIME = '10:00'

const get = async (path: string) => {
  const res = await app.request(path)
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const bookAs = async (name: string, email: string) => {
  const res = await app.request(`/api/booking/public/${SLUG}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ serviceId: service.id, date: day, time: TIME, firstName: name, lastName: 'Tester', email, phone: '614-555-0100', address: '1 Test Street' }),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
/**
 * Take a real hold, then age it.
 *
 * A bare insert into online_booking blocks nothing: the slot is held by the linked JOB the booking
 * creates, which is what the calendar reads. Booking through the API and then backdating createdAt is
 * the only way to build the state this is about — my first version inserted the row directly and
 * "proved" a live hold does not block, which was my fixture being wrong, not the app.
 */
const holdAt = async (minutesAgo: number) => {
  const r = await bookAs('Holder', 'hold-t30@test.local')
  if (r.status !== 201 && r.status !== 200) throw new Error('could not take the hold: ' + JSON.stringify(r.json))
  const [row] = await db.select().from(onlineBooking).where(eq(onlineBooking.companyId, co.id))
  if (minutesAgo) await db.update(onlineBooking).set({ createdAt: new Date(Date.now() - minutesAgo * 60_000) }).where(eq(onlineBooking.id, row.id))
  const [after] = await db.select().from(onlineBooking).where(eq(onlineBooking.id, row.id))
  return after
}
/**
 * Clear both sides. The slot is held by the linked JOB, so deleting only the online_booking row leaves
 * the time blocked and the next hold cannot be taken — which is what "That time is no longer
 * available" was telling me between sections.
 */
const clearBookings = async () => {
  await db.delete(onlineBooking).where(eq(onlineBooking.companyId, co.id))
  await db.delete(job).where(eq(job.companyId, co.id))
}
const slotOffered = async () => {
  const r = await get(`/api/booking/public/${SLUG}/slots?date=${day}&serviceId=${service.id}`)
  const list = r.json?.slots || r.json?.data || r.json || []
  return (Array.isArray(list) ? list : []).map((s: any) => s.time || s).includes(TIME)
}

console.log('\n── a hold taken just now still blocks its slot ──')
{
  const fresh = await holdAt(0)
  check('the slot is not offered while the deposit is live', !(await slotOffered()), { time: TIME })
  const second = await bookAs('Second Customer', 'second-t30@test.local')
  check('…and a second customer cannot take it — releasing early would double-book someone mid-payment', second.status >= 400, { status: second.status })
  await clearBookings()
}

console.log('\n── a hold abandoned past its window releases ──')
{
  const stale = await holdAt(90)   // 90 min, past the 30-min default
  check('the slot is offered again', await slotOffered(), { time: TIME })
  const [row] = await db.select().from(onlineBooking).where(eq(onlineBooking.id, stale.id))
  check('…and the abandoned booking is cancelled, not left pending for ever', row?.status === 'cancelled', { status: row?.status })
  check('…with its deposit marked expired', row?.depositStatus === 'expired', { depositStatus: row?.depositStatus })
}

console.log('\n── THE FINDING: a customer arriving by a different route is not blocked by it ──')
{
  // createBooking never expired first, so a hold nobody had "looked at" blocked a real booking however
  // long ago it was abandoned — a direct link, a second tab, or the API all skip the slot list.
  await clearBookings()
  await holdAt(90)
  const direct = await bookAs('Direct Link', 'direct-t30@test.local')
  check('the booking succeeds without anyone having asked for slots first', direct.status === 200 || direct.status === 201, { status: direct.status, body: direct.json })
}

console.log('\n── and the DAY list stops advertising a day as full on a dead hold ──')
{
  await clearBookings()
  await holdAt(90)
  const r = await get(`/api/booking/public/${SLUG}/dates`)
  const dates = (r.json?.dates || r.json?.data || r.json || []).map((d: any) => d.date || d)
  check('the day is still offered', Array.isArray(dates) && dates.includes(day), { day, got: Array.isArray(dates) ? dates.slice(0, 3) : dates })
}

console.log(`\nfs-t30-deposit-hold: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)

// T58d — "the off-slot wording."
//
// Ask to book 03:00 at a shop that opens at eight and the answer was:
//
//   "That time is no longer available — please pick another slot."
//
// Three things wrong in one sentence. The time was never available, so "no longer" claims something
// about history that did not happen; "just taken" is what a customer reads it as, so the obvious
// next move is to try again in a minute, which can never work; and "pick another slot" does not say
// which, on a page that has already been left behind.
//
// The cause was narrow: createBooking could only see the list of FREE times, so every refusal came
// out of the one branch that could not tell "never offered" from "taken a second ago". It now reads
// the grid with the reason on each slot, and answers the four situations separately.
//
// The grid is the thing to pin, not the prose. Each case asserts which SITUATION the answer
// identifies — never offered / taken / too soon / day closed — rather than an exact sentence, so a
// better sentence does not fail this test. That is the mistake five guards made earlier in this
// campaign by pinning the expression instead of the rule.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 360)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Off Slot Plumbing', slug: 'offslot-t58d', email: 'os58d@test.local', settings: {},
  enabledFeatures: ['online_booking', 'jobs', 'contacts'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-os58d@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U',
  role: 'owner', companyId: co.id,
} as any).returning()

const app = new Hono()
app.route('/api/booking', (await import('./src/routes/booking.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': owner.role },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const pub = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

const HOURS = {
  monday: { start: '08:00', end: '17:00', enabled: true },
  tuesday: { start: '08:00', end: '17:00', enabled: true },
  wednesday: { start: '08:00', end: '17:00', enabled: true },
  thursday: { start: '08:00', end: '17:00', enabled: true },
  friday: { start: '08:00', end: '17:00', enabled: true },
  saturday: { start: '08:00', end: '17:00', enabled: false },
  sunday: { start: '08:00', end: '17:00', enabled: false },
}

console.log('\n══════════ setup ══════════')
{
  const s = await api('PUT', '/api/booking/settings', {
    enabled: true, leadTimeDays: 0, slotDurationMinutes: 60, concurrentBookings: 1,
    timezone: 'America/Chicago', workingHours: HOURS,
  })
  check('booking is on, 08:00–17:00 on weekdays, closed at the weekend', s.status === 200, { status: s.status, body: s.text?.slice(0, 260) })
}

let serviceId = ''
{
  const made = await api('POST', '/api/booking/services', { name: 'Drain clear', durationMinutes: 60, price: 120 })
  serviceId = made.json?.id || made.json?.data?.id
  check('one service is bookable', !!serviceId, made.json)
}

/** A weekday far enough out to clear any notice, in the shop's own zone. */
const weekdayAhead = (): string => {
  for (let i = 3; i < 20; i++) {
    const d = new Date(Date.now() + i * 864e5)
    const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'long' }).format(d).toLowerCase()
    if ((HOURS as any)[day]?.enabled) return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  }
  throw new Error('no open weekday found')
}
const weekendAhead = (): string => {
  for (let i = 1; i < 20; i++) {
    const d = new Date(Date.now() + i * 864e5)
    const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'long' }).format(d).toLowerCase()
    if (!(HOURS as any)[day]?.enabled) return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  }
  throw new Error('no closed day found')
}

const book = (date: string, time: string) => pub('POST', `/api/booking/public/${co.slug}`, {
  serviceId, date, time,
  firstName: 'Ada', lastName: 'Customer', email: `ada-${time.replace(':', '')}-os58d@test.local`, phone: '555-0101',
  address: '14 Mill Lane', city: 'Dayton', state: 'OH', zip: '45402',
})

const OPEN_DAY = weekdayAhead()
const CLOSED_DAY = weekendAhead()

// ══════════ 1. the openings really are 08:00–16:00 ═════════════════════════════════════════════
let openings: string[] = []
{
  const slots = await pub('GET', `/api/booking/public/${co.slug}/slots?date=${OPEN_DAY}&serviceId=${serviceId}`)
  openings = (slots.json?.data || slots.json || []).map((s: any) => s.time)
  check('the day offers slots', openings.length > 0, { openings })
  check('…none of them before opening time', !openings.some(t => t < '08:00'), { openings })
  check('…and 03:00 is not one of them', !openings.includes('03:00'), { openings })
}

// ══════════ 2. A TIME THAT WAS NEVER OFFERED ═══════════════════════════════════════════════════
//
// THE FINDING. This is the request that used to be told the slot had just gone.
{
  const res = await book(OPEN_DAY, '03:00')
  const msg = String(res.json?.error || res.text || '')
  check('03:00 on an open day is refused', res.status >= 400, { status: res.status, msg })
  check('…and the refusal does NOT claim it was taken or is "no longer" available',
    !/no longer/i.test(msg) && !/just been taken/i.test(msg), { msg })
  check('…it says the time is not offered', /not one of the times offered|not a time we offer|not offered/i.test(msg), { msg })
  check('…and it names at least one time that IS available, so there is somewhere to go',
    openings.some(t => msg.includes(t)), { msg, openings: openings.slice(0, 8) })
}

// ══════════ 3. a day the shop is closed ════════════════════════════════════════════════════════
{
  const res = await book(CLOSED_DAY, '10:00')
  const msg = String(res.json?.error || res.text || '')
  check('a closed day is refused', res.status >= 400, { status: res.status, msg })
  check('…and says the DAY is the problem, not the slot', /day/i.test(msg) && !/just been taken/i.test(msg), { msg })
}

// ══════════ 4. a slot somebody else already has ════════════════════════════════════════════════
//
// concurrentBookings is 1, so the second request for the same time is genuinely taken — and THIS is
// the only case where "just been taken" is the truth.
{
  const first = await book(OPEN_DAY, openings[0])
  check('the first customer gets the slot', first.status === 200 || first.status === 201, { status: first.status, body: first.text?.slice(0, 300) })

  const second = await book(OPEN_DAY, openings[0])
  const msg = String(second.json?.error || second.text || '')
  check('the second is refused', second.status >= 400, { status: second.status, msg })
  check('…and THAT one does say it has been taken', /taken/i.test(msg), { msg })
  check('…and does not claim it was never offered', !/not one of the times offered|not offered/i.test(msg), { msg })
}

// ══════════ 5. inside the notice window ════════════════════════════════════════════════════════
//
// With two days' notice, a slot the day after tomorrow is on the grid and still not bookable. The
// old code called that "no longer available" too.
{
  const s = await api('PUT', '/api/booking/settings', { leadTimeDays: 2 })
  check('the shop now asks for two days notice', s.status === 200, { status: s.status, body: s.text?.slice(0, 200) })

  const soon = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() + 864e5))
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'long' }).format(new Date(Date.now() + 864e5)).toLowerCase()
  if (!(HOURS as any)[day]?.enabled) {
    console.log('  note  tomorrow is a closed day for this shop, so the notice case is not exercised today')
  } else {
    const res = await book(soon, '10:00')
    const msg = String(res.json?.error || res.text || '')
    check('a time inside the notice window is refused', res.status >= 400, { status: res.status, msg })
    check('…and the refusal is about NOTICE, not about the slot being taken',
      /too soon|notice/i.test(msg) && !/just been taken/i.test(msg), { msg })
    check('…and it names how much notice is needed', /2 days|two days/i.test(msg), { msg })
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)

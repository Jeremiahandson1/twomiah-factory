// Salon N1 — "after 7 PM Central, today and invoice dates are a day ahead".
//
// This is the finding the tester has never been able to retest: it only shows between 7 PM and midnight
// Central, and both runs happened in the small hours. So the clock is PINNED here instead of waited for.
//
// The instant chosen is 01:30 UTC, which in America/Chicago (CDT, UTC−5) is 20:30 the PREVIOUS day. Every
// question below therefore has two different right-looking answers — the UTC day and the shop's day — and
// only one of them is correct. A test that runs at any other hour cannot tell them apart, which is exactly
// why this defect survived two rounds of testing.
//
// Freezing the clock rather than mocking the helpers means the real route files, the real shared invoicing
// and the real date utilities all run; nothing is stubbed except what time it is.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, appointment, bookingSettings } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

const TZ = 'America/Chicago'
const dayIn = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

await setupSchema()

// ── the clock ────────────────────────────────────────────────────────────────────────────────────
// Tomorrow at 01:30 UTC — a real future instant, so nothing else in the app thinks time ran backwards.
const RealDate = Date
const frozen = new RealDate(RealDate.UTC(
  new RealDate().getUTCFullYear(), new RealDate().getUTCMonth(), new RealDate().getUTCDate() + 1, 1, 30, 0,
))
const utcDay = frozen.toISOString().slice(0, 10)
const shopDay = dayIn(frozen, TZ)
console.log(`\nfrozen at ${frozen.toISOString()}  ·  UTC day ${utcDay}  ·  ${TZ} day ${shopDay}`)
if (utcDay === shopDay) { console.log('FAIL the two days are the same — this test cannot discriminate'); process.exit(1) }

class FrozenDate extends RealDate {
  constructor(...args: any[]) {
    // @ts-expect-error — forwarding the real constructor's overloads
    if (args.length === 0) super(frozen.getTime()); else super(...args)
  }
  static now() { return frozen.getTime() }
}
;(globalThis as any).Date = FrozenDate

const app = new Hono()
app.route('/api/dashboard', (await import('./src/routes/dashboard.ts')).default)
app.route('/api/invoices', (await import('./src/routes/invoices.ts')).default)
app.route('/api/appointments', (await import('./src/routes/appointments.ts')).default)
app.onError(errorHandler)

const [co] = await db.insert(company).values({ name: 'Evening Salon', slug: 'evening-salon', email: 'evening@t.local', settings: { timezone: TZ }, enabledFeatures: ['salon_booking', 'invoices', 'client_profiles'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'evening@t.local', passwordHash: 'x', firstName: 'Ola', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
const [client] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Evening Client' } as any).returning()
// The shop's timezone lives on booking settings — that is what salonTimezone() reads.
await db.insert(bookingSettings).values({
  companyId: co.id, enabled: true, timezone: TZ, slotDurationMinutes: 60, maxDaysOut: 30, leadTimeDays: 0, concurrentBookings: 1,
  workingHours: Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, { enabled: true, start: '09:00', end: '20:00' }])),
} as any)

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

// ── the invoice's issue date ─────────────────────────────────────────────────────────────────────
console.log('\n── an invoice raised at 8:30 PM Central is dated TODAY, not tomorrow ──')
{
  const r = await call('POST', '/api/invoices', { contactId: client.id, lineItems: [{ description: 'Cut', quantity: 1, unitPrice: 40 }] })
  check('the invoice is raised', r.status === 201, { status: r.status, body: r.json })
  const issued = String(r.json?.issueDate || '').slice(0, 10)
  check(`its issue date is the shop's day (${shopDay})`, issued === shopDay, { issueDate: issued, shopDay, utcDay })
  check(`…and NOT the UTC day (${utcDay})`, issued !== utcDay, { issueDate: issued })
}

// ── "today" on the dashboard ─────────────────────────────────────────────────────────────────────
console.log('\n── the evening\'s remaining appointments still count as today ──')
{
  // 9:00 PM Central this evening — later tonight, on the shop's calendar, but already tomorrow in UTC.
  const tonight = new RealDate(frozen.getTime() + 30 * 60_000)
  await db.insert(appointment).values({ companyId: co.id, contactId: client.id, startTime: tonight, endTime: new RealDate(tonight.getTime() + 1800_000), status: 'scheduled' } as any)
  const stats = await call('GET', '/api/dashboard/stats')
  check('the dashboard loads', stats.status === 200, { status: stats.status })
  check('tonight\'s 9 PM appointment is counted in today', Number(stats.json?.appointments?.today) === 1, { today: stats.json?.appointments?.today, tonight: tonight.toISOString() })
}

// ── check-in, which compares two calendar days ───────────────────────────────────────────────────
console.log('\n── a client arriving this evening can be checked in ──')
{
  const soon = new RealDate(frozen.getTime() + 15 * 60_000)
  const [appt] = await db.insert(appointment).values({ companyId: co.id, contactId: client.id, startTime: soon, endTime: new RealDate(soon.getTime() + 1800_000), status: 'scheduled' } as any).returning()
  const r = await call('POST', `/api/appointments/${appt.id}/check-in`)
  check('check-in succeeds — the appointment is TODAY on the shop\'s calendar', r.status === 200, { status: r.status, error: r.json?.error })
}

;(globalThis as any).Date = RealDate
console.log(`\nt28-evening-dates: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)

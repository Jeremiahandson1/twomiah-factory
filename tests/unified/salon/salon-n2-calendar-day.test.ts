// ADAPTED COPY of tests/salon/salon-n2-calendar-day.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except the
// 7 read(s) marked "unified:", where the rulebook's reply shapes replaced the template's. The original keeps
// running against the template; tests/unified/harness/unified-divergences.ts names the assertions this copy stands in for.
// Salon T25 N2 — "UTC-vs-local in three places". This covers the two the BACKEND owns:
//   * a membership enrolment is dated on the shop's calendar, not UTC's — a 7pm Chicago sign-up was
//     recorded as starting TOMORROW, its first invoice line was labelled with tomorrow's period, and
//     nextRenewal() then carried that extra day into every anniversary after it;
//   * the future-visit guard on PUT /clients/:id/profile asks the shop's calendar — it used to reject a
//     patch test done THIS MORNING east of UTC, and accept a genuinely future one west of it.
// (The third place is the frontend's Book default date, covered by the live check.)
//
// Deterministic at any hour: it runs against BOTH extremes of the zone map — Kiritimati (UTC+14) and
// Niue (UTC-11) — and at every instant at least one of them sits on a different calendar day from UTC,
// so the assertion that actually discriminates is always armed. The test says which one it was.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, membershipPlan, bookingSettings, invoice, invoiceLineItem } from './db/schema.ts'
import { eq } from 'drizzle-orm'
import { setSystemTime } from 'bun:test' /* unified: PINNED CLOCK (2026-10-24): the file read the wall clock, so which of its assertions were armed depended on the hour it ran (Niue is on UTC's day from 11:00Z to 24:00Z and a day behind it otherwise; it went red at 01:14Z). It now runs both zones at two pinned instants — one with Niue behind UTC, one with Niue on UTC's day — so every assertion runs, whatever the hour */
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 240)) } }

const dayIn = (tz: string, d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const utcDay = () => new Date().toISOString().slice(0, 10)
/** A month on from the shop's day, on the same day or that month's last day (Oct 31 → Nov 30). */
const aMonthOn = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10)
}
const plusDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10)
}

await setupSchema()
const [co] = await db.insert(company).values({ name: 'Shear Calendar', slug: 'shear-n2', email: 'n2@test.local', settings: {}, enabledFeatures: ['appointments', 'memberships'], timezone: 'America/Chicago' } /* unified: ONE CLOCK (batch 2, fix-e): the shop's day is the company's time zone (Settings › Company, company.timezone); booking_settings.timezone is no longer read, so the shop's zone is set where the app reads it */ as any).returning()
const [owner] = await db.insert(user).values({ email: 'n2@test.local', passwordHash: 'x', firstName: 'Nina', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
const [plan] = await db.insert(membershipPlan).values({ companyId: co.id, name: 'Blowout Club', price: '99.00', billingCycle: 'monthly' } as any).returning()
await db.insert(bookingSettings).values({ companyId: co.id, workingHours: {}, timezone: 'America/Chicago' } as any)

const app = new Hono()
app.route('/api/memberships', (await import('./src/routes/memberships.ts')).default)
app.route('/api/clients', (await import('./src/routes/clients.ts')).default)
app.onError(errorHandler)
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json }
}
const setTz = (tz: string) => db.update(company).set({ timezone: tz } as any).where(eq(company.id, co.id)) /* unified: ONE CLOCK (batch 2, fix-e): the shop's day is the company's time zone (Settings › Company, company.timezone); booking_settings.timezone is no longer read, so the shop's zone is set where the app reads it */

let discriminated = 0

// 01:30Z: Niue (UTC-11) is still on the day before UTC's. 12:00Z: Niue is on UTC's day; Kiritimati (UTC+14) a day ahead.
const INSTANTS = ['2026-10-24T01:30:00Z', '2026-10-24T12:00:00Z']
const niueBehind: boolean[] = []
for (const [round, instant] of INSTANTS.entries()) {
setSystemTime(new Date(instant))
console.log(`\n== the clock pinned at ${instant}`)
for (const tz of ['Pacific/Kiritimati', 'Pacific/Niue']) { /* unified: PINNED CLOCK (2026-10-24): the file read the wall clock, so which of its assertions were armed depended on the hour it ran (Niue is on UTC's day from 11:00Z to 24:00Z and a day behind it otherwise; it went red at 01:14Z). It now runs both zones at two pinned instants — one with Niue behind UTC, one with Niue on UTC's day — so every assertion runs, whatever the hour */
  await setTz(tz)
  const shopDay = dayIn(tz)
  const utc = utcDay()
  const differs = shopDay !== utc
  console.log(`\n-- ${tz}: shop ${shopDay}, utc ${utc}${differs ? '  <-- discriminating' : '  (same day right now)'}`)
  if (differs) discriminated++
  if (tz === 'Pacific/Niue') niueBehind.push(differs && shopDay < utc) /* unified: PINNED CLOCK (2026-10-24): the file read the wall clock, so which of its assertions were armed depended on the hour it ran (Niue is on UTC's day from 11:00Z to 24:00Z and a day behind it otherwise; it went red at 01:14Z). It now runs both zones at two pinned instants — one with Niue behind UTC, one with Niue on UTC's day — so every assertion runs, whatever the hour */

  // --- enrolment start date -------------------------------------------------
  const [ct] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: `Client ${tz} ${round}`, email: `${tz.replace(/\W/g, '')}${round}@test.local` } /* unified: one client per zone per pinned instant */ as any).returning()
  const enrol = await call('POST', '/api/memberships/enrollments', { planId: plan.id, contactId: ct.id })
  check(`${tz}: enrolling succeeds`, enrol.status === 201, enrol.json)
  check(`${tz}: start date is the SHOP's day`, enrol.json?.startDate === shopDay, { got: enrol.json?.startDate, shopDay, utc })
  if (differs) check(`${tz}: …which is NOT the UTC day`, enrol.json?.startDate !== utc, { got: enrol.json?.startDate, utc })

  // the first invoice's line is labelled with that same period
  const [inv] = await db.select().from(invoice).where(eq(invoice.id, enrol.json?.invoiceId || '')).limit(1)
  const lines = inv ? await db.select().from(invoiceLineItem).where(eq(invoiceLineItem.invoiceId, inv.id)) : []
  check(`${tz}: the invoice line names the shop's period`, !!lines[0]?.description?.includes(shopDay), lines[0]?.description)

  // the renewal anniversary is a month from the shop's day, not UTC's — the same day, or the month's last when it is
  // shorter (the 31st renews on Nov 30; it rolled over to Dec 1 until 10/30, when CI reached a Kiritimati Oct 31)
  check(`${tz}: the renewal anniversary follows the shop's day`, enrol.json?.renewsAt === aMonthOn(shopDay), { renewsAt: enrol.json?.renewsAt, shopDay, want: aMonthOn(shopDay) })

  // --- the future-visit guard ----------------------------------------------
  const okToday = await call('PUT', `/api/clients/${ct.id}/profile`, { patchTestAt: shopDay })
  check(`${tz}: a patch test done TODAY on the shop's calendar is accepted`, okToday.status === 200, okToday.json)

  const tomorrow = await call('PUT', `/api/clients/${ct.id}/profile`, { patchTestAt: plusDays(shopDay, 1) })
  check(`${tz}: tomorrow is still refused`, tomorrow.status === 400, tomorrow.json)

  if (differs && shopDay < utc) {
    // West of UTC: the UTC day is already tomorrow here, and the guard has to say so.
    const utcDated = await call('PUT', `/api/clients/${ct.id}/profile`, { patchTestAt: utc })
    check(`${tz}: a date that is only "today" in UTC is refused`, utcDated.status === 400, utcDated.json)
  }
}

}
setSystemTime()
check('at least one zone sat on a different calendar day from UTC (the test discriminates)', discriminated > 0, { discriminated })
check("the pinned clock put Niue behind UTC at the first instant and on UTC's day at the second", JSON.stringify(niueBehind) === '[true,false]', niueBehind) /* unified: PINNED CLOCK (2026-10-24): the file read the wall clock, so which of its assertions were armed depended on the hour it ran (Niue is on UTC's day from 11:00Z to 24:00Z and a day behind it otherwise; it went red at 01:14Z). It now runs both zones at two pinned instants — one with Niue behind UTC, one with Niue on UTC's day — so every assertion runs, whatever the hour */

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)

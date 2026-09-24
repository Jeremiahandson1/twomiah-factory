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
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 240)) } }

const dayIn = (tz: string, d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const utcDay = () => new Date().toISOString().slice(0, 10)
const plusDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10)
}

await setupSchema()
const [co] = await db.insert(company).values({ name: 'Shear Calendar', slug: 'shear-n2', email: 'n2@test.local', settings: {}, enabledFeatures: ['appointments', 'memberships'] } as any).returning()
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
const setTz = (tz: string) => db.update(bookingSettings).set({ timezone: tz }).where(eq(bookingSettings.companyId, co.id))

let discriminated = 0

for (const tz of ['Pacific/Kiritimati', 'Pacific/Niue']) {
  await setTz(tz)
  const shopDay = dayIn(tz)
  const utc = utcDay()
  const differs = shopDay !== utc
  console.log(`\n-- ${tz}: shop ${shopDay}, utc ${utc}${differs ? '  <-- discriminating' : '  (same day right now)'}`)
  if (differs) discriminated++

  // --- enrolment start date -------------------------------------------------
  const [ct] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: `Client ${tz}`, email: `${tz.replace(/\W/g, '')}@test.local` } as any).returning()
  const enrol = await call('POST', '/api/memberships/enrollments', { planId: plan.id, contactId: ct.id })
  check(`${tz}: enrolling succeeds`, enrol.status === 201, enrol.json)
  check(`${tz}: start date is the SHOP's day`, enrol.json?.startDate === shopDay, { got: enrol.json?.startDate, shopDay, utc })
  if (differs) check(`${tz}: …which is NOT the UTC day`, enrol.json?.startDate !== utc, { got: enrol.json?.startDate, utc })

  // the first invoice's line is labelled with that same period
  const [inv] = await db.select().from(invoice).where(eq(invoice.id, enrol.json?.invoiceId || '')).limit(1)
  const lines = inv ? await db.select().from(invoiceLineItem).where(eq(invoiceLineItem.invoiceId, inv.id)) : []
  check(`${tz}: the invoice line names the shop's period`, !!lines[0]?.description?.includes(shopDay), lines[0]?.description)

  // the renewal anniversary is a month from the shop's day, not UTC's
  check(`${tz}: the renewal anniversary follows the shop's day`, enrol.json?.renewsAt?.slice(8) === shopDay.slice(8), { renewsAt: enrol.json?.renewsAt, shopDay })

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

check('at least one zone sat on a different calendar day from UTC (the test discriminates)', discriminated > 0, { discriminated })

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)

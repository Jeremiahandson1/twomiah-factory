// Salon T20 H4 — "Memberships bill nothing — no renewal date, no invoice, no billing endpoint."
// Enrolling in the $99/month Blowout Club returned 201 and set credits, but renewsAt came back null and
// no invoice was raised. /bill, /charge and /billing/run were all 404. A nine-day-old enrolment still
// had a null renewsAt, so nothing filled it in later either.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, membershipPlan, membershipEnrollment, invoice, invoiceLineItem } from './db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 240)) } }

await setupSchema()
const [co] = await db.insert(company).values({ name: 'Shear', slug: 'shear-mb', email: 'm@test.local', settings: {}, enabledFeatures: ['memberships'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'm@test.local', passwordHash: 'x', firstName: 'Mo', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
const [client] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Bea Blowout', email: 'bea@test.local' } as any).returning()
const [plan] = await db.insert(membershipPlan).values({ companyId: co.id, name: 'Blowout Club', price: '99', billingCycle: 'monthly', creditsTotal: 4, active: true } as any).returning()
const [freePlan] = await db.insert(membershipPlan).values({ companyId: co.id, name: 'Loyalty Tier', price: '0', billingCycle: 'monthly', creditsTotal: 1, active: true } as any).returning()
const [oncePlan] = await db.insert(membershipPlan).values({ companyId: co.id, name: 'Package of 5', price: '250', billingCycle: 'one_time', creditsTotal: 5, active: true } as any).returning()

const app = new Hono()
app.route('/api/memberships', (await import('./src/routes/memberships.ts')).default)
app.onError(errorHandler)
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json }
}
const iso = (d: Date) => d.toISOString().slice(0, 10)

// "Today" here has to be the SALON's day, not UTC's. faca20cf moved membership billing onto
// salonToday() (utils/salonDate.ts, T25 N2) and this suite kept building its fixtures from the UTC
// date — so for the ~5 hours each evening when Chicago and UTC disagree, the test set renewsAt to the
// salon's TOMORROW and then asserted it should have billed today. Nine assertions went red on the
// clock, not on the code, which is exactly the trap that let the real N2 bug survive a sweep.
// This company has no bookingSettings row, so salonTimezone() falls back to America/Chicago.
const SALON_TZ = 'America/Chicago'
const salonDay = (d: Date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: SALON_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
/** `n` months before the salon's today, as YYYY-MM-DD. */
const salonMonthsAgo = (n: number) => {
  const [y, m, d] = salonDay().split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 - n, d)).toISOString().slice(0, 10)
}
const invoicesFor = async (contactId: string) => db.select().from(invoice).where(and(eq(invoice.companyId, co.id), eq(invoice.contactId, contactId)))
const enrolment = async (id: string) => (await db.select().from(membershipEnrollment).where(eq(membershipEnrollment.id, id)))[0] as any

// ── enrolling bills the first period and sets the renewal ──────────────────────────────────────────
let enrolId = ''
{
  const r = await call('POST', '/api/memberships/enrollments', { planId: plan.id, contactId: client.id })
  check('enrolling works', r.status === 201, r.json)
  enrolId = r.json?.id
  check('H4: the enrolment has a renewal date (it came back null)', !!r.json?.renewsAt, r.json?.renewsAt)
  const start = r.json?.startDate || salonDay()
  const expected = new Date(`${start}T00:00:00.000Z`); expected.setUTCMonth(expected.getUTCMonth() + 1)
  check('…one month after the start, for a monthly plan', String(r.json?.renewsAt).slice(0, 10) === iso(expected), { got: r.json?.renewsAt, want: iso(expected) })
  check('H4: an invoice was raised for the first period (none ever was)', !!r.json?.invoiceId, r.json)

  const invs = await invoicesFor(client.id)
  check('…exactly one invoice exists', invs.length === 1, invs.length)
  check('…for the plan price', Number(invs[0]?.total) === 99, invs[0]?.total)
  check('…owed, not silently paid', invs[0]?.status === 'open' && Number(invs[0]?.amountPaid) === 0, { s: invs[0]?.status, p: invs[0]?.amountPaid })
  // guarded: before the fix there is no invoice at all, and this must report that rather than crash
  const lines = invs[0] ? await db.select().from(invoiceLineItem).where(eq(invoiceLineItem.invoiceId, invs[0].id)) : []
  check('…with a line naming the plan and the period', lines.length === 1 && /Blowout Club/.test(String(lines[0]?.description)) && /per month/.test(String(lines[0]?.description)), lines[0]?.description)
  check('…and the enrolment remembers which invoice it raised', !!invs[0] && (await enrolment(enrolId)).lastInvoiceId === invs[0].id, null)
  check('…credits are still set up', Number(r.json?.creditsRemaining) === 4, r.json?.creditsRemaining)
}

// ── the billing endpoint exists, and is idempotent ─────────────────────────────────────────────────
{
  const run = await call('POST', '/api/memberships/billing/run')
  check('H4: POST /memberships/billing/run exists (it was a 404)', run.status === 200, run.status)
  check('…and bills nothing when nothing is due', run.json?.billed === 0, run.json)
  check('…leaving the single invoice alone', (await invoicesFor(client.id)).length === 1, null)
}

// ── a period that has come due is billed, once ─────────────────────────────────────────────────────
{
  // Spend the credits, then wind the clock on as if a month had passed: the last period billed was a
  // month ago and today's renewal has arrived. (Setting renewsAt to today while last_billed_for is
  // ALSO today bills nothing, correctly — that is the same period, and it is already paid for.)
  const monthAgo = salonMonthsAgo(1)
  await db.update(membershipEnrollment)
    .set({ creditsRemaining: 0, lastBilledFor: monthAgo, renewsAt: salonDay() } as any)
    .where(eq(membershipEnrollment.id, enrolId))
  const run = await call('POST', '/api/memberships/billing/run')
  check('H4: a membership that has come due is billed', run.json?.billed === 1, run.json)
  const invs = await invoicesFor(client.id)
  check('…raising a second invoice', invs.length === 2, invs.length)
  const after = await enrolment(enrolId)
  check('…and rolling the renewal forward a month', after.renewsAt > salonDay(), after.renewsAt)
  check('H4: the new period refills the credits (a monthly plan that never refills is worthless after month one)', Number(after.creditsRemaining) === 4, after.creditsRemaining)

  // the claim must make a second run a no-op
  const again = await call('POST', '/api/memberships/billing/run')
  check('running billing again does not double-charge', again.json?.billed === 0, again.json)
  check('…still two invoices', (await invoicesFor(client.id)).length === 2, null)
}

// ── catching up several missed periods, one invoice each ───────────────────────────────────────────
{
  const [c2] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Cat Chup', email: 'cat@test.local' } as any).returning()
  const threeAgo = salonMonthsAgo(3)
  const r = await call('POST', '/api/memberships/enrollments', { planId: plan.id, contactId: c2.id, startDate: threeAgo })
  check('a membership backdated three months enrols', r.status === 201, r.json)
  // first period billed on enrol; the rest are caught up by the run
  const run = await call('POST', '/api/memberships/billing/run')
  const invs = await invoicesFor(c2.id)
  check('H4: the missed periods are caught up one invoice each', invs.length === 4, { billedThisRun: run.json?.billed, invoices: invs.length })
  const periods = new Set((await db.select().from(invoiceLineItem)).filter((l: any) => invs.some(i => i.id === l.invoiceId)).map((l: any) => String(l.description)))
  check('…each for its own period, not four copies of one', periods.size === 4, [...periods])
}

// ── a free plan schedules its renewal without raising an invoice ───────────────────────────────────
{
  const [c3] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Freda Free', email: 'freda@test.local' } as any).returning()
  const r = await call('POST', '/api/memberships/enrollments', { planId: freePlan.id, contactId: c3.id })
  check('a free membership enrols', r.status === 201, r.json)
  check('…raises no invoice', (await invoicesFor(c3.id)).length === 0, null)
  check('…but still gets a renewal date rather than sitting at null', !!r.json?.renewsAt, r.json?.renewsAt)
}

// ── a one-off package is charged once and never renews ─────────────────────────────────────────────
{
  const [c4] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Otto Once', email: 'otto@test.local' } as any).returning()
  const r = await call('POST', '/api/memberships/enrollments', { planId: oncePlan.id, contactId: c4.id })
  check('a one-off package enrols and is charged', (await invoicesFor(c4.id)).length === 1, null)
  check('…for its price', Number((await invoicesFor(c4.id))[0]?.total) === 250, null)
  check('…and never renews', r.json?.renewsAt == null, r.json?.renewsAt)
  await call('POST', '/api/memberships/billing/run')
  check('…so a billing run never charges it again', (await invoicesFor(c4.id)).length === 1, null)
}

// ── a cancelled membership stops being billed ──────────────────────────────────────────────────────
{
  const [c5] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Quinn Quit', email: 'quinn@test.local' } as any).returning()
  const r = await call('POST', '/api/memberships/enrollments', { planId: plan.id, contactId: c5.id })
  await db.update(membershipEnrollment).set({ status: 'cancelled', renewsAt: salonDay() } as any).where(eq(membershipEnrollment.id, r.json?.id))
  await call('POST', '/api/memberships/billing/run')
  check('a cancelled membership is not billed again', (await invoicesFor(c5.id)).length === 1, (await invoicesFor(c5.id)).length)
}

// ── looking at the page settles what is due ────────────────────────────────────────────────────────
{
  const [c6] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Reed Read', email: 'reed@test.local' } as any).returning()
  const r = await call('POST', '/api/memberships/enrollments', { planId: plan.id, contactId: c6.id })
  const monthAgo6 = salonMonthsAgo(1)
  await db.update(membershipEnrollment).set({ lastBilledFor: monthAgo6, renewsAt: salonDay() } as any).where(eq(membershipEnrollment.id, r.json?.id))
  await call('GET', '/api/memberships/enrollments')
  check('H4: opening the memberships list bills what has come due (no scheduler on a tenant)', (await invoicesFor(c6.id)).length === 2, (await invoicesFor(c6.id)).length)
}


// ── an enrolment sold before billing existed is adopted, not left invisible ────────────────────────
{
  const [c7] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Ollie Old', email: 'ollie@test.local' } as any).returning()
  const longAgo = salonMonthsAgo(4)
  // exactly the shape the report found: active, credits set, renewsAt NULL, nothing ever billed
  const [legacy] = await db.insert(membershipEnrollment).values({
    planId: plan.id, contactId: c7.id, status: 'active', creditsRemaining: 2,
    startDate: longAgo, renewsAt: null, companyId: co.id,
  } as any).returning()
  const before = (await invoicesFor(c7.id)).length

  await call('POST', '/api/memberships/billing/run')
  const after = await enrolment(legacy.id)
  check('H4: an enrolment stuck at renewsAt null is given one (it stayed null forever)', !!after.renewsAt, after.renewsAt)
  check('…dated from today, a month out', String(after.renewsAt) > salonDay(), after.renewsAt)
  check('…and adopting it raises NO surprise back-invoices for months nobody was asked to pay', (await invoicesFor(c7.id)).length === before, { before, after: (await invoicesFor(c7.id)).length })

  // and from here it bills like any other
  const monthAgo7 = salonMonthsAgo(1)
  await db.update(membershipEnrollment).set({ lastBilledFor: monthAgo7, renewsAt: salonDay() } as any).where(eq(membershipEnrollment.id, legacy.id))
  await call('POST', '/api/memberships/billing/run')
  check('…then bills normally on its next renewal', (await invoicesFor(c7.id)).length === before + 1, (await invoicesFor(c7.id)).length)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)


console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)

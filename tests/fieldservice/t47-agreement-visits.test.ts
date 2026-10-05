// crm-fieldservice — Upcoming Visits was empty, and an ended contract still showed a next visit.
//
//   "Upcoming Visits still empty; expired agreement still shows a next date"   — T42 medium
//
// TWO PARALLEL IDEAS OF A VISIT, one populated and the other displayed. The recurrence engine behind
// "Auto-schedule recurring visits" creates JOBS — generateNextJob inserts into `job` with a
// `serviceAgreementId` — while getUpcomingVisits read `agreement_visit`, a different table that only
// the manual scheduleVisit ever writes. So a shop ticks the box, the engine schedules the work, and
// the tab shows nothing. For ever. Which is why this survived three rounds of being re-reported: the
// list was not broken, it was looking somewhere nothing arrives.
//
// A visit on a maintenance contract IS a scheduled job, so the list now reads both. This file pins
// both sources, because a fix that only read jobs would have silently dropped the hand-booked ones.
//
// It also pins two things found while reading that query:
//   · it returned BARE rows, while the screen renders `visit.agreement?.contact?.name` and
//     `visit.agreement?.plan?.name` — so a hand-booked visit appeared as a blank line with a date;
//   · it had no lower bound, so a visit scheduled in 2024 counted as "upcoming".
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, agreementPlan, serviceAgreement, agreementVisit, job } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'FS Visits', slug: 'fs-visits-t47', email: 'fsv@test.local', state: 'OH', settings: {},
  enabledFeatures: ['service_agreements', 'maintenance_contracts', 'invoices', 'jobs'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-fsv@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()
const [client] = await db.insert(contact).values({
  companyId: co.id, name: 'Beechwood Flats', type: 'client', phone: '555-0147', email: 'bw-fsv@test.local',
} as any).returning()
const [plan] = await db.insert(agreementPlan).values({
  companyId: co.id, name: 'Quarterly Maintenance', price: '49.00', billingFrequency: 'monthly',
  visitsIncluded: 4, active: true,
} as any).returning()

const nextYear = new Date(); nextYear.setFullYear(nextYear.getFullYear() + 1)
const [live] = await db.insert(serviceAgreement).values({
  companyId: co.id, contactId: client.id, planId: plan.id, number: 'AGR-T47-LIVE',
  name: 'Beechwood quarterly', status: 'active', renewalType: 'manual',
  startDate: new Date('2026-01-01'), endDate: nextYear,
  billingFrequency: 'monthly', amount: '49.00',
  autoSchedule: true, nextServiceDate: new Date(Date.now() + 7 * 864e5),
  recurrenceRule: { frequency: 'quarterly' },
} as any).returning()

const app = new Hono()
app.route('/api/agreements', (await import('./src/routes/agreements.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const visits = async () => {
  const r = await api('GET', '/api/agreements/visits/upcoming')
  return { status: r.status, rows: (Array.isArray(r.json) ? r.json : (r.json?.data ?? [])) as any[], text: r.text }
}

// ══════════ a job the recurrence engine generated ═══════════════════════════════════════════════
console.log('\n══════════ what the engine schedules ══════════')
{
  /**
   * UPDATED IN T48, and worth saying why rather than just changing the number.
   *
   * This asserted the list starts EMPTY. That was the behaviour, and the owner reported it as the
   * bug: on fstest there were four agreements, three active with a nextServiceDate — and zero visit
   * rows and zero agreement-linked jobs, so both sources had nothing to find and the screen was
   * correctly, uselessly blank. A maintenance plan whose own record says the next service is due HAS
   * an upcoming visit; the absence of a booked row is the reason to show it, not to hide it.
   *
   * So the list now starts with exactly one row, from the plan itself — `live` is active with
   * nextServiceDate seven days out — and the assertion is stronger than the one it replaces: it pins
   * the source, and the next block pins that the generated job REPLACES this row rather than
   * doubling it, because the engine's job lands on the same day the plan predicted.
   */
  const before = await visits()
  check('the list starts with the PLAN\'s own due date — not empty, which was the T48 finding',
    before.status === 200 && before.rows.length === 1 && before.rows[0].source === 'plan',
    { status: before.status, n: before.rows.length, sources: before.rows.map((r: any) => r.source) })
  check('…and that row is marked due rather than scheduled, because nothing is booked yet',
    before.rows[0]?.status === 'due', { status: before.rows[0]?.status })

  // exactly what generateNextJob writes: a scheduled job carrying the agreement
  await db.insert(job).values({
    companyId: co.id, contactId: client.id, number: 'JOB-00147',
    title: 'Beechwood quarterly — Scheduled Maintenance', status: 'scheduled', jobType: 'maintenance',
    scheduledDate: new Date(Date.now() + 7 * 864e5), serviceAgreementId: live.id,
  } as any)

  const after = await visits()
  check('T42: a job the engine generated appears under Upcoming Visits — it never did before',
    after.rows.length === 1, { n: after.rows.length, rows: after.rows })
  const v = after.rows[0]
  check('…carrying the customer the screen renders', v?.agreement?.contact?.name === 'Beechwood Flats', v?.agreement?.contact)
  check('…and their phone number, which the right-hand column shows', v?.agreement?.contact?.phone === '555-0147', v?.agreement?.contact)
  check('…and the plan name beside it', v?.agreement?.plan?.name === 'Quarterly Maintenance', v?.agreement?.plan)
  check('…and says where it came from', v?.source === 'job', v?.source)
}

// ══════════ …and a visit booked by hand ═════════════════════════════════════════════════════════
console.log('\n══════════ a hand-booked visit ══════════')
{
  await db.insert(agreementVisit).values({
    agreementId: live.id, scheduledDate: new Date(Date.now() + 3 * 864e5), status: 'scheduled',
    notes: 'Customer asked for an early look',
  } as any)
  const r = await visits()
  check('both sources are listed', r.rows.length === 2, { n: r.rows.length, sources: r.rows.map((x) => x.source) })
  check('…soonest first', new Date(r.rows[0].scheduledDate).getTime() <= new Date(r.rows[1].scheduledDate).getTime(),
    r.rows.map((x) => x.scheduledDate))
  const booked = r.rows.find((x) => x.source === 'visit')
  check('T42: …and the hand-booked one is no longer a blank line — it carries its agreement',
    booked?.agreement?.contact?.name === 'Beechwood Flats' && booked?.agreement?.plan?.name === 'Quarterly Maintenance',
    booked?.agreement)
}

// ══════════ the window ══════════════════════════════════════════════════════════════════════════
console.log('\n══════════ the window has a bottom as well as a top ══════════')
{
  await db.insert(agreementVisit).values({
    agreementId: live.id, scheduledDate: new Date('2024-05-01'), status: 'scheduled',
  } as any)
  await db.insert(agreementVisit).values({
    agreementId: live.id, scheduledDate: new Date(Date.now() + 400 * 864e5), status: 'scheduled',
  } as any)
  const r = await visits()
  check('T42: a visit scheduled in 2024 is not "upcoming"',
    !r.rows.some((x) => String(x.scheduledDate).startsWith('2024')), r.rows.map((x) => x.scheduledDate))
  check('…and one a year out is beyond the 30-day window', r.rows.length === 2, { n: r.rows.length })
}

// ══════════ an ended contract has no next visit ═════════════════════════════════════════════════
console.log('\n══════════ an agreement that has ended ══════════')
{
  const yesterday = new Date(Date.now() - 864e5)
  const [done] = await db.insert(serviceAgreement).values({
    companyId: co.id, contactId: client.id, planId: plan.id, number: 'AGR-T47-ENDED',
    name: 'Beechwood (ended)', status: 'active', renewalType: 'manual',
    startDate: new Date('2025-01-01'), endDate: yesterday,
    billingFrequency: 'monthly', amount: '49.00',
    autoSchedule: true, nextServiceDate: new Date(Date.now() + 14 * 864e5),
    recurrenceRule: { frequency: 'quarterly' },
  } as any).returning()

  const list = await api('GET', '/api/agreements')
  const rows = (Array.isArray(list.json) ? list.json : (list.json?.data ?? [])) as any[]
  const endedRow = rows.find((a) => a.id === done.id)
  const liveRow = rows.find((a) => a.id === live.id)
  check('T42: an agreement whose end date has passed reports NO next service date',
    endedRow?.nextServiceDate === null, { nextServiceDate: endedRow?.nextServiceDate })
  // It was inserted as 'active' with a past end date, and comes back 'expired' — something already
  // derives expiry from the date, which is more than I assumed when writing this. The rule is pinned
  // on EITHER signal on purpose: whichever one fires first, there is no next visit on a contract that
  // has ended, and a future status change must not reopen the gap.
  check('…and the row is recognised as ended, by status or by date',
    endedRow?.status !== 'active' || new Date(endedRow?.endDate).getTime() < Date.now(),
    { status: endedRow?.status, endDate: endedRow?.endDate })
  check('…while a live agreement still reports its next visit', !!liveRow?.nextServiceDate, { nextServiceDate: liveRow?.nextServiceDate })

  const cancelled = await api('POST', `/api/agreements/${done.id}/cancel`, { reason: 'not renewing' })
  if (cancelled.status === 200 || cancelled.status === 201) {
    const after = await api('GET', `/api/agreements/${done.id}`)
    check('…and a cancelled one reports none either', after.json?.nextServiceDate === null, { nextServiceDate: after.json?.nextServiceDate })
  }

  // the stored value survives, so renewing resumes where it left off
  const [rawRow] = await db.select().from(serviceAgreement).where((await import('drizzle-orm')).eq(serviceAgreement.id, done.id))
  check('…but the stored date is untouched, so a renewal knows where the schedule was',
    !!rawRow?.nextServiceDate, { stored: rawRow?.nextServiceDate })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)

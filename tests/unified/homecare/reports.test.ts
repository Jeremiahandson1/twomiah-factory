// ADAPTED COPY of tests/homecare/reports.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except the
// 8 read(s) marked "unified:", where the rulebook's reply shapes replaced the template's. The original keeps
// running against the template; tests/unified/harness/unified-divergences.ts names the assertions this copy stands in for.
// crm-homecare — reports, dashboard, forecast and the optimizers, ported from the CVHC CRM.
//
// What these prove, against the real routes on a real SQL engine:
//   · SCHEDULED hours come off the shared schedule engine: weekly, bi-weekly on its anchor fortnight,
//     a one-time overnight shift, a cancelled occurrence gone, a suspended schedule stopped.
//   · PAYABLE (delivered) hours = payroll-reviewed minutes (verified/approved/manual_entry) + clock entries no
//     approved review covers — CVHC's rule, the same minutes counted once.
//   · The P&L numbers on this data: invoices counted WHOLE by their first day of service (never
//     prorated; services/invoiceMoney.ts), payroll ×1.0765,
//     earned revenue at each client's rate (private pay rate, or the payer's 15-minute rate × 4).
//   · Days are the AGENCY's days: a 7pm visit is on its own day, a 9:05 clock-in is on time against a
//     9:00 schedule. Every one of those reads wrong on a UTC clock — that is the point of each check.
//   · Client Hours by Week: punches pair with their visit, unscheduled punches and cancelled visits
//     show, payroll corrections show in plain words, routine bulk approvals stay hidden.
//   · Who may: every report/dashboard/forecast/optimizer door is the office's; a caregiver is refused,
//     except the geofence check the caregiver app makes at clock-in.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import {
  agencies, users, clients, schedules, scheduleExceptions, timeEntries, payrollShiftReviews,
  referralSources, referralSourceRates, careTypes, invoices, claims, expenses, performanceRatings,
  authorizations, auditLogs, certificationRecords,
} from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}
const near = (a: any, b: number, eps = 0.011) => Math.abs(Number(a) - b) < eps
const snakeKey = (k: string) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())
const templateShape = (v: any): any => Array.isArray(v) ? v.map(templateShape) : (v && typeof v === 'object') ? ((Array.isArray(v.data) && v.pagination) ? templateShape(v.data) : Object.fromEntries(Object.entries(v).flatMap(([k, x]) => { const s = templateShape(x); return snakeKey(k) === k ? [[k, s]] : [[k, s], [snakeKey(k), s]] }))) : v /* unified: templateShape reads a unified reply in the template's shape: a list reply ({ data, pagination }, RULEBOOK §3) as its rows, and every camelCase key (RULEBOOK §2) also under its snake_case name — the values are the server's, unchanged */

await setupSchema()

// ── the agency: Wisconsin, no zone set → America/Chicago (CDT, UTC-5, in September) ─────────────
const [ag] = await db.insert(agencies).values({ name: 'Northwoods Care', slug: 'northwoods', state: 'WI' } as any).returning()
const mkUser = async (role: string, tag: string, extra: Record<string, unknown> = {}) => (await db.insert(users).values({
  email: `${tag}-rpt@test.local`, passwordHash: 'x', firstName: tag, lastName: 'Test', role, ...extra,
} as any).returning())[0]
const owner = await mkUser('owner', 'Owner')
const admin = await mkUser('admin', 'Admin')
const cg1 = await mkUser('caregiver', 'Cara', { defaultPayRate: '20.00', latitude: '44.80000000', longitude: '-91.50000000' })
const cg2 = await mkUser('caregiver', 'Dana', { defaultPayRate: '18.00' })

const [ct] = await db.insert(careTypes).values({ name: 'Personal care' } as any).returning()
const [rs] = await db.insert(referralSources).values({ name: 'County Waiver', payerType: 'medicaid', expectedPayDays: 30 } as any).returning()
await db.insert(referralSourceRates).values({ referralSourceId: rs.id, careTypeId: ct.id, rateAmount: '6.25', rateType: '15min', effectiveDate: '2026-01-01' } as any)

const mkClient = async (first: string, extra: Record<string, unknown>) => (await db.insert(clients).values({ firstName: first, lastName: 'Client', ...extra } as any).returning())[0]
const A = await mkClient('Avery', { isPrivatePay: true, privatePayRate: '30.00', latitude: '44.80000000', longitude: '-91.50000000', ssnEncrypted: 'SECRET-SSN', portalToken: 'SECRET-PORTAL' })
const B = await mkClient('Blake', { isPrivatePay: false, referredById: rs.id, careTypeId: ct.id })

// Schedule times are wall-clock values in a timestamp column; only ::time is read.
const wc = (hm: string) => new Date(`2026-09-01T${hm}:00Z`)
const mkSched = async (v: Record<string, unknown>) => (await db.insert(schedules).values({ isActive: true, ...v } as any).returning())[0]
// S1 weekly Monday 09–13 (Sept 7, 14 cancelled, 21, 28) → 3 × 4h = 12h
const S1 = await mkSched({ caregiverId: cg1.id, clientId: A.id, dayOfWeek: 1, startTime: wc('09:00'), endTime: wc('13:00'), frequency: 'weekly', effectiveDate: '2026-09-01', endDate: '2026-09-30' })
// S2 bi-weekly Wednesday 08–10 anchored Sept 2 → Sept 2, 16, 30 → 3 × 2h = 6h (not 9, 23)
const S2 = await mkSched({ caregiverId: cg2.id, clientId: B.id, dayOfWeek: 3, startTime: wc('08:00'), endTime: wc('10:00'), frequency: 'biweekly', anchorDate: '2026-09-02', effectiveDate: '2026-09-01', endDate: '2026-09-30' })
// S3 one-time overnight Thursday Sept 10, 22:00 → 02:00 → 4h
const S3 = await mkSched({ caregiverId: cg1.id, clientId: B.id, date: '2026-09-10', startTime: wc('22:00'), endTime: wc('02:00'), scheduleType: 'one-time' })
// S4 weekly Friday 09–10, suspended from Sept 18 → Sept 4, 11 only → 2h
const S4 = await mkSched({ caregiverId: cg2.id, clientId: A.id, dayOfWeek: 5, startTime: wc('09:00'), endTime: wc('10:00'), frequency: 'weekly', effectiveDate: '2026-09-01', endDate: '2026-09-30', suspendedFrom: '2026-09-18' })
await db.insert(scheduleExceptions).values({ scheduleId: S1.id, exceptionDate: '2026-09-14', exceptionType: 'cancelled', cancelReason: 'client_hospital' } as any)
const SCHEDULED_SEPT = 12 + 6 + 4 + 2

// Clock entries, stored as UTC (CDT = local + 5h).
const mkTe = async (v: Record<string, unknown>) => (await db.insert(timeEntries).values({ isComplete: true, ...v } as any).returning())[0]
const te1 = await mkTe({ caregiverId: cg1.id, clientId: A.id, scheduleId: S1.id, startTime: new Date('2026-09-07T14:05:00Z'), endTime: new Date('2026-09-07T18:00:00Z'), durationMinutes: 235, billableMinutes: 235 })
const te2 = await mkTe({ caregiverId: cg2.id, clientId: B.id, scheduleId: S2.id, startTime: new Date('2026-09-02T13:00:00Z'), endTime: new Date('2026-09-02T15:00:00Z'), durationMinutes: 120, billableMinutes: 120 })
// 22:00 Thursday Sept 10 local = 03:00Z Friday Sept 11 — the local day is the 10th.
const te3 = await mkTe({ caregiverId: cg1.id, clientId: B.id, scheduleId: S3.id, startTime: new Date('2026-09-11T03:00:00Z'), endTime: new Date('2026-09-11T07:00:00Z'), durationMinutes: 240, billableMinutes: 240 })
// 20:00 Sept 30 local = 01:00Z Oct 1 — September's, not October's.
const te4 = await mkTe({ caregiverId: cg2.id, clientId: A.id, startTime: new Date('2026-10-01T01:00:00Z'), endTime: new Date('2026-10-01T02:00:00Z'), durationMinutes: 60, billableMinutes: 60 })
// Unscheduled punch Tuesday Sept 8 10–11 local, flagged for approval (saved offline).
const te5 = await mkTe({ caregiverId: cg2.id, clientId: B.id, startTime: new Date('2026-09-08T15:00:00Z'), endTime: new Date('2026-09-08T16:00:00Z'), durationMinutes: 60, billableMinutes: 60, needsApproval: true, approvalReason: 'offline_punch' })
// Monday Aug 31 09:30 local against S1's 09:00 — 30 minutes late, outside September.
await mkTe({ caregiverId: cg1.id, clientId: A.id, scheduleId: S1.id, startTime: new Date('2026-08-31T14:30:00Z'), endTime: new Date('2026-08-31T18:30:00Z'), durationMinutes: 240, billableMinutes: 240 })

// Payroll's decisions (Payroll → Shift Review).
const mkRev = (v: Record<string, unknown>) => db.insert(payrollShiftReviews).values({ payPeriodStart: '2026-09-01', payPeriodEnd: '2026-09-30', ...v } as any)
await mkRev({ caregiverId: cg2.id, clientId: B.id, scheduleId: S2.id, timeEntryId: te2.id, shiftDate: '2026-09-02', scheduledMinutes: 120, actualMinutes: 120, payableMinutes: 120, status: 'approved', resolutionNotes: 'Bulk approved at scheduled hours' })
await mkRev({ caregiverId: cg1.id, clientId: B.id, scheduleId: S3.id, timeEntryId: te3.id, shiftDate: '2026-09-10', scheduledMinutes: 240, actualMinutes: 240, payableMinutes: 225, status: 'approved', resolutionNotes: 'Client asked to end early' })
await mkRev({ caregiverId: cg2.id, clientId: A.id, scheduleId: S4.id, shiftDate: '2026-09-11', scheduledMinutes: 60, payableMinutes: 60, status: 'approved' })
await mkRev({ caregiverId: cg1.id, clientId: A.id, scheduleId: S1.id, shiftDate: '2026-09-21', scheduledMinutes: 240, payableMinutes: 240, status: 'manual_entry', resolutionNotes: 'Paper timesheet' })
// Delivered minutes, by CVHC's rule:
//   te1 235 (no review) · te2 → review 120 · te3 → review 225 · S4 Sept 11 review 60 (no clock-in)
//   · Sept 21 manual 240 · te4 60 · te5 60
const DELIVERED_MIN = 235 + 120 + 225 + 60 + 240 + 60 + 60
const CG1_MIN = 235 + 225 + 240, CG2_MIN = 120 + 60 + 60 + 60
const A_MIN = 235 + 60 + 240 + 60, B_MIN = 120 + 225 + 60
// CLOCKED (worked) minutes: the September punches at their real length — te1..te5.
const CLOCKED_MIN = 235 + 120 + 240 + 60 + 60, CG1_CLOCKED = 235 + 240

// Money.
// A RELEASED invoice (sent) with $100 recorded on the payments ledger — the shape the billing routes
// write. (This fixture used to be a draft carrying amount_paid with no payment row.)
const [inv1] = await db.insert(invoices).values({ invoiceNumber: 'INV-1', clientId: A.id, billingPeriodStart: '2026-09-01', billingPeriodEnd: '2026-09-14', subtotal: '280', total: '280', amountPaid: '100', paymentStatus: 'partial', sentAt: new Date('2026-09-15T15:00:00Z') } as any).returning()
await db.execute(sql`INSERT INTO invoice_payments (id, invoice_id, amount, payment_method, payment_date) VALUES ('pay-inv1', ${inv1.id}, 100, 'check', '2026-09-20')`)
// A DRAFT nobody has sent: never billed, never owed, in any report.
await db.insert(invoices).values({ invoiceNumber: 'INV-DRAFT', clientId: A.id, billingPeriodStart: '2026-09-15', billingPeriodEnd: '2026-09-28', subtotal: '500', total: '500', paymentStatus: 'pending' } as any)
await db.insert(claims).values({ clientId: B.id, payerId: rs.id, serviceDate: '2026-09-02', billedAmount: '50.00', paidAmount: '0', status: 'submitted' } as any)
await db.insert(claims).values({ clientId: B.id, payerId: rs.id, serviceDate: '2026-09-03', billedAmount: '999.00', status: 'voided' } as any)
await db.insert(expenses).values({ userId: owner.id, category: 'supplies', description: 'Gloves', amount: '25.00', date: '2026-09-05' } as any)
// Ratings at the edges of the month: 23:30 Sept 30 local (04:30Z Oct 1) and 00:30 Sept 1 local (05:30Z).
await db.insert(performanceRatings).values({ caregiverId: cg1.id, clientId: A.id, satisfactionScore: 5, comments: 'Always on time', createdAt: new Date('2026-10-01T04:30:00Z') } as any)
await db.insert(performanceRatings).values({ caregiverId: cg2.id, clientId: B.id, satisfactionScore: 3, comments: 'fine', createdAt: new Date('2026-09-01T05:30:00Z') } as any)

const app = new Hono()
for (const [mount, file] of [
  ['/api/reports', 'reports'], ['/api/dashboard', 'dashboard'], ['/api/forecast', 'forecast'],
  ['/api/route-optimizer', 'optimizer'], ['/api/optimizer', 'scheduleOptimizer'],
  ['/api/roster-optimizer', 'rosterOptimizer'], ['/api/company', 'company'], ['/api/no-show', 'noShow'],
] as const) app.route(mount, (await import(`./src/routes/${file}.ts`)).default)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-agency': ag.id, 'x-test-role': who.role },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const type = res.headers.get('content-type') || ''
  if (/pdf/.test(type)) return { status: res.status, type, json: null as any, text: new TextDecoder().decode((await res.arrayBuffer()).slice(0, 8)) }
  const t = await res.text(); let j: any = t; try { j = templateShape(JSON.parse(t)) } catch {} /* unified: each reply read through templateShape */
  return { status: res.status, type, json: j, text: t }
}
const office = as(admin)
const SEPT = { startDate: '2026-09-01', endDate: '2026-09-30' }

// ── the zone ──────────────────────────────────────────────────────────────────────────────────────
{
  const { resolveTimezone, isValidTimezone } = await import('../../server/crm/homecare/core/agencyTime.ts') /* unified: the agency clock is the foundation's (server/crm/homecare/core/agencyTime.ts; the sandbox sits in apps/unified/.suite) */
  check('a WI agency with no zone set runs on America/Chicago', resolveTimezone({ state: 'WI' }) === 'America/Chicago')
  check('an OH agency runs on America/New_York', resolveTimezone({ state: 'OH' }) === 'America/New_York')
  check('the agency\'s own setting wins over its state', resolveTimezone({ state: 'WI', timezone: 'America/Denver' }) === 'America/Denver')
  check('a garbage zone is not a zone', !isValidTimezone('Mars/Olympus') && isValidTimezone('America/Phoenix'))
  const bad = await office('PUT', '/api/company', { timezone: 'Mars/Olympus' })
  check('the office cannot save a zone Postgres would refuse', bad.status === 400, bad)
}

// ── the engine ────────────────────────────────────────────────────────────────────────────────────
{
  const { occurrencesCte } = await import('../../server/data/homecareCore.ts') /* unified: the schedule engine is SQL in server/data/homecareCore.ts */
  const occ = ((await db.execute(sql`WITH ${occurrencesCte(ag.id, '2026-09-01', '2026-09-30')} /* unified: the engine reads one company's schedules: it takes the company's id first */
    SELECT schedule_id, to_char(occ_date, 'YYYY-MM-DD') AS d, minutes FROM occ ORDER BY occ_date`)) as any).rows
  const days = (id: string) => occ.filter((o: any) => o.schedule_id === id).map((o: any) => o.d)
  check('weekly: every Monday except the cancelled one', JSON.stringify(days(S1.id)) === JSON.stringify(['2026-09-07', '2026-09-21', '2026-09-28']), days(S1.id))
  check('bi-weekly: only the anchor fortnight\'s Wednesdays', JSON.stringify(days(S2.id)) === JSON.stringify(['2026-09-02', '2026-09-16', '2026-09-30']), days(S2.id))
  check('one-time: its date, and an overnight 22:00→02:00 is 240 minutes', JSON.stringify(days(S3.id)) === '["2026-09-10"]' && occ.find((o: any) => o.schedule_id === S3.id)?.minutes === 240)
  check('suspended: stops on suspended_from', JSON.stringify(days(S4.id)) === JSON.stringify(['2026-09-04', '2026-09-11']), days(S4.id))
}

// ── overview ──────────────────────────────────────────────────────────────────────────────────────
{
  const r = await office('POST', '/api/reports/overview', SEPT)
  const s = r.json?.summary || {}
  check('overview answers', r.status === 200, r)
  check(`scheduled hours = ${SCHEDULED_SEPT} (engine occurrences)`, near(s.totalHours, SCHEDULED_SEPT), s)
  check('scheduled visits = 9', s.totalShifts === 9, s)
  check(`payable hours = delivered ${DELIVERED_MIN} min (reviews + unreviewed punches, each once)`, near(s.payableHours, DELIVERED_MIN / 60), s)
  check(`worked hours = the CLOCKED ${CLOCKED_MIN} min, not the payable`, near(s.workedHours, CLOCKED_MIN / 60), s)
  check('delivered vs scheduled % is CVHC\'s rounding', s.deliveredPct === Math.round((DELIVERED_MIN / 60 / SCHEDULED_SEPT) * 100), s)
  check('revenue billed = invoices + non-voided claims (280 + 50)', near(s.totalRevenue, 330), s)
  check('satisfaction counts both ratings on the agency\'s calendar (5 and 3)', near(s.avgSatisfaction, 4), s)
  const top = (r.json?.topCaregivers || []).find((x: any) => x.id === cg1.id)
  check('top caregivers show labour COST (scheduled 16h × $20)', near(top?.est_labor_cost, 320), top)
  const f = await office('POST', '/api/reports/overview', { ...SEPT, caregiverId: cg1.id })
  check('the caregiver filter narrows scheduled hours to that caregiver (12 + 4)', near(f.json?.summary?.totalHours, 16), f.json?.summary)
  check('…and worked (clocked) and payable hours too', near(f.json?.summary?.workedHours, CG1_CLOCKED / 60) && near(f.json?.summary?.payableHours, CG1_MIN / 60), f.json?.summary)
  const bad = await office('POST', '/api/reports/overview', { startDate: 'yesterday', endDate: '2026-09-30' })
  check('a malformed date is refused, not a 500', bad.status === 400, bad)
}

// ── hours / performance / satisfaction ───────────────────────────────────────────────────────────
{
  const h = await office('POST', '/api/reports/hours', SEPT)
  const row = (h.json?.caregiverBreakdown || []).find((x: any) => x.id === cg1.id)
  check('hours: caregiver scheduled 16h, worked = clocked, payable = delivered', near(row?.total_hours, 16) && near(row?.worked_hours, CG1_CLOCKED / 60) && near(row?.payable_hours, CG1_MIN / 60), row)
  check('hours: total across service types = scheduled', near(h.json?.totalHours, SCHEDULED_SEPT), h.json?.totalHours)

  const p = await office('POST', '/api/reports/performance', SEPT)
  const pc1 = (p.json?.punctuality || []).find((x: any) => x.id === cg1.id)
  check('a 9:05 clock-in against a 9:00 visit is on time on the agency clock (2 of 2)', pc1?.total_shifts === 2 && pc1?.on_time_count === 2, pc1)
  const pc2 = (p.json?.punctuality || []).find((x: any) => x.id === cg2.id)
  check('an unscheduled punch is not counted on time', pc2?.total_shifts === 3 && pc2?.on_time_count === 1, pc2)

  const sat = await office('POST', '/api/reports/satisfaction', SEPT)
  check('satisfaction: 2 ratings, 50% positive, 50% neutral', sat.json?.satisfaction?.total_ratings === 2
    && String(sat.json?.satisfaction?.positive_percentage) === '50.0' && String(sat.json?.satisfaction?.neutral_percentage) === '50.0', sat.json?.satisfaction)
  check('satisfaction trend groups by week without a GROUP BY parameter error', Array.isArray(sat.json?.satisfaction?.trend) && sat.json.satisfaction.trend.length >= 1, sat.json?.satisfaction?.trend)
}

// ── revenue + AR ──────────────────────────────────────────────────────────────────────────────────
{
  const r = await office('POST', '/api/reports/revenue', SEPT)
  const rv = r.json?.revenue || {}
  check('revenue: billed 330, collected 100, outstanding 230 (180 invoice + 50 claim)', near(rv.total, 330) && near(rv.collected, 100) && near(rv.outstanding, 230), rv)
  check('revenue: 1 invoice + 1 claim (the voided claim is out)', rv.invoiceCount === 2, rv)
  check('revenue per scheduled hour = 330 / 24', String(rv.avgPerScheduledHour) === (330 / 24).toFixed(2), rv)
  const payer = (r.json?.byPayer || []).find((x: any) => x.payer === 'County Waiver')
  check('by payer: the claim is the county\'s', near(payer?.billed, 50), r.json?.byPayer)
  check('AR total = every unpaid balance today (180 + 50)', near(r.json?.ar?.total_outstanding, 230), r.json?.ar)
}

// ── profit & loss ─────────────────────────────────────────────────────────────────────────────────
{
  const r = await office('GET', '/api/reports/pnl?startDate=2026-09-01&endDate=2026-09-30')
  const gross = CG1_MIN / 60 * 20 + CG2_MIN / 60 * 18
  const earned = A_MIN / 60 * 30 + B_MIN / 60 * 25
  check('P&L answers', r.status === 200, r)
  check(`payroll gross = delivered minutes × pay rate (${gross.toFixed(2)})`, near(r.json?.payroll?.gross, gross), r.json?.payroll)
  check('payroll total = gross × 1.0765', near(r.json?.payroll?.total, gross * 1.0765), r.json?.payroll)
  check(`earned = private-pay minutes × $30 + payer minutes × ($6.25 × 4) (${earned.toFixed(2)})`, near(r.json?.earnedRevenue, earned), r.json)
  check('nothing is unvalued — both clients have a rate', near(r.json?.delivered?.unvalued_hours, 0), r.json?.delivered)
  check('billed = whole invoice (inside the month) + claim', near(r.json?.revenue?.total_billed, 330), r.json?.revenue)
  check('net = earned − expenses − payroll incl. tax', near(r.json?.netIncome, earned - 25 - gross * 1.0765), r.json)
  check('cash net = collected − expenses − payroll incl. tax', near(r.json?.netIncomeCash, 100 - 25 - gross * 1.0765), r.json)
  const wk = await office('GET', '/api/reports/pnl?startDate=2026-09-08&endDate=2026-09-14')
  check('a week without the invoice\'s first day of service bills none of it (whole invoices, never prorated)', near(wk.json?.revenue?.total_billed, 0) && near(wk.json?.revenue?.total_collected, 0), wk.json?.revenue)
  const wk1 = await office('GET', '/api/reports/pnl?startDate=2026-09-01&endDate=2026-09-07')
  check('the week holding its first day bills the WHOLE invoice + the claim, and its $100 collected', near(wk1.json?.revenue?.total_billed, 330) && near(wk1.json?.revenue?.total_collected, 100), wk1.json?.revenue)
}

// ── drill-downs ───────────────────────────────────────────────────────────────────────────────────
{
  const hp = await office('GET', '/api/reports/hours-by-payer?startDate=2026-09-01&endDate=2026-09-30')
  const pp = (hp.json?.rows || []).find((x: any) => x.payer_name === 'Private Pay')
  check('hours by payer: the 8pm Sept 30 punch is September\'s (A: 235 + 60 min)', near(pp?.total_hours, (235 + 60) / 60) && pp?.last_visit === '2026-09-30', pp)
  const csv = await office('GET', '/api/reports/hours-by-payer?startDate=2026-09-01&endDate=2026-09-30&format=csv')
  check('…and exports a real CSV', /text\/csv/.test(csv.type) && csv.text.startsWith('Payer,Type,Clients'), csv.text.slice(0, 80))
  const miss = await office('GET', '/api/reports/hours-by-payer')
  check('a drill-down with no range is a 400', miss.status === 400)
  const util = await office('GET', '/api/reports/caregiver-utilization?startDate=2026-09-01&endDate=2026-09-30')
  check('utilization: capacity is 40h × 30/7 weeks', near((util.json?.rows || [])[0]?.capacity_hours, Math.round(40 * 30 / 7 * 10) / 10, 0.06), util.json?.rows?.[0])
  const visits = await office('GET', '/api/reports/client-visits-summary?startDate=2026-09-01&endDate=2026-09-30')
  check('client visits summary answers', visits.status === 200 && Array.isArray(visits.json?.rows), visits)
  const inc = await office('GET', '/api/reports/client-incidents?startDate=2026-09-01&endDate=2026-09-30')
  check('client incidents reads the template\'s incidents table', inc.status === 200 && Array.isArray(inc.json?.rows), inc)
  const rbm = await office('GET', '/api/reports/client-revenue-by-month?startDate=2026-09-01&endDate=2026-09-30')
  check('client revenue by month: Avery, 2026-09, $280 billed', rbm.json?.rows?.[0]?.month === '2026-09' && near(rbm.json?.rows?.[0]?.total_billed, 280), rbm.json?.rows)
  const ex = await office('POST', '/api/reports/payroll/export', { ...SEPT, format: 'csv' })
  check('payroll export is a CSV', ex.status === 200 && /text\/csv/.test(ex.type), ex.status)
  const pdf = await office('POST', '/api/reports/overview/export-pdf', SEPT)
  check('the overview PDF is a PDF', pdf.status === 200 && pdf.text.startsWith('%PDF'), pdf)
}

// ── client hours by week ──────────────────────────────────────────────────────────────────────────
{
  const r = await office('GET', '/api/reports/client-week?weekStart=2026-09-06')
  check('client week answers', r.status === 200, r)
  const ca = (r.json?.clients || []).find((x: any) => x.client_id === A.id)
  const cb = (r.json?.clients || []).find((x: any) => x.client_id === B.id)
  check('Avery: scheduled 240 + 60 min, clocked 235, one visit with no clock-in', ca?.scheduled_minutes === 300 && ca?.clocked_minutes === 235 && ca?.missing_clock_ins === 1, ca && { s: ca.scheduled_minutes, c: ca.clocked_minutes, m: ca.missing_clock_ins })
  const mon = ca?.rows?.find((x: any) => x.day === '2026-09-07')
  check('the Monday punch pairs with the Monday visit', mon?.type === 'visit' && mon?.time_entry_id === te1.id && mon?.clocked_minutes === 235, mon)
  const fri = ca?.rows?.find((x: any) => x.day === '2026-09-11')
  check('a visit paid with no clock-in says so', fri?.type === 'visit' && !fri?.clock_in && fri?.payroll?.kind === 'paid_no_clock_in' && fri?.payroll?.payable_minutes === 60, fri)
  const thu = cb?.rows?.find((x: any) => x.type === 'visit')
  check('the 10pm Thursday visit is on Thursday, paired with its punch', thu?.day === '2026-09-10' && thu?.time_entry_id === te3.id, thu)
  check('payroll\'s adjustment shows (225 paid of 240) with its note', thu?.payroll?.kind === 'adjusted' && thu?.payroll?.payable_minutes === 225 && thu?.payroll?.note === 'Client asked to end early', thu?.payroll)
  const extra = cb?.rows?.find((x: any) => x.type === 'unscheduled')
  check('an unscheduled punch shows, with its approval flag', extra?.time_entry_id === te5.id && JSON.stringify(extra?.flags) === '["offline_punch"]', extra)
  check('Blake: scheduled 240, clocked 240 + 60', cb?.scheduled_minutes === 240 && cb?.clocked_minutes === 300, cb && { s: cb.scheduled_minutes, c: cb.clocked_minutes })
  const prior = await office('GET', '/api/reports/client-week?weekStart=2026-08-30')
  const wed = (prior.json?.clients || []).find((x: any) => x.client_id === B.id)?.rows?.find((x: any) => x.day === '2026-09-02')
  check('a routine "Bulk approved" review adds no payroll note', wed?.type === 'visit' && wed?.payroll === null, wed)
  const next = await office('GET', '/api/reports/client-week?weekStart=2026-09-13')
  const cancelled = (next.json?.clients || []).find((x: any) => x.client_id === A.id)?.rows?.find((x: any) => x.type === 'cancelled')
  check('a visit cancelled with a reason shows with that reason', cancelled?.day === '2026-09-14' && cancelled?.cancel_reason === 'client_hospital', next.json?.clients)
  const notSunday = await office('GET', '/api/reports/client-week?weekStart=2026-09-07')
  check('the week must start on a Sunday', notSunday.status === 400 && /Sunday/.test(notSunday.json?.error || ''), notSunday)
  const one = await office('GET', `/api/reports/client-week?weekStart=2026-09-06&clientId=${B.id}`)
  check('the client filter returns only that client', (one.json?.clients || []).length === 1 && one.json.clients[0].client_id === B.id)
}

// ── the client comprehensive report ───────────────────────────────────────────────────────────────
{
  const r = await office('GET', `/api/reports/client/${A.id}?from=2026-09-01&to=2026-09-30`)
  check('client report answers', r.status === 200, r)
  check('…with this client\'s visits in the period (Sept 7 and the 8pm Sept 30 visit)', r.json?.visits?.length === 2, r.json?.visits?.length)
  check('…and never the SSN or the portal credential', !JSON.stringify(r.json || {}).includes('SECRET-'), Object.keys(r.json?.client || {}))
  const logged = await db.select().from(auditLogs)
  check('generating it is written to the audit log', logged.some((l: any) => l.action === 'REPORT_GENERATED_JSON' && l.recordId === A.id), logged.map((l: any) => l.action))
  const sections = await office('GET', `/api/reports/client/${A.id}?sections=visits`)
  check('a section list limits what is gathered', Array.isArray(sections.json?.visits) && sections.json?.invoices === undefined, Object.keys(sections.json || {}))
  const pdf = await office('GET', `/api/reports/client/${A.id}/pdf?from=2026-09-01&to=2026-09-30`)
  check('the client report PDF is a PDF', pdf.status === 200 && pdf.text.startsWith('%PDF'), pdf)
  const none = await office('GET', '/api/reports/client/nope')
  check('an unknown client is a 404', none.status === 404)
}

// ── today: dashboard, live board, forecast ────────────────────────────────────────────────────────
const nowLocal = ((await db.execute(sql`SELECT to_char((NOW() AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS d,
  EXTRACT(DOW FROM (NOW() AT TIME ZONE 'America/Chicago'))::int AS dow,
  EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'America/Chicago'))::int * 60 + EXTRACT(MINUTE FROM (NOW() AT TIME ZONE 'America/Chicago'))::int AS mins`)) as any).rows[0]
const plusDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
{
  // S5: cg1 → Avery on today's weekday 10:00–12:00. S6: cg2 → Casey all day today, clocked in.
  const C = await mkClient('Casey', {})
  await mkSched({ caregiverId: cg1.id, clientId: A.id, dayOfWeek: nowLocal.dow, startTime: wc('10:00'), endTime: wc('12:00'), frequency: 'weekly', effectiveDate: plusDays(nowLocal.d, -7) })
  await mkSched({ caregiverId: cg2.id, clientId: C.id, dayOfWeek: nowLocal.dow, startTime: wc('00:01'), endTime: wc('23:59'), frequency: 'weekly', effectiveDate: plusDays(nowLocal.d, -7) })
  const back = Math.max(0, Math.min(30, nowLocal.mins - 2))
  await mkTe({ caregiverId: cg2.id, clientId: C.id, startTime: new Date(Date.now() - back * 60000), isComplete: false })
  // A punch left open two days ago.
  await mkTe({ caregiverId: cg1.id, clientId: B.id, startTime: new Date(Date.now() - 2 * 86400000), isComplete: false })
  await db.insert(authorizations).values({ clientId: B.id, payerId: rs.id, authorizedUnits: '40', usedUnits: '30', unitType: '15min', startDate: '2026-01-01', endDate: '2099-12-31', status: 'active', lowUnitsAlertThreshold: '20' } as any)
  await db.insert(authorizations).values({ clientId: A.id, authorizedUnits: '10', usedUnits: '0', unitType: 'hours', startDate: '2026-01-01', endDate: plusDays(nowLocal.d, 10), status: 'active', lowUnitsAlertThreshold: '2' } as any)
  await db.insert(certificationRecords).values({ caregiverId: cg2.id, certificationType: 'CPR', expiryDate: plusDays(nowLocal.d, 20) } as any)
  await mkRev({ caregiverId: cg1.id, clientId: A.id, shiftDate: '2026-09-28', status: 'pending' })

  const s = await office('GET', '/api/dashboard/summary')
  check('dashboard summary answers in the shape the screen reads', s.status === 200 && typeof s.json?.pendingInvoices?.amount === 'number', s)
  check('today\'s shifts come off the engine (2)', s.json?.todayShifts === 2, s.json)
  check('one caregiver is clocked in now', s.json?.clockedInNow === 1, s.json)
  check('one of today\'s shifts has nobody clocked in', s.json?.remainingShifts === 1, s.json)
  check('pending invoices: one released invoice, $180 still owed (the $500 draft is not owed)', s.json?.pendingInvoices?.count === 1 && near(s.json?.pendingInvoices?.amount, 180), s.json?.pendingInvoices)
  check('…and the draft is reported apart: one, $500', s.json?.pendingInvoices?.draftCount === 1 && near(s.json?.pendingInvoices?.draftAmount, 500), s.json?.pendingInvoices)

  const ai = await office('GET', '/api/dashboard/action-items')
  const item = (k: string) => (ai.json?.items || []).find((i: any) => i.key === k)?.count || 0
  check('action items: 1 time entry awaiting approval', item('shift_approvals') === 1, ai.json)
  check('action items: 1 clock-in open more than 24h', item('stuck_punches') === 1, ai.json)
  check('action items: 1 authorization running low (40 − 30 ≤ 20)', item('low_auths') === 1, ai.json)
  check('action items: 1 authorization ending within 14 days', item('expiring_auths') === 1, ai.json)
  check('action items: 1 certification expiring within 30 days', item('expiring_certs') === 1, ai.json)
  check('action items: 1 payroll review pending', item('payroll_reviews') === 1, ai.json)
  check('action items: the total is the sum', ai.json?.totalCount === 6, ai.json?.totalCount)

  const lb = await office('GET', '/api/dashboard/live-board')
  const s5 = (lb.json?.shifts || []).find((x: any) => x.caregiver_id === cg1.id)
  const s6 = (lb.json?.shifts || []).find((x: any) => x.caregiver_id === cg2.id)
  const expect5 = nowLocal.mins >= 10 * 60 + 15 ? 'late' : nowLocal.mins >= 10 * 60 ? 'starting' : 'upcoming'
  check(`live board: the 10:00 visit reads "${expect5}" on the agency clock at ${Math.floor(nowLocal.mins / 60)}:${String(nowLocal.mins % 60).padStart(2, '0')}`, s5?.shift_status === expect5, s5)
  check('live board: the clocked-in visit reads clocked_in', s6?.shift_status === 'clocked_in' && s6?.time_entry_id, s6)
  check('live board stats agree with the cards', lb.json?.stats?.total === 2 && lb.json?.stats?.clocked_in === 1, lb.json?.stats)

  const pat = await office('GET', `/api/dashboard/caregiver-patterns/${cg1.id}?months=36`)
  const mon = (pat.json?.patterns || []).find((x: any) => x.dayOfWeek === 1)
  check('patterns: Mondays — 2 shifts, 1 late by 30 min, 50% reliable', mon?.totalShifts === 2 && mon?.lateArrivals === 1 && mon?.avgMinutesLate === 30 && mon?.reliabilityPct === 50, mon)

  const f = await office('GET', '/api/forecast/revenue?months=3')
  check('forecast answers', f.status === 200, f)
  const fa = (f.json?.projected || []).find((x: any) => x.client_id === A.id)
  const fb = (f.json?.projected || []).find((x: any) => x.client_id === B.id)
  check('forecast: Blake authorized 40 × 15 min = 10 h/wk, none scheduled, $25/h → $250 unused', near(fb?.authorized_hours, 10) && near(fb?.used_hours, 0) && near(fb?.projected_remaining_revenue, 250), fb)
  check('forecast: Avery 10 h/wk, 2 scheduled, $30/h → $240 unused', near(fa?.authorized_hours, 10) && near(fa?.used_hours, 2) && near(fa?.projected_remaining_revenue, 240), fa)
  check('forecast KPI tiles derive from those rows (20h, 10%, $490)', near(f.json?.authSummary?.total_auth_hours, 20) && f.json?.authSummary?.avg_utilization_pct === 10 && near(f.json?.authSummary?.total_projected_remaining, 490), f.json?.authSummary)
  const wkHours = (f.json?.weekly || []).reduce((t: number, w: any) => t + Number(w.scheduled_hours), 0)
  check('forecast: 4 weeks ahead = 4 × (2h + 23h58m)', near(wkHours, 4 * (2 + 23 + 58 / 60), 0.05), f.json?.weekly)
  const u = await office('GET', '/api/forecast/caregiver-utilization')
  const u1 = (u.json || []).find((x: any) => x.id === cg1.id)
  check('caregiver utilization: Cara 2h this week at Avery\'s $30 = $60', near(u1?.weekly_hours, 2) && near(u1?.weekly_revenue, 60), u1)
}

// ── route optimizer ───────────────────────────────────────────────────────────────────────────────
{
  const X = await mkClient('Xavi', { latitude: '44.80000000', longitude: '-91.30000000' })
  const Y = await mkClient('Yuri', { latitude: '44.80000000', longitude: '-91.48000000' })
  const Z = await mkClient('Zane', { latitude: '44.80000000', longitude: '-91.40000000' })
  const r = await office('POST', '/api/route-optimizer/optimize', {
    caregiverId: cg1.id, date: '2026-09-15', startTime: '08:00',
    stops: [X, Y, Z].map((c) => ({ clientId: c.id, serviceUnits: 4 })),
  })
  check('optimize answers without Google (haversine)', r.status === 200 && r.json?.summary?.routingSource === 'haversine_estimate', r)
  check('nearest-first order from home: Yuri, Zane, Xavi', JSON.stringify((r.json?.stops || []).map((s: any) => s.clientId)) === JSON.stringify([Y.id, Z.id, X.id]), r.json?.stops?.map((s: any) => s.clientName))
  check('the reorder saves miles over the given order', r.json?.summary?.milesSaved > 5, r.json?.summary)
  const first = r.json?.stops?.[0]
  const driveMin = Math.round(first?.milesFromPrevious * 2)
  check('first arrival = 8:00 + drive minutes at ~30 mph', first?.calculatedArrival === `08:${String(driveMin).padStart(2, '0')}`, first)
  check('mileage reimbursement = miles × $0.67', near(r.json?.summary?.mileageReimbursement, r.json?.summary?.totalMiles * 0.67), r.json?.summary)

  const save = await office('POST', '/api/route-optimizer/save-route', { caregiverId: cg1.id, date: '2026-09-15', stops: r.json.stops, totalMiles: r.json.summary.totalMiles, totalDriveMinutes: r.json.summary.totalDriveMinutes, totalServiceMinutes: 180 })
  check('a route saves', save.status === 201 && save.json?.id, save)
  const again = await office('POST', '/api/route-optimizer/save-route', { caregiverId: cg1.id, date: '2026-09-15', stops: r.json.stops, totalMiles: r.json.summary.totalMiles, status: 'published' })
  const list = await office('GET', `/api/route-optimizer/saved-routes?caregiverId=${cg1.id}`)
  check('re-saving the same caregiver + day replaces the plan', list.json?.length === 1 && list.json?.[0]?.status === 'published' && list.json?.[0]?.route_date === '2026-09-15' /* unified: saved routes are a list reply ({ data, pagination }): templateShape reads its rows, so the count is their length */, list.json)
  const full = await office('GET', `/api/route-optimizer/plans/${again.json?.id}/full`)
  check('a saved plan loads back with HH:MM stop times', full.json?.stops?.[0]?.arrival_time === first?.calculatedArrival && full.json?.stops?.length === 3, full.json?.stops?.[0])

  const daily = await office('GET', '/api/route-optimizer/daily/2026-09-07')
  const route = (daily.json?.routes || []).find((x: any) => x.caregiverId === cg1.id)
  check('daily routes come off the engine (Monday Sept 7: Avery 09:00, 16 units)', route?.visits?.length === 1 && route.visits[0].startTime === '09:00:00' && route.visits[0].serviceUnits === 16, route)
  const ls = await office('GET', `/api/route-optimizer/load-schedule/${cg1.id}/2026-09-14`)
  check('load-schedule skips the cancelled Monday', ls.status === 200 && ls.json?.stops?.length === 0, ls.json)
  const hs = await office('GET', '/api/route-optimizer/hours-summary?startDate=2026-09-06&endDate=2026-09-12')
  const h1 = (hs.json?.caregivers || []).find((x: any) => x.id === cg1.id)
  check('hours summary counts recurring AND one-time visits that week (4h + 4h, 32 units)', near(h1?.scheduledHours, 8) && h1?.scheduledUnits === 32 && h1?.scheduledVisits === 2, h1)

  const geo = await office('POST', '/api/route-optimizer/geofence', { clientId: A.id, radiusFeet: 500 })
  check('the office sets a geofence', geo.status === 200 && geo.json?.radius_feet === 500, geo)
  const inside = await as(cg1)('POST', '/api/route-optimizer/geofence/check', { clientId: A.id, latitude: 44.8001, longitude: -91.5 })
  check('a caregiver at the door is inside the 500 ft geofence', inside.status === 200 && inside.json?.withinGeofence === true, inside)
  const away = await as(cg1)('POST', '/api/route-optimizer/geofence/check', { clientId: A.id, latitude: 44.81, longitude: -91.5 })
  check('…and a caregiver 0.7 mi away is not', away.json?.withinGeofence === false && away.json?.distanceFeet > 3000, away.json)
  const cfg = await office('GET', '/api/route-optimizer/config-status')
  check('config status says Google is not configured', cfg.json?.googleApiKeyConfigured === false, cfg.json)
}

// ── the optimizers write schedules the engine can read ────────────────────────────────────────────
{
  const ap = await office('POST', '/api/optimizer/apply', { proposals: [{ caregiverId: cg2.id, clientId: A.id, dayOfWeek: 2, startTime: '13:00', endTime: '15:30' }] })
  check('schedule optimizer apply creates the schedule (a bare "13:00" in a timestamp column used to fail)', ap.status === 200 && ap.json?.created === 1 && ap.json?.errors === 0, ap.json)
  const rp = await office('POST', '/api/roster-optimizer/apply', { proposals: [{ caregiverId: cg2.id, clientId: B.id, dayOfWeek: 4, startTime: '22:00', endTime: '06:00' }, { caregiverId: cg2.id, clientId: B.id, dayOfWeek: 4, startTime: 'noon', endTime: '13:00' }] })
  check('roster optimizer apply creates the good proposal and reports the bad one', rp.json?.created === 1 && rp.json?.errors === 1, rp.json)
  const created = ((await db.execute(sql`SELECT to_char(start_time, 'HH24:MI') AS s, to_char(end_time, 'HH24:MI') AS e FROM schedules WHERE notes LIKE 'Created by % Optimizer' ORDER BY s`)) as any).rows
  check('…with the wall-clock times the optimizer proposed', JSON.stringify(created) === JSON.stringify([{ s: '13:00', e: '15:30' }, { s: '22:00', e: '06:00' }]), created)
  // Caregiver preferred days (session-only): the visit lands on the day the caregiver prefers, not the
  // optimizer's default Monday-first order. A weekend day (never Monday, which the default picks
  // anyway), and not today's weekday, where Dana is booked all day.
  const pref = [6, 0, 5].find((d) => d !== nowLocal.dow)!
  const C2 = await mkClient('Devon', {})
  for (const [path, cgKey, hoursKey] of [['/api/roster-optimizer/run', 'targetHours', 'targetHours'], ['/api/optimizer/run', 'allocatedHours', 'allocatedHours']] as const) {
    const run = await office('POST', path, {
      caregivers: [{ id: cg2.id, [cgKey]: 40, preferredDays: [pref] }],
      clients: [{ id: C2.id, hoursPerWeek: 2, visitsPerWeek: 1 }],
    })
    const p = (run.json?.proposals || [])[0]
    check(`${path}: a caregiver's preferred day is the day the visit is proposed (${pref})`, run.status === 200 && p?.dayOfWeek === pref, { status: run.status, p, err: run.json?.error })
    void hoursKey
  }
  const { shiftSpan } = await import('../../server/crm/homecare/planning/rosterOptimizer.ts') /* unified: the roster optimizer is server/crm/homecare/planning/rosterOptimizer.ts */
  check('an overnight 22:00 → 06:00 shift is 8 hours, not −16', shiftSpan('22:00', '06:00') === 8)
  const roster = await office('GET', '/api/roster-optimizer/roster')
  const r2 = (roster.json?.caregivers || []).find((x: any) => x.id === cg2.id)
  check('roster counts the overnight pattern as 8 hours in the caregiver\'s week', r2 && Number(r2.current_weekly_hours) >= 8, r2)
}

// ── the agency's zone is the office's to set, and the reports follow it ────────────────────────────
{
  const before = await office('GET', '/api/company')
  check('the company record names the zone reports count on (derived from WI)', before.json?.effectiveTimezone === 'America/Chicago' && !before.json?.timezone, before.json?.effectiveTimezone)
  const set = await office('PUT', '/api/company', { timezone: 'America/Los_Angeles' })
  const after = await office('GET', '/api/company')
  check('the office sets its own zone', set.status === 200 && after.json?.effectiveTimezone === 'America/Los_Angeles', after.json?.effectiveTimezone)
  // 06:30Z Oct 1 is 01:30 Oct 1 in Chicago but 23:30 Sept 30 in Los Angeles.
  await mkTe({ caregiverId: cg2.id, clientId: B.id, startTime: new Date('2026-10-01T06:30:00Z'), endTime: new Date('2026-10-01T07:00:00Z'), durationMinutes: 30, billableMinutes: 30 })
  const la = await office('GET', '/api/reports/client-visits-summary?startDate=2026-09-30&endDate=2026-09-30')
  check('a late-night punch now lands on the Los Angeles day', (la.json?.rows || []).some((r: any) => r.client_id === B.id && r.last_visit === '2026-09-30'), la.json?.rows)
  await office('PUT', '/api/company', { timezone: '' })
  const back = await office('GET', '/api/company')
  check('clearing it falls back to the state zone', back.json?.effectiveTimezone === 'America/Chicago' && !back.json?.timezone, back.json)
}

// ── the no-show banner reads the shape the endpoint now sends ─────────────────────────────────────
{
  await db.execute(sql`INSERT INTO noshow_alerts (id, caregiver_id, client_id, shift_date, expected_start, status)
    VALUES ('ns1', ${cg1.id}, ${A.id}, (NOW() AT TIME ZONE 'America/Chicago')::date, '09:00', 'open'),
           ('ns2', ${cg1.id}, ${A.id}, '2026-09-07', '09:00', 'resolved')`)
  const ns = await office('GET', '/api/no-show/stats')
  check('no-show stats: 1 open (today), 1 resolved', ns.json?.open_count === 1 && ns.json?.today_count === 1 && ns.json?.resolved_count === 1, ns.json)
}

// ── who may ───────────────────────────────────────────────────────────────────────────────────────
{
  const cg = as(cg1)
  const OFFICE: Array<[string, string, unknown?]> = [
    ['POST', '/api/reports/overview', SEPT], ['POST', '/api/reports/revenue', SEPT],
    ['GET', '/api/reports/pnl'], ['GET', '/api/reports/client-week?weekStart=2026-09-06'],
    ['GET', `/api/reports/client/${A.id}`], ['POST', '/api/reports/payroll/export', SEPT],
    ['GET', '/api/reports/hours-by-payer?startDate=2026-09-01&endDate=2026-09-30'],
    ['GET', '/api/dashboard/summary'], ['GET', '/api/dashboard/live-board'], ['GET', '/api/dashboard/action-items'],
    ['GET', `/api/dashboard/caregiver-patterns/${cg2.id}`],
    ['GET', '/api/forecast/revenue'], ['POST', '/api/route-optimizer/optimize', {}],
    ['POST', '/api/route-optimizer/save-route', {}], ['GET', '/api/route-optimizer/saved-routes'],
    ['POST', '/api/route-optimizer/geocode', { address: '1 Main St' }], ['POST', '/api/route-optimizer/geofence', { clientId: A.id }],
    ['GET', '/api/route-optimizer/daily/2026-09-07'],
  ]
  for (const [m, p, b] of OFFICE) {
    const r = await cg(m, p, b)
    check(`a caregiver is refused: ${m} ${p.split('?')[0]}`, r.status === 403 && r.json?.error === 'Permission denied' /* unified: the office's doors are permissions (requirePermission: care-billing, care-payroll, care-hr, care-schedule:update …), whose refusal is 'Permission denied' */, { status: r.status, error: r.json?.error })
  }
  const o = await as(owner)('GET', '/api/reports/client-week?weekStart=2026-09-06')
  check('an owner reaches Client Hours by Week', o.status === 200)
}

console.log(`\nhomecare-reports: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)

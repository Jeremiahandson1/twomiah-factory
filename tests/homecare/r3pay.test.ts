// crm-homecare — E2E Run 3 (Oct 16 2026): payroll, shift reviews and approvals, visit documentation,
// worked vs payable hours, punctuality, the live board and dashboard, Client Hours by Week.
//
// What these pin, through the real routes on PGlite with the real schema:
//   · Payroll pays approved shift reviews by SHIFT DATE (services/payrollPay.ts) — one rule for
//     Calculate, the approval record, the payroll CSV, the QuickBooks CSV and the Gusto CSV.
//     Overtime is over 40 in each Sunday–Saturday week: 2 × 45h = 80 regular + 10 OT, never
//     40 + 50. Money in cents: 80 × $20 + 10 × $30 = $1,900.00.
//   · Generate Shifts again keeps the office's approvals, and overlapping periods never duplicate a shift.
//   · Worked = clocked time; payable is its own number. On time = within the 7-minute grace either
//     side — a 6:30 clock-in for a 9:30 visit is EARLY, not on time.
//   · Bulk fill carries the caregiver's recorded task statuses (a refusal stays a refusal).
//   · A caregiver's note written while clocked in is the visit's note in Visit Documentation.
//   · Shift Approvals saves the note typed beside Approve. Shifts Remaining excludes finished visits.
import { Hono } from 'hono'
import { sql, eq } from 'drizzle-orm'
import { readFileSync, readdirSync } from 'node:fs'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { agencies, users, clients, schedules, timeEntries, payrollShiftReviews, clientTaskTemplates, shiftTaskCompletions, payrollRecords } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 500)) }
}
const near = (a: any, b: number, eps = 0.006) => Math.abs(Number(a) - b) < eps
const q = async (s: any) => { const r: any = await db.execute(s); return (r?.rows ?? r) as any[] }

delete process.env.AGENCY_TIMEZONE
await setupSchema()
const ROOT = (process.env.FACTORY_ROOT || '') + 'templates/crm-homecare/'
const src = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')

// Wisconsin, no zone set → America/Chicago (CDT = UTC-5 in September).
const [ag] = await db.insert(agencies).values({ name: 'Run Three Care', slug: 'runthree', state: 'WI' } as any).returning()
const mkUser = async (role: string, first: string, extra: Record<string, unknown> = {}) => (await db.insert(users).values({
  email: `${first.toLowerCase()}-r3@test.local`, passwordHash: 'x', firstName: first, lastName: 'Payroll', role, ...extra,
} as any).returning())[0]
const admin = await mkUser('admin', 'Adele')
const cgA = await mkUser('caregiver', 'Ann', { defaultPayRate: '20.00' })
const cgB = await mkUser('caregiver', 'Bea', { defaultPayRate: '18.00' })
const cgC = await mkUser('caregiver', 'Cy')
const cgD = await mkUser('caregiver', 'Dot')
const cgE = await mkUser('caregiver', 'Eve')
const mkClient = async (first: string, last = 'Example') => (await db.insert(clients).values({ firstName: first, lastName: last } as any).returning())[0]
const P = await mkClient('Pat'), M = await mkClient('Max'), V = await mkClient('Vera')

const wc = (hm: string) => new Date(`2026-09-01T${hm}:00Z`) // wall clock in a timestamp column
const mkSched = async (v: Record<string, unknown>) => (await db.insert(schedules).values({ isActive: true, ...v } as any).returning())[0]
const mkTe = async (v: Record<string, unknown>) => (await db.insert(timeEntries).values({ isComplete: true, ...v } as any).returning())[0]

const app = new Hono()
for (const [mount, file] of [
  ['/api/payroll-shift-reviews', 'payrollShiftReviews'], ['/api/payroll', 'payroll'], ['/api/gusto', 'gusto'],
  ['/api/visit-docs', 'visitDocumentation'], ['/api/clients', 'clients'], ['/api/time-entries', 'timeTracking'],
  ['/api/reports', 'reports'], ['/api/dashboard', 'dashboard'],
] as const) app.route(mount, (await import(`./src/routes/${file}.ts`)).default)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': ag.id, 'x-test-role': who.role },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const type = res.headers.get('content-type') || ''
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t, type }
}
const office = as(admin)

// ════ the rules as pure functions ═════════════════════════════════════════════════════════════════
{
  const { splitOvertime, workweekStart } = await import('./src/services/payrollPay.ts')
  const s = splitOvertime([45 * 60, 45 * 60])
  check('overtime is per week: two 45h weeks = 80 regular + 10 OT (not 40 + 50)', s.regularMinutes === 80 * 60 && s.overtimeMinutes === 10 * 60, s)
  check('the workweek starts Sunday (Wed 9/9 → Sun 9/6)', workweekStart('2026-09-09') === '2026-09-06' && workweekStart('2026-09-06') === '2026-09-06')
  const { punctualityOf, ON_TIME_GRACE_MINUTES, VARIANCE_GRACE_MINUTES } = await import('./src/helpers/punchRules.ts')
  check('on time reuses the 7-minute clock-out grace', ON_TIME_GRACE_MINUTES === 7 && ON_TIME_GRACE_MINUTES === VARIANCE_GRACE_MINUTES)
  check('punctuality: 3 hours early is EARLY (off schedule)', punctualityOf(-180) === 'early')
  check('punctuality: 8 minutes early is early, 7 is on time', punctualityOf(-8) === 'early' && punctualityOf(-7) === 'on_time')
  check('punctuality: 7 minutes late is on time, 8 is late', punctualityOf(7) === 'on_time' && punctualityOf(8) === 'late')
  check('punctuality: no visit is unscheduled', punctualityOf(null) === 'unscheduled')
}

// ════ payroll: Generate → names → approve → Calculate (weekly OT) → CSVs → approval record ════════
// Ann works Mon–Fri 08:00–17:00 (9h) for Pat, Sept 7–11 and 14–18: two 45-hour weeks.
const workDays = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']
{
  const byDow: Record<number, string> = {}
  for (const dow of [1, 2, 3, 4, 5]) byDow[dow] = (await mkSched({ caregiverId: cgA.id, clientId: P.id, dayOfWeek: dow, startTime: wc('08:00'), endTime: wc('17:00'), frequency: 'weekly', effectiveDate: '2026-09-06', endDate: '2026-09-19' })).id
  for (const d of workDays) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay()
    await mkTe({ caregiverId: cgA.id, clientId: P.id, scheduleId: byDow[dow], startTime: new Date(`${d}T13:00:00Z`), endTime: new Date(`${d}T22:00:00Z`), durationMinutes: 540, billableMinutes: 540, allottedMinutes: 540 })
  }
  const PERIOD = { startDate: '2026-09-06', endDate: '2026-09-19' }

  const gen = await office('POST', '/api/payroll-shift-reviews/generate-shifts', PERIOD)
  check('generate: 10 shifts, all matched to a punch', gen.status === 200 && gen.json?.generated === 10 && gen.json?.matched === 10, gen.json)
  const list = await office('GET', `/api/payroll-shift-reviews/shifts?startDate=${PERIOD.startDate}&endDate=${PERIOD.endDate}`)
  const first = list.json?.shifts?.[0] || {}
  check('shift reviews carry the caregiver\'s and client\'s names', first.caregiverFirstName === 'Ann' && first.caregiverLastName === 'Payroll' && first.clientFirstName === 'Pat' && first.clientLastName === 'Example', first)
  const screen = src('frontend/src/components/admin/PayrollProcessing.tsx')
  check('the Shift Reviews screen reads those names (caregiver_first_name / caregiverFirstName), not caregiver_first',
    !/\.(caregiver|client)_(first|last)\b(?!_name)/.test(screen) && /caregiver_first_name \?\? s\.caregiverFirstName/.test(screen))

  const ap = await office('POST', '/api/payroll-shift-reviews/shifts/approve-all', { ...PERIOD, mode: 'clocked' })
  check('approve clocked: 10 approved', ap.json?.approved === 10, ap.json)
  const regen = await office('POST', '/api/payroll-shift-reviews/generate-shifts', PERIOD)
  const still = await q(sql`SELECT COUNT(*)::int AS n FROM payroll_shift_reviews WHERE status = 'approved'`)
  check('Generate again keeps the 10 approvals (same visits, same punches)', regen.json?.kept === 10 && still[0].n === 10, [regen.json, still])

  const calc = await office('POST', '/api/payroll/calculate', PERIOD)
  const row = (calc.json?.payroll || []).find((r: any) => r.caregiverId === cgA.id)
  check('Calculate answers with the payroll the screen reads (data.payroll)', calc.status === 200 && Array.isArray(calc.json?.payroll) && screen.includes('(data.payroll || [])'), calc.json)
  check('Calculate: 90h = 80 regular + 10 overtime (over 40 in EACH Sun–Sat week)', row?.totalHours === 90 && row?.regularHours === 80 && row?.overtimeHours === 10, row)
  check('Calculate: OT at 1.5x — $20 base, $30 OT; 80 × 20 + 10 × 30 = $1,900.00', row?.baseRate === 20 && row?.otRate === 30 && row?.wagesPay === 1900 && row?.grossPay === 1900, row)
  check('…10 shifts paid, status draft until approved', row?.approvedShifts === 10 && row?.status === 'draft' && calc.json?.unresolvedReviews === 0, row)

  const gusto = await office('GET', `/api/gusto/export-csv?startDate=${PERIOD.startDate}&endDate=${PERIOD.endDate}`)
  const gl = gusto.text.split('\n')
  check('Gusto CSV: the same 80 regular / 10 overtime / 90 total', /text\/csv/.test(gusto.type) && gl[0] === 'First Name,Last Name,Email,Regular Hours,Overtime Hours,Total Hours' && gl[1] === '"Ann","Payroll","ann-r3@test.local",80.00,10.00,90.00', gl)
  const gp = await office('GET', `/api/gusto/preview?startDate=${PERIOD.startDate}&endDate=${PERIOD.endDate}`)
  const gr = gp.json?.preview?.find((r: any) => r.id === cgA.id)
  check('Gusto preview gross = Calculate\'s wages ($1,900.00)', gr?.gross_pay === '1900.00' && gr?.overtime_hours === '10.00', gr)

  const qb = await office('GET', `/api/payroll/export/quickbooks?startDate=${PERIOD.startDate}&endDate=${PERIOD.endDate}`)
  const ql = qb.text.split('\n')
  check('QuickBooks CSV: Regular 80h × $20 = 1600.00, Overtime 10h × $30 = 300.00', ql[1] === '"Payroll, Ann",Regular,80.00,20.00,1600.00' && ql[2] === '"Payroll, Ann",Overtime,10.00,30.00,300.00', ql)
  const ex = await office('POST', '/api/payroll/export', { ...PERIOD, format: 'csv' })
  const lines = ex.text.split('\n').slice(1)
  const total = lines.reduce((s: number, l: string) => s + Math.round(Number(l.split(',').pop()) * 100), 0) / 100
  check('payroll CSV: 10 shift lines + an overtime premium line, adding to $1,900.00', lines.length === 11 && total === 1900 && /Overtime premium/.test(lines[10]), [lines.length, total, lines[10]])

  const appr = await office('PUT', `/api/payroll/${cgA.id}/approve`, PERIOD)
  check('approving the payroll records the same numbers', appr.status === 200 && appr.json?.regularHours === '80.00' && appr.json?.overtimeHours === '10.00' && appr.json?.overtimeRate === '30.00' && appr.json?.grossPay === '1900.00', appr.json)
  check('the screen approves with PUT and the period, and processes the record by its id',
    /method: 'PUT'[\s\S]{0,200}startDate: payPeriod\.startDate/.test(screen) && screen.includes('/api/payroll/${payroll.recordId}/process'))
  const calc2 = await office('POST', '/api/payroll/calculate', PERIOD)
  const row2 = calc2.json?.payroll?.find((r: any) => r.caregiverId === cgA.id)
  check('…Calculate then shows it approved, with its record', row2?.status === 'approved' && row2?.recordId === appr.json?.id, row2)
  const proc = await office('POST', `/api/payroll/${appr.json.id}/process`)
  check('process the approved record', proc.status === 200 && proc.json?.status === 'processed', proc.json)
  const again = await office('PUT', `/api/payroll/${cgA.id}/approve`, PERIOD)
  check('a processed payroll is not re-approved (409)', again.status === 409, again.json)

  // Overlapping period: the reviews dated 9/13–9/19 are replaced, never duplicated.
  const over = await office('POST', '/api/payroll-shift-reviews/generate-shifts', { startDate: '2026-09-13', endDate: '2026-09-26' })
  const perDay = await q(sql`SELECT to_char(shift_date, 'YYYY-MM-DD') AS d, COUNT(*)::int AS n FROM payroll_shift_reviews WHERE caregiver_id = ${cgA.id} GROUP BY 1 ORDER BY 1`)
  check('an overlapping period does not duplicate a shift (one review per day)', over.status === 200 && perDay.length === 10 && perDay.every((r) => r.n === 1), perDay)
  const wide = await office('POST', '/api/payroll/calculate', { startDate: '2026-09-06', endDate: '2026-09-26' })
  check('…and Calculate over both still pays 90h, approvals kept', wide.json?.payroll?.find((r: any) => r.caregiverId === cgA.id)?.totalHours === 90, wide.json?.payroll)

  await db.insert(payrollShiftReviews).values({ payPeriodStart: '2026-09-20', payPeriodEnd: '2026-09-26', caregiverId: cgA.id, clientId: P.id, shiftDate: '2026-09-21', scheduledMinutes: 60, status: 'pending' } as any)
  const blocked = await office('PUT', `/api/payroll/${cgA.id}/approve`, { startDate: '2026-09-20', endDate: '2026-09-26' })
  check('approval is refused while a shift is unresolved, and says where to fix it', blocked.status === 400 && /1 unresolved shift must be addressed first/.test(blocked.json?.error), blocked.json)
  const bad = await office('POST', '/api/payroll/calculate', { startDate: 'Oct 2', endDate: '2026-10-16' })
  check('Calculate refuses a malformed date', bad.status === 400)
}

// ════ worked vs payable, and on time ═════════════════════════════════════════════════════════════
{
  // Bea: 9:30–11:30 visits. Sept 22: clocked in 6:30, out 6:32 (2 min; the payer bills the 120
  // scheduled). Sept 29: clocked in 9:35, worked 115 min.
  const sEarly = await mkSched({ caregiverId: cgB.id, clientId: M.id, date: '2026-09-22', startTime: wc('09:30'), endTime: wc('11:30'), scheduleType: 'one-time' })
  const sOk = await mkSched({ caregiverId: cgB.id, clientId: M.id, date: '2026-09-29', startTime: wc('09:30'), endTime: wc('11:30'), scheduleType: 'one-time' })
  await mkTe({ caregiverId: cgB.id, clientId: M.id, scheduleId: sEarly.id, startTime: new Date('2026-09-22T11:30:00Z'), endTime: new Date('2026-09-22T11:32:00Z'), durationMinutes: 2, billableMinutes: 120, allottedMinutes: 120 })
  await mkTe({ caregiverId: cgB.id, clientId: M.id, scheduleId: sOk.id, startTime: new Date('2026-09-29T14:35:00Z'), endTime: new Date('2026-09-29T16:30:00Z'), durationMinutes: 115, billableMinutes: 120, allottedMinutes: 120 })
  const R = { startDate: '2026-09-27', endDate: '2026-09-30', caregiverId: cgB.id }
  const R2 = { startDate: '2026-09-20', endDate: '2026-09-30', caregiverId: cgB.id }

  const h = await office('POST', '/api/reports/hours', R2)
  const hb = h.json?.caregiverBreakdown?.find((r: any) => r.id === cgB.id)
  check('hours: worked is the CLOCKED 117 min (1.95h), not the 4.00 payable', near(hb?.worked_hours, 1.95) && near(hb?.payable_hours, 4) && near(hb?.total_hours, 4), hb)
  const o = await office('POST', '/api/reports/overview', R2)
  check('overview: workedHours = clocked 1.95, payableHours = 4.00, labelled apart', near(o.json?.summary?.workedHours, 1.95) && near(o.json?.summary?.payableHours, 4), o.json?.summary)
  const one = await office('POST', '/api/reports/hours', { ...R2, startDate: '2026-09-22', endDate: '2026-09-22' })
  check('the 2-minute punch is 0.03h worked, 2.00h payable', near(one.json?.caregiverBreakdown?.[0]?.worked_hours, 0.03) && near(one.json?.caregiverBreakdown?.[0]?.payable_hours, 2), one.json?.caregiverBreakdown)

  const p = await office('POST', '/api/reports/performance', R2)
  const pb = p.json?.punctuality?.find((r: any) => r.id === cgB.id)
  check('performance: the 6:30 clock-in for a 9:30 visit is early — 1 of 2 on time (50%)', pb?.total_shifts === 2 && pb?.on_time_count === 1 && pb?.early_count === 1 && pb?.late_count === 0 && pb?.on_time_percentage === '50.0', pb)
  check('…the rule is published with the report (7 minutes, early is not on time)', p.json?.onTimeRule?.graceMinutes === 7 && p.json?.onTimeRule?.earlyCountsOnTime === false, p.json?.onTimeRule)
  const pr = await office('POST', '/api/reports/performance', R)
  check('…and 9:35 for a 9:30 visit is on time (within 7)', pr.json?.punctuality?.find((r: any) => r.id === cgB.id)?.on_time_count === 1)
  const perf = p.json?.caregiverPerformance?.find((r: any) => r.id === cgB.id)
  check('performance: worked 1.95 clocked, payable 4.00', near(perf?.worked_hours, 1.95) && near(perf?.payable_hours, 4), perf)

  const util = await office('GET', '/api/reports/caregiver-utilization?startDate=2026-09-20&endDate=2026-09-30')
  check('utilization rows carry one name ("Bea Payroll")', util.json?.rows?.some((r: any) => r.name === 'Bea Payroll'), util.json?.rows)
  const ui = src('frontend/src/components/admin/ReportsAnalytics.tsx')
  const utilBlock = ui.slice(ui.indexOf('const renderCaregiverUtilization'), ui.indexOf('const renderClientIncidents'))
  check('the utilization table has one Name column, no First / Last pair', utilBlock.includes('NAME_COL') && !/label: 'First'/.test(utilBlock) && !/label: 'Last'/.test(utilBlock))
}

// ════ visit documentation: bulk fill keeps the caregiver's refusal ═══════════════════════════════
{
  const [t1] = await db.insert(clientTaskTemplates).values({ clientId: V.id, taskName: 'Bathing', category: 'adl' } as any).returning()
  const [t2] = await db.insert(clientTaskTemplates).values({ clientId: V.id, taskName: 'Companionship and conversation', category: 'companion', sortOrder: 1 } as any).returning()
  const s23 = await mkSched({ caregiverId: cgC.id, clientId: V.id, date: '2026-09-23', startTime: wc('10:00'), endTime: wc('12:00'), scheduleType: 'one-time' })
  await mkSched({ caregiverId: cgC.id, clientId: V.id, date: '2026-09-24', startTime: wc('10:00'), endTime: wc('12:00'), scheduleType: 'one-time' })
  const te = await mkTe({ caregiverId: cgC.id, clientId: V.id, scheduleId: s23.id, startTime: new Date('2026-09-23T15:00:00Z'), endTime: new Date('2026-09-23T17:00:00Z'), durationMinutes: 120, billableMinutes: 120, notes: 'Quiet morning.' })
  await db.insert(shiftTaskCompletions).values({ timeEntryId: te.id, taskTemplateId: t2.id, status: 'refused', notes: 'Wanted to rest' } as any)

  const R = '?from=2026-09-23&to=2026-09-24'
  const before = await office('GET', `/api/visit-docs/clients/${V.id}${R}`)
  const v23 = before.json?.visits?.find((v: any) => v.visit_date === '2026-09-23')
  check('Visit Documentation shows the caregiver\'s record on the visit: the refusal and the clock-out note',
    v23?.punch?.tasks?.some((t: any) => t.taskId === t2.id && t.status === 'refused' && t.notes === 'Wanted to rest') && v23?.punch?.clock_out_note === 'Quiet morning.', v23?.punch)

  const bulk = await office('POST', `/api/visit-docs/clients/${V.id}/visits/bulk`, { from: '2026-09-23', to: '2026-09-24', note: 'Personal care provided.' })
  const docs = await q(sql`SELECT to_char(visit_date, 'YYYY-MM-DD') AS d, tasks FROM visit_documentation WHERE client_id = ${V.id} ORDER BY visit_date`)
  const tk = (d: string, id: string) => (docs.find((x) => x.d === d)?.tasks || []).find((t: any) => t.taskId === id)
  check('bulk fill writes both visits', bulk.json?.written === 2, bulk.json)
  check('bulk fill keeps the REFUSED task refused, with the caregiver\'s note (not ticked done)', tk('2026-09-23', t2.id)?.done === false && tk('2026-09-23', t2.id)?.status === 'refused' && tk('2026-09-23', t2.id)?.notes === 'Wanted to rest' && tk('2026-09-23', t2.id)?.recordedBy === 'caregiver', tk('2026-09-23', t2.id))
  check('…the task the caregiver left unrecorded is ticked by the office', tk('2026-09-23', t1.id)?.done === true && tk('2026-09-23', t1.id)?.recordedBy === 'office', tk('2026-09-23', t1.id))
  check('…a visit with no caregiver record gets every task ticked', tk('2026-09-24', t1.id)?.done === true && tk('2026-09-24', t2.id)?.done === true)
  const put = await office('PUT', `/api/visit-docs/clients/${V.id}/visits`, { visitDate: '2026-09-23', startTime: '10:00', caregiverId: cgC.id, note: 'Edited', tasks: [{ taskId: t1.id, taskName: 'Bathing', done: true }, { taskId: t2.id, taskName: 'Companionship and conversation', done: true }] })
  const put2 = (put.json?.tasks || []).find((t: any) => t.taskId === t2.id)
  check('an office save cannot overwrite the recorded refusal either', put.status === 200 && put2?.status === 'refused' && put2?.done === false, put.json?.tasks)
}

// ════ a note the caregiver writes while clocked in IS the visit's note ═══════════════════════════
const [{ today }] = await q(sql`SELECT to_char((NOW() AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS today`)
{
  const sNow = await mkSched({ caregiverId: cgC.id, clientId: V.id, date: today, startTime: wc('00:00'), endTime: wc('23:59'), scheduleType: 'one-time' })
  await mkSched({ caregiverId: cgE.id, clientId: V.id, date: today, startTime: wc('00:00'), endTime: wc('23:59'), scheduleType: 'one-time' })
  await mkTe({ caregiverId: cgC.id, clientId: V.id, scheduleId: sNow.id, startTime: new Date(), isComplete: false })

  const n1 = await as(cgC)('POST', `/api/clients/${V.id}/visit-notes`, { note: 'Ate a full lunch.' })
  check('a clocked-in caregiver\'s note is saved as the visit\'s note', n1.status === 201 && n1.json?.source === 'visit', n1.json)
  await as(cgC)('POST', `/api/clients/${V.id}/visit-notes`, { note: 'Walked to the mailbox.' })
  const vd = await office('GET', `/api/visit-docs/clients/${V.id}?from=${today}&to=${today}`)
  const mine = vd.json?.visits?.find((v: any) => v.caregiver_id === cgC.id)
  check('Visit Documentation shows that note on the visit (not "No note"), both notes in order', mine?.doc?.note === 'Ate a full lunch.\nWalked to the mailbox.', mine?.doc)
  const general = await q(sql`SELECT COUNT(*)::int AS n FROM client_visit_notes WHERE client_id = ${V.id}`)
  check('…and nothing went to the second store', general[0].n === 0, general)
  const off = await as(cgE)('POST', `/api/clients/${V.id}/visit-notes`, { note: 'Called to say I am running late.' })
  check('not clocked in: a general note on the client\'s card', off.status === 201 && (await q(sql`SELECT COUNT(*)::int AS n FROM client_visit_notes WHERE client_id = ${V.id}`))[0].n === 1, off.json)
  const card = await as(cgC)('GET', `/api/clients/${V.id}/visit-notes`)
  check('the client\'s Notes tab lists the visit note too', card.status === 200 && card.json.some((x: any) => x.source === 'visit' && /Ate a full lunch/.test(x.note)), card.json)
}

// ════ Shift Approvals: the note typed beside Approve is saved ═════════════════════════════════════
{
  const te = await mkTe({ caregiverId: cgB.id, clientId: M.id, startTime: new Date('2026-09-25T14:00:00Z'), endTime: new Date('2026-09-25T15:00:00Z'), durationMinutes: 60, billableMinutes: 60, needsApproval: true, approvalReason: 'unscheduled' })
  const r = await office('PATCH', `/api/time-entries/${te.id}/approve`, { notes: '  Covered for Ann, client agreed. ' })
  check('approve with a note: the note is saved with the approval', r.status === 200 && r.json?.approvalNotes === 'Covered for Ann, client agreed.' && r.json?.needsApproval === false, r.json)
  const sa = src('frontend/src/components/admin/ShiftApprovals.tsx')
  check('the Approve button sends the typed note (an inline field beside it)', /placeholder="Note \(optional\)"[\s\S]{0,600}approveAsIs\(r\)/.test(sa) && /submit\(row\.id, \{ notes: note \|\| 'Approved as clocked' \}\)/.test(sa))
}

// ════ the dashboard and the live board ═══════════════════════════════════════════════════════════
{
  const sDone = await mkSched({ caregiverId: cgD.id, clientId: M.id, date: today, startTime: wc('00:00'), endTime: wc('23:59'), scheduleType: 'one-time' })
  await mkTe({ caregiverId: cgD.id, clientId: M.id, scheduleId: sDone.id, startTime: new Date(Date.now() - 60000), endTime: new Date(), durationMinutes: 1, billableMinutes: 1 })
  // Today: Cy clocked in (Vera), Eve not started (Vera), Dot finished (Max).
  const s = await office('GET', '/api/dashboard/summary')
  check('Shifts Remaining counts only the visit nobody has started (a finished one is not remaining)', s.json?.todayShifts === 3 && s.json?.remainingShifts === 1, s.json)
  const lb = await office('GET', '/api/dashboard/live-board')
  const dot = lb.json?.shifts?.find((x: any) => x.caregiver_id === cgD.id)
  check('live board: the finished visit is completed with its clocked minutes', dot?.shift_status === 'completed' && Number(dot?.duration_minutes) === 1, dot)
  const board = src('frontend/src/components/admin/LiveBoard.tsx')
  check('the live board prints minutes, not "0.0h", for a short visit', /Clocked: \{fmtDuration\(shift\.duration_minutes\)\}/.test(board) && !/\(shift\.duration_minutes \/ 60\)\.toFixed\(1\)/.test(board))
}

// ════ Client Hours by Week opens on THIS week (agency clock) ═════════════════════════════════════
{
  const r = await office('GET', '/api/reports/client-week')
  const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  check('no weekStart → the Sunday of the agency\'s today', r.status === 200 && r.json?.weekStart === d.toISOString().slice(0, 10), r.json?.weekStart)
  const cw = src('frontend/src/components/admin/ClientWeekHours.tsx')
  check('the screen asks for the default week instead of computing "last full week"', !/Date\.now\(\) - 7 \* 86400000/.test(cw) && /useState\(''\)/.test(cw))
}

// ════ the screens: pop-ups that open, names, stray zeros ═════════════════════════════════════════
{
  const pp = src('frontend/src/components/admin/PayrollProcessing.tsx')
  const tabEnd = pp.indexOf('{/* The pop-ups sit OUTSIDE the tabs')
  const payrollTab = pp.indexOf("{activeTab === 'payroll' && (")
  check('Payroll pop-ups (Settings, Mileage, PTO, Flag, Resolve) render outside the Payroll tab',
    tabEnd > payrollTab && payrollTab > 0 && ['SETTINGS MODAL', 'MILEAGE MODAL', 'PTO MODAL', 'FLAG SHIFT MODAL', 'RESOLVE SHIFT MODAL'].every((m) => pp.indexOf(`{/* ${m} */}`) > tabEnd)
    && /\n      <\/div>\n      \)\}\n\n      \{\/\* The pop-ups sit OUTSIDE/.test(pp))
  // Every office screen (components/admin and pages/): a full-screen overlay below the sidebar's
  // z-index 1000 opens BEHIND it (the New Job Posting dialog's hidden left side).
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e: any) =>
    e.isDirectory() ? walk(d + e.name + '/') : e.name.endsWith('.tsx') ? [d + e.name] : [])
  // Every screen, the caregiver app's included: it has the same 1000 sidebar on a laptop.
  const files = [...walk(ROOT + 'frontend/src/components/'), ...walk(ROOT + 'frontend/src/pages/')]
  const under: string[] = []
  for (const f of files) {
    const s = readFileSync(f, 'utf8')
    for (const m of s.matchAll(/className=["`{][^"`]*\bfixed inset-(?:0|y-0)[^"`]*/g)) {
      const z = m[0].match(/\bz-\[?(\d+)\]?/)
      if (z && Number(z[1]) < 1000) under.push(`${f.split('/').pop()}: ${z[0]}`)
    }
    for (const m of s.matchAll(/position: 'fixed', (?:inset: 0|top: 0, left: 0, right: 0, bottom: 0)[^}]*?zIndex: (\d+)/g)) {
      if (Number(m[1]) < 1000) under.push(`${f.split('/').pop()}: zIndex ${m[1]}`)
    }
  }
  check(`no office pop-up sits under the sidebar (z-index 1000): ${files.length} screens, every full-screen overlay ≥ 1000`, under.length === 0 && files.length > 50, under)
  const vdui = src('frontend/src/components/admin/VisitDocumentation.tsx')
  check('Visit Documentation lists "Pat Example", not "Example, Pat", and says "1 visit"', !vdui.includes('{c.last_name}, {c.first_name}') && vdui.includes("plural(data.visits.length, 'visit')"))
  const hire = src('frontend/src/components/admin/ApplicationsDashboard.tsx')
  check('Convert to Caregiver: no `{n && …}` that prints a bare 0', !/\{hireModal\.years_experience &&/.test(hire) && /Number\(hireModal\.years_experience\) > 0/.test(hire))
}

console.log(`\nhomecare-r3pay: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)

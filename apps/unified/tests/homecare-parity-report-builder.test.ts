// Home care parity row 12 (docs/parity/homecare-margin-turnover.md): a report builder over the visit fields (filters, sort, group;
// saved, copied, a standard library), financial / authorization-utilisation / caregiver dashboards and custom dashboards (profit
// margin by location and by referral source among the tiles), a daily manager report, workforce analytics (workload, underused
// staff, cancellation trends), a caregiver performance report (late clock-ins/outs, visits completed / missed / cancelled, ADL and
// form completion, client ratings), and scheduled report emails that carry an encrypted-at-rest link. Behind care_report_builder.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createHomecareCore } from '../server/crm/homecare/core/index.ts'
import { applyDefinition, checkDefinition, checkTiles, passes, shapeRow, LIBRARY, FIELDS } from '../server/crm/homecare/core/reportBuilder.ts'
import { nextRunOn, cadenceText, checkSchedule } from '../server/crm/homecare/core/reportSchedules.ts'

process.env.ENCRYPTION_KEY ||= 'test-encryption-key'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let core: ReturnType<typeof createHomecareCore>
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const get = async (p: string, who = 'owner') => json(await as(who)(p))
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const ON = ['contacts', 'scheduling', 'team', 'care_margin_reports', 'care_report_builder']
const W = 'startDate=2026-10-01&endDate=2026-10-14'

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ timezone: 'UTC' } as any).where(eq(t.schema.company.id, companyId))
  tokens.owner = await login('owner@test.example', seeded.password)
  ids.owner = (await json(await as('owner')('/api/auth/me'))).body.user.id
  core = createHomecareCore({ services: t.services.crm } as any)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  for (const who of ['ann', 'bob']) {
    ids[who] = (await ins(t.schema.user, { email: `${who}@test.example`, passwordHash: hash, firstName: who[0].toUpperCase() + who.slice(1), lastName: 'Carer', role: 'caregiver', companyId, defaultPayRate: '20.00', hireDate: '2026-01-01' })).id
    tokens[who] = await login(`${who}@test.example`, 'Caregiver-pass-1')
  }
  ids.north = (await ins(t.schema.serviceLocations, { companyId, name: 'North branch' })).id
  ids.hospital = (await ins(t.schema.referralSources, { companyId, name: 'St Mary Hospital', isActive: true })).id
  ids.medicaid = (await ins(t.schema.referralSources, { companyId, name: 'County Medicaid', isActive: true, isActivePayer: true, payerType: 'medicaid' })).id
  await ins(t.schema.caregiverProfiles, { companyId, caregiverId: ids.ann, branchId: ids.north, team: 'Day team' })
  await ins(t.schema.caregiverAvailability, { companyId, caregiverId: ids.ann, hoursWanted: 30, maxHoursPerWeek: 40 })
  await ins(t.schema.caregiverAvailability, { companyId, caregiverId: ids.bob, hoursWanted: 4, maxHoursPerWeek: 10 })
  ids.alma = (await ins(t.schema.clients, { companyId, firstName: 'Alma', lastName: 'Able', isActive: true, isPrivatePay: true, privatePayRate: '40.00', privatePayRateType: 'hourly', branchId: ids.north, referredById: ids.hospital })).id
  await ins(t.schema.authorizations, { companyId, clientId: ids.alma, payerId: ids.medicaid, authNumber: 'A-1', authorizedUnits: '400', usedUnits: '350', unitType: '15min', startDate: '2026-10-01', endDate: '2026-12-31', status: 'active' })
  // Two one-off visits for Ann at Alma's: 11-03 09:00–11:00 clocked in 20 minutes late, 11-04 on time.
  const sched = async (date: string) => (await ins(t.schema.schedules, { companyId, clientId: ids.alma, caregiverId: ids.ann, startTime: new Date(`${date}T09:00:00Z`), endTime: new Date(`${date}T11:00:00Z`), scheduleType: 'one_time', date, dayOfWeek: null })).id
  ids.s3 = await sched('2026-10-03'); ids.s4 = await sched('2026-10-04'); ids.s6 = await sched('2026-10-06')
  ids.v3 = (await ins(t.schema.timeEntries, { companyId, caregiverId: ids.ann, clientId: ids.alma, scheduleId: ids.s3, startTime: new Date('2026-10-03T09:20:00Z'), endTime: new Date('2026-10-03T11:00:00Z'), isComplete: true, durationMinutes: 100, notes: 'Bath and lunch' })).id
  ids.v4 = (await ins(t.schema.timeEntries, { companyId, caregiverId: ids.ann, clientId: ids.alma, scheduleId: ids.s4, startTime: new Date('2026-10-04T09:02:00Z'), endTime: new Date('2026-10-04T11:15:00Z'), isComplete: true, durationMinutes: 133 })).id
  await ins(t.schema.payrollShiftReviews, { companyId, payPeriodStart: '2026-10-01', payPeriodEnd: '2026-10-14', caregiverId: ids.ann, clientId: ids.alma, shiftDate: '2026-10-03', timeEntryId: ids.v3, payableMinutes: 100, status: 'verified' })
  await ins(t.schema.payrollShiftReviews, { companyId, payPeriodStart: '2026-10-01', payPeriodEnd: '2026-10-14', caregiverId: ids.ann, clientId: ids.alma, shiftDate: '2026-10-04', timeEntryId: ids.v4, payableMinutes: 120, status: 'verified' })
  ids.inv = (await ins(t.schema.invoices, { companyId, invoiceNumber: 'INV-2001', clientId: ids.alma, billingPeriodStart: '2026-10-01', billingPeriodEnd: '2026-10-07', subtotal: '80.00', total: '80.00', sentAt: new Date('2026-10-08T12:00:00Z') })).id
  await ins(t.schema.invoiceLineItems, { companyId, invoiceId: ids.inv, timeEntryId: ids.v4, caregiverId: ids.ann, description: 'Care', serviceDate: '2026-10-04', hours: '2', rate: '40.00', amount: '80.00' })
  // The signature, tasks, a form and an ADL on the first visit; a rating of 4 from Alma that day.
  await ins(t.schema.visitSignature, { companyId, timeEntryId: ids.v4, clientId: ids.alma, signatureImage: 'data:image/png;base64,AAAA', signedAt: new Date('2026-10-04T11:14:00Z') })
  await ins(t.schema.visitSignature, { companyId, timeEntryId: ids.v3, clientId: ids.alma, reasonCode: 'asleep' })
  ids.task1 = (await ins(t.schema.clientTaskTemplates, { companyId, clientId: ids.alma, taskName: 'Bath', category: 'adl' })).id
  ids.task2 = (await ins(t.schema.clientTaskTemplates, { companyId, clientId: ids.alma, taskName: 'Lunch', category: 'iadl' })).id
  await ins(t.schema.shiftTaskCompletions, { companyId, timeEntryId: ids.v3, taskTemplateId: ids.task1, status: 'completed', completedAt: new Date('2026-10-03T10:00:00Z') })
  await ins(t.schema.shiftTaskCompletions, { companyId, timeEntryId: ids.v3, taskTemplateId: ids.task2, status: 'skipped', notes: 'Not hungry' })
  ids.form = (await ins(t.schema.formTemplates, { companyId, name: 'Daily check', fields: [] })).id
  ids.item = (await ins(t.schema.visitItem, { companyId, clientId: ids.alma, kind: 'form', name: 'Daily check', formTemplateId: ids.form })).id
  await ins(t.schema.visitItemLog, { companyId, timeEntryId: ids.v3, itemId: ids.item, status: 'done', completedAt: new Date('2026-10-03T10:30:00Z') })
  await ins(t.schema.visitItemLog, { companyId, timeEntryId: ids.v4, itemId: ids.item, status: 'skipped' })
  await ins(t.schema.adlLogs, { companyId, clientId: ids.alma, caregiverId: ids.ann, adlCategory: 'bathing', status: 'completed', timeEntryId: ids.v3, performedAt: new Date('2026-10-03T10:00:00Z') })
  await ins(t.schema.performanceRatings, { companyId, caregiverId: ids.ann, clientId: ids.alma, ratingDate: '2026-10-03', satisfactionScore: 4 })
  // Bob missed a visit (no-show) and called out of another; Alma cancelled one herself.
  await ins(t.schema.noshowAlerts, { companyId, caregiverId: ids.bob, clientId: ids.alma, shiftDate: '2026-10-05', expectedStart: '09:00' })
  ids.sb = (await ins(t.schema.schedules, { companyId, clientId: ids.alma, caregiverId: ids.bob, startTime: new Date('2026-10-06T13:00:00Z'), endTime: new Date('2026-10-06T15:00:00Z'), scheduleType: 'one_time', date: '2026-10-06', dayOfWeek: null })).id
  await ins(t.schema.scheduleExceptions, { companyId, scheduleId: ids.sb, exceptionDate: '2026-10-06', exceptionType: 'cancelled', cancelReason: 'caregiver_callout' })
  await ins(t.schema.scheduleExceptions, { companyId, scheduleId: ids.s6, exceptionDate: '2026-10-06', exceptionType: 'cancelled', cancelReason: 'client_hospital' })
  await setFeatures(ON)
}, 120_000)

describe('row 12 — the builder\'s rules (pure)', () => {
  const row = (over: any = {}) => shapeRow({ visitId: 'v', date: '2026-11-03', clientId: 'c', clientFirst: 'Alma', clientLast: 'Able', caregiverId: 'g', caregiverFirst: 'Ann', caregiverLast: 'Carer', minutesLateIn: 20, clockedMinutes: 100, billedAmount: '80.00', signed: false, unsignedReason: 'asleep', tasksDone: 1, tasksSkipped: 1, formsDone: 1, formsMissed: 0, adlsRecorded: 1, clientRating: '4.0', payrollStatus: 'manual_entry', approvalReason: 'variance,offline', ...over })
  test('codes become labels, money becomes cents, lateness becomes an on-time flag', () => {
    const r = row()
    expect(r).toMatchObject({ clientName: 'Alma Able', caregiverName: 'Ann Carer', billedCents: 8000, onTime: false, payrollStatus: 'Entered by hand', unsignedReason: 'Client was asleep', clientRating: 4, approvalReason: 'Clock time differs from the schedule, Punched offline' })
    expect(row({ minutesLateIn: 5 }).onTime).toBe(true)
    expect(row({ minutesLateIn: null }).onTime).toBeNull()
  })
  test('every filter rule works on the type it is for; money is typed in dollars', () => {
    const r = row() as any
    expect(passes(r, { field: 'minutesLateIn', op: 'gt', value: 7 })).toBe(true)
    expect(passes(r, { field: 'minutesLateIn', op: 'lte', value: 7 })).toBe(false)
    expect(passes(r, { field: 'clientName', op: 'contains', value: 'alma' })).toBe(true)
    expect(passes(r, { field: 'signed', op: 'is', value: false })).toBe(true)
    expect(passes(r, { field: 'signed', op: 'is', value: 'true' })).toBe(false)
    expect(passes(r, { field: 'billedCents', op: 'gte', value: 80 })).toBe(true)
    expect(passes(r, { field: 'billedCents', op: 'gt', value: 80 })).toBe(false)
    expect(passes(r, { field: 'payerName', op: 'empty' })).toBe(true)
    expect(passes(r, { field: 'clientName', op: 'one_of', value: 'Ben Baker, alma able' })).toBe(true)
    expect(passes(r, { field: 'payrollStatus', op: 'is_not', value: 'Approved' })).toBe(true)
  })
  test('a definition filters, sorts, groups and sums; a bad one names the box', () => {
    const rows = [row({ visitId: 'a', clockedMinutes: 100, payerName: 'Medicaid' }), row({ visitId: 'b', clockedMinutes: 50, minutesLateIn: 0, payerName: null }), row({ visitId: 'c', clockedMinutes: 70, payerName: 'Medicaid' })]
    const out = applyDefinition(rows as any, { name: 'x', columns: ['date', 'clientName', 'clockedMinutes'], filters: [{ field: 'minutesLateIn', op: 'gt', value: 7 }], sortBy: 'clockedMinutes', sortDir: 'desc', groupBy: 'payerName' })
    expect(out.count).toBe(2)
    expect(out.rows.map((r: any) => r.visitId)).toEqual(['a', 'c'])
    expect(out.sums).toEqual({ clockedMinutes: 170 })
    expect(out.groups).toEqual([{ key: 'Medicaid', label: 'Medicaid', rows: 2, sums: { clockedMinutes: 170 } }])
    expect(out.columns.map((c) => c.label)).toEqual(['Date', 'Client', 'Clocked minutes'])
    expect(checkDefinition({ name: '', columns: ['date'] })).toMatchObject({ fields: { name: 'Name the report' } })
    expect(checkDefinition({ name: 'x', columns: ['nope'] })).toMatchObject({ fields: { columns: 'Pick a column' } })
    expect(checkDefinition({ name: 'x', columns: ['date'], filters: [{ field: 'clientName', op: 'gt', value: 1 }] })).toMatchObject({ problem: '"is more than" does not apply to Client.' })
    expect(checkDefinition({ name: 'x', columns: ['date'], filters: [{ field: 'clientName', op: 'contains' }] })).toMatchObject({ fields: { filters: 'Client: enter a value' } })
    expect(checkDefinition({ name: ' Late ', columns: ['date', 'bogus'], filters: [{ field: 'payerName', op: 'empty' }], sortBy: 'date', sortDir: 'desc', groupBy: 'nope' })).toEqual({ def: { name: 'Late', description: null, columns: ['date'], filters: [{ field: 'payerName', op: 'empty', value: null }], sortBy: 'date', sortDir: 'desc', groupBy: null } })
    // the library is made of definitions that pass their own check
    for (const l of LIBRARY) expect('def' in checkDefinition(l)).toBe(true)
    expect(FIELDS.filter((f) => f.payroll).map((f) => f.key)).toEqual(['payableMinutes', 'payrollStatus'])
    expect(checkTiles([{ kind: 'margin_by_branch', days: 900 }, { kind: 'retention', title: ' Risk ' }])).toEqual({ tiles: [{ kind: 'margin_by_branch', title: undefined, days: 400, by: undefined }, { kind: 'retention', title: 'Risk', days: undefined, by: undefined }] })
    expect(checkTiles([{ kind: 'nope' }])).toEqual({ problem: 'A tile is of a kind that does not exist.' })
  })
  test('a schedule\'s next day and wording', () => {
    expect(nextRunOn({ cadence: 'daily' }, '2026-10-31')).toBe('2026-10-31')
    expect(nextRunOn({ cadence: 'weekly', dayOfWeek: 1 }, '2026-10-31')).toBe('2026-11-02') // Saturday → Monday
    expect(nextRunOn({ cadence: 'weekly', dayOfWeek: 6 }, '2026-10-31')).toBe('2026-10-31')
    expect(nextRunOn({ cadence: 'monthly', dayOfMonth: 1 }, '2026-10-31')).toBe('2026-11-01')
    expect(nextRunOn({ cadence: 'monthly', dayOfMonth: 15 }, '2026-10-03')).toBe('2026-10-15')
    expect(nextRunOn({ cadence: 'monthly', dayOfMonth: 1 }, '2026-12-02')).toBe('2027-01-01')
    expect(cadenceText({ cadence: 'weekly', dayOfWeek: 1, hour: 6, windowDays: 7, reportKind: 'client_margin' })).toBe('Every Monday at 06:00, the last 7 days')
    expect(cadenceText({ cadence: 'monthly', dayOfMonth: 2, hour: 18, windowDays: 30, reportKind: 'turnover' })).toBe('On the 2nd of the month at 18:00, the last 30 days')
    expect(cadenceText({ cadence: 'daily', hour: 7, windowDays: 1, reportKind: 'daily_manager' })).toBe('Every day at 07:00, the day before')
    expect(checkSchedule({ name: 'x', reportKind: 'saved', cadence: 'daily', recipients: ['u'] })).toMatchObject({ fields: { reportId: 'Pick a saved report' } })
    expect(checkSchedule({ name: 'x', reportKind: 'turnover', cadence: 'weekly', dayOfWeek: 9, recipients: ['u'] })).toMatchObject({ fields: { dayOfWeek: 'Pick a day' } })
    expect(checkSchedule({ name: 'x', reportKind: 'turnover', cadence: 'daily', recipients: [] })).toMatchObject({ fields: { recipients: 'Pick someone' } })
  })
})

describe('row 12 — the report builder over visits', () => {
  test('the fields, the rules and the library are listed; an ad-hoc report runs with filters and downloads', async () => {
    const f = await get('/api/report-builder/fields')
    expect(f.status).toBe(200)
    expect(f.body.fields.some((x: any) => x.key === 'payableMinutes')).toBe(true)
    expect(f.body.library.map((l: any) => l.key)).toContain('late_clock_ins')
    const def = { name: 'Late', columns: ['date', 'clientName', 'caregiverName', 'minutesLateIn', 'clockedMinutes', 'billedCents', 'signed', 'unsignedReason', 'tasksDone', 'formsDone', 'payrollStatus', 'payerName'], filters: [{ field: 'minutesLateIn', op: 'gt', value: 7 }], sortBy: 'date' }
    const r = await json(await as('owner')(`/api/report-builder/run?${W}`, { method: 'POST', json: { definition: def } }))
    expect(r.status).toBe(200)
    expect(r.body.count).toBe(1)
    expect(r.body.rows[0]).toMatchObject({ date: '2026-10-03', clientName: 'Alma Able', caregiverName: 'Ann Carer', minutesLateIn: 20, clockedMinutes: 100, billedCents: null, signed: false, unsignedReason: 'Client was asleep', tasksDone: 1, formsDone: 1, payrollStatus: 'Verified', payerName: 'County Medicaid' })
    const all = await json(await as('owner')(`/api/report-builder/run?${W}`, { method: 'POST', json: { definition: { ...def, filters: [], groupBy: 'signed' } } }))
    expect(all.body.count).toBe(2)
    expect(all.body.sums).toMatchObject({ clockedMinutes: 233, billedCents: 8000 })
    expect(all.body.groups.map((g: any) => [g.label, g.rows])).toEqual([['false', 1], ['true', 1]])
    const csv = await as('owner')(`/api/report-builder/run?${W}`, { method: 'POST', json: { definition: def, format: 'csv' } })
    expect(csv.headers.get('content-type')).toContain('text/csv')
    expect((await csv.text()).split('\n')[1]).toBe('2026-10-03,Alma Able,Ann Carer,20,100,,no,Client was asleep,1,1,Verified,County Medicaid')
    const bad = await json(await as('owner')(`/api/report-builder/run?${W}`, { method: 'POST', json: { definition: { name: 'x', columns: [] } } }))
    expect(bad.body).toMatchObject({ code: 'bad_definition', fields: { columns: 'Pick a column' } })
  })

  test('saved reports: save, run, copy, copy from the library, edit, delete', async () => {
    const saved = await json(await as('owner')('/api/report-builder/reports', { method: 'POST', json: { name: 'Unsigned', columns: ['date', 'clientName', 'unsignedReason'], filters: [{ field: 'signed', op: 'is', value: false }] } }))
    expect(saved.status).toBe(201)
    ids.report = saved.body.id
    const run = await get(`/api/report-builder/reports/${ids.report}/run?${W}`)
    expect(run.body.count).toBe(1)
    expect(run.body.rows[0].unsignedReason).toBe('Client was asleep')
    const pdf = await as('owner')(`/api/report-builder/reports/${ids.report}/run?${W}&format=pdf`)
    expect(pdf.headers.get('content-type')).toBe('application/pdf')
    const copy = await json(await as('owner')(`/api/report-builder/reports/${ids.report}/copy`, { method: 'POST' }))
    expect(copy.body).toMatchObject({ name: 'Unsigned (copy)', copiedFromId: ids.report, filters: [{ field: 'signed', op: 'is', value: false }] })
    const lib = await json(await as('owner')('/api/report-builder/reports/copy', { method: 'POST', json: { libraryKey: 'late_clock_ins' } }))
    expect(lib.body).toMatchObject({ name: 'Late clock-ins', copiedFromId: 'late_clock_ins' })
    expect((await get(`/api/report-builder/reports/${lib.body.id}/run?${W}`)).body.count).toBe(1)
    const edited = await json(await as('owner')(`/api/report-builder/reports/${lib.body.id}`, { method: 'PUT', json: { ...lib.body, name: 'Very late', filters: [{ field: 'minutesLateIn', op: 'gt', value: 30 }] } }))
    expect(edited.body.name).toBe('Very late')
    expect((await get(`/api/report-builder/reports/${lib.body.id}/run?${W}`)).body.count).toBe(0)
    expect((await get('/api/report-builder/reports')).body.data.length).toBe(3)
    expect((await json(await as('owner')(`/api/report-builder/reports/${copy.body.id}`, { method: 'DELETE' }))).body).toEqual({ success: true })
    expect((await get('/api/report-builder/reports')).body.data.length).toBe(2)
    // a caregiver may not build reports
    expect((await as('ann')('/api/report-builder/fields')).status).toBe(403)
  })
})

describe('row 12 — dashboards and the three reports', () => {
  test('the financial dashboard has the margin by branch and by referral source, the months and the receivables', async () => {
    const r = await get('/api/report-builder/dashboards/financial?days=400')
    expect(r.status).toBe(200)
    expect(r.body.byBranch.map((g: any) => g.name)).toEqual(['North branch'])
    expect(r.body.byReferralSource[0]).toMatchObject({ name: 'St Mary Hospital', billedCents: 14667 })
    expect(r.body.months.find((m: any) => m.month === '2026-10')).toMatchObject({ invoicedCents: 8000 })
    expect(r.body.receivables).toMatchObject({ openInvoices: 1 })
  })
  test('the authorization dashboard says which authorizations are running out early', async () => {
    const r = await get('/api/report-builder/dashboards/authorizations')
    expect(r.body.authorizations[0]).toMatchObject({ clientName: 'Alma Able', payerName: 'County Medicaid', authorizedUnits: 400, usedUnits: 350, usedPercent: 87.5, pace: 'Running out early' })
    expect(r.body.summary).toMatchObject({ active: 1, runningOutEarly: 1, over80Percent: 1 })
  })
  test('the caregiver dashboard, the workforce report (underused staff, cancellations by week) and the performance report', async () => {
    const wf = await get(`/api/report-builder/workforce?${W}`)
    expect(wf.status).toBe(200)
    const ann = wf.body.caregivers.find((c: any) => c.name === 'Ann Carer')
    // 233 minutes over two weeks ≈ 1.9 h a week against 30 wanted → underused
    expect(ann).toMatchObject({ hoursWorked: 3.89, hoursPerWeek: 1.9, hoursWanted: 30, maxHoursPerWeek: 40, underused: true, status: 'Underused', visitsWorked: 2, visitsScheduled: 2 })
    expect(wf.body.caregivers.find((c: any) => c.name === 'Bob Carer')).toMatchObject({ callouts: 1, missedVisits: 1, status: 'Underused' })
    expect(wf.body.summary).toMatchObject({ caregivers: 2, underused: 2, cancelled: 2, cancelledByCaregiver: 1 })
    expect(wf.body.cancellationTrend).toEqual([{ week: '2026-10-04', cancelled: 2, byCaregiver: 1, byClient: 1, byReason: { 'Caregiver called out': 1, 'Client in hospital or facility': 1 } }])
    const perf = await get(`/api/report-builder/performance?${W}`)
    const pa = perf.body.caregivers.find((c: any) => c.name === 'Ann Carer')
    expect(pa).toMatchObject({ visitsScheduled: 2, visitsCompleted: 2, visitsMissed: 0, visitsCancelled: 0, lateClockIns: 1, lateClockOuts: 1, onTimePercent: 50, tasksDone: 1, tasksSkipped: 1, adlCompletionPercent: 50, formsDone: 1, formsMissed: 1, formCompletionPercent: 50, signedPercent: 50, averageRating: 4, ratings: 1, adlsRecorded: 1 })
    expect(perf.body.caregivers.find((c: any) => c.name === 'Bob Carer')).toMatchObject({ visitsCompleted: 0, visitsMissed: 1, visitsCancelled: 1 })
    expect(perf.body.totals).toMatchObject({ visitsCompleted: 2, visitsMissed: 1, visitsCancelled: 1, lateClockIns: 1 })
    const csv = await as('owner')(`/api/report-builder/performance?${W}&format=csv`)
    expect((await csv.text()).split('\n')[0]).toContain('Late clock-ins,Late clock-outs,On time %,ADL completion %,Form completion %')
    const dash = await get('/api/report-builder/dashboards/caregivers?days=400')
    expect(dash.body).toMatchObject({ headcount: 2, workforce: { underused: 2 }, performance: { visitsMissed: 1, averageOnTimePercent: 50 } })
  })
  test('the daily manager report for one day', async () => {
    const r = await get('/api/report-builder/daily-manager?date=2026-10-06')
    expect(r.status).toBe(200)
    // two visits were on the 6th's schedule and both were cancelled (one a caregiver call-out); nothing was clocked
    expect(r.body.visits).toMatchObject({ scheduled: 0, completed: 0, cancelled: 2, caregiverCallouts: 1, notClocked: 0 })
    const d3 = await get('/api/report-builder/daily-manager?date=2026-10-03')
    expect(d3.body.visits).toMatchObject({ scheduled: 1, completed: 1, lateClockIns: 1, clockedHours: 1.67 })
    expect(d3.body.attention).toMatchObject({ authorizationsEndingIn14Days: 0 })
    expect(d3.body.money).toMatchObject({ visits: 1, billedCents: 6667, payCents: 3333 })
    const pdf = await as('owner')('/api/report-builder/daily-manager?date=2026-10-03&format=pdf')
    expect(pdf.headers.get('content-type')).toBe('application/pdf')
  })
  test('a custom dashboard is saved from the tile catalogue and answers each tile', async () => {
    const tiles = await get('/api/report-builder/tiles')
    expect(tiles.body.tiles.map((x: any) => x.kind)).toContain('margin_by_referral_source')
    const made = await json(await as('owner')('/api/report-builder/dashboards/custom', { method: 'POST', json: { name: 'Owner view', tiles: [{ kind: 'margin_by_branch', days: 400 }, { kind: 'margin_by_referral_source', days: 400, title: 'By source' }, { kind: 'turnover', days: 400 }, { kind: 'receivables' }, { kind: 'retention' }] } }))
    expect(made.status).toBe(201)
    const data = await get(`/api/report-builder/dashboards/custom/${made.body.id}/data`)
    expect(data.body.tiles.map((x: any) => x.title)).toEqual(['Profit margin by branch (location)', 'By source', 'Caregiver turnover', 'Receivables (owed now)', 'Retention: satisfaction and at-risk caregivers'])
    expect(data.body.tiles[0].groups[0]).toMatchObject({ name: 'North branch' })
    expect(data.body.tiles[1].groups[0]).toMatchObject({ name: 'St Mary Hospital' })
    expect(data.body.tiles[2]).toMatchObject({ headcountEnd: 2 })
    expect((await json(await as('owner')('/api/report-builder/dashboards/custom', { method: 'POST', json: { name: 'x', tiles: [{ kind: 'nope' }] } }))).body.code).toBe('bad_dashboard')
    expect((await json(await as('owner')(`/api/report-builder/dashboards/custom/${made.body.id}`, { method: 'DELETE' }))).status).toBe(200)
  })
})

describe('row 12 — scheduled report emails, encrypted at rest', () => {
  test('a schedule is saved with its next day; "send now" stores the file encrypted and mails a link', async () => {
    const made = await json(await as('owner')('/api/report-builder/schedules', { method: 'POST', json: { name: 'Monday margin', reportKind: 'client_margin', format: 'csv', cadence: 'weekly', dayOfWeek: 1, hour: 6, windowDays: 14, recipients: [ids.owner] } }))
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({ cadenceLabel: 'Every Monday at 06:00, the last 14 days', kindLabel: 'Client margin', isActive: true })
    expect(made.body.nextRunOn).toBe(nextRunOn({ cadence: 'weekly', dayOfWeek: 1 }, await core.time.today(companyId)))
    ids.schedule = made.body.id
    // a recipient who is not the agency's own staff is refused
    expect((await json(await as('owner')('/api/report-builder/schedules', { method: 'POST', json: { name: 'x', reportKind: 'turnover', cadence: 'daily', recipients: ['stranger'] } }))).body.fields).toEqual({ recipients: 'Not your staff' })
    const sent = await json(await as('owner')(`/api/report-builder/schedules/${ids.schedule}/send-now`, { method: 'POST' }))
    expect(sent.status).toBe(201)
    expect(sent.body.sentTo).toEqual(['owner@test.example'])
    expect(sent.body.link).toContain(`/crm/report-builder/deliveries/${sent.body.id}`)
    ids.delivery = sent.body.id
    const [row] = await t.db.select().from(t.schema.reportDelivery).where(eq(t.schema.reportDelivery.id, ids.delivery))
    expect(row.contentType).toContain('text/csv')
    expect(row.ciphertext.split(':').length).toBe(3)
    expect(row.ciphertext).not.toContain('Client')
    expect(Buffer.from(row.ciphertext, 'utf8').toString()).not.toContain(Buffer.from('Client,Branch').toString('base64').slice(0, 8))
    const list = await get('/api/report-builder/deliveries')
    expect(list.body.data[0]).toMatchObject({ id: ids.delivery, sentTo: ['owner@test.example'], downloads: 0 })
    expect(list.body.data[0].ciphertext).toBeUndefined()
  })
  test('the link opens for a named recipient while it is live, never for someone else, never after it expired', async () => {
    const open = await as('owner')(`/api/report-builder/deliveries/${ids.delivery}`)
    expect(open.status).toBe(200)
    expect(open.headers.get('content-type')).toContain('text/csv')
    expect((await open.text()).split('\n')[0]).toBe('Client,Branch,Department,Referral source,Payer,Hours worked,Hours invoiced,Overtime hours,Bill rate,Billed,Caregiver pay,Mileage,Cost,Margin,Margin %')
    expect((await get('/api/report-builder/deliveries')).body.data[0].downloads).toBe(1)
    expect((await as('ann')(`/api/report-builder/deliveries/${ids.delivery}`)).status).toBe(403)
    await t.db.update(t.schema.reportDelivery).set({ expiresAt: new Date(Date.now() - 1000) } as any).where(eq(t.schema.reportDelivery.id, ids.delivery))
    const gone = await json(await as('owner')(`/api/report-builder/deliveries/${ids.delivery}`))
    expect(gone.status).toBe(410)
    expect(gone.body.error).toContain('expired')
  })
  test('the scan sends a due schedule once, at or after its hour on the agency\'s clock, and not before', async () => {
    await t.db.update(t.schema.reportSchedule).set({ nextRunOn: '2026-11-02', lastRunOn: null } as any).where(eq(t.schema.reportSchedule.id, ids.schedule))
    expect(await core.reportSchedules.scanCompany(companyId, new Date('2026-11-02T05:30:00Z'))).toBe(0)   // before 06:00
    expect(await core.reportSchedules.scanCompany(companyId, new Date('2026-11-02T06:10:00Z'))).toBe(1)
    expect(await core.reportSchedules.scanCompany(companyId, new Date('2026-11-02T06:15:00Z'))).toBe(0)   // claimed: once a day
    const [s] = await t.db.select().from(t.schema.reportSchedule).where(eq(t.schema.reportSchedule.id, ids.schedule))
    expect(String(s.lastRunOn)).toBe('2026-11-02')
    expect(String(s.nextRunOn)).toBe('2026-11-09')
    const deliveries = (await get('/api/report-builder/deliveries')).body.data
    expect(deliveries.length).toBe(2)
    expect(deliveries[0]).toMatchObject({ periodStart: '2026-10-19', periodEnd: '2026-11-01' })
    // paused: nothing goes; a missed whole day is skipped, not sent out of the blue
    await json(await as('owner')(`/api/report-builder/schedules/${ids.schedule}/active`, { method: 'PATCH', json: { isActive: false } }))
    await t.db.update(t.schema.reportSchedule).set({ nextRunOn: '2026-11-09' } as any).where(eq(t.schema.reportSchedule.id, ids.schedule))
    expect(await core.reportSchedules.scanCompany(companyId, new Date('2026-11-09T09:00:00Z'))).toBe(0)
    await json(await as('owner')(`/api/report-builder/schedules/${ids.schedule}/active`, { method: 'PATCH', json: { isActive: true } }))
    await t.db.update(t.schema.reportSchedule).set({ nextRunOn: '2026-11-09' } as any).where(eq(t.schema.reportSchedule.id, ids.schedule))
    expect(await core.reportSchedules.scanCompany(companyId, new Date('2026-11-11T09:00:00Z'))).toBe(0)
    const [after] = await t.db.select().from(t.schema.reportSchedule).where(eq(t.schema.reportSchedule.id, ids.schedule))
    expect(String(after.nextRunOn)).toBe('2026-11-16')
  })
  test('without the feature everything is refused', async () => {
    await setFeatures(['contacts', 'scheduling', 'team', 'care_margin_reports'])
    for (const p of ['/fields', '/reports', '/dashboards/financial', '/daily-manager', '/workforce', '/performance', '/schedules', '/deliveries']) {
      const r = await get(`/api/report-builder${p}`)
      expect(r.status).toBe(403)
      expect(r.body.feature).toBe('care_report_builder')
    }
    expect(await core.reportSchedules.scanCompany(companyId, new Date('2026-11-16T09:00:00Z'))).toBe(0)
    await setFeatures(ON)
  })
})

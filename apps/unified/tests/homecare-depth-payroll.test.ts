// Home care depth, item 2 (docs/parity/homecare-payroll.md): overtime by the agency's own state rule (California daily overtime and double
// time, the 7th day, no stacking), paid travel between visits, ADP and Paychex hours files, and the Gusto push (removed: it only ever
// answered 501). Without care_payroll_rules payroll is the weekly rule it always was.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { classifyWeek, buildSegments, OVERTIME_RULES, type Segment } from '../server/crm/homecare/core/payRules.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const BASE = ['contacts', 'scheduling', 'team']
const send = async (who: string, method: string, path: string, body?: any) => {
  const r = await as(who)(path, { method, ...(body !== undefined ? { json: body } : {}) })
  const text = await r.text()
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch { /* a file */ }
  return { status: r.status, body: parsed, text, headers: r.headers }
}
const calc = async (start = '2026-11-01', end = '2026-11-07') => (await send('owner', 'POST', '/api/payroll/calculate', { startDate: start, endDate: end })).body.payroll[0]
const seg = (id: string, date: string, hours: number, kind: 'work' | 'travel' = 'work'): Segment => ({ id, kind, clientId: 'c', date, minutes: Math.round(hours * 60) })
const sums = (rows: any[]) => rows.reduce((t, r) => [t[0] + r.regular, t[1] + r.overtime, t[2] + r.doubleTime], [0, 0, 0]).map((m: number) => m / 60)

const visit = (over: Partial<any> = {}): any => ({ id: 'v', caregiverId: 'g', clientId: 'a', shiftDate: '2026-11-02', minutes: 120, actualStart: null, actualEnd: null, scheduledStart: null, scheduledEnd: null, ...over })

describe('home care — pay rules: the rule engine (pure)', () => {
  test('federal: only hours over 40 in the week', () => {
    const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']
    expect(sums(classifyWeek(days.map((d, i) => seg(`s${i}`, d, 7.5)), OVERTIME_RULES.federal))).toEqual([40, 5, 0])
  })
  test('california: over 8 a day is overtime, over 12 is double time, a visit across the line is split', () => {
    const r = classifyWeek([seg('a', '2026-11-02', 6), seg('b', '2026-11-02', 5), seg('c', '2026-11-03', 13)], OVERTIME_RULES.california)
    expect(r.map((x) => [x.regular, x.overtime, x.doubleTime])).toEqual([[360, 0, 0], [120, 180, 0], [480, 240, 60]])
    expect(r.every((x) => x.regular + x.overtime + x.doubleTime === x.minutes)).toBe(true)
  })
  test('california: hours over 40 that are not already daily overtime become overtime, never both', () => {
    const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']
    expect(sums(classifyWeek(days.map((d, i) => seg(`s${i}`, d, 8)), OVERTIME_RULES.california))).toEqual([40, 8, 0])
  })
  test('california: the 7th straight day of the week is overtime for 8 hours and double time after', () => {
    const week = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']
    expect(sums(classifyWeek(week.map((d, i) => seg(`s${i}`, d, 8)), OVERTIME_RULES.california))).toEqual([40, 16, 0])
    const nine = week.map((d, i) => seg(`s${i}`, d, i === 6 ? 9 : 8))
    expect(sums(classifyWeek(nine, OVERTIME_RULES.california))).toEqual([40, 16, 1])
    // six days is not seven
    expect(sums(classifyWeek(week.slice(0, 6).map((d, i) => seg(`s${i}`, d, 8)), OVERTIME_RULES.california))).toEqual([40, 8, 0])
  })
  test('alaska and colorado have their own daily lines and no double time', () => {
    const one = [seg('a', '2026-11-02', 13)]
    expect(sums(classifyWeek(one, OVERTIME_RULES.alaska))).toEqual([8, 5, 0])
    expect(sums(classifyWeek(one, OVERTIME_RULES.colorado))).toEqual([12, 1, 0])
  })
  test('travel: paid up to the cap when the gap is short enough, between different clients, from times of the same kind', () => {
    const tr = { enabled: true, maxGapMinutes: 60, capMinutes: 30, rateCents: null, method: 'gap' as const, roundToMinutes: 1, fromHome: false, mileageFromVisits: false }
    const a = visit({ id: 'a', clientId: 'x', scheduledStart: '2026-11-02T09:00:00', scheduledEnd: '2026-11-02T11:00:00' })
    const after = (gapMin: number, over: Partial<any> = {}) => {
      const startMs = Date.parse('2026-11-02T11:00:00Z') + gapMin * 60_000
      const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19)
      return visit({ id: 'b', clientId: 'y', scheduledStart: iso(startMs), scheduledEnd: iso(startMs + 3_600_000), ...over })
    }
    const travelOf = (vs: any[], rule = tr) => buildSegments(vs, rule).filter((s) => s.kind === 'travel').map((s) => s.minutes)
    expect(travelOf([a, after(20)])).toEqual([20])
    expect(travelOf([a, after(50)])).toEqual([30])
    expect(travelOf([a, after(90)])).toEqual([])
    expect(travelOf([a, after(0)])).toEqual([])
    expect(travelOf([a, after(20, { clientId: 'x' })])).toEqual([])
    expect(travelOf([a, after(20)], { ...tr, enabled: false })).toEqual([])
    expect(travelOf([a, after(20, { actualStart: '2026-11-02T11:20:00', actualEnd: '2026-11-02T12:20:00' })])).toEqual([])
    // the order in the day is the order worked, whatever order they came in
    expect(buildSegments([after(20), a], tr).map((s) => s.id)).toEqual(['a', 'travel:b', 'b'])
  })
})

describe('home care — pay rules: the pay run', () => {
  beforeAll(async () => {
    t = await bootTenant({ vertical: 'homecare' })
    const seeded = await seedOwner(t)
    companyId = seeded.company.id
    tokens.owner = await login('owner@test.example', seeded.password)
    const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
    ids.ann = (await ins(t.schema.user, { email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'caregiver', companyId, defaultPayRate: '20.00' })).id
    tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
    ids.a = (await ins(t.schema.clients, { companyId, firstName: 'Alma', lastName: 'Able', isActive: true, isPrivatePay: true, privatePayRate: '40.00', privatePayRateType: 'hourly' })).id
    ids.b = (await ins(t.schema.clients, { companyId, firstName: 'Ben', lastName: 'Baker', isActive: true, isPrivatePay: true, privatePayRate: '30.00', privatePayRateType: 'hourly' })).id
    const review = (clientId: string, shiftDate: string, start: string, end: string, minutes: number) =>
      ins(t.schema.payrollShiftReviews, { companyId, payPeriodStart: '2026-11-01', payPeriodEnd: '2026-11-07', caregiverId: ids.ann, clientId, shiftDate, payableMinutes: minutes, status: 'verified', actualStart: new Date(`${shiftDate}T${start}:00Z`), actualEnd: new Date(`${shiftDate}T${end}:00Z`) })
    await review(ids.a, '2026-11-02', '08:00', '18:00', 600)   // Mon 10 h
    await review(ids.a, '2026-11-03', '06:00', '19:00', 780)   // Tue 13 h
    await review(ids.a, '2026-11-04', '09:00', '11:00', 120)   // Wed 2 h at Alma, 30 minutes to get to Ben,
    await review(ids.b, '2026-11-04', '11:30', '14:30', 180)   //        then 3 h at Ben
    await setFeatures(BASE)
  }, 90_000)

  test('without the feature it is the weekly rule: 28 hours is 28 regular hours, and nothing new is owed', async () => {
    const line = await calc()
    expect(line).toMatchObject({ regularHours: 28, overtimeHours: 0, doubleTimeHours: 0, travelHours: 0, wagesPay: 560 })
    expect((await send('owner', 'GET', '/api/pay-rules')).status).toBe(403)
  })

  test('with the feature but the federal rule and no travel, the numbers do not move', async () => {
    await setFeatures([...BASE, 'care_payroll_rules'])
    const before = await calc()
    expect(before).toMatchObject({ regularHours: 28, overtimeHours: 0, doubleTimeHours: 0, wagesPay: 560 })
  })

  test('the settings are checked and need the payroll permission', async () => {
    expect((await send('ann', 'GET', '/api/pay-rules')).status).toBe(403)
    expect((await send('ann', 'PUT', '/api/pay-rules', { overtimeRule: 'california' })).status).toBe(403)
    expect((await send('owner', 'PUT', '/api/pay-rules', { overtimeRule: 'mars' })).body.code).toBe('bad_rule')
    expect((await send('owner', 'PUT', '/api/pay-rules', { travel: { enabled: true, maxGapMinutes: 0 } })).body.code).toBe('bad_travel')
    const got = await send('owner', 'GET', '/api/pay-rules')
    expect(got.body.rules).toMatchObject({ overtimeRule: 'federal', travel: { enabled: false, maxGapMinutes: 60, capMinutes: 30 } })
    expect(got.body.overtimeRules.map((r: any) => r.id)).toEqual(['federal', 'california', 'california_personal_attendant', 'alaska', 'nevada', 'colorado', 'kentucky'])
  })

  test('california with travel: daily overtime, double time and the 30 minutes between Alma and Ben', async () => {
    const saved = await send('owner', 'PUT', '/api/pay-rules', { overtimeRule: 'california', travel: { enabled: true } })
    expect(saved.status).toBe(200)
    const line = await calc()
    // Mon 10 h: 8 + 2 OT. Tue 13 h: 8 + 4 OT + 1 DT. Wed 2 h + 0.5 h travel + 3 h = 5.5 h. 21.5 regular, 6 OT, 1 DT.
    expect(line).toMatchObject({ regularHours: 21.5, overtimeHours: 6, doubleTimeHours: 1, travelHours: 0.5, totalHours: 28.5, shifts: 4 })
    // 21.5 × 20 + 6 × 30 + 1 × 40
    expect(line).toMatchObject({ regularPay: 430, overtimePay: 180, doubleTimePay: 40, wagesPay: 650 })
    expect(line.weeks).toMatchObject([{ weekStart: '2026-11-01', hours: 28.5, regularHours: 21.5, overtimeHours: 6, doubleTimeHours: 1, blendedRate: 20, pay: 650 }])
  })

  test('a range that starts mid-week is paid only for its own days', async () => {
    const line = await calc('2026-11-03', '2026-11-07')
    expect(line).toMatchObject({ regularHours: 13.5, overtimeHours: 4, doubleTimeHours: 1, shifts: 3 })
  })

  test('approving stores the double time, and the lines of the CSV add up to the wages', async () => {
    const ok = await send('owner', 'PUT', `/api/payroll/${ids.ann}/approve`, { startDate: '2026-11-01', endDate: '2026-11-07' })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ regularHours: '21.50', overtimeHours: '6.00', doubleTimeHours: '1.00', grossPay: '650.00' })
    const csv = await send('owner', 'POST', '/api/payroll/export', { startDate: '2026-11-01', endDate: '2026-11-07' })
    const lines = csv.text.trim().split('\n').slice(1)
    expect(lines.some((l) => l.includes('Travel time'))).toBe(true)
    expect(lines.some((l) => l.includes('Double time premium'))).toBe(true)
    const total = lines.reduce((s, l) => s + Number(l.split(',').pop()), 0)
    expect(Math.round(total * 100) / 100).toBe(650)
    const qb = await send('owner', 'GET', '/api/payroll/export/quickbooks?startDate=2026-11-01&endDate=2026-11-07')
    expect(qb.text).toContain('"Double time",1.00,40.00,40.00')
  })

  test('the Gusto file gains a double overtime column only when there is some, and the 501 push is gone', async () => {
    const csv = await send('owner', 'GET', '/api/gusto/export-csv?startDate=2026-11-01&endDate=2026-11-07')
    expect(csv.status).toBe(200)
    expect(csv.text.split('\n')[0]).toContain('Double Overtime Hours')
    expect(csv.text.split('\n')[1]).toContain(',28.50,1.00,')
    expect((await send('owner', 'POST', '/api/gusto/export', {})).status).toBe(404)
  })

  test('client margin carries the same pay, with the travel on the client travelled to', async () => {
    await setFeatures([...BASE, 'care_payroll_rules', 'care_margin_reports'])
    const r = await send('owner', 'GET', '/api/margin-reports/client-margin?startDate=2026-11-01&endDate=2026-11-07')
    expect(r.status).toBe(200)
    const by = (n: string) => r.body.clients.find((c: any) => c.clientName === n)
    expect(r.body.clients.reduce((s: number, c: any) => s + c.pay, 0)).toBe(650)
    expect(by('Ben Baker')).toMatchObject({ hours: 3, travelPay: 10 })
    expect(by('Alma Able')).toMatchObject({ hours: 25, doubleTimePay: 40, travelPay: 0 })
    await setFeatures([...BASE, 'care_payroll_rules'])
  })

  test('ADP: refused until the company code, a payroll id and the double time code are set, then the file', async () => {
    const range = 'startDate=2026-11-01&endDate=2026-11-07'
    expect((await send('owner', 'GET', `/api/pay-rules/export/adp?${range}`)).body.code).toBe('missing_worker_ids')
    expect((await send('owner', 'PUT', `/api/pay-rules/caregiver/${ids.ann}/worker-id`, { payrollWorkerId: 'EMP0001' })).status).toBe(200)
    expect((await send('owner', 'PUT', `/api/pay-rules/caregiver/${ids.ann}/worker-id`, { payrollWorkerId: 'WAY-TOO-LONG-AN-ID' })).body.code).toBe('bad_worker_id')
    expect((await send('owner', 'GET', `/api/pay-rules/export/adp?${range}`)).body.code).toBe('adp_not_set_up')
    expect((await send('owner', 'PUT', '/api/pay-rules', { files: { adpCompanyCode: 'ab' } })).body.code).toBe('bad_files')
    await send('owner', 'PUT', '/api/pay-rules', { files: { adpCompanyCode: 'abc' } })
    expect((await send('owner', 'GET', `/api/pay-rules/export/adp?${range}`)).body.code).toBe('adp_double_time_code')
    await send('owner', 'PUT', '/api/pay-rules', { files: { adpDoubleTimeCode: 'DBL' } })
    const file = await send('owner', 'GET', `/api/pay-rules/export/adp?${range}`)
    expect(file.status).toBe(200)
    expect(file.headers.get('content-disposition')).toContain('filename="EPIABC01.csv"')
    expect(file.text.split('\n')).toEqual([
      'Co Code,Batch ID,File #,Temp Dept,Temp Rate,Reg Hours,O/T Hours,Hours 3 Code,Hours 3 Amount',
      'ABC,261107,"EMP0001",,,21.50,6.00,"DBL",1.00',
    ])
    expect((await send('ann', 'GET', `/api/pay-rules/export/adp?${range}`)).status).toBe(403)
    expect((await send('owner', 'GET', '/api/pay-rules/export/adp?startDate=2026-11-09&endDate=2026-11-01')).body.code).toBe('bad_range')
    expect((await send('owner', 'GET', '/api/pay-rules/export/adp?startDate=2027-01-01&endDate=2027-01-07')).body.code).toBe('no_hours')
  })

  test('Paychex: one line per pay component with hours, by the worker id', async () => {
    const range = 'startDate=2026-11-01&endDate=2026-11-07'
    expect((await send('owner', 'GET', `/api/pay-rules/export/paychex?${range}`)).body.code).toBe('paychex_not_set_up')
    await send('owner', 'PUT', '/api/pay-rules', { files: { paychexClientId: 'CLIENT01', paychexComponents: { doubleTime: 'Dbl Time' } } })
    const file = await send('owner', 'GET', `/api/pay-rules/export/paychex?${range}`)
    expect(file.status).toBe(200)
    expect(file.text.split('\n')).toEqual([
      'CLIENT01,EMP0001,,,Hourly,,,21.50,,11/07/2026,,',
      'CLIENT01,EMP0001,,,Overtime,,,6.00,,11/07/2026,,',
      'CLIENT01,EMP0001,,,Dbl Time,,,1.00,,11/07/2026,,',
    ])
  })

  test('two caregivers cannot share a payroll id', async () => {
    const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
    const bob = (await ins(t.schema.user, { email: 'bob@test.example', passwordHash: hash, firstName: 'Bob', lastName: 'Carer', role: 'caregiver', companyId })).id
    expect((await send('owner', 'PUT', `/api/pay-rules/caregiver/${bob}/worker-id`, { payrollWorkerId: 'EMP0001' })).status).toBe(409)
    expect((await send('owner', 'PUT', '/api/pay-rules/caregiver/nobody/worker-id', { payrollWorkerId: 'X' })).status).toBe(404)
  })
})

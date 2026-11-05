// Home care parity row 19 (docs/parity/homecare-payroll.md): pay rules finished — every state's overtime rule (Nevada's wage test,
// California's personal attendant, Kentucky's 7th day), meal and rest break premiums, holiday pay, overnight visits split at
// midnight and sleepovers, facility thresholds, the blended regular rate across several pay rates, the audit trail of how each hour
// was classified, a per-service switch to leave hours out of overtime, and daily / weekly limits that warn or block with a cap on
// payable hours. Behind care_payroll_rules.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { classifyWeek, buildSegments, sanitizeRules, stateRule, STATE_RULES, OVERTIME_RULES, midnightUtc, type Segment } from '../server/crm/homecare/core/payRules.ts'
import { breakPremiumsForDay } from '../server/crm/homecare/core/payrollPay.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const send = async (who: string, method: string, path: string, body?: any) => {
  const r = await t.call(path, { method, headers: { Authorization: `Bearer ${tokens[who]}` }, ...(body !== undefined ? { json: body } : {}) })
  const text = await r.text()
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch { /* a file */ }
  return { status: r.status, body: parsed, text }
}
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const BASE = ['contacts', 'scheduling', 'team']
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const calc = async (start = '2026-11-01', end = '2026-11-07') => (await send('owner', 'POST', '/api/payroll/calculate', { startDate: start, endDate: end })).body.payroll.find((l: any) => l.caregiverId === ids.ann)
const seg = (id: string, date: string, hours: number, over: Partial<Segment> = {}): Segment => ({ id, kind: 'work', clientId: 'c', date, minutes: Math.round(hours * 60), ...over })
const sums = (rows: any[]) => rows.reduce((t, r) => [t[0] + r.regular, t[1] + r.overtime, t[2] + r.doubleTime, t[3] + r.unpaid], [0, 0, 0, 0]).map((m: number) => m / 60)
const WEEK = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']

describe('row 19 — every state has its rule, with its citation (pure)', () => {
  test('50 states and DC are listed; each names a rule that exists and cites the law', () => {
    expect(STATE_RULES.length).toBe(51)
    for (const s of STATE_RULES) { expect(OVERTIME_RULES[s.rule]).toBeDefined(); expect(OVERTIME_RULES[s.rule].cite.length).toBeGreaterThan(5) }
    expect(stateRule('nv')!.rule).toBe('nevada'); expect(stateRule('CA')!.rule).toBe('california'); expect(stateRule('KY')!.rule).toBe('kentucky')
    expect(stateRule('TX')!.rule).toBe('federal'); expect(stateRule('MN')!.note).toContain('177.25'); expect(stateRule('ZZ')).toBeNull()
    expect(OVERTIME_RULES.nevada.cite).toContain('NRS 608.018'); expect(OVERTIME_RULES.california_personal_attendant.cite).toContain('1454')
  })
  test("nevada: over 8 a day only for a caregiver paid under 1.5× the minimum wage ($18.00); at or above it the week alone", () => {
    const day = [seg('a', '2026-11-02', 13)]
    expect(sums(classifyWeek(day, OVERTIME_RULES.nevada, null, { rateCents: 1700 }))).toEqual([8, 5, 0, 0])
    expect(sums(classifyWeek(day, OVERTIME_RULES.nevada, null, { rateCents: 1800 }))).toEqual([13, 0, 0, 0])
    // a segment's own rate wins over the caregiver's base
    expect(sums(classifyWeek([seg('a', '2026-11-02', 13, { rateCents: 1799 })], OVERTIME_RULES.nevada, null, { rateCents: 2500 }))).toEqual([8, 5, 0, 0])
  })
  test('california personal attendant: over 9 a day or 45 a week, no double time, no 7th day', () => {
    expect(sums(classifyWeek([seg('a', '2026-11-02', 14)], OVERTIME_RULES.california_personal_attendant))).toEqual([9, 5, 0, 0])
    expect(sums(classifyWeek(WEEK.slice(0, 6).map((d, i) => seg(`s${i}`, d, 8)), OVERTIME_RULES.california_personal_attendant))).toEqual([45, 3, 0, 0])
    expect(sums(classifyWeek(WEEK.map((d, i) => seg(`s${i}`, d, 6)), OVERTIME_RULES.california_personal_attendant))).toEqual([42, 0, 0, 0])
  })
  test('kentucky: all seven days worked and the week over 40 — every hour of the 7th day is overtime; under 40, nothing', () => {
    expect(sums(classifyWeek(WEEK.map((d, i) => seg(`s${i}`, d, 6)), OVERTIME_RULES.kentucky))).toEqual([36, 6, 0, 0])
    expect(sums(classifyWeek(WEEK.map((d, i) => seg(`s${i}`, d, 5)), OVERTIME_RULES.kentucky))).toEqual([35, 0, 0, 0])
    expect(sums(classifyWeek(WEEK.slice(0, 6).map((d, i) => seg(`s${i}`, d, 7)), OVERTIME_RULES.kentucky))).toEqual([40, 2, 0, 0])
  })
  test('a sleepover with no awake minutes is a worked day: it completes the 7-day streak', () => {
    const six = WEEK.slice(0, 6).map((d, i) => seg(`s${i}`, d, 7))
    expect(sums(classifyWeek([...six, seg('sl', WEEK[6], 2, { sleepover: true })], OVERTIME_RULES.california))).toEqual([40, 4, 0, 0])
    expect(sums(classifyWeek([...six, seg('sl', WEEK[6], 0, { sleepover: true })], OVERTIME_RULES.california))).toEqual([40, 2, 0, 0])
    const r = classifyWeek([...six, seg('sl', WEEK[6], 2, { sleepover: true })], OVERTIME_RULES.california)
    expect(r[6].reasons.join(' ')).toContain('Sleepover')
    expect(r[6].reasons.join(' ')).toContain('7th straight day')
  })
  test('a service left out of overtime stays regular and does not count toward the day or the week', () => {
    const r = classifyWeek([seg('a', '2026-11-02', 7), seg('b', '2026-11-02', 3, { otExempt: true })], OVERTIME_RULES.california)
    expect(sums(r)).toEqual([10, 0, 0, 0])
    expect(r[1].reasons[0]).toContain('left out of overtime')
    const w = classifyWeek([...WEEK.slice(0, 5).map((d, i) => seg(`s${i}`, d, 8)), seg('x', WEEK[5], 5, { otExempt: true })], OVERTIME_RULES.federal)
    expect(sums(w)).toEqual([45, 0, 0, 0])
  })
  test("facility staff: the agency's own daily and weekly lines replace the state rule, no double time", () => {
    const fac = { weeklyHours: 40, dailyOtAfterHours: 8 }
    expect(sums(classifyWeek([seg('a', '2026-11-02', 13)], OVERTIME_RULES.federal, null, { facility: fac }))).toEqual([8, 5, 0, 0])
    expect(sums(classifyWeek([seg('a', '2026-11-02', 13)], OVERTIME_RULES.california, null, { facility: fac }))).toEqual([8, 5, 0, 0])
    expect(sums(classifyWeek(WEEK.slice(0, 6).map((d, i) => seg(`s${i}`, d, 8)), OVERTIME_RULES.federal, null, { facility: { weeklyHours: 36, dailyOtAfterHours: null } }))).toEqual([36, 12, 0, 0])
  })
  test('limits with a cap: the minutes over the daily and the weekly limit are not paid, from the end of the day, and say so', () => {
    const cap = { dailyHours: 10, weeklyHours: 45, mode: 'warn' as const, capPayable: true }
    const r = classifyWeek([seg('a', '2026-11-02', 12)], OVERTIME_RULES.california, null, { limits: cap })
    expect(sums(r)).toEqual([8, 2, 0, 2])
    expect(r[0].reasons.join(' ')).toContain('daily limit of 10 h: not paid')
    const w = classifyWeek(WEEK.slice(0, 6).map((d, i) => seg(`s${i}`, d, 8)), OVERTIME_RULES.federal, null, { limits: cap })
    expect(sums(w)).toEqual([40, 5, 0, 3])
    // without the cap the hours are paid and only warned about (the warning is the pay run's)
    expect(sums(classifyWeek([seg('a', '2026-11-02', 12)], OVERTIME_RULES.california, null, { limits: { ...cap, capPayable: false } }))).toEqual([8, 4, 0, 0])
  })
  test('every minute carries a reason, and the minutes add up', () => {
    const r = classifyWeek([seg('a', '2026-11-03', 13, { holiday: true })], OVERTIME_RULES.california)
    expect(r[0].reasons).toEqual(expect.arrayContaining([expect.stringContaining('Over 8 h in the day: 4.00 h overtime (Cal. Labor Code §510(a)'), expect.stringContaining('Over 12 h in the day: 1.00 h double time'), expect.stringContaining('Holiday')]))
    expect(r.every((x) => x.regular + x.overtime + x.doubleTime + x.unpaid === x.minutes)).toBe(true)
  })
  test('an overnight visit is split at the agency\'s midnight when the agency says so, each part dated its own day', () => {
    // 22:00–02:00 Chicago on 2 Nov (CST): 04:00–08:00 UTC on 3 Nov
    const v: any = { id: 'n', caregiverId: 'g', clientId: 'a', shiftDate: '2026-11-02', minutes: 240, actualStart: '2026-11-03T04:00:00', actualEnd: '2026-11-03T08:00:00', scheduledStart: null, scheduledEnd: null }
    const split = buildSegments([v], null, { tz: 'America/Chicago', splitMidnight: true })
    expect(split.map((s) => [s.id, s.date, s.minutes])).toEqual([['n', '2026-11-02', 120], ['n:2', '2026-11-03', 120]])
    expect(buildSegments([v], null, { tz: 'America/Chicago', splitMidnight: false }).map((s) => [s.date, s.minutes])).toEqual([['2026-11-02', 240]])
    expect(new Date(midnightUtc('2026-11-03', 'America/Chicago')).toISOString()).toBe('2026-11-03T06:00:00.000Z')
    // split, a 13-hour day becomes two days under 8: no daily overtime
    const long: any = { ...v, minutes: 780, actualStart: '2026-11-02T22:00:00', actualEnd: '2026-11-03T11:00:00' }
    expect(sums(classifyWeek(buildSegments([long], null, { tz: 'America/Chicago', splitMidnight: true }), OVERTIME_RULES.california))).toEqual([13, 0, 0, 0])
    expect(sums(classifyWeek(buildSegments([long], null, {}), OVERTIME_RULES.california))).toEqual([8, 4, 1, 0])
  })
  test('meal and rest premiums (Labor Code §512, §226.7): owed only when the break was owed and not taken or waived', () => {
    const d = (minutes: number, over: any = {}) => [{ minutes, mealBreakMinutes: null, mealWaived: false, restBreakMissed: false, isSleepover: false, ...over }]
    expect(breakPremiumsForDay(d(300))).toEqual({ meal: 0, rest: 0 })
    expect(breakPremiumsForDay(d(360))).toEqual({ meal: 1, rest: 0 })
    expect(breakPremiumsForDay(d(360, { mealBreakMinutes: 30 }))).toEqual({ meal: 0, rest: 0 })
    expect(breakPremiumsForDay(d(360, { mealBreakMinutes: 20 }))).toEqual({ meal: 1, rest: 0 })
    expect(breakPremiumsForDay(d(360, { mealWaived: true }))).toEqual({ meal: 0, rest: 0 })
    expect(breakPremiumsForDay(d(420, { mealWaived: true }))).toEqual({ meal: 1, rest: 0 })
    expect(breakPremiumsForDay(d(660, { mealBreakMinutes: 30 }))).toEqual({ meal: 1, rest: 0 })
    expect(breakPremiumsForDay(d(660, { mealBreakMinutes: 30, mealWaived: true }))).toEqual({ meal: 0, rest: 0 })
    expect(breakPremiumsForDay(d(780, { mealBreakMinutes: 30, mealWaived: true }))).toEqual({ meal: 1, rest: 0 })
    expect(breakPremiumsForDay(d(240, { restBreakMissed: true }))).toEqual({ meal: 0, rest: 1 })
  })
  test('the settings are checked in words', () => {
    expect((sanitizeRules({ state: 'XX' }) as any).code).toBe('bad_state')
    expect((sanitizeRules({ state: 'nv' }) as any).rules).toMatchObject({ state: 'NV', overtimeRule: 'nevada' })
    expect((sanitizeRules({ state: 'CA', overtimeRule: 'california_personal_attendant' }) as any).rules.overtimeRule).toBe('california_personal_attendant')
    expect((sanitizeRules({ holidays: [{ date: '2026-12-25' }, { date: '2026-12-25' }] }) as any).code).toBe('bad_holiday')
    expect((sanitizeRules({ holidays: [{ date: '2026-12-25', multiplier: 9 }] }) as any).code).toBe('bad_holiday')
    expect((sanitizeRules({ limits: { mode: 'block' } }) as any).code).toBe('bad_limits')
    expect((sanitizeRules({ facility: { weeklyHours: 0 } }) as any).code).toBe('bad_facility')
    expect((sanitizeRules({ sleepoverCents: 12.5 }) as any).code).toBe('bad_sleepover')
    expect((sanitizeRules({ travel: { roundToMinutes: 7 } }) as any).code).toBe('bad_travel')
  })
})

describe('row 19 — the pay run', () => {
  beforeAll(async () => {
    t = await bootTenant({ vertical: 'homecare' })
    const seeded = await seedOwner(t)
    companyId = seeded.company.id
    await t.db.update(t.schema.company).set({ timezone: 'America/Chicago', state: 'CA' } as any).where(eq(t.schema.company.id, companyId))
    tokens.owner = await login('owner@test.example', seeded.password)
    const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
    ids.ann = (await ins(t.schema.user, { email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'caregiver', companyId, defaultPayRate: '20.00' })).id
    tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
    ids.a = (await ins(t.schema.clients, { companyId, firstName: 'Alma', lastName: 'Able', isActive: true, isPrivatePay: true, privatePayRate: '40.00', privatePayRateType: 'hourly' })).id
    ids.b = (await ins(t.schema.clients, { companyId, firstName: 'Ben', lastName: 'Baker', isActive: true, isPrivatePay: true, privatePayRate: '30.00', privatePayRateType: 'hourly' })).id
    // Ben's visits are a "Skilled" care type Ann is paid $30 for
    ids.skilled = (await ins(t.schema.careTypes, { companyId, name: 'Skilled', hourlyRate: '45.00' })).id
    ids.benSchedule = (await ins(t.schema.schedules, { companyId, clientId: ids.b, caregiverId: ids.ann, careTypeId: ids.skilled, frequency: 'weekly', scheduleType: 'recurring', dayOfWeek: 3 })).id
    await ins(t.schema.caregiverCareTypeRates, { companyId, caregiverId: ids.ann, careTypeId: ids.skilled, hourlyRate: '30.00' })
    const review = (clientId: string, shiftDate: string, start: string, end: string, minutes: number, extra: any = {}) =>
      ins(t.schema.payrollShiftReviews, { companyId, payPeriodStart: '2026-11-01', payPeriodEnd: '2026-11-07', caregiverId: ids.ann, clientId, shiftDate, payableMinutes: minutes, status: 'verified', actualStart: new Date(`${shiftDate}T${start}:00Z`), actualEnd: new Date(`${shiftDate}T${end}:00Z`), ...extra })
    ids.mon = (await review(ids.a, '2026-11-02', '08:00', '18:00', 600)).id   // Mon 10 h
    ids.tue = (await review(ids.a, '2026-11-03', '06:00', '19:00', 780)).id   // Tue 13 h
    ids.wedA = (await review(ids.a, '2026-11-04', '09:00', '11:00', 120)).id  // Wed 2 h at Alma
    ids.wedB = (await review(ids.b, '2026-11-04', '11:30', '14:30', 180, { scheduleId: ids.benSchedule })).id  // then 3 h at Ben (Skilled, $30)
    await setFeatures([...BASE, 'care_payroll_rules'])
  }, 90_000)

  test('picking the state picks its rule; the reply lists every state and cites each rule', async () => {
    const saved = await send('owner', 'PUT', '/api/pay-rules', { state: 'NV' })
    expect(saved.status).toBe(200)
    expect(saved.body.rules).toMatchObject({ state: 'NV', overtimeRule: 'nevada' })
    const got = await send('owner', 'GET', '/api/pay-rules')
    expect(got.body.states.length).toBe(51)
    expect(got.body.overtimeRules.find((r: any) => r.id === 'nevada').cite).toContain('NRS 608.018')
    // Ann earns $20, over Nevada's $18 line: the week alone, so 28 hours are regular
    expect(await calc()).toMatchObject({ regularHours: 28, overtimeHours: 0, ruleId: 'nevada' })
    await t.db.update(t.schema.user).set({ defaultPayRate: '17.00' } as any).where(eq(t.schema.user.id, ids.ann))
    const low = await calc()
    expect(low).toMatchObject({ overtimeHours: 7 }) // Mon 2 + Tue 5 over 8 — the Wed Skilled visit is at $30, above the line
    await t.db.update(t.schema.user).set({ defaultPayRate: '20.00' } as any).where(eq(t.schema.user.id, ids.ann))
  })

  test('california with a care-type rate: the overtime premium is on the blended regular rate (29 CFR 778.115) and every hour says why', async () => {
    await send('owner', 'PUT', '/api/pay-rules', { state: 'CA' })
    const line = await calc()
    // 25 h at $20 + 3 h at $30 = $590 straight for 28 h → blended $21.07
    expect(line.blendedRate).toBe(21.07)
    expect(line).toMatchObject({ regularHours: 21, overtimeHours: 6, doubleTimeHours: 1, ruleId: 'california' })
    const ben = line.hours.find((h: any) => h.reviewId === ids.wedB)
    expect(ben).toMatchObject({ rateCents: 3000, regularMinutes: 180 })
    // OT: 6 h × ($20 + $21.07/2) = 6 × 30.535 → in whole cents per minute: 360 × 2000/60 + 360 × 1054/60
    expect(line.overtimePay).toBe(Math.round((360 * 2000) / 60 + (360 * 1054) / 60) / 100)
    expect(line.doubleTimePay).toBe(Math.round((60 * 2000) / 60 + (60 * 2107) / 60) / 100)
    expect(line.regularPay).toBe(450)
    expect(line.hours.reduce((s: number, h: any) => s + h.payCents, 0) / 100).toBe(Math.round((line.regularPay + line.overtimePay + line.doubleTimePay) * 100) / 100)
    expect(line.hours.find((h: any) => h.reviewId === ids.tue).reasons.join(' ')).toContain('Cal. Labor Code §510(a)')
    const csv = await send('owner', 'POST', '/api/payroll/export', { startDate: '2026-11-01', endDate: '2026-11-07' })
    const total = csv.text.trim().split('\n').slice(1).reduce((s, l) => s + Number(l.split(',').pop()), 0)
    expect(Math.round(total * 100) / 100).toBe(line.wagesPay)
  })

  test('holiday pay: a premium at the agency\'s multiplier, credited against overtime on the same hours (29 CFR 778.203)', async () => {
    await send('owner', 'PUT', '/api/pay-rules', { holidays: [{ date: '2026-11-02', label: 'Agency day', multiplier: 1.5 }] })
    const line = await calc()
    // Mon 10 h: 8 regular × $20 × 0.5 = $80; the 2 overtime hours already carry 1.5× — nothing more
    expect(line).toMatchObject({ holidayHours: 8, holidayPremiumPay: 80, holidayExtraPay: 0 })
    expect(line.grossPay).toBe(Math.round((line.regularPay + line.overtimePay + line.doubleTimePay + 80) * 100) / 100)
    await send('owner', 'PUT', '/api/pay-rules', { holidays: [{ date: '2026-11-02', label: 'Agency day', multiplier: 2 }] })
    // at 2×: 8 × $20 × 1 = $160, plus the 2 overtime hours' extra half ($20 × 0.5 × 2 = $20)
    expect(await calc()).toMatchObject({ holidayPremiumPay: 180, holidayExtraPay: 20 })
    expect((await send('owner', 'PUT', '/api/pay-rules', { holidays: [{ date: 'yesterday' }] })).body.code).toBe('bad_holiday')
    await send('owner', 'PUT', '/api/pay-rules', { holidays: [] })
  })

  test('meal and rest premiums from the break marks on the reviews; one hour at the regular rate each, when switched on', async () => {
    expect((await calc()).breakPremiumPay).toBe(0)
    await send('owner', 'PUT', '/api/pay-rules', { breakPremiums: true })
    // Mon 10 h and Tue 13 h with no meal recorded: two meal premiums
    expect(await calc()).toMatchObject({ mealPremiums: 2, restPremiums: 0, breakPremiumPay: 2 * 21.07 })
    expect((await send('ann', 'PATCH', `/api/payroll-shift-reviews/shifts/${ids.mon}`, { mealBreakMinutes: 30 })).status).toBe(403)
    expect((await send('owner', 'PATCH', `/api/payroll-shift-reviews/shifts/${ids.mon}`, { mealBreakMinutes: 30, restBreakMissed: true })).status).toBe(200)
    expect(await calc()).toMatchObject({ mealPremiums: 1, restPremiums: 1 })
    expect((await send('owner', 'PATCH', `/api/payroll-shift-reviews/shifts/${ids.mon}`, { mealBreakMinutes: 999 })).body.code).toBe('bad_break')
    await send('owner', 'PUT', '/api/pay-rules', { breakPremiums: false })
    await send('owner', 'PATCH', `/api/payroll-shift-reviews/shifts/${ids.mon}`, { mealBreakMinutes: null, restBreakMissed: false })
  })

  test('a sleepover is paid its awake minutes plus the flat amount, and counts as a worked day', async () => {
    const sl = await ins(t.schema.payrollShiftReviews, { companyId, payPeriodStart: '2026-11-01', payPeriodEnd: '2026-11-07', caregiverId: ids.ann, clientId: ids.a, shiftDate: '2026-11-05', payableMinutes: 0, status: 'verified', isSleepover: true })
    await send('owner', 'PUT', '/api/pay-rules', { sleepoverCents: 5000 })
    const line = await calc()
    expect(line).toMatchObject({ sleepovers: 1, sleepoverPay: 50, shifts: 5 })
    expect(line.hours.find((h: any) => h.reviewId === sl.id)).toMatchObject({ minutes: 0, sleepover: true })
    await send('owner', 'PATCH', `/api/payroll-shift-reviews/shifts/${sl.id}`, { payableMinutes: 120 })
    expect(await calc()).toMatchObject({ sleepoverPay: 50, totalHours: 30 })
    await t.db.delete(t.schema.payrollShiftReviews).where(eq(t.schema.payrollShiftReviews.id, sl.id))
    await send('owner', 'PUT', '/api/pay-rules', { sleepoverCents: 0 })
  })

  test('a service left out of overtime (the care type\'s switch) changes the day', async () => {
    await send('owner', 'PUT', '/api/pay-rules', { holidays: [], state: 'CA' })
    // make Wed long: Ben's Skilled visit 9 h after Alma's 2 h → 11 h day: 8 regular, 3 overtime
    await t.db.update(t.schema.payrollShiftReviews).set({ payableMinutes: 540 } as any).where(eq(t.schema.payrollShiftReviews.id, ids.wedB))
    expect(await calc('2026-11-04', '2026-11-04')).toMatchObject({ regularHours: 8, overtimeHours: 3 })
    expect((await send('owner', 'PUT', `/api/care-types/${ids.skilled}`, { excludeFromOvertime: true })).status).toBe(200)
    const line = await calc('2026-11-04', '2026-11-04')
    expect(line).toMatchObject({ regularHours: 11, overtimeHours: 0 })
    expect(line.hours.find((h: any) => h.reviewId === ids.wedB).reasons[0]).toContain('left out of overtime')
    await send('owner', 'PUT', `/api/care-types/${ids.skilled}`, { excludeFromOvertime: false })
    await t.db.update(t.schema.payrollShiftReviews).set({ payableMinutes: 180 } as any).where(eq(t.schema.payrollShiftReviews.id, ids.wedB))
  })

  test('facility staff are paid under the facility thresholds; only the office sets the flag', async () => {
    expect((await send('ann', 'PUT', `/api/pay-rules/caregiver/${ids.ann}/pay-profile`, { isFacilityStaff: true })).status).toBe(403)
    await send('owner', 'PUT', '/api/pay-rules', { facility: { weeklyHours: 40, dailyOtAfterHours: 8 } })
    expect((await send('owner', 'PUT', `/api/pay-rules/caregiver/${ids.ann}/pay-profile`, { isFacilityStaff: true })).status).toBe(200)
    // Tue 13 h: 8 + 5 overtime and no double time; the 7th-day rule is off
    expect(await calc()).toMatchObject({ ruleId: 'facility', overtimeHours: 7, doubleTimeHours: 0 })
    await send('owner', 'PUT', `/api/pay-rules/caregiver/${ids.ann}/pay-profile`, { isFacilityStaff: false })
    expect(await calc()).toMatchObject({ ruleId: 'california', doubleTimeHours: 1 })
  })

  test('limits: warn lists the days over; block holds the approval and the files; the cap leaves the hours over unpaid', async () => {
    await send('owner', 'PUT', '/api/pay-rules', { limits: { dailyHours: 10, weeklyHours: 27, mode: 'warn', capPayable: false } })
    let line = await calc()
    expect(line.limitWarnings).toEqual([expect.stringContaining('2026-11-03: 13 h, over the daily limit of 10 h'), expect.stringContaining('over the weekly limit of 27 h')])
    expect(line).toMatchObject({ limitBlocked: false, cappedHours: 0, totalHours: 28 })
    await send('owner', 'PUT', '/api/pay-rules', { limits: { mode: 'block' } })
    expect((await send('owner', 'PUT', `/api/payroll/${ids.ann}/approve`, { startDate: '2026-11-01', endDate: '2026-11-07' })).body.code).toBe('over_limit')
    expect((await send('owner', 'GET', '/api/pay-rules/export/excel?startDate=2026-11-01&endDate=2026-11-07')).body.code).toBe('over_limit')
    await send('owner', 'PUT', '/api/pay-rules', { limits: { mode: 'warn', capPayable: true } })
    line = await calc()
    // Tue: 3 h over 10 unpaid → 25 h left; the week's 27 h cap takes nothing more off the days in range... 25 ≤ 27
    expect(line).toMatchObject({ cappedHours: 3, totalHours: 25 })
    expect(line.hours.find((h: any) => h.reviewId === ids.tue)).toMatchObject({ unpaidMinutes: 180 })
    await send('owner', 'PUT', '/api/pay-rules', { limits: { mode: 'off', capPayable: false, dailyHours: null, weeklyHours: null } })
  })

  test('the audit trail: live for any period, stored when the period is approved, read back with its reasons', async () => {
    const live = await send('owner', 'GET', `/api/pay-rules/audit?caregiverId=${ids.ann}&startDate=2026-11-01&endDate=2026-11-07`)
    expect(live.status).toBe(200)
    expect(live.body.live.length).toBe(4)
    expect(live.body.stored).toEqual([])
    expect(live.body.ruleLabel).toContain('California')
    const ok = await send('owner', 'PUT', `/api/payroll/${ids.ann}/approve`, { startDate: '2026-11-01', endDate: '2026-11-07' })
    expect(ok.status).toBe(200)
    const after = await send('owner', 'GET', `/api/pay-rules/audit?caregiverId=${ids.ann}&startDate=2026-11-01&endDate=2026-11-07`)
    expect(after.body.stored.length).toBe(4)
    expect(after.body.stored.find((r: any) => r.reviewId === ids.tue)).toMatchObject({ regularMinutes: 480, overtimeMinutes: 240, doubleTimeMinutes: 60, ruleId: 'california', rateCents: 2000 })
    expect(after.body.stored.find((r: any) => r.reviewId === ids.tue).reasons.join(' ')).toContain('§510')
    expect((await send('ann', 'GET', `/api/pay-rules/audit?caregiverId=${ids.ann}&startDate=2026-11-01&endDate=2026-11-07`)).status).toBe(403)
  })

  test('the overnight split is an agency setting the pay run honours', async () => {
    // Thu 22:00–02:00 Chicago (04:00–08:00 UTC Friday): one 4-hour visit dated Thursday
    const n = await ins(t.schema.payrollShiftReviews, { companyId, payPeriodStart: '2026-11-01', payPeriodEnd: '2026-11-07', caregiverId: ids.ann, clientId: ids.a, shiftDate: '2026-11-05', payableMinutes: 240, status: 'verified', actualStart: new Date('2026-11-06T04:00:00Z'), actualEnd: new Date('2026-11-06T08:00:00Z') })
    const whole = await calc('2026-11-05', '2026-11-05')
    expect(whole).toMatchObject({ totalHours: 4 })
    await send('owner', 'PUT', '/api/pay-rules', { splitOvernightAtMidnight: true })
    expect(await calc('2026-11-05', '2026-11-05')).toMatchObject({ totalHours: 2 })
    expect(await calc('2026-11-06', '2026-11-06')).toMatchObject({ totalHours: 2 })
    expect((await calc('2026-11-05', '2026-11-06')).hours.map((h: any) => [h.date, h.minutes])).toEqual([['2026-11-05', 120], ['2026-11-06', 120]])
    await send('owner', 'PUT', '/api/pay-rules', { splitOvernightAtMidnight: false })
    await t.db.delete(t.schema.payrollShiftReviews).where(eq(t.schema.payrollShiftReviews.id, n.id))
  })

  test('without the feature the pay-detail marks on a review are refused and the pay run is the weekly rule', async () => {
    await setFeatures(BASE)
    expect((await send('owner', 'PATCH', `/api/payroll-shift-reviews/shifts/${ids.mon}`, { isSleepover: true })).body.code).toBe('feature_off')
    expect(await calc()).toMatchObject({ regularHours: 28, overtimeHours: 0 })
    await setFeatures([...BASE, 'care_payroll_rules'])
  })
})

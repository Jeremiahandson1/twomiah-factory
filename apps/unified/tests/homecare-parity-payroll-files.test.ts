// Home care parity row 21 (docs/parity/homecare-payroll.md): payroll files and providers — the detailed Excel file (35 columns), the
// 11-column home care ADP layout with HOL / MIL / EXP rows and the ClickTime variant, mileage as its own earnings code in the ADP and
// Paychex files, Paychex's override columns M–Q, check template, version header and [Pay] line, the Gusto workweeks column, live pushes
// to ADP, Paychex and Gusto built up to the sandbox step, and full-service payroll up to the embedded partner's agreement step.
// Behind care_payroll_rules (files) and care_payroll_providers (pushes).
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { unzipStored, xlsx } from '../server/crm/payrollExport/xlsx.ts'
import { providerTransport, OWNER_STEPS } from '../server/crm/homecare/core/payrollProviders.ts'
import { gustoHoursCsv } from '../server/crm/payrollExport/gustoHours.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const send = async (who: string, method: string, path: string, body?: any) => {
  const r = await t.call(path, { method, headers: { Authorization: `Bearer ${tokens[who]}` }, ...(body !== undefined ? { json: body } : {}) })
  const buf = new Uint8Array(await r.arrayBuffer())
  const text = new TextDecoder().decode(buf)
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch { /* a file */ }
  return { status: r.status, body: parsed, text, buf, headers: r.headers }
}
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const BASE = ['contacts', 'scheduling', 'team']
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const RANGE = 'startDate=2026-11-01&endDate=2026-11-07'
const files = (patch: any) => send('owner', 'PUT', '/api/pay-rules', { files: patch })
const originalFetch = providerTransport.fetch
const calls: Array<{ url: string; method: string; body: any }> = []
let answer: (url: string, init: any) => Response = () => new Response('{}', { status: 200 })

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-for-payroll-providers'
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  ids.owner = seeded.owner.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago', mileageRate: '0.67' } as any).where(eq(t.schema.company.id, companyId))
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  ids.ann = (await ins(t.schema.user, { email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'caregiver', companyId, defaultPayRate: '20.00' })).id
  tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
  ids.a = (await ins(t.schema.clients, { companyId, firstName: 'Alma', lastName: 'Able', isActive: true })).id
  ids.b = (await ins(t.schema.clients, { companyId, firstName: 'Ben', lastName: 'Baker', isActive: true })).id
  const review = (clientId: string, shiftDate: string, start: string, end: string, minutes: number) =>
    ins(t.schema.payrollShiftReviews, { companyId, payPeriodStart: '2026-11-01', payPeriodEnd: '2026-11-07', caregiverId: ids.ann, clientId, shiftDate, payableMinutes: minutes, status: 'verified', scheduledStart: start + ':00', scheduledEnd: end + ':00', scheduledMinutes: minutes, actualMinutes: minutes, actualStart: new Date(`${shiftDate}T${start}:00Z`), actualEnd: new Date(`${shiftDate}T${end}:00Z`) })
  await review(ids.a, '2026-11-02', '08:00', '18:00', 600)   // Mon 10 h, the agency's holiday
  await review(ids.a, '2026-11-03', '06:00', '19:00', 780)   // Tue 13 h
  await review(ids.a, '2026-11-04', '09:00', '11:00', 120)   // Wed 2 h at Alma
  ids.wedB = (await review(ids.b, '2026-11-04', '11:30', '14:30', 180)).id  // then 3 h at Ben
  await ins(t.schema.mileageEntries, { companyId, caregiverId: ids.ann, date: '2026-11-04', miles: '6.00', ratePerMile: '0.670', amount: '4.02', kind: 'travel' })
  await ins(t.schema.expenses, { companyId, userId: ids.ann, category: 'supplies', description: 'Gloves', amount: '12.50', date: '2026-11-03', status: 'approved' })
  await setFeatures([...BASE, 'care_payroll_rules'])
  await send('owner', 'PUT', '/api/pay-rules', { state: 'CA', holidays: [{ date: '2026-11-02', label: 'Agency day', multiplier: 1.5 }] })
  await send('owner', 'PUT', `/api/pay-rules/caregiver/${ids.ann}/worker-id`, { payrollWorkerId: 'EMP0001' })
  providerTransport.fetch = async (url, init) => { let body: any = null; try { body = init?.body ? JSON.parse(init.body) : null } catch { body = init?.body }; calls.push({ url, method: init?.method ?? 'GET', body }); return answer(url, init) }
}, 90_000)
afterAll(() => { providerTransport.fetch = originalFetch })

// The week: 21 regular (8 of them on the holiday), 6 overtime, 1 double time; $4.02 of mileage; $12.50 of approved expenses.
describe('row 21 — the files', () => {
  test('the detailed Excel file: a real .xlsx, 35 columns, one row per visit segment and a totals row per caregiver', async () => {
    const r = await send('owner', 'GET', `/api/pay-rules/export/excel?${RANGE}`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('spreadsheetml')
    expect(r.headers.get('content-disposition')).toContain('payroll_detail_2026-11-01_2026-11-07.xlsx')
    const parts = unzipStored(r.buf)
    expect([...parts.keys()]).toEqual(expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']))
    const sheet = parts.get('xl/worksheets/sheet1.xml')!
    const rows = sheet.match(/<row /g)!.length
    expect(rows).toBe(1 + 4 + 1)
    const headerCells = sheet.slice(sheet.indexOf('<row r="1">'), sheet.indexOf('</row>')).match(/<c /g)!.length
    expect(headerCells).toBe(35)
    for (const h of ['Blended regular rate (week)', 'How it was classified', 'Meal break minutes', 'Travel miles', 'Period mileage']) expect(sheet).toContain(h)
    expect(sheet).toContain('Ben Baker')
    expect(sheet).toContain('Over 8 h in the day: 4.00 h overtime')
    expect(sheet).toContain('PERIOD TOTAL')
    expect(sheet).toContain('Holiday premium $80.00')
    expect((await send('ann', 'GET', `/api/pay-rules/export/excel?${RANGE}`)).status).toBe(403)
    // a cell that starts with = is text, never a formula
    expect(unzipStored(xlsx('x', [['=1+1']])).get('xl/worksheets/sheet1.xml')).toContain('<t xml:space="preserve">=1+1</t>')
  })

  test('ADP Workforce Now: refused until each code the week needs is set, then holiday hours and mileage ride under their own codes', async () => {
    await files({ adpCompanyCode: 'ABC', adpLayout: 'workforce_now' })
    expect((await send('owner', 'GET', `/api/pay-rules/export/adp?${RANGE}`)).body.code).toBe('adp_double_time_code')
    await files({ adpDoubleTimeCode: 'DBL' })
    expect((await send('owner', 'GET', `/api/pay-rules/export/adp?${RANGE}`)).body.code).toBe('adp_holiday_code')
    await files({ adpHolidayCode: 'HOL' })
    expect((await send('owner', 'GET', `/api/pay-rules/export/adp?${RANGE}`)).body.code).toBe('adp_mileage_code')
    await files({ adpMileageCode: 'MIL' })
    expect((await send('owner', 'GET', `/api/pay-rules/export/adp?${RANGE}`)).body.code).toBe('adp_other_pay_code')
    await files({ adpOtherPayCode: 'OTH' })
    const file = await send('owner', 'GET', `/api/pay-rules/export/adp?${RANGE}`)
    expect(file.status).toBe(200)
    expect(file.headers.get('content-disposition')).toContain('filename="EPIABC01.csv"')
    expect(file.text.split('\n')).toEqual([
      'Co Code,Batch ID,File #,Temp Dept,Temp Rate,Reg Hours,O/T Hours,Hours 3 Code,Hours 3 Amount,Hours 4 Code,Hours 4 Amount,Earnings 3 Code,Earnings 3 Amount,Earnings 5 Code,Earnings 5 Amount',
      'ABC,261107,"EMP0001",,,13.00,6.00,"DBL",1.00,"HOL",8.00,"MIL",4.02,"OTH",12.50',
    ])
  })

  test('the 11-column home care ADP layout: a main row, then HOL, MIL and EXP rows (and one for double time)', async () => {
    await files({ adpLayout: 'homecare', adpBatchName: 'Batch A', adpDepartmentCode: 'D1' })
    const file = await send('owner', 'GET', `/api/pay-rules/export/adp?${RANGE}`)
    expect(file.status).toBe(200)
    expect(file.text.split('\n')).toEqual([
      'Company Code,Batch Name,Payroll File Number,Regular Hours,Overtime Hours,Department Code,Pay Rate,Expense Code,Expense Amount,Shift Code,Holiday Hours or Mileage Units',
      'ABC,"Batch A","EMP0001",13.00,6.00,D1,20.00,,,,',
      'ABC,"Batch A","EMP0001",,,D1,20.00,,,"DBL",1.00',
      'ABC,"Batch A","EMP0001",,,D1,20.00,,,HOL,8.00',
      'ABC,"Batch A","EMP0001",,,D1,0.670,,,MIL,6.00',
      'ABC,"Batch A","EMP0001",,,D1,,EXP,12.50,,',
    ])
  })

  test('the ClickTime variant: the employee name in place of the department, regular hours include overtime, O/T left empty', async () => {
    await files({ adpLayout: 'clicktime' })
    const file = await send('owner', 'GET', `/api/pay-rules/export/adp?${RANGE}`)
    expect(file.text.split('\n')[0]).toStartWith('Company Code,Batch ID,File Number,Employee Name,Temp Rate,Reg Hours,O/T Hours,Hours 3 Code')
    expect(file.text.split('\n')[1]).toStartWith('ABC,261107,"EMP0001","Carer, Ann",,19.00,,"DBL",1.00,"HOL",8.00,"MIL",4.02')
    expect((await files({ adpLayout: 'excel' })).body.code).toBe('bad_files')
  })

  test('Paychex: holiday and mileage components (miles as units, dollars as the amount), then the check template turns on the version header, M–Q and [Pay]', async () => {
    await files({ paychexClientId: 'CLIENT01', paychexComponents: { doubleTime: 'Dbl Time', mileage: 'Mileage NT' } })
    const plain = await send('owner', 'GET', `/api/pay-rules/export/paychex?${RANGE}`)
    expect(plain.status).toBe(200)
    expect(plain.text.split('\n')).toEqual([
      'CLIENT01,EMP0001,,,Hourly,,,13.00,,11/07/2026,,',
      'CLIENT01,EMP0001,,,Overtime,,,6.00,,11/07/2026,,',
      'CLIENT01,EMP0001,,,Dbl Time,,,1.00,,11/07/2026,,',
      'CLIENT01,EMP0001,,,Holiday,,,8.00,,11/07/2026,,',
      'CLIENT01,EMP0001,,,Mileage NT,,,,6.00,11/07/2026,4.02,',
      'CLIENT01,EMP0001,,,Other Pay,,,,,11/07/2026,12.50,',
    ])
    await files({ paychexCheckTemplate: 'Standard', paychexOverrides: { state: 'CA', laborAssignment: 'HOME' } })
    const withTemplate = await send('owner', 'GET', `/api/pay-rules/export/paychex?${RANGE}`)
    const lines = withTemplate.text.split('\n')
    expect(lines[0]).toBe('2' + ','.repeat(16))
    expect(lines[1]).toBe('CLIENT01,EMP0001,,,Hourly,,,13.00,,11/07/2026,,,CA,,,HOME,"Standard"')
    expect(lines.at(-1)).toBe('CLIENT01,EMP0001,,,[Pay],,,,,11/07/2026,,,CA,,,HOME,"Standard"')
    expect(lines.every((l) => l.split(',').length === 17)).toBe(true)
    await files({ paychexCheckTemplate: null, paychexOverrides: { state: null, laborAssignment: null } })
  })

  test('Gusto: a Workweeks column (date range, hours, earnings), Holiday Hours and Reimbursement; the workweeks column is a setting', async () => {
    const csv = await send('owner', 'GET', `/api/gusto/export-csv?${RANGE}`)
    expect(csv.status).toBe(200)
    const [header, row] = csv.text.split('\n')
    expect(header).toBe('First Name,Last Name,Email,Regular Hours,Overtime Hours,Total Hours,Double Overtime Hours,Holiday Hours,Reimbursement,Workweeks')
    expect(row).toBe('"Ann","Carer","ann@test.example",13.00,6.00,28.00,1.00,8.00,4.02,"11/01/2026-11/07/2026: 28.00 hours, $640.00"')
    await files({ gustoWorkweeks: false })
    expect((await send('owner', 'GET', `/api/gusto/export-csv?${RANGE}`)).text.split('\n')[0]).not.toContain('Workweeks')
    await files({ gustoWorkweeks: true })
    expect(gustoHoursCsv([{ firstName: 'A', lastName: 'B', email: null, regularHours: 1, overtimeHours: 0, totalHours: 1 }], { workweeks: true }).split('\n')[0]).not.toContain('Workweeks')
  })

  test('a pickup bonus rides under the bonus code in each file; without one the ADP file is refused rather than underpay', async () => {
    await setFeatures([...BASE, 'care_payroll_rules', 'care_pickup_rewards'])
    const shift = await ins(t.schema.openShifts, { companyId, clientId: ids.b, date: '2026-11-04', startTime: '11:30:00', endTime: '14:30:00', status: 'filled', bonusAmount: '25.00', claimedById: ids.ann, createdById: ids.owner })
    await ins(t.schema.openShiftPickup, { companyId, openShiftId: shift.id, caregiverId: ids.ann, clientId: ids.b, shiftDate: '2026-11-04', bonusCents: 2500 })
    await files({ adpLayout: 'workforce_now' })
    expect((await send('owner', 'GET', `/api/pay-rules/export/adp?${RANGE}`)).body.code).toBe('pickup_bonus_not_in_file')
    await files({ adpBonusCode: 'BON' })
    const adp = await send('owner', 'GET', `/api/pay-rules/export/adp?${RANGE}`)
    expect(adp.text.split('\n')[0]).toContain('Earnings 4 Code,Earnings 4 Amount')
    expect(adp.text.split('\n')[1]).toContain('"BON",25.00')
    await files({ adpLayout: 'homecare' })
    expect((await send('owner', 'GET', `/api/pay-rules/export/adp?${RANGE}`)).body.code).toBe('adp_layout_no_amounts')
    expect((await send('owner', 'GET', `/api/pay-rules/export/paychex?${RANGE}`)).text).toContain('CLIENT01,EMP0001,,,Bonus,,,,,11/07/2026,25.00,')
    expect((await send('owner', 'GET', `/api/gusto/export-csv?${RANGE}`)).text.split('\n')[0]).toContain('Bonus')
    await files({ adpLayout: 'workforce_now' })
  })
})

describe('row 21 — live pushes to the providers, up to the account step', () => {
  test('without the feature the paths are closed; with it each provider says it is not connected and names the owner\'s step', async () => {
    expect((await send('owner', 'GET', '/api/payroll-providers')).status).toBe(403)
    await setFeatures([...BASE, 'care_payroll_rules', 'care_pickup_rewards', 'care_payroll_providers'])
    const r = await send('owner', 'GET', '/api/payroll-providers')
    expect(r.status).toBe(200)
    expect(Object.keys(r.body.providers)).toEqual(['adp', 'paychex', 'gusto', 'embedded'])
    expect(r.body.providers.gusto).toMatchObject({ configured: false, ownerStep: OWNER_STEPS.gusto })
    expect(r.body.providers.embedded.ownerStep).toContain('partner agreement')
    const push = await send('owner', 'POST', '/api/payroll-providers/gusto/push', { startDate: '2026-11-01', endDate: '2026-11-07' })
    expect(push.status).toBe(400)
    expect(push.body.code).toBe('provider_not_configured')
    expect(calls.length).toBe(0)
    // the preview shows what would go, with the codes
    const preview = await send('owner', 'GET', `/api/payroll-providers/adp/preview?${RANGE}`)
    expect(preview.body.people).toEqual([expect.objectContaining({ workerId: 'EMP0001', regularHours: 13, overtimeHours: 6, doubleTimeHours: 1, holidayHours: 8, bonusDollars: 25, reimbursementDollars: 4.02, otherPayDollars: 0 })])
    expect((await send('ann', 'POST', '/api/payroll-providers/gusto/push', { startDate: '2026-11-01', endDate: '2026-11-07' })).status).toBe(403)
  })

  test('the config is saved with its secrets encrypted and read back masked', async () => {
    const saved = await send('owner', 'PUT', '/api/payroll-providers/gusto', { accessToken: 'gusto-secret-token-9876', companyUuid: 'co-uuid-1', sandbox: true })
    expect(saved.status).toBe(200)
    expect(saved.body).toMatchObject({ configured: true, fields: { accessToken: '••••9876', companyUuid: 'co-uuid-1', sandbox: true } })
    const [row] = await t.db.select({ settings: t.schema.company.settings }).from(t.schema.company).where(eq(t.schema.company.id, companyId))
    expect(JSON.stringify(row.settings)).not.toContain('gusto-secret-token')
    // a masked value sent back unchanged keeps the secret
    await send('owner', 'PUT', '/api/payroll-providers/gusto', { accessToken: '••••9876', companyUuid: 'co-uuid-1' })
    expect((await send('owner', 'GET', '/api/payroll-providers')).body.providers.gusto.configured).toBe(true)
    expect((await send('owner', 'PUT', '/api/payroll-providers/nope', {})).status).toBe(404)
  })

  test('Gusto: the hours go to the demo host as employee compensations on the open payroll; the push is recorded', async () => {
    expect((await send('owner', 'POST', '/api/payroll-providers/gusto/push', { startDate: '2026-11-01', endDate: '2026-11-07' })).body.code).toBe('provider_refused')
    await ins(t.schema.gustoEmployeeMap, { companyId, userId: ids.ann, gustoEmployeeId: '1', gustoUuid: 'emp-uuid-ann', isSynced: true })
    calls.length = 0
    answer = (url, init) => {
      if (url.includes('/payrolls?')) return new Response(JSON.stringify([{ payroll_uuid: 'pr-1', version: 'v7', pay_period: { start_date: '2026-11-01', end_date: '2026-11-07' } }]))
      if (init.method === 'PUT') return new Response(JSON.stringify({ payroll_uuid: 'pr-1', version: 'v8' }))
      return new Response('{}')
    }
    const push = await send('owner', 'POST', '/api/payroll-providers/gusto/push', { startDate: '2026-11-01', endDate: '2026-11-07' })
    expect(push.status).toBe(200)
    expect(push.body).toMatchObject({ sent: true, status: 'accepted', people: 1 })
    expect(calls.map((c) => c.method + ' ' + c.url)).toEqual([
      'GET https://api.gusto-demo.com/v1/companies/co-uuid-1/payrolls?start_date=2026-11-01&end_date=2026-11-07&processed=false',
      'PUT https://api.gusto-demo.com/v1/companies/co-uuid-1/payrolls/pr-1',
    ])
    expect(calls[1].body).toMatchObject({ version: 'v7', employee_compensations: [{ employee_uuid: 'emp-uuid-ann', hourly_compensations: [{ name: 'Regular Hours', hours: '13.00' }, { name: 'Overtime', hours: '6.00' }, { name: 'Double overtime', hours: '1.00' }, { name: 'Holiday', hours: '8.00' }], fixed_compensations: [{ name: 'Bonus', amount: '25.00' }, { name: 'Reimbursement', amount: '4.02' }] }] })
    const log = await send('owner', 'GET', '/api/payroll-providers/pushes')
    expect(log.body.data[0]).toMatchObject({ provider: 'gusto', status: 'accepted', people: 1 })
    expect(log.body.data.some((p: any) => p.status === 'failed')).toBe(true)
    // the provider refusing: a 502, and the push recorded as failed
    answer = () => new Response('{"errors":["bad"]}', { status: 422 })
    const refused = await send('owner', 'POST', '/api/payroll-providers/gusto/push', { startDate: '2026-11-01', endDate: '2026-11-07' })
    expect(refused.status).toBe(502)
    expect(refused.body.error).toContain('Gusto has no unprocessed payroll')
  })

  test('full-service (embedded): the same hours, then calculate and, when the agency says so, submit — Gusto files and pays', async () => {
    await send('owner', 'PUT', '/api/payroll-providers/embedded', { partnerToken: 'partner-tok', companyUuid: 'managed-co', sandbox: true, autoSubmit: false })
    calls.length = 0
    answer = (url, init) => url.includes('/payrolls?') ? new Response(JSON.stringify([{ payroll_uuid: 'pr-9', version: 'v1', pay_period: { start_date: '2026-11-01', end_date: '2026-11-07' } }])) : new Response('{}')
    let push = await send('owner', 'POST', '/api/payroll-providers/embedded/push', { startDate: '2026-11-01', endDate: '2026-11-07' })
    expect(push.body.status).toBe('calculated')
    expect(calls.map((c) => c.method + ' ' + c.url.split('/v1/')[1])).toEqual(['GET companies/managed-co/payrolls?start_date=2026-11-01&end_date=2026-11-07&processed=false', 'PUT companies/managed-co/payrolls/pr-9', 'PUT companies/managed-co/payrolls/pr-9/calculate'])
    await send('owner', 'PUT', '/api/payroll-providers/embedded', { autoSubmit: true })
    calls.length = 0
    push = await send('owner', 'POST', '/api/payroll-providers/embedded/push', { startDate: '2026-11-01', endDate: '2026-11-07' })
    expect(push.body.status).toBe('submitted')
    expect(calls.at(-1)!.url).toEndWith('/payrolls/pr-9/submit')
  })

  test('ADP: a client-credentials token from the UAT sandbox, then the pay data input event with the agency\'s codes', async () => {
    await send('owner', 'PUT', '/api/payroll-providers/adp', { clientId: 'adp-client', clientSecret: 'adp-secret', certificatePem: '-----BEGIN CERT-----', privateKeyPem: '-----BEGIN KEY-----', sandbox: true })
    calls.length = 0
    answer = (url) => url.includes('/token') ? new Response(JSON.stringify({ access_token: 'tok-1' })) : new Response(JSON.stringify({ confirmMessage: { confirmMessageID: 'ok' } }))
    const push = await send('owner', 'POST', '/api/payroll-providers/adp/push', { startDate: '2026-11-01', endDate: '2026-11-07' })
    expect(push.status).toBe(200)
    expect(push.body.status).toBe('accepted')
    expect(calls.map((c) => c.method + ' ' + c.url)).toEqual(['POST https://uat-accounts.adp.com/auth/oauth/v2/token', 'POST https://uat-api.adp.com/events/payroll/v1/pay-data-input.modify'])
    const input = calls[1].body.events[0].data.transform.payDataInput
    expect(input).toMatchObject({ payrollGroupCode: { codeValue: 'ABC' }, batchID: '261107' })
    expect(input.payDataInputs[0]).toMatchObject({ payrollFileNumber: 'EMP0001' })
    expect(input.payDataInputs[0].payrollProfilePayDataInput.payDataInputEntries).toEqual([
      { earningCode: { codeValue: 'REG' }, hours: 13 }, { earningCode: { codeValue: 'OT' }, hours: 6 }, { earningCode: { codeValue: 'DBL' }, hours: 1 }, { earningCode: { codeValue: 'HOL' }, hours: 8 },
      { earningCode: { codeValue: 'MIL' }, amount: { amountValue: 4.02, currencyCode: 'USD' } }, { earningCode: { codeValue: 'BON' }, amount: { amountValue: 25, currencyCode: 'USD' } },
    ])
  })

  test('Paychex: a token, the current pay period, then one check per worker with the pay components', async () => {
    await send('owner', 'PUT', '/api/payroll-providers/paychex', { clientId: 'px-client', clientSecret: 'px-secret', companyId: 'PXCO', sandbox: true })
    calls.length = 0
    answer = (url) => url.includes('/token') ? new Response(JSON.stringify({ access_token: 'tok-2' })) : url.includes('/payperiods?') ? new Response(JSON.stringify({ content: [{ payPeriodId: 'pp-1' }] })) : new Response(JSON.stringify({ content: [{ checkId: 'chk-1' }] }), { status: 201 })
    const push = await send('owner', 'POST', '/api/payroll-providers/paychex/push', { startDate: '2026-11-01', endDate: '2026-11-07' })
    expect(push.status).toBe(200)
    expect(calls.map((c) => c.method + ' ' + c.url)).toEqual(['POST https://sandbox.api.paychex.com/auth/oauth/v2/token', 'GET https://sandbox.api.paychex.com/companies/PXCO/payperiods?status=CURRENT', 'POST https://sandbox.api.paychex.com/companies/PXCO/payperiods/pp-1/checks'])
    expect(calls[2].body).toMatchObject({ workerId: 'EMP0001', earnings: [{ name: 'Hourly', hours: 13 }, { name: 'Overtime', hours: 6 }, { name: 'Dbl Time', hours: 1 }, { name: 'Holiday', hours: 8 }, { name: 'Mileage NT', amount: 4.02 }, { name: 'Bonus', amount: 25 }] })
    expect(push.body.response).toMatchObject({ payPeriodId: 'pp-1' })
  })
})

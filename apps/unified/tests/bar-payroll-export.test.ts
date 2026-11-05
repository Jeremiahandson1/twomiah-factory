// Payroll export (restaurant-bar parity #8, bar_payroll_export; Toast Payroll / 7shifts / BevSpot's pay file).
//   · the arithmetic is pure and checked with known numbers: overtime past the venue's threshold in the company's work week, with the
//     week's earlier hours carried into the period, so a pay period that starts mid-week still finds the 40th hour on the right day;
//   · on the real server: a pay period's hours, overtime and tips per person; cash tips already in hand are counted ONCE (the register's
//     own cash tips and the declared ones are shown apart and taken off the paycheck, never added to the tip total twice);
//   · the three files (spreadsheet, Gusto, ADP), the venue's overtime setting, and the gates (feature and permission).
// Neither Gusto nor ADP is reached: the file is a download, and the column names are the best reading of their published pages (docs/parity).
import { describe, test, expect, beforeAll, afterAll, setSystemTime } from 'bun:test'
import { bootFood } from './foodKit.ts'
import { adpCsv, adpFilename, dollars, overtimeAfterRefusal, plainCsv, splitHours, type PayPerson } from '../server/crm/bar/barPayrollMath.ts'
import { gustoHoursCsv } from '../server/crm/payrollExport/gustoHours.ts'
import { FEATURE_MAP } from '@twomiah/tenant-backend'

const TZ = 'America/Chicago'
// Noon in Chicago (CDT, UTC-5) on a given October 2026 day.
const noon = (d: number) => new Date(`2026-10-${String(d).padStart(2, '0')}T17:00:00Z`)

describe('overtime past the weekly threshold (pure)', () => {
  // Sunday-start weeks. Sun 25th 10h, Mon 26th 10h, Tue 27th 10h, Wed 28th 8h, Thu 29th 6h: 44 hours in the week.
  const week = [[25, 10], [26, 10], [27, 10], [28, 8], [29, 6]].map(([d, h]) => ({ date: noon(d), hours: String(h) }))
  test('the whole week: 40 regular and 4 overtime', () => {
    expect(splitHours(week, TZ, 0, 40, '2026-10-25', '2026-10-31')).toEqual({ regularHours: 40, overtimeHours: 4, totalHours: 44 })
  })
  test('a period that starts mid-week still counts the earlier hours toward the 40', () => {
    // Mon..Thu only is 34 hours inside the period; the 10 from Sunday already used part of the 40, so 4 of the 34 are overtime.
    expect(splitHours(week, TZ, 0, 40, '2026-10-26', '2026-10-31')).toEqual({ regularHours: 30, overtimeHours: 4, totalHours: 34 })
    // Not counting Sunday's hours (a naive split of the period alone) would have said 34 regular, 0 overtime.
    expect(splitHours(week.slice(1), TZ, 0, 40, '2026-10-26', '2026-10-31')).toEqual({ regularHours: 34, overtimeHours: 0, totalHours: 34 })
  })
  test('the threshold is the venue\'s: 32 makes 12 overtime, and the work week start moves the weeks', () => {
    expect(splitHours(week, TZ, 0, 32, '2026-10-25', '2026-10-31')).toEqual({ regularHours: 32, overtimeHours: 12, totalHours: 44 })
    // Monday-start weeks: Sunday the 25th belongs to the week before, so Mon..Thu is 34 hours and none is overtime.
    expect(splitHours(week, TZ, 1, 40, '2026-10-26', '2026-10-31')).toEqual({ regularHours: 34, overtimeHours: 0, totalHours: 34 })
  })
  test('an entry that crosses the line is split, and hundredths of an hour are kept', () => {
    const e = [{ date: noon(26), hours: '39.50' }, { date: noon(27), hours: '1.25' }]
    expect(splitHours(e, TZ, 0, 40, '2026-10-25', '2026-10-31')).toEqual({ regularHours: 40, overtimeHours: 0.75, totalHours: 40.75 })
  })
  test('a week still running past the last day of the period is not in this period', () => {
    expect(splitHours(week, TZ, 0, 40, '2026-10-25', '2026-10-27')).toEqual({ regularHours: 30, overtimeHours: 0, totalHours: 30 })
  })
  test('what a venue may set', () => {
    for (const ok of [40, 37.5, 1, 80, '40']) expect(overtimeAfterRefusal(ok)).toBeNull()
    for (const bad of [0, 81, 37.3, 'many', null, '', true]) expect(overtimeAfterRefusal(bad)).not.toBeNull()
  })
})

describe('the three files (pure)', () => {
  const p = (o: Partial<PayPerson>): PayPerson => ({ userId: 'u', name: 'Pat Lee', firstName: 'Pat', lastName: 'Lee', email: 'pat@x.test', regularHours: 30, overtimeHours: 4, totalHours: 34, tipsTotalCents: 2100, cashInHandCents: 1500, paycheckTipsCents: 600, tipOutPaidCents: 0, tipOutReceivedCents: 0, poolShareCents: 2100, adpFileNumber: '1234', ...o })
  test('dollars are written from whole cents', () => {
    expect([dollars(0), dollars(5), dollars(600), dollars(123456), dollars(-1500)]).toEqual(['0.00', '0.05', '6.00', '1234.56', '-15.00'])
  })
  test('the spreadsheet shows every column, and a name can never run as a formula', () => {
    const csv = plainCsv([p({ name: '=cmd|calc' })])
    expect(csv.split('\n')[0]).toBe('Name,Email,Regular Hours,Overtime Hours,Total Hours,Total Tips,Cash Tips Already Received,Tips To Pay On Paycheck,Tipped Out,Tip-Out Received,Pool Share')
    expect(csv.split('\n')[1]).toBe(`"'=cmd|calc","pat@x.test",30.00,4.00,34.00,21.00,15.00,6.00,0.00,0.00,21.00`)
  })
  test('Gusto: the hours columns, and the tip columns only when someone has tips', () => {
    const rows = [{ firstName: 'Pat', lastName: 'Lee', email: 'pat@x.test', regularHours: 30, overtimeHours: 4, totalHours: 34, paycheckTipsCents: 600, cashTipsCents: 1500 }]
    expect(gustoHoursCsv(rows).split('\n')).toEqual(['First Name,Last Name,Email,Regular Hours,Overtime Hours,Total Hours,Paycheck Tips,Cash Tips', '"Pat","Lee","pat@x.test",30.00,4.00,34.00,6.00,15.00'])
    expect(gustoHoursCsv([{ ...rows[0], paycheckTipsCents: 0, cashTipsCents: 0 }]).split('\n')[0]).toBe('First Name,Last Name,Email,Regular Hours,Overtime Hours,Total Hours')
  })
  test('ADP: hours in Reg and O/T, tips in Earnings 5 under the venue\'s code, only when there are tips to pay', () => {
    const s = { companyCode: 'AB1', batchId: '000042', tipEarningsCode: 'T' }
    const lines = adpCsv([p({}), p({ name: 'Sam Roe', adpFileNumber: '77', paycheckTipsCents: 0 })], s).split('\n')
    expect(lines[0]).toBe('Co Code,Batch ID,File #,Employee Name,Temp Dept,Temp Rate,Reg Hours,O/T Hours,Hours 3 Code,Hours 3 Amount,Hours 4 Code,Hours 4 Amount,Earnings 5 Code,Earnings 5 Amount')
    expect(lines[1]).toBe('"AB1","000042","1234","Pat Lee",,,30.00,4.00,,,,,"T",6.00')
    expect(lines[2]).toBe('"AB1","000042","77","Sam Roe",,,30.00,4.00,,,,,,')
    expect(adpFilename(s)).toBe('EPIAB1000042.csv')
  })
})

let k: Awaited<ReturnType<typeof bootFood>>
let items: Awaited<ReturnType<typeof k.menu>>
let day = ''
const ON = ['contacts', 'bar_menu', 'bar_register', 'bar_schedule', 'time_tracking', 'bar_tip_pooling', 'bar_declared_tips']
const ins = async (table: any, values: any) => ((await k.t.db.insert(table).values(values).returning()) as any[])[0]
const RULES = {
  defaultRole: 'Bartender',
  roles: [
    { name: 'Bartender', positions: ['Bar'], mode: 'pools', poolPct: 70 },
    { name: 'Barback', positions: ['Bar back'], mode: 'pools', poolPct: 30 },
    { name: 'Server', positions: ['Floor'], mode: 'keeps', poolPct: 0 },
  ],
  tipOuts: [{ from: 'Server', to: 'Barback', pct: 10, basis: 'tips' }],
}
const FROM = '2026-10-26', TO = '2026-10-31'
const get = (who: 'M' | 'B', path: string) => k[who]('GET', path)
const csvRows = (text: string) => text.split('\n').map((l) => l.split(','))

describe('the pay period on the real server', () => {
  beforeAll(async () => {
    setSystemTime(new Date('2026-10-30T03:30:00Z'))   // 10:30 PM Thursday the 29th in Eau Claire
    k = await bootFood({ features: ON })
    items = await k.menu()
    day = (await k.O('GET', '/api/register/day')).json.day as string
  }, 60_000)
  afterAll(() => { k.restore(); setSystemTime() })

  test('the feature id is registered hidden, and the export is closed until it is on and for anyone without bar:manage', () => {
    const f = (FEATURE_MAP as any)['bar_payroll_export'] || (FEATURE_MAP as any).get?.('bar_payroll_export')
    expect(f).toBeTruthy(); expect(f.hidden).toBe(true)
  })

  test('closed while the feature is off; a floor seat is refused when it is on', async () => {
    expect(day).toBe('2026-10-29')
    expect((await get('M', `/api/bar-payroll?from=${FROM}&to=${TO}`)).status).toBe(403)
    expect((await get('M', `/api/bar-payroll/file?from=${FROM}&to=${TO}&format=csv`)).status).toBe(403)
    await k.features([...ON, 'bar_payroll_export'])
    expect((await get('B', `/api/bar-payroll?from=${FROM}&to=${TO}`)).status).toBe(403)
    expect((await get('B', '/api/bar-payroll/settings')).status).toBe(403)
    expect((await k.B('PUT', '/api/bar-payroll/settings', { overtimeAfterHours: 10 })).status).toBe(403)
    expect((await get('M', `/api/bar-payroll?from=${FROM}&to=${TO}`)).status).toBe(200)
  })

  test('hours and overtime from the time clock, with the week\'s earlier hours carried in, and a venue setting that changes it', async () => {
    const tz = (n: number) => ({ companyId: k.companyId, date: noon(n) })
    // Bartender: Sun 25th 10h (before the period), Mon 10, Tue 10, Wed 8, Thu 6 = 44 in the week, 34 in the period.
    for (const [d, h] of [[25, 10], [26, 10], [27, 10], [28, 8], [29, 6]]) await ins(k.S.timeEntry, { ...tz(d), userId: k.ids.bartender, hours: String(h), approved: d !== 29 })
    // Manager: two ordinary days, plus a shift still running that is left out.
    for (const d of [27, 28]) await ins(k.S.timeEntry, { ...tz(d), userId: k.ids.manager, hours: '5', approved: true })
    await ins(k.S.timeEntry, { ...tz(29), userId: k.ids.manager, hours: '0', clockIn: noon(29) })
    const r = (await get('M', `/api/bar-payroll?from=${FROM}&to=${TO}`)).json
    const by = Object.fromEntries(r.people.map((p: any) => [p.userId, p]))
    expect(by[k.ids.bartender]).toMatchObject({ regularHours: 30, overtimeHours: 4, totalHours: 34 })
    expect(by[k.ids.manager]).toMatchObject({ regularHours: 10, overtimeHours: 0, totalHours: 10 })
    expect(r.rule).toMatchObject({ overtimeAfterHours: 40, workWeekStartName: 'Sunday', dailyOvertimeCalculated: false })
    expect(r.rule.text).toContain('past 40 in a work week')
    expect(r.rule.text).toContain('Overtime by the day')
    expect(r.warnings.join(' ')).toContain('Manager Seat is still clocked in')
    expect(r.warnings.join(' ')).toContain('Bartender Seat has 1 time entry not approved yet')
    // The venue sets its own threshold; refused values are refused, and the rule shown follows it.
    for (const bad of [0, 200, 'x', 37.3]) expect((await k.M('PUT', '/api/bar-payroll/settings', { overtimeAfterHours: bad })).status).toBe(400)
    expect((await k.M('PUT', '/api/bar-payroll/settings', { overtimeAfterHours: 32 })).status).toBe(200)
    const r2 = (await get('M', `/api/bar-payroll?from=${FROM}&to=${TO}`)).json
    expect(r2.people.find((p: any) => p.userId === k.ids.bartender)).toMatchObject({ regularHours: 22, overtimeHours: 12, totalHours: 34 })
    expect(r2.rule.text).toContain('past 32 in a work week')
    await k.M('PUT', '/api/bar-payroll/settings', { overtimeAfterHours: 40 })
    // A period must be real, and not more than 62 days.
    expect((await get('M', '/api/bar-payroll?from=2026-10-30&to=2026-10-26')).status).toBe(400)
    expect((await get('M', '/api/bar-payroll?from=2026-01-01&to=2026-10-26')).status).toBe(400)
  })

  test('tips: card, register cash and declared cash are each counted once; cash in hand comes off the paycheck', async () => {
    expect((await k.M('PUT', '/api/tips/rules', RULES)).status).toBe(200)
    const ring = async (who: 'B' | 'O', tender: string, tipCents: number) => {
      const chk = await k[who]('POST', '/api/register/check', { kind: 'walkup' })
      await k[who]('POST', `/api/register/check/${chk.json.check.id}/items`, { menuItemId: items.burger.id })
      const owed = (await k[who]('GET', `/api/register/check/${chk.json.check.id}`)).json.check.totals.balanceCents
      expect((await k[who]('POST', `/api/register/check/${chk.json.check.id}/pay`, { tender, amountCents: owed, tipCents })).status).toBe(200)
    }
    await ring('B', 'card_external', 1500)     // the bartender's card tips
    await ring('B', 'cash', 500)               // the bartender's cash tips rung on OUR register
    await ring('O', 'card_external', 2000)     // the server's (the owner) card tips
    expect((await k.B('POST', '/api/tips/declared/mine', { amountCents: 1000 })).status).toBe(200)   // handed over the bar, declared
    for (const [who, position] of [['bartender', 'Bar'], ['manager', 'Bar back'], ['owner', 'Floor']]) await ins(k.S.barScheduleShift, { companyId: k.companyId, userId: k.ids[who], day, start: '17:00', end: '23:00', position })
    // Before the night is closed the tips are not settled, and the page says so.
    const open = (await get('M', `/api/bar-payroll?from=${FROM}&to=${TO}`)).json
    expect(open.warnings.join(' ')).toContain('2026-10-29')
    expect((await k.M('POST', '/api/register/closeout', { day, floatCents: 0, countedCents: 0, force: true })).status).toBe(200)

    const r = (await get('M', `/api/bar-payroll?from=${FROM}&to=${TO}`)).json
    const by = Object.fromEntries(r.people.map((p: any) => [p.userId, p]))
    // Bartender: 1500 + 500 + 1000 declared = 3000 into the pool; 70% of it is 2100. Cash in hand: 500 (register) + 1000 (declared) = 1500.
    expect(by[k.ids.bartender]).toMatchObject({ tipsTotalCents: 2100, cashInHandCents: 1500, paycheckTipsCents: 600, poolShareCents: 2100 })
    // The barback: 30% of the pool (900) + 10% tip-out from the server's 2000 (200).
    expect(by[k.ids.manager]).toMatchObject({ tipsTotalCents: 1100, cashInHandCents: 0, paycheckTipsCents: 1100, tipOutReceivedCents: 200, poolShareCents: 900 })
    // The server keeps 1800 after tipping out 200.
    expect(by[k.ids.owner]).toMatchObject({ tipsTotalCents: 1800, cashInHandCents: 0, paycheckTipsCents: 1800, tipOutPaidCents: 200 })
    // Every cent of the night's tips once: 1500 + 500 + 2000 + 1000 = 5000.
    expect(r.totals.tipsTotalCents).toBe(5000)
    expect(r.totals.cashInHandCents).toBe(1500)
    expect(r.totals.paycheckTipsCents).toBe(3500)
    expect(r.warnings.join(' ')).not.toContain('not closed')
  })

  test('the spreadsheet, Gusto and ADP files carry the same figures; ADP waits for its codes and file numbers', async () => {
    const csv = await get('M', `/api/bar-payroll/file?from=${FROM}&to=${TO}&format=csv`)
    expect(csv.status).toBe(200)
    expect(csv.headers.get('content-disposition')).toContain('pay-period-2026-10-26-to-2026-10-31.csv')
    const rows = csvRows(csv.text)
    const bart = rows.find((r) => r[0].includes('Bartender Seat'))!
    expect(bart.slice(2)).toEqual(['30.00', '4.00', '34.00', '21.00', '15.00', '6.00', '0.00', '0.00', '21.00'])
    const gusto = await get('M', `/api/bar-payroll/file?from=${FROM}&to=${TO}&format=gusto`)
    expect(gusto.status).toBe(200)
    expect(gusto.headers.get('content-disposition')).toContain('gusto-hours-2026-10-26-to-2026-10-31.csv')
    const g = csvRows(gusto.text)
    expect(g[0]).toEqual(['First Name', 'Last Name', 'Email', 'Regular Hours', 'Overtime Hours', 'Total Hours', 'Paycheck Tips', 'Cash Tips'])
    expect(g.find((r) => r[0] === '"Bartender"')!.slice(3)).toEqual(['30.00', '4.00', '34.00', '6.00', '15.00'])
    // ADP: refused until the company code, the batch and everyone's file number are in.
    const refused = await get('M', `/api/bar-payroll/file?from=${FROM}&to=${TO}&format=adp`)
    expect(refused.status).toBe(400)
    expect(refused.json.error).toContain('company code'); expect(refused.json.error).toContain('Batch ID'); expect(refused.json.error).toContain('Bartender Seat')
    expect((await k.M('PUT', '/api/bar-payroll/settings', { adp: { companyCode: 'ab 1', batchId: '000042', tipEarningsCode: 'T' }, adpFileNumbers: { [k.ids.bartender]: '1234', [k.ids.manager]: '77', [k.ids.owner]: '9' } })).status).toBe(200)
    expect((await k.M('PUT', '/api/bar-payroll/settings', { adpFileNumbers: { nobody: '5' } })).status).toBe(404)
    expect((await k.M('PUT', '/api/bar-payroll/settings', { adp: { companyCode: 'a;b' } })).status).toBe(400)
    const adp = await get('M', `/api/bar-payroll/file?from=${FROM}&to=${TO}&format=adp`)
    expect(adp.status).toBe(200)
    expect(adp.headers.get('content-disposition')).toContain('EPIab1000042.csv')
    const a = csvRows(adp.text)
    expect(a.find((r) => r[2] === '"1234"')!.slice(6)).toEqual(['30.00', '4.00', '', '', '', '', '"T"', '6.00'])
    expect(a.find((r) => r[2] === '"77"')!.slice(6, 8)).toEqual(['10.00', '0.00'])
    expect(a.find((r) => r[2] === '"77"')!.slice(12)).toEqual(['"T"', '11.00'])
    // An empty period has nothing to hand over.
    expect((await get('M', '/api/bar-payroll/file?from=2026-09-01&to=2026-09-07&format=csv')).status).toBe(404)
    expect((await get('M', `/api/bar-payroll/file?from=${FROM}&to=${TO}&format=excel`)).status).toBe(400)
  })

  test('a person who holds more cash than their share is not paid negative tips; the spreadsheet shows it and the page says so', async () => {
    // The bartender declares another 40.00 in cash handed over the bar: 3000 + 4000 pooled, cash in hand 5500, share 70% of 7000.
    expect((await k.B('POST', '/api/tips/declared/mine', { amountCents: 5000 })).status).toBe(200)
    const r = (await get('M', `/api/bar-payroll?from=${FROM}&to=${TO}`)).json
    const b = r.people.find((p: any) => p.userId === k.ids.bartender)
    expect(b.cashInHandCents).toBe(500 + 5000)
    expect(b.paycheckTipsCents).toBe(b.tipsTotalCents - 5500)
    expect(b.paycheckTipsCents).toBeLessThan(0)
    expect(r.warnings.join(' ')).toContain('holds')
    const g = csvRows((await get('M', `/api/bar-payroll/file?from=${FROM}&to=${TO}&format=gusto`)).text)
    expect(g.find((r) => r[0] === '"Bartender"')![6]).toBe('0.00')
    const c = csvRows((await get('M', `/api/bar-payroll/file?from=${FROM}&to=${TO}&format=csv`)).text)
    expect(c.find((r) => r[0].includes('Bartender Seat'))![7]).toBe(`-${(-b.paycheckTipsCents / 100).toFixed(2)}`)
  })
})

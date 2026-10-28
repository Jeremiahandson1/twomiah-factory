// "Track hours and calculate payroll in Twomiah, then export it to Gusto" for every trade, not only home care:
// GET /api/payroll/gusto-hours (server/crm/field/payroll.ts) writes the period's time entries as Gusto's hours file through
// the same builder home care's file uses (server/crm/payrollExport/gustoHours.ts).
//   · Overtime is hours over 40 in a Sunday–Saturday week on the shop's calendar: an entry at 9pm Saturday Chicago time is
//     UTC's Sunday but belongs to the week that ended; the week after is regular.
//   · Whole days on the shop's clock: an entry before the first day, or after the last, is not in the file; a running
//     clock-in (no hours yet) is not either. One company's hours never reach another's.
//   · The same permission as the pay run (payroll:read): a field technician is refused. The download is audit-logged and
//     leaves a gusto_sync_log row. A name that starts with = cannot run as a formula.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant } from './harness.ts'
import { gustoHoursCsv, GUSTO_HOURS_HEADER, splitWeeklyHours } from '../server/crm/payrollExport/gustoHours.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
const tokens: Record<string, string> = {}
let coA = '', coB = ''
const get = (who: string, path: string) => t.call(path, { headers: { Authorization: `Bearer ${tokens[who]}` } })
const PERIOD = 'startDate=2026-09-06&endDate=2026-09-19'
const HEADER = 'First Name,Last Name,Email,Regular Hours,Overtime Hours,Total Hours'

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice' })
  const S = t.schema
  const [a] = await t.db.insert(S.company).values({ name: 'Shop A', slug: 'shop-a', enabledFeatures: ['time_tracking'], timezone: 'America/Chicago' }).returning()
  const [b] = await t.db.insert(S.company).values({ name: 'Shop B', slug: 'shop-b', enabledFeatures: ['time_tracking'], timezone: 'America/Chicago' }).returning()
  coA = a.id; coB = b.id
  const hash = await Bun.password.hash('Seat-pass-1', 'bcrypt')
  const ids: Record<string, string> = {}
  let n = 0
  for (const [who, role, companyId, first, last] of [
    ['ownerA', 'owner', coA, 'Olive', 'Owner'], ['managerA', 'manager', coA, 'Max', 'Manager'], ['techA', 'field', coA, 'Ann', 'Tech'],
    ['bea', 'field', coA, '=SUM(1)', 'Formula'], ['ownerB', 'owner', coB, 'Bo', 'Other'],
  ] as const) {
    const [u] = await t.db.insert(S.user).values({ email: `${who.toLowerCase()}@shop.example`, passwordHash: hash, firstName: first, lastName: last, role, companyId }).returning()
    ids[who] = u.id
    const res = await t.call('/api/auth/login', { method: 'POST', json: { email: `${who.toLowerCase()}@shop.example`, password: 'Seat-pass-1' }, headers: { 'X-Forwarded-For': `203.0.113.${++n}` } })
    tokens[who] = (await res.json()).accessToken
  }
  const entry = (companyId: string, userId: string, date: string, hours: number, extra: Record<string, unknown> = {}) =>
    t.db.insert(S.timeEntry).values({ companyId, userId, date: new Date(date), hours: String(hours), ...extra } as any)
  // Ann, week of Sun 6 Sep: Sun–Thu 9 h at 10am Chicago = 45 h, and Saturday 9pm Chicago (UTC's Sunday 13th) 2 h → 47 h: 40 + 7.
  for (const day of ['06', '07', '08', '09', '10']) await entry(coA, ids.techA, `2026-09-${day}T15:00:00Z`, 9)
  await entry(coA, ids.techA, '2026-09-13T02:00:00Z', 2)
  await entry(coA, ids.techA, '2026-09-14T15:00:00Z', 8) // next week: regular
  await entry(coA, ids.techA, '2026-09-05T15:00:00Z', 6) // the day before the period
  await entry(coA, ids.techA, '2026-09-20T15:00:00Z', 6) // the day after
  await entry(coA, ids.techA, '2026-09-15T15:00:00Z', 0, { clockIn: new Date('2026-09-15T15:00:00Z') }) // still running
  await entry(coA, ids.bea, '2026-09-08T15:00:00Z', 7.5)
  await entry(coB, ids.ownerB, '2026-09-08T15:00:00Z', 30)
}, 60_000)

describe('the Gusto hours file, for a trade that is not home care', () => {
  test('regular and overtime hours per person, overtime by Sunday–Saturday week on the shop’s clock', async () => {
    const res = await get('ownerA', `/api/payroll/gusto-hours?${PERIOD}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(res.headers.get('content-disposition')).toContain('gusto-hours-2026-09-06-to-2026-09-19.csv')
    const lines = (await res.text()).split('\n')
    expect(lines[0]).toBe(HEADER)
    // Ann: week 1 = 47 h (40 + 7), week 2 = 8 h → 48 regular, 7 overtime. The 5th and 20th are outside; the running entry has no hours.
    expect(lines).toContain('"Ann","Tech","techa@shop.example",48.00,7.00,55.00')
    // A leading = is made harmless; 7.5 h is regular.
    expect(lines).toContain('"\'=SUM(1)","Formula","bea@shop.example",7.50,0.00,7.50')
    expect(lines.length).toBe(3) // header + the two people in this shop; the owner and the manager logged nothing, shop B's 30 h is not here
  })

  test('the pay run’s permission: a field technician is refused, a manager is not; bad dates are a 400', async () => {
    expect((await get('techA', `/api/payroll/gusto-hours?${PERIOD}`)).status).toBe(403)
    expect((await get('managerA', `/api/payroll/gusto-hours?${PERIOD}`)).status).toBe(200)
    expect((await get('ownerA', '/api/payroll/gusto-hours?startDate=2026-09-06')).status).toBe(400)
    expect((await get('ownerA', '/api/payroll/gusto-hours?startDate=nope&endDate=2026-09-19')).status).toBe(400)
  })

  test('another shop sees only its own hours', async () => {
    const lines = (await (await get('ownerB', `/api/payroll/gusto-hours?${PERIOD}`)).text()).split('\n')
    expect(lines).toEqual([HEADER, '"Bo","Other","ownerb@shop.example",30.00,0.00,30.00'])
  })

  test('each download leaves a sync-log row and an audit row', async () => {
    const logs = await t.db.select().from(t.schema.gustoSyncLog).where(eq(t.schema.gustoSyncLog.companyId, coA))
    expect(logs.length).toBeGreaterThanOrEqual(2)
    expect(logs[0]).toMatchObject({ syncType: 'csv_export', status: 'success', payPeriodStart: '2026-09-06', payPeriodEnd: '2026-09-19' })
    expect(logs.some((l: any) => l.recordsExported === 2)).toBe(true)
    await new Promise((r) => setTimeout(r, 300)) // the audit write is not awaited by the route
    const audit = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.companyId, coA))
    expect(audit.some((a: any) => a.entity === 'gusto-hours')).toBe(true)
  })
})

describe('the shared builder (home care’s file uses it too)', () => {
  test('one header, quoted names, two-decimal hours; the weekly split is the FLSA rule', () => {
    expect([...GUSTO_HOURS_HEADER].join(',')).toBe(HEADER)
    expect(gustoHoursCsv([{ firstName: 'A "Q"', lastName: null, email: 'a@b.c', regularHours: 40, overtimeHours: '2.5', totalHours: 42.5 }]))
      .toBe(`${HEADER}\n"A ""Q""","","a@b.c",40.00,2.50,42.50`)
    expect(splitWeeklyHours([45, 8])).toEqual({ regularHours: 48, overtimeHours: 5, totalHours: 53 })
    expect(splitWeeklyHours([39.99])).toEqual({ regularHours: 39.99, overtimeHours: 0, totalHours: 39.99 })
  })
})

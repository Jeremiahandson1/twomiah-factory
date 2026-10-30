// Tip pooling and tip-out on the close-out (restaurant-bar-depth #9). The arithmetic (barTipMath.ts), then the real server:
// rules set by a manager, a night's tips and hours read from the checks and the time clock, the close-out freezing who gets
// what, a report, and a bartender seeing only their own nights.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'
import { rulesRefusal, settleTips, split, type TipRules } from '../server/crm/bar/barTipMath.ts'

const RULES: TipRules = {
  defaultRole: 'Bartender',
  roles: [
    { name: 'Bartender', positions: ['Bar'], mode: 'pools', poolPct: 70 },
    { name: 'Barback', positions: ['Bar back'], mode: 'pools', poolPct: 30 },
    { name: 'Server', positions: ['Floor'], mode: 'keeps', poolPct: 0 },
  ],
  tipOuts: [{ from: 'Server', to: 'Barback', pct: 10, basis: 'tips' }],
}
const P = (userId: string, role: string, hours: number, tipsCents: number, salesCents = 0) => ({ userId, name: userId, role, hours, tipsCents, salesCents })

describe('the arithmetic', () => {
  test('split gives every cent to someone and never invents one', () => {
    expect(split(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(split(5, [0, 0])).toEqual([3, 2])           // nobody weighed anything: even
    expect(split(1000, [3, 1])).toEqual([750, 250])
    for (const total of [0, 1, 7, 999, 10_001]) expect(split(total, [2.5, 1, 0.3, 4]).reduce((a, b) => a + b, 0)).toBe(total)
  })

  test('the pool is divided by role percent and then by hours; a server keeps their own less the tip-out', () => {
    const r = settleTips(RULES, [P('amy', 'Bartender', 6, 20000), P('ben', 'Bartender', 2, 10000), P('cal', 'Barback', 8, 0), P('dee', 'Server', 5, 30000)])
    const by = Object.fromEntries(r.payouts.map((p) => [p.userId, p]))
    // Dee tips out 10% of 300.00 = 30.00 to the only barback.
    expect(by.dee).toMatchObject({ tipOutPaidCents: 3000, keptCents: 27000, totalCents: 27000 })
    expect(by.cal.tipOutReceivedCents).toBe(3000)
    // The pool is 300.00 of bartenders' tips: 70% (210.00) to bartenders by hours 6:2, 30% (90.00) to the barback.
    expect(r.poolCents).toBe(30000)
    expect(by.amy.poolShareCents).toBe(15750); expect(by.ben.poolShareCents).toBe(5250)
    expect(by.cal.poolShareCents).toBe(9000); expect(by.cal.totalCents).toBe(12000)
    // Every cent of the 600.00 is somewhere.
    expect(r.payouts.reduce((s, p) => s + p.totalCents, 0)).toBe(60000)
  })

  test('a role nobody worked sends its share to the others; with no one to receive a tip-out the server keeps it', () => {
    const r = settleTips(RULES, [P('amy', 'Bartender', 6, 10000), P('dee', 'Server', 5, 20000)])
    expect(r.payouts.find((p) => p.userId === 'amy')!.totalCents).toBe(10000)           // the barback's 30% went to the only role on
    expect(r.payouts.find((p) => p.userId === 'dee')!.totalCents).toBe(20000)           // no barback, no tip-out
    expect(r.notes.join(' ')).toContain('Barback did not work')
    expect(r.notes.join(' ')).toContain('Nobody worked as Barback')
  })

  test('a tip-out on sales is capped at what the person made', () => {
    const rules: TipRules = { ...RULES, tipOuts: [{ from: 'Server', to: 'Barback', pct: 5, basis: 'sales' }] }
    const r = settleTips(rules, [P('dee', 'Server', 5, 1000, 100000), P('cal', 'Barback', 5, 0)])
    expect(r.payouts.find((p) => p.userId === 'dee')).toMatchObject({ tipOutPaidCents: 1000, keptCents: 0 })   // 5% of 1,000.00 is 50.00, she made 10.00
    expect(r.payouts.find((p) => p.userId === 'cal')!.tipOutReceivedCents).toBe(1000)
  })

  test('rules that do not add up are refused in words', () => {
    expect(rulesRefusal(RULES)).toBeNull()
    expect(rulesRefusal({ ...RULES, roles: RULES.roles.map((r, i) => (i === 0 ? { ...r, poolPct: 60 } : r)) })).toContain('add up to 90')
    expect(rulesRefusal({ ...RULES, tipOuts: [{ from: 'Server', to: 'Chef', pct: 5, basis: 'tips' }] })).toContain('not in the list')
    expect(rulesRefusal({ ...RULES, tipOuts: [{ from: 'Server', to: 'Server', pct: 5, basis: 'tips' }] })).toContain('itself')
    expect(rulesRefusal({ ...RULES, roles: RULES.roles.map((r) => ({ ...r, poolPct: 0 })) })).toContain('no role has a share')
  })
})

let k: Awaited<ReturnType<typeof bootFood>>
let items: Awaited<ReturnType<typeof k.menu>>
const ON = ['contacts', 'bar_menu', 'bar_register', 'bar_schedule', 'time_tracking']
const ins = async (table: any, values: any) => ((await k.t.db.insert(table).values(values).returning()) as any[])[0]
const today = () => new Date().toISOString().slice(0, 10)

describe('on the real server', () => {
  let day = ''
  beforeAll(async () => {
    k = await bootFood({ features: ON })
    items = await k.menu()
  }, 60_000)
  afterAll(() => k.restore())

  test('switched off the routes are closed; on, rules are a manager\'s and are checked', async () => {
    expect((await k.M('GET', '/api/tips/rules')).status).toBe(403)
    await k.features([...ON, 'bar_tip_pooling'])
    expect((await k.B('GET', '/api/tips/rules')).status).toBe(403)
    expect((await k.B('PUT', '/api/tips/rules', RULES)).status).toBe(403)
    const bad = await k.M('PUT', '/api/tips/rules', { ...RULES, roles: RULES.roles.map((r, i) => (i === 0 ? { ...r, poolPct: 60 } : r)) })
    expect(bad.status).toBe(400); expect(bad.json.error).toContain('add up to')
    const ok = await k.M('PUT', '/api/tips/rules', RULES)
    expect(ok.status).toBe(200)
    expect((await k.M('GET', '/api/tips/rules')).json.rules.roles.map((r: any) => r.name)).toEqual(['Bartender', 'Barback', 'Server'])
  })

  test('the night: tips on the checks each person closed, hours from the clock, role from the schedule; frozen by the close-out', async () => {
    const tzNow = new Date()
    day = (await k.O('GET', '/api/register/day')).json.day as string
    // The bartender (field) rings and closes a $12.66 burger with a $5.00 cash tip; the manager is the barback tonight, the owner the server.
    const chk = await k.B('POST', '/api/register/check', { kind: 'walkup' })
    const id = chk.json.check.id
    await k.B('POST', `/api/register/check/${id}/items`, { menuItemId: items.burger.id })
    const owed = (await k.B('GET', `/api/register/check/${id}`)).json.check.totals.balanceCents
    expect((await k.B('POST', `/api/register/check/${id}/pay`, { tender: 'cash', amountCents: owed, tipCents: 500 })).status).toBe(200)
    const chk2 = await k.O('POST', '/api/register/check', { kind: 'walkup' })
    await k.O('POST', `/api/register/check/${chk2.json.check.id}/items`, { menuItemId: items.burger.id })
    const owed2 = (await k.O('GET', `/api/register/check/${chk2.json.check.id}`)).json.check.totals.balanceCents
    expect((await k.O('POST', `/api/register/check/${chk2.json.check.id}/pay`, { tender: 'cash', amountCents: owed2, tipCents: 2000 })).status).toBe(200)
    // Hours: the bartender 4h, the manager 4h, the owner 3h, all tonight (the business day began at 4 AM).
    const hrs = async (userId: string, h: number) => {
      const out = new Date(tzNow.getTime() - 60_000), inn = new Date(out.getTime() - h * 3600_000)
      await ins(k.S.timeEntry, { companyId: k.companyId, userId, date: inn, hours: String(h), clockIn: inn, clockOut: out })
    }
    await hrs(k.ids.bartender, 4); await hrs(k.ids.manager, 4); await hrs(k.ids.owner, 3)
    // Schedule positions today.
    for (const [who, position] of [['bartender', 'Bar'], ['manager', 'Bar back'], ['owner', 'Floor']]) await ins(k.S.barScheduleShift, { companyId: k.companyId, userId: k.ids[who], day, start: '17:00', end: '23:00', position })
    const pre = await k.M('GET', `/api/tips/night?day=${day}`)
    expect(pre.status).toBe(200)
    const by = Object.fromEntries(pre.json.payouts.map((p: any) => [p.userId, p]))
    expect(by[k.ids.bartender]).toMatchObject({ role: 'Bartender', tipsCents: 500, hours: 4 })
    expect(by[k.ids.owner]).toMatchObject({ role: 'Server', tipsCents: 2000, tipOutPaidCents: 200, keptCents: 1800 })
    expect(by[k.ids.manager]).toMatchObject({ role: 'Barback', tipOutReceivedCents: 200 })
    // The 5.00 pool: 70% to the one bartender (3.50), 30% to the one barback (1.50 + 2.00 tip-out).
    expect(by[k.ids.bartender].totalCents).toBe(350); expect(by[k.ids.manager].totalCents).toBe(350)
    expect(pre.json.payouts.reduce((s: number, p: any) => s + p.totalCents, 0)).toBe(2500)
    // Nothing is frozen until the night is closed; a bartender cannot read the night.
    expect((await k.M('GET', `/api/tips/report?from=${day}&to=${day}`)).json.people).toEqual([])
    expect((await k.B('GET', `/api/tips/night?day=${day}`)).status).toBe(403)
    // Close the night as the manager: the tip-out is recorded with it.
    const closed = await k.M('POST', '/api/register/closeout', { day, floatCents: 0, countedCents: owed + owed2 + 2500, force: true })
    expect(closed.status).toBe(200)
    expect(closed.json.tips.payouts.length).toBe(3)
    const rep = await k.M('GET', `/api/tips/report?from=${day}&to=${day}`)
    expect(rep.json.totalCents).toBe(2500)
    expect(rep.json.people.map((p: any) => [p.userId, p.totalCents]).sort()).toEqual([[k.ids.bartender, 350], [k.ids.manager, 350], [k.ids.owner, 1800]].sort())
    // Closed again: that night's rows are replaced, not doubled.
    await k.M('POST', '/api/register/closeout', { day, floatCents: 0, countedCents: 0, force: true })
    expect((await k.M('GET', `/api/tips/report?from=${day}&to=${day}`)).json.totalCents).toBe(2500)
  })

  test('a bartender reads only their own nights; the report is a manager\'s', async () => {
    const mine = await k.B('GET', `/api/tips/mine?from=${day}&to=${day}`)
    expect(mine.status).toBe(200)
    expect(mine.json.totalCents).toBe(350)
    expect(mine.json.nights.length).toBe(1)
    expect(JSON.stringify(mine.json)).not.toContain(k.ids.owner)
    expect((await k.B('GET', `/api/tips/report?from=${day}&to=${day}`)).status).toBe(403)
  })

  test('with the feature off the close-out is exactly what it was', async () => {
    await k.features(ON)
    const r = await k.M('POST', '/api/register/closeout', { day, floatCents: 0, countedCents: 0, force: true })
    expect(r.status).toBe(200)
    expect(r.json.tips).toBeNull()
    await k.features([...ON, 'bar_tip_pooling'])
  })
})

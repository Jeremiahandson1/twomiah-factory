// Declared cash tips (restaurant-bar parity #16, 7shifts): staff declare the cash tips they were handed outside the register when they
// clock out (phone, tablet and web all land on the same route), a manager sees and corrects them, and they join the tip pool and the
// tip-out; the payroll export reads them per person per period. Cash tips rung on OUR register are on the checks already and are
// shown beside the box so nothing is declared twice.
import { describe, test, expect, beforeAll, afterAll, setSystemTime } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'
import { createBarTips } from '../server/crm/bar/barTips.ts'
import { createBarLive } from '../server/crm/bar/barLive.ts'
import type { TipRules } from '../server/crm/bar/barTipMath.ts'

const RULES: TipRules = {
  defaultRole: 'Bartender',
  roles: [
    { name: 'Bartender', positions: ['Bar'], mode: 'pools', poolPct: 70 },
    { name: 'Barback', positions: ['Bar back'], mode: 'pools', poolPct: 30 },
    { name: 'Server', positions: ['Floor'], mode: 'keeps', poolPct: 0 },
  ],
  tipOuts: [{ from: 'Server', to: 'Barback', pct: 10, basis: 'tips' }],
}
let k: Awaited<ReturnType<typeof bootFood>>
let items: Awaited<ReturnType<typeof k.menu>>
let day = ''
const ON = ['contacts', 'bar_menu', 'bar_register', 'bar_schedule', 'time_tracking', 'bar_tip_pooling']
const ins = async (table: any, values: any) => ((await k.t.db.insert(table).values(values).returning()) as any[])[0]
const dayBack = (n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }

describe('declared cash tips on the real server', () => {
  beforeAll(async () => {
    setSystemTime(new Date('2026-10-30T03:30:00Z'))   // 10:30 PM in Eau Claire, as the pooling suite pins it
    k = await bootFood({ features: ON })
    items = await k.menu()
    day = (await k.O('GET', '/api/register/day')).json.day as string
  }, 60_000)
  afterAll(() => { k.restore(); setSystemTime() })

  test('closed until the feature is on; a person declares their own night, the amount is whole cents and sane, and a manager sees all', async () => {
    expect((await k.B('POST', '/api/tips/declared/mine', { amountCents: 1000 })).status).toBe(403)
    await k.features([...ON, 'bar_declared_tips'])
    expect((await k.B('POST', '/api/tips/declared/mine', { amountCents: 1000 })).status).toBe(200)
    for (const bad of [12.5, -1, 1_000_001, '10', null]) expect((await k.B('POST', '/api/tips/declared/mine', { amountCents: bad })).status).toBe(400)
    expect((await k.B('POST', '/api/tips/declared/mine', { amountCents: 100, day: dayBack(-2) })).json.error).toContain('not happened')
    expect((await k.B('POST', '/api/tips/declared/mine', { amountCents: 100, day: dayBack(9) })).json.error).toContain('more than a week')
    // Saying it again for the same night replaces the figure ('set'), or adds to it ('add').
    const again = await k.B('POST', '/api/tips/declared/mine', { amountCents: 4500 })
    expect(again.json.entry).toMatchObject({ day, amountCents: 4500, originalCents: 4500, corrected: false })
    expect((await k.B('POST', '/api/tips/declared/mine', { amountCents: 500, mode: 'add' })).json.entry.amountCents).toBe(5000)
    expect((await k.B('POST', '/api/tips/declared/mine', { amountCents: 5000 })).json.entry.amountCents).toBe(5000)
    // The phone sends the moment it was tapped, so a save made without signal and sent later lands on the night it was tapped; a time in the future is refused.
    expect((await k.B('POST', '/api/tips/declared/mine', { amountCents: 300, at: '2026-10-30T06:00:00Z' })).json.error).toContain('not right')
    const late = await k.B('POST', '/api/tips/declared/mine', { amountCents: 300, at: '2026-10-30T03:20:00Z', via: 'phone' })
    expect(late.json.entry).toMatchObject({ day, declaredVia: 'phone' })
    expect((await k.B('POST', '/api/tips/declared/mine', { amountCents: 5000 })).json.entry.amountCents).toBe(5000)
    // Nobody reads anyone else's; a floor seat cannot reach the manager side.
    expect((await k.B('GET', `/api/tips/declared?from=${day}&to=${day}`)).status).toBe(403)
    expect((await k.B('PUT', '/api/tips/declared/x', { amountCents: 1 })).status).toBe(403)
    const all = await k.M('GET', `/api/tips/declared?from=${day}&to=${day}`)
    expect(all.json.nights.map((n: any) => [n.name.includes('Bartender'), n.amountCents])).toEqual([[true, 5000]])
    // Back to nothing for the pool test that follows.
    await k.B('POST', '/api/tips/declared/mine', { amountCents: 0 })
  })

  test('on the counter tablet: the cash tips go in with the PIN at clock-out, never at clock-in; a bad amount stops the punch', async () => {
    expect((await k.B('PUT', '/api/register/pin', { pin: '1357' })).status).toBe(200)
    const bad = await k.M('POST', '/api/register/clock', { pin: '1357', declaredTipCents: 12.5 })
    expect(bad.status).toBe(400)
    expect((await k.M('GET', '/api/register/clock')).json.on.length).toBe(0)          // nothing was punched
    const inn = await k.M('POST', '/api/register/clock', { pin: '1357', declaredTipCents: 2500 })
    expect(inn.json.action).toBe('in'); expect(inn.json.declaredTip.skipped).toContain('when you clock out')
    await (k.t.db as any).update(k.S.timeEntry).set({ clockIn: new Date(Date.now() - 2 * 3600_000) }).where(eq(k.S.timeEntry.companyId, k.companyId))
    const out = await k.M('POST', '/api/register/clock', { pin: '1357', declaredTipCents: 2500 })
    expect(out.json.action).toBe('out'); expect(out.json.declaredTip).toEqual({ recordedCents: 2500 })
    expect(JSON.stringify(out.json)).not.toContain('userId')
    expect((await k.B('GET', `/api/tips/declared/mine?from=${day}&to=${day}`)).json.nights[0]).toMatchObject({ amountCents: 2500, declaredVia: 'tablet' })
    // A later clock-out the same night adds to it (the tablet cannot see what is declared already).
    expect((await k.B('POST', '/api/tips/declared/mine', { amountCents: 500, mode: 'add' })).json.entry.amountCents).toBe(3000)
    // With the feature off the amount is ignored and the punch still works.
    await k.features(ON)
    const inn2 = await k.M('POST', '/api/register/clock', { pin: '1357', declaredTipCents: 99 })
    expect(inn2.json.action).toBe('in'); expect(inn2.json.declaredTip).toBeUndefined()
    await (k.t.db as any).delete(k.S.timeEntry).where(eq(k.S.timeEntry.companyId, k.companyId))
    await k.features([...ON, 'bar_declared_tips'])
    await k.B('POST', '/api/tips/declared/mine', { amountCents: 0 })
  })

  test('declared tips join the pool and the tip-out, a manager corrects them (the first figure is kept), and a closed night is worked out again', async () => {
    expect((await k.M('PUT', '/api/tips/rules', RULES)).status).toBe(200)
    // The bartender rings $5.00 of cash tips on our register, then declares $45.00 more handed over the bar; the owner (server) rang $20.00.
    const chk = await k.B('POST', '/api/register/check', { kind: 'walkup' })
    await k.B('POST', `/api/register/check/${chk.json.check.id}/items`, { menuItemId: items.burger.id })
    const owed = (await k.B('GET', `/api/register/check/${chk.json.check.id}`)).json.check.totals.balanceCents
    expect((await k.B('POST', `/api/register/check/${chk.json.check.id}/pay`, { tender: 'cash', amountCents: owed, tipCents: 500 })).status).toBe(200)
    const chk2 = await k.O('POST', '/api/register/check', { kind: 'walkup' })
    await k.O('POST', `/api/register/check/${chk2.json.check.id}/items`, { menuItemId: items.burger.id })
    const owed2 = (await k.O('GET', `/api/register/check/${chk2.json.check.id}`)).json.check.totals.balanceCents
    expect((await k.O('POST', `/api/register/check/${chk2.json.check.id}/pay`, { tender: 'cash', amountCents: owed2, tipCents: 2000 })).status).toBe(200)
    const tzNow = new Date()
    for (const [who, h] of [['bartender', 4], ['manager', 4], ['owner', 3]] as const) {
      const out = new Date(tzNow.getTime() - 60_000), inn = new Date(out.getTime() - h * 3600_000)
      await ins(k.S.timeEntry, { companyId: k.companyId, userId: k.ids[who], date: inn, hours: String(h), clockIn: inn, clockOut: out })
    }
    for (const [who, position] of [['bartender', 'Bar'], ['manager', 'Bar back'], ['owner', 'Floor']]) await ins(k.S.barScheduleShift, { companyId: k.companyId, userId: k.ids[who], day, start: '17:00', end: '23:00', position })

    const before = (await k.M('GET', `/api/tips/night?day=${day}`)).json
    expect(before.payouts.find((p: any) => p.userId === k.ids.bartender)).toMatchObject({ tipsCents: 500, declaredCents: 0 })
    const decl = await k.B('POST', '/api/tips/declared/mine', { amountCents: 4500 })
    expect(decl.status).toBe(200)
    // Their own screen shows the $5.00 already on the register, so they do not declare it twice.
    const mine = (await k.B('GET', `/api/tips/declared/mine?from=${day}&to=${day}`)).json
    expect(mine.nights[0]).toMatchObject({ amountCents: 4500, onRegisterCents: 500 }); expect(mine.onRegisterByDay[day]).toBe(500)
    expect((await k.O('POST', '/api/tips/declared/mine', { amountCents: 1000 })).status).toBe(200)

    const night = (await k.M('GET', `/api/tips/night?day=${day}`)).json
    const by = Object.fromEntries(night.payouts.map((p: any) => [p.userId, p]))
    // Bartender 500 on the register + 4500 declared = 5000 into the pool: 70% (3500) to the bartender, 30% (1500) to the barback.
    expect(by[k.ids.bartender]).toMatchObject({ tipsCents: 5000, declaredCents: 4500, poolShareCents: 3500, totalCents: 3500 })
    // The server's 2000 + 1000 declared = 3000; tip-out 10% = 300 to the barback; keeps 2700.
    expect(by[k.ids.owner]).toMatchObject({ tipsCents: 3000, declaredCents: 1000, tipOutPaidCents: 300, keptCents: 2700, totalCents: 2700 })
    expect(by[k.ids.manager]).toMatchObject({ poolShareCents: 1500, tipOutReceivedCents: 300, totalCents: 1800 })
    expect(night.payouts.reduce((s: number, p: any) => s + p.totalCents, 0)).toBe(8000)      // every cent: 5000 + 3000

    // A manager corrects the bartender's figure (a mistyped 45.00 was 40.00); the first figure stays.
    const entry = (await k.M('GET', `/api/tips/declared?from=${day}&to=${day}`)).json.nights.find((n: any) => n.userId === k.ids.bartender)
    const fixed = await k.M('PUT', `/api/tips/declared/${entry.id}`, { amountCents: 4000, note: 'Counted with them at close' })
    expect(fixed.status).toBe(200)
    expect(fixed.json.entry).toMatchObject({ amountCents: 4000, originalCents: 4500, corrected: true, note: 'Counted with them at close' })
    expect(fixed.json.entry.correctedByName).toContain('Manager'); expect(fixed.json.before.amountCents).toBe(4500)
    expect((await k.M('PUT', `/api/tips/declared/${entry.id}`, { amountCents: -5 })).status).toBe(400)
    expect((await k.M('PUT', '/api/tips/declared/nobody', { amountCents: 5 })).status).toBe(404)
    // A manager can add a night someone forgot.
    const added = await k.M('POST', '/api/tips/declared', { userId: k.ids.manager, day, amountCents: 700 })
    expect(added.json.entry).toMatchObject({ declaredVia: 'manager', amountCents: 700 })
    expect((await k.M('POST', '/api/tips/declared', { userId: 'nobody', day, amountCents: 700 })).status).toBe(404)
    await k.M('PUT', `/api/tips/declared/${added.json.entry.id}`, { amountCents: 0 })

    // Closing the night freezes it; correcting afterwards works the frozen rows out again.
    const closed = await k.M('POST', '/api/register/closeout', { day, floatCents: 0, countedCents: 0, force: true })
    expect(closed.status).toBe(200)
    const report = async () => Object.fromEntries((await k.M('GET', `/api/tips/report?from=${day}&to=${day}`)).json.people.map((p: any) => [p.userId, p]))
    expect((await report())[k.ids.bartender]).toMatchObject({ tipsCents: 4500, declaredCents: 4000 })
    await k.M('PUT', `/api/tips/declared/${entry.id}`, { amountCents: 3000 })
    expect((await report())[k.ids.bartender]).toMatchObject({ tipsCents: 3500, declaredCents: 3000 })
    const total = Object.values(await report()).reduce((s: number, p: any) => s + p.totalCents, 0)
    expect(total).toBe(500 + 3000 + 2000 + 1000)                                    // register + declared, nothing lost or invented

    // The payroll export's call: declared tips per person for a pay period, in cents, after corrections; register tips are not in it.
    const tips = createBarTips(k.t.db as any, createBarLive(k.t.db as any))
    const pay = await tips.declaredByPerson(k.companyId, dayBack(6), day)
    expect(pay.people.map((p) => [p.userId, p.declaredCents, p.days])).toEqual([[k.ids.bartender, 3000, [{ day, cents: 3000 }]], [k.ids.owner, 1000, [{ day, cents: 1000 }]]])
    expect(pay.totalCents).toBe(4000)
    expect((await tips.declaredByPerson(k.companyId, dayBack(30), dayBack(10))).people).toEqual([])
    await expect(tips.declaredByPerson(k.companyId, day, dayBack(3))).rejects.toThrow('from and a to')
  })
})

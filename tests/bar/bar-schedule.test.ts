// crm-bar — the schedule and the time clock on the bar tablet (services/barSchedulePlan.ts, barSchedule.ts,
// routes/barSchedule.ts, POST /api/register/clock):
//   1. the arithmetic, from website-premium-bar's own tests: a shift past midnight, "close" from the bar's hours,
//      coverage gaps, the week plan (overtime past 40, wages, null without a rate), double-bookings; Monday weeks
//   2. the clock: a person types their own PIN on the tablet and THEY are clocked in and out, into the CRM's own
//      time_entry (what the Time page and the pay run read); a wrong PIN, and time tracking switched off, refused
//   3. the week: a manager schedules (open/close resolved, 16 hours refused, another company's person refused); a
//      bartender may not; gaps, overlaps, wages from the Team card's rate; copy; publish — staff see only the
//      published copy, and an edit after publishing waits for the next Publish
//   4. time off: asked for by the person, once, never for a day gone; a manager decides; the shift is flagged
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 600)) }
}
const same = (name: string, got: unknown, want: unknown) => check(name, JSON.stringify(got) === JSON.stringify(want), { got, want })

const P = await import('./src/services/barSchedulePlan.ts')
const TZ = 'America/Chicago'
const R = [{ open: '10:30', close: '01:00' }]
const cfg: any = { timezone: TZ, bar: { tue: R, wed: R, thu: R, fri: R, sat: R }, kitchen: {}, holidays: [{ date: '2026-11-26', label: 'Thanksgiving', bar: null, kitchen: null }] }
const s = (userId: string, day: string, start: string, end: string) => ({ userId, day, start, end })

console.log('\n══════════ 1. the arithmetic ══════════')
{
  same('4 PM to 1 AM is 9 hours', P.hoursOf(s('a', '2026-09-29', '16:00', '01:00'), TZ), 9)
  same("'close' is that day's bar close; a closed day and a holiday have none", [P.closeOn(cfg, '2026-09-29'), P.closeOn(cfg, '2026-09-28'), P.closeOn(cfg, '2026-11-26')], ['01:00', null, null])
  same('times read like a person says them', [P.formatClock('16:00'), P.formatClock('10:30'), P.formatClock('00:00'), P.formatClock('12:15')], ['4 PM', '10:30 AM', '12 AM', '12:15 PM'])
  same('open to 4 and 4 to close covers Tuesday; nothing covers Wednesday', P.coverageGaps(cfg, ['2026-09-29', '2026-09-30'], [s('a', '2026-09-29', '10:30', '16:00'), s('b', '2026-09-29', '16:00', '01:00')], TZ), [{ day: '2026-09-30', from: '10:30', to: '01:00', minutes: 870 }])
  same('a half hour late start and an early leave both show', P.coverageGaps(cfg, ['2026-09-29'], [s('a', '2026-09-29', '11:00', '16:00'), s('b', '2026-09-29', '16:00', '00:00')], TZ), [{ day: '2026-09-29', from: '10:30', to: '11:00', minutes: 30 }, { day: '2026-09-29', from: '00:00', to: '01:00', minutes: 60 }])
  same('overlapping shifts count once; closed days need nobody', P.coverageGaps(cfg, ['2026-09-28', '2026-09-29'], [s('a', '2026-09-29', '10:00', '18:00'), s('b', '2026-09-29', '12:00', '20:00'), s('c', '2026-09-29', '19:00', '02:00')], TZ), [])
  const week = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'].map(d => s('jess', d, '16:00', '01:00'))
  const plan = P.weekPlan([...week, s('sam', '2026-09-29', '10:30', '16:00')], TZ, new Map([['jess', 1500], ['sam', null]]))
  same('45 hours: 5 of them overtime, at time and a half', plan.people.find(p => p.userId === 'jess'), { userId: 'jess', hours: 45, overtime: 5, wagesCents: 40 * 1500 + 5 * 2250 })
  check('no rate, no wage — and the week total is unknown, not short', plan.people.find(p => p.userId === 'sam')!.wagesCents === null && plan.wagesCents === null)
  const o = P.overlaps([s('a', '2026-09-29', '10:30', '16:00'), s('a', '2026-09-29', '15:00', '20:00'), s('b', '2026-09-29', '10:30', '16:00')], TZ)
  check('a double-booking is caught', o.length === 1 && o[0][1].start === '15:00', o)
  same('the week starts Monday (the timesheet\'s week)', [P.workweekStart('2026-10-01'), P.workweekStart('2026-10-05'), P.workweekStart('2026-10-04')], ['2026-09-28', '2026-10-05', '2026-09-28'])
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const S = await import('./db/schema.ts')
const { company, user, teamMember, timeEntry, barSettings } = S
const { requestScope } = await import('./src/services/audit.ts')

const ALL = ['contacts', 'bar_menu', 'bar_tonight', 'bar_register', 'bar_schedule', 'time_tracking', 'team']
const [co] = await db.insert(company).values({ name: 'The Tap Room', slug: 'taproom-sched', email: 'bar@test.local', state: 'WI', settings: {}, enabledFeatures: ALL } as any).returning()
await db.insert(barSettings).values({ companyId: co.id, hours: cfg } as any)
const mk = async (cid: string, role: string, first: string, tag: string) => (await db.insert(user).values({ email: `${first.toLowerCase()}-${tag}@test.local`, passwordHash: 'x', firstName: first, lastName: 'T', role, companyId: cid, isActive: true } as any).returning())[0]
const manager = await mk(co.id, 'manager', 'Pat', 'sched'), jess = await mk(co.id, 'field', 'Jess', 'sched'), sam = await mk(co.id, 'field', 'Sam', 'sched')
// Jess's pay rate is on her Team card ($15/h), matched by email — the timesheet's own rule.
await db.insert(teamMember).values({ name: 'Jess T', email: jess.email, hourlyRate: '15.00', companyId: co.id } as any)

const app = new Hono()
app.use('*', (c, next) => requestScope.run({ c }, next))
app.route('/api/register', (await import('./src/routes/barRegister.ts')).registerRoutes)
app.route('/api/schedule', (await import('./src/routes/barSchedule.ts')).default)
app.onError((err: any, c: any) => c.json({ error: err?.message || 'Internal error' }, err?.status || 500))
const call = (who: any, cid = co.id) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': cid, 'x-test-role': who.role }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const M = call(manager), J = call(jess), SM = call(sam)

console.log('\n══════════ 2. the clock on the bar tablet ══════════')
{
  await J('PUT', '/api/register/pin', { pin: '2468' })
  await SM('PUT', '/api/register/pin', { pin: '1357' })
  // The tablet is signed in as Jess; Sam types HIS PIN — Sam is clocked in.
  const inSam = await J('POST', '/api/register/clock', { pin: '1357' })
  check(`Sam's PIN on Jess's tablet clocks in Sam (${inSam.json.action})`, inSam.status === 200 && inSam.json.action === 'in' && inSam.json.name === 'Sam T' && inSam.json.on.some((x: any) => x.name === 'Sam T'), inSam.json)
  const rows = await db.select().from(timeEntry).where(eq(timeEntry.userId, sam.id))
  check("…into the CRM's own time entries (what the Time page and the pay run read)", rows.length === 1 && !!rows[0].clockIn && !rows[0].clockOut, rows)
  const quick = await J('POST', '/api/register/clock', { pin: '1357' })
  check('clocking straight back out is a mis-click: thrown away, the shared rule', quick.json.action === 'discarded' && (await db.select().from(timeEntry).where(eq(timeEntry.userId, sam.id))).length === 0, quick.json)
  await J('POST', '/api/register/clock', { pin: '1357' })
  const [open] = await db.select().from(timeEntry).where(eq(timeEntry.userId, sam.id))
  await db.update(timeEntry).set({ clockIn: new Date(Date.now() - 2 * 3600000) }).where(eq(timeEntry.id, open.id))
  const out = await J('POST', '/api/register/clock', { pin: '1357' })
  check(`two hours later he clocks out: ${out.json.hours} hours`, out.json.action === 'out' && out.json.hours === 2, out.json)
  const wrong = await J('POST', '/api/register/clock', { pin: '9999' })
  check('a PIN that is nobody\'s is refused', wrong.status === 400 && /didn't match anyone/.test(wrong.json.error), wrong.json)
  const [other] = await db.insert(company).values({ name: 'No Clock', slug: 'noclock', email: 'nc@test.local', settings: {}, enabledFeatures: ['contacts', 'bar_register'] } as any).returning()
  const ob = await mk(other.id, 'field', 'Nat', 'noclock')
  const off = await call(ob, other.id)('POST', '/api/register/clock', { pin: '1357' })
  check(`time tracking switched off: no clock (${off.status})`, off.status === 403, off.json)
}

console.log('\n══════════ 3. the week ══════════')
const TUE = '2026-12-01', WED = '2026-12-02'
let shiftId = ''
{
  const bart = await J('POST', '/api/schedule/shifts', { userId: jess.id, day: TUE, start: '16:00', end: 'close' })
  check('a bartender may not build the schedule', bart.status === 403, bart.json)
  const a = await M('POST', '/api/schedule/shifts', { userId: jess.id, day: TUE, start: '16:00', end: 'close', position: 'Bar' })
  check("'close' becomes that day's bar close", a.status === 200 && a.json.shift.end === '01:00', a.json)
  shiftId = a.json.shift.id
  const b = await M('POST', '/api/schedule/shifts', { userId: sam.id, day: TUE, start: 'open', end: '16:00' })
  check("'open' becomes that day's bar open", b.json.shift?.start === '10:30', b.json)
  const closed = await M('POST', '/api/schedule/shifts', { userId: sam.id, day: '2026-11-30', start: 'open', end: '16:00' })
  check('a closed day has no "open"', closed.status === 400 && /closed that day/.test(closed.json.error), closed.json)
  const long = await M('POST', '/api/schedule/shifts', { userId: sam.id, day: WED, start: '06:00', end: '23:00' })
  check('17 hours is refused', long.status === 400 && /16 hours/.test(long.json.error), long.json)
  await M('POST', '/api/schedule/shifts', { userId: jess.id, day: TUE, start: '20:00', end: '23:00' })
  const w = await M('GET', `/api/schedule/week?day=${TUE}`)
  check(`the week starts ${w.json.weekStart} (a Monday)`, w.json.weekStart === '2026-11-30' && w.json.days.length === 7)
  check('Wednesday to Saturday show as gaps; Tuesday is covered', w.json.gaps.some((g: any) => g.day === WED) && !w.json.gaps.some((g: any) => g.day === TUE), w.json.gaps.map((g: any) => g.day))
  check("Jess's 8 PM shift overlaps her 4 PM one", w.json.overlaps.length === 1 && w.json.overlaps[0].name === 'Jess T', w.json.overlaps)
  const jp = w.json.people.find((p: any) => p.userId === jess.id), sp = w.json.people.find((p: any) => p.userId === sam.id)
  check(`wages from the Team card: Jess 12 h × $15 = ${jp?.wagesCents}¢; Sam has no rate`, jp.hourlyCents === 1500 && jp.hours === 12 && jp.wagesCents === 18000 && sp.wagesCents === null && w.json.wagesCents === null, [jp, sp])
  const [other] = await db.insert(company).values({ name: 'Elsewhere', slug: 'elsewhere-sched', email: 'el@test.local', settings: {}, enabledFeatures: ALL } as any).returning()
  const stranger = await mk(other.id, 'field', 'Stranger', 'elsewhere')
  const x = await M('POST', '/api/schedule/shifts', { userId: stranger.id, day: TUE, start: '16:00', end: '20:00' })
  check("another company's person cannot be scheduled here", x.status === 404, x.json)
  // Publish, and what staff see
  const before = await J('GET', `/api/schedule/published?day=${TUE}`)
  check('before Publish, staff see nothing', before.status === 200 && before.json.weeks[0].published === false && before.json.weeks[0].shifts.length === 0, before.json.weeks[0])
  const pub = await M('POST', '/api/schedule/publish', { day: TUE })
  check(`published: ${pub.json.shifts} shifts`, pub.status === 200 && pub.json.shifts === 3, pub.json)
  const after = await J('GET', `/api/schedule/published?day=${TUE}`)
  check('now staff see the published copy, with names', after.json.weeks[0].published && after.json.weeks[0].shifts.length === 3 && after.json.weeks[0].shifts.some((x: any) => x.name === 'Jess T' && x.end === '01:00'), after.json.weeks[0].shifts)
  await M('PATCH', `/api/schedule/shifts/${shiftId}`, { start: '17:00' })
  const stale = await J('GET', `/api/schedule/published?day=${TUE}`)
  const w2 = await M('GET', `/api/schedule/week?day=${TUE}`)
  check('an edit after publishing waits for the next Publish', stale.json.weeks[0].shifts.some((x: any) => x.start === '16:00') && w2.json.unpublishedChanges === true, [stale.json.weeks[0].shifts.map((x: any) => x.start), w2.json.unpublishedChanges])
  const cp = await M('POST', '/api/schedule/copy', { fromDay: TUE, toDay: '2026-12-08' })
  check(`copy the week onto the next: ${cp.json.shifts} shifts`, cp.status === 200 && cp.json.shifts === 3, cp.json)
  const again = await M('POST', '/api/schedule/copy', { fromDay: TUE, toDay: '2026-12-08' })
  check('copying onto a week that has shifts asks first', again.status === 409 && /Replace/.test(again.json.error), again.json)
}

console.log('\n══════════ 4. time off ══════════')
{
  const past = await J('POST', '/api/schedule/time-off', { day: '2020-01-01' })
  check("a day that's gone is refused", past.status === 400 && /already gone/.test(past.json.error), past.json)
  const req = await J('POST', '/api/schedule/time-off', { day: TUE, note: 'Wedding' })
  check('Jess asks for Tuesday off', req.status === 200 && req.json.request.status === 'pending' && req.json.request.userId === jess.id, req.json)
  const dup = await J('POST', '/api/schedule/time-off', { day: TUE })
  check('…once', dup.status === 409, dup.json)
  const self = await J('PUT', `/api/schedule/time-off/${req.json.request.id}`, { status: 'approved' })
  check('she may not approve her own', self.status === 403, self.json)
  const ok = await M('PUT', `/api/schedule/time-off/${req.json.request.id}`, { status: 'approved' })
  check('a manager approves it, by name', ok.status === 200 && ok.json.request.status === 'approved' && ok.json.request.decidedByName === 'Pat T', ok.json)
  const w = await M('GET', `/api/schedule/week?day=${TUE}`)
  check('her Tuesday shifts are flagged: she has the day off', w.json.shifts.filter((x: any) => x.userId === jess.id && x.day === TUE).every((x: any) => x.onTimeOff), w.json.shifts.map((x: any) => [x.name, x.onTimeOff]))
  const mine = await J('GET', '/api/schedule/time-off/mine')
  check('she sees her own requests', mine.json.requests.length === 1 && mine.json.requests[0].status === 'approved')
}

console.log(`\nbar-schedule: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)

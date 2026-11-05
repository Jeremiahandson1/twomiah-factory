// Availability and swaps depth (restaurant-bar parity #10, 7shifts): one-day availability beside the weekly pattern (same approval,
// same warning on the schedule), a manager setting that lets swaps and pick-ups go through with no approval, a request that lapses
// when its shift is about to start (the hourly pass), and one that cancels itself when the schedule is published again with its
// shift changed. Run against the real server; the first block is the arithmetic alone.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'
import { datedRefusal, worksWithinOn } from '../server/crm/bar/barAvailability.ts'
import { shiftSpan } from '../server/crm/bar/barSchedulePlan.ts'

describe('one-day availability arithmetic', () => {
  const weekly = [{ dow: 2, start: '17:00', end: '23:59' }]                       // Tuesday evenings only
  test('a one-day entry replaces the weekly windows for that date only', () => {
    // 2026-11-03 is a Tuesday, 2026-11-10 the next.
    expect(worksWithinOn(weekly, [], '2026-11-03', '18:00', '22:00')).toBe(true)
    expect(worksWithinOn(weekly, [{ day: '2026-11-03', mode: 'off' }], '2026-11-03', '18:00', '22:00')).toBe(false)
    expect(worksWithinOn(weekly, [{ day: '2026-11-03', mode: 'off' }], '2026-11-10', '18:00', '22:00')).toBe(true)
    // A Wednesday the weekly pattern rules out, opened for one day.
    expect(worksWithinOn(weekly, [], '2026-11-04', '12:00', '16:00')).toBe(false)
    expect(worksWithinOn(weekly, [{ day: '2026-11-04', mode: 'free' }], '2026-11-04', '12:00', '16:00')).toBe(true)
    expect(worksWithinOn(weekly, [{ day: '2026-11-04', mode: 'between', start: '10:00', end: '14:00' }], '2026-11-04', '11:00', '13:00')).toBe(true)
    expect(worksWithinOn(weekly, [{ day: '2026-11-04', mode: 'between', start: '10:00', end: '14:00' }], '2026-11-04', '11:00', '15:00')).toBe(false)
  })
  test('a person with no weekly windows is free, except on a day they ruled out; a late night needs the next day too', () => {
    expect(worksWithinOn([], [{ day: '2026-11-05', mode: 'off' }], '2026-11-04', '12:00', '16:00')).toBe(true)
    expect(worksWithinOn([], [{ day: '2026-11-05', mode: 'off' }], '2026-11-05', '12:00', '16:00')).toBe(false)
    // Wednesday night into Thursday's small hours, with Thursday ruled out.
    expect(worksWithinOn([], [{ day: '2026-11-05', mode: 'off' }], '2026-11-04', '22:00', '01:00')).toBe(false)
  })
  test('an entry that makes no sense is refused in words', () => {
    expect(datedRefusal({ day: '2026-11-05', mode: 'off' }, '2026-11-01')).toBeNull()
    expect(datedRefusal({ day: '2026-10-05', mode: 'off' }, '2026-11-01')).toContain('already gone')
    expect(datedRefusal({ day: 'nope', mode: 'off' }, '2026-11-01')).toContain('Which day')
    expect(datedRefusal({ day: '2026-11-05', mode: 'sometimes' }, '2026-11-01')).toContain('cannot')
    expect(datedRefusal({ day: '2026-11-05', mode: 'between', start: '18:00', end: '12:00' }, '2026-11-01')).toContain('ends after it starts')
  })
})

let k: Awaited<ReturnType<typeof bootFood>>
let S: (method: string, path: string, body?: unknown) => Promise<any>
let V: (method: string, path: string, body?: unknown) => Promise<any>
let serverId = ''
const ON = ['contacts', 'bar_schedule']
const ALL = [...ON, 'bar_availability', 'bar_shift_swaps']
const plus = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const dowOf = (day: string) => new Date(day + 'T12:00:00Z').getUTCDay()
const shiftOn = async (userId: string, day: string, start = '17:00', end = '23:00', position = 'Bar') => (await k.M('POST', '/api/schedule/shifts', { userId, day, start, end, position })).json.shift
const publish = (day: string) => k.M('POST', '/api/schedule/publish', { day })
async function seat(email: string, role: string) {
  const [u] = await (k.t.db as any).insert(k.S.user).values({ email, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: email.split('@')[0], lastName: 'Seat', role, companyId: k.companyId }).returning()
  const tok = (await (await k.t.call('/api/auth/login', { method: 'POST', json: { email, password: 'Seat-pass-1' } })).json()).accessToken
  const call = async (method: string, path: string, body?: unknown) => { const r = await k.t.call(path, { method, headers: { Authorization: `Bearer ${tok}`, host: 'bar.test' }, ...(body === undefined ? {} : { json: body }) }); const text = await r.text(); let j: any = text; try { j = JSON.parse(text) } catch {} return { status: r.status, json: j } }
  return { id: u.id as string, call }
}
const status = async (id: string) => ((await (k.t.db as any).select().from(k.S.barShiftRequest).where(eq(k.S.barShiftRequest.id, id)))[0]).status as string
const shiftRow = async (id: string) => (await (k.t.db as any).select().from(k.S.barScheduleShift).where(eq(k.S.barScheduleShift.id, id)))[0]
const jobs = () => (k.t.services.crm as any).eventJobs
let tz = 'America/Chicago'

describe('on the real server', () => {
  beforeAll(async () => {
    k = await bootFood({ features: ALL })
    const s = await seat('server@bar.test', 'field'); serverId = s.id; S = s.call
    V = (await seat('viewer@bar.test', 'viewer')).call
    tz = (await k.M('GET', `/api/schedule/week?day=${plus(0)}`)).json.tz
  }, 60_000)
  afterAll(() => k.restore())

  test('one-day availability: asked, approved by a manager, flagged on the week grid and warned when placing; a manager can set it directly', async () => {
    const day = plus(6), dow = dowOf(day)
    // Closed with the feature off; a read-only seat cannot reach the manager side.
    await k.features(ON)
    expect((await k.B('GET', '/api/schedule/availability/dates/mine')).status).toBe(403)
    await k.features(ALL)
    expect((await V('GET', '/api/schedule/availability/dates')).status).toBe(403)
    expect((await k.B('GET', '/api/schedule/availability/dates')).status).toBe(403)
    expect((await k.B('PUT', `/api/schedule/availability/dates/user/${serverId}`, { day, mode: 'off' })).status).toBe(403)

    const early = await shiftOn(k.ids.bartender, day, '12:00', '16:00')
    const flagged = async () => (await k.M('GET', `/api/schedule/week?day=${day}`)).json.shifts.find((s: any) => s.id === early.id).outsideAvailability
    expect(await flagged()).toBe(false)
    // Bad asks are refused in words.
    expect((await k.B('POST', '/api/schedule/availability/dates/mine', { day: plus(-3), mode: 'off' })).json.error).toContain('already gone')
    expect((await k.B('POST', '/api/schedule/availability/dates/mine', { day, mode: 'between', start: '18:00', end: '12:00' })).status).toBe(400)
    // Asked: waits for a manager, binds nothing yet.
    const asked = await k.B('POST', '/api/schedule/availability/dates/mine', { day, mode: 'off', note: 'Dentist' })
    expect(asked.status).toBe(200); expect(asked.json.entry).toMatchObject({ day, mode: 'off', status: 'pending', note: 'Dentist' })
    expect((await k.B('GET', '/api/schedule/availability/dates/mine')).json.pending.map((x: any) => x.day)).toEqual([day])
    expect(await flagged()).toBe(false)
    const mgr = await k.M('GET', '/api/schedule/availability/dates')
    expect(mgr.json.pending.map((x: any) => [x.name.includes('Bartender'), x.day, x.mode])).toEqual([[true, day, 'off']])
    expect(k.mails.map((m) => m.subject)).toContain('Availability change to approve')
    // A second ask for the same day replaces the first.
    await k.B('POST', '/api/schedule/availability/dates/mine', { day, mode: 'off', note: 'Dentist, again' })
    expect((await k.M('GET', '/api/schedule/availability/dates')).json.pending.length).toBe(1)
    // Approved: now the shift is flagged, and placing another there warns.
    const id = (await k.M('GET', '/api/schedule/availability/dates')).json.pending[0].id
    expect((await V('POST', `/api/schedule/availability/dates/${id}/decision`, { status: 'approved' })).status).toBe(403)
    expect((await k.M('POST', `/api/schedule/availability/dates/${id}/decision`, { status: 'approved' })).status).toBe(200)
    expect((await k.B('GET', '/api/schedule/availability/dates/mine')).json.approved.map((x: any) => x.day)).toEqual([day])
    expect(await flagged()).toBe(true)
    const placed = await k.M('POST', '/api/schedule/shifts', { userId: k.ids.bartender, day, start: '18:00', end: '22:00' })
    expect(placed.status).toBe(200); expect(placed.json.warning).toContain('cannot work then')
    // The next week, same weekday: not affected.
    const next = await k.M('POST', '/api/schedule/shifts', { userId: k.ids.bartender, day: plus(13), start: '18:00', end: '22:00' })
    expect(dowOf(plus(13))).toBe(dow); expect(next.json.warning).toBeNull()
    // A denied ask leaves what was approved alone; a manager can take the entry away, or set one directly.
    await k.B('POST', '/api/schedule/availability/dates/mine', { day, mode: 'free' })
    const second = (await k.M('GET', '/api/schedule/availability/dates')).json.pending[0]
    expect((await k.M('POST', `/api/schedule/availability/dates/${second.id}/decision`, { status: 'denied' })).status).toBe(200)
    expect(await flagged()).toBe(true)
    const direct = await k.M('PUT', `/api/schedule/availability/dates/user/${serverId}`, { day, mode: 'between', start: '17:00', end: '23:59' })
    expect(direct.json.entry).toMatchObject({ mode: 'between', status: 'approved', start: '17:00', end: '23:59' })
    const mine = (await k.M('GET', '/api/schedule/availability/dates')).json.approved.find((x: any) => x.userId === serverId)
    expect(mine.day).toBe(day)
    expect((await k.M('DELETE', `/api/schedule/availability/dates/${mine.id}`)).status).toBe(200)
    const bart = (await k.M('GET', '/api/schedule/availability/dates')).json.approved.find((x: any) => x.userId === k.ids.bartender)
    await k.M('DELETE', `/api/schedule/availability/dates/${bart.id}`)
    expect(await flagged()).toBe(false)
    // A pending ask can be taken back by the person.
    await k.B('POST', '/api/schedule/availability/dates/mine', { day: plus(20), mode: 'off' })
    const wid = (await k.B('GET', '/api/schedule/availability/dates/mine')).json.pending[0].id
    expect((await S('DELETE', `/api/schedule/availability/dates/mine/${wid}`)).status).toBe(404)   // not theirs
    expect((await k.B('DELETE', `/api/schedule/availability/dates/mine/${wid}`)).status).toBe(200)
    expect((await k.B('GET', '/api/schedule/availability/dates/mine')).json.pending).toEqual([])
  })

  test('the manager setting: swaps and pick-ups go through with no approval, by the same rules', async () => {
    // Off by default: nothing changes for a venue that does not touch it.
    expect((await k.M('GET', '/api/schedule/swap-settings')).json.settings).toEqual({ approveSwaps: true, approvePickups: true, expireHoursBefore: 0 })
    expect((await S('PUT', '/api/schedule/swap-settings', { approvePickups: false })).status).toBe(403)       // a floor seat
    expect((await k.M('PUT', '/api/schedule/swap-settings', { expireHoursBefore: 100 })).status).toBe(400)
    const day = plus(8), day2 = plus(9)
    const mine = await shiftOn(k.ids.bartender, day), theirs = await shiftOn(serverId, day2, '11:00', '16:00', 'Floor')
    await publish(day); await publish(day2)
    const held = (await k.B('POST', '/api/schedule/swaps', { kind: 'give', shiftId: mine.id })).json.request
    expect((await S('POST', `/api/schedule/swaps/${held.id}/claim`)).json).toMatchObject({ automatic: false, request: { status: 'pending' } })
    expect((await shiftRow(mine.id)).userId).toBe(k.ids.bartender)                                            // still waits for a manager
    await k.B('POST', `/api/schedule/swaps/${held.id}/cancel`)

    // Pick-ups need no approval: the shift moves the moment it is taken.
    const set = await k.M('PUT', '/api/schedule/swap-settings', { approvePickups: false })
    expect(set.json.settings).toEqual({ approveSwaps: true, approvePickups: false, expireHoursBefore: 0 })
    expect((await k.B('GET', '/api/schedule/swaps/mine')).json.settings.approvePickups).toBe(false)
    const give = (await k.B('POST', '/api/schedule/swaps', { kind: 'give', shiftId: mine.id })).json.request
    const took = await S('POST', `/api/schedule/swaps/${give.id}/claim`)
    expect(took.status).toBe(200); expect(took.json).toMatchObject({ automatic: true, request: { status: 'approved' } })
    expect((await shiftRow(mine.id)).userId).toBe(serverId)
    const pub = ((await k.B('GET', `/api/schedule/published?day=${day}`)).json.weeks as any[]).flatMap((w) => w.shifts).find((e: any) => e.id === mine.id)
    expect(pub.userId).toBe(serverId)
    expect(k.mails.map((m) => m.subject)).toContain('A shift swap went through')

    // Same rules: a pick-up that double-books the person is refused and the shift stays on offer.
    const clash = await shiftOn(k.ids.bartender, plus(11), '17:00', '23:00')
    await shiftOn(serverId, plus(11), '20:00', '23:59')
    const g2 = (await k.B('POST', '/api/schedule/swaps', { kind: 'give', shiftId: clash.id })).json.request
    const refused = await S('POST', `/api/schedule/swaps/${g2.id}/claim`)
    expect(refused.status).toBe(409); expect(refused.json.error).toContain('cannot go through without a manager')
    expect(await status(g2.id)).toBe('open'); expect((await shiftRow(clash.id)).userId).toBe(k.ids.bartender)
    await k.B('POST', `/api/schedule/swaps/${g2.id}/cancel`)

    // Swaps are a separate switch: still wait for a manager until it is turned off too.
    const ask = (await k.B('POST', '/api/schedule/swaps', { kind: 'swap', shiftId: (await shiftOn(k.ids.bartender, plus(14))).id, withShiftId: theirs.id })).json.request
    expect((await S('POST', `/api/schedule/swaps/${ask.id}/accept`)).json).toMatchObject({ automatic: false, request: { status: 'pending' } })
    await k.B('POST', `/api/schedule/swaps/${ask.id}/cancel`)
    await k.M('PUT', '/api/schedule/swap-settings', { approveSwaps: false })
    const mineB = await shiftOn(k.ids.bartender, plus(15), '17:00', '22:00')
    const ask2 = (await k.B('POST', '/api/schedule/swaps', { kind: 'swap', shiftId: mineB.id, withShiftId: theirs.id })).json.request
    const accepted = await S('POST', `/api/schedule/swaps/${ask2.id}/accept`)
    expect(accepted.json).toMatchObject({ automatic: true, request: { status: 'approved' } })
    expect((await shiftRow(mineB.id)).userId).toBe(serverId); expect((await shiftRow(theirs.id)).userId).toBe(k.ids.bartender)
    await k.M('PUT', '/api/schedule/swap-settings', { approveSwaps: true, approvePickups: true })
  })

  test('a request expires before its shift starts (the hourly pass), and a shift about to start takes no new request', async () => {
    const day = plus(12)
    const s1 = await shiftOn(k.ids.bartender, day, '17:00', '23:00'), s2 = await shiftOn(serverId, day, '07:00', '12:00', 'Floor')
    await publish(day)
    const give = (await k.B('POST', '/api/schedule/swaps', { kind: 'give', shiftId: s1.id })).json.request
    const swap = (await k.B('POST', '/api/schedule/swaps', { kind: 'swap', shiftId: (await shiftOn(k.ids.bartender, day, '13:00', '15:00')).id, withShiftId: s2.id })).json.request
    const start = shiftSpan(day, '17:00', '23:00', tz).a
    // An hour before: nothing has lapsed.
    expect(await jobs().runShiftExpiry(new Date(start.getTime() - 3600_000 - 1))).toBe(1)   // the 13:00 swap's own shift started earlier that day (13:00 < 17:00)
    expect(await status(swap.id)).toBe('expired'); expect(await status(give.id)).toBe('open')
    // The shift's start: the give lapses; a second pass changes nothing.
    expect(await jobs().runShiftExpiry(start)).toBe(1)
    expect(await status(give.id)).toBe('expired')
    expect(await jobs().runShiftExpiry(start)).toBe(0)
    expect(k.mails.map((m) => `${m.to} | ${m.subject}`)).toContain('bartender@bar.test | A shift swap ran out of time')
    // Nobody can take, or a manager approve, what has lapsed.
    expect((await S('POST', `/api/schedule/swaps/${give.id}/claim`)).status).toBe(409)
    expect((await k.M('PUT', `/api/schedule/swaps/${give.id}`, { status: 'approved' })).status).toBe(409)
    expect((await k.B('POST', `/api/schedule/swaps/${give.id}/cancel`)).status).toBe(409)       // already settled
    // The lapse window is the manager's: with 72 hours set, a shift starting in under three days takes no request.
    const near = await shiftOn(k.ids.bartender, plus(2), '17:00', '23:00')
    await k.M('PUT', '/api/schedule/swap-settings', { expireHoursBefore: 72 })
    const tooSoon = await k.B('POST', '/api/schedule/swaps', { kind: 'give', shiftId: near.id })
    expect(tooSoon.status).toBe(409); expect(tooSoon.json.error).toContain('too soon')
    const farther = await shiftOn(k.ids.bartender, plus(30), '17:00', '23:00')
    expect((await k.B('POST', '/api/schedule/swaps', { kind: 'give', shiftId: farther.id })).status).toBe(200)
    await k.M('PUT', '/api/schedule/swap-settings', { expireHoursBefore: 0 })
    // The pass only touches a business that has swaps on.
    await k.features(ON)
    expect(await jobs().runShiftExpiry(new Date(Date.now() + 365 * 86400_000))).toBe(0)
    await k.features(ALL)
  })

  test('a request cancels itself when the schedule is published again with its shift changed', async () => {
    const day = plus(16)
    const changing = await shiftOn(k.ids.bartender, day, '17:00', '23:00'), steady = await shiftOn(k.ids.manager, day, '17:00', '23:00')
    await publish(day)
    const a = (await k.B('POST', '/api/schedule/swaps', { kind: 'give', shiftId: changing.id })).json.request
    const bReq = (await k.M('POST', '/api/schedule/swaps', { kind: 'give', shiftId: steady.id })).json.request
    // Edited but not yet published: the request stands (a manager would still be refused the stale move on approval).
    await k.M('PATCH', `/api/schedule/shifts/${changing.id}`, { start: '18:00' })
    expect(await status(a.id)).toBe('open')
    const mails = k.mails.length
    const pub = await publish(day)
    expect(pub.json.swapsCancelled).toBe(1)
    expect(await status(a.id)).toBe('schedule_changed'); expect(await status(bReq.id)).toBe('open')
    expect(k.mails.slice(mails).map((m) => `${m.to} | ${m.subject}`)).toContain('bartender@bar.test | A shift swap was cancelled')
    expect((await S('POST', `/api/schedule/swaps/${a.id}/claim`)).status).toBe(409)
    const offered = (await S('GET', '/api/schedule/swaps/mine')).json.onOffer.map((x: any) => x.id)
    expect(offered).toContain(bReq.id); expect(offered).not.toContain(a.id)
    expect((await k.M('GET', '/api/schedule/swaps')).json.recent.map((x: any) => [x.id, x.status])).toContainEqual([a.id, 'schedule_changed'])
    // Published again with nothing changed: the other one stands.
    expect((await publish(day)).json.swapsCancelled).toBe(0)
    // Someone else's shift moved to another person: a swap offered on it is cancelled as well.
    const swapAsk = (await k.B('POST', '/api/schedule/swaps', { kind: 'swap', shiftId: changing.id, withShiftId: steady.id })).json
    expect(swapAsk.error).toContain('already in a request')                                                  // steady is on offer
    await k.M('DELETE', `/api/schedule/shifts/${steady.id}`)
    expect((await publish(day)).status).toBe(200)
  })
})

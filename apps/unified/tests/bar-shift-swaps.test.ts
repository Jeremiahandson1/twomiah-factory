// Availability windows and shift swaps (restaurant-bar-depth #10): staff say when they can work, the week grid flags a shift
// outside it; staff give a shift away or swap it, a colleague takes it, and a manager approves before anything moves.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootFood } from './foodKit.ts'
import { windowsRefusal, worksWithin } from '../server/crm/bar/barAvailability.ts'

describe('the availability arithmetic', () => {
  const tue = [{ dow: 2, start: '17:00', end: '23:59' }, { dow: 3, start: '00:00', end: '02:00' }]
  test('no windows means free; with windows a shift must sit inside them, across midnight too', () => {
    expect(worksWithin([], '2026-11-03', '09:00', '17:00')).toBe(true)
    expect(worksWithin(tue, '2026-11-03', '17:00', '23:00')).toBe(true)       // Tuesday evening
    expect(worksWithin(tue, '2026-11-03', '16:00', '23:00')).toBe(false)      // starts before the window
    expect(worksWithin(tue, '2026-11-04', '17:00', '23:00')).toBe(false)      // Wednesday: no window
    expect(worksWithin(tue, '2026-11-03', '22:00', '01:00')).toBe(true)       // Tuesday night into Wednesday's small hours
    expect(worksWithin(tue, '2026-11-03', '22:00', '03:00')).toBe(false)      // past what Wednesday allows
  })
  test('windows that do not make sense are refused in words', () => {
    expect(windowsRefusal([{ dow: 2, start: '17:00', end: '23:00' }])).toBeNull()
    expect(windowsRefusal([{ dow: 9, start: '17:00', end: '23:00' }])).toContain('Sunday to Saturday')
    expect(windowsRefusal([{ dow: 2, start: '23:00', end: '17:00' }])).toContain('Tuesday: a window ends after it starts')
    expect(windowsRefusal([{ dow: 2, start: '10:00', end: '14:00' }, { dow: 2, start: '13:00', end: '18:00' }])).toContain('overlap')
    expect(windowsRefusal('x')).toContain('list')
  })
})

let k: Awaited<ReturnType<typeof bootFood>>
let S: (method: string, path: string, body?: unknown) => Promise<any>     // a second floor seat
let V: (method: string, path: string, body?: unknown) => Promise<any>     // a seat with no schedule at all
let serverId = ''
const ON = ['contacts', 'bar_schedule']
const ALL = [...ON, 'bar_availability', 'bar_shift_swaps']
const plus = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const shiftOn = async (userId: string, day: string, start = '17:00', end = '23:00', position = 'Bar') => (await k.M('POST', '/api/schedule/shifts', { userId, day, start, end, position })).json.shift
const publish = (day: string) => k.M('POST', '/api/schedule/publish', { day })
const published = async (day: string) => ((await k.B('GET', `/api/schedule/published?day=${day}`)).json.weeks as any[]).flatMap((w) => w.shifts)
async function seat(email: string, role: string) {
  const [u] = await (k.t.db as any).insert(k.S.user).values({ email, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: email.split('@')[0], lastName: 'Seat', role, companyId: k.companyId }).returning()
  const tok = (await (await k.t.call('/api/auth/login', { method: 'POST', json: { email, password: 'Seat-pass-1' } })).json()).accessToken
  const call = async (method: string, path: string, body?: unknown) => { const r = await k.t.call(path, { method, headers: { Authorization: `Bearer ${tok}`, host: 'bar.test' }, ...(body === undefined ? {} : { json: body }) }); const text = await r.text(); let j: any = text; try { j = JSON.parse(text) } catch {} return { status: r.status, json: j } }
  return { id: u.id as string, call }
}

describe('on the real server', () => {
  beforeAll(async () => {
    k = await bootFood({ features: ON })
    const s = await seat('server@bar.test', 'field'); serverId = s.id; S = s.call
    V = (await seat('viewer@bar.test', 'viewer')).call
  }, 60_000)
  afterAll(() => k.restore())

  test('switched off, closed; a read-only seat cannot reach the manager side; a floor seat cannot touch the manager side', async () => {
    expect((await k.B('GET', '/api/schedule/availability/mine')).status).toBe(403)
    expect((await k.B('GET', '/api/schedule/swaps/mine')).status).toBe(403)
    await k.features(ALL)
    expect((await V('GET', '/api/schedule/availability')).status).toBe(403)
    expect((await V('GET', '/api/schedule/swaps')).status).toBe(403)
    expect((await k.B('GET', '/api/schedule/availability')).status).toBe(403)
    expect((await k.B('PUT', `/api/schedule/availability/${serverId}`, { windows: [] })).status).toBe(403)
    expect((await k.B('GET', '/api/schedule/swaps')).status).toBe(403)
    expect((await k.B('PUT', '/api/schedule/swaps/x', { status: 'approved' })).status).toBe(403)
  })

  test('a person submits their windows, a manager decides; the week grid flags a shift outside them', async () => {
    const day = plus(5); const dow = new Date(day + 'T12:00:00Z').getUTCDay()
    const sent = await k.B('PUT', '/api/schedule/availability/mine', { windows: [{ dow, start: '17:00', end: '23:59' }] })
    expect(sent.status).toBe(200)
    expect(sent.json.approved).toEqual([]); expect(sent.json.pending).toEqual([{ dow, start: '17:00', end: '23:59' }])
    expect((await k.B('PUT', '/api/schedule/availability/mine', { windows: [{ dow, start: '23:00', end: '17:00' }] })).status).toBe(400)
    // Nothing is binding until a manager says so: a shift before 17:00 is not flagged yet.
    const early = await shiftOn(k.ids.bartender, day, '12:00', '16:00')
    expect((await k.M('GET', `/api/schedule/week?day=${day}`)).json.shifts.find((s: any) => s.id === early.id).outsideAvailability).toBe(false)
    const all = await k.M('GET', '/api/schedule/availability')
    expect(all.json.people.find((p: any) => p.userId === k.ids.bartender).pending).toEqual([{ dow, start: '17:00', end: '23:59' }])
    expect((await k.M('POST', `/api/schedule/availability/${k.ids.bartender}/decision`, { status: 'approved' })).status).toBe(200)
    expect((await k.B('GET', '/api/schedule/availability/mine')).json).toEqual({ approved: [{ dow, start: '17:00', end: '23:59' }], pending: null })
    const week = (await k.M('GET', `/api/schedule/week?day=${day}`)).json.shifts
    expect(week.find((s: any) => s.id === early.id).outsideAvailability).toBe(true)
    const placed = await k.M('POST', '/api/schedule/shifts', { userId: k.ids.bartender, day, start: '18:00', end: '22:00' })
    expect(placed.json.warning).toBeNull()
    const placedBad = await k.M('POST', '/api/schedule/shifts', { userId: k.ids.bartender, day, start: '08:00', end: '11:00' })
    expect(placedBad.status).toBe(200); expect(placedBad.json.warning).toContain('cannot work then')
    // A denied request leaves the approved windows alone; a manager can set someone's directly.
    await k.B('PUT', '/api/schedule/availability/mine', { windows: [{ dow: (dow + 1) % 7, start: '08:00', end: '12:00' }] })
    await k.M('POST', `/api/schedule/availability/${k.ids.bartender}/decision`, { status: 'denied' })
    expect((await k.B('GET', '/api/schedule/availability/mine')).json.approved).toEqual([{ dow, start: '17:00', end: '23:59' }])
    expect((await k.M('PUT', `/api/schedule/availability/${serverId}`, { windows: [{ dow: 1, start: '10:00', end: '18:00' }] })).json.windows.length).toBe(1)
    // Off, the grid is exactly what it was: no flag at all.
    await k.features(ON)
    expect((await k.M('GET', `/api/schedule/week?day=${day}`)).json.shifts[0].outsideAvailability).toBeUndefined()
    await k.features(ALL)
    // Clear availability for the swap tests.
    await k.M('PUT', `/api/schedule/availability/${k.ids.bartender}`, { windows: [] }); await k.M('PUT', `/api/schedule/availability/${serverId}`, { windows: [] })
  })

  test('give a shift away: a colleague takes it, a manager approves, and the shift and the published copy change hands', async () => {
    const day = plus(10)
    const s1 = await shiftOn(k.ids.bartender, day)
    await publish(day)
    const asked = await k.B('POST', '/api/schedule/swaps', { kind: 'give', shiftId: s1.id, note: 'Wedding' })
    expect(asked.status).toBe(200); expect(asked.json.request.status).toBe('open')
    expect((await k.B('POST', '/api/schedule/swaps', { kind: 'give', shiftId: s1.id })).status).toBe(409)                       // already asked
    expect((await S('POST', '/api/schedule/swaps', { kind: 'give', shiftId: s1.id })).status).toBe(404)                          // not theirs
    expect((await k.B('POST', '/api/schedule/swaps', { kind: 'give', day: plus(-2), start: '17:00' })).status).toBe(404)
    const seen = await S('GET', '/api/schedule/swaps/mine')
    expect(seen.json.onOffer.map((x: any) => [x.fromName.includes('Bartender'), x.shift.day, x.note])).toEqual([[true, day, 'Wedding']])
    expect((await k.B('POST', `/api/schedule/swaps/${asked.json.request.id}/claim`)).status).toBe(400)   // own shift: refused
    const claimed = await S('POST', `/api/schedule/swaps/${asked.json.request.id}/claim`)
    expect(claimed.status).toBe(200); expect(claimed.json.request).toMatchObject({ status: 'pending', toUserId: serverId })
    expect((await k.M('GET', '/api/schedule/swaps?tile=pending')).json.pending.map((x: any) => x.id)).toEqual([asked.json.request.id])
    // Nothing has moved yet.
    expect((await published(day)).find((e: any) => e.id === s1.id).userId).toBe(k.ids.bartender)
    const done = await k.M('PUT', `/api/schedule/swaps/${asked.json.request.id}`, { status: 'approved' })
    expect(done.status).toBe(200); expect(done.json.request.status).toBe('approved')
    const row = (await (k.t.db as any).select().from(k.S.barScheduleShift).where(eq(k.S.barScheduleShift.id, s1.id)))[0]
    expect(row.userId).toBe(serverId)
    const pub = (await published(day)).find((e: any) => e.id === s1.id)
    expect(pub.userId).toBe(serverId); expect(pub.name).toContain('server')
    expect((await k.M('PUT', `/api/schedule/swaps/${asked.json.request.id}`, { status: 'approved' })).status).toBe(409)   // already decided
    // Everyone concerned was told: the business when it needed approving, the poster when it was taken, both when it was decided.
    const sent = k.mails.map((m) => `${m.to} | ${m.subject}`)
    expect(sent).toContain('owner@bar.test | A shift swap to approve')
    expect(sent.filter((x) => x.endsWith('Someone will take your shift')).length).toBeGreaterThan(0)
    expect(sent).toContain('bartender@bar.test | Your shift swap was approved')
    expect(sent).toContain('server@bar.test | Your shift swap was approved')
  })

  test('a manager cannot approve a move that double-books someone or lands on their day off; they can deny', async () => {
    const day = plus(11)
    const mine = await shiftOn(k.ids.bartender, day, '17:00', '23:00')
    await shiftOn(serverId, day, '20:00', '23:59')
    const a = (await k.B('POST', '/api/schedule/swaps', { kind: 'give', shiftId: mine.id })).json.request
    await S('POST', `/api/schedule/swaps/${a.id}/claim`)
    const clash = await k.M('PUT', `/api/schedule/swaps/${a.id}`, { status: 'approved' })
    expect(clash.status).toBe(409); expect(clash.json.error).toContain('overlaps a shift they already have')
    expect((await (k.t.db as any).select().from(k.S.barScheduleShift).where(eq(k.S.barScheduleShift.id, mine.id)))[0].userId).toBe(k.ids.bartender)
    expect((await k.M('PUT', `/api/schedule/swaps/${a.id}`, { status: 'denied' })).json.request.status).toBe('denied')
    // Day off.
    const day2 = plus(12)
    const m2 = await shiftOn(k.ids.bartender, day2)
    await (k.t.db as any).insert(k.S.barTimeOff).values({ companyId: k.companyId, userId: serverId, day: day2, status: 'approved' })
    const b = (await k.B('POST', '/api/schedule/swaps', { kind: 'give', shiftId: m2.id })).json.request
    await S('POST', `/api/schedule/swaps/${b.id}/claim`)
    const off = await k.M('PUT', `/api/schedule/swaps/${b.id}`, { status: 'approved' })
    expect(off.status).toBe(409); expect(off.json.error).toContain('day off')
    await k.B('POST', `/api/schedule/swaps/${b.id}/cancel`)
  })

  test('a swap: offered to one person for one of theirs; they accept; a manager approves; both shifts change hands', async () => {
    const d1 = plus(14), d2 = plus(15)
    const mine = await shiftOn(k.ids.bartender, d1, '17:00', '23:00', 'Bar')
    const theirs = await shiftOn(serverId, d2, '11:00', '16:00', 'Floor')
    await publish(d1); await publish(d2)
    expect((await k.B('POST', '/api/schedule/swaps', { kind: 'swap', shiftId: mine.id, withShiftId: mine.id })).status).toBe(400)   // your own
    const ask = await k.B('POST', '/api/schedule/swaps', { kind: 'swap', shiftId: mine.id, withShiftId: theirs.id, note: 'Dentist' })
    expect(ask.status).toBe(200); expect(ask.json.request).toMatchObject({ status: 'offered', toUserId: serverId })
    // Only the person it was offered to answers.
    expect((await k.M('POST', `/api/schedule/swaps/${ask.json.request.id}/accept`)).status).toBe(409)
    const forMe = await S('GET', '/api/schedule/swaps/mine')
    expect(forMe.json.forMe.map((x: any) => [x.id, x.shift.day, x.withShift.day])).toEqual([[ask.json.request.id, d1, d2]])
    // Not yet in the manager's pile.
    expect((await k.M('GET', '/api/schedule/swaps?tile=pending')).json.pending).toEqual([])
    expect((await S('POST', `/api/schedule/swaps/${ask.json.request.id}/accept`)).json.request.status).toBe('pending')
    expect((await k.M('PUT', `/api/schedule/swaps/${ask.json.request.id}`, { status: 'approved' })).status).toBe(200)
    const rows = await (k.t.db as any).select().from(k.S.barScheduleShift)
    expect(rows.find((r: any) => r.id === mine.id).userId).toBe(serverId)
    expect(rows.find((r: any) => r.id === theirs.id).userId).toBe(k.ids.bartender)
    const pub = await published(d1)
    expect(pub.find((e: any) => e.id === mine.id).userId).toBe(serverId)
    expect(pub.find((e: any) => e.id === theirs.id).userId).toBe(k.ids.bartender)
  })

  test('declined, and taken back by the person who asked; nobody else can cancel it', async () => {
    const mine = await shiftOn(k.ids.bartender, plus(20)), theirs = await shiftOn(serverId, plus(21))
    const a = (await k.B('POST', '/api/schedule/swaps', { kind: 'swap', shiftId: mine.id, withShiftId: theirs.id })).json.request
    expect((await S('POST', `/api/schedule/swaps/${a.id}/decline`)).json.request.status).toBe('declined')
    const g = (await k.B('POST', '/api/schedule/swaps', { kind: 'give', shiftId: mine.id })).json.request     // free again after a decline
    expect((await S('POST', `/api/schedule/swaps/${g.id}/cancel`)).status).toBe(403)
    expect((await k.B('POST', `/api/schedule/swaps/${g.id}/cancel`)).json.request.status).toBe('cancelled')
    expect((await S('POST', `/api/schedule/swaps/${g.id}/claim`)).status).toBe(409)
    // A request whose shift a manager has since changed cannot be approved on stale terms.
    const stale = (await k.B('POST', '/api/schedule/swaps', { kind: 'give', shiftId: mine.id })).json.request
    await S('POST', `/api/schedule/swaps/${stale.id}/claim`)
    await k.M('PATCH', `/api/schedule/shifts/${mine.id}`, { userId: k.ids.manager })
    const r = await k.M('PUT', `/api/schedule/swaps/${stale.id}`, { status: 'approved' })
    expect(r.status).toBe(409); expect(r.json.error).toContain('changed')
  })
})

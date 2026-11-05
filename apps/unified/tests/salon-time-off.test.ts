// Team time off and business closed periods (salon parity row 3; server/crm/salon/timeOff.ts, bookBlocks.ts, onlineBooking.ts; feature `book_grid`).
// A stylist asks, a manager approves; only approved time off takes the chair away. A closed period shuts every chair and online booking.
// Both warn the desk (and can be booked over on purpose), are drawn on the Book, and list what is already booked inside them.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts, zonedWallTimeToUtc } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const weekdayOf = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
function next(dow: number, ahead = 3) { let d = addDays(today(), ahead); while (weekdayOf(d) !== dow) d = addDays(d, 1); return d }
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'online_booking', 'invoices', 'book_grid']
const PASSWORD = 'TimeOff-1031-x'

describe('salon: team time off and closed periods', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', ana = '', bea = '', cut = '', client = ''
  const tokens: Record<string, string> = {}
  let ip = 0
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}`, 'x-forwarded-for': `10.4.0.${++ip}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const wall = (d: string, hm: string) => zonedWallTimeToUtc(d, hm, TZ).toISOString()
  const book = (who: string, stylist: string, hm: string, d: string, extra: Record<string, unknown> = {}) =>
    as(who, '/api/appointments', 'POST', { contactId: client, serviceId: cut, stylistId: stylist, startTime: wall(d, hm), ...extra })
  const win = (d: string, days = 1) => `from=${encodeURIComponent(wall(d, '00:00'))}&to=${encodeURIComponent(wall(addDays(d, days), '00:00'))}`

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ, enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, co))
    t.services.features.forgetFeatures()
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    const ids: Record<string, string> = {}
    for (const [key, role] of Object.entries({ ana: 'field', bea: 'field', desk: 'viewer', mgr: 'manager' })) {
      const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role, companyId: co })
      ids[key] = u.id
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${key}@test.example`, password: PASSWORD } })).json()) as any).accessToken
    }
    ;({ ana, bea } = ids as any)
    cut = (await as('owner', '/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 40, bookableOnline: true })).body.id
    client = (await ins(t.schema.contact, { companyId: co, name: 'Off Olive', email: 'olive@example.com', type: 'client' })).id
  }, 120_000)

  const day = next(2, 8)

  test('a stylist asks for her own time off: it waits, blocks nothing, and she cannot approve it or ask for someone else', async () => {
    const mine = await as('ana', '/api/book-blocks/time-off', 'POST', { startTime: wall(day, '09:00'), endTime: wall(day, '17:00'), reason: 'Dentist' })
    expect([mine.status, mine.body.status, mine.body.stylistId, mine.body.affected]).toEqual([201, 'pending', ana, []])
    // pending does not take the chair: the desk books it without a word
    expect((await book('owner', ana, '10:00', day)).status).toBe(201)
    const forBea = await as('ana', '/api/book-blocks/time-off', 'POST', { stylistId: bea, startTime: wall(day, '09:00'), endTime: wall(day, '17:00') })
    expect([forBea.status, forBea.body.code]).toEqual([403, 'OWN_TIME_OFF_ONLY'])
    const self = await as('ana', `/api/book-blocks/time-off/${mine.body.id}/decision`, 'PUT', { status: 'approved' })
    expect([self.status, self.body.code]).toEqual([403, 'MANAGER_ONLY'])
    // the front desk sees the book but cannot ask for or decide time off
    expect((await as('desk', '/api/book-blocks/time-off', 'POST', { stylistId: ana, startTime: wall(day, '09:00'), endTime: wall(day, '10:00') })).status).toBe(403)
    expect((await as('desk', `/api/book-blocks/time-off/${mine.body.id}/decision`, 'PUT', { status: 'approved' })).status).toBe(403)
    // Bea sees neither Ana's pending request nor can remove it; Ana sees her own
    expect((await as('bea', '/api/book-blocks/time-off')).body.data).toHaveLength(0)
    expect((await as('bea', `/api/book-blocks/time-off/${mine.body.id}`, 'DELETE')).status).toBe(404)
    expect((await as('ana', '/api/book-blocks/time-off')).body.data).toHaveLength(1)
  })

  test('a manager approves it: the appointment already inside is listed, the desk is warned (and may book anyway), others are free, the Book draws it', async () => {
    const pending = (await as('mgr', '/api/book-blocks/time-off?status=pending')).body.data
    expect(pending).toHaveLength(1)
    const ok = await as('mgr', `/api/book-blocks/time-off/${pending[0].id}/decision`, 'PUT', { status: 'approved', paid: true })
    expect([ok.status, ok.body.status, ok.body.paid]).toEqual([200, 'approved', true])
    expect(ok.body.affected).toHaveLength(1)
    expect([ok.body.affected[0].clientName, ok.body.affected[0].serviceName]).toEqual(['Off Olive', 'Cut'])
    const told = await book('owner', ana, '11:00', day)
    expect([told.status, told.body.code]).toEqual([409, 'BOOK_BLOCKED'])
    expect(told.body.error ?? told.body.message).toMatch(/ana is off.*Dentist/i)
    expect((await book('owner', bea, '11:00', day)).status).toBe(201)                       // Bea's chair is open
    expect((await book('owner', ana, '18:00', day)).status).toBe(201)                       // after her time off
    expect((await book('owner', ana, '11:00', day, { overrideBlock: true })).status).toBe(201)
    const drawn = (await as('owner', `/api/book-blocks?${win(day)}`)).body.data.filter((b: any) => b.kind === 'time_off')
    expect(drawn).toHaveLength(1)
    expect([drawn[0].readOnly, drawn[0].stylistId, drawn[0].typeName]).toEqual([true, ana, 'Time off'])
    const one = await as('ana', `/api/book-blocks/time-off/${pending[0].id}`)
    expect(one.body.affected.length).toBeGreaterThanOrEqual(1)
    // decided, so Ana can no longer withdraw it
    expect((await as('ana', `/api/book-blocks/time-off/${pending[0].id}`, 'DELETE')).status).toBe(403)
  })

  test('a denied request takes nothing away, and a pending one can be withdrawn by the stylist', async () => {
    const d2 = next(3, 8)
    const req = await as('bea', '/api/book-blocks/time-off', 'POST', { startTime: wall(d2, '09:00'), endTime: wall(d2, '17:00') })
    const no = await as('mgr', `/api/book-blocks/time-off/${req.body.id}/decision`, 'PUT', { status: 'denied', note: 'Busy day' })
    expect([no.status, no.body.status, no.body.decisionNote, no.body.affected]).toEqual([200, 'denied', 'Busy day', []])
    expect((await book('owner', bea, '10:00', d2)).status).toBe(201)
    const again = await as('bea', '/api/book-blocks/time-off', 'POST', { startTime: wall(d2, '09:00'), endTime: wall(d2, '10:00') })
    expect((await as('bea', `/api/book-blocks/time-off/${again.body.id}`, 'DELETE')).status).toBe(200)
    expect((await as('mgr', '/api/book-blocks/time-off/decision', 'PUT', { status: 'maybe' })).status).not.toBe(200)
    expect((await as('mgr', `/api/book-blocks/time-off/${again.body.id}/decision`, 'PUT', { status: 'maybe' })).status).toBe(400)      // approve or deny only
    expect((await as('mgr', `/api/book-blocks/time-off/${again.body.id}/decision`, 'PUT', { status: 'approved' })).status).toBe(404)   // the withdrawn one is gone
  })

  test('any length: a manager enters a six-week leave (a block stops at 14 days) and it starts approved', async () => {
    const start = addDays(today(), 60)
    const long = await as('mgr', '/api/book-blocks/time-off', 'POST', { stylistId: bea, startTime: wall(start, '00:00'), endTime: wall(addDays(start, 42), '00:00'), reason: 'Leave' })
    expect([long.status, long.body.status]).toEqual([201, 'approved'])
    const blockCap = await as('mgr', '/api/book-blocks', 'POST', { stylistId: bea, startTime: wall(start, '00:00'), endTime: wall(addDays(start, 42), '00:00') })
    expect([blockCap.status, blockCap.body.code]).toEqual([400, 'BAD_BLOCK'])
    const mid = addDays(start, 30)
    expect((await book('owner', bea, '10:00', mid)).body.code).toBe('BOOK_BLOCKED')
    const bad = await as('mgr', '/api/book-blocks/time-off', 'POST', { stylistId: bea, startTime: wall(start, '10:00'), endTime: wall(start, '09:00') })
    expect([bad.status, bad.body.code]).toEqual([400, 'BAD_TIME_OFF'])
    expect((await as('mgr', '/api/book-blocks/time-off', 'POST', { startTime: wall(start, '09:00'), endTime: wall(start, '10:00') })).body.code).toBe('BAD_TIME_OFF') // a manager must say whose
  })

  test('closed dates: only a manager sets them; they list what is booked, warn the desk, draw on every column, and online booking offers and takes nothing', async () => {
    const closed = next(2, 12)      // a Tuesday, so online hours (Mon–Fri) would offer it if it were open
    const asked = await as('ana', '/api/book-blocks/closed', 'POST', { name: 'Nope', startDate: closed, endDate: closed })
    expect([asked.status, asked.body.code]).toEqual([403, 'MANAGER_ONLY'])
    await book('owner', bea, '10:00', closed)
    const made = await as('mgr', '/api/book-blocks/closed', 'POST', { name: 'Founders Day', startDate: closed, endDate: addDays(closed, 1) })
    expect([made.status, made.body.name, made.body.affected.length]).toEqual([201, 'Founders Day', 1])
    const told = await book('owner', ana, '12:00', closed)
    expect([told.status, told.body.code]).toEqual([409, 'BOOK_BLOCKED'])
    expect(told.body.error ?? told.body.message).toContain('Founders Day')
    expect((await book('owner', ana, '12:00', addDays(closed, 1))).body.code).toBe('BOOK_BLOCKED')   // the last day counts too
    expect((await book('owner', ana, '12:00', addDays(closed, 2))).status).toBe(201)                    // the day after is open
    const drawn = (await as('ana', `/api/book-blocks?${win(closed, 2)}`)).body.data.filter((b: any) => b.kind === 'closed')
    expect([drawn.length, drawn[0].stylistId, drawn[0].readOnly]).toEqual([1, null, true])
    expect((await as('desk', '/api/book-blocks/closed')).body.data.map((x: any) => x.name)).toContain('Founders Day')
    // online: no time is offered on a closed day and none can be taken
    expect((await as('owner', '/api/booking/settings', 'PATCH', { enabled: true, leadTimeMinutes: 0 })).status).toBe(200)
    const times = await t.call(`/api/book/services/cut/times?date=${closed}`, { headers: { 'x-forwarded-for': '10.9.9.11' } })
    const body = (await times.json()) as any
    expect(((body.data ?? body) as any[]).length).toBe(0)
    const open = await t.call(`/api/book/services/cut/times?date=${addDays(closed, 7)}`, { headers: { 'x-forwarded-for': '10.9.9.12' } })
    expect((((await open.json()) as any).data ?? []).length).toBeGreaterThan(0)
    const r = await t.call('/api/book/services/cut', { method: 'POST', headers: { 'x-forwarded-for': '10.9.9.13' }, json: { date: closed, time: '12:00', name: 'Late Larry', email: 'larry@example.com', phone: '608-555-0123' } })
    expect(r.status).toBe(409)
    // changing or removing: the days open up again
    expect((await as('mgr', `/api/book-blocks/closed/${made.body.id}`, 'PUT', { endDate: closed })).body.endDate).toBe(closed)
    expect((await book('owner', ana, '13:00', addDays(closed, 1))).status).toBe(201)
    expect((await as('mgr', `/api/book-blocks/closed/${made.body.id}`, 'DELETE')).status).toBe(200)
    expect((await book('owner', ana, '14:00', closed)).status).toBe(201)
    const badDates = await as('mgr', '/api/book-blocks/closed', 'POST', { name: 'X', startDate: '2026-02-30', endDate: '2026-03-01' })
    expect([badDates.status, badDates.body.code]).toEqual([400, 'BAD_CLOSED'])
    expect((await as('mgr', '/api/book-blocks/closed', 'POST', { name: 'X', startDate: closed, endDate: addDays(closed, -1) })).body.code).toBe('BAD_CLOSED')
  })

  test('the hours report: paid and unpaid time away, per stylist, from approved time off and from blocks made from a paid/unpaid type', async () => {
    const d3 = next(4, 20)
    const lunch = (await as('owner', '/api/book-blocks/types', 'POST', { name: 'Lunch', defaultMin: 60, paid: false })).body
    const train = (await as('owner', '/api/book-blocks/types', 'POST', { name: 'Training', defaultMin: 120, paid: true })).body
    await as('mgr', '/api/book-blocks', 'POST', { stylistId: ana, startTime: wall(d3, '12:00'), typeId: lunch.id })
    await as('mgr', '/api/book-blocks', 'POST', { stylistId: ana, startTime: wall(d3, '14:00'), typeId: train.id })
    await as('mgr', '/api/book-blocks', 'POST', { stylistId: ana, startTime: wall(d3, '16:00'), endTime: wall(d3, '17:00'), reason: 'No type' })   // not counted: no paid mark
    await as('mgr', '/api/book-blocks/time-off', 'POST', { stylistId: ana, startTime: wall(d3, '08:00'), endTime: wall(d3, '10:00'), paid: true })
    await as('mgr', '/api/book-blocks/time-off', 'POST', { stylistId: ana, startTime: wall(addDays(d3, 1), '08:00'), endTime: wall(addDays(d3, 1), '09:00') })
    const rep = await as('owner', `/api/book-blocks/hours?${win(d3, 2)}`)
    expect(rep.status).toBe(200)
    const a = rep.body.stylists.find((p: any) => p.id === ana)
    expect([a.paidMinutes, a.unpaidMinutes]).toEqual([120 + 120, 60 + 60])
    expect(rep.body.totals).toEqual({ paidMinutes: 240, unpaidMinutes: 120 })
    // a pending request is not counted, and the window clips
    await as('bea', '/api/book-blocks/time-off', 'POST', { startTime: wall(d3, '08:00'), endTime: wall(d3, '12:00') })
    expect((await as('owner', `/api/book-blocks/hours?${win(d3, 2)}`)).body.stylists.find((p: any) => p.id === bea)).toBeUndefined()
    const clipped = await as('owner', `/api/book-blocks/hours?from=${encodeURIComponent(wall(d3, '09:00'))}&to=${encodeURIComponent(wall(d3, '11:00'))}`)
    expect(clipped.body.stylists.find((p: any) => p.id === ana).paidMinutes).toBe(60)
    expect((await as('owner', '/api/book-blocks/hours')).status).toBe(400)
  })

  test('off by default: with the feature off none of it exists', async () => {
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES.filter((f) => f !== 'book_grid') } as any).where(eq(t.schema.company.id, co))
    t.services.features.forgetFeatures()
    for (const path of ['/api/book-blocks/time-off', '/api/book-blocks/closed', '/api/book-blocks/hours']) expect((await as('owner', path)).status).not.toBe(200)
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, co))
    t.services.features.forgetFeatures()
  })
})

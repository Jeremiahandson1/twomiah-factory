// Blocked time in the Book (salon gap #3; server/crm/salon/bookBlocks.ts, appointments.ts BOOK_BLOCKED, onlineBooking.ts). Lunch, training, a day off:
// one stylist's chair, or the whole salon's. The desk is told before booking over it and may do it on purpose; online booking never offers it.
// Off (the default), the routes are closed and nothing in the Book changes.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const weekdayOf = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
function next(dow: number, ahead = 3) { let d = addDays(today(), ahead); while (weekdayOf(d) !== dow) d = addDays(d, 1); return d }
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'online_booking', 'invoices']
const PASSWORD = 'Blocks-1030-x'

describe('salon: blocked time in the Book', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', ana = '', bea = '', cut = '', client = ''
  const tokens: Record<string, string> = {}
  let ip = 0
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}`, 'x-forwarded-for': `10.2.0.${++ip}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  const wall = (d: string, hm: string) => {
    const guess = new Date(`${d}T${hm}:00Z`)
    const parts = tzParts(guess, TZ)
    const offsetMin = (guess.getTime() - new Date(`${parts.date}T${String(Math.floor(parts.minutes / 60)).padStart(2, '0')}:${String(parts.minutes % 60).padStart(2, '0')}:00Z`).getTime()) / 60000
    return new Date(guess.getTime() + offsetMin * 60000).toISOString()
  }
  const day = next(2, 6)
  const block = (who: string, hm1: string, hm2: string, extra: Record<string, unknown> = {}, d = day) =>
    as(who, '/api/book-blocks', 'POST', { startTime: wall(d, hm1), endTime: wall(d, hm2), ...extra })
  const book = (who: string, stylist: string | null, hm: string, extra: Record<string, unknown> = {}, d = day) =>
    as(who, '/api/appointments', 'POST', { contactId: client, serviceId: cut, ...(stylist ? { stylistId: stylist } : {}), startTime: wall(d, hm), ...extra })

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ } as any).where(eq(t.schema.company.id, co))
    await features(FEATURES)
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    const ids: Record<string, string> = {}
    for (const [key, role] of Object.entries({ ana: 'field', bea: 'field', desk: 'viewer' })) {
      const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role, companyId: co })
      ids[key] = u.id
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${key}@test.example`, password: PASSWORD } })).json()) as any).accessToken
    }
    ;({ ana, bea } = ids as any)
    cut = (await as('owner', '/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 40, bookableOnline: true })).body.id
    client = (await ins(t.schema.contact, { companyId: co, name: 'Block Bo', email: 'bo@example.com', type: 'client' })).id
  }, 120_000)

  test('off by default: there is no blocked time to make, and the Book books as before', async () => {
    const r = await block('owner', '12:00', '13:00', { stylistId: ana })
    expect(r.status).not.toBe(201)
    expect(await t.db.select().from(t.schema.bookBlock)).toHaveLength(0)
    expect((await book('owner', ana, '12:15')).status).toBe(201)
  })

  test('a stylist\'s lunch: the desk is told before booking over it, others are free, and "book it anyway" is possible', async () => {
    await features([...FEATURES, 'book_grid'])
    const d2 = next(3, 6)
    const made = await block('owner', '12:00', '13:00', { stylistId: ana, reason: 'Lunch' }, d2)
    expect([made.status, made.body.created]).toEqual([201, 1])
    const told = await book('owner', ana, '12:15', {}, d2)
    expect([told.status, told.body.code]).toEqual([409, 'BOOK_BLOCKED'])
    expect(told.body.error ?? told.body.message).toContain('Lunch')
    expect((await book('owner', bea, '12:15', {}, d2)).status).toBe(201)        // Bea's chair is open
    expect((await book('owner', ana, '13:00', {}, d2)).status).toBe(201)        // right after
    expect((await book('owner', ana, '11:30', {}, d2)).status).toBe(201)        // right before (11:30–12:00)
    const on = await book('owner', ana, '12:15', { overrideBlock: true }, d2)
    expect(on.status).toBe(201)
    // moving into it is the same
    expect((await block('owner', '16:00', '17:00', { stylistId: ana, reason: 'Training' }, d2)).status).toBe(201)
    const other = await book('owner', ana, '15:00', {}, d2)
    const move = await as('owner', `/api/appointments/${other.body.id}`, 'PUT', { startTime: wall(d2, '16:15') })
    expect([move.status, move.body.code]).toEqual([409, 'BOOK_BLOCKED'])
    expect((await as('owner', `/api/appointments/${other.body.id}`, 'PUT', { startTime: wall(d2, '16:15'), overrideBlock: true })).status).toBe(200)
    // completing or checking in an appointment that sits in a block is not a move: it is not refused
    expect((await as('owner', `/api/appointments/${on.body.id}`, 'PUT', { notes: 'ok' })).status).toBe(200)
  })

  test('blocked time can repeat weekly, says how many appointments it lies over, lists by window, and is edited and removed', async () => {
    const d3 = next(4, 6)
    await book('owner', bea, '10:15', {}, d3)
    const r = await block('owner', '10:00', '11:00', { stylistId: bea, reason: 'Staff training', repeatWeeks: 2 }, d3)
    expect([r.status, r.body.created, r.body.appointmentsInside]).toEqual([201, 3, 1])
    const win = await as('owner', `/api/book-blocks?from=${encodeURIComponent(wall(d3, '00:00'))}&to=${encodeURIComponent(wall(addDays(d3, 15), '00:00'))}`)
    expect(win.body.data.filter((b: any) => b.reason === 'Staff training')).toHaveLength(3)
    expect(win.body.data[0].stylistFirstName).toBe('bea')
    const bad = await as('owner', '/api/book-blocks', 'POST', { startTime: wall(d3, '11:00'), endTime: wall(d3, '10:00') })
    expect([bad.status, bad.body.code]).toEqual([400, 'BAD_BLOCK'])
    const edit = await as('owner', `/api/book-blocks/${r.body.id}`, 'PUT', { endTime: wall(d3, '11:30'), reason: 'Training day' })
    expect([edit.status, edit.body.reason]).toEqual([200, 'Training day'])
    expect((await as('owner', `/api/book-blocks/${r.body.id}`, 'DELETE')).status).toBe(200)
    expect((await as('owner', `/api/book-blocks/${r.body.id}`, 'DELETE')).status).toBe(404)
  })

  test('who may: the front desk cannot block time; a stylist narrowed to their own chair blocks only theirs and cannot touch another\'s', async () => {
    const d4 = next(5, 6)
    expect((await block('desk', '09:00', '10:00', { stylistId: ana }, d4)).status).toBe(403)
    expect((await as('owner', '/api/appointments/book-settings', 'PUT', { stylistsSeeOwnBookOnly: true })).status).toBe(200)
    const mine = await block('ana', '09:00', '10:00', {}, d4)                   // no stylist named: her own chair, not the whole salon
    expect(mine.status).toBe(201)
    expect(mine.body.stylistId).toBe(ana)
    const whole = await block('ana', '09:00', '10:00', { stylistId: '' , all: true }, d4)
    expect(whole.body.stylistId).toBe(ana)
    const theirs = await block('ana', '09:00', '10:00', { stylistId: bea }, d4)
    expect([theirs.status, theirs.body.code]).toEqual([403, 'OWN_BOOK_ONLY'])
    const owners = await block('owner', '11:00', '12:00', { stylistId: bea }, d4)
    expect(owners.status).toBe(201)
    // Ana neither sees Bea's block nor can change it
    const seen = await as('ana', `/api/book-blocks?from=${encodeURIComponent(wall(d4, '00:00'))}&to=${encodeURIComponent(wall(d4, '23:59'))}`)
    expect(seen.body.data.every((b: any) => b.stylistId === ana)).toBe(true)
    expect((await as('ana', `/api/book-blocks/${owners.body.id}`, 'DELETE')).status).toBe(404)
    // the salon-wide block is the owner's to make, and everybody sees it
    const everyone = await block('owner', '14:00', '15:00', {}, d4)             // owner is not narrowed: no stylist = the whole salon
    expect([everyone.status, everyone.body.stylistId]).toEqual([201, null])
    expect((await as('ana', `/api/book-blocks?from=${encodeURIComponent(wall(d4, '00:00'))}&to=${encodeURIComponent(wall(d4, '23:59'))}`)).body.data.some((b: any) => b.id === everyone.body.id)).toBe(true)
    expect((await as('ana', `/api/book-blocks/${everyone.body.id}`, 'DELETE')).status).toBe(403)
    expect((await book('owner', bea, '14:15', {}, d4)).body.code).toBe('BOOK_BLOCKED')    // the whole salon's block holds Bea too
    await as('owner', '/api/appointments/book-settings', 'PUT', { stylistsSeeOwnBookOnly: false })
  })

  test('online booking never offers or takes blocked time', async () => {
    const dO = next(1, 20)
    expect((await as('owner', '/api/booking/settings', 'PATCH', { enabled: true, leadTimeMinutes: 0 })).status).toBe(200)
    await block('owner', '12:00', '13:00', { reason: 'Staff lunch' }, dO)
    const times = await t.call(`/api/book/services/cut/times?date=${dO}`, { headers: { 'x-forwarded-for': '10.9.9.1' } })
    const body = (await times.json()) as any
    const offered: string[] = (body.data ?? body).map((x: any) => x.time ?? x)
    expect(offered.length).toBeGreaterThan(0)
    expect(offered).toContain('11:30')
    expect(offered).toContain('13:00')
    expect(offered).not.toContain('12:00')
    expect(offered).not.toContain('12:30')
    const r = await t.call('/api/book/services/cut', { method: 'POST', headers: { 'x-forwarded-for': '10.9.9.2' }, json: { date: dO, time: '12:00', name: 'Late Larry', email: 'larry@example.com', phone: '608-555-0123' } })
    expect(r.status).toBe(409)
  })
})

// Several services in one visit (salon gap #5; server/crm/salon/appointments.ts items, held.ts, visit.ts). A colour with one stylist and a
// cut with another is ONE visit: each service holds only its own stylist for its own stretch, the visit moves as a whole, and closing it
// raises one bill with a line per service. Off (the default), the server refuses the list and everything books as before.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const weekdayOf = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
function next(dow: number, ahead = 3) { let d = addDays(today(), ahead); while (weekdayOf(d) !== dow) d = addDays(d, 1); return d }
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'online_booking', 'invoices']
const PASSWORD = 'Multi-1030-x'

describe('salon: several services in one visit', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', ana = '', bea = '', cat = '', colour = '', cut = '', blow = '', client = '', other = ''
  const tokens: Record<string, string> = {}
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  const day = next(3, 6)
  // Wall-clock time in the salon's zone on `d`.
  const wall = (d: string, hm: string) => {
    const guess = new Date(`${d}T${hm}:00Z`)
    const parts = tzParts(guess, TZ)
    const offsetMin = (guess.getTime() - new Date(`${parts.date}T${String(Math.floor(parts.minutes / 60)).padStart(2, '0')}:${String(parts.minutes % 60).padStart(2, '0')}:00Z`).getTime()) / 60000
    return new Date(guess.getTime() + offsetMin * 60000).toISOString()
  }
  const visit = (who: string, hm: string, items: unknown, extra: Record<string, unknown> = {}, d = day) =>
    as(who, '/api/appointments', 'POST', { contactId: client, startTime: wall(d, hm), items, ...extra })
  const plain = (who: string, stylist: string, hm: string, serviceId = cut, d = day) =>
    as(who, '/api/appointments', 'POST', { contactId: other, serviceId, stylistId: stylist, startTime: wall(d, hm) })
  const colourThenCut = () => [{ serviceId: colour, stylistId: ana }, { serviceId: cut, stylistId: bea }]

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ } as any).where(eq(t.schema.company.id, co))
    await features(FEATURES)
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    const ids: Record<string, string> = {}
    for (const [key, role] of Object.entries({ ana: 'field', bea: 'field', cat: 'field', desk: 'viewer' })) {
      const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role, companyId: co })
      ids[key] = u.id
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${key}@test.example`, password: PASSWORD } })).json()) as any).accessToken
    }
    ;({ ana, bea, cat } = ids as any)
    colour = (await as('owner', '/api/service-menu', 'POST', { name: 'Full Colour', category: 'colour', durationMin: 90, price: 120 })).body.id
    cut = (await as('owner', '/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 40 })).body.id
    blow = (await as('owner', '/api/service-menu', 'POST', { name: 'Blow Dry', category: 'hair', durationMin: 30, price: 35 })).body.id
    client = (await ins(t.schema.contact, { companyId: co, name: 'Visit Vi', email: 'vi@example.com', type: 'client' })).id
    other = (await ins(t.schema.contact, { companyId: co, name: 'Other Olly', email: 'olly@example.com', type: 'client' })).id
  }, 120_000)

  test('off by default: the list of services is refused and nothing is booked', async () => {
    const r = await visit('owner', '10:00', colourThenCut())
    expect([r.status, r.body.code]).toEqual([409, 'FEATURE_OFF'])
    const rows = await t.db.select().from(t.schema.appointment).where(eq(t.schema.appointment.companyId, co))
    expect(rows).toHaveLength(0)
  })

  test('a colour with Ana then a cut with Bea is one visit: its length, price and services; each stylist held only for their own part', async () => {
    await features([...FEATURES, 'multi_service_visits'])
    const r = await visit('owner', '10:00', colourThenCut())
    expect(r.status).toBe(201)
    expect(r.body.items).toHaveLength(2)
    expect(r.body.items.map((i: any) => [i.serviceName, i.startOffsetMin, i.durationMin])).toEqual([['Full Colour', 0, 90], ['Cut', 90, 30]])
    expect(new Date(r.body.endTime).getTime() - new Date(r.body.startTime).getTime()).toBe(120 * 60_000)
    expect(Number(r.body.quotedPrice)).toBe(160)
    expect(r.body.stylistId).toBe(ana)
    // Bea is free while Ana does the colour ...
    expect((await plain('owner', bea, '10:00', cut)).status).toBe(201)
    // ... and busy for her cut, 11:30–12:00
    const clash = await plain('owner', bea, '11:30', blow)
    expect([clash.status, clash.body.code]).toEqual([409, 'APPOINTMENT_CONFLICT'])
    // Ana is free again after her colour, though the visit goes on
    expect((await plain('owner', ana, '11:30', blow)).status).toBe(201)
    // and busy during it
    expect((await plain('owner', ana, '10:30', blow)).status).toBe(409)
    // the Book reads it back with its services
    const win = await as('owner', `/api/appointments?from=${encodeURIComponent(wall(day, '00:00'))}&to=${encodeURIComponent(wall(day, '23:59'))}`)
    const mine = win.body.data.find((a: any) => a.id === r.body.id)
    expect(mine.items.map((i: any) => i.stylistFirstName)).toEqual(['ana', 'bea'])
  })

  test('the list is checked: two or more services, on the menu, and one stylist cannot do two at once', async () => {
    const d2 = next(4, 6)
    const one = await visit('owner', '09:00', [{ serviceId: colour }], {}, d2)
    expect([one.status, one.body.code]).toEqual([400, 'BAD_ITEMS'])
    const unknown = await visit('owner', '09:00', [{ serviceId: colour }, { serviceId: 'nope' }], {}, d2)
    expect(unknown.status).toBe(404)
    const same = await visit('owner', '09:00', [{ serviceId: colour, stylistId: ana }, { serviceId: cut, stylistId: ana, startOffsetMin: 60 }], {}, d2)
    expect([same.status, same.body.code]).toEqual([409, 'APPOINTMENT_CONFLICT'])
    // the same stylist one after the other is fine
    const back = await visit('owner', '09:00', [{ serviceId: colour, stylistId: ana }, { serviceId: cut, stylistId: ana }], {}, d2)
    expect(back.status).toBe(201)
    // a booking that would clash with a stylist already held is refused whole, and leaves nothing behind
    const before = (await t.db.select().from(t.schema.appointmentItem)).length
    const clash = await visit('owner', '09:30', [{ serviceId: cut, stylistId: bea }, { serviceId: cut, stylistId: ana }], {}, d2)
    expect([clash.status, clash.body.code]).toEqual([409, 'APPOINTMENT_CONFLICT'])
    expect((await t.db.select().from(t.schema.appointmentItem)).length).toBe(before)
  })

  test('a seat without the booking permission is refused; a stylist narrowed to their own chair cannot book another\'s service', async () => {
    const desk = await visit('desk', '15:00', colourThenCut())
    // The desk (viewer) never held schedule:create — the same refusal as a plain appointment gets.
    const plainDesk = await plain('desk', ana, '15:00')
    expect(desk.status).toBe(plainDesk.status)
    expect(desk.status).toBe(403)
    expect((await as('owner', '/api/appointments/book-settings', 'PUT', { stylistsSeeOwnBookOnly: true })).status).toBe(200)
    const d3 = next(5, 6)
    const other1 = await visit('cat', '10:00', [{ serviceId: cut, stylistId: cat }, { serviceId: blow, stylistId: ana }], {}, d3)
    expect([other1.status, other1.body.code]).toEqual([403, 'OWN_BOOK_ONLY'])
    // Bea sees the Wednesday visit although it is booked under Ana; Cat (not in it) does not
    const win = `/api/appointments?from=${encodeURIComponent(wall(day, '00:00'))}&to=${encodeURIComponent(wall(day, '23:59'))}`
    const bs = (await as('bea', win)).body.data, cs = (await as('cat', win)).body.data
    expect(bs.some((a: any) => a.items?.length === 2)).toBe(true)
    expect(cs.some((a: any) => a.items?.length === 2)).toBe(false)
    await as('owner', '/api/appointments/book-settings', 'PUT', { stylistsSeeOwnBookOnly: false })
  })

  test('moving the visit moves every service with it; a clash for any stylist refuses the move; its services are not edited in place', async () => {
    const d4 = next(1, 8)
    const v = await visit('owner', '10:00', colourThenCut(), {}, d4)
    expect(v.status).toBe(201)
    await plain('owner', bea, '14:30', cut, d4)     // Bea busy 14:30–15:00
    const moved = await as('owner', `/api/appointments/${v.body.id}`, 'PUT', { startTime: wall(d4, '12:00') })
    expect(moved.status).toBe(200)
    expect(new Date(moved.body.endTime).toISOString()).toBe(wall(d4, '14:00'))
    // Bea's cut now sits 13:30–14:00; Ana's colour 12:00–13:30. Moving to 13:00 would put Bea at 14:30–15:00 — her booked cut.
    const clash = await as('owner', `/api/appointments/${v.body.id}`, 'PUT', { startTime: wall(d4, '13:00') })
    expect([clash.status, clash.body.code]).toEqual([409, 'APPOINTMENT_CONFLICT'])
    const still = (await as('owner', `/api/appointments?from=${encodeURIComponent(wall(d4, '00:00'))}&to=${encodeURIComponent(wall(d4, '23:59'))}`)).body.data.find((a: any) => a.id === v.body.id)
    expect(new Date(still.startTime).toISOString()).toBe(wall(d4, '12:00'))
    for (const edit of [{ endTime: wall(d4, '16:00') }, { serviceId: blow }, { stylistId: cat }, { processingMin: 10 }]) {
      const r = await as('owner', `/api/appointments/${v.body.id}`, 'PUT', edit)
      expect([r.status, r.body.code]).toEqual([409, 'VISIT_HAS_SERVICES'])
    }
  })

  test('completing the visit raises ONE bill with a line per service (once), one visit record; cancelling gives back the time', async () => {
    const d = today()
    const v = await visit('owner', '03:00', colourThenCut(), {}, d)
    expect(v.status).toBe(201)
    const done = await as('owner', `/api/appointments/${v.body.id}`, 'PUT', { status: 'completed' })
    expect(done.status).toBe(200)
    expect(done.body.invoiceId).toBeTruthy()
    const lines = await t.db.select().from(t.schema.invoiceLineItem).where(eq(t.schema.invoiceLineItem.invoiceId, done.body.invoiceId))
    expect(lines.sort((a: any, b: any) => a.sortOrder - b.sortOrder).map((l: any) => [l.description, Number(l.total)])).toEqual([['Full Colour', 120], ['Cut', 40]])
    const [inv] = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, done.body.invoiceId))
    expect(Number(inv.total)).toBe(160)
    // completing again changes nothing
    const again = await as('owner', `/api/appointments/${v.body.id}`, 'PUT', { status: 'completed' })
    expect(again.body.invoiceId).toBe(done.body.invoiceId)
    expect((await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.appointmentId, v.body.id)))).toHaveLength(1)
    expect((await t.db.select().from(t.schema.serviceRecord).where(eq(t.schema.serviceRecord.appointmentId, v.body.id)))).toHaveLength(1)
    // a visit that is cancelled frees every stylist's time
    const d5 = next(2, 9)
    const w = await visit('owner', '10:00', colourThenCut(), {}, d5)
    expect((await plain('owner', bea, '11:30', blow, d5)).status).toBe(409)
    expect((await as('owner', `/api/appointments/${w.body.id}`, 'DELETE')).status).toBe(200)
    expect((await plain('owner', bea, '11:30', blow, d5)).status).toBe(201)
  })
})

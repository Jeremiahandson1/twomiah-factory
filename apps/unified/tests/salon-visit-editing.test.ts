// Salon parity row 8 — change a booked several-service visit (Fresha, Square; visit_editing, not ready): add, remove, re-time and
// re-assign one service with the same clash, own-chair and blocked-time checks as a new visit; services that run at the same time (each
// its own start); the client's requested stylist per service (Fresha's heart); one visit record per service at close, so each stylist
// writes their own formula. Off: the visit's services stay as booked (409 VISIT_HAS_SERVICES), one record per visit.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const weekdayOf = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
function next(dow: number, ahead = 3) { let d = addDays(today(), ahead); while (weekdayOf(d) !== dow) d = addDays(d, 1); return d }
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'invoices', 'multi_service_visits']
const PASSWORD = 'Edit-1107-xx'

describe('salon: changing a booked visit', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', ana = '', bea = '', colour = '', cut = '', blow = '', client = '', other = ''
  const tokens: Record<string, string> = {}
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  const day = next(4, 6)
  const wall = (d: string, hm: string) => {
    const guess = new Date(`${d}T${hm}:00Z`)
    const parts = tzParts(guess, TZ)
    const off = (guess.getTime() - new Date(`${parts.date}T${String(Math.floor(parts.minutes / 60)).padStart(2, '0')}:${String(parts.minutes % 60).padStart(2, '0')}:00Z`).getTime()) / 60000
    return new Date(guess.getTime() + off * 60000).toISOString()
  }
  const visit = (hm: string, items: unknown, d = day) => as('owner', '/api/appointments', 'POST', { contactId: client, startTime: wall(d, hm), items })
  const edit = (id: string, items: unknown, who = 'owner', extra: any = {}) => as(who, `/api/appointments/${id}/services`, 'PUT', { items, ...extra })
  const plain = (stylist: string, hm: string, d = day) => as('owner', '/api/appointments', 'POST', { contactId: other, serviceId: cut, stylistId: stylist, startTime: wall(d, hm) })

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ } as any).where(eq(t.schema.company.id, co))
    await features(FEATURES)
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    for (const key of ['ana', 'bea']) {
      const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role: 'field', companyId: co })
      if (key === 'ana') ana = u.id; else bea = u.id
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${key}@test.example`, password: PASSWORD } })).json()) as any).accessToken
    }
    colour = (await as('owner', '/api/service-menu', 'POST', { name: 'Full Colour', category: 'colour', durationMin: 90, price: 120 })).body.id
    cut = (await as('owner', '/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 40 })).body.id
    blow = (await as('owner', '/api/service-menu', 'POST', { name: 'Blow Dry', category: 'hair', durationMin: 30, price: 35 })).body.id
    client = (await ins(t.schema.contact, { companyId: co, name: 'Visit Vi', email: 'vi@example.com', type: 'client' })).id
    other = (await ins(t.schema.contact, { companyId: co, name: 'Other Olly', email: 'olly@example.com', type: 'client' })).id
  }, 120_000)

  test('off: the services of a booked visit cannot be changed', async () => {
    const v = await visit('09:00', [{ serviceId: colour, stylistId: ana }, { serviceId: cut, stylistId: bea }])
    expect((await edit(v.body.id, [{ serviceId: colour, stylistId: ana }, { serviceId: blow, stylistId: bea }])).status).toBe(404)
    const r = await as('owner', `/api/appointments/${v.body.id}`, 'PUT', { stylistId: bea })
    expect([r.status, r.body.code]).toEqual([409, 'VISIT_HAS_SERVICES'])
  })

  test('on: add a service, re-assign one, run two at once, mark the requested stylist; price and length follow', async () => {
    await features([...FEATURES, 'visit_editing'])
    const v = await visit('13:00', [{ serviceId: colour, stylistId: ana }, { serviceId: cut, stylistId: bea }])   // 13:00 colour (Ana) · 14:30 cut (Bea)
    // Bea's cut moves to 13:00, alongside the colour (the same time, another stylist); a blow dry with Bea added at 14:30; Ana asked for
    const r = await edit(v.body.id, [
      { serviceId: colour, stylistId: ana, startOffsetMin: 0, requestedStylist: true },
      { serviceId: cut, stylistId: bea, startOffsetMin: 0 },
      { serviceId: blow, stylistId: bea, startOffsetMin: 90 },
    ])
    expect(r.status).toBe(200)
    expect(r.body.items.map((i: any) => [i.serviceName, i.stylistId, i.startOffsetMin, i.requestedStylist])).toEqual([['Full Colour', ana, 0, true], ['Cut', bea, 0, false], ['Blow Dry', bea, 90, false]])
    expect([Number(r.body.quotedPrice), new Date(r.body.endTime).getTime() - new Date(r.body.startTime).getTime()]).toEqual([195, 120 * 60_000])
    // Bea is now busy 13:00–13:30 and 14:30–15:00, free between
    expect((await plain(bea, '13:00')).status).toBe(409)
    expect((await plain(bea, '13:45')).status).toBe(201)
    // remove the blow dry: Bea is free at 14:30 again
    expect((await edit(v.body.id, [{ serviceId: colour, stylistId: ana }, { serviceId: cut, stylistId: bea, startOffsetMin: 0 }])).status).toBe(200)
    expect((await plain(bea, '14:30')).status).toBe(201)
  })

  test('the same checks as a new visit: a clash is refused, the visit’s own time is not a clash, own chair holds', async () => {
    const v = await visit('09:00', [{ serviceId: colour, stylistId: ana }, { serviceId: cut, stylistId: bea }], addDays(day, 7))
    expect((await plain(ana, '11:00', addDays(day, 7))).status).toBe(201)    // Ana 11:00–11:30
    const clash = await edit(v.body.id, [{ serviceId: colour, stylistId: ana }, { serviceId: cut, stylistId: ana }])   // Ana's cut at 10:30–11:00: fine
    expect(clash.status).toBe(200)
    const bad = await edit(v.body.id, [{ serviceId: colour, stylistId: ana }, { serviceId: cut, stylistId: ana, startOffsetMin: 120 }])   // 11:00: Ana is booked
    expect([bad.status, bad.body.code]).toEqual([409, 'APPOINTMENT_CONFLICT'])
    // same stylist twice at once inside the visit
    const twice = await edit(v.body.id, [{ serviceId: colour, stylistId: ana }, { serviceId: cut, stylistId: ana, startOffsetMin: 0 }])
    expect([twice.status, twice.body.error]).toEqual([409, 'Services 1 and 2 are the same stylist at the same time.'])
  })

  test('closing a visit gives each service its own record, with its own stylist — once', async () => {
    const d = today()
    const v = await visit('03:00', [{ serviceId: colour, stylistId: ana }, { serviceId: cut, stylistId: bea }], d)
    expect((await as('owner', `/api/appointments/${v.body.id}`, 'PUT', { status: 'completed' })).status).toBe(200)
    await as('owner', `/api/appointments/${v.body.id}`, 'PUT', { status: 'completed' })
    const recs = await t.db.select().from(t.schema.serviceRecord).where(eq(t.schema.serviceRecord.appointmentId, v.body.id)) as any[]
    expect(recs.map((r) => [r.serviceId, r.stylistId, Number(r.priceCharged)]).sort()).toEqual([[colour, ana, 120], [cut, bea, 40]].sort())
    // a closed visit's services are a record
    expect((await edit(v.body.id, [{ serviceId: colour, stylistId: ana }, { serviceId: blow, stylistId: bea }])).body.code).toBe('VISIT_CLOSED')
  })
})

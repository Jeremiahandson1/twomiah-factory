// Processing time (salon gap #4; server/crm/salon/segments.ts, held.ts). A colour has hands-on time, then processing (the stylist
// is free), then hands-on again. With the salon's `processing_time` feature on and the service carrying a gap, ANOTHER client can be
// booked into the gap — at the desk and online — but never into the hands-on parts. Without a gap, a stylist holds the whole span.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const weekdayOf = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
function next(dow: number, ahead = 3) { let d = addDays(today(), ahead); while (weekdayOf(d) !== dow) d = addDays(d, 1); return d }
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'online_booking', 'invoices']

describe('salon: processing time', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', ana = '', colour = '', cut = '', regular = '', other = ''
  const tokens: Record<string, string> = {}
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  const day = next(2, 5)
  // The salon's clock is Chicago: wall times on `day`.
  const at = (hm: string) => new Date(`${day}T${hm}:00-05:00`).toISOString()
  const atDst = (hm: string) => {
    // Chicago is UTC-5 (CDT) or UTC-6 (CST) on `day`; ask Intl rather than guess.
    const guess = new Date(`${day}T${hm}:00Z`)
    const parts = tzParts(guess, TZ)
    const offsetMin = (guess.getTime() - new Date(`${parts.date}T${String(Math.floor(parts.minutes / 60)).padStart(2, '0')}:${String(parts.minutes % 60).padStart(2, '0')}:00Z`).getTime()) / 60000
    return new Date(guess.getTime() + offsetMin * 60000).toISOString()
  }
  void at
  const book = (who: string, contactId: string, serviceId: string, hm: string, extra: Record<string, unknown> = {}) =>
    as(who, '/api/appointments', 'POST', { contactId, serviceId, stylistId: ana, startTime: atDst(hm), ...extra })

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ } as any).where(eq(t.schema.company.id, co))
    await features(FEATURES)
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    for (const [key, role] of Object.entries({ ana: 'field' })) {
      const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await Bun.password.hash('Process-1030', 'bcrypt'), firstName: key, lastName: 'Tester', role, companyId: co })
      ana = u.id
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${key}@test.example`, password: 'Process-1030' } })).json()) as any).accessToken
    }
    colour = (await as('owner', '/api/service-menu', 'POST', { name: 'Full Colour', category: 'colour', durationMin: 120, price: 140 })).body.id
    cut = (await as('owner', '/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 40 })).body.id
    regular = (await ins(t.schema.contact, { companyId: co, name: 'Colour Cleo', email: 'cleo@example.com', type: 'client' })).id
    other = (await ins(t.schema.contact, { companyId: co, name: 'Cut Cam', email: 'cam@example.com', type: 'client' })).id
  }, 120_000)

  test('off by default: a colour holds its stylist for the whole two hours, and a gap cannot be set', async () => {
    const refused = await as('owner', `/api/service-menu/${colour}`, 'PUT', { processingAfterMin: 30, processingMin: 60 })
    expect([refused.status, refused.body.code]).toEqual([409, 'FEATURE_OFF'])
    expect((await book('owner', regular, colour, '10:00')).status).toBe(201)
    const clash = await book('owner', other, cut, '10:45')
    expect([clash.status, clash.body.code]).toEqual([409, 'APPOINTMENT_CONFLICT'])
  })

  test('the gap is set on the service by whoever may change the menu, and is checked against the service length', async () => {
    await features([...FEATURES, 'processing_time'])
    expect((await as('ana', `/api/service-menu/${colour}`, 'PUT', { processingAfterMin: 30, processingMin: 60 })).status).toBe(403)
    for (const bad of [{ processingAfterMin: 30, processingMin: 0 }, { processingAfterMin: 90, processingMin: 60 }, { processingAfterMin: -5, processingMin: 30 }, { processingAfterMin: 10 }]) {
      const r = await as('owner', `/api/service-menu/${colour}`, 'PUT', bad)
      expect([r.status, r.body.code]).toEqual([400, 'BAD_PROCESSING'])
    }
    const ok = await as('owner', `/api/service-menu/${colour}`, 'PUT', { processingAfterMin: 30, processingMin: 60 })
    expect([ok.status, ok.body.processingAfterMin, ok.body.processingMin]).toEqual([200, 30, 60])
    // a shorter service must still hold its gap
    const shorter = await as('owner', `/api/service-menu/${colour}`, 'PUT', { durationMin: 60 })
    expect([shorter.status, shorter.body.code]).toEqual([400, 'BAD_PROCESSING'])
  })

  test('another client can be booked INTO the gap, never into the hands-on parts', async () => {
    // Full Colour 13:00–15:00 for Ana: hands-on 13:00–13:30, processing 13:30–14:30, hands-on 14:30–15:00.
    const c = await book('owner', regular, colour, '13:00')
    expect([c.status, c.body.processingAfterMin, c.body.processingMin]).toEqual([201, 30, 60])
    expect((await book('owner', other, cut, '13:30')).status).toBe(201)         // 13:30–14:00: starts exactly where the gap starts
    expect((await book('owner', other, cut, '14:00')).status).toBe(201)         // 14:00–14:30: ends exactly where the finishing starts
    for (const hm of ['12:45', '13:15', '14:15', '14:45']) {
      const r = await book('owner', other, cut, hm)                              // each touches a hands-on part (or a cut already in the gap)
      expect([hm, r.status, r.body.code]).toEqual([hm, 409, 'APPOINTMENT_CONFLICT'])
    }
  })

  test('the other order works too: a colour is booked around a cut already in its gap; moving into a clash is refused', async () => {
    const day2 = addDays(day, 7)
    const atDay2 = (hm: string) => atDst(hm).replace(day, day2)
    const first = await as('owner', '/api/appointments', 'POST', { contactId: other, serviceId: cut, stylistId: ana, startTime: atDay2('14:45') })
    expect(first.status).toBe(201)
    const around = await as('owner', '/api/appointments', 'POST', { contactId: regular, serviceId: colour, stylistId: ana, startTime: atDay2('14:00') })   // 14:00–16:00, gap 14:30–15:30 holds the 14:45 cut
    expect(around.status).toBe(201)
    // moving the colour so its hands-on start lands on the cut is refused
    const moved = await as('owner', `/api/appointments/${around.body.id}`, 'PUT', { startTime: atDay2('14:30') })
    expect([moved.status, moved.body.code]).toEqual([409, 'APPOINTMENT_CONFLICT'])
    // and a gap can be set by hand on one visit
    const manual = await as('owner', `/api/appointments/${first.body.id}`, 'PUT', { processingAfterMin: 5, processingMin: 10 })
    expect(manual.status).toBe(200)
    expect([manual.body.processingAfterMin, manual.body.processingMin]).toEqual([5, 10])
  })

  test('online booking: the gap is offered to another client and the hands-on parts are not', async () => {
    const dayO = addDays(day, 14)
    const noStylist = await as('owner', '/api/appointments', 'POST', { contactId: regular, serviceId: colour, startTime: atDst('09:00').replace(day, dayO) })   // 09:00–11:00, gap 09:30–10:30, no stylist: everyone's time
    expect(noStylist.status).toBe(201)
    await as('owner', `/api/service-menu/${cut}`, 'PUT', { bookableOnline: true })
    expect((await as('owner', '/api/booking/settings', 'PATCH', { enabled: true, leadTimeMinutes: 0 })).status).toBe(200)
    const times = await t.call(`/api/book/services/cut/times?date=${dayO}`)
    const body = (await times.json()) as any
    const offered: string[] = (body.data ?? body).map((x: any) => x.time ?? x)
    expect(offered).toContain('09:30')
    expect(offered).toContain('10:00')
    expect(offered).not.toContain('09:00')
    expect(offered).not.toContain('10:30')
  })
})

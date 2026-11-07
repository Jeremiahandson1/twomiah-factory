// Salon parity row 7 — a service as a sequence of steps (Fresha: processing, blocked, extra time; any number, in order; feature
// service_segments, not ready). Only processing frees the stylist: the desk books another client into a processing step and never
// into a hands-on, blocked or extra one; online, times are offered into another booking's processing — and a new online booking
// with steps is offered around a booking already sitting in its own processing, the way the desk can. Off: as before.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'
import { segmentsOf, heldMinutes, segmentsProblem, piecesOf } from '../server/crm/salon/segments.ts'

const TZ = 'America/Chicago'
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'online_booking', 'invoices', 'processing_time']
const STEPS = [{ kind: 'service', minutes: 30 }, { kind: 'processing', minutes: 45 }, { kind: 'blocked', minutes: 15 }, { kind: 'processing', minutes: 30 }, { kind: 'extra', minutes: 30 }]

describe('the steps, as arithmetic', () => {
  test('held stretches, the old gap read as steps, and the checks in words', () => {
    expect(heldMinutes(STEPS as any)).toEqual([{ fromMin: 0, toMin: 30 }, { fromMin: 75, toMin: 90 }, { fromMin: 120, toMin: 150 }])
    expect(segmentsOf({ processingAfterMin: 30, processingMin: 60 }, 120)).toEqual([{ kind: 'service', minutes: 30 }, { kind: 'processing', minutes: 60 }, { kind: 'service', minutes: 30 }])
    expect(segmentsOf({}, 45)).toEqual([{ kind: 'service', minutes: 45 }])
    expect(segmentsProblem(STEPS, 150)).toBeNull()
    expect(segmentsProblem(STEPS, 120)).toBe('The steps come to 150 minutes; the service is 120. They must add up to it.')
    expect(segmentsProblem([{ kind: 'processing', minutes: 30 }], 30)).toBe('A service needs at least one step that is not processing.')
    expect(segmentsProblem([{ kind: 'nap', minutes: 30 }], 30)).toBe('Step 1 must be hands-on, processing, blocked or extra time.')
    // an appointment shortened at the desk keeps its steps, cut at its end
    expect(piecesOf(0, 100 * 60_000, { afterMin: null, min: null, segments: STEPS as any }).map((p) => [p.start / 60_000, p.end / 60_000])).toEqual([[0, 30], [75, 90]])
  })
})

describe('salon steps', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', ana = '', deluxe = '', cut = '', cleo = '', cam = ''
  const tokens: Record<string, string> = {}
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  // The salon's own calendar: `from` days after today there, then on to the weekday (a UTC day is tomorrow every Chicago evening).
  const next = (from: number, weekday: number) => { let d = addDays(tzParts(new Date(), TZ).date, from); while (new Date(`${d}T12:00:00Z`).getUTCDay() !== weekday) d = addDays(d, 1); return d }
  const wall = (day: string, hm: string) => {
    const guess = new Date(`${day}T${hm}:00Z`)
    const parts = tzParts(guess, TZ)
    const off = (guess.getTime() - new Date(`${parts.date}T${String(Math.floor(parts.minutes / 60)).padStart(2, '0')}:${String(parts.minutes % 60).padStart(2, '0')}:00Z`).getTime()) / 60000
    return new Date(guess.getTime() + off * 60000).toISOString()
  }
  const book = (day: string, contactId: string, serviceId: string, hm: string, extra: Record<string, unknown> = {}) =>
    as('owner', '/api/appointments', 'POST', { contactId, serviceId, stylistId: ana, startTime: wall(day, hm), ...extra })
  const times = async (slug: string, day: string): Promise<string[]> => { const b = (await (await t.call(`/api/book/services/${slug}/times?date=${day}`)).json()) as any; return (b.data ?? b).map((x: any) => x.time ?? x) }
  const slugOf = async (name: string) => { const b = (await (await t.call('/api/book/services')).json()) as any; return (b.data ?? b).find((s: any) => s.name === name)?.slug }

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ } as any).where(eq(t.schema.company.id, co))
    await features(FEATURES)
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    ana = (await ins(t.schema.user, { email: 'ana@test.example', passwordHash: await Bun.password.hash('Steps-1107', 'bcrypt'), firstName: 'Ana', lastName: 'Tester', role: 'field', companyId: co })).id
    deluxe = (await as('owner', '/api/service-menu', 'POST', { name: 'Colour Deluxe', category: 'colour', durationMin: 150, price: 220 })).body.id
    cut = (await as('owner', '/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 40 })).body.id
    cleo = (await ins(t.schema.contact, { companyId: co, name: 'Colour Cleo', email: 'cleo@example.com', type: 'client' })).id
    cam = (await ins(t.schema.contact, { companyId: co, name: 'Cut Cam', email: 'cam@example.com', type: 'client' })).id
  }, 120_000)

  test('off: steps cannot be set', async () => {
    const r = await as('owner', `/api/service-menu/${deluxe}`, 'PUT', { segments: STEPS })
    expect([r.status, r.body.code]).toEqual([409, 'FEATURE_OFF'])
  })

  test('on: set on the service, checked against its length; a new length that breaks them is refused', async () => {
    await features([...FEATURES, 'service_segments'])
    const bad = await as('owner', `/api/service-menu/${deluxe}`, 'PUT', { segments: STEPS.slice(0, 3) })
    expect([bad.status, bad.body.code]).toEqual([400, 'BAD_SEGMENTS'])
    const ok = await as('owner', `/api/service-menu/${deluxe}`, 'PUT', { segments: STEPS })
    expect([ok.status, ok.body.segments, ok.body.processingMin]).toEqual([200, STEPS, null])
    expect((await as('owner', `/api/service-menu/${deluxe}`, 'PUT', { durationMin: 120 })).body.code).toBe('BAD_SEGMENTS')
  })

  test('the desk: another client into either processing step, never into the blocked or extra time', async () => {
    const day = next(2, 3)
    const d = await book(day, cleo, deluxe, '13:00')            // 13:00 hands-on · 13:30 processing · 14:15 blocked · 14:30 processing · 15:00 extra · 15:30
    expect([d.status, d.body.segments]).toEqual([201, STEPS])
    expect((await book(day, cam, cut, '13:30')).status).toBe(201) // 13:30–14:00, in the first processing
    expect((await book(day, cam, cut, '14:30')).status).toBe(201) // 14:30–15:00, in the second
    for (const hm of ['12:45', '14:00', '15:00']) {                // touches hands-on / blocked / extra
      const r = await book(day, cam, cut, hm)
      expect([hm, r.status, r.body.code]).toEqual([hm, 409, 'APPOINTMENT_CONFLICT'])
    }
  })

  test('online: times offered into a booking’s processing, and a stepped service offered around a cut in its own processing', async () => {
    await as('owner', `/api/service-menu/${cut}`, 'PUT', { bookableOnline: true })
    await as('owner', `/api/service-menu/${deluxe}`, 'PUT', { bookableOnline: true })
    expect((await as('owner', '/api/booking/settings', 'PATCH', { enabled: true, leadTimeMinutes: 0 })).status).toBe(200)
    const day = next(9, 3)
    expect((await as('owner', '/api/appointments', 'POST', { contactId: cleo, serviceId: deluxe, startTime: wall(day, '09:00') })).status).toBe(201) // no stylist: everyone's time
    const cutSlug = await slugOf('Cut'), deluxeSlug = await slugOf('Colour Deluxe')
    const cuts = await times(cutSlug, day)
    expect(cuts).toContain('09:30')          // first processing 09:30–10:15
    expect(cuts).not.toContain('10:00')      // 10:00–10:30 runs into the blocked 10:15–10:30
    expect(cuts).toContain('10:30')          // second processing 10:30–11:00
    expect(cuts).not.toContain('11:00')      // extra time 11:00–11:30
    // a cut at 14:00 on another day; the Colour Deluxe at 13:30 has its first processing 14:00–14:45 over it
    const day2 = next(16, 3)
    expect((await as('owner', '/api/appointments', 'POST', { contactId: cam, serviceId: cut, startTime: wall(day2, '14:00') })).status).toBe(201)
    expect(await times(deluxeSlug, day2)).toContain('13:30')
    // off: the stepped service holds its whole time online again
    await features(FEATURES)
    expect(await times(deluxeSlug, day2)).not.toContain('13:30')
  }, 90_000)
})

// The Book draws each step (bookGridMath.ts): processing hatched, blocked striped, extra tinted.
describe('the Book', () => {
  test('a stepped card is one stretch per step, cut at its end', async () => {
    const { piecesFor } = await import('../web/src/crm/pages/salon/bookGridMath.ts')
    expect(piecesFor(600, 750, { segments: STEPS }).map((p) => [p.kind, p.start, p.end])).toEqual([['work', 600, 630], ['processing', 630, 675], ['blocked', 675, 690], ['processing', 690, 720], ['extra', 720, 750]])
    expect(piecesFor(600, 700, { segments: STEPS }).map((p) => p.kind)).toEqual(['work', 'processing', 'blocked', 'processing'])
    // no steps: the old single gap, as before
    expect(piecesFor(600, 720, { afterMin: 30, min: 60 }).map((p) => p.kind)).toEqual(['work', 'processing', 'work'])
  })
})

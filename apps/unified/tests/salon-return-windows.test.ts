// Retention over several return windows (salon parity row 14; server crm/salon/returnWindows.ts and reports.ts, GET/PUT /api/salon-reports/return-windows).
// Of the clients who had a visit in the period, the share back within 30 / 60 / 90 / 120 days (the owner picks the windows), for the salon and for
// each stylist, sliceable by service — against a hand-worked set of clients so every figure is checked, including the edges: a return exactly on
// the window's last day counts, and a client who has not yet had the whole window to come back is left out of that window, not counted as lost.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { shiftDays } from '../server/crm/salon/days.ts'
import { parseWindows, readWindows, ratesFor, anchors } from '../server/crm/salon/returnWindows.ts'
import { tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'invoices', 'salon_reports']
const PASSWORD = 'Windows-1031-x'

describe('salon: retention over several return windows', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', s1 = '', s2 = '', cut = '', colour = ''
  const tokens: Record<string, string> = {}
  let ip = 0
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}`, 'x-forwarded-for': `10.8.0.${++ip}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const today = tzParts(new Date(), TZ).date
  const at = (daysAgo: number) => new Date(`${shiftDays(today, -daysAgo)}T18:00:00Z`)
  const client = (name: string) => ins(t.schema.contact, { companyId: co, name, email: `${name.toLowerCase()}@example.com`, type: 'client' })
  const visit = (c: any, daysAgo: number, stylist: string, serviceId: string) => ins(t.schema.serviceRecord, { companyId: co, contactId: c.id, performedAt: at(daysAgo), formula: [], stylistId: stylist, serviceId })
  const report = (q = '') => as('owner', `/api/salon-reports/return-windows?from=${shiftDays(today, -179)}&to=${today}${q}`)
  const rates = (windows: any[]) => windows.map((w) => [w.days, w.counted, w.returned, w.ratePercent])

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ, enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, co))
    t.services.features.forgetFeatures()
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    const mk = async (email: string, first: string, role: string) => (await ins(t.schema.user, { email, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: first, lastName: 'Stylist', role, companyId: co })).id as string
    s1 = await mk('sam@test.example', 'Sam', 'field')
    s2 = await mk('kim@test.example', 'Kim', 'field')
    await mk('desk@test.example', 'Dana', 'viewer')
    tokens.desk = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'desk@test.example', password: PASSWORD } })).json()) as any).accessToken
    cut = (await ins(t.schema.serviceMenu, { companyId: co, name: 'Cut', category: 'hair', durationMin: 30, price: '40.00' })).id
    colour = (await ins(t.schema.serviceMenu, { companyId: co, name: 'Colour', category: 'colour', durationMin: 90, price: '120.00' })).id
    const [A, B, C, D, E, G, H, I, J] = await Promise.all(['Ann', 'Bea', 'Cat', 'Dee', 'Eve', 'Gus', 'Hal', 'Ivy', 'Jon'].map(client))
    await visit(A, 80, s1, colour); await visit(A, 40, s1, cut)          // back after 40 days
    await visit(B, 75, s1, cut)                                           // never back
    await visit(C, 20, s2, colour); await visit(C, 5, s2, cut)            // back after 15 days
    await visit(D, 3, s2, cut)                                            // too recent for any window
    await visit(E, 50, s2, cut); await visit(E, 10, s2, cut)              // back after 40 days
    await visit(G, 130, s1, colour); await visit(G, 100, s1, cut); await visit(G, 90, s1, cut)   // back after exactly 30 days
    await visit(H, 150, s2, cut)                                          // never back
    await visit(J, 95, s2, cut); await visit(J, 20, s2, cut)              // back after 75 days
    await visit(I, 70, s1, cut); await visit(I, 35, s1, colour)           // first a cut, then a colour; the colour is not followed by anything
  }, 120_000)

  test('the pure rules: windows are whole days 7 to 365, at most six, sorted; the saved ones fall back to 30/60/90/120', () => {
    expect(parseWindows('90, 30 ,60')).toEqual({ windows: [30, 60, 90] })
    expect(parseWindows([30, 30, 45])).toEqual({ windows: [30, 45] })
    for (const bad of ['', [], '3', '400', '30,abc', [30.5], '7,14,21,28,35,42,49']) expect(parseWindows(bad)).toHaveProperty('problem')
    expect(readWindows(undefined)).toEqual([30, 60, 90, 120])
    expect(readWindows({ retentionWindows: [14, 45] })).toEqual([14, 45])
    expect(readWindows({ retentionWindows: 'junk' })).toEqual([30, 60, 90, 120])
    const now = new Date('2026-10-31T12:00:00Z')
    const v = [{ contactId: 'a', performedAt: new Date('2026-08-01T12:00:00Z'), nextAt: new Date('2026-08-31T12:00:00Z') }, { contactId: 'a', performedAt: new Date('2026-10-02T12:00:00Z'), nextAt: null }]
    expect(anchors(v).length).toBe(1)
    expect(rates(ratesFor(anchors(v), [30, 60], now))).toEqual([[30, 1, 1, 100], [60, 1, 1, 100]])
    // the window must have run its course: a visit 29 days ago is not in a 30-day window, even though she was back
    expect(rates(ratesFor([{ contactId: 'b', performedAt: new Date('2026-10-02T12:00:00Z'), nextAt: new Date('2026-10-05T12:00:00Z') }], [30], now))).toEqual([[30, 0, 0, null]])
  })

  test('closed until a seat can read reports; a bad window or service is refused with the reason', async () => {
    expect((await as('desk', '/api/salon-reports/return-windows')).status).toBe(403)
    for (const q of ['&windows=3', '&windows=30,abc', '&windows=7,14,21,28,35,42,49', '&serviceId=nope']) {
      const r = await report(q)
      expect([q, r.status, r.body.code]).toEqual([q, 400, 'BAD_RANGE'])
    }
  })

  test('the salon: of 9 clients, the share back within 30 / 60 / 90 / 120 days — a client is only counted once the whole window has passed', async () => {
    const r = await report()
    expect(r.status).toBe(200)
    expect([r.body.windowDays, r.body.clients, r.body.service]).toEqual([[30, 60, 90, 120], 9, null])
    // 30: Ann Bea Eve Gus Hal Ivy Jon had 30 days (not Cat, not Dee) · back within 30: Gus, on the very last day
    // 60: Ann Bea Gus Hal Ivy Jon · back: Ann (40) Gus (30) Ivy (35) · 90: Gus Hal Jon · back: Gus, Jon (75) · 120: Gus Hal · back: Gus
    expect(rates(r.body.windows)).toEqual([[30, 7, 1, 14.3], [60, 6, 3, 50], [90, 3, 2, 66.7], [120, 2, 1, 50]])
  })

  test('per stylist, the stylist of the first visit in the period', async () => {
    const r = await report()
    const by = Object.fromEntries(r.body.stylists.map((x: any) => [x.name, x]))
    expect(Object.keys(by).sort()).toEqual(['Kim Stylist', 'Sam Stylist'])
    expect(by['Sam Stylist'].clients).toBe(4)
    expect(rates(by['Sam Stylist'].windows)).toEqual([[30, 4, 1, 25], [60, 4, 3, 75], [90, 1, 1, 100], [120, 1, 1, 100]])
    expect(by['Kim Stylist'].clients).toBe(5)
    expect(rates(by['Kim Stylist'].windows)).toEqual([[30, 3, 0, 0], [60, 2, 0, 0], [90, 2, 1, 50], [120, 1, 0, 0]])
  })

  test('sliced by service: clients whose first visit in the period was that service; back means any later visit', async () => {
    const r = await report(`&serviceId=${colour}`)
    expect([r.body.clients, r.body.service]).toEqual([4, { id: colour, name: 'Colour' }])
    expect(rates(r.body.windows)).toEqual([[30, 3, 1, 33.3], [60, 2, 2, 100], [90, 1, 1, 100], [120, 1, 1, 100]])
    const by = Object.fromEntries(r.body.stylists.map((x: any) => [x.name, x.clients]))
    expect(by).toEqual({ 'Sam Stylist': 3, 'Kim Stylist': 1 })
  })

  test('the windows are the owner\'s pick: ?windows= for one look, or saved for the salon by whoever changes company settings', async () => {
    const one = await report('&windows=45,365')
    expect(rates(one.body.windows)).toEqual([[45, 7, 4, 57.1], [365, 0, 0, null]])
    expect((await as('desk', '/api/salon-reports/return-windows', 'PUT', { windows: [14, 45] })).status).toBe(403)
    const bad = await as('owner', '/api/salon-reports/return-windows', 'PUT', { windows: [3] })
    expect([bad.status, bad.body.code, typeof bad.body.fields?.windows]).toEqual([400, 'BAD_WINDOWS', 'string'])
    const saved = await as('owner', '/api/salon-reports/return-windows', 'PUT', { windows: [45, 14] })
    expect([saved.status, saved.body.windows]).toEqual([200, [14, 45]])
    expect((await report()).body.windowDays).toEqual([14, 45])
    expect((await report('&windows=30')).body.windowDays).toEqual([30])
  })
})

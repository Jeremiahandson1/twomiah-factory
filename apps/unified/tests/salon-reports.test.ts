// The salon's reports (salon gap #11; server/crm/salon/reports.ts, feature `salon_reports`): who came and came back, how often, who has slipped
// away, first-timers who returned; each stylist's rebook rate (visits that left with a next appointment); retail sold by item and by stylist.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { shiftDays } from '../server/crm/salon/days.ts'
import { tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'invoices']
const PASSWORD = 'Report-1030-x'
const HOUR = 3600_000

describe('salon: retention, rebook and retail reports', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', s1 = '', s2 = ''
  const tokens: Record<string, string> = {}
  let ip = 0
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string) => {
    const r = await t.call(path, { headers: { Authorization: `Bearer ${tokens[who]}`, 'x-forwarded-for': `10.7.0.${++ip}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  const today = tzParts(new Date(), TZ).date
  const at = (daysAgo: number) => new Date(`${shiftDays(today, -daysAgo)}T18:00:00Z`)        // midday in Chicago, whatever the season
  const client = (name: string) => ins(t.schema.contact, { companyId: co, name, email: `${name.toLowerCase()}@example.com`, type: 'client' })
  const visit = (c: any, daysAgo: number, stylist: string) => ins(t.schema.serviceRecord, { companyId: co, contactId: c.id, performedAt: at(daysAgo), formula: [], stylistId: stylist })
  const appt = (c: any, start: Date, stylist: string, createdAt: Date, status = 'scheduled') => ins(t.schema.appointment, { companyId: co, contactId: c.id, stylistId: stylist, startTime: start, endTime: new Date(start.getTime() + HOUR), status, createdAt })

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ } as any).where(eq(t.schema.company.id, co))
    await features(FEATURES)
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    const mk = async (email: string, first: string, role: string) => (await ins(t.schema.user, { email, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: first, lastName: 'Stylist', role, companyId: co })).id as string
    s1 = await mk('sam@test.example', 'Sam', 'field')
    s2 = await mk('kim@test.example', 'Kim', 'field')
    await mk('desk@test.example', 'Dana', 'viewer')
    tokens.desk = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'desk@test.example', password: PASSWORD } })).json()) as any).accessToken
  }, 120_000)

  test('closed until the salon is given the feature; a seat without reports:read is refused', async () => {
    expect((await as('owner', '/api/salon-reports/retention')).status).not.toBe(200)
    await features([...FEATURES, 'salon_reports'])
    expect((await as('owner', '/api/salon-reports/retention')).status).toBe(200)
    for (const r of ['retention', 'rebook', 'retail']) expect([r, (await as('desk', `/api/salon-reports/${r}`)).status]).toEqual([r, 403])
  })

  test('the range is checked, and an empty salon answers with zeros, not errors', async () => {
    for (const q of ['from=2026-02-30', 'to=yesterday', 'from=2026-05-01&to=2026-04-01', 'from=2020-01-01&to=2026-01-01']) {
      const r = await as('owner', `/api/salon-reports/retention?${q}`)
      expect([q, r.status, r.body.code]).toEqual([q, 400, 'BAD_RANGE'])
    }
    const r = (await as('owner', '/api/salon-reports/retention')).body
    expect([r.visits, r.activeClients, r.retention.ratePercent, r.firstTimers.ratePercent, r.averageDaysBetweenVisits, r.range.days]).toEqual([0, 0, null, null, null, 90])
    expect((await as('owner', '/api/salon-reports/rebook')).body.stylists).toEqual([])
  })

  test('retention: active, new and returning, how often, retention against the stretch before, first-timers who came back, who has slipped away', async () => {
    const [A, B, C, D, E, F, G] = await Promise.all(['Ann', 'Bea', 'Cat', 'Dee', 'Eve', 'Fay', 'Gus'].map(client))
    await visit(A, 40, s1); await visit(A, 10, s1)                  // before the window and in it: retained
    await visit(B, 45, s1)                                          // before the window only: not retained
    await visit(C, 20, s1); await visit(C, 5, s1)                   // new in the window, twice: 15 days apart
    await visit(D, 3, s2)                                           // new, once, nothing booked
    await visit(E, 2, s2)                                           // new, once, but booked again
    await visit(F, 120, s1)                                         // slipped away
    await visit(G, 200, s1)                                         // long gone, but holds a booking
    await appt(E, at(-10), s2, new Date(at(2).getTime() + HOUR))    // Eve: next appointment, booked an hour after her visit
    await appt(G, at(-3), s1, new Date())
    const r = (await as('owner', `/api/salon-reports/retention?from=${shiftDays(today, -29)}&to=${today}`)).body
    expect([r.visits, r.activeClients, r.newClients, r.returningClients]).toEqual([5, 4, 3, 1])
    expect(r.visitsPerClient).toBe(1.25)
    expect(r.frequency).toEqual({ once: 3, twice: 1, threeToFour: 0, fivePlus: 0 })
    expect(r.averageDaysBetweenVisits).toBe(15)
    expect(r.retention).toEqual({ priorClients: 2, retained: 1, ratePercent: 50 })                 // Ann and Bea came before; only Ann came again
    expect(r.bookedAgain).toEqual({ count: 1, ratePercent: 25 })                                    // of the four who came in, only Eve holds a booking
    expect(r.firstTimers).toEqual({ count: 3, cameBack: 2, ratePercent: 66.7 })                    // Cat (twice) and Eve (booked again); Dee did not
    expect(r.lapsed).toEqual({ days: 90, count: 1 })                                               // Fay; Gus holds a booking
    expect(r.truncated).toBe(false)
  })

  test('rebook rate per stylist: a visit counts when the client had a next appointment, booked by the day after; cancelled ones do not count', async () => {
    const [cat, dee] = await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.companyId, co)).then((rows: any[]) => ['Cat', 'Dee'].map((n) => rows.find((x) => x.name === n)))
    await appt(cat, at(5), s1, new Date(at(20).getTime() + 2 * HOUR), 'completed')                  // booked 2h after Cat's first visit → that visit left rebooked
    await appt(dee, at(-2), s2, new Date(at(3).getTime() + HOUR), 'cancelled')                      // cancelled: not a next appointment
    const r = (await as('owner', `/api/salon-reports/rebook?from=${shiftDays(today, -29)}&to=${today}`)).body
    expect(r.total).toEqual({ visits: 5, rebooked: 2, ratePercent: 40 })
    const by = Object.fromEntries(r.stylists.map((x: any) => [x.name, [x.visits, x.rebooked, x.ratePercent]]))
    expect(by).toEqual({ 'Sam Stylist': [3, 1, 33.3], 'Kim Stylist': [2, 1, 50] })
    expect(r.stylists[0].name).toBe('Kim Stylist')                                                    // best rate first
  })

  test('retail: paid sales only, by item and by the stylist of the visit', async () => {
    const [cat, dee] = await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.companyId, co)).then((rows: any[]) => ['Cat', 'Dee'].map((n) => rows.find((x) => x.name === n)))
    const sold = async (c: any, stylist: string, lines: Array<[string, string, number, number]>, status = 'paid', paidDaysAgo = 1) => {
      const a = await appt(c, at(paidDaysAgo), stylist, at(paidDaysAgo + 1), 'completed')
      const inv = await ins(t.schema.invoice, { companyId: co, contactId: c.id, appointmentId: a.id, number: `INV-R${++ip}`, status, subtotal: '0', total: '0', amountPaid: status === 'paid' ? '1' : '0', paidAt: status === 'paid' ? at(paidDaysAgo) : null })
      for (const [description, type, quantity, total] of lines) await ins(t.schema.invoiceLineItem, { invoiceId: inv.id, description, type, quantity: String(quantity), unitPrice: String(total / quantity), total: String(total) })
    }
    await sold(cat, s1, [['Cut', 'service', 1, 60], ['Shampoo', 'retail', 2, 40]])
    await sold(dee, s2, [['Shampoo', 'retail', 1, 20], ['Mask', 'retail', 1, 15]])
    await sold(dee, s2, [['Serum', 'retail', 1, 50]], 'open')                                       // not paid: not counted
    await sold(cat, s1, [['Serum', 'retail', 1, 50]], 'void')                                       // void: not counted
    await sold(cat, s1, [['Comb', 'retail', 1, 9]], 'paid', 100)                                    // paid long ago: outside the window
    const r = (await as('owner', `/api/salon-reports/retail?from=${shiftDays(today, -29)}&to=${today}`)).body
    expect([r.total, r.units]).toEqual([75, 4])
    expect(r.byItem).toEqual([{ name: 'Shampoo', units: 3, total: 60 }, { name: 'Mask', units: 1, total: 15 }])
    expect(r.byStylist).toEqual([{ name: 'Sam Stylist', units: 2, total: 40 }, { name: 'Kim Stylist', units: 2, total: 35 }])
  })
})

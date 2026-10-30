// The client portal's Appointments section (salon gap #12; packages/tenant-backend portal.ts PortalOptions.appointments, turned on by
// the salon vertical and seen only with the `portal_appointments` feature on). A client sees THEIR OWN upcoming appointments —
// when, what, with whom (first name) — and a link to move or cancel one booked online; never a price, a note, or anyone else's.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const weekdayOf = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
function next(dow: number, ahead = 3) { let d = addDays(today(), ahead); while (weekdayOf(d) !== dow) d = addDays(d, 1); return d }
const ALL = ['contacts', 'client_portal', 'client_profiles', 'service_menu', 'salon_booking', 'online_booking', 'invoices']

describe('salon: appointments in the client portal', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', ownerToken = '', cut = ''
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${ownerToken}` } })
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  const portal = async (contactId: string) => {
    const e = await as(`/api/portal/contacts/${contactId}/enable`, 'POST')
    expect(e.status).toBe(200)
    return String(e.body.portalUrl).split('/').pop() as string
  }
  const get = async (token: string, path = '') => { const r = await t.call(`/api/portal/p/${token}${path}`); return { status: r.status, body: (await r.json().catch(() => ({}))) as any } }
  const when = (days: number, hour = 10) => { const d = new Date(Date.now() + days * 86400000); d.setUTCHours(hour, 0, 0, 0); return d }

  let me = '', other = '', onlineSlug = 'cut'

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    ownerToken = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    await t.db.update(t.schema.company).set({ timezone: TZ } as any).where(eq(t.schema.company.id, co))
    await features(ALL)
    expect((await as('/api/booking/settings', 'PATCH', { enabled: true, leadTimeMinutes: 0 })).status).toBe(200)
    cut = (await as('/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 40, bookableOnline: true })).body.id
    me = (await ins(t.schema.contact, { companyId: co, name: 'Portal Pia', email: 'pia@example.com', type: 'client' })).id
    other = (await ins(t.schema.contact, { companyId: co, name: 'Someone Else', email: 'else@example.com', type: 'client' })).id
    const ana = await ins(t.schema.user, { email: 'ana@test.example', passwordHash: await Bun.password.hash('Portal-1030', 'bcrypt'), firstName: 'Ana', lastName: 'Stylist', role: 'field', companyId: co })
    await ins(t.schema.appointment, { companyId: co, contactId: me, serviceId: cut, stylistId: ana.id, status: 'scheduled', startTime: when(5), endTime: when(5, 11), quotedPrice: '40', notes: 'private note' })
    await ins(t.schema.appointment, { companyId: co, contactId: me, serviceId: cut, status: 'cancelled', startTime: when(6), endTime: when(6, 11) })
    await ins(t.schema.appointment, { companyId: co, contactId: me, serviceId: cut, status: 'completed', startTime: when(-6), endTime: when(-6, 11) })
    await ins(t.schema.appointment, { companyId: co, contactId: other, serviceId: cut, status: 'scheduled', startTime: when(4), endTime: when(4, 11) })
  }, 120_000)

  test('off by default: the section is not offered and its endpoint answers 404', async () => {
    const token = await portal(me)
    const home = await get(token)
    expect(home.status).toBe(200)
    expect(home.body.sections.appointments).toBe(false)
    expect(home.body.summary.upcomingAppointments).toBeUndefined()
    const list = await get(token, '/appointments')
    expect([list.status, list.body.code]).toEqual([404, 'FEATURE_NOT_ENABLED'])
  })

  test('on: the client sees only their own upcoming appointments — no price, no notes, no one else\'s', async () => {
    await features([...ALL, 'portal_appointments'])
    const token = await portal(me)
    const home = await get(token)
    expect(home.body.sections.appointments).toBe(true)
    expect(home.body.summary.upcomingAppointments).toBe(1)
    expect(typeof home.body.summary.nextAppointment).toBe('string')
    const list = await get(token, '/appointments')
    expect(list.status).toBe(200)
    expect(list.body).toHaveLength(1)
    expect(Object.keys(list.body[0]).sort()).toEqual(['endTime', 'id', 'manageUrl', 'startTime', 'status', 'service', 'with'].sort())
    expect(list.body[0]).toMatchObject({ service: 'Cut', with: 'Ana', status: 'scheduled', manageUrl: null })   // made at the desk: no private link
    expect(JSON.stringify(list.body)).not.toContain('private note')
    // someone else's portal shows theirs
    const theirs = await get(await portal(other), '/appointments')
    expect(theirs.body).toHaveLength(1)
    expect(theirs.body[0].id).not.toBe(list.body[0].id)
  })

  test('one booked online carries the link to its own booking page', async () => {
    const day = next(3, 4)
    const r = await t.call(`/api/book/services/${onlineSlug}`, { method: 'POST', headers: { 'x-forwarded-for': '10.2.0.1' }, json: { date: day, time: '10:00', name: 'Portal Pia', email: 'pia@example.com', phone: '608-555-0180' } })
    expect(r.status).toBe(201)
    const booked = (await r.json()) as any
    const list = await get(await portal(me), '/appointments')
    const online = list.body.find((a: any) => a.manageUrl)
    expect(online).toBeTruthy()
    expect(online.manageUrl.endsWith(`/booking/${booked.token}`)).toBe(true)
    expect(list.body).toHaveLength(2)
  })

  test('a cancelled appointment leaves the list, and a business without the section is untouched', async () => {
    const token = await portal(me)
    const before = await get(token, '/appointments')
    await t.db.update(t.schema.appointment).set({ status: 'cancelled' } as any).where(eq(t.schema.appointment.id, before.body[0].id))
    expect((await get(token, '/appointments')).body).toHaveLength(before.body.length - 1)
    const c = await bootTenant({ vertical: 'contractor' })
    const cs = await seedOwner(c)
    const [ct] = await c.db.insert(c.schema.contact).values({ companyId: cs.company.id, name: 'Pat', email: 'pat@example.com', type: 'client' } as any).returning()
    await c.db.update(c.schema.company).set({ enabledFeatures: ['contacts', 'client_portal', 'portal_appointments'] } as any).where(eq(c.schema.company.id, cs.company.id))
    c.services.features.forgetFeatures()
    const login = (await (await c.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: cs.password } })).json()) as any
    const en = (await (await c.call(`/api/portal/contacts/${ct.id}/enable`, { method: 'POST', headers: { Authorization: `Bearer ${login.accessToken}` } })).json()) as any
    const tok = String(en.portalUrl).split('/').pop()
    expect((await c.call(`/api/portal/p/${tok}/appointments`)).status).toBe(404)
  }, 120_000)
})

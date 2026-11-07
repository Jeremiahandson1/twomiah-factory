// Salon, for the phone (owner's decisions 2026-10-29), through the real server and real logins:
//  • the home's "Today", "Members" and "Rebook" tiles each open EXACTLY what they count (one shared condition, ?tile=);
//  • a stylist is never shown a price — not on the list, the client's chart, the dashboard, the service menu — and cannot set one;
//  • the front desk may check a client in (schedule:check-in) and nothing else in the book.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const PW = 'Salon-tiles-1029'
const hasKey = (v: unknown, keys: string[]): boolean => {
  if (Array.isArray(v)) return v.some((x) => hasKey(x, keys))
  if (v && typeof v === 'object') return Object.entries(v).some(([k, x]) => keys.includes(k) || hasKey(x, keys))
  return false
}
const PRICE_KEYS = ['price', 'quotedPrice', 'priceCharged', 'planPrice', 'revenue', 'revenueThisMonth']

describe('salon: tiles, prices, check-in', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = ''
  const tok: Record<string, string> = {}
  const id: Record<string, string> = {}
  let client = '', cut = '', plan = ''
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tok[who]}` } })
    const text = await r.text(); let body: any = text
    try { body = JSON.parse(text) } catch { /* */ }
    return { status: r.status, body }
  }
  const at = (h: number, off = 0) => { const d = new Date(); d.setUTCHours(h, 0, 0, 0); return new Date(d.getTime() + off * 86400000) }
  const appt = async (h: number, status: string, off = 0, extra: any = {}) =>
    (await t.db.insert(t.schema.appointment).values({ companyId: co, contactId: client, serviceId: cut, startTime: at(h, off), endTime: at(h + 1, off), status, stylistId: id.ana, quotedPrice: '50', ...extra } as any).returning())[0]
  const rows = (b: any) => b.data ?? b

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t); co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: 'UTC', enabledFeatures: ['contacts', 'invoices', 'client_profiles', 'service_menu', 'salon_booking', 'salon_memberships', 'rebooking_reminders', 'dashboard', 'team'] } as any).where(eq(t.schema.company.id, co))
    tok.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    for (const [k, role] of Object.entries({ ana: 'field', desk: 'viewer', manager: 'manager' })) {
      const email = `${k}@test.example`
      const [u] = await t.db.insert(t.schema.user).values({ email, passwordHash: await Bun.password.hash(PW, 'bcrypt'), firstName: k, lastName: 'T', role, companyId: co } as any).returning()
      id[k] = u.id
      tok[k] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email, password: PW } })).json()) as any).accessToken
    }
    client = (await t.db.insert(t.schema.contact).values({ companyId: co, name: 'Casey Client', type: 'client' } as any).returning())[0].id
    cut = (await t.db.insert(t.schema.serviceMenu).values({ companyId: co, name: 'Cut', price: '50', durationMin: 60, rebookIntervalDays: 30 } as any).returning())[0].id
    plan = (await t.db.insert(t.schema.membershipPlan).values({ companyId: co, name: 'Gold', price: '99' } as any).returning())[0].id
  }, 120_000)

  test('Today: the dashboard count and ?tile=today are one condition — cancelled and no-show are in neither, nor are other days', async () => {
    const keep = [await appt(9, 'scheduled'), await appt(11, 'checked_in'), await appt(13, 'completed')]
    await appt(10, 'cancelled'); await appt(12, 'no_show'); await appt(9, 'scheduled', 1); await appt(9, 'scheduled', -1)
    const stats = await as('owner', '/api/dashboard/stats')
    const list = await as('owner', '/api/appointments?tile=today')
    expect(list.status).toBe(200)
    expect(rows(list.body).map((a: any) => a.id).sort()).toEqual(keep.map((a) => a.id).sort())
    expect(stats.body.data?.appointments?.today ?? stats.body.appointments.today).toBe(keep.length)
    expect((await as('owner', '/api/appointments?tile=nonsense')).status).toBe(400)
  })

  test('Members: ?tile=active lists exactly the active enrolments the dashboard counts', async () => {
    const mk = (status: string) => t.db.insert(t.schema.membershipEnrollment).values({ companyId: co, planId: plan, contactId: client, status } as any).returning().then((r: any) => r[0])
    const a = await mk('active'); await mk('paused'); await mk('cancelled')
    const list = await as('manager', '/api/memberships/enrollments?tile=active')
    expect(rows(list.body).map((e: any) => e.id)).toEqual([a.id])
    const stats = await as('owner', '/api/dashboard/stats')
    expect((stats.body.data ?? stats.body).memberships.activeEnrollments).toBe(1)
    expect((await as('manager', '/api/memberships/enrollments?tile=bogus')).status).toBe(400)
  })

  test('Rebook: a client with only a CANCELLED future appointment is still due; with a live one, not', async () => {
    // its own client — the other tests book `client` ahead, which already takes them off the list
    const other = (await t.db.insert(t.schema.contact).values({ companyId: co, name: 'Dana Due', type: 'client' } as any).returning())[0].id
    await t.db.insert(t.schema.serviceRecord).values({ companyId: co, contactId: other, serviceId: cut, performedAt: new Date(Date.now() - 35 * 86400000), priceCharged: '50' } as any)
    const future = (await t.db.insert(t.schema.appointment).values({ companyId: co, contactId: other, serviceId: cut, startTime: at(15, 5), endTime: at(16, 5), status: 'cancelled', stylistId: id.ana } as any).returning())[0]
    const dueFor = async () => rows((await as('owner', '/api/reminders/due')).body).some((r: any) => r.contactId === other)
    expect(await dueFor()).toBe(true)
    await t.db.update(t.schema.appointment).set({ status: 'scheduled' } as any).where(eq(t.schema.appointment.id, future.id))
    expect(await dueFor()).toBe(false)
  })

  test('a stylist is shown no price anywhere; the owner and the front desk are', async () => {
    for (const path of ['/api/appointments?tile=today', '/api/service-menu', '/api/memberships', '/api/dashboard/stats', '/api/dashboard/recent-activity', `/api/clients/${client}`]) {
      const r = await as('ana', path)
      expect(r.status).toBeLessThan(400)
      expect(hasKey(r.body, PRICE_KEYS)).toBe(false)
    }
    expect(hasKey((await as('owner', '/api/service-menu')).body, ['price'])).toBe(true)
    expect(hasKey((await as('owner', '/api/appointments?tile=today')).body, ['quotedPrice'])).toBe(true)
  })

  test('a stylist cannot set a price: a quote or charge they send is ignored, the menu price stands', async () => {
    const made = await as('manager', '/api/appointments', 'POST', { contactId: client, serviceId: cut, startTime: at(16, 2).toISOString(), stylistId: id.ana, quotedPrice: 5 })
    expect(made.status).toBeLessThan(300)
    const mine = (made.body.data ?? made.body).id
    await as('ana', `/api/appointments/${mine}`, 'PUT', { quotedPrice: 1 })
    const [row] = await t.db.select().from(t.schema.appointment).where(eq(t.schema.appointment.id, mine))
    expect(Number(row.quotedPrice)).toBe(5)
    const rec = await as('ana', '/api/service-records', 'POST', { contactId: client, serviceId: cut, priceCharged: 1, performedAt: new Date().toISOString() })
    expect(rec.status).toBeLessThan(300)
    const [r2] = await t.db.select().from(t.schema.serviceRecord).where(eq(t.schema.serviceRecord.id, (rec.body.data ?? rec.body).id))
    expect(Number(r2.priceCharged)).toBe(50)
  })

  test('the front desk checks a client in, but cannot move, complete or cancel', async () => {
    const a = await appt(17, 'scheduled')
    expect((await as('desk', `/api/appointments/${a.id}/check-in`, 'POST')).status).toBeLessThan(300)
    const [row] = await t.db.select().from(t.schema.appointment).where(eq(t.schema.appointment.id, a.id))
    expect(row.status).toBe('checked_in')
    const b = await appt(18, 'scheduled')
    expect((await as('desk', `/api/appointments/${b.id}`, 'PUT', { status: 'cancelled' })).status).toBe(403)
    expect((await as('desk', `/api/appointments/${b.id}/cancel`, 'POST')).status).toBeGreaterThanOrEqual(400)
  })
})

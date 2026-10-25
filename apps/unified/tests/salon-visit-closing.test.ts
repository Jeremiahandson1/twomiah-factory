// A visit closes one way (server/crm/salon/visit.ts), whether the appointment is completed or a service is logged
// against it. The service log had its own copy that raised the sale and never awarded loyalty: the salon live test's
// first client, whose visit was closed by logging her Blow-dry with its formula, never joined the programme (2026-10-25).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const json = async (r: Response) => (await r.json()) as any

describe('logging a service against an appointment closes the visit the one way', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let companyId = ''
  let owner: (p: string, init?: any) => Promise<Response>
  let casey = '', blowDry = ''
  const member = async (contactId: string) => (await t.db.select().from(t.schema.loyaltyMember).where(eq(t.schema.loyaltyMember.contactId, contactId)))[0]

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    companyId = s.company.id
    await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'invoices', 'client_profiles', 'service_menu', 'salon_booking', 'loyalty_rewards'] } as any).where(eq(t.schema.company.id, companyId))
    const tok = (await json(await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } }))).accessToken
    owner = (p, init = {}) => Promise.resolve(t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } }))
    casey = (await t.db.insert(t.schema.contact).values({ companyId, name: 'Casey Customer', type: 'client' } as any).returning())[0].id
    blowDry = (await t.db.insert(t.schema.serviceMenu).values({ companyId, name: 'Blow-dry', price: '40', durationMin: 30 } as any).returning())[0].id
  }, 120_000)

  test('the client joins loyalty, earns on the visit, and the appointment has one sale and one visit record', async () => {
    // Loyalty never configured: the programme runs by default (the page shows it ticked)
    const [a] = await t.db.insert(t.schema.appointment).values({ companyId, contactId: casey, serviceId: blowDry, startTime: new Date('2026-10-25T15:00:00Z'), endTime: new Date('2026-10-25T15:30:00Z'), status: 'in_chair', quotedPrice: '40' } as any).returning()
    const r = await owner('/api/service-records', { method: 'POST', json: { contactId: casey, appointmentId: a.id, serviceId: blowDry, formula: [{ product: 'Root shade 6N', amount: '40 g' }], priceCharged: 40 } })
    expect(r.status).toBe(201)
    const body = await json(r)
    expect(body.invoiceId).toBeTruthy()

    const m = await member(casey)
    expect(m).toBeTruthy()
    expect(m.lifetimePoints).toBe(40)
    const [appt] = await t.db.select().from(t.schema.appointment).where(eq(t.schema.appointment.id, a.id))
    expect(appt.status).toBe('completed')
    const records = await t.db.select().from(t.schema.serviceRecord).where(eq(t.schema.serviceRecord.appointmentId, a.id))
    expect(records.length).toBe(1)
    expect(records[0].invoiceId).toBe(body.invoiceId)
    const sales = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.contactId, casey))
    expect(sales.length).toBe(1)

    // Completing it again afterwards pays nothing twice
    expect((await owner(`/api/appointments/${a.id}`, { method: 'PUT', json: { status: 'completed' } })).status).toBe(200)
    expect((await member(casey)).lifetimePoints).toBe(40)
    expect((await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.contactId, casey))).length).toBe(1)
  })
})

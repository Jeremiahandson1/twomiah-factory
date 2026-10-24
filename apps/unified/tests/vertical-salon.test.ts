// The salon vertical (verticals/salon/settings.ts, server/crm/salon, from templates/crm-salon) through the real server:
// its modules answer behind their features, the app-wide paging guard refuses what the template's handlers clamped,
// a converted lead is a client, a visit with a payment on it is not deleted, the visit repair leaves a paid sale alone,
// and the losing punch-card claim speaks of the front desk. These hold what the salon suite's documented divergences
// (tests/unified/harness/unified-divergences.ts, salon) assert against the template.
import { describe, test, expect, beforeAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let token = ''
let companyId = ''
const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { Authorization: `Bearer ${token}` } })
const features = (list: string[]) => as('/api/company/features', { method: 'PUT', json: { features: list } })
const SALON = ['contacts', 'invoices', 'team', 'dashboard', 'client_profiles', 'service_menu', 'salon_booking', 'rebooking_reminders', 'salon_memberships', 'loyalty_rewards', 'lead_inbox']

beforeAll(async () => {
  t = await bootTenant({ vertical: 'salon' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
}, 60_000)

describe('salon', () => {
  test("its modules answer behind their features (the template's index.ts and menu gates)", async () => {
    // The book, the chart, the menu and recall are the salon's core features (always on); memberships and loyalty are
    // switches.
    expect((await features(['contacts'])).status).toBe(200)
    for (const p of ['/api/memberships', '/api/loyalty/config']) {
      const r = await as(p)
      expect(r.status).toBe(403)
      expect((await r.json()).code).toBe('FEATURE_NOT_ENABLED')
    }
    expect((await features(SALON)).status).toBe(200)
    for (const p of ['/api/clients', '/api/service-menu', '/api/appointments', '/api/reminders/due', '/api/memberships', '/api/loyalty/config', '/api/dashboard/stats']) {
      expect((await as(p)).status).toBe(200)
    }
    // The salon's own dashboard, not the jobs one.
    const stats = await (await as('/api/dashboard/stats')).json()
    expect(stats.appointments).toBeDefined()
    expect(stats.reminders).toBeDefined()
  }, 30_000)

  test('an over-cap or nonsense page is refused by the paging guard, not clamped (list-caps, list-bounds, appt-list)', async () => {
    expect((await features(SALON)).status).toBe(200)
    for (const p of ['/api/clients?limit=100000', '/api/memberships/enrollments?limit=99999', '/api/appointments?limit=99999', '/api/appointments?limit=0&page=0', '/api/clients?limit=abc&page=-3']) {
      const r = await as(p)
      expect(r.status).toBe(400)
      expect((await r.json()).code).toBe('invalid_pagination')
    }
    // The largest page is still answered, with the pager.
    const ok = await (await as('/api/appointments?limit=500')).json()
    expect(ok.pagination.limit).toBe(500)
  }, 30_000)

  test('a windowed book is one page holding every appointment (appt-list)', async () => {
    const client = await (await as('/api/contacts', { method: 'POST', json: { name: 'Window Client', type: 'client' } })).json()
    const day = Date.now() + 3 * 86400000
    for (let i = 0; i < 3; i++) {
      const r = await as('/api/appointments', { method: 'POST', json: { contactId: client.id, startTime: new Date(day + i * 7200000).toISOString() } })
      expect(r.status).toBe(201)
    }
    const from = new Date(day - 3600000).toISOString(), to = new Date(day + 86400000).toISOString()
    const win = await (await as(`/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).json()
    expect(win.data.length).toBe(3)
    expect(win.pagination).toEqual({ page: 1, limit: 50, total: 3, pages: 1 })
  }, 30_000)

  test('a visit that has been paid for is not deleted, and the refusal names the invoice and the money (salon-orphan-invoice)', async () => {
    const client = await (await as('/api/contacts', { method: 'POST', json: { name: 'Paid Visit', type: 'client' } })).json()
    const rec = await (await as('/api/service-records', { method: 'POST', json: { contactId: client.id, priceCharged: 55, notes: 'Cut' } })).json()
    expect(rec.invoiceId).toBeTruthy()
    await t.db.update(t.schema.invoice).set({ amountPaid: '55', status: 'paid' } as any).where(eq(t.schema.invoice.id, rec.invoiceId))
    const del = await as(`/api/service-records/${rec.id}`, { method: 'DELETE' })
    expect(del.status).toBe(400)
    const body = await del.json()
    expect(body.code).toBe('VISIT_HAS_PAYMENT')
    expect(body.error).toMatch(/INV-\d+ holds \$55\.00/)
  }, 30_000)

  test('the visit repair never voids a sale holding money (salon-repair-legacy)', async () => {
    const client = await (await as('/api/contacts', { method: 'POST', json: { name: 'Orphan Sale', type: 'client' } })).json()
    const [paid] = await t.db.insert(t.schema.invoice).values({
      companyId, contactId: client.id, number: 'INV-90001', status: 'open', subtotal: '70.53', total: '70.53', amountPaid: '70.53', amountRefunded: '0', notes: 'Created from the appointment book',
    } as any).returning()
    const [unpaid] = await t.db.insert(t.schema.invoice).values({
      companyId, contactId: client.id, number: 'INV-90002', status: 'open', subtotal: '10.85', total: '10.85', amountPaid: '0', amountRefunded: '0', notes: 'Created from the appointment book',
    } as any).returning()
    const r = await as('/api/service-records/repair-legacy', { method: 'POST' })
    expect(r.status).toBe(200)
    const status = async (id: string) => (await t.db.select({ s: t.schema.invoice.status }).from(t.schema.invoice).where(eq(t.schema.invoice.id, id)))[0]?.s
    expect(await status(paid.id)).not.toBe('void')
    expect(await status(unpaid.id)).toBe('void')
  }, 30_000)

  test('a converted lead is a client, in the book (CrmSettings.leads.contactType; Salon T27 N13)', async () => {
    const [lead] = await t.db.insert(t.schema.lead).values({ companyId, sourcePlatform: 'booking_app', homeownerName: 'App Booker', email: 'booker@test.example', status: 'new' } as any).returning()
    const conv = await as(`/api/leads/${lead.id}/convert`, { method: 'POST', json: {} })
    expect([200, 201]).toContain(conv.status)
    const out = await conv.json()
    const contactId = out.contact?.id || out.contactId
    expect(contactId).toBeTruthy()
    const [row] = await t.db.select({ type: t.schema.contact.type }).from(t.schema.contact).where(eq(t.schema.contact.id, contactId))
    expect(row?.type).toBe('client')
  }, 30_000)

  test("the losing punch-card claim speaks of the front desk, not a till (lyr N4)", () => {
    const src = readFileSync(new URL('../server/crm/salon/loyalty.ts', import.meta.url), 'utf8')
    const claimed = /That card has already been used\.[^']*/.exec(src)?.[0] || ''
    expect(claimed).toMatch(/front desk/i)
    expect(claimed).not.toMatch(/\btills?\b/i)
  })
})

// The CRM's shared modules, through the real server: a contact, a quote and an invoice made and read back; the core
// CRM switched off for a website-only business; every module answering a signed-in read without a server error.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let seeded: Awaited<ReturnType<typeof seedOwner>>
let owner: string

const ALL = ['contacts', 'jobs', 'quotes', 'invoices', 'team', 'dashboard', 'time_tracking', 'expense_tracking', 'projects', 'photo_capture',
  'recurring_jobs', 'tech_mobile_view', 'commission_tracking', 'multi_location', 'equipment_tracking', 'inventory', 'fleet', 'warranties',
  'service_agreements', 'email_marketing', 'google_reviews', 'two_way_texting', 'quickbooks', 'paid_ads']

const signIn = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const setFeatures = async (f: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: f }).where(eq(t.schema.company.id, seeded.company.id))
  t.services.features.forgetFeatures()
}

beforeAll(async () => {
  t = await bootTenant()
  seeded = await seedOwner(t)
  await setFeatures(ALL)
  owner = await signIn('owner@test.example', seeded.password)
})

describe('the CRM', () => {
  test('a contact, a quote for them and an invoice are made and read back', async () => {
    const c = await as('/api/contacts', { method: 'POST', json: { name: 'Pat Client', type: 'client', email: 'pat@client.example' } })
    expect(c.status).toBe(201)
    const contact = await c.json()
    const q = await as('/api/quotes', { method: 'POST', json: { name: 'Deck', contactId: contact.id, lineItems: [{ description: 'Boards', quantity: 10, unitPrice: 25 }] } })
    expect(q.status).toBe(201)
    const quote = await q.json()
    expect(Number(quote.total)).toBe(250)
    const i = await as('/api/invoices', { method: 'POST', json: { contactId: contact.id, lineItems: [{ description: 'Deck', quantity: 1, unitPrice: 250 }] } })
    expect(i.status).toBe(201)
    const list = await (await as('/api/invoices')).json()
    expect(list.data.length).toBe(1)
    expect(list.pagination.total).toBe(1)
  })

  test('a quote PDF is written', async () => {
    const [q] = await t.db.select().from(t.schema.quote).limit(1)
    const res = await as(`/api/quotes/${q.id}/pdf`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('pdf')
  })

  test('every module answers a signed-in read without a server error', async () => {
    const roots = ['/api/contacts', '/api/jobs', '/api/quotes', '/api/invoices', '/api/team', '/api/dashboard/stats', '/api/time', '/api/expenses',
      '/api/tasks', '/api/photos', '/api/recurring', '/api/tech/jobs', '/api/commissions', '/api/locations', '/api/equipment', '/api/inventory/items',
      '/api/fleet/vehicles', '/api/warranties/templates', '/api/agreements', '/api/documents', '/api/reports/revenue', '/api/pricebook/items',
      '/api/ads/overview', '/api/onboarding', '/api/messaging-billing/status', '/api/gbp', '/api/inbound-messages', '/api/sms/conversations',
      '/api/stripe/config', '/api/marketing/campaigns', '/api/quickbooks/status', '/api/reviews/stats', '/api/integrations/status']
    const bad: string[] = []
    for (const p of roots) {
      const res = await as(p)
      if (res.status >= 500 || res.status === 401) bad.push(`${p} ${res.status} ${(await res.text()).slice(0, 120)}`)
    }
    expect(bad).toEqual([])
  })

  test('without the CRM (a website-only business) its core is switched off at the server', async () => {
    await setFeatures(['website'])
    for (const p of ['/api/contacts', '/api/jobs', '/api/quotes', '/api/invoices', '/api/team']) expect((await as(p)).status).toBe(403)
    await setFeatures(ALL)
  })

  test('nothing is readable without signing in', async () => {
    for (const p of ['/api/contacts', '/api/invoices', '/api/sms/conversations', '/api/stripe/config', '/api/marketing/campaigns']) {
      expect((await t.call(p)).status).toBe(401)
    }
  })
})

// PR #173 follow-up, fix 2: the Factory's admin Pricing page. Seat products (crm, crm-fieldservice, crm-roof, crm-homecare) show
// the seat plans from packages/tenant-backend/src/plans.ts READ-ONLY, whatever the stored factory_pricing row still holds, and a
// save never writes them; the dispensary's own tiers stay editable. Nothing here touches Stripe or what a customer pays.
import { describe, test, expect, mock, beforeAll, beforeEach } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { sharedFactoryDb } from './fakeStore.ts'

const supabase = sharedFactoryDb
mock.module(path.resolve(import.meta.dir, '../../../apps/api/src/middleware/auth.ts'), () => ({ supabase, authenticate: async (_c: any, next: any) => next(), requireRole: () => async (_c: any, next: any) => next() }))
const { Hono } = createRequire(path.resolve(import.meta.dir, '../../../apps/api/package.json'))('hono')
const { PLANS } = await import('../../../packages/tenant-backend/src/plans.ts')
const { PRODUCTS, getProductDefaults } = await import('../../../apps/api/src/config/pricing.ts')

const SEAT = ['crm', 'crm-fieldservice', 'crm-roof', 'crm-homecare']
const WANT = [['starter10', 99], ['team25', 139], ['business50', 199]]
const OLD = [{ id: 'professional', name: 'Professional', monthlyPrice: 129, annualPrice: 108, users: { included: 5, max: 10 }, features: ['invoicing'] }]
const DISPO = [{ id: 'leaf-1', name: 'Leaf One', monthlyPrice: 79, annualPrice: 79, users: { included: 3, max: 3 }, features: ['menu'] }]
const planList = (row: any) => (row.saas_tiers as any[]).map((p) => [p.id, p.monthlyPrice])

let app: any
beforeAll(async () => {
  const { registerBillingRoutes } = await import('../../../apps/api/src/routes/factory/billing')
  app = new Hono()
  registerBillingRoutes(app as any)
})
beforeEach(() => {
  supabase.tables.factory_pricing = PRODUCTS.map((p: any) => ({
    product: p.id, ...getProductDefaults(p.id),
    saas_tiers: p.id === 'crm-dispensary' ? DISPO : OLD,
    self_hosted: [{ id: 'old-license', name: 'Old', price: 1 }],
  }))
  supabase.writes.length = 0
})
const get = async () => ((await (await app.request('/pricing')).json()) as any).pricing as any[]
const put = (body: any) => app.request('/pricing', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const stored = (product: string) => (supabase.tables.factory_pricing as any[]).find((r) => r.product === product)

describe('GET /pricing', () => {
  test.each(SEAT)('%s: the seat plans, read-only, with where they are set — not the stored old tiers', async (product) => {
    const row = (await get()).find((r) => r.product === product)
    expect(planList(row)).toEqual(WANT)
    expect(row.seat_plans_read_only).toBe(true)
    expect(row.seat_plans_set_in).toBe('packages/tenant-backend/src/plans.ts')
    expect(JSON.stringify(row.saas_tiers)).not.toContain('Professional')
    // self-hosted licence = 36× the monthly
    expect(row.self_hosted.map((l: any) => l.price)).toEqual(WANT.map(([, m]) => (m as number) * 36))
  })

  test('the dispensary: its own stored tiers, editable', async () => {
    const row = (await get()).find((r) => r.product === 'crm-dispensary')
    expect(row.saas_tiers).toEqual(DISPO)
    expect(row.seat_plans_read_only).toBeUndefined()
  })

  test('the catalog the page shows is the catalog the sign-up pages read', async () => {
    const row = (await get()).find((r) => r.product === 'crm')
    expect(row.saas_tiers.map((p: any) => p.monthlyPrice)).toEqual(['starter10', 'team25', 'business50'].map((id) => PLANS[id].monthlyPrice))
  })

  test('GET changes nothing in the stored rows', async () => {
    await get()
    expect(stored('crm').saas_tiers).toEqual(OLD)
    expect(supabase.writes.filter((w: any) => w.table === 'factory_pricing')).toEqual([])
  })
})

describe('PUT /pricing', () => {
  const edit = { saas_tiers: [{ id: 'x', name: 'Cheap', monthlyPrice: 1, annualPrice: 1, users: { included: 1, max: 1 }, features: [] }], self_hosted: [{ id: 'x', name: 'x', price: 1 }] }

  test.each(SEAT)('%s: tiers and licences sent are not saved; the add-ons and services are', async (product) => {
    const bundles = [{ id: 'sms', name: 'SMS', price: 45, description: 'texting' }]
    const r = await put({ product, ...edit, feature_bundles: bundles })
    expect(r.status).toBe(200)
    expect(((await r.json()) as any).readOnly).toEqual(['saas_tiers', 'self_hosted'])
    expect(stored(product).saas_tiers).toEqual(OLD)
    expect(stored(product).self_hosted).toEqual([{ id: 'old-license', name: 'Old', price: 1 }])
    expect(stored(product).feature_bundles).toEqual(bundles)
    // and what a visitor / the page sees is still the seat plans
    expect(planList((await get()).find((x) => x.product === product))).toEqual(WANT)
  })

  test('the dispensary: its tiers are saved as sent', async () => {
    const r = await put({ product: 'crm-dispensary', ...edit })
    expect(r.status).toBe(200)
    expect(((await r.json()) as any).readOnly).toBeUndefined()
    expect(stored('crm-dispensary').saas_tiers).toEqual(edit.saas_tiers)
    expect(stored('crm-dispensary').self_hosted).toEqual(edit.self_hosted)
  })
})

describe('the admin page', () => {
  const page = readFileSync(path.resolve(import.meta.dir, '../../../apps/platform/src/pages/PricingAdminPage.tsx'), 'utf8')
  test('it shows read-only seat plans with the note, and sends no tiers for a seat product', () => {
    expect(page).toContain('seat_plans_read_only')
    expect(page).toContain('seat_plans_set_in')
    expect(page).toContain('These plans are not set on this page')
    // the save leaves tiers and licences out for a read-only product
    expect(page).toMatch(/seatReadOnly \? \{\} : \{ saas_tiers: tiers, self_hosted: selfHosted \}/)
  })
})

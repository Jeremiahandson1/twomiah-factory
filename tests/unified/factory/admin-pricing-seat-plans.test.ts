// PR #173 follow-up, fix 2: the Factory's admin Pricing page. Seat products (crm, crm-fieldservice, crm-roof, crm-homecare) show
// the seat plans from packages/tenant-backend/src/plans.ts READ-ONLY, whatever the stored factory_pricing row still holds, and a
// save never writes them; the dispensary's own tiers stay editable. Nothing here touches Stripe or what a customer pays.
import { describe, test, expect, mock, beforeAll, beforeEach } from 'bun:test'
import { stubAuth } from './stubs.ts'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { sharedFactoryDb } from './fakeStore.ts'

const supabase = sharedFactoryDb
stubAuth({ supabase, authenticate: async (_c: any, next: any) => next(), requireRole: () => async (_c: any, next: any) => next() })
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

  // 10/30: a seat product's whole offer is code — plans, add-ons, the custom build, self-hosted extras. A save writes none of it.
  test.each(SEAT)('%s: nothing sent for a seat product is saved — its offer is code', async (product) => {
    const before = JSON.parse(JSON.stringify(stored(product)))
    const bundles = [{ id: 'sms', name: 'SMS', price: 45, description: 'texting' }]
    const r = await put({ product, ...edit, feature_bundles: bundles, deploy_services: [{ id: 'basic', name: 'Basic', price: 299 }], self_hosted_addons: [{ id: 'custom_dev', name: 'Custom Development', price: 150, type: 'per_hour' }] })
    expect(r.status).toBe(200)
    expect(((await r.json()) as any).readOnly).toEqual(['saas_tiers', 'self_hosted', 'self_hosted_addons', 'deploy_services', 'feature_bundles'])
    for (const k of ['saas_tiers', 'self_hosted', 'feature_bundles', 'deploy_services', 'self_hosted_addons']) expect([k, stored(product)[k]]).toEqual([k, before[k]])
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
    expect(page).toContain("This product's offer is not set on this page")
    // the save leaves tiers and licences out for a read-only product
    expect(page).toMatch(/seatReadOnly \? \{\} : \{ saas_tiers: tiers, self_hosted: selfHosted \}/)
  })
})

// The owner's offer (10/27, pricing v2): seat plans; paid add-ons are texting, AI and (contractor, roofing) the Exterior Visualizer;
// the one paid custom service is the $499 custom build; support is free. The retired set-up tiers ($299/$699), per-feature
// "bundles", support contract and hourly custom development were still the Factory's defaults on 10/30.
describe('the offer the Factory shows matches the owner’s offer', () => {
  const plans = async (product: string) => (await (await app.request('/plans?product=' + product)).json()) as any
  test.each(SEAT)('%s: /plans sends the seat plans, the real add-ons and the $499 custom build — whatever the stored row says', async (product) => {
    const row = stored(product)
    Object.assign(row, { feature_bundles: [{ id: 'construction_pm', name: 'Construction PM', price: 149 }], deploy_services: [{ id: 'basic', name: 'Basic', price: 299 }] })
    const p = await plans(product)
    expect(p.plans.map((x: any) => [x.id, x.monthlyPrice])).toEqual(WANT)
    expect(p.deployServices).toEqual([{ id: 'custom_build', name: 'Custom build', price: 499, description: expect.any(String) }])
    const addons = p.addons.map((a: any) => [a.id, a.price])
    expect(addons).toEqual([['texting', 10], ['ai', 10], ...(product === 'crm' || product === 'crm-roof' ? [['exterior_visualizer', 59]] : [])])
    const extras = p.selfHostedAddons.map((a: any) => a.id)
    expect(extras).not.toContain('support_monthly')
    expect(extras).not.toContain('custom_dev')
  })
  test('the staff wizard and the care sign-up offer the same: no retired tier, no feature sold as an add-on, no EVV claim', () => {
    const code = (p: string) => readFileSync(path.resolve(import.meta.dir, p), 'utf8').replace(/^\s*\/\/.*$/gm, '') // the code, not its history notes
    const wizard = code('../../../apps/platform/src/components/factory/planData.ts')
    for (const gone of ['price: 299', 'price: 699', 'Ads Hub', 'Vision Starter']) expect([gone, wizard.includes(gone)]).toEqual([gone, false])
    expect(wizard).toContain("{ id: 'custom_build', name: 'Custom build', price: 499")
    const care = code('../../../apps/platform/src/pages/CareSignupPage.tsx')
    for (const gone of ['EVV Integration', 'Medicaid', 'Advanced Billing', 'within 24 hours', 'marketing_site']) expect([gone, care.includes(gone)]).toEqual([gone, false])
    // what it offers is what the sign-up charges: texting, sent as an add-on
    expect(care).toContain("const SIGNUP_CHARGES = ['texting']")
    expect(care).toMatch(/^\s+addons,$/m)
  })
})

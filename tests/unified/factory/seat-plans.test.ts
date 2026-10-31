// Brief item 10: every customer-facing place that shows what the software costs reads the SEAT plans in
// packages/tenant-backend/src/plans.ts (Starter $99 / 10 people, Team $139 / 25, Business $199 / 50) — not the old feature tiers.
// Covers: the Factory's public /api/v1/factory/plans (even when a stale old-tier row is stored), the care sign-up page's plans,
// and the Factory wizard's plan list. Display only: nothing here touches Stripe or what an existing customer pays.
import { describe, test, expect, mock, beforeAll } from 'bun:test'
import { stubAuth } from './stubs.ts'
import path from 'node:path'
import { createRequire } from 'node:module'
import { sharedFactoryDb } from './fakeStore.ts'

const supabase = sharedFactoryDb
stubAuth({ supabase, authenticate: async () => {}, requireRole: () => async (_c: any, next: any) => next() })
const { Hono } = createRequire(path.resolve(import.meta.dir, '../../../apps/api/package.json'))('hono')

const { PLANS } = await import('../../../packages/tenant-backend/src/plans.ts')
const { publicPlans, DEFAULT_SAAS_TIERS, getProductDefaults } = await import('../../../apps/api/src/config/pricing.ts')
const care = await import('../../../apps/platform/src/pages/careSignupPlans.ts')
const wizard = await import('../../../apps/platform/src/components/factory/planData.ts')

const IDS = ['starter10', 'team25', 'business50']
const OLD_TIER = [{ id: 'professional', name: 'Professional', monthlyPrice: 129, annualPrice: 108, features: ['invoicing'] }]
const prices = (plans: any[]) => plans.map((p) => [p.id, p.monthlyPrice])
const WANT = IDS.map((id) => [id, PLANS[id].monthlyPrice])

describe('the catalog the pages read', () => {
  test('is Starter $99/10, Team $139/25, Business $199/50', () => {
    expect(WANT).toEqual([['starter10', 99], ['team25', 139], ['business50', 199]])
    expect(IDS.map((id) => PLANS[id].seats)).toEqual([10, 25, 50])
  })
})

describe('Factory: the plans it publishes', () => {
  test('the defaults are the seat plans', () => {
    expect(prices(DEFAULT_SAAS_TIERS)).toEqual(WANT)
    expect(DEFAULT_SAAS_TIERS.map((p: any) => p.users.max)).toEqual([10, 25, 50])
  })

  test.each(['crm', 'crm-fieldservice', 'crm-roof', 'crm-homecare'])('%s: seat plans even when the stored row still has the old tiers', (product) => {
    const shown = publicPlans(product, { saas_tiers: OLD_TIER, self_hosted: [] })
    expect(prices(shown.plans as any[])).toEqual(WANT)
    expect(JSON.stringify(shown.plans)).not.toContain('Professional')
  })

  test('cannabis retail keeps its own tiers', () => {
    const stored = [{ id: 'dispo-x', name: 'Dispo X', monthlyPrice: 5 }]
    expect(publicPlans('crm-dispensary', { saas_tiers: stored, self_hosted: [] }).plans).toEqual(stored as any)
  })

  test('the plans do not promise a feature lock or an annual discount', () => {
    for (const p of DEFAULT_SAAS_TIERS as any[]) {
      expect(p.annualPrice).toBe(p.monthlyPrice)
      expect(p.features.join(' ')).toContain('nothing is locked')
    }
  })

  describe('GET /plans', () => {
    let app: any
    beforeAll(async () => {
      const { registerBillingRoutes } = await import('../../../apps/api/src/routes/factory/billing')
      app = new Hono()
      registerBillingRoutes(app as any)
    })
    const get = async (product: string) => (await app.request(`/plans?product=${product}`)).json() as Promise<any>

    test('a stored old-tier row is not what a visitor sees', async () => {
      supabase.tables.factory_pricing = [{ product: 'crm-roof', ...getProductDefaults('crm-roof'), saas_tiers: OLD_TIER }]
      expect(prices((await get('crm-roof')).plans)).toEqual(WANT)
    })

    test('with no row yet, the seat plans too', async () => {
      supabase.tables.factory_pricing = []
      expect(prices((await get('crm-homecare')).plans)).toEqual(WANT)
      expect(prices((await get('crm')).plans)).toEqual(WANT)
    })
  })
})

describe('care sign-up page', () => {
  test('its own plans carry the real ids and prices', () => {
    expect(Object.keys(care.FALLBACK_PLANS)).toEqual(IDS)
    expect(Object.values(care.FALLBACK_PLANS).map((p: any) => [p.id, p.price])).toEqual(WANT)
    expect(Object.values(care.FALLBACK_PLANS).map((p: any) => p.users)).toEqual([10, 25, 50])
    expect(care.annualOffered(care.FALLBACK_PLANS)).toBe(false)
  })

  test('the Factory answer becomes cards keyed by the plan id', () => {
    const cards = care.mapApiPlansToLocal(publicPlans('crm-homecare', null).plans as any[])
    expect(Object.keys(cards)).toEqual(IDS)
    expect(Object.values(cards).map((p: any) => p.price)).toEqual([99, 139, 199])
    expect(cards.team25.popular).toBe(true)
  })
})

describe('Factory wizard plan list', () => {
  test('every product line offers the seat plans at the catalog price, locking no feature', () => {
    for (const product of Object.keys(wizard.PLANS_BY_PRODUCT)) {
      const plans = (wizard.PLANS_BY_PRODUCT as any)[product]
      expect(plans.map((p: any) => [p.id, p.monthly])).toEqual(WANT)
      expect(plans.every((p: any) => p.annual === p.monthly && p.features.length === 0)).toBe(true)
    }
  })
})

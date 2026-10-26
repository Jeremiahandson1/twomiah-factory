// The online store's live test (twomiah-live-test-shop, 2026-10-26), the Factory's side:
//   · the store-ready email says what a new store has — no products — not "edit the sample products we added"
//   · a store signs up WITH a site: its home's main content is its products (shop/grid, filled live by the site), a
//     contact page, and nothing written for it (no product categories, no guides)
//   · the store is offered the Lead Inbox, so its website's enquiries reach the CRM, not only the owner's email
//   · the website editor's "Add a section" rule (apps/unified/server/site/tradeSections.ts) is the composer's page plans
import { test, expect, describe } from 'bun:test'
import { buildDeployCompleteEmail } from '../../../apps/api/src/services/email'
import { composeInstant } from '../../../apps/api/src/services/instantComposer'
import { pageRecipesFor } from '../../../apps/api/src/services/sectionComposer'
import { provisionBody, unifiedFeatures } from '../../../apps/api/src/unified/factory'
import { getFeaturesForTemplate } from '../../../packages/tenant-backend/src/featureRegistry'
import { TRADE_SECTION_VERTICALS, tradeDrawsSection } from '../../../apps/unified/server/site/tradeSections'

const shopTenant = (extra: Record<string, unknown> = {}) => ({
  id: 't-shop', slug: 'live-test-shop', name: 'Live Test Shop', industry: 'store', email: 'owner@shop.example', admin_email: 'owner@shop.example',
  city: 'Eau Claire', state: 'WI', products: ['crm', 'website'], features: [], ...extra,
})

describe('the store-ready email', () => {
  test('promises no sample products: a store starts with none', () => {
    const { html } = buildDeployCompleteEmail(shopTenant() as any, { deployedUrl: 'https://shop.example/crm', siteUrl: 'https://shop.example' } as any, 'Pat')
    expect(html).not.toMatch(/sample products/i)
    expect(html).toContain('Add your first product')
  })
})

describe('a store signs up with a site', () => {
  const body: any = provisionBody(shopTenant(), { company: {} }, '$2b$04$' + 'a'.repeat(53))
  const pages: any[] = body.site?.pages || []
  const page = (slug: string) => pages.find((p) => p.slug === slug)

  test('the provision carries a site, as every business with a website gets', () => {
    expect(body.site).toBeTruthy()
  })

  test('its home is its products: a hero sending shoppers to the shop, then the live shop grid — no "What we do"', () => {
    const home = page('home')
    expect(home?.isPublished).toBe(true)
    const types = home.sections.map((s: any) => s.type + '/' + s.variant)
    expect(types).toContain('shop/grid')
    expect(types).not.toContain('services/cards-grid')
    // The products are the catalogue's, drawn by the site — never composed.
    expect(home.sections.find((s: any) => s.type === 'shop').data.products).toBeUndefined()
    expect(home.sections[0].data.primaryCta).toEqual({ label: 'Shop now', href: 'shop' })
  })

  test('a working contact page, and nothing the plan would take from the built-in shop', () => {
    expect(page('contact')?.isPublished).toBe(true)
    expect(page('contact').sections.some((s: any) => s.type === 'contact')).toBe(true)
    for (const taken of ['shop', 'cart', 'product', 'guides']) expect(page(taken)).toBeUndefined()
  })

  test('the store plan writes no product categories or guide topics for the owner', () => {
    const site = composeInstant({ businessName: 'Live Test Shop', businessType: 'store', city: 'Eau Claire', state: 'WI', services: [] } as any)
    expect(Object.keys(site.pages).sort()).toEqual(['about', 'contact', 'home'])
    expect(JSON.stringify(site.pages)).not.toMatch(/"services"/)
  })
})

describe('the Lead Inbox', () => {
  test("is the store's: offered to crm-store, and on in a new store's features", () => {
    expect(getFeaturesForTemplate('crm-store').map((f) => f.id)).toContain('lead_inbox')
    expect(unifiedFeatures(shopTenant(), {})).toContain('lead_inbox')
  })
})

describe("the website editor's sections follow the composer's page plans", () => {
  // The business types each unified vertical runs (apps/api/src/unified/factory.ts UNIFIED_VERTICAL_OF), one sample each.
  const RUNS: Record<string, string[]> = {
    contractor: ['general contractor'], roofing: ['roofing'], fieldservice: ['hvac'], landscaping: ['landscaping'],
    homecare: ['home care'], vet: ['veterinary'], rv: ['rv dealer'], salon: ['hair salon'],
    restaurant: ['restaurant', 'food truck', 'event venue'], bar: ['bar'], store: ['online store'],
    basic: ['consulting', 'cafe', 'gym', 'hotel'],
  }
  const planTypes = (v: string) => new Set(RUNS[v].flatMap((t) => Object.values(pageRecipesFor(t) as Record<string, { allowed_types: readonly string[] }>).flatMap((r) => [...r.allowed_types])))

  test('every section type a vertical\'s plans use is offered to it', () => {
    const missing: string[] = []
    for (const v of Object.keys(RUNS)) for (const t of planTypes(v)) if (!tradeDrawsSection(t, v)) missing.push(v + ': ' + t)
    expect(missing).toEqual([])
  })

  test('a trade section is offered only where a plan uses it (the bar keeps its own editor\'s sections)', () => {
    const extra: string[] = []
    for (const [t, vs] of Object.entries(TRADE_SECTION_VERTICALS)) for (const v of vs) if (v !== 'bar' && !planTypes(v).has(t)) extra.push(v + ': ' + t)
    expect(extra).toEqual([])
  })

  test('a store is offered its products and none of the other trades\' sections', () => {
    expect(tradeDrawsSection('shop', 'store')).toBe(true)
    for (const t of ['age', 'strain', 'care', 'caregivers', 'banner', 'urgent', 'inventory', 'quote']) expect({ t, offered: tradeDrawsSection(t, 'store') }).toEqual({ t, offered: false })
    expect(tradeDrawsSection('shop', 'contractor')).toBe(false)
  })
})

// Consumer Financing is offered to no industry (live test 2026-10-22, roofing: "/crm/financing — There's no page here").
// Since batch 2 (fix-i) it is built — the pros' trades are named in featureRegistry — but registered NOT READY (hidden)
// until a real lender sandbox run passes, so no plan, signup or switch gives it to anyone. Nothing may show it, then: no
// industry is offered it, its API is refused while the switch is off, and the pricebook presentation stops reading a
// lender out of a moved business's old settings.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY, getFeaturesForPlan, getAdvertisableFeaturesForTemplate, getDefaultFeaturesForTemplate, withoutNotReady } from '@twomiah/tenant-backend/src/featureRegistry'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let token = ''
let itemId = ''
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  // A roofer moved from the old CRM, whose settings still switch a lender on.
  await t.db.update(t.schema.company).set({
    enabledFeatures: ['contacts', 'quotes', 'invoices', 'jobs', 'pricebook'],
    integrations: { financing: { wisetack: { enabled: true, merchantId: 'm-1' } } },
  } as any).where(eq(t.schema.company.id, companyId))
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
  const item = await (await call('/api/pricebook/items', { method: 'POST', json: { name: 'Roof system', price: 12000 } })).json() as any
  itemId = item.id
}, 120_000)

describe('financing is not offered', () => {
  test('the registry offers it to no industry', () => {
    const def = FEATURE_REGISTRY.find((f) => f.id === 'consumer_financing')!
    expect(def.hidden).toBe(true)
    for (const template of new Set(FEATURE_REGISTRY.flatMap((f) => f.templates))) {
      expect({ template, plan: getFeaturesForPlan(template).includes('consumer_financing') }).toEqual({ template, plan: false })
      expect({ template, shown: getAdvertisableFeaturesForTemplate(template).some((f) => f.id === 'consumer_financing') }).toEqual({ template, shown: false })
      expect({ template, default: getDefaultFeaturesForTemplate(template).includes('consumer_financing') }).toEqual({ template, default: false })
    }
    expect(withoutNotReady(['contacts', 'consumer_financing'])).toEqual(['contacts'])
  })

  test('its API is refused while the switch is off', async () => {
    expect((await call('/api/financing/status')).status).toBe(403)
    expect((await call('/api/financing/applications')).status).toBe(403)
  })

  test('the pricebook presentation shows no financing for a business without the switch', async () => {
    const page = await (await t.call(`/api/pricebook-present/${itemId}`)).text()
    expect(page).toContain('Roof system')
    expect(page).not.toMatch(/financ|wisetack|as low as/i)
  })

  test('…and still shows it where the switch is on (the gate, not a deletion)', async () => {
    await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'quotes', 'invoices', 'jobs', 'pricebook', 'consumer_financing'] } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    // The moved business's old settings name a lender, which is not a connection: still nothing until one is made.
    expect(await (await t.call(`/api/pricebook-present/${itemId}`)).text()).not.toMatch(/as low as/i)
    const r = await call('/api/financing/connection', { method: 'PUT', json: { merchantId: 'M-1001', prequalUrl: 'https://wisetack.us/#/abc123/prequalify' } })
    expect(r.status).toBe(200)
    const page = await (await t.call(`/api/pricebook-present/${itemId}`)).text()
    expect(page).toContain('As low as')
  })
})

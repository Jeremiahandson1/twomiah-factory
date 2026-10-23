// Consumer Financing is offered to no industry (featureRegistry consumer_financing: templates [], no screen to set a
// lender up or follow an application — live test 2026-10-22, roofing: "/crm/financing — There's no page here"). Nothing
// may show it, then: the registry offers it to nobody, the menu has no Financing item, its API is refused while the
// switch is off, and the pricebook presentation stops reading a lender out of a moved business's old settings.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend/src/featureRegistry'

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
    expect(FEATURE_REGISTRY.find((f) => f.id === 'consumer_financing')?.templates).toEqual([])
  })

  test('its API is refused while the switch is off', async () => {
    expect((await call('/api/financing/providers')).status).toBe(403)
  })

  test('the pricebook presentation shows no financing for a business without the switch', async () => {
    const page = await (await t.call(`/api/pricebook-present/${itemId}`)).text()
    expect(page).toContain('Roof system')
    expect(page).not.toContain('Financing Available')
  })

  test('…and still shows it where the switch is on (the gate, not a deletion)', async () => {
    await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'quotes', 'invoices', 'jobs', 'pricebook', 'consumer_financing'] } as any).where(eq(t.schema.company.id, companyId))
    const page = await (await t.call(`/api/pricebook-present/${itemId}`)).text()
    expect(page).toContain('Financing Available')
  })
})

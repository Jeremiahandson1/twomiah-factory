// Parity tier 3 (11/10, store): carrier rates at checkout — Shopify's calculated shipping rates. The order starter as checkout runs
// it, with the store's carrier stood in for (no test reaches EasyPost):
//   · with the switch on and a ZIP, the preview offers the carrier's options for the cart's weight, cheapest first, and prices the
//     cheapest; a picked option is priced by asking the carrier again — a price from the browser does not exist to trust;
//   · the free-shipping threshold still applies; no ZIP, no carrier, the carrier failing, or the switch off: the store's own rate.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createStoreCore } from '../server/crm/store/core.ts'
import { createCheckoutService } from '../server/crm/store/checkout/checkoutService.ts'
import { createOrderStarter } from '../server/crm/store/checkout/placeOrder.ts'
import { createStoreGiftCards } from '../server/crm/store/giftCards.ts'
import { cartWeightOz } from '../server/crm/store/checkout/carrierRates.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let starter: ReturnType<typeof createOrderStarter>
let core: ReturnType<typeof createStoreCore>
const asked: any[] = []
let carrierDown = false
const S = () => t.schema as any
const preview = async (body: any) => {
  const r: any = await starter.start({ companyId, items: [{ sku: 'MUG-1', quantity: 2 }], origin: 'https://shop.example', preview: true, ...body })
  expect(r.ok).toBe(true)
  return r.preview
}
const setFeatures = async (list: string[]) => { await t.db.update(S().company).set({ enabledFeatures: list } as any).where(eq(S().company.id, companyId)); t.services.features.forgetFeatures() }

beforeAll(async () => {
  t = await bootTenant({ vertical: 'store' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await setFeatures(['store_carrier_rates'])
  const deps: any = { db: t.db, audit: t.services.audit, logger: { info() {}, warn() {}, error() {} }, authenticate: t.services.authenticate, permissions: t.services.permissions, features: t.services.features, realtime: t.services.realtime, services: t.services.crm }
  core = createStoreCore(deps)
  // The store's carrier, stood in for: two services, priced by weight.
  ;(core as any).getActiveShipping = async () => ({
    fromAddress: { line1: '1 Shop St', city: 'Madison', state: 'WI', postalCode: '53703', country: 'US' },
    parcel: { lengthIn: 10, widthIn: 8, heightIn: 4, weightOz: 16 },
    provider: { name: 'easypost', getRates: async (input: any) => {
      asked.push(input)
      if (carrierDown) throw new Error('carrier down')
      const w = input.parcel.weightOz
      return [{ id: 'r2', carrier: 'UPS', service: 'Ground', amountCents: 900 + w * 10, currency: 'usd', estimatedDays: 4 }, { id: 'r1', carrier: 'USPS', service: 'Priority', amountCents: 700 + w * 10, currency: 'usd', estimatedDays: 2 }]
    } },
  })
  starter = createOrderStarter(deps, core, createCheckoutService(deps, core), createStoreGiftCards(deps, core))
  await t.db.insert(S().storeSettings).values({ companyId, currency: 'usd', flatShippingCents: 599, taxRateBps: 0, freeShippingThresholdCents: 10000 })
  const [p] = await (t.db as any).insert(S().storeProduct).values({ companyId, slug: 'mug', name: 'Mug', status: 'active' }).returning()
  await t.db.insert(S().storeProductVariant).values({ productId: p.id, sku: 'MUG-1', name: 'Mug', priceCents: 2500, inventoryQty: 10, weightOz: 12 })
}, 120_000)

test("the cart's weight is each option's weight × quantity", () => {
  expect(cartWeightOz([{ weightOz: 12, quantity: 2 }, { weightOz: null, quantity: 1 }])).toBe(24)
  expect(cartWeightOz([{ weightOz: null, quantity: 3 }])).toBeNull()
})

test('with a ZIP: the options for the cart weight, cheapest first and priced', async () => {
  const q = await preview({ shipTo: { country: 'US', state: 'IL', zip: '60601' } })
  expect(asked.at(-1).parcel.weightOz).toBe(24)
  expect(asked.at(-1).to.postalCode).toBe('60601')
  expect(q.shippingOptions.map((o: any) => [o.carrier, o.amountCents])).toEqual([['USPS', 940], ['UPS', 1140]])
  expect(q.shippingChoice).toMatchObject({ carrier: 'USPS', service: 'Priority' })
  expect(q.shippingCents).toBe(940)
})

test('a picked option is priced by the carrier; one no longer offered falls back to the cheapest', async () => {
  expect((await preview({ shipTo: { zip: '60601' }, shippingRate: { carrier: 'UPS', service: 'Ground' } })).shippingCents).toBe(1140)
  expect((await preview({ shipTo: { zip: '60601' }, shippingRate: { carrier: 'FedEx', service: 'Overnight' } })).shippingCents).toBe(940)
})

test('the free-shipping threshold still applies', async () => {
  const r: any = await starter.start({ companyId, items: [{ sku: 'MUG-1', quantity: 4 }], origin: 'https://shop.example', preview: true, shipTo: { zip: '60601' } })
  expect(r.preview.shippingCents).toBe(0)
  expect(r.preview.shippingOptions.length).toBe(2)
})

test("no ZIP, the carrier failing, or the switch off: the store's own rate", async () => {
  expect((await preview({ shipTo: { country: 'US', state: 'IL' } })).shippingCents).toBe(599)
  carrierDown = true
  try { const q = await preview({ shipTo: { zip: '60601' } }); expect([q.shippingCents, q.shippingOptions]).toEqual([599, undefined]) } finally { carrierDown = false }
  await setFeatures([])
  try { const q = await preview({ shipTo: { zip: '60601' } }); expect([q.shippingCents, q.shippingOptions]).toEqual([599, undefined]) } finally { await setFeatures(['store_carrier_rates']) }
})

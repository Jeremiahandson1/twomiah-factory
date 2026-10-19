// The store's shared services (server/crm/store/core.ts) on the unified schema, as the store vertical:
//   · a shopper is one customer whatever the case of their email, made at checkout as a 'customer' from the online store,
//     and a later order fills only what is empty;
//   · loyalty is the shared programme by contact: an order's points are spent then earned on the goods (never shipping
//     or tax, never the discount), exactly once however many times the paid order is settled — even at the same moment;
//   · a reward's minimum spend, a punch card that pays, and a reward the shopper can't afford is priced at nothing;
//   · the store's messages are registered with the email service and a send that fails never throws.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createStoreCore } from '../server/crm/store/core.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let core: ReturnType<typeof createStoreCore>
let companyId = ''
const sent: Array<{ to: string; template: string; data: any; options: any }> = []
let failSends = false

const order = async (o: Record<string, unknown>) => {
  const [row] = await t.db.insert(t.schema.storeOrder).values({
    companyId, provider: 'stripe', providerSessionId: 'cs_' + Math.random().toString(36).slice(2), status: 'paid',
    customerEmail: 'Ada@Example.com', subtotalCents: 10000, shippingCents: 900, taxCents: 800, totalCents: 11700, ...o,
  } as any).returning()
  return row
}
const member = async (email: string) => core.findMember(companyId, email)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'store' })
  companyId = (await seedOwner(t)).company.id
  const templates: Record<string, unknown> = {}
  const emailService = {
    register: (more: Record<string, unknown>) => Object.assign(templates, more),
    send: async (to: string, template: string, data: any, options: any) => {
      if (!templates[template]) throw new Error('unregistered ' + template)
      if (failSends) throw new Error('provider down')
      sent.push({ to, template, data, options })
      return { success: true }
    },
  }
  core = createStoreCore({ db: t.db, logger: { info() {}, warn() {}, error() {} }, services: { emailService } } as any)
  await t.db.update(t.schema.company).set({ settings: { loyalty: { enabled: true, pointsPerDollar: 1, punchCard: { visitsRequired: 3 } } } } as any).where(eq(t.schema.company.id, companyId))
}, 120_000)

describe('a shopper is a customer', () => {
  test('made once, whatever the case of the email, as a customer from the online store', async () => {
    const a = await core.shopperFor(companyId, { email: 'Ada@Example.com', name: 'Ada Lovelace' })
    const b = await core.shopperFor(companyId, { email: ' ada@example.COM ', phone: '608-555-0100' })
    expect(a).toBeTruthy()
    expect(b).toBe(a)
    const rows = await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.companyId, companyId))
    expect(rows.length).toBe(1)
    expect(rows[0]).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com', type: 'customer', source: 'online_store', phone: '608-555-0100' })
    // A later order's name does not overwrite the one on file.
    await core.shopperFor(companyId, { email: 'ada@example.com', name: 'Someone Else' })
    expect((await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.id, a!)))[0].name).toBe('Ada Lovelace')
    expect(await core.shopperFor(companyId, { email: 'pending@checkout' })).toBeNull()
    expect(await core.shopperFor(companyId, { email: 'not-an-email' })).toBeNull()
  })
})

describe('loyalty, by contact', () => {
  test('an order earns on the goods less the discount, once, however often it is settled', async () => {
    const o = await order({ discountCents: 2000 })
    const first = await core.settleLoyaltyForPaidOrder(companyId, o.id)
    expect(first).toEqual({ earned: 80, spent: 0 }) // $100 goods − $20 off = $80; shipping and tax earn nothing
    const again = await Promise.all([core.settleLoyaltyForPaidOrder(companyId, o.id), core.settleLoyaltyForPaidOrder(companyId, o.id)])
    expect(again).toEqual([{ earned: 0, spent: 0 }, { earned: 0, spent: 0 }])
    const m = await member('ADA@example.com')
    expect(m).toMatchObject({ pointsBalance: 80, lifetimePoints: 80, qualifyingVisits: 1 })
  })

  test('a reward: priced on the cart, refused under its minimum spend, spent before earning, once', async () => {
    const [tenOff] = await t.db.insert(t.schema.loyaltyReward).values({ companyId, name: '$10 off', pointsCost: 60, type: 'fixed', valueCents: 1000, minSubtotalCents: 5000 } as any).returning()
    const under = await core.availableRewards(companyId, 'ada@example.com', 4000)
    expect(under.rewards.find((r) => r.id === tenOff.id)).toMatchObject({ available: false })
    expect(await core.quoteRewardForCheckout(companyId, 'ada@example.com', tenOff.id, 4000)).toBe(0)
    expect(await core.quoteRewardForCheckout(companyId, 'ada@example.com', tenOff.id, 6000)).toBe(1000)
    // Someone with no points is quoted nothing.
    expect(await core.quoteRewardForCheckout(companyId, 'nobody@example.com', tenOff.id, 6000)).toBe(0)
    const o = await order({ subtotalCents: 6000, discountCents: 1000, loyaltyRewardId: tenOff.id, loyaltyDiscountCents: 1000, totalCents: 5000 })
    const results = await Promise.all([core.settleLoyaltyForPaidOrder(companyId, o.id), core.settleLoyaltyForPaidOrder(companyId, o.id)])
    expect(results.reduce((s, r) => s + r.spent, 0)).toBe(60)
    expect(results.reduce((s, r) => s + r.earned, 0)).toBe(50)
    const m = await member('ada@example.com')
    expect(m!.pointsBalance).toBe(80 - 60 + 50)
    expect((await t.db.select().from(t.schema.loyaltyReward).where(eq(t.schema.loyaltyReward.id, tenOff.id)))[0].usageCount).toBe(1)
    const ledger = await core.memberHistory(companyId, m!.id)
    expect(ledger.map((x: any) => x.type).sort()).toEqual(['earn', 'earn', 'redeem'])
  })

  test('a full punch card pays for its reward, and only one order can claim it', async () => {
    const [free] = await t.db.insert(t.schema.loyaltyReward).values({ companyId, name: 'Free item', pointsCost: 0, type: 'fixed', valueCents: 1500 } as any).returning()
    await order({}).then((o) => core.settleLoyaltyForPaidOrder(companyId, o.id)) // third qualifying order: the card is full
    expect((await core.availableRewards(companyId, 'ada@example.com', 3000)).rewards.find((r) => r.id === free.id)).toMatchObject({ available: true, onTheHouse: true, discountCents: 1500 })
    const a = await order({ loyaltyRewardId: free.id, loyaltyDiscountCents: 1500, discountCents: 1500 })
    await core.settleLoyaltyForPaidOrder(companyId, a.id)
    expect((await member('ada@example.com'))!.punchRewardsEarned).toBe(1)
    expect((await core.availableRewards(companyId, 'ada@example.com', 3000)).rewards.find((r) => r.id === free.id)!.available).toBe(false)
  })

  test('switched off, nothing moves', async () => {
    await t.db.update(t.schema.company).set({ settings: { loyalty: { enabled: false } } } as any).where(eq(t.schema.company.id, companyId))
    const before = (await member('ada@example.com'))!.pointsBalance
    const o = await order({})
    expect(await core.settleLoyaltyForPaidOrder(companyId, o.id)).toEqual({ earned: 0, spent: 0 })
    expect((await member('ada@example.com'))!.pointsBalance).toBe(before)
    await t.db.update(t.schema.company).set({ settings: { loyalty: { enabled: true, pointsPerDollar: 1, punchCard: { visitsRequired: 3 } } } } as any).where(eq(t.schema.company.id, companyId))
  })
})

describe('the shop', () => {
  test('its commerce settings are made once, on first read', async () => {
    const [a, b] = await Promise.all([core.settings(companyId), core.settings(companyId)])
    expect(a.id).toBe(b.id)
    expect(a).toMatchObject({ currency: 'usd', taxRateBps: 0, abandonedCartEnabled: true })
    expect((await core.shop())!.id).toBe(companyId)
  })
  test('its messages are registered; a failed send is reported, never thrown', async () => {
    const o = await order({ trackingNumber: '1Z999', trackingCarrier: 'UPS' })
    await core.notifyShipped(o)
    expect(sent.at(-1)).toMatchObject({ to: 'Ada@Example.com', template: 'storeOrderShipped' })
    failSends = true
    expect(await core.mail('x@example.com', 'storeOrderConfirmation', { order: {}, items: [] })).toBe(false)
    failSends = false
  })
  test('no payment, carrier or supplier connected: none is offered', async () => {
    expect(await core.getActiveProvider(companyId)).toBeNull()
    expect(await core.getActiveShipping(companyId)).toBeNull()
    expect(await core.forwardOrderToSupplier(companyId, 'nope')).toEqual({ ok: false, note: 'No supplier connected' })
  })
})

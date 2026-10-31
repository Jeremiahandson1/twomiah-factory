// Parity row 2 against Shopify (2026-10-31): customer segments by total spend, by order count and by the products or
// categories bought (and not bought), over a period — saved by the owner and usable by a campaign.
//   · the figures are worked out by hand from fixed orders: what a customer spent is what they paid less what went back; a
//     cancelled order, an unfinished checkout and an exchange never count; a fully returned item is not "bought";
//   · a period is the last N days, or a stretch of the SHOP's days (11:30pm on the last day is still that day);
//   · "can be emailed" leaves out whoever unsubscribed;
//   · a segment that asks nothing, or asks the impossible, is refused with a sentence — never "everyone";
//   · a campaign aimed at a saved segment reaches exactly that segment; with the feature off, or the segment gone, nobody;
//   · behind store_segments (registered not ready) and marketing:read.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootStore } from './storeKit.ts'
import { FEATURE_MAP } from '@twomiah/tenant-backend'

let k: Awaited<ReturnType<typeof bootStore>>
const SEG = '/api/admin/segments'
const ON = ['dashboard', 'orders', 'products', 'contacts', 'email_marketing', 'store_segments']
const ago = (days: number) => new Date(Date.now() - days * 86_400_000)
const names = (people: Array<{ name: string | null }>) => people.map((p) => p.name).sort()
let feeder: any, seed: any

const features = async (list: string[]) => {
  await (k.t.db as any).update(k.S.company).set({ enabledFeatures: list }).where(eq(k.S.company.id, k.companyId))
  k.t.services.features.forgetFeatures()
}
const preview = (definition: unknown) => k.as('owner')('POST', `${SEG}/preview`, { definition })

beforeAll(async () => {
  k = await bootStore()
  const { t, S, companyId } = k
  const ins = async (table: any, values: any) => ((await (t.db as any).insert(table).values(values).returning()) as any[])[0]
  await (t.db as any).update(S.company).set({ timezone: 'America/Chicago' }).where(eq(S.company.id, companyId))
  feeder = (await k.product({ slug: 'feeder', name: 'Window feeder', sku: 'FEED-1', priceCents: 1500, category: 'Feeders' })).product
  seed = (await k.product({ slug: 'seed', name: 'Seed mix', sku: 'SEED-1', priceCents: 2000, category: 'Seed' })).product
  const person = (name: string, extra: Record<string, unknown> = {}) => ins(S.contact, { companyId, name, email: `${name.toLowerCase()}@example.com`, type: 'customer', ...extra })
  const [Ada, Bo, Cy, Di, Ed, Fay, Gus, Hal] = await Promise.all([person('Ada'), person('Bo'), person('Cy'), person('Di'), person('Ed', { emailOptOut: true }), person('Fay'), person('Gus'), person('Hal')])
  let n = 0
  type Line = [any, number, number, number?]
  const order = async (who: any, status: string, totalCents: number, at: Date, lines: Line[], extra: Record<string, unknown> = {}) => {
    n++
    const o = await ins(S.storeOrder, { companyId, contactId: who.id, orderNumber: `G-${n}`, provider: 'stripe', providerSessionId: `cs_seg_${n}`, status, customerEmail: who.email, customerName: who.name, subtotalCents: totalCents, totalCents, refundedCents: 0, createdAt: at, ...extra })
    for (const [p, qty, price, back] of lines) await ins(S.storeOrderItem, { orderId: o.id, productId: p.id, productName: p.name, variantName: 'Default', sku: `S${n}`, unitPriceCents: price, quantity: qty, lineTotalCents: qty * price, refundedQuantity: back ?? 0 })
    return o
  }
  await order(Ada, 'delivered', 5000, ago(60), [[feeder, 2, 1500], [seed, 1, 2000]])  // A1
  await order(Ada, 'paid', 3000, ago(11), [[feeder, 2, 1500]])                        // A2
  await order(Bo, 'shipped', 12000, ago(6), [[seed, 6, 2000]])                         // B1
  await order(Cy, 'refunded', 2000, ago(5), [[feeder, 1, 2000, 1]], { refundedCents: 2000 }) // C1: all of it came back
  await order(Di, 'cancelled', 9000, ago(5), [[seed, 4, 2250]])                        // never counted
  await order(Di, 'pending', 9000, ago(5), [[seed, 4, 2250]])                          // never counted
  await order(Ed, 'delivered', 8000, ago(90), [[feeder, 4, 2000]])                     // E1
  await order(Ed, 'delivered', 7000, ago(26), [[seed, 7, 1000]])                       // E2
  await order(Ed, 'paid', 5000, ago(3), [[feeder, 1, 5000]])                           // E3
  await order(Gus, 'paid', 0, ago(4), [[feeder, 1, 1500]], { source: 'exchange' })     // an exchange is not a sale
  // Hal ordered at 11:30pm on July 3 in Chicago (04:30Z on the 4th): the shop's day is the 3rd.
  await order(Hal, 'paid', 5000, new Date('2026-07-04T04:30:00Z'), [[feeder, 1, 5000]])
  await features(ON)
}, 120_000)

describe('customer segments', () => {
  test('are registered not ready: offered to the store, switched on by no plan', () => {
    expect(FEATURE_MAP.store_segments.hidden).toBe(true)
    expect(FEATURE_MAP.store_segments.templates).toEqual(['crm-store'])
  })

  test('by total spend — what they paid less what went back; over and under an amount', async () => {
    const over = await preview({ spend: { minCents: 10000 } })
    expect(over.status).toBe(200)
    expect(names(over.json.sample)).toEqual(['Bo', 'Ed'])
    expect({ matching: over.json.matching, emailable: over.json.emailable }).toEqual({ matching: 2, emailable: 1 }) // Ed unsubscribed
    // Under $50: Cy's sale was all refunded ($0 spent); Di (cancelled/unfinished only), Fay, Gus (exchange only) never spent anything.
    expect(names((await preview({ spend: { maxCents: 4999 } })).json.sample)).toEqual(['Cy', 'Di', 'Fay', 'Gus'])
    expect(names((await preview({ spend: { minCents: 3000, maxCents: 8000 } })).json.sample)).toEqual(['Ada', 'Hal'])
  })

  test('by order count — refunded sales count as orders, cancelled, unfinished and exchange orders do not', async () => {
    expect(names((await preview({ orders: { min: 2 } })).json.sample)).toEqual(['Ada', 'Ed'])
    expect(names((await preview({ orders: { min: 1, max: 1 } })).json.sample)).toEqual(['Bo', 'Cy', 'Hal'])
    expect(names((await preview({ orders: { max: 0 } })).json.sample)).toEqual(['Di', 'Fay', 'Gus'])
    // Spent $0 AND ordered at least once: only the one whose whole order went back.
    expect(names((await preview({ spend: { maxCents: 0 }, orders: { min: 1 } })).json.sample)).toEqual(['Cy'])
  })

  test('in a period: the last N days', async () => {
    expect(names((await preview({ spend: { minCents: 5000 }, period: { days: 30 } })).json.sample)).toEqual(['Bo', 'Ed']) // Ada\'s only order inside 30 days is $30
    expect(names((await preview({ spend: { minCents: 5000 }, period: { days: 4 } })).json.sample)).toEqual(['Ed'])
    expect(names((await preview({ orders: { min: 2 }, period: { days: 30 } })).json.sample)).toEqual(['Ed']) // E2 and E3
  })

  test('in a period: a stretch of the shop\'s own days, both ends included (11:30pm on the last day is still that day)', async () => {
    expect(names((await preview({ orders: { min: 1 }, period: { from: '2026-07-01', to: '2026-07-03' } })).json.sample)).toEqual(['Hal'])
    expect((await preview({ orders: { min: 1 }, period: { from: '2026-07-01', to: '2026-07-02' } })).json.matching).toBe(0)
    expect(names((await preview({ orders: { min: 1 }, period: { from: '2026-07-04', to: '2026-07-04' } })).json.sample)).toEqual([]) // UTC's 4th is not the shop's
  })

  test('by what they bought: a product or a category; a fully returned item is not bought; an exchange is not a purchase', async () => {
    expect(names((await preview({ bought: { productIds: [feeder.id] } })).json.sample)).toEqual(['Ada', 'Ed', 'Hal']) // Cy\'s feeder came back, Gus\'s was an exchange
    expect(names((await preview({ bought: { categories: ['Seed'] } })).json.sample)).toEqual(['Ada', 'Bo', 'Ed'])
    expect(names((await preview({ bought: { productIds: [feeder.id], categories: ['Seed'] } })).json.sample)).toEqual(['Ada', 'Bo', 'Ed', 'Hal']) // either
  })

  test('by what they did NOT buy, alone and with what they bought', async () => {
    expect(names((await preview({ notBought: { categories: ['Seed'] } })).json.sample)).toEqual(['Cy', 'Di', 'Fay', 'Gus', 'Hal'])
    expect(names((await preview({ bought: { productIds: [feeder.id] }, notBought: { categories: ['Seed'] } })).json.sample)).toEqual(['Hal'])
    // The period bounds what "bought" means: Ada\'s seed was 60 days ago, so in the last 30 days she did not buy any (Ed\'s was 26).
    expect(names((await preview({ bought: { productIds: [feeder.id] }, notBought: { categories: ['Seed'] }, period: { days: 30 } })).json.sample)).toEqual(['Ada']) // Ed bought seed 26 days ago, so he is out too
  })

  test('a segment that asks nothing, or the impossible, is refused with a sentence — never everyone', async () => {
    for (const bad of [{}, { period: { days: 30 } }, { spend: {} }, { bought: { productIds: [] } }]) {
      const r = await preview(bad)
      expect({ bad, status: r.status, code: r.json.code }).toEqual({ bad, status: 400, code: 'validation_failed' })
      expect(r.json.error).toContain('Choose at least one')
    }
    expect((await preview({ spend: { minCents: 5000, maxCents: 1000 } })).json.error).toContain('least spent is more')
    expect((await preview({ orders: { min: 5, max: 2 } })).json.error).toContain('fewest orders is more')
    expect((await preview({ spend: { minCents: 1 }, period: { from: '2026-10-09', to: '2026-10-01' } })).json.error).toContain('ends before it starts')
    expect((await preview({ spend: { minCents: -5 } })).status).toBe(400)
    expect((await preview({ spend: { minCents: 1 }, nonsense: true })).status).toBe(400)
  })

  test('save, list with counts, change, a clash of names, remove', async () => {
    const made = await k.as('owner')('POST', SEG, { name: 'Big spenders', definition: { spend: { minCents: 10000 } } })
    expect(made.status).toBe(201)
    expect((await k.as('owner')('POST', SEG, { name: 'Big spenders', definition: { orders: { min: 1 } } })).status).toBe(409)
    expect((await k.as('owner')('POST', SEG, { name: '  ', definition: { orders: { min: 1 } } })).status).toBe(400)
    const listed = await k.as('owner')('GET', SEG)
    expect(listed.json.data.map((s: any) => [s.name, s.matching, s.emailable])).toEqual([['Big spenders', 2, 1]])
    const changed = await k.as('owner')('PUT', `${SEG}/${made.json.id}`, { name: 'Big spenders', definition: { spend: { minCents: 5000 } } })
    expect(changed.status).toBe(200)
    expect((await k.as('owner')('GET', SEG)).json.data[0].matching).toBe(4) // Ada $80, Bo $120, Ed $200 and Hal $50
    const people = await k.as('owner')('GET', `${SEG}/${made.json.id}/customers`)
    expect(names(people.json.data)).toEqual(['Ada', 'Bo', 'Ed', 'Hal'])
    expect((await k.as('owner')('DELETE', `${SEG}/${made.json.id}`)).status).toBe(204)
    expect((await k.as('owner')('GET', SEG)).json.data).toEqual([])
    expect((await k.as('owner')('DELETE', `${SEG}/${made.json.id}`)).status).toBe(404)
  })

  test('a campaign aimed at a saved segment reaches exactly that segment; the picker offers it', async () => {
    const seg = (await k.as('owner')('POST', SEG, { name: 'Seed buyers', definition: { bought: { categories: ['Seed'] } } })).json
    const opts = await k.as('owner')('GET', '/api/marketing/audience/options')
    expect(opts.json.segments).toEqual([{ id: seg.id, name: 'Seed buyers' }])
    const p = await k.as('owner')('POST', '/api/marketing/audience/preview', { audienceType: 'segment', audienceFilter: { segmentId: seg.id } })
    expect(p.status).toBe(200)
    // Ada, Bo and Ed bought seed; Ed unsubscribed, so a campaign reaches Ada and Bo.
    expect(p.json.count).toBe(2)
    expect(p.json.sample.map((s: any) => s.email).sort()).toEqual(['ada@example.com', 'bo@example.com'])
    // …with another filter beside it, both must hold (a tag nobody has leaves nobody).
    expect((await k.as('owner')('POST', '/api/marketing/audience/preview', { audienceType: 'segment', audienceFilter: { segmentId: seg.id, tag: 'nobody-has-this' } })).json.count).toBe(0)
    // A segment that is not there matches NOBODY (never everyone).
    expect((await k.as('owner')('POST', '/api/marketing/audience/preview', { audienceType: 'segment', audienceFilter: { segmentId: 'nope' } })).json.count).toBe(0)
    // With the feature off, the picker offers none and a campaign that names one reaches nobody.
    await features(ON.filter((f) => f !== 'store_segments'))
    try {
      expect((await k.as('owner')('GET', '/api/marketing/audience/options')).json.segments).toEqual([])
      expect((await k.as('owner')('POST', '/api/marketing/audience/preview', { audienceType: 'segment', audienceFilter: { segmentId: seg.id } })).json.count).toBe(0)
    } finally { await features(ON) }
    await k.as('owner')('DELETE', `${SEG}/${seg.id}`)
  })

  test('behind store_segments and marketing:read: off, even the owner is refused; the staff seat\'s answer is the permission\'s', async () => {
    await features(ON.filter((f) => f !== 'store_segments'))
    try {
      const r = await k.as('owner')('GET', SEG)
      expect(r.status).toBe(403)
      expect(r.json.code).toBe('FEATURE_NOT_ENABLED')
    } finally { await features(ON) }
    expect((await k.as('manager')('GET', SEG)).status).toBe(200)
    expect((await k.as('staff')('GET', SEG)).status).toBe(403)
    expect((await k.as('staff')('POST', SEG, { name: 'x', definition: { orders: { min: 1 } } })).status).toBe(403)
  })
})

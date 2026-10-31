// Parity row 2 against Shopify (2026-10-31, the last "partly"): the shared welcome and win-back automations can each be
// limited to one of the store's saved segments — the SAME question a campaign audience and the post-purchase emails ask.
//   · the automations' API offers the shop's segments only with store_segments on, and refuses a segment id otherwise;
//   · a segment that is not the shop's (or is gone) is refused on save; one that is removed later matches NOBODY, never everyone;
//   · the welcome goes only to a first-order customer in the segment (their first order counts: it is paid by then);
//   · the win-back goes only to lapsed customers in the segment;
//   · a segment an automation sends to cannot be deleted (409, with which setting holds it); clearing the setting frees it.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootStore } from './storeKit.ts'

let k: Awaited<ReturnType<typeof bootStore>>
const MARKETING = '/api/marketing'
const SEG = '/api/admin/segments'
const BASE = ['dashboard', 'orders', 'products', 'contacts', 'email_marketing']
const ON = [...BASE, 'store_segments']
const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY)
const db = () => k.t.db as any
const marketing = () => (k.t.services.crm as any).marketing
const features = async (list: string[]) => {
  await db().update(k.S.company).set({ enabledFeatures: list }).where(eq(k.S.company.id, k.companyId))
  k.t.services.features.forgetFeatures()
}
const logFor = async (email: string) => (await db().select().from(k.S.emailLog).where(eq(k.S.emailLog.to, email))) as any[]
let n = 0
/** A customer with one paid order of `totalCents`, `daysAgo` days back. */
async function shopper(name: string, totalCents: number, daysAgo: number) {
  n++
  const email = `${name.toLowerCase()}@example.com`
  const [c] = await db().insert(k.S.contact).values({ companyId: k.companyId, name, email, type: 'customer' }).returning()
  await db().insert(k.S.storeOrder).values({ companyId: k.companyId, contactId: c.id, orderNumber: `AS-${n}`, provider: 'stripe', providerSessionId: `cs_as_${n}`, status: 'paid', customerEmail: email, subtotalCents: totalCents, totalCents, refundedCents: 0, createdAt: ago(daysAgo) })
  return c as { id: string; email: string }
}
let big: string // the "Spent $50 or more" segment

beforeAll(async () => {
  k = await bootStore()
  await db().insert(k.S.storeSettings).values({ companyId: k.companyId, currency: 'usd', flatShippingCents: 0, taxRateBps: 0 })
  await features(ON)
  const made = await k.O('POST', SEG, { name: 'Spent $50 or more', definition: { spend: { minCents: 5000 } } })
  expect(made.status).toBe(201)
  big = made.json.id
}, 120_000)
afterAll(() => k.restore())

describe('a segment on the welcome and the win-back', () => {
  test('the segments are offered only with store_segments on; a segment id is refused otherwise', async () => {
    await features(BASE)
    const off = await k.O('GET', `${MARKETING}/automations`)
    expect(off.status).toBe(200)
    expect(off.json.segments).toEqual([])
    expect((await k.O('PUT', `${MARKETING}/automations`, { welcomeOn: true, welcomeSegmentId: big })).status).toBe(400)
    await features(ON)
    const on = await k.O('GET', `${MARKETING}/automations`)
    expect(on.json.segments).toEqual([{ id: big, name: 'Spent $50 or more' }])
    expect(on.json.welcome.segmentId).toBeNull()
    expect(on.json.winBack.segmentId).toBeNull()
  })

  test('a segment that is not the shop\'s is refused; the shop\'s own is kept', async () => {
    const bad = await k.O('PUT', `${MARKETING}/automations`, { welcomeOn: true, welcomeSegmentId: 'not-a-segment' })
    expect(bad.status).toBe(400)
    expect(bad.json.error).toMatch(/no longer exists/)
    const saved = await k.O('PUT', `${MARKETING}/automations`, { welcomeOn: true, welcomeSegmentId: big, winBackDays: 60, winBackSegmentId: big })
    expect(saved.status).toBe(200)
    expect(saved.json.welcome).toMatchObject({ on: true, segmentId: big })
    expect(saved.json.winBack).toMatchObject({ days: 60, segmentId: big })
  })

  test('the welcome goes to a first-order customer in the segment, and not to one outside it', async () => {
    const inside = await shopper('Inga', 8000, 0)
    const outside = await shopper('Otto', 2000, 0)
    expect(await marketing().sendWelcome(k.companyId, inside.id)).toBe('sent')
    expect(await marketing().sendWelcome(k.companyId, outside.id)).toBe('skipped')
    expect(await logFor('inga@example.com')).toHaveLength(1)
    expect(await logFor('otto@example.com')).toHaveLength(0)
  })

  test('the win-back goes only to the lapsed customers in the segment', async () => {
    const lapsedIn = await shopper('Lena', 9000, 62)
    const lapsedOut = await shopper('Luis', 1500, 62)
    const r = await marketing().processWinBacks()
    expect(r.sent).toBe(1)
    expect(await logFor('lena@example.com')).toHaveLength(1)
    expect(await logFor('luis@example.com')).toHaveLength(0)
    void [lapsedIn, lapsedOut]
  })

  test('the segment cannot be deleted while an automation sends to it; clearing the setting frees it', async () => {
    const held = await k.O('DELETE', `${SEG}/${big}`)
    expect(held.status).toBe(409)
    expect(held.json.error).toMatch(/welcome email setting/)
    expect((await k.O('PUT', `${MARKETING}/automations`, { welcomeSegmentId: null })).json.welcome.segmentId).toBeNull()
    expect((await k.O('DELETE', `${SEG}/${big}`)).json.error).toMatch(/win-back email setting/)
    expect((await k.O('PUT', `${MARKETING}/automations`, { winBackSegmentId: null })).json.winBack.segmentId).toBeNull()
    expect((await k.O('DELETE', `${SEG}/${big}`)).status).toBe(204)
  })

  test('a segment that is gone from under a setting matches nobody — never everyone', async () => {
    const made = await k.O('POST', SEG, { name: 'Anyone with an order', definition: { orders: { min: 1 } } })
    expect((await k.O('PUT', `${MARKETING}/automations`, { welcomeSegmentId: made.json.id })).status).toBe(200)
    await db().delete(k.S.storeSegment).where(eq(k.S.storeSegment.id, made.json.id)) // gone behind the setting's back
    const who = await shopper('Gone', 7000, 0)
    expect(await marketing().sendWelcome(k.companyId, who.id)).toBe('skipped')
    expect(await logFor('gone@example.com')).toHaveLength(0)
    // The owner's screen still loads, and shows the segment is no longer on offer.
    const got = await k.O('GET', `${MARKETING}/automations`)
    expect(got.status).toBe(200)
    expect(got.json.segments.map((s: any) => s.id)).not.toContain(made.json.id)
  })
})

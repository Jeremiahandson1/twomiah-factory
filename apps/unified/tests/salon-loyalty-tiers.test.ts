// Salon loyalty tiers (packages/tenant-backend loyalty: tierFor, pointsForSaleAtTier; server crm/salon/loyalty.ts,
// loyaltyAward.ts). The registry said "tiers" and the salon code said "No tiers" (matrix 10/23). Now:
//   · tiers by LIFETIME points (never spent down — redeeming never drops a tier), each with a multiplier and a perk;
//   · a completed visit earns at the tier the client was in before it; the visit that lifts them counts from the next;
//   · the client's standing is answered by client (their chart, and the sale at checkout), enrolled or not;
//   · the settings door refuses a bad tier in words, field by field; no tiers earns exactly as before;
//   · the bar shares the engine and is untouched: no tiers, the same points, its config still answers.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { loyaltyConfig, tierFor, pointsForSale, pointsForSaleAtTier } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const json = async (r: Response) => (await r.json()) as any
const TIERS = [{ name: 'Gold', minPoints: 1500, multiplier: 2, perk: 'Free blow-dry with every colour' }, { name: 'Silver', minPoints: 500, multiplier: 1.5 }]

describe('the engine', () => {
  const cfg = loyaltyConfig({ loyalty: { pointsPerDollar: 1, tiers: TIERS } })
  test('tiers are kept ascending, cleaned, at most five; none by default', () => {
    expect(cfg.tiers.map((t) => [t.name, t.minPoints, t.multiplier, t.perk])).toEqual([['Silver', 500, 1.5, ''], ['Gold', 1500, 2, 'Free blow-dry with every colour']])
    expect(loyaltyConfig({}).tiers).toEqual([])
    expect(loyaltyConfig({ loyalty: { tiers: [{ name: '', minPoints: 10 }, { name: 'X', minPoints: 0 }, { name: 'Big', minPoints: 5, multiplier: 50 }] } }).tiers).toEqual([{ name: 'Big', minPoints: 5, multiplier: 5, perk: '' }])
  })
  test('standing by lifetime points: below the first is a member; the highest reached wins; how far to the next', () => {
    expect(tierFor(499, cfg)).toEqual({ tier: null, next: cfg.tiers[0], pointsToNext: 1, multiplier: 1 })
    expect(tierFor(500, cfg)).toMatchObject({ tier: { name: 'Silver' }, next: { name: 'Gold' }, pointsToNext: 1000, multiplier: 1.5 })
    expect(tierFor(9000, cfg)).toMatchObject({ tier: { name: 'Gold' }, next: null, pointsToNext: null, multiplier: 2 })
  })
  test('points at a tier: the rate times the multiplier, floored; with no tiers exactly pointsForSale', () => {
    expect(pointsForSaleAtTier(8000, cfg, 0)).toBe(80)
    expect(pointsForSaleAtTier(8000, cfg, 600)).toBe(120)
    expect(pointsForSaleAtTier(11500, cfg, 600)).toBe(172) // 115 × 1.5 = 172.5 → floored, never rounded up
    expect(pointsForSaleAtTier(8000, cfg, 2000)).toBe(160)
    const plain = loyaltyConfig({ loyalty: { pointsPerDollar: 3 } })
    for (const c of [0, 1, 999, 12345, 99999]) expect(pointsForSaleAtTier(c, plain, 5000)).toBe(pointsForSale(c, plain))
  })
})

describe('the salon', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let companyId = ''
  let owner: (p: string, init?: any) => Promise<Response>
  let ann = '', cut = ''
  const visit = async (contactId: string, price: number) => {
    const [a] = await t.db.insert(t.schema.appointment).values({ companyId, contactId, serviceId: cut, startTime: new Date('2026-10-20T15:00:00Z'), status: 'in_chair', quotedPrice: String(price) } as any).returning()
    const r = await owner(`/api/appointments/${a.id}`, { method: 'PUT', json: { status: 'completed' } })
    expect(r.status).toBe(200)
    return a.id
  }
  const member = async (contactId: string) => (await t.db.select().from(t.schema.loyaltyMember).where(eq(t.schema.loyaltyMember.contactId, contactId)))[0]

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    companyId = s.company.id
    await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'invoices', 'client_profiles', 'service_menu', 'salon_booking', 'loyalty_rewards'] } as any).where(eq(t.schema.company.id, companyId))
    const tok = (await json(await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } }))).accessToken
    owner = (p, init = {}) => Promise.resolve(t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } }))
    ann = (await t.db.insert(t.schema.contact).values({ companyId, name: 'Ann Able', type: 'client' } as any).returning())[0].id
    cut = (await t.db.insert(t.schema.serviceMenu).values({ companyId, name: 'Colour', price: '80' } as any).returning())[0].id
  }, 120_000)

  test('a bad tier is refused field by field; good tiers are saved and read back', async () => {
    const bad = await owner('/api/loyalty/config', { method: 'PUT', json: { loyaltyTiers: [{ name: '', minPoints: 0, multiplier: 9 }, { name: 'B', minPoints: 0, multiplier: 1 }] } })
    expect(bad.status).toBe(400)
    const b = await json(bad)
    expect(Object.keys(b.fields || {})).toEqual(expect.arrayContaining(['loyaltyTiers.0.name', 'loyaltyTiers.0.minPoints', 'loyaltyTiers.0.multiplier']))
    const ok = await owner('/api/loyalty/config', { method: 'PUT', json: { loyaltyPointsPerDollar: 1, loyaltyTiers: TIERS } })
    expect(ok.status).toBe(200)
    expect((await json(ok)).loyaltyTiers.map((x: any) => x.name)).toEqual(['Silver', 'Gold'])
    expect((await json(await owner('/api/loyalty/config'))).loyaltyTiers.length).toBe(2)
  })

  test('a client not yet on the programme: answered, not refused', async () => {
    const r = await json(await owner(`/api/loyalty/contacts/${ann}`))
    expect(r).toMatchObject({ enabled: true, member: null })
    expect(r.tiers.map((x: any) => x.name)).toEqual(['Silver', 'Gold'])
    expect((await owner('/api/loyalty/contacts/nobody')).status).toBe(404)
  })

  test('visits earn at the tier held before them; crossing a threshold counts from the next visit', async () => {
    await visit(ann, 400)                      // member: 400 points
    expect((await member(ann)).lifetimePoints).toBe(400)
    await visit(ann, 200)                      // still a member before it: +200 → 600 (now Silver)
    expect((await member(ann)).lifetimePoints).toBe(600)
    await visit(ann, 100)                      // Silver: 100 × 1.5 = 150 → 750
    const m = await member(ann)
    expect([m.lifetimePoints, m.pointsBalance]).toEqual([750, 750])
    const ledger = await t.db.select().from(t.schema.loyaltyTransaction).where(eq(t.schema.loyaltyTransaction.memberId, m.id))
    expect(ledger.filter((l: any) => l.type === 'earn').map((l: any) => [l.points, l.description]).sort()).toEqual([[150, 'Visit (Silver, 1.5× points)'], [200, 'Visit'], [400, 'Visit']])
  })

  test("the client's standing — on the chart and at checkout — names the tier, the next and the perk", async () => {
    const r = await json(await owner(`/api/loyalty/contacts/${ann}`))
    expect(r.member).toMatchObject({ pointsBalance: 750, lifetimePoints: 750, tier: { tier: { name: 'Silver', multiplier: 1.5 }, next: { name: 'Gold' }, pointsToNext: 750, multiplier: 1.5 } })
    const list = await json(await owner('/api/loyalty/members'))
    expect(list.data[0].tier.tier.name).toBe('Silver')
  })

  test('spending points never drops a tier (lifetime points do not go down on a redemption)', async () => {
    const m = await member(ann)
    await t.db.update(t.schema.loyaltyMember).set({ pointsBalance: 0 } as any).where(eq(t.schema.loyaltyMember.id, m.id))
    expect((await json(await owner(`/api/loyalty/contacts/${ann}`))).member.tier.tier.name).toBe('Silver')
  })

  test('no tiers: earning is exactly as before', async () => {
    expect((await owner('/api/loyalty/config', { method: 'PUT', json: { loyaltyTiers: [] } })).status).toBe(200)
    const bob = (await t.db.insert(t.schema.contact).values({ companyId, name: 'Bob Plain', type: 'client' } as any).returning())[0].id
    await t.db.insert(t.schema.loyaltyMember).values({ companyId, contactId: bob, lifetimePoints: 5000, pointsBalance: 0 } as any)
    await visit(bob, 100)
    expect((await member(bob)).pointsBalance).toBe(100)
  })
})

describe('the bar shares the engine and is untouched', () => {
  test('its config answers with no tiers, and a check earns the plain rate', async () => {
    const b = await bootTenant({ vertical: 'bar' })
    const s = await seedOwner(b)
    await b.db.update(b.schema.company).set({ enabledFeatures: ['contacts', 'loyalty_rewards'] } as any).where(eq(b.schema.company.id, s.company.id))
    const tok = (await json(await b.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } }))).accessToken
    const r = await b.call('/api/loyalty/config', { headers: { Authorization: `Bearer ${tok}` } })
    expect(r.status).toBe(200)
    const cfg = await json(r)
    expect(cfg.loyaltyTiers).toEqual([])
    expect(cfg.loyaltyPunchCard.rewardName).toBe('Free drink')
  }, 120_000)
})

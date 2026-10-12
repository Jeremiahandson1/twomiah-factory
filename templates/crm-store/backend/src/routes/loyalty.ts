import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { loyaltyMembers, loyaltyRewards, storeSettings } from '../../db/schema.ts'
import { eq, desc, ilike, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'
import { loyaltyConfig, loyaltyConfigResponse, punchCardProgress } from '../shared/index.ts'
import { memberHistory, normalizeEmail, STORE_LOYALTY_DEFAULTS } from '../services/loyalty.ts'

// Admin side of the loyalty programme: the settings, who is on it, and what they can spend on.
// Earning and spending happen at finalizeOrder (services/loyalty.ts); nothing here moves money.
//
// Who may do what. This shipped with nothing but `authenticate`, so any signed-in staff member could
// rewrite the reward list — make a $50-off reward cost 1 point and then spend it. The salon found the
// same door open as run LY0928 H3, where the gate at least asked for a permission every stylist
// happened to hold; here there was no gate at all. It now asks the fleet's loyalty permissions:
//
//   read       — everyone (loyalty:read). Looking up a shopper's balance is desk work.
//   configure  — manager and owner (loyalty:configure). The reward list and the earn rate are the
//                programme's price list. Was owner-only while the store had no manager seat.
const admin = new Hono()
admin.use('*', authenticate)

async function cfg() {
  const [row] = await db.select({ loyalty: storeSettings.loyalty }).from(storeSettings).limit(1)
  return loyaltyConfig({ loyalty: row?.loyalty }, STORE_LOYALTY_DEFAULTS)
}

// ==================== SETTINGS ====================

admin.get('/config', async (c) => {
  const [row] = await db.select({ loyalty: storeSettings.loyalty }).from(storeSettings).limit(1)
  return c.json(loyaltyConfigResponse({ loyalty: row?.loyalty }, STORE_LOYALTY_DEFAULTS))
})

const configSchema = z.object({
  loyaltyEnabled: z.boolean().optional(),
  loyaltyPointsPerDollar: z.number().min(0).max(1000).optional(),
  loyaltyWelcomePoints: z.number().int().min(0).max(1_000_000).optional(),
  loyaltyPunchCard: z.object({
    visitsRequired: z.number().int().min(0).max(100),
    rewardName: z.string().max(120).optional(),
  }).optional(),
})

/** The punch card is a nested object; the audit page prints values with String(), so it is flattened to its two settings. */
const flatLoyalty = (l: any) => ({
  enabled: l?.enabled, pointsPerDollar: l?.pointsPerDollar, welcomePoints: l?.welcomePoints,
  punchCardOrders: l?.punchCard?.visitsRequired, punchCardReward: l?.punchCard?.rewardName,
})

admin.put('/config', requirePermission('loyalty:configure'), async (c) => {
  const d = configSchema.parse(await c.req.json())
  // Merged, not replaced: saving the points rate must not wipe the punch card the shop set up
  // last week. Same lesson as the loyalty settings that silently dropped every field but one.
  //
  // And merged UNDER A LOCK. Each field saves on its own (the screen saves on leaving the box), so two managers
  // changing two different settings send two saves at once. Both read the same settings, each merged its one field
  // into that, and the second write put the first field back as it was. The row is locked for the read-merge-write,
  // so the second save merges into what the first wrote.
  let before: Record<string, unknown> = {}
  const next = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM store_settings FOR UPDATE`)
    const [row] = await tx.select().from(storeSettings).limit(1)
    if (!row) return null
    const current: any = row.loyalty || {}
    before = current
    const merged = {
      ...current,
      ...(d.loyaltyEnabled !== undefined ? { enabled: d.loyaltyEnabled } : {}),
      ...(d.loyaltyPointsPerDollar !== undefined ? { pointsPerDollar: d.loyaltyPointsPerDollar } : {}),
      ...(d.loyaltyWelcomePoints !== undefined ? { welcomePoints: d.loyaltyWelcomePoints } : {}),
      ...(d.loyaltyPunchCard !== undefined ? { punchCard: { ...(current.punchCard || {}), ...d.loyaltyPunchCard } } : {}),
    }
    await tx.update(storeSettings).set({ loyalty: merged, updatedAt: new Date() }).where(eq(storeSettings.id, row.id))
    return merged
  })
  if (!next) return c.json({ error: 'Store settings have not been created yet' }, 404)
  // After the transaction, not inside it: audit.log writes through the pool, and the lock above is still held there.
  await audit.log({ action: 'update', entity: 'loyalty_config', entityName: 'Loyalty programme', changes: audit.diff(flatLoyalty(before), flatLoyalty(next)), req: c })
  return c.json(loyaltyConfigResponse({ loyalty: next }, STORE_LOYALTY_DEFAULTS))
})

// ==================== MEMBERS ====================

admin.get('/members', async (c) => {
  const search = normalizeEmail(c.req.query('search') || '')
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50))
  const config = await cfg()

  const rows = await db.select().from(loyaltyMembers)
    .where(search ? ilike(loyaltyMembers.email, `%${search}%`) : undefined as any)
    .orderBy(desc(loyaltyMembers.lastActivityAt))
    .limit(limit)

  return c.json({
    members: rows.map((m) => ({
      ...m,
      punchCard: punchCardProgress({ qualifyingVisits: m.qualifyingOrders, rewardsEarned: m.punchRewardsEarned }, config),
    })),
  })
})

admin.get('/members/:id', async (c) => {
  const [m] = await db.select().from(loyaltyMembers).where(eq(loyaltyMembers.id, c.req.param('id'))).limit(1)
  if (!m) return c.json({ error: 'Member not found' }, 404)
  const config = await cfg()
  return c.json({
    ...m,
    punchCard: punchCardProgress({ qualifyingVisits: m.qualifyingOrders, rewardsEarned: m.punchRewardsEarned }, config),
    transactions: await memberHistory(m.id),
  })
})

// ==================== REWARDS ====================

const rewardSchema = z.object({
  name: z.string().min(1, 'Give the reward a name shoppers will recognise').max(120),
  description: z.string().max(500).optional(),
  pointsCost: z.number().int().min(0).default(0),
  // Money off only. With no shopper login the address is the only identity, so a reward that hands
  // over goods is one a guessed email could walk away with; a coupon is a bounded loss.
  type: z.enum(['fixed', 'percent']),
  /** Cents for 'fixed', whole percent for 'percent'. */
  valueCents: z.number().int().min(0),
  minSubtotalCents: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
}).superRefine((v, ctx) => {
  if (v.type === 'percent' && v.valueCents > 100) {
    ctx.addIssue({ code: 'custom', path: ['valueCents'], message: 'A percentage reward cannot exceed 100%' })
  }
  if (v.valueCents === 0) {
    ctx.addIssue({ code: 'custom', path: ['valueCents'], message: 'A reward worth nothing takes nothing off' })
  }
})

admin.get('/rewards', async (c) => {
  const rewards = await db.select().from(loyaltyRewards).orderBy(loyaltyRewards.pointsCost)
  return c.json({ rewards })
})

admin.post('/rewards', requirePermission('loyalty:configure'), async (c) => {
  const d = rewardSchema.parse(await c.req.json())
  const [row] = await db.insert(loyaltyRewards).values(d as any).returning()
  return c.json(row, 201)
})

admin.put('/rewards/:id', requirePermission('loyalty:configure'), async (c) => {
  const d = rewardSchema.parse(await c.req.json())
  const [row] = await db.update(loyaltyRewards).set({ ...d, updatedAt: new Date() } as any)
    .where(eq(loyaltyRewards.id, c.req.param('id'))).returning()
  if (!row) return c.json({ error: 'Reward not found' }, 404)
  return c.json(row)
})

admin.delete('/rewards/:id', requirePermission('loyalty:configure'), async (c) => {
  const [row] = await db.delete(loyaltyRewards).where(eq(loyaltyRewards.id, c.req.param('id'))).returning()
  if (!row) return c.json({ error: 'Reward not found' }, 404)
  return c.json({ success: true })
})

export default admin

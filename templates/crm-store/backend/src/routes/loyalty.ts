import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { loyaltyMembers, loyaltyRewards, storeSettings } from '../../db/schema.ts'
import { eq, desc, ilike } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { loyaltyConfig, loyaltyConfigResponse, punchCardProgress } from '../shared/index.ts'
import { memberHistory, normalizeEmail } from '../services/loyalty.ts'

// Admin side of the loyalty programme: the settings, who is on it, and what they can spend on.
// Earning and spending happen at finalizeOrder (services/loyalty.ts); nothing here moves money.
const admin = new Hono()
admin.use('*', authenticate)

async function cfg() {
  const [row] = await db.select({ loyalty: storeSettings.loyalty }).from(storeSettings).limit(1)
  return loyaltyConfig({ loyalty: row?.loyalty })
}

// ==================== SETTINGS ====================

admin.get('/config', async (c) => {
  const [row] = await db.select({ loyalty: storeSettings.loyalty }).from(storeSettings).limit(1)
  return c.json(loyaltyConfigResponse({ loyalty: row?.loyalty }))
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

admin.put('/config', async (c) => {
  const d = configSchema.parse(await c.req.json())
  const [row] = await db.select().from(storeSettings).limit(1)
  if (!row) return c.json({ error: 'Store settings have not been created yet' }, 404)

  // Merged, not replaced: saving the points rate must not wipe the punch card the shop set up
  // last week. Same lesson as the loyalty settings that silently dropped every field but one.
  const current: any = row.loyalty || {}
  const next = {
    ...current,
    ...(d.loyaltyEnabled !== undefined ? { enabled: d.loyaltyEnabled } : {}),
    ...(d.loyaltyPointsPerDollar !== undefined ? { pointsPerDollar: d.loyaltyPointsPerDollar } : {}),
    ...(d.loyaltyWelcomePoints !== undefined ? { welcomePoints: d.loyaltyWelcomePoints } : {}),
    ...(d.loyaltyPunchCard !== undefined ? { punchCard: { ...(current.punchCard || {}), ...d.loyaltyPunchCard } } : {}),
  }

  await db.update(storeSettings).set({ loyalty: next, updatedAt: new Date() }).where(eq(storeSettings.id, row.id))
  return c.json(loyaltyConfigResponse({ loyalty: next }))
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

admin.post('/rewards', async (c) => {
  const d = rewardSchema.parse(await c.req.json())
  const [row] = await db.insert(loyaltyRewards).values(d as any).returning()
  return c.json(row, 201)
})

admin.put('/rewards/:id', async (c) => {
  const d = rewardSchema.parse(await c.req.json())
  const [row] = await db.update(loyaltyRewards).set({ ...d, updatedAt: new Date() } as any)
    .where(eq(loyaltyRewards.id, c.req.param('id'))).returning()
  if (!row) return c.json({ error: 'Reward not found' }, 404)
  return c.json(row)
})

admin.delete('/rewards/:id', async (c) => {
  const [row] = await db.delete(loyaltyRewards).where(eq(loyaltyRewards.id, c.req.param('id'))).returning()
  if (!row) return c.json({ error: 'Reward not found' }, 404)
  return c.json({ success: true })
})

export default admin

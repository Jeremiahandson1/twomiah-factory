import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

const challengeSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['visit_streak', 'spending_goal', 'category_explorer', 'referral_race', 'punch_card', 'daily_spin', 'bonus_multiplier']),
  rules: z.object({
    target: z.number().optional(),
    period: z.string().optional(),
    category: z.string().optional(),
    categories: z.array(z.string()).optional(),
    minSpend: z.number().optional(),
    streakDays: z.number().optional(),
    punchesRequired: z.number().optional(),
    referralsRequired: z.number().optional(),
  }),
  rewardType: z.enum(['points', 'discount_percent', 'discount_fixed', 'free_item', 'tier_upgrade']),
  rewardValue: z.number().min(0),
  bonusMultiplier: z.number().min(1).optional(),
  startDate: z.string(),
  endDate: z.string(),
  imageUrl: z.string().optional(),
  isRecurring: z.boolean().default(false),
})

// GET /challenges — List active challenges
app.get('/challenges', async (c) => {
  const currentUser = c.get('user') as any
  const active = c.req.query('active')

  let activeClause = sql``
  if (active === 'true') {
    activeClause = sql`AND lc.is_active = true AND lc.start_date <= NOW() AND lc.end_date >= NOW()`
  }

  const result = await db.execute(sql`
    SELECT lc.*,
      (SELECT COUNT(*)::int FROM loyalty_challenge_progress lcp WHERE lcp.challenge_id = lc.id) as participant_count,
      (SELECT COUNT(*)::int FROM loyalty_challenge_progress lcp WHERE lcp.challenge_id = lc.id AND lcp.completed = true) as completed_count
    FROM loyalty_challenges lc
    WHERE lc.company_id = ${currentUser.companyId} ${activeClause}
    ORDER BY lc.start_date DESC
  `)

  return c.json((result as any).rows || result)
})

// POST /challenges — Create challenge (manager+)
app.post('/challenges', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const data = challengeSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO loyalty_challenges(id, name, description, type, rules, reward_type, reward_value, bonus_multiplier, start_date, end_date, image_url, is_recurring, is_active, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.name}, ${data.description || null}, ${data.type}, ${JSON.stringify(data.rules)}::jsonb, ${data.rewardType}, ${data.rewardValue}, ${data.bonusMultiplier || null}, ${new Date(data.startDate)}, ${new Date(data.endDate)}, ${data.imageUrl || null}, ${data.isRecurring}, true, ${currentUser.companyId}, NOW(), NOW())
    RETURNING *
  `)

  const created = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'loyalty_challenge',
    entityId: created?.id,
    entityName: data.name,
    metadata: { type: data.type, rewardType: data.rewardType },
    req: c.req,
  })

  return c.json(created, 201)
})

// PUT /challenges/:id — Update challenge
app.put('/challenges/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = challengeSchema.partial().parse(await c.req.json())

  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.name !== undefined) sets.push(sql`name = ${data.name}`)
  if (data.description !== undefined) sets.push(sql`description = ${data.description}`)
  if (data.type !== undefined) sets.push(sql`type = ${data.type}`)
  if (data.rules !== undefined) sets.push(sql`rules = ${JSON.stringify(data.rules)}::jsonb`)
  if (data.rewardType !== undefined) sets.push(sql`reward_type = ${data.rewardType}`)
  if (data.rewardValue !== undefined) sets.push(sql`reward_value = ${data.rewardValue}`)
  if (data.bonusMultiplier !== undefined) sets.push(sql`bonus_multiplier = ${data.bonusMultiplier}`)
  if (data.startDate !== undefined) sets.push(sql`start_date = ${new Date(data.startDate)}`)
  if (data.endDate !== undefined) sets.push(sql`end_date = ${new Date(data.endDate)}`)
  if (data.imageUrl !== undefined) sets.push(sql`image_url = ${data.imageUrl}`)
  if (data.isRecurring !== undefined) sets.push(sql`is_recurring = ${data.isRecurring}`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE loyalty_challenges SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Challenge not found' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'loyalty_challenge',
    entityId: id,
    entityName: updated.name,
    metadata: { fields: Object.keys(data) },
    req: c.req,
  })

  return c.json(updated)
})

// DELETE /challenges/:id — Deactivate challenge
app.delete('/challenges/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE loyalty_challenges SET is_active = false, updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING id, name
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Challenge not found' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'loyalty_challenge',
    entityId: id,
    entityName: updated.name,
    metadata: { type: 'deactivate' },
    req: c.req,
  })

  return c.json({ success: true, deactivated: updated.name })
})

// GET /challenges/:id/leaderboard — Top participants
app.get('/challenges/:id/leaderboard', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const limit = +(c.req.query('limit') || '20')

  const result = await db.execute(sql`
    SELECT lcp.*, lm.id as member_id, c.name as customer_name, c.id as contact_id
    FROM loyalty_challenge_progress lcp
    JOIN loyalty_members lm ON lm.id = lcp.member_id
    JOIN contact c ON c.id = lm.contact_id
    WHERE lcp.challenge_id = ${id} AND lcp.company_id = ${currentUser.companyId}
    ORDER BY lcp.progress DESC, lcp.completed_at ASC NULLS LAST
    LIMIT ${limit}
  `)

  return c.json((result as any).rows || result)
})

// GET /member/:memberId/challenges — Member's active challenges with progress
app.get('/member/:memberId/challenges', async (c) => {
  const currentUser = c.get('user') as any
  const memberId = c.req.param('memberId')

  const result = await db.execute(sql`
    SELECT lc.*, lcp.progress, lcp.completed, lcp.completed_at, lcp.reward_claimed, lcp.id as progress_id
    FROM loyalty_challenge_progress lcp
    JOIN loyalty_challenges lc ON lc.id = lcp.challenge_id
    WHERE lcp.member_id = ${memberId}
      AND lcp.company_id = ${currentUser.companyId}
      AND lc.is_active = true
    ORDER BY lcp.completed ASC, lc.end_date ASC
  `)

  return c.json((result as any).rows || result)
})

// POST /challenges/:id/join — Join a challenge
app.post('/challenges/:id/join', async (c) => {
  const currentUser = c.get('user') as any
  const challengeId = c.req.param('id')

  const joinSchema = z.object({ memberId: z.string().min(1) })
  const data = joinSchema.parse(await c.req.json())

  // Verify challenge exists and is active
  const challengeResult = await db.execute(sql`
    SELECT id, name, type, rules FROM loyalty_challenges
    WHERE id = ${challengeId} AND company_id = ${currentUser.companyId}
      AND is_active = true AND start_date <= NOW() AND end_date >= NOW()
    LIMIT 1
  `)
  const challenge = ((challengeResult as any).rows || challengeResult)?.[0]
  if (!challenge) return c.json({ error: 'Challenge not found or not active' }, 404)

  // Verify member exists
  const memberResult = await db.execute(sql`
    SELECT id FROM loyalty_members
    WHERE id = ${data.memberId} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const member = ((memberResult as any).rows || memberResult)?.[0]
  if (!member) return c.json({ error: 'Member not found' }, 404)

  // Check if already joined
  const existingResult = await db.execute(sql`
    SELECT id FROM loyalty_challenge_progress
    WHERE challenge_id = ${challengeId} AND member_id = ${data.memberId}
    LIMIT 1
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (existing) return c.json({ error: 'Member already joined this challenge' }, 409)

  const result = await db.execute(sql`
    INSERT INTO loyalty_challenge_progress(id, challenge_id, member_id, progress, completed, reward_claimed, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${challengeId}, ${data.memberId}, 0, false, false, ${currentUser.companyId}, NOW(), NOW())
    RETURNING *
  `)

  return c.json(((result as any).rows || result)?.[0], 201)
})

// POST /progress/update — Called after each order to update challenge progress
app.post('/progress/update', async (c) => {
  const currentUser = c.get('user') as any

  const updateSchema = z.object({
    memberId: z.string().min(1),
    orderId: z.string().min(1),
  })
  const data = updateSchema.parse(await c.req.json())

  // Get order details
  const orderResult = await db.execute(sql`
    SELECT o.id, o.total, o.created_at, o.items
    FROM orders o
    WHERE o.id = ${data.orderId} AND o.company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const order = ((orderResult as any).rows || orderResult)?.[0]
  if (!order) return c.json({ error: 'Order not found' }, 404)

  // Get member's last visit for streak tracking
  const lastVisitResult = await db.execute(sql`
    SELECT MAX(o.created_at) as last_visit
    FROM orders o
    WHERE o.contact_id = (SELECT contact_id FROM loyalty_members WHERE id = ${data.memberId})
      AND o.company_id = ${currentUser.companyId}
      AND o.id != ${data.orderId}
      AND o.status NOT IN ('cancelled', 'refunded')
  `)
  const lastVisit = ((lastVisitResult as any).rows || lastVisitResult)?.[0]?.last_visit

  // Get all active challenges the member is participating in
  const progressResult = await db.execute(sql`
    SELECT lcp.*, lc.type, lc.rules, lc.reward_type, lc.reward_value
    FROM loyalty_challenge_progress lcp
    JOIN loyalty_challenges lc ON lc.id = lcp.challenge_id
    WHERE lcp.member_id = ${data.memberId}
      AND lcp.company_id = ${currentUser.companyId}
      AND lcp.completed = false
      AND lc.is_active = true
      AND lc.end_date >= NOW()
  `)
  const activeProgress = (progressResult as any).rows || progressResult

  const orderTotal = Number(order.total) || 0
  const orderItems = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])
  const orderCategories = new Set(orderItems.map((i: any) => i.category).filter(Boolean))

  const updates: any[] = []

  for (const prog of activeProgress) {
    const rules = typeof prog.rules === 'string' ? JSON.parse(prog.rules) : (prog.rules || {})
    let newProgress = Number(prog.progress)
    let completed = false

    switch (prog.type) {
      case 'visit_streak': {
        // Increment if within 7 days of last visit (or first visit)
        const daysSinceLastVisit = lastVisit
          ? Math.floor((Date.now() - new Date(lastVisit).getTime()) / (1000 * 60 * 60 * 24))
          : 0
        if (!lastVisit || daysSinceLastVisit <= 7) {
          newProgress += 1
        } else {
          newProgress = 1 // Reset streak
        }
        completed = newProgress >= (rules.target || rules.streakDays || 7)
        break
      }
      case 'spending_goal': {
        newProgress += orderTotal
        completed = newProgress >= (rules.target || rules.minSpend || 100)
        break
      }
      case 'category_explorer': {
        // Track unique categories visited — stored as progress count
        const targetCategories = rules.categories || []
        // Get previously explored categories from metadata
        const exploredResult = await db.execute(sql`
          SELECT metadata FROM loyalty_challenge_progress
          WHERE id = ${prog.id}
          LIMIT 1
        `)
        const existingMeta = ((exploredResult as any).rows || exploredResult)?.[0]?.metadata || {}
        const explored = new Set(existingMeta.explored_categories || [])
        for (const cat of orderCategories) {
          if (targetCategories.length === 0 || targetCategories.includes(cat)) {
            explored.add(cat)
          }
        }
        newProgress = explored.size
        completed = newProgress >= (rules.target || targetCategories.length || 5)

        await db.execute(sql`
          UPDATE loyalty_challenge_progress
          SET metadata = ${JSON.stringify({ explored_categories: Array.from(explored) })}::jsonb
          WHERE id = ${prog.id}
        `)
        break
      }
      case 'punch_card': {
        newProgress += 1
        completed = newProgress >= (rules.target || rules.punchesRequired || 10)
        break
      }
      default:
        continue
    }

    await db.execute(sql`
      UPDATE loyalty_challenge_progress
      SET progress = ${newProgress},
          completed = ${completed},
          completed_at = ${completed ? sql`NOW()` : sql`NULL`},
          updated_at = NOW()
      WHERE id = ${prog.id}
    `)

    updates.push({ challengeId: prog.challenge_id, type: prog.type, progress: newProgress, completed })
  }

  return c.json({ updated: updates.length, challenges: updates })
})

// POST /challenges/:challengeId/claim — Claim reward for completed challenge
app.post('/challenges/:challengeId/claim', async (c) => {
  const currentUser = c.get('user') as any
  const challengeId = c.req.param('challengeId')

  const claimSchema = z.object({ memberId: z.string().min(1) })
  const data = claimSchema.parse(await c.req.json())

  // Find completed, unclaimed progress
  const progressResult = await db.execute(sql`
    SELECT lcp.*, lc.name as challenge_name, lc.reward_type, lc.reward_value
    FROM loyalty_challenge_progress lcp
    JOIN loyalty_challenges lc ON lc.id = lcp.challenge_id
    WHERE lcp.challenge_id = ${challengeId}
      AND lcp.member_id = ${data.memberId}
      AND lcp.company_id = ${currentUser.companyId}
      AND lcp.completed = true
      AND lcp.reward_claimed = false
    LIMIT 1
  `)
  const progress = ((progressResult as any).rows || progressResult)?.[0]
  if (!progress) return c.json({ error: 'No completed unclaimed challenge found' }, 404)

  // Mark as claimed
  await db.execute(sql`
    UPDATE loyalty_challenge_progress
    SET reward_claimed = true, reward_claimed_at = NOW(), updated_at = NOW()
    WHERE id = ${progress.id}
  `)

  // Award based on reward type
  let rewardDetails: any = { type: progress.reward_type, value: progress.reward_value }

  if (progress.reward_type === 'points') {
    // Add points to member
    await db.execute(sql`
      UPDATE loyalty_members
      SET points_balance = points_balance + ${progress.reward_value},
          total_points_earned = total_points_earned + ${progress.reward_value},
          updated_at = NOW()
      WHERE id = ${data.memberId}
    `)

    await db.execute(sql`
      INSERT INTO loyalty_transactions(id, member_id, type, points, description, company_id, created_at)
      VALUES (gen_random_uuid(), ${data.memberId}, 'challenge_reward', ${progress.reward_value}, ${'Challenge completed: ' + progress.challenge_name}, ${currentUser.companyId}, NOW())
    `)

    rewardDetails.description = `${progress.reward_value} points awarded`
  } else if (progress.reward_type === 'discount_percent' || progress.reward_type === 'discount_fixed') {
    // Create a discount code for the member
    const code = `CH-${progress.challenge_name?.slice(0, 4).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`
    await db.execute(sql`
      INSERT INTO loyalty_rewards(id, member_id, code, type, value, used, expires_at, company_id, created_at)
      VALUES (gen_random_uuid(), ${data.memberId}, ${code}, ${progress.reward_type}, ${progress.reward_value}, false, NOW() + INTERVAL '30 days', ${currentUser.companyId}, NOW())
    `)
    rewardDetails.code = code
    rewardDetails.description = progress.reward_type === 'discount_percent'
      ? `${progress.reward_value}% off discount code: ${code}`
      : `$${progress.reward_value} off discount code: ${code}`
  }

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'loyalty_challenge_progress',
    entityId: progress.id,
    metadata: { type: 'claim_reward', challengeId, memberId: data.memberId, rewardType: progress.reward_type },
    req: c.req,
  })

  return c.json({ success: true, reward: rewardDetails })
})

// GET /multipliers — Active bonus multiplier events
app.get('/multipliers', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT id, name, description, bonus_multiplier, start_date, end_date, image_url, rules
    FROM loyalty_challenges
    WHERE company_id = ${currentUser.companyId}
      AND type = 'bonus_multiplier'
      AND is_active = true
      AND start_date <= NOW()
      AND end_date >= NOW()
    ORDER BY bonus_multiplier DESC
  `)

  return c.json((result as any).rows || result)
})

export default app

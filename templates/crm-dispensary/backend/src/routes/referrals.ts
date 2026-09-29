import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'
import { recomputeTier } from '../utils/loyaltyTier.ts'
import { zodRefusal } from '../utils/errors.ts'

const app = new Hono()
app.use('*', authenticate)

/**
 * Raw rows come back snake_case; every screen in this app reads camelCase.
 *
 * T46 N23: GET /config returned the row as it came out of the table once a config had been saved,
 * and a hand-written camelCase object when none had. So the Referrals screen showed the right
 * fields until the moment someone pressed Save, and blank ones from then on — a reward of 250
 * points read back as "Discount (%)" with no value, and Min Purchase sat at 0 however often it was
 * set. The value was in the table the whole time; nothing could see it.
 */
const camelConfig = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  // The numeric columns are TEXT in the table, and a screen that does arithmetic on "250" gets
  // "2501" the first time someone adds to it.
  for (const k of ['referrerRewardValue', 'referredRewardValue', 'minPurchaseAmount']) {
    if (out[k] != null) out[k] = Number(out[k]) || 0
  }
  for (const k of ['expirationDays', 'maxReferralsPerCustomer']) {
    if (out[k] != null) out[k] = Number(out[k]) || 0
  }
  return out
}

/**
 * Grant referral points the same way every other path grants points.
 *
 * Referral rewards used to move the three counters and stop there: no loyalty_transactions row, so
 * the points appeared in the balance with nothing in the member's history to explain them, and no
 * tier re-evaluation, so a bonus that crossed a threshold left the customer on their old tier until
 * some unrelated sale happened to recompute it.
 */
async function awardReferralPoints(companyId: string, contactId: string, points: number, description: string) {
  if (!contactId || !(points > 0)) return

  const found: any = await db.execute(sql`
    SELECT id FROM loyalty_members WHERE contact_id = ${contactId} AND company_id = ${companyId} LIMIT 1
  `)
  const memberId = ((found?.rows || found)?.[0] as any)?.id
  // Not enrolled in loyalty — there is nowhere to put points, exactly as before.
  if (!memberId) return

  const updated: any = await db.execute(sql`
    UPDATE loyalty_members
    SET points_balance = COALESCE(points_balance::numeric, 0) + ${points},
        total_points_earned = COALESCE(total_points_earned::numeric, 0) + ${points},
        lifetime_points = COALESCE(lifetime_points, 0) + ${points},
        updated_at = NOW()
    WHERE id = ${memberId}
    RETURNING points_balance
  `)
  const balanceAfter = Number(((updated?.rows || updated)?.[0] as any)?.points_balance ?? 0)

  await db.execute(sql`
    INSERT INTO loyalty_transactions(id, member_id, type, points, balance_after, description, company_id, created_at)
    VALUES (gen_random_uuid(), ${memberId}, 'bonus', ${points}, ${balanceAfter}, ${description}, ${companyId}, NOW())
  `)

  await recomputeTier(db, companyId, { memberId })
}

// Get referral config for company
app.get('/config', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT * FROM referral_config
    WHERE company_id = ${currentUser.companyId}
    LIMIT 1
  `)

  const config = ((result as any).rows || result)?.[0]
  if (!config) {
    return c.json({
      enabled: false,
      referrerRewardType: 'points',
      referrerRewardValue: 0,
      referredRewardType: 'points',
      referredRewardValue: 0,
      minPurchaseAmount: 0,
      expirationDays: 90,
      maxReferralsPerCustomer: 10,
    })
  }

  return c.json(camelConfig(config))
})

// Update referral config (manager+)
app.put('/config', requireRole('admin'), async (c) => {
  const currentUser = c.get('user') as any

  const configSchema = z.object({
    enabled: z.boolean().optional(),
    referrerRewardType: z.enum(['points', 'discount_percent', 'discount_flat', 'credit']).optional(),
    referrerRewardValue: z.number().min(0).optional(),
    referredRewardType: z.enum(['points', 'discount_percent', 'discount_flat', 'credit']).optional(),
    referredRewardValue: z.number().min(0).optional(),
    minPurchaseAmount: z.number().min(0).optional(),
    expirationDays: z.number().int().min(1).optional(),
    maxReferralsPerCustomer: z.number().int().min(1).optional(),
  })
  let data: z.infer<typeof configSchema>
  try {
    data = configSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) return c.json(zodRefusal(err), 400)
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Save the config.
  //
  // This was an ON CONFLICT (company_id) upsert, which needs a unique constraint by that exact
  // name to exist — and where it does not, Postgres answers "there is no unique or exclusion
  // constraint matching the ON CONFLICT specification" and the save is a 500. A read, then an
  // update or an insert, depends on no constraint at all and says the same thing. (T45 M20)
  const existingResult = await db.execute(sql`
    SELECT * FROM referral_config WHERE company_id = ${currentUser.companyId} LIMIT 1
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]

  const result = existing
    ? await db.execute(sql`
        UPDATE referral_config SET
          enabled = COALESCE(${data.enabled ?? null}::boolean, enabled),
          referrer_reward_type = COALESCE(${data.referrerRewardType ?? null}, referrer_reward_type),
          referrer_reward_value = COALESCE(${data.referrerRewardValue != null ? String(data.referrerRewardValue) : null}, referrer_reward_value),
          referred_reward_type = COALESCE(${data.referredRewardType ?? null}, referred_reward_type),
          referred_reward_value = COALESCE(${data.referredRewardValue != null ? String(data.referredRewardValue) : null}, referred_reward_value),
          min_purchase_amount = COALESCE(${data.minPurchaseAmount != null ? String(data.minPurchaseAmount) : null}, min_purchase_amount),
          expiration_days = COALESCE(${data.expirationDays ?? null}::int, expiration_days),
          max_referrals_per_customer = COALESCE(${data.maxReferralsPerCustomer ?? null}::int, max_referrals_per_customer),
          updated_at = NOW()
        WHERE id = ${existing.id} AND company_id = ${currentUser.companyId}
        RETURNING *
      `)
    : await db.execute(sql`
        INSERT INTO referral_config(id, company_id, enabled, referrer_reward_type, referrer_reward_value, referred_reward_type, referred_reward_value, min_purchase_amount, expiration_days, max_referrals_per_customer, created_at, updated_at)
        VALUES (gen_random_uuid(), ${currentUser.companyId}, ${data.enabled ?? false}, ${data.referrerRewardType ?? 'points'}, ${String(data.referrerRewardValue ?? 0)}, ${data.referredRewardType ?? 'points'}, ${String(data.referredRewardValue ?? 0)}, ${String(data.minPurchaseAmount ?? 0)}, ${data.expirationDays ?? 90}, ${data.maxReferralsPerCustomer ?? 10}, NOW(), NOW())
        RETURNING *
      `)

  const config = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'referral_config',
    entityId: config?.id,
    entityName: 'Referral Config',
    req: c,
  })

  return c.json(camelConfig(config))
})

// List referrals (paginated, filterable by status)
app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let statusFilter = sql``
  if (status) statusFilter = sql`AND r.status = ${status}`

  const dataResult = await db.execute(sql`
    SELECT r.*,
           ref.name as referrer_name, ref.email as referrer_email, ref.phone as referrer_phone,
           rd.name as referred_name, rd.email as referred_email
    FROM referrals r
    LEFT JOIN contact ref ON ref.id = r.referrer_id
    LEFT JOIN contact rd ON rd.id = r.referred_id
    WHERE r.company_id = ${currentUser.companyId}
      ${statusFilter}
    ORDER BY r.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM referrals r
    WHERE r.company_id = ${currentUser.companyId}
      ${statusFilter}
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Referral program stats — MUST be declared before '/:id' or it is swallowed by the
// param route and returns 404 for the literal /stats path. (route ordering)
app.get('/stats', async (c) => {
  const currentUser = c.get('user') as any

  const totalResult = await db.execute(sql`
    SELECT
      COUNT(*)::int as total_referrals,
      COUNT(*) FILTER (WHERE status = 'signed_up' OR status = 'rewarded')::int as converted,
      COUNT(*) FILTER (WHERE status = 'rewarded')::int as rewarded,
      COUNT(*) FILTER (WHERE status = 'pending')::int as pending
    FROM referrals
    WHERE company_id = ${currentUser.companyId}
  `)

  const stats = ((totalResult as any).rows || totalResult)?.[0] || {}
  const conversionRate = stats.total_referrals > 0
    ? ((stats.converted / stats.total_referrals) * 100).toFixed(1)
    : '0.0'

  // Top referrers
  const topResult = await db.execute(sql`
    SELECT r.referrer_id, c.name as referrer_name, c.email as referrer_email,
           COUNT(*)::int as total_referrals,
           COUNT(*) FILTER (WHERE r.status = 'rewarded')::int as successful_referrals
    FROM referrals r
    LEFT JOIN contact c ON c.id = r.referrer_id
    WHERE r.company_id = ${currentUser.companyId}
    GROUP BY r.referrer_id, c.name, c.email
    ORDER BY total_referrals DESC
    LIMIT 10
  `)

  const topReferrers = (topResult as any).rows || topResult

  return c.json({
    totalReferrals: stats.total_referrals || 0,
    converted: stats.converted || 0,
    rewarded: stats.rewarded || 0,
    pending: stats.pending || 0,
    conversionRate: parseFloat(conversionRate),
    topReferrers,
  })
})

// Referral detail
app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    SELECT r.*,
           ref.name as referrer_name, ref.email as referrer_email, ref.phone as referrer_phone,
           rd.name as referred_name, rd.email as referred_email, rd.phone as referred_phone
    FROM referrals r
    LEFT JOIN contact ref ON ref.id = r.referrer_id
    LEFT JOIN contact rd ON rd.id = r.referred_id
    WHERE r.id = ${id} AND r.company_id = ${currentUser.companyId}
  `)

  const referral = ((result as any).rows || result)?.[0]
  if (!referral) return c.json({ error: 'Referral not found' }, 404)

  return c.json(referral)
})

// Create referral
app.post('/', requireRole('budtender'), async (c) => {
  const currentUser = c.get('user') as any

  const referralSchema = z.object({
    referrerId: z.string().min(1),
    referralCode: z.string().optional(),
  })
  const data = referralSchema.parse(await c.req.json())

  // Auto-generate code if empty
  const code = data.referralCode || `REF-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`

  // Check max referrals per customer
  const configResult = await db.execute(sql`
    SELECT max_referrals_per_customer FROM referral_config
    WHERE company_id = ${currentUser.companyId}
  `)
  const config = ((configResult as any).rows || configResult)?.[0]

  if (config?.max_referrals_per_customer) {
    const countResult = await db.execute(sql`
      SELECT COUNT(*)::int as cnt FROM referrals
      WHERE referrer_id = ${data.referrerId} AND company_id = ${currentUser.companyId}
    `)
    const cnt = Number(((countResult as any).rows || countResult)?.[0]?.cnt || 0)
    if (cnt >= config.max_referrals_per_customer) {
      return c.json({ error: 'Maximum referrals reached for this customer' }, 400)
    }
  }

  const result = await db.execute(sql`
    INSERT INTO referrals(id, company_id, referrer_id, referral_code, status, created_at, updated_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${data.referrerId}, ${code}, 'pending', NOW(), NOW())
    RETURNING *
  `)

  const referral = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'referral',
    entityId: referral?.id,
    entityName: code,
    req: c,
  })

  return c.json(referral, 201)
})

// Redeem a referral code
app.post('/redeem', requireRole('budtender'), async (c) => {
  const currentUser = c.get('user') as any

  const redeemSchema = z.object({
    referralCode: z.string().min(1),
    contactId: z.string().min(1),
  })
  const data = redeemSchema.parse(await c.req.json())

  // Find the referral
  const findResult = await db.execute(sql`
    SELECT * FROM referrals
    WHERE referral_code = ${data.referralCode}
      AND company_id = ${currentUser.companyId}
      AND status = 'pending'
    LIMIT 1
  `)

  const referral = ((findResult as any).rows || findResult)?.[0]
  if (!referral) return c.json({ error: 'Invalid or already redeemed referral code' }, 400)

  // Check expiration
  const configResult = await db.execute(sql`
    SELECT expiration_days FROM referral_config
    WHERE company_id = ${currentUser.companyId}
  `)
  const config = ((configResult as any).rows || configResult)?.[0]
  if (config?.expiration_days) {
    const createdAt = new Date(referral.created_at)
    const expiresAt = new Date(createdAt.getTime() + config.expiration_days * 24 * 60 * 60 * 1000)
    if (new Date() > expiresAt) {
      return c.json({ error: 'Referral code has expired' }, 400)
    }
  }

  // Prevent self-referral
  if (referral.referrer_id === data.contactId) {
    return c.json({ error: 'Cannot redeem your own referral code' }, 400)
  }

  const result = await db.execute(sql`
    UPDATE referrals
    SET referred_id = ${data.contactId}, status = 'signed_up', redeemed_at = NOW(), updated_at = NOW()
    WHERE id = ${referral.id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'referral',
    entityId: referral.id,
    entityName: data.referralCode,
    changes: { status: { old: 'pending', new: 'signed_up' }, referredId: { old: null, new: data.contactId } },
    req: c,
  })

  return c.json(updated)
})

// Award referral rewards after qualifying purchase (manager+)
app.post('/:id/reward', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  // Get the referral
  const refResult = await db.execute(sql`
    SELECT * FROM referrals
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)

  const referral = ((refResult as any).rows || refResult)?.[0]
  if (!referral) return c.json({ error: 'Referral not found' }, 404)
  if (referral.status === 'rewarded') return c.json({ error: 'Referral already rewarded' }, 400)
  if (!referral.referred_id) return c.json({ error: 'Referral has not been redeemed yet' }, 400)

  // Get config for reward values
  const configResult = await db.execute(sql`
    SELECT * FROM referral_config
    WHERE company_id = ${currentUser.companyId}
  `)
  const config = ((configResult as any).rows || configResult)?.[0]
  if (!config) return c.json({ error: 'Referral program not configured' }, 400)

  // Award referrer loyalty points/credit.
  // Table is `loyalty_members` (plural) and the columns are points_balance / total_points_earned
  // (schema.ts) — the old code wrote to a singular `loyalty_member` table and a non-existent
  // `points_earned` column, so every points reward 500'd.
  if (config.referrer_reward_type === 'points' && config.referrer_reward_value > 0) {
    await awardReferralPoints(currentUser.companyId, referral.referrer_id, Number(config.referrer_reward_value), 'Referral reward')
  }
  // credit / discount_flat rewards add to the referrer's store-credit balance (contact.store_credit,
  // TEXT, added wave-2). Stored as numeric-in-text so it survives arithmetic.
  if ((config.referrer_reward_type === 'credit' || config.referrer_reward_type === 'discount_flat') && config.referrer_reward_value > 0) {
    await db.execute(sql`
      UPDATE contact
      SET store_credit = (COALESCE(NULLIF(store_credit, ''), '0')::numeric + ${config.referrer_reward_value})::text,
          updated_at = NOW()
      WHERE id = ${referral.referrer_id} AND company_id = ${currentUser.companyId}
    `)
  }

  // Award referred customer loyalty points/credit (same schema correction as the referrer above).
  if (config.referred_reward_type === 'points' && config.referred_reward_value > 0) {
    await awardReferralPoints(currentUser.companyId, referral.referred_id, Number(config.referred_reward_value), 'Referral welcome reward')
  }
  // credit / discount_flat: add to the referred customer's store-credit balance (see referrer branch).
  if ((config.referred_reward_type === 'credit' || config.referred_reward_type === 'discount_flat') && config.referred_reward_value > 0) {
    await db.execute(sql`
      UPDATE contact
      SET store_credit = (COALESCE(NULLIF(store_credit, ''), '0')::numeric + ${config.referred_reward_value})::text,
          updated_at = NOW()
      WHERE id = ${referral.referred_id} AND company_id = ${currentUser.companyId}
    `)
  }

  // Mark referral as rewarded
  const result = await db.execute(sql`
    UPDATE referrals
    SET status = 'rewarded', rewarded_at = NOW(), updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'referral',
    entityId: id,
    entityName: referral.referral_code,
    changes: { status: { old: referral.status, new: 'rewarded' } },
    req: c,
  })

  return c.json(updated)
})

export default app

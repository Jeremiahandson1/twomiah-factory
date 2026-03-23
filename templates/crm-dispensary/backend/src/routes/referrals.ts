import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

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

  return c.json(config)
})

// Update referral config (manager+)
app.put('/config', requireRole('manager'), async (c) => {
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
  const data = configSchema.parse(await c.req.json())

  // Upsert config
  const result = await db.execute(sql`
    INSERT INTO referral_config(id, company_id, enabled, referrer_reward_type, referrer_reward_value, referred_reward_type, referred_reward_value, min_purchase_amount, expiration_days, max_referrals_per_customer, created_at, updated_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${data.enabled ?? false}, ${data.referrerRewardType ?? 'points'}, ${data.referrerRewardValue ?? 0}, ${data.referredRewardType ?? 'points'}, ${data.referredRewardValue ?? 0}, ${data.minPurchaseAmount ?? 0}, ${data.expirationDays ?? 90}, ${data.maxReferralsPerCustomer ?? 10}, NOW(), NOW())
    ON CONFLICT (company_id) DO UPDATE SET
      enabled = COALESCE(${data.enabled ?? null}::boolean, referral_config.enabled),
      referrer_reward_type = COALESCE(${data.referrerRewardType ?? null}, referral_config.referrer_reward_type),
      referrer_reward_value = COALESCE(${data.referrerRewardValue ?? null}::numeric, referral_config.referrer_reward_value),
      referred_reward_type = COALESCE(${data.referredRewardType ?? null}, referral_config.referred_reward_type),
      referred_reward_value = COALESCE(${data.referredRewardValue ?? null}::numeric, referral_config.referred_reward_value),
      min_purchase_amount = COALESCE(${data.minPurchaseAmount ?? null}::numeric, referral_config.min_purchase_amount),
      expiration_days = COALESCE(${data.expirationDays ?? null}::int, referral_config.expiration_days),
      max_referrals_per_customer = COALESCE(${data.maxReferralsPerCustomer ?? null}::int, referral_config.max_referrals_per_customer),
      updated_at = NOW()
    RETURNING *
  `)

  const config = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'referral_config',
    entityId: config?.id,
    entityName: 'Referral Config',
    req: c.req,
  })

  return c.json(config)
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
app.post('/', async (c) => {
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
    req: c.req,
  })

  return c.json(referral, 201)
})

// Redeem a referral code
app.post('/redeem', async (c) => {
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
    req: c.req,
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

  // Award referrer loyalty points/credit
  if (config.referrer_reward_type === 'points' && config.referrer_reward_value > 0) {
    await db.execute(sql`
      UPDATE loyalty_member
      SET points_balance = points_balance + ${config.referrer_reward_value},
          points_earned = points_earned + ${config.referrer_reward_value},
          updated_at = NOW()
      WHERE contact_id = ${referral.referrer_id} AND company_id = ${currentUser.companyId}
    `)
  } else if ((config.referrer_reward_type === 'credit' || config.referrer_reward_type === 'discount_flat') && config.referrer_reward_value > 0) {
    await db.execute(sql`
      UPDATE contact
      SET store_credit = COALESCE(store_credit, 0) + ${config.referrer_reward_value},
          updated_at = NOW()
      WHERE id = ${referral.referrer_id} AND company_id = ${currentUser.companyId}
    `)
  }

  // Award referred customer loyalty points/credit
  if (config.referred_reward_type === 'points' && config.referred_reward_value > 0) {
    await db.execute(sql`
      UPDATE loyalty_member
      SET points_balance = points_balance + ${config.referred_reward_value},
          points_earned = points_earned + ${config.referred_reward_value},
          updated_at = NOW()
      WHERE contact_id = ${referral.referred_id} AND company_id = ${currentUser.companyId}
    `)
  } else if ((config.referred_reward_type === 'credit' || config.referred_reward_type === 'discount_flat') && config.referred_reward_value > 0) {
    await db.execute(sql`
      UPDATE contact
      SET store_credit = COALESCE(store_credit, 0) + ${config.referred_reward_value},
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
    req: c.req,
  })

  return c.json(updated)
})

// Referral program stats
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

export default app

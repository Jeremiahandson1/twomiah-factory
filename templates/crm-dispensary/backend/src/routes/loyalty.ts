import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { contact } from '../../db/schema.ts'
import { eq, and, ilike, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// Raw-SQL rows come back snake_case (company_id, points_balance); the client reads camelCase.
// Normalise so /members isn't the one module still on the old convention. (retest#9)
const camel = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}

// List loyalty members
app.get('/members', async (c) => {
  const currentUser = c.get('user') as any
  const search = c.req.query('search')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let searchClause = sql``
  if (search) {
    searchClause = sql`AND (c.name ILIKE ${'%' + search + '%'} OR c.phone ILIKE ${'%' + search + '%'} OR c.email ILIKE ${'%' + search + '%'})`
  }

  const dataResult = await db.execute(sql`
    SELECT lm.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone
    FROM loyalty_members lm
    JOIN contact c ON c.id = lm.contact_id
    WHERE lm.company_id = ${currentUser.companyId} ${searchClause}
    ORDER BY lm.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM loyalty_members lm
    JOIN contact c ON c.id = lm.contact_id
    WHERE lm.company_id = ${currentUser.companyId} ${searchClause}
  `)

  const data = ((dataResult as any).rows || dataResult).map(camel)
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Get member detail with transaction history
app.get('/members/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const memberResult = await db.execute(sql`
    SELECT lm.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone
    FROM loyalty_members lm
    JOIN contact c ON c.id = lm.contact_id
    WHERE lm.id = ${id} AND lm.company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const member = ((memberResult as any).rows || memberResult)?.[0]
  if (!member) return c.json({ error: 'Member not found' }, 404)

  const transactionsResult = await db.execute(sql`
    SELECT * FROM loyalty_transactions
    WHERE member_id = ${id} AND company_id = ${currentUser.companyId}
    ORDER BY created_at DESC
    LIMIT 50
  `)
  const transactions = ((transactionsResult as any).rows || transactionsResult).map(camel)

  return c.json({ ...camel(member), transactions })
})

// Enroll customer as loyalty member
app.post('/members', async (c) => {
  const currentUser = c.get('user') as any

  const enrollSchema = z.object({
    contactId: z.string(),
    initialPoints: z.number().int().min(0).default(0),
    tier: z.enum(['bronze', 'silver', 'gold', 'platinum']).default('bronze'),
    notes: z.string().optional(),
  })
  const data = enrollSchema.parse(await c.req.json())

  // Verify contact exists
  const [foundContact] = await db.select().from(contact)
    .where(and(eq(contact.id, data.contactId), eq(contact.companyId, currentUser.companyId)))
    .limit(1)
  if (!foundContact) return c.json({ error: 'Contact not found' }, 404)

  // Check if already enrolled
  const existingResult = await db.execute(sql`
    SELECT id FROM loyalty_members
    WHERE contact_id = ${data.contactId} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (existing) return c.json({ error: 'Customer is already a loyalty member' }, 409)

  const result = await db.execute(sql`
    INSERT INTO loyalty_members(id, contact_id, tier, points_balance, total_points_earned, lifetime_points, total_visits, total_spent, notes, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.contactId}, ${data.tier}, ${data.initialPoints}, ${data.initialPoints}, ${data.initialPoints}, 0, 0, ${data.notes || null}, ${currentUser.companyId}, NOW(), NOW())
    RETURNING *
  `)
  const member = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'loyalty_member',
    entityId: member?.id,
    entityName: foundContact.name,
    metadata: { tier: data.tier, initialPoints: data.initialPoints },
    req: c.req,
  })

  return c.json(member, 201)
})

// Adjust points manually (manager+)
app.post('/members/:id/adjust', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const adjustSchema = z.object({
    points: z.number().int(),
    reason: z.string().min(1),
  })
  const data = adjustSchema.parse(await c.req.json())

  // Verify member exists
  const memberResult = await db.execute(sql`
    SELECT lm.*, c.name as customer_name FROM loyalty_members lm
    JOIN contact c ON c.id = lm.contact_id
    WHERE lm.id = ${id} AND lm.company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const member = ((memberResult as any).rows || memberResult)?.[0]
  if (!member) return c.json({ error: 'Member not found' }, 404)

  const newBalance = Math.max(0, Number(member.points_balance) + data.points)

  await db.execute(sql`
    UPDATE loyalty_members
    SET points_balance = ${newBalance},
        total_points_earned = CASE WHEN ${data.points} > 0 THEN total_points_earned + ${data.points} ELSE total_points_earned END,
        lifetime_points = CASE WHEN ${data.points} > 0 THEN COALESCE(lifetime_points,0) + ${data.points} ELSE COALESCE(lifetime_points,0) END,
        updated_at = NOW()
    WHERE id = ${id}
  `)

  // Re-evaluate tier so a manual adjustment can move the customer up or down, same as
  // award/refund — every point-changing path recomputes tier consistently. (retest#13)
  await db.execute(sql`
    UPDATE loyalty_members SET tier = CASE
        WHEN COALESCE(total_points_earned::numeric, 0) >= 5000 THEN 'platinum'
        WHEN COALESCE(total_points_earned::numeric, 0) >= 1500 THEN 'gold'
        WHEN COALESCE(total_points_earned::numeric, 0) >= 500 THEN 'silver'
        ELSE 'bronze' END,
      updated_at = NOW()
    WHERE id = ${id}
  `)

  // Log transaction
  await db.execute(sql`
    INSERT INTO loyalty_transactions(id, member_id, type, points, balance_after, description, company_id, created_at)
    VALUES (gen_random_uuid(), ${id}, ${data.points > 0 ? 'adjustment_add' : 'adjustment_subtract'}, ${data.points}, ${newBalance}, ${data.reason}, ${currentUser.companyId}, NOW())
  `)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'loyalty_member',
    entityId: id,
    entityName: member.customer_name,
    changes: { points_balance: { old: member.points_balance, new: newBalance } },
    metadata: { reason: data.reason, adjustment: data.points },
    req: c.req,
  })

  return c.json({ pointsBalance: newBalance, adjustment: data.points })
})

// List rewards
// Return camelCase aliases matching the frontend (LoyaltyPage reads pointsCost,
// discountType, discountValue, isActive). Selecting the real columns
// (points_cost/discount_type/discount_value/active) fixes the $NaN display.
app.get('/rewards', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT id, name, description,
           points_cost AS "pointsCost",
           points_required AS "pointsRequired",
           discount_type AS "discountType",
           discount_value AS "discountValue",
           applicable_categories AS "applicableCategories",
           product_id AS "productId",
           min_tier AS "minTier",
           usage_count AS "usageCount",
           active AS "isActive",
           active AS "active",
           created_at AS "createdAt",
           updated_at AS "updatedAt"
    FROM loyalty_rewards
    WHERE company_id = ${currentUser.companyId}
    ORDER BY points_cost ASC
  `)

  return c.json((result as any).rows || result)
})

// Create reward (manager+)
app.post('/rewards', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  // Accept the frontend's camelCase fields and write to the REAL columns
  // (points_cost is NOT NULL; discount_type/discount_value/active). The old
  // schema inserted into type/value/limit_per_customer/expires_at, which don't
  // exist on loyalty_rewards, and omitted points_cost → every create 500'd.
  const rewardSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    pointsCost: z.number().int().min(1),
    discountType: z.enum(['fixed', 'percent', 'free_item']),
    discountValue: z.number().min(0), // percent or dollar amount (stored as text)
    productId: z.string().optional(), // for free_item type
    isActive: z.boolean().default(true),
  })
  const data = rewardSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO loyalty_rewards(id, name, description, points_cost, discount_type, discount_value, product_id, active, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.name}, ${data.description || null}, ${data.pointsCost}, ${data.discountType}, ${String(data.discountValue)}, ${data.productId || null}, ${data.isActive}, ${currentUser.companyId}, NOW(), NOW())
    RETURNING id, name, description, points_cost AS "pointsCost", discount_type AS "discountType", discount_value AS "discountValue", product_id AS "productId", active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"
  `)

  return c.json(((result as any).rows || result)?.[0], 201)
})

// Update reward (manager+)
app.put('/rewards/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const rewardSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    pointsCost: z.number().int().min(1).optional(),
    discountType: z.enum(['fixed', 'percent', 'free_item']).optional(),
    discountValue: z.number().min(0).optional(),
    productId: z.string().optional(),
    isActive: z.boolean().optional(),
  })
  const data = rewardSchema.parse(await c.req.json())

  // Build SET clause dynamically — real columns only.
  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.name !== undefined) sets.push(sql`name = ${data.name}`)
  if (data.description !== undefined) sets.push(sql`description = ${data.description}`)
  if (data.pointsCost !== undefined) sets.push(sql`points_cost = ${data.pointsCost}`)
  if (data.discountType !== undefined) sets.push(sql`discount_type = ${data.discountType}`)
  if (data.discountValue !== undefined) sets.push(sql`discount_value = ${String(data.discountValue)}`)
  if (data.productId !== undefined) sets.push(sql`product_id = ${data.productId}`)
  if (data.isActive !== undefined) sets.push(sql`active = ${data.isActive}`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE loyalty_rewards SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING id, name, description, points_cost AS "pointsCost", discount_type AS "discountType", discount_value AS "discountValue", product_id AS "productId", active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Reward not found' }, 404)

  return c.json(updated)
})

// Delete reward (manager+)
app.delete('/rewards/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    DELETE FROM loyalty_rewards
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING id
  `)
  const deleted = ((result as any).rows || result)?.[0]
  if (!deleted) return c.json({ error: 'Reward not found' }, 404)

  return c.json({ success: true })
})

// Check points by phone (for POS quick lookup)
app.get('/check', async (c) => {
  const currentUser = c.get('user') as any
  const phone = c.req.query('phone')
  if (!phone) return c.json({ error: 'Phone number required' }, 400)

  const result = await db.execute(sql`
    SELECT lm.id, lm.points_balance, lm.tier, lm.total_visits, lm.total_spent,
           c.name as customer_name, c.phone as customer_phone, c.id as contact_id
    FROM loyalty_members lm
    JOIN contact c ON c.id = lm.contact_id
    WHERE c.phone ILIKE ${'%' + phone.replace(/\D/g, '').slice(-10)}
      AND lm.company_id = ${currentUser.companyId}
    LIMIT 1
  `)

  const member = ((result as any).rows || result)?.[0]
  if (!member) return c.json({ found: false })

  return c.json({ found: true, ...member })
})

export default app

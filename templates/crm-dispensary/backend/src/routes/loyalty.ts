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

  const data = (dataResult as any).rows || dataResult
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
  const transactions = (transactionsResult as any).rows || transactionsResult

  return c.json({ ...member, transactions })
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
    INSERT INTO loyalty_members(id, contact_id, tier, points_balance, total_points_earned, total_visits, total_spent, notes, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.contactId}, ${data.tier}, ${data.initialPoints}, ${data.initialPoints}, 0, 0, ${data.notes || null}, ${currentUser.companyId}, NOW(), NOW())
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
app.get('/rewards', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT * FROM loyalty_rewards
    WHERE company_id = ${currentUser.companyId}
    ORDER BY points_required ASC
  `)

  return c.json((result as any).rows || result)
})

// Create reward (manager+)
app.post('/rewards', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const rewardSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    pointsRequired: z.number().int().min(1),
    type: z.enum(['discount_percent', 'discount_fixed', 'free_item', 'other']),
    value: z.number().min(0), // percent or dollar amount
    productId: z.string().optional(), // for free_item type
    active: z.boolean().default(true),
    limitPerCustomer: z.number().int().optional(),
    expiresAt: z.string().optional(),
  })
  const data = rewardSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO loyalty_rewards(id, name, description, points_required, type, value, product_id, active, limit_per_customer, expires_at, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.name}, ${data.description || null}, ${data.pointsRequired}, ${data.type}, ${data.value}, ${data.productId || null}, ${data.active}, ${data.limitPerCustomer || null}, ${data.expiresAt ? new Date(data.expiresAt) : null}, ${currentUser.companyId}, NOW(), NOW())
    RETURNING *
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
    pointsRequired: z.number().int().min(1).optional(),
    type: z.enum(['discount_percent', 'discount_fixed', 'free_item', 'other']).optional(),
    value: z.number().min(0).optional(),
    productId: z.string().optional(),
    active: z.boolean().optional(),
    limitPerCustomer: z.number().int().optional(),
    expiresAt: z.string().optional(),
  })
  const data = rewardSchema.parse(await c.req.json())

  // Build SET clause dynamically
  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.name !== undefined) sets.push(sql`name = ${data.name}`)
  if (data.description !== undefined) sets.push(sql`description = ${data.description}`)
  if (data.pointsRequired !== undefined) sets.push(sql`points_required = ${data.pointsRequired}`)
  if (data.type !== undefined) sets.push(sql`type = ${data.type}`)
  if (data.value !== undefined) sets.push(sql`value = ${data.value}`)
  if (data.productId !== undefined) sets.push(sql`product_id = ${data.productId}`)
  if (data.active !== undefined) sets.push(sql`active = ${data.active}`)
  if (data.limitPerCustomer !== undefined) sets.push(sql`limit_per_customer = ${data.limitPerCustomer}`)
  if (data.expiresAt !== undefined) sets.push(sql`expires_at = ${new Date(data.expiresAt)}`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE loyalty_rewards SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
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

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// List cash sessions
app.get('/sessions', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status') // open, closed
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let statusFilter = sql``
  if (status) statusFilter = sql`AND cs.status = ${status}`

  const dataResult = await db.execute(sql`
    SELECT cs.*,
           ou.first_name || ' ' || ou.last_name as opened_by_name,
           cu.first_name || ' ' || cu.last_name as closed_by_name
    FROM cash_sessions cs
    LEFT JOIN "user" ou ON ou.id = cs.opened_by_id
    LEFT JOIN "user" cu ON cu.id = cs.closed_by_id
    WHERE cs.company_id = ${currentUser.companyId}
      ${statusFilter}
    ORDER BY cs.opened_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM cash_sessions
    WHERE company_id = ${currentUser.companyId} ${statusFilter}
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Get session detail
app.get('/sessions/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const sessionResult = await db.execute(sql`
    SELECT cs.*,
           ou.first_name || ' ' || ou.last_name as opened_by_name,
           cu.first_name || ' ' || cu.last_name as closed_by_name
    FROM cash_sessions cs
    LEFT JOIN "user" ou ON ou.id = cs.opened_by_id
    LEFT JOIN "user" cu ON cu.id = cs.closed_by_id
    WHERE cs.id = ${id} AND cs.company_id = ${currentUser.companyId}
    LIMIT 1
  `)

  const session = ((sessionResult as any).rows || sessionResult)?.[0]
  if (!session) return c.json({ error: 'Session not found' }, 404)

  // Get cash transactions during this session
  const transactionsResult = await db.execute(sql`
    SELECT o.number, o.total, o.cash_tendered, o.change_due, o.payment_method, o.completed_at
    FROM "order" o
    WHERE o.company_id = ${currentUser.companyId}
      AND o.status = 'completed'
      AND o.payment_method = 'cash'
      AND o.completed_at >= ${new Date(session.opened_at)}
      ${session.closed_at ? sql`AND o.completed_at <= ${new Date(session.closed_at)}` : sql``}
    ORDER BY o.completed_at ASC
  `)

  const transactions = (transactionsResult as any).rows || transactionsResult

  // Calculate expected cash
  const totalCashIn = transactions.reduce((sum: number, t: any) => sum + Number(t.total), 0)
  const totalChangeOut = transactions.reduce((sum: number, t: any) => sum + Number(t.change_due || 0), 0)
  const expectedCash = Number(session.opening_amount) + totalCashIn - totalChangeOut

  return c.json({
    ...session,
    transactions,
    summary: {
      totalCashIn,
      totalChangeOut,
      expectedCash,
      transactionCount: transactions.length,
    },
  })
})

// Open cash drawer
app.post('/sessions/open', async (c) => {
  const currentUser = c.get('user') as any

  const openSchema = z.object({
    openingAmount: z.number().min(0),
    register: z.string().default('main'),
    notes: z.string().optional(),
  })
  const data = openSchema.parse(await c.req.json())

  // Check for existing open session on this register
  const existingResult = await db.execute(sql`
    SELECT id FROM cash_sessions
    WHERE company_id = ${currentUser.companyId}
      AND register = ${data.register}
      AND status = 'open'
    LIMIT 1
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (existing) {
    return c.json({ error: `Register "${data.register}" already has an open session` }, 400)
  }

  const result = await db.execute(sql`
    INSERT INTO cash_sessions(id, register, opening_amount, status, opened_by_id, opened_at, notes, company_id, created_at)
    VALUES (gen_random_uuid(), ${data.register}, ${data.openingAmount}, 'open', ${currentUser.userId}, NOW(), ${data.notes || null}, ${currentUser.companyId}, NOW())
    RETURNING *
  `)

  const session = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'cash_session',
    entityId: session?.id,
    entityName: `Register: ${data.register}`,
    metadata: { openingAmount: data.openingAmount, register: data.register },
    req: c.req,
  })

  return c.json(session, 201)
})

// Close & reconcile cash drawer
app.post('/sessions/:id/close', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const closeSchema = z.object({
    closingAmount: z.number().min(0),
    notes: z.string().optional(),
    denominations: z.object({
      pennies: z.number().int().min(0).default(0),
      nickels: z.number().int().min(0).default(0),
      dimes: z.number().int().min(0).default(0),
      quarters: z.number().int().min(0).default(0),
      ones: z.number().int().min(0).default(0),
      fives: z.number().int().min(0).default(0),
      tens: z.number().int().min(0).default(0),
      twenties: z.number().int().min(0).default(0),
      fifties: z.number().int().min(0).default(0),
      hundreds: z.number().int().min(0).default(0),
    }).optional(),
  })
  const data = closeSchema.parse(await c.req.json())

  // Verify session exists and is open
  const sessionResult = await db.execute(sql`
    SELECT * FROM cash_sessions
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const session = ((sessionResult as any).rows || sessionResult)?.[0]
  if (!session) return c.json({ error: 'Session not found' }, 404)
  if (session.status !== 'open') return c.json({ error: 'Session is already closed' }, 400)

  // Calculate expected cash from orders during this session
  const ordersResult = await db.execute(sql`
    SELECT
      COALESCE(SUM(total::numeric), 0) as total_cash_in,
      COALESCE(SUM((change_due)::numeric), 0) as total_change_out
    FROM "order"
    WHERE company_id = ${currentUser.companyId}
      AND status = 'completed'
      AND payment_method = 'cash'
      AND completed_at >= ${new Date(session.opened_at)}
  `)
  const orderSummary = ((ordersResult as any).rows || ordersResult)?.[0] || { total_cash_in: 0, total_change_out: 0 }

  const expectedCash = Number(session.opening_amount) + Number(orderSummary.total_cash_in) - Number(orderSummary.total_change_out)
  const variance = data.closingAmount - expectedCash

  const result = await db.execute(sql`
    UPDATE cash_sessions
    SET status = 'closed',
        closing_amount = ${data.closingAmount},
        expected_amount = ${expectedCash},
        variance = ${variance},
        closed_by_id = ${currentUser.userId},
        closed_at = NOW(),
        notes = COALESCE(notes, '') || ${data.notes ? '\n' + data.notes : ''},
        denominations = ${data.denominations ? JSON.stringify(data.denominations) : null}::jsonb
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'cash_session',
    entityId: id,
    entityName: `Register: ${session.register}`,
    changes: { status: { old: 'open', new: 'closed' } },
    metadata: {
      openingAmount: session.opening_amount,
      closingAmount: data.closingAmount,
      expectedCash,
      variance,
    },
    req: c.req,
  })

  return c.json({
    ...updated,
    reconciliation: {
      openingAmount: Number(session.opening_amount),
      totalCashIn: Number(orderSummary.total_cash_in),
      totalChangeOut: Number(orderSummary.total_change_out),
      expectedCash,
      closingAmount: data.closingAmount,
      variance,
      isOver: variance > 0,
      isShort: variance < 0,
      isBalanced: Math.abs(variance) < 0.01,
    },
  })
})

export default app

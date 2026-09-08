import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// The cash panel reads camelCase (openingBalance, openedAt, openedByName, ...) but these
// raw-SQL rows come back snake_case, so a drawer opened with a $200 float rendered as
// $0.00 with a row of dashes. Convert row keys to camelCase before responding. (retest#5 N1)
const camel = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}

// List cash sessions
app.get('/sessions', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status') // open, closed
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let statusFilter = sql``
  if (status) statusFilter = sql`AND cs.status = ${status}`

  // The cash panel computes "Expected in Drawer" as openingAmount + cashSales - cashRefunds,
  // but the list never returned cashSales/cashRefunds, so every drawer showed just the float
  // and reconciliation read Expected = opening only (retest#6 N2). Attribute completed cash
  // orders to each session's time window via LATERAL subqueries. Net cash added to the drawer
  // per sale == order total (tendered - change == total), so we SUM(total); refunded cash
  // orders (payment_status='refunded') are summed separately as cashRefunds.
  const dataResult = await db.execute(sql`
    SELECT cs.*,
           ou.first_name || ' ' || ou.last_name as opened_by_name,
           cu.first_name || ' ' || cu.last_name as closed_by_name,
           COALESCE(sales.amt, 0) as cash_sales,
           COALESCE(refunds.amt, 0) as cash_refunds,
           -- Report the live expected drawer so it isn't 0 in the API while only the
           -- browser knows the real figure. (retest#9)
           (COALESCE(cs.opening_amount::numeric, 0) + COALESCE(sales.amt, 0) - COALESCE(refunds.amt, 0)) as expected_balance
    FROM cash_sessions cs
    LEFT JOIN "user" ou ON ou.id = cs.opened_by_id
    LEFT JOIN "user" cu ON cu.id = cs.closed_by_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(o.total::numeric), 0) as amt FROM orders o
      WHERE o.company_id = cs.company_id AND o.status = 'completed'
        AND o.payment_method = 'cash' AND COALESCE(o.payment_status, '') <> 'refunded'
        AND o.completed_at >= cs.opened_at
        AND (cs.closed_at IS NULL OR o.completed_at <= cs.closed_at)
    ) sales ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(o.total::numeric), 0) as amt FROM orders o
      WHERE o.company_id = cs.company_id AND o.status = 'completed'
        AND o.payment_method = 'cash' AND o.payment_status = 'refunded'
        AND o.completed_at >= cs.opened_at
        AND (cs.closed_at IS NULL OR o.completed_at <= cs.closed_at)
    ) refunds ON true
    WHERE cs.company_id = ${currentUser.companyId}
      ${statusFilter}
    ORDER BY cs.opened_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM cash_sessions cs
    WHERE cs.company_id = ${currentUser.companyId} ${statusFilter}
  `)

  const data = ((dataResult as any).rows || dataResult).map(camel)
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
    SELECT o.number, o.total, o.cash_tendered, o.change_due, o.payment_method, o.payment_status, o.completed_at
    FROM orders o
    WHERE o.company_id = ${currentUser.companyId}
      AND o.status = 'completed'
      AND o.payment_method = 'cash'
      AND o.completed_at >= ${new Date(session.opened_at)}
      ${session.closed_at ? sql`AND o.completed_at <= ${new Date(session.closed_at)}` : sql``}
    ORDER BY o.completed_at ASC
  `)

  const transactions = ((transactionsResult as any).rows || transactionsResult).map(camel)

  // Net cash added to the drawer per sale == order total (tendered - change == total), so
  // cash-in is SUM(total) of non-refunded cash orders; refunded cash orders are subtracted.
  // (Do NOT subtract change_due on top of total — that double-counts the change.)
  const totalCashIn = transactions.reduce((sum: number, t: any) =>
    (t.paymentStatus === 'refunded' ? sum : sum + Number(t.total || 0)), 0)
  const totalRefunds = transactions.reduce((sum: number, t: any) =>
    (t.paymentStatus === 'refunded' ? sum + Number(t.total || 0) : sum), 0)
  const expectedCash = Number(session.opening_amount) + totalCashIn - totalRefunds

  return c.json({
    ...camel(session),
    transactions,
    summary: {
      totalCashIn,
      totalRefunds,
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

  // Block a second open drawer company-wide. The old guard filtered on
  // register = ${data.register}, so any open session with a NULL or different register
  // slipped past and a second (or third) drawer opened — then EOD reconciled against
  // only the latest and silently ignored the rest. This app has a single register, so
  // ANY open session must block a new open. (retest#8)
  const existingResult = await db.execute(sql`
    SELECT id, register, opened_at FROM cash_sessions
    WHERE company_id = ${currentUser.companyId}
      AND status = 'open'
    ORDER BY opened_at ASC
    LIMIT 1
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (existing) {
    return c.json({ error: `A cash drawer is already open${existing.register ? ` on register "${existing.register}"` : ''}. Close it before opening another.` }, 400)
  }

  // The SELECT above is a courtesy that yields a friendly message for the common
  // sequential case. It is NOT the real guard: two simultaneous opens can both pass
  // it before either INSERT lands (F-34). The atomic guard is the partial unique
  // index cash_session_one_open_per_company (one open row per company); the loser of
  // a race hits a 23505 unique violation here and gets the same 400 as the pre-check.
  let result: any
  try {
    result = await db.execute(sql`
      INSERT INTO cash_sessions(id, user_id, register, opening_amount, opening_balance, status, opened_by_id, opened_at, notes, company_id, created_at)
      VALUES (gen_random_uuid(), ${currentUser.userId}, ${data.register}, ${data.openingAmount}, ${String(data.openingAmount)}, 'open', ${currentUser.userId}, NOW(), ${data.notes || null}, ${currentUser.companyId}, NOW())
      RETURNING *
    `)
  } catch (e: any) {
    const code = e?.code || e?.cause?.code
    if (code === '23505' || /duplicate key|unique constraint/i.test(e?.message || '')) {
      return c.json({ error: 'A cash drawer is already open. Close it before opening another.' }, 400)
    }
    throw e
  }

  const session = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'cash_session',
    entityId: session?.id,
    entityName: `Register: ${data.register}`,
    metadata: { openingAmount: data.openingAmount, register: data.register },
    req: c.req,
  })

  return c.json(camel(session), 201)
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

  // Calculate expected cash from orders during this session. Net cash added to the drawer
  // per sale == order total (tendered - change == total); refunded cash orders are
  // subtracted. Do NOT subtract change_due on top of total — that double-counts change.
  // Bound the sales window to [opened_at, now]. Without an upper bound it summed cash sales
  // right up to query time, so a drawer closed early still absorbed later sales — inflating
  // expected and producing a phantom shortfall. (retest#11)
  const ordersResult = await db.execute(sql`
    SELECT
      COALESCE(SUM(total::numeric) FILTER (WHERE COALESCE(payment_status, '') <> 'refunded'), 0) as total_cash_in,
      COALESCE(SUM(total::numeric) FILTER (WHERE payment_status = 'refunded'), 0) as total_refunds
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND status = 'completed'
      AND payment_method = 'cash'
      AND completed_at >= ${new Date(session.opened_at)}
      AND completed_at <= NOW()
  `)
  const orderSummary = ((ordersResult as any).rows || ordersResult)?.[0] || { total_cash_in: 0, total_refunds: 0 }

  const round2 = (n: number) => Math.round(n * 100) / 100
  const expectedCash = round2(Number(session.opening_amount) + Number(orderSummary.total_cash_in) - Number(orderSummary.total_refunds))
  // Round so variance stores 0 / -113.4, not a float artifact like -113.39999999999998. (retest#12)
  const variance = round2(data.closingAmount - expectedCash)

  const result = await db.execute(sql`
    UPDATE cash_sessions
    SET status = 'closed',
        closing_amount = ${data.closingAmount},
        expected_amount = ${expectedCash},
        -- Populate the legacy columns the cash detail / EOD read for "Actual". They were left
        -- NULL, so Actual fell back to the opening float on a closed drawer. (retest#11)
        actual_count = ${String(data.closingAmount)},
        expected_balance = ${String(expectedCash)},
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
    ...camel(updated),
    reconciliation: {
      openingAmount: Number(session.opening_amount),
      totalCashIn: Number(orderSummary.total_cash_in),
      totalRefunds: Number(orderSummary.total_refunds),
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

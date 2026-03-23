import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// ─── POST /generate ── Generate EOD report for a date + location ─────────────

const generateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  locationId: z.string().uuid(),
})

app.post('/generate', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  let data: z.infer<typeof generateSchema>
  try {
    data = generateSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const reportDate = data.date
  const locationId = data.locationId

  // ── Orders summary ──
  const ordersResult = await db.execute(sql`
    SELECT
      COUNT(*)::int as order_count,
      COALESCE(SUM(total::numeric), 0) as total_revenue,
      COALESCE(SUM(excise_tax::numeric), 0) as total_excise_tax,
      COALESCE(SUM(sales_tax::numeric), 0) as total_sales_tax,
      COALESCE(SUM(total_tax::numeric), 0) as total_tax,
      COALESCE(SUM(discount_amount::numeric), 0) as total_discounts,
      COUNT(*) FILTER (WHERE status = 'refunded')::int as refund_count,
      COALESCE(SUM(total::numeric) FILTER (WHERE status = 'refunded'), 0) as refund_total,
      COUNT(*) FILTER (WHERE status = 'cancelled')::int as void_count
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND DATE(created_at) = ${reportDate}::date
  `)
  const orderStats = ((ordersResult as any).rows || ordersResult)?.[0] || {}

  // Revenue by payment method
  const paymentResult = await db.execute(sql`
    SELECT
      payment_method,
      COUNT(*)::int as count,
      COALESCE(SUM(total::numeric), 0) as total
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND DATE(created_at) = ${reportDate}::date
      AND status = 'completed'
    GROUP BY payment_method
    ORDER BY total DESC
  `)
  const revenueByPaymentMethod = (paymentResult as any).rows || paymentResult

  // ── Cash reconciliation ──
  const cashResult = await db.execute(sql`
    SELECT
      cs.opening_amount,
      cs.closing_amount,
      cs.expected_amount,
      cs.variance,
      cs.status as session_status,
      cs.opened_at,
      cs.closed_at
    FROM cash_sessions cs
    WHERE cs.company_id = ${currentUser.companyId}
      AND DATE(cs.opened_at) = ${reportDate}::date
    ORDER BY cs.opened_at DESC
    LIMIT 1
  `)
  const cashSession = ((cashResult as any).rows || cashResult)?.[0] || null

  // ── Inventory adjustments ──
  const inventoryResult = await db.execute(sql`
    SELECT
      COUNT(*)::int as adjustment_count,
      COALESCE(SUM(ABS(quantity_change)) FILTER (WHERE quantity_change < 0), 0) as shrinkage_units,
      COUNT(*) FILTER (WHERE quantity_change < 0)::int as shrinkage_count
    FROM inventory_adjustments
    WHERE company_id = ${currentUser.companyId}
      AND DATE(created_at) = ${reportDate}::date
  `)
  const inventoryStats = ((inventoryResult as any).rows || inventoryResult)?.[0] || {}

  // Shrinkage value estimate (units * avg cost)
  const shrinkageValueResult = await db.execute(sql`
    SELECT COALESCE(SUM(ABS(ia.quantity_change) * COALESCE(p.cost_price::numeric, 0)), 0) as shrinkage_value
    FROM inventory_adjustments ia
    JOIN products p ON p.id = ia.product_id
    WHERE ia.company_id = ${currentUser.companyId}
      AND DATE(ia.created_at) = ${reportDate}::date
      AND ia.quantity_change < 0
  `)
  const shrinkageValue = Number(((shrinkageValueResult as any).rows || shrinkageValueResult)?.[0]?.shrinkage_value || 0)

  // ── Compliance ──
  const complianceResult = await db.execute(sql`
    SELECT
      COALESCE(SUM(total_weight_grams::numeric), 0) as total_cannabis_weight_sold,
      COUNT(*) FILTER (WHERE total_weight_grams::numeric > 70.87)::int as purchase_limit_violations,
      COUNT(DISTINCT customer_id) FILTER (WHERE customer_id IS NOT NULL)::int as id_verifications
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND DATE(created_at) = ${reportDate}::date
      AND status = 'completed'
  `)
  const complianceStats = ((complianceResult as any).rows || complianceResult)?.[0] || {}

  // ── Staff ──
  const staffResult = await db.execute(sql`
    SELECT
      u.id, u.first_name, u.last_name,
      COUNT(o.id)::int as orders_processed,
      COALESCE(SUM(o.total::numeric), 0) as revenue_generated,
      COALESCE(SUM(o.tip_amount::numeric), 0) as tips_earned
    FROM "user" u
    JOIN orders o ON o.budtender_id = u.id
    WHERE o.company_id = ${currentUser.companyId}
      AND DATE(o.created_at) = ${reportDate}::date
      AND o.status = 'completed'
    GROUP BY u.id, u.first_name, u.last_name
    ORDER BY revenue_generated DESC
  `)
  const staffStats = (staffResult as any).rows || staffResult

  // Total tips
  const tipsResult = await db.execute(sql`
    SELECT COALESCE(SUM(tip_amount::numeric), 0) as total_tips
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND DATE(created_at) = ${reportDate}::date
      AND status = 'completed'
  `)
  const totalTips = Number(((tipsResult as any).rows || tipsResult)?.[0]?.total_tips || 0)

  // ── Loyalty ──
  const loyaltyResult = await db.execute(sql`
    SELECT
      COALESCE(SUM(points) FILTER (WHERE type = 'earn'), 0)::int as points_issued,
      COALESCE(SUM(ABS(points)) FILTER (WHERE type = 'redeem'), 0)::int as points_redeemed,
      COUNT(DISTINCT member_id) FILTER (WHERE type = 'earn')::int as active_members
    FROM loyalty_transactions
    WHERE company_id = ${currentUser.companyId}
      AND DATE(created_at) = ${reportDate}::date
  `)
  const loyaltyStats = ((loyaltyResult as any).rows || loyaltyResult)?.[0] || {}

  const newMembersResult = await db.execute(sql`
    SELECT COUNT(*)::int as new_members
    FROM loyalty_members
    WHERE company_id = ${currentUser.companyId}
      AND DATE(created_at) = ${reportDate}::date
  `)
  const newMembers = Number(((newMembersResult as any).rows || newMembersResult)?.[0]?.new_members || 0)

  // ── Build the report ──
  const report = {
    date: reportDate,
    locationId,
    orders: {
      count: Number(orderStats.order_count) || 0,
      totalRevenue: Number(orderStats.total_revenue) || 0,
      revenueByPaymentMethod,
      totalExciseTax: Number(orderStats.total_excise_tax) || 0,
      totalSalesTax: Number(orderStats.total_sales_tax) || 0,
      totalTax: Number(orderStats.total_tax) || 0,
      totalDiscounts: Number(orderStats.total_discounts) || 0,
      refundCount: Number(orderStats.refund_count) || 0,
      refundTotal: Number(orderStats.refund_total) || 0,
      voidCount: Number(orderStats.void_count) || 0,
    },
    cash: {
      openingBalance: cashSession ? Number(cashSession.opening_amount) : null,
      closingAmount: cashSession ? Number(cashSession.closing_amount) : null,
      expectedCash: cashSession ? Number(cashSession.expected_amount) : null,
      variance: cashSession ? Number(cashSession.variance) : null,
      sessionStatus: cashSession?.session_status || null,
    },
    inventory: {
      adjustmentCount: Number(inventoryStats.adjustment_count) || 0,
      shrinkageUnits: Number(inventoryStats.shrinkage_units) || 0,
      shrinkageCount: Number(inventoryStats.shrinkage_count) || 0,
      shrinkageValue,
    },
    compliance: {
      totalCannabisWeightSoldGrams: Number(complianceStats.total_cannabis_weight_sold) || 0,
      purchaseLimitViolations: Number(complianceStats.purchase_limit_violations) || 0,
      idVerifications: Number(complianceStats.id_verifications) || 0,
    },
    staff: {
      employees: staffStats,
      totalEmployees: staffStats.length,
      totalTips,
    },
    loyalty: {
      pointsIssued: Number(loyaltyStats.points_issued) || 0,
      pointsRedeemed: Number(loyaltyStats.points_redeemed) || 0,
      activeMembers: Number(loyaltyStats.active_members) || 0,
      newMembers,
    },
  }

  // Store the report
  const insertResult = await db.execute(sql`
    INSERT INTO eod_reports (id, report_date, location_id, report_data, status,
      generated_by, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${reportDate}::date, ${locationId},
      ${JSON.stringify(report)}::jsonb, 'draft', ${currentUser.userId},
      ${currentUser.companyId}, NOW(), NOW())
    ON CONFLICT (company_id, report_date, location_id) DO UPDATE SET
      report_data = EXCLUDED.report_data,
      status = 'draft',
      generated_by = EXCLUDED.generated_by,
      updated_at = NOW()
    RETURNING *
  `)

  const savedReport = ((insertResult as any).rows || insertResult)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'eod_report',
    entityId: savedReport?.id,
    entityName: `EOD Report ${reportDate}`,
    metadata: { date: reportDate, locationId, orderCount: report.orders.count, revenue: report.orders.totalRevenue },
    req: c.req,
  })

  return c.json({ ...savedReport, report })
})

// ─── GET / ── List EOD reports ───────────────────────────────────────────────

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const locationId = c.req.query('locationId')
  const status = c.req.query('status')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let filters = sql``
  if (startDate) filters = sql`${filters} AND report_date >= ${startDate}::date`
  if (endDate) filters = sql`${filters} AND report_date <= ${endDate}::date`
  if (locationId) filters = sql`${filters} AND location_id = ${locationId}`
  if (status) filters = sql`${filters} AND status = ${status}`

  const [dataResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT id, report_date, location_id, status, generated_by,
             reviewed_by, reviewed_at, submitted_at, created_at, updated_at,
             (report_data->>'orders')::jsonb as orders_summary
      FROM eod_reports
      WHERE company_id = ${currentUser.companyId} ${filters}
      ORDER BY report_date DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int as total
      FROM eod_reports
      WHERE company_id = ${currentUser.companyId} ${filters}
    `),
  ])

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// ─── GET /:id ── Report detail ───────────────────────────────────────────────

app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    SELECT eod.*,
           gu.first_name || ' ' || gu.last_name as generated_by_name,
           ru.first_name || ' ' || ru.last_name as reviewed_by_name
    FROM eod_reports eod
    LEFT JOIN "user" gu ON gu.id = eod.generated_by
    LEFT JOIN "user" ru ON ru.id = eod.reviewed_by
    WHERE eod.id = ${id} AND eod.company_id = ${currentUser.companyId}
    LIMIT 1
  `)

  const report = ((result as any).rows || result)?.[0]
  if (!report) return c.json({ error: 'Report not found' }, 404)

  return c.json(report)
})

// ─── PUT /:id/review ── Mark as reviewed by manager ──────────────────────────

app.put('/:id/review', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE eod_reports
    SET status = 'reviewed', reviewed_by = ${currentUser.userId}, reviewed_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND status = 'draft'
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Report not found or already reviewed' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'eod_report',
    entityId: id,
    entityName: `EOD Report ${updated.report_date}`,
    changes: { status: { old: 'draft', new: 'reviewed' } },
    req: c.req,
  })

  return c.json(updated)
})

// ─── PUT /:id/submit ── Mark as submitted (final) ───────────────────────────

app.put('/:id/submit', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE eod_reports
    SET status = 'submitted', submitted_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND status IN ('draft', 'reviewed')
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Report not found or already submitted' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'eod_report',
    entityId: id,
    entityName: `EOD Report ${updated.report_date}`,
    changes: { status: { old: updated.status, new: 'submitted' } },
    req: c.req,
  })

  return c.json(updated)
})

// ─── GET /checklist ── Default compliance checklist items ────────────────────

app.get('/checklist', async (c) => {
  return c.json({
    items: [
      'Cash drawer counted',
      'Safe deposit verified',
      'Metrc daily report reviewed',
      'Waste log updated',
      'Delivery manifests filed',
      'ID scanner cleaned',
      'Kiosk reset',
      'Floor swept and mopped',
    ],
  })
})

// ─── PUT /:id/checklist ── Update checklist items ────────────────────────────

const checklistSchema = z.object({
  checklist: z.array(z.object({
    item: z.string().min(1),
    checked: z.boolean(),
    checkedBy: z.string().optional(),
    checkedAt: z.string().optional(),
  })),
})

app.put('/:id/checklist', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  let data: z.infer<typeof checklistSchema>
  try {
    data = checklistSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const result = await db.execute(sql`
    UPDATE eod_reports
    SET checklist = ${JSON.stringify(data.checklist)}::jsonb, updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Report not found' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'eod_report',
    entityId: id,
    entityName: `EOD Checklist`,
    metadata: { checkedCount: data.checklist.filter(i => i.checked).length, totalCount: data.checklist.length },
    req: c.req,
  })

  return c.json(updated)
})

export default app

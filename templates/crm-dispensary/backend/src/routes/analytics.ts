import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'

const app = new Hono()
app.use('*', authenticate)

// All analytics endpoints require manager+
app.use('*', requireRole('manager'))

// Sales by period
app.get('/sales', async (c) => {
  const currentUser = c.get('user') as any
  const period = c.req.query('period') || 'day' // day, week, month
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')

  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86400000)
  const end = endDate ? new Date(endDate) : new Date()

  let dateTrunc: string
  switch (period) {
    case 'week': dateTrunc = 'week'; break
    case 'month': dateTrunc = 'month'; break
    default: dateTrunc = 'day'
  }

  const result = await db.execute(sql`
    SELECT
      date_trunc(${dateTrunc}, completed_at)::date as period,
      COUNT(*)::int as order_count,
      COALESCE(SUM(total::numeric), 0) as revenue,
      COALESCE(SUM(subtotal::numeric), 0) as subtotal,
      COALESCE(SUM(total_tax::numeric), 0) as tax_collected,
      COALESCE(SUM(discount_amount::numeric), 0) as discounts_given,
      COALESCE(AVG(total::numeric), 0) as avg_order_value
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND status = 'completed'
      AND completed_at >= ${start}
      AND completed_at <= ${end}
    GROUP BY 1
    ORDER BY 1 ASC
  `)

  const data = (result as any).rows || result

  // Totals
  const totals = data.reduce((acc: any, row: any) => ({
    revenue: acc.revenue + Number(row.revenue),
    orderCount: acc.orderCount + Number(row.order_count),
    taxCollected: acc.taxCollected + Number(row.tax_collected),
    discountsGiven: acc.discountsGiven + Number(row.discounts_given),
  }), { revenue: 0, orderCount: 0, taxCollected: 0, discountsGiven: 0 })

  totals.avgOrderValue = totals.orderCount > 0 ? totals.revenue / totals.orderCount : 0

  return c.json({ data, totals, period, startDate: start, endDate: end })
})

// Product performance
app.get('/products', async (c) => {
  const currentUser = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const limit = +(c.req.query('limit') || '20')

  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86400000)
  const end = endDate ? new Date(endDate) : new Date()

  const result = await db.execute(sql`
    SELECT
      oi.product_id,
      oi.product_name,
      oi.category,
      SUM(oi.quantity)::int as total_sold,
      COALESCE(SUM(oi.line_total::numeric), 0) as total_revenue,
      COUNT(DISTINCT oi.order_id)::int as order_count,
      COALESCE(AVG(oi.unit_price::numeric), 0) as avg_price
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.company_id = ${currentUser.companyId}
      AND o.status = 'completed'
      AND o.completed_at >= ${start}
      AND o.completed_at <= ${end}
    GROUP BY oi.product_id, oi.product_name, oi.category
    ORDER BY total_revenue DESC
    LIMIT ${limit}
  `)

  return c.json((result as any).rows || result)
})

// Daily summary
app.get('/summary', async (c) => {
  const currentUser = c.get('user') as any
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10)

  const dayStart = new Date(date + 'T00:00:00')
  const dayEnd = new Date(date + 'T23:59:59')

  const [ordersResult, categoryResult, paymentResult, loyaltyResult] = await Promise.all([
    // Order totals
    db.execute(sql`
      SELECT
        COUNT(*)::int as total_orders,
        COUNT(CASE WHEN status = 'completed' THEN 1 END)::int as completed_orders,
        COUNT(CASE WHEN status = 'refunded' THEN 1 END)::int as refunded_orders,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN total::numeric ELSE 0 END), 0) as revenue,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN total_tax::numeric ELSE 0 END), 0) as tax_collected,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN discount_amount::numeric ELSE 0 END), 0) as discounts,
        COALESCE(AVG(CASE WHEN status = 'completed' THEN total::numeric END), 0) as avg_order_value,
        COUNT(CASE WHEN type = 'walk_in' THEN 1 END)::int as walk_in_count,
        COUNT(CASE WHEN type = 'delivery' THEN 1 END)::int as delivery_count,
        COUNT(CASE WHEN type = 'online' THEN 1 END)::int as online_count,
        COUNT(CASE WHEN is_medical = true THEN 1 END)::int as medical_count
      FROM orders
      WHERE company_id = ${currentUser.companyId}
        AND created_at >= ${dayStart}
        AND created_at <= ${dayEnd}
    `),
    // Sales by category
    db.execute(sql`
      SELECT oi.category, SUM(oi.quantity)::int as units_sold, COALESCE(SUM(oi.line_total::numeric), 0) as revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.company_id = ${currentUser.companyId}
        AND o.status = 'completed'
        AND o.created_at >= ${dayStart}
        AND o.created_at <= ${dayEnd}
      GROUP BY oi.category
      ORDER BY revenue DESC
    `),
    // Payment method breakdown
    db.execute(sql`
      SELECT payment_method, COUNT(*)::int as count, COALESCE(SUM(total::numeric), 0) as total
      FROM orders
      WHERE company_id = ${currentUser.companyId}
        AND status = 'completed'
        AND created_at >= ${dayStart}
        AND created_at <= ${dayEnd}
      GROUP BY payment_method
    `),
    // Loyalty activity
    db.execute(sql`
      SELECT
        COUNT(CASE WHEN type = 'earn' THEN 1 END)::int as earn_count,
        COALESCE(SUM(CASE WHEN type = 'earn' THEN points ELSE 0 END), 0) as points_earned,
        COUNT(CASE WHEN type LIKE 'adjustment%' THEN 1 END)::int as adjustment_count
      FROM loyalty_transactions
      WHERE company_id = ${currentUser.companyId}
        AND created_at >= ${dayStart}
        AND created_at <= ${dayEnd}
    `),
  ])

  return c.json({
    date,
    orders: ((ordersResult as any).rows || ordersResult)?.[0] || {},
    salesByCategory: (categoryResult as any).rows || categoryResult,
    paymentMethods: (paymentResult as any).rows || paymentResult,
    loyalty: ((loyaltyResult as any).rows || loyaltyResult)?.[0] || {},
  })
})

// Peak hours analysis
app.get('/peak-hours', async (c) => {
  const currentUser = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')

  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86400000)
  const end = endDate ? new Date(endDate) : new Date()

  const result = await db.execute(sql`
    SELECT
      EXTRACT(HOUR FROM created_at)::int as hour,
      COUNT(*)::int as order_count,
      COALESCE(SUM(total::numeric), 0) as revenue,
      COALESCE(AVG(total::numeric), 0) as avg_order_value
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND status = 'completed'
      AND created_at >= ${start}
      AND created_at <= ${end}
    GROUP BY 1
    ORDER BY 1 ASC
  `)

  const data = (result as any).rows || result

  // Find peak hour
  const peak = data.reduce((max: any, row: any) =>
    Number(row.order_count) > Number(max?.order_count || 0) ? row : max
  , null)

  return c.json({ data, peakHour: peak?.hour ?? null, startDate: start, endDate: end })
})

export default app

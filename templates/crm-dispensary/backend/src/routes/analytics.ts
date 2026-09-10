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

  // endDate must cover the WHOLE day. Parsing it as bare midnight made `completed_at <= end`
  // exclude every sale after 00:00 today, so a "Today" chart came back empty and the last day
  // of any range dropped its daytime orders. Match /summary's full-day bounds. (retest#8)
  const start = startDate ? new Date(startDate + 'T00:00:00') : new Date(Date.now() - 30 * 86400000)
  const end = endDate ? new Date(endDate + 'T23:59:59.999') : new Date()

  let dateTrunc: string
  switch (period) {
    case 'week': dateTrunc = 'week'; break
    case 'month': dateTrunc = 'month'; break
    default: dateTrunc = 'day'
  }

  // Bucket/filter by COALESCE(completed_at, created_at): some completed orders have a NULL
  // completed_at (status-flow / seeded completions), so filtering on completed_at dropped a
  // whole day (e.g. 09-01) from the chart while /summary — which keys off created_at — still
  // counted it. The chart lost $182 the KPI showed. Fall back to created_at. (retest#10)
  const result = await db.execute(sql`
    SELECT
      date_trunc(${dateTrunc}, COALESCE(completed_at, created_at))::date as period,
      COUNT(*)::int as order_count,
      -- Revenue and AOV share the same NET basis (total − refunded) so AOV × orders = revenue. (retest: AOV vs revenue)
      COALESCE(SUM(total::numeric - COALESCE(NULLIF(refunded_amount, '')::numeric, 0)), 0) as revenue,
      COALESCE(SUM(subtotal::numeric), 0) as subtotal,
      COALESCE(SUM(total_tax::numeric), 0) as tax_collected,
      COALESCE(SUM(discount_amount::numeric), 0) as discounts_given,
      COALESCE(AVG(total::numeric - COALESCE(NULLIF(refunded_amount, '')::numeric, 0)), 0) as avg_order_value
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND status IN ('completed', 'partially_refunded')
      AND COALESCE(completed_at, created_at) >= ${start}
      AND COALESCE(completed_at, created_at) <= ${end}
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

  // endDate must cover the WHOLE day. Parsing it as bare midnight made `completed_at <= end`
  // exclude every sale after 00:00 today, so a "Today" chart came back empty and the last day
  // of any range dropped its daytime orders. Match /summary's full-day bounds. (retest#8)
  const start = startDate ? new Date(startDate + 'T00:00:00') : new Date(Date.now() - 30 * 86400000)
  const end = endDate ? new Date(endDate + 'T23:59:59.999') : new Date()

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
      AND COALESCE(o.completed_at, o.created_at) >= ${start}
      AND COALESCE(o.completed_at, o.created_at) <= ${end}
    GROUP BY oi.product_id, oi.product_name, oi.category
    ORDER BY total_revenue DESC
    LIMIT ${limit}
  `)

  return c.json((result as any).rows || result)
})

// Daily summary
app.get('/summary', async (c) => {
  const currentUser = c.get('user') as any
  // Range-aware: the KPI row must reflect the selected period, not always a single day.
  // Previously this only accepted `date`, and the client always sent date=today, so the KPIs
  // were byte-identical across Today/7/30/90. Honor startDate/endDate when present; fall back
  // to a single `date` for back-compat. (retest#9)
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10)

  const dayStart = new Date((startDate || date) + 'T00:00:00')
  const dayEnd = new Date((endDate || date) + 'T23:59:59.999')

  const [ordersResult, categoryResult, paymentResult, loyaltyResult] = await Promise.all([
    // Order totals
    db.execute(sql`
      SELECT
        COUNT(*)::int as total_orders,
        COUNT(CASE WHEN status IN ('completed', 'partially_refunded') THEN 1 END)::int as completed_orders,
        COUNT(CASE WHEN status = 'refunded' THEN 1 END)::int as refunded_orders,
        -- Revenue is NET of refunds: a partially-refunded sale counts what the customer kept,
        -- a fully-refunded one counts $0 (go-live QA V-3).
        COALESCE(SUM(CASE WHEN status IN ('completed', 'partially_refunded') THEN total::numeric - COALESCE(NULLIF(refunded_amount, '')::numeric, 0) ELSE 0 END), 0) as revenue,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN total_tax::numeric ELSE 0 END), 0) as tax_collected,
        COALESCE(SUM(CASE WHEN status IN ('completed', 'partially_refunded') THEN discount_amount::numeric ELSE 0 END), 0) as discounts,
        -- AOV on the same NET basis as revenue (AOV × completed orders = revenue). (retest: AOV vs revenue)
        COALESCE(AVG(CASE WHEN status IN ('completed', 'partially_refunded') THEN total::numeric - COALESCE(NULLIF(refunded_amount, '')::numeric, 0) END), 0) as avg_order_value,
        COALESCE(SUM(CASE WHEN status IN ('refunded', 'partially_refunded') THEN COALESCE(NULLIF(refunded_amount, '')::numeric, total::numeric) ELSE 0 END), 0) as refunds_total,
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

  // endDate must cover the WHOLE day. Parsing it as bare midnight made `completed_at <= end`
  // exclude every sale after 00:00 today, so a "Today" chart came back empty and the last day
  // of any range dropped its daytime orders. Match /summary's full-day bounds. (retest#8)
  const start = startDate ? new Date(startDate + 'T00:00:00') : new Date(Date.now() - 30 * 86400000)
  const end = endDate ? new Date(endDate + 'T23:59:59.999') : new Date()

  const result = await db.execute(sql`
    SELECT
      EXTRACT(HOUR FROM created_at)::int as hour,
      COUNT(*)::int as order_count,
      COALESCE(SUM(total::numeric - COALESCE(NULLIF(refunded_amount, '')::numeric, 0)), 0) as revenue,
      COALESCE(AVG(total::numeric - COALESCE(NULLIF(refunded_amount, '')::numeric, 0)), 0) as avg_order_value
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND status IN ('completed', 'partially_refunded')
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

// Customer insights
app.get('/customers', async (c) => {
  const currentUser = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')

  // Match /summary + /sales full-day bounds so the panel lines up with the KPI row and charts.
  const start = startDate ? new Date(startDate + 'T00:00:00') : new Date(Date.now() - 30 * 86400000)
  const end = endDate ? new Date(endDate + 'T23:59:59.999') : new Date()

  const [rangeResult, newResult, ltvResult] = await Promise.all([
    // In-range cohort: unique/returning customers, avg visits, retention.
    // Bucket by COALESCE(completed_at, created_at) like the other analytics fixes so completed
    // orders with a NULL completed_at still fall inside the window.
    db.execute(sql`
      WITH range_orders AS (
        SELECT contact_id
        FROM orders
        WHERE company_id = ${currentUser.companyId}
          AND status = 'completed'
          AND contact_id IS NOT NULL
          AND COALESCE(completed_at, created_at) >= ${start}
          AND COALESCE(completed_at, created_at) <= ${end}
      ),
      per_customer AS (
        SELECT contact_id, COUNT(*)::int AS order_count
        FROM range_orders
        GROUP BY contact_id
      ),
      first_ever AS (
        SELECT contact_id, MIN(COALESCE(completed_at, created_at)) AS first_at
        FROM orders
        WHERE company_id = ${currentUser.companyId}
          AND status = 'completed'
          AND contact_id IS NOT NULL
        GROUP BY contact_id
      )
      -- new + returning must equal unique (go-live QA M-8): a RETURNING customer is one who
      -- bought in the range AND had bought before the range started; everyone else in the
      -- range is NEW. The old "order_count > 1" definition counted a first-time customer who
      -- came back twice inside the window as both new and returning.
      SELECT
        COUNT(*)::int AS unique_customers,
        COUNT(CASE WHEN fe.first_at < ${start} THEN 1 END)::int AS returning_customers,
        COALESCE(AVG(pc.order_count), 0) AS avg_visits
      FROM per_customer pc
      LEFT JOIN first_ever fe ON fe.contact_id = pc.contact_id
    `),
    // New customers: contacts whose FIRST-EVER completed order (lifetime) lands in the range.
    db.execute(sql`
      WITH first_order AS (
        SELECT contact_id, MIN(COALESCE(completed_at, created_at)) AS first_at
        FROM orders
        WHERE company_id = ${currentUser.companyId}
          AND status = 'completed'
          AND contact_id IS NOT NULL
        GROUP BY contact_id
      )
      SELECT COUNT(*)::int AS new_customers
      FROM first_order
      WHERE first_at >= ${start} AND first_at <= ${end}
    `),
    // Customer Lifetime Value: all-time average completed spend per customer.
    db.execute(sql`
      WITH per_customer AS (
        SELECT contact_id, SUM(total::numeric) AS spend
        FROM orders
        WHERE company_id = ${currentUser.companyId}
          AND status = 'completed'
          AND contact_id IS NOT NULL
        GROUP BY contact_id
      )
      SELECT COALESCE(AVG(spend), 0) AS lifetime_value
      FROM per_customer
    `),
  ])

  const range = ((rangeResult as any).rows || rangeResult)?.[0] || {}
  const newRow = ((newResult as any).rows || newResult)?.[0] || {}
  const ltvRow = ((ltvResult as any).rows || ltvResult)?.[0] || {}

  const uniqueCustomers = Number(range.unique_customers || 0)
  const returningCustomers = Number(range.returning_customers || 0)
  const retentionRate = uniqueCustomers > 0 ? (returningCustomers / uniqueCustomers) * 100 : 0

  return c.json({
    uniqueCustomers,
    // Derived so the three always reconcile: new = unique − returning (M-8).
    newCustomers: Math.max(0, uniqueCustomers - returningCustomers),
    newCustomersLifetimeFirstOrder: Number(newRow.new_customers || 0),
    returningCustomers,
    retentionRate,
    avgVisits: Number(range.avg_visits || 0),
    lifetimeValue: Number(ltvRow.lifetime_value || 0),
  })
})

export default app

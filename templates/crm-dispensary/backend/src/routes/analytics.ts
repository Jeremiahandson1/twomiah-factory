import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'
import { sql, eq } from 'drizzle-orm'
import { settledSale, taxCollected, netExprBare, refundedExprBare } from '../utils/revenue.ts'
import { storeTimeZone, storeDayRange, storeDateString } from '../utils/isoTime.ts'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'

const app = new Hono()
app.use('*', authenticate)

// All analytics endpoints require manager+
app.use('*', requireRole('manager'))

/** The store's zone — from its configured timezone, else its state. */
const tzFor = async (companyId: string): Promise<string> => {
  const [row] = await db.select({ settings: company.settings, state: company.state })
    .from(company).where(eq(company.id, companyId)).limit(1)
  return storeTimeZone(row)
}

/**
 * The half-open UTC range [start, end) covering the requested dates on the STORE's clock.
 *
 * Every range on this page used to be built like this:
 *
 *     const start = new Date(startDate + 'T00:00:00')
 *     const end   = new Date(endDate   + 'T23:59:59.999')
 *
 * A bare datetime with no `Z` is parsed in the SERVER's zone, and Render runs UTC — so the analytics
 * page answered for the UTC day while the dashboard tile, the compliance report and the end-of-day
 * cash sheet beside it had all been moved onto the store's day (T24 N1). An Ohio shop's trade after
 * 8pm therefore sat on Saturday on one screen and Sunday on the next, and the two revenue figures
 * never reconciled: the end-of-day sheet said $150 and analytics said $100 for the same Saturday.
 *
 * Half-open to match the dashboard exactly (`>= start AND < end`). The old inclusive
 * `<= 23:59:59.999` also dropped anything in the final millisecond of the day. (T27 H2)
 */
const storeRange = (tz: string, startDate?: string, endDate?: string, backDays = 30) => {
  const from = startDate || storeDateString(new Date(Date.now() - backDays * 86400000), tz)
  const to = endDate || storeDateString(new Date(), tz)
  return { start: storeDayRange(tz, from).start, end: storeDayRange(tz, to).end, from, to }
}

// Sales by period
app.get('/sales', async (c) => {
  const currentUser = c.get('user') as any
  const period = c.req.query('period') || 'day' // day, week, month
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')

  // The range covers whole STORE days — see storeRange above. (retest#8, T27 H2)
  const dayTz = await tzFor(currentUser.companyId)
  const { start, end } = storeRange(dayTz, startDate, endDate)

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
  // Bucketed on the STORE's clock. date_trunc over a naive UTC timestamp cuts the series at UTC
  // midnight, so an Ohio shop's evening trade after 8pm was charted on the following day — the same
  // fault the peak-hours chart had (T21 M3), one unit larger and costlier, because this one moves money
  // between days rather than between bars. Label it UTC, read it in the store's zone. (T24 N1)
  const result = await db.execute(sql`
    SELECT
      date_trunc(${dateTrunc}, (COALESCE(completed_at, created_at) AT TIME ZONE 'UTC' AT TIME ZONE ${dayTz}))::date as period,
      COUNT(*)::int as order_count,
      -- Revenue and AOV share the same NET basis (total − refunded) so AOV × orders = revenue. (retest: AOV vs revenue)
      COALESCE(SUM(total::numeric - COALESCE(NULLIF(refunded_amount, '')::numeric, 0)), 0) as revenue,
      COALESCE(SUM(subtotal::numeric), 0) as subtotal,
      -- the WHERE above keeps every settled sale for revenue; tax is only the ones not handed back in full
      COALESCE(SUM(CASE WHEN status IN ${taxCollected} THEN total_tax::numeric ELSE 0 END), 0) as tax_collected,
      COALESCE(SUM(discount_amount::numeric), 0) as discounts_given,
      COALESCE(AVG(total::numeric - COALESCE(NULLIF(refunded_amount, '')::numeric, 0)), 0) as avg_order_value
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND status IN ${settledSale}
      AND COALESCE(completed_at, created_at) >= ${start}
      AND COALESCE(completed_at, created_at) < ${end}
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

  // The range covers whole STORE days — see storeRange above. (retest#8, T27 H2)
  const { start, end } = storeRange(await tzFor(currentUser.companyId), startDate, endDate)

  const result = await db.execute(sql`
    -- One row per PRODUCT. An order line keeps a snapshot of the name and category as they were at the time
    -- of sale, so grouping by those split a renamed product in two: Blue Dream appeared twice under the same
    -- product_id, 20 sold / $700 and 8 sold / $280, as if they were different things. Group by the id — the
    -- only thing that identifies a product — and show the name it has NOW, which is what a mix chart is for.
    -- A line with no product_id (an ad-hoc sale) has nothing but its name, so it groups by that. (T21)
    SELECT
      oi.product_id,
      COALESCE(MAX(p.name), MAX(oi.product_name)) as product_name,
      COALESCE(MAX(p.category), MAX(oi.category)) as category,
      SUM(oi.quantity)::int as total_sold,
      COALESCE(SUM(oi.line_total::numeric), 0) as total_revenue,
      COUNT(DISTINCT oi.order_id)::int as order_count,
      COALESCE(AVG(oi.unit_price::numeric), 0) as avg_price
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE o.company_id = ${currentUser.companyId}
      AND o.status IN ${settledSale}
      AND COALESCE(o.completed_at, o.created_at) >= ${start}
      AND COALESCE(o.completed_at, o.created_at) < ${end}
    GROUP BY oi.product_id, CASE WHEN oi.product_id IS NULL THEN oi.product_name END
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
  // "Today" is the STORE's today. toISOString() names the UTC date, so after 8pm in Ohio this asked
  // for TOMORROW — an evening manager opened the page to a day that had barely begun while the
  // dashboard beside it still showed the shift they were working. (T27 H2)
  const tz = await tzFor(currentUser.companyId)
  const date = c.req.query('date') || storeDateString(new Date(), tz)

  const { start: dayStart, end: dayEnd } = storeRange(tz, startDate || date, endDate || date)

  const [ordersResult, categoryResult, paymentResult, loyaltyResult] = await Promise.all([
    // Order totals
    db.execute(sql`
      SELECT
        COUNT(*)::int as total_orders,
        COUNT(CASE WHEN status IN ${settledSale} THEN 1 END)::int as completed_orders,
        COUNT(CASE WHEN status = 'refunded' THEN 1 END)::int as refunded_orders,
        -- Revenue is NET of refunds: a partially-refunded sale counts what the customer kept,
        -- a fully-refunded one counts $0 (go-live QA V-3).
        COALESCE(SUM(CASE WHEN status IN ${settledSale} THEN ${netExprBare} ELSE 0 END), 0) as revenue,
        COALESCE(SUM(CASE WHEN status IN ${taxCollected} THEN total_tax::numeric ELSE 0 END), 0) as tax_collected,
        COALESCE(SUM(CASE WHEN status IN ${settledSale} THEN discount_amount::numeric ELSE 0 END), 0) as discounts,
        -- AOV on the same NET basis as revenue (AOV × completed orders = revenue). (retest: AOV vs revenue)
        COALESCE(AVG(CASE WHEN status IN ${settledSale} THEN ${netExprBare} END), 0) as avg_order_value,
        COALESCE(SUM(CASE WHEN status IN ('refunded', 'partially_refunded') THEN COALESCE(NULLIF(refunded_amount, '')::numeric, total::numeric) ELSE 0 END), 0) as refunds_total,
        COUNT(CASE WHEN type = 'walk_in' THEN 1 END)::int as walk_in_count,
        COUNT(CASE WHEN type = 'delivery' THEN 1 END)::int as delivery_count,
        COUNT(CASE WHEN type = 'online' THEN 1 END)::int as online_count,
        COUNT(CASE WHEN is_medical = true THEN 1 END)::int as medical_count
      FROM orders
      WHERE company_id = ${currentUser.companyId}
        AND created_at >= ${dayStart}
        AND created_at < ${dayEnd}
    `),
    // Sales by category
    db.execute(sql`
      SELECT oi.category, SUM(oi.quantity)::int as units_sold, COALESCE(SUM(oi.line_total::numeric), 0) as revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.company_id = ${currentUser.companyId}
        AND o.status = 'completed'
        AND o.created_at >= ${dayStart}
        AND o.created_at < ${dayEnd}
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
        AND created_at < ${dayEnd}
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
        AND created_at < ${dayEnd}
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

  // Bucketed on the STORE's clock, not the server's. EXTRACT(HOUR FROM created_at) reads UTC, so a
  // 7pm Friday rush was charted in the small hours of Saturday and "peak hour" named a time the shop
  // was shut. created_at is a naive UTC timestamp: label it UTC, then convert to the store's zone.
  // (T21 M3) — and the range is whole STORE days for the same reason. (retest#8, T27 H2)
  const tz = await tzFor(currentUser.companyId)
  const { start, end } = storeRange(tz, startDate, endDate)

  const result = await db.execute(sql`
    SELECT
      EXTRACT(HOUR FROM (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz}))::int as hour,
      COUNT(*)::int as order_count,
      COALESCE(SUM(total::numeric - COALESCE(NULLIF(refunded_amount, '')::numeric, 0)), 0) as revenue,
      COALESCE(AVG(total::numeric - COALESCE(NULLIF(refunded_amount, '')::numeric, 0)), 0) as avg_order_value
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND status IN ${settledSale}
      AND created_at >= ${start}
      AND created_at < ${end}
    GROUP BY 1
    ORDER BY 1 ASC
  `)

  const data = (result as any).rows || result

  // Find peak hour
  const peak = data.reduce((max: any, row: any) =>
    Number(row.order_count) > Number(max?.order_count || 0) ? row : max
  , null)

  // Name the clock, so a chart that reads "7pm" can be trusted to mean 7pm at the shop.
  return c.json({ data, peakHour: peak?.hour ?? null, timeZone: tz, startDate: start, endDate: end })
})

// Customer insights
app.get('/customers', async (c) => {
  const currentUser = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')

  // Match /summary + /sales bounds so the panel lines up with the KPI row and charts — whole STORE
  // days, see storeRange above. (retest#8, T27 H2)
  const { start, end } = storeRange(await tzFor(currentUser.companyId), startDate, endDate)

  const [rangeResult, newResult, ltvResult] = await Promise.all([
    // In-range cohort: unique/returning customers, avg visits, retention.
    // Bucket by COALESCE(completed_at, created_at) like the other analytics fixes so completed
    // orders with a NULL completed_at still fall inside the window.
    db.execute(sql`
      -- Counted over SETTLED sales, not status='completed'. Refunding anything flips the order to
      -- 'refunded'/'partially_refunded', which dropped that customer out of the count entirely: on the
      -- live tenant four people bought today and Unique Customers read 1, because three of their
      -- orders had been refunded. A refunded sale is still a sale that happened and still a customer
      -- who walked in — the same definition revenue settled on in #282/#283. (T21 M12)
      WITH range_orders AS (
        SELECT contact_id
        FROM orders
        WHERE company_id = ${currentUser.companyId}
          AND status IN ${settledSale}
          AND contact_id IS NOT NULL
          AND COALESCE(completed_at, created_at) >= ${start}
          AND COALESCE(completed_at, created_at) < ${end}
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
          AND status IN ${settledSale}
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
          AND status IN ${settledSale}
          AND contact_id IS NOT NULL
        GROUP BY contact_id
      )
      SELECT COUNT(*)::int AS new_customers
      FROM first_order
      WHERE first_at >= ${start} AND first_at < ${end}
    `),
    // Customer Lifetime Value: all-time average completed spend per customer.
    db.execute(sql`
      -- Lifetime value on the one revenue definition too: NET of refunds over every settled sale,
      -- so a refunded order neither inflates a customer's value nor erases them from the average.
      WITH per_customer AS (
        SELECT contact_id, SUM(${netExprBare}) AS spend
        FROM orders
        WHERE company_id = ${currentUser.companyId}
          AND status IN ${settledSale}
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

import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'
import { sql, eq } from 'drizzle-orm'
import { settledSale, taxCollected, netExprBare, refundedExprBare, taxNetExprBare } from '../utils/revenue.ts'
import { storeDayRange, storeDateString, zoneFor, storeRange } from '../utils/isoTime.ts'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'

const app = new Hono()
app.use('*', authenticate)

// All analytics endpoints require manager+
app.use('*', requireRole('manager'))

// `tzFor` and `storeRange` used to be defined right here, privately. They were the only correct
// implementation of the store's day in the whole product, and because they were private, twelve
// other route files built the same bound by hand and every one of them cut it in UTC. Both now live
// in utils/isoTime.ts as zoneFor and storeRange — see the comment on storeRange there, which is the
// one that used to be in this file.

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

// Sales by period
app.get('/sales', async (c) => {
  const currentUser = c.get('user') as any
  const period = c.req.query('period') || 'day' // day, week, month
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')

  // The range covers whole STORE days — see storeRange above. (retest#8, T27 H2)
  const dayTz = await zoneFor(currentUser.companyId)
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
      -- the shared definition, floored per sale: one row refunded beyond its own total used to drag a
      -- whole day negative (-$50 on 13 Sep). utils/revenue.ts. (T29 L3)
      ROUND(COALESCE(SUM(${netExprBare}), 0), 2) as revenue,
      COALESCE(SUM(subtotal::numeric), 0) as subtotal,
      -- the WHERE above keeps every settled sale for revenue; tax is only the ones not handed back in full
      COALESCE(SUM(CASE WHEN status IN ${taxCollected} THEN ${taxNetExprBare} ELSE 0 END), 0) as tax_collected,
      COALESCE(SUM(discount_amount::numeric), 0) as discounts_given,
      ROUND(COALESCE(AVG(${netExprBare}), 0), 2) as avg_order_value
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
  const { start, end } = storeRange(await zoneFor(currentUser.companyId), startDate, endDate)

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
      -- NET of returns. order_items.refunded_quantity records the units that came back, and this counted
      -- the gross: a Shatter returned the same day still read "1 sold" in the mix, so the chart a buyer
      -- restocks from was describing sales that had been undone. Revenue nets on the same basis. (T29 L11)
      --
      -- Clamped PER LINE, not per group. The refund path refuses to book back more units than were
      -- sold, but rows written before that guard can still carry refunded_quantity > quantity — and
      -- with the clamp on the outside, one such line goes negative and eats into every good line
      -- beside it. On the test shop, 32 Shatter lines from 23 Sep (32 sold, 39 returned) dragged the
      -- 7-day mix down to 4 sold / $160 while that day alone was 11 / $440: the chart a buyer
      -- restocks from was hiding real sales behind old bad data. A line that was over-refunded
      -- contributes nothing; it can no longer contribute LESS than nothing. (T43 N5)
      SUM(GREATEST(0, oi.quantity - COALESCE(oi.refunded_quantity, 0)))::int as total_sold,
      ROUND(COALESCE(SUM(GREATEST(0, oi.line_total::numeric - COALESCE(oi.refunded_quantity, 0) * oi.unit_price::numeric)), 0), 2) as total_revenue,
      COUNT(DISTINCT oi.order_id)::int as order_count,
      ROUND(COALESCE(AVG(oi.unit_price::numeric), 0), 2) as avg_price
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
  const tz = await zoneFor(currentUser.companyId)
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
        ROUND(COALESCE(SUM(CASE WHEN status IN ${settledSale} THEN ${netExprBare} ELSE 0 END), 0), 2) as revenue,
        COALESCE(SUM(CASE WHEN status IN ${taxCollected} THEN ${taxNetExprBare} ELSE 0 END), 0) as tax_collected,
        COALESCE(SUM(CASE WHEN status IN ${settledSale} THEN discount_amount::numeric ELSE 0 END), 0) as discounts,
        -- AOV on the same NET basis as revenue (AOV × completed orders = revenue). (retest: AOV vs revenue)
        ROUND(COALESCE(AVG(CASE WHEN status IN ${settledSale} THEN ${netExprBare} END), 0), 2) as avg_order_value,
        COALESCE(SUM(CASE WHEN status IN ('refunded', 'partially_refunded') THEN COALESCE(NULLIF(refunded_amount, '')::numeric, total::numeric) ELSE 0 END), 0) as refunds_total,
        -- The mix counts SALES, so it counts the same row set the revenue above it does.
        --
        -- These four counted every order in the window, cancelled ones included, while compliance
        -- counts settled sales only — so the two screens disagreed about the same day: analytics
        -- said 12 medical, compliance said 4, and compliance was right. A cancelled ticket is not a
        -- sale, and a regulator's report and the owner's dashboard must not be able to differ about
        -- how many medical sales a shop made. (T43 N4)
        COUNT(CASE WHEN status IN ${settledSale} AND type = 'walk_in' THEN 1 END)::int as walk_in_count,
        COUNT(CASE WHEN status IN ${settledSale} AND type = 'delivery' THEN 1 END)::int as delivery_count,
        COUNT(CASE WHEN status IN ${settledSale} AND (source = 'online' OR type = 'online') THEN 1 END)::int as online_count,
        -- Ordered online and not collected yet.
        --
        -- T48 Q9 reported online_count stuck at 0 after placing an order-ahead order. The count was
        -- right: an order-ahead order is created 'pending', and this mix counts SALES so that the
        -- owner's dashboard and the compliance report cannot disagree about the same day (T43 N4).
        -- An order awaiting collection has not been sold yet.
        --
        -- Being right is not the same as being useful. "Online: 0" beside a list of online orders
        -- reads as broken, and it has now been filed twice — T46 N21 and again here. So the panel
        -- answers the question that keeps getting asked, instead of inviting it a third time: the
        -- sales figure stays a sales figure, and the orders in the queue are reported next to it as
        -- what they are.
        COUNT(CASE WHEN status NOT IN ('completed', 'partially_refunded', 'refunded', 'cancelled')
                    AND (source = 'online' OR type = 'online') THEN 1 END)::int as online_awaiting_count,
        COUNT(CASE WHEN status IN ${settledSale} AND is_medical = true THEN 1 END)::int as medical_count
      FROM orders
      WHERE company_id = ${currentUser.companyId}
        AND created_at >= ${dayStart}
        AND created_at < ${dayEnd}
    `),
    // Sales by category
    db.execute(sql`
      -- units and revenue NET of returns, like the product mix above (T29 L11)
      --
      -- Over the SETTLED row set, not 'completed' alone. The headline revenue beside this counts
      -- completed + partially refunded net of refunds, so filtering here to completed dropped every
      -- partly-refunded sale out of the breakdown while leaving it in the total: 30 days read
      -- $9,039.75 with categories adding to $5,633. A panel that does not add up to the figure above
      -- it is worse than no panel. (T42 H2)
      --
      -- A line whose product was deleted has no category; it showed as a "null" row worth $700.
      -- A refund entered as an AMOUNT returns money against no particular line, so it books back no
      -- units and this breakdown never saw it: ORD-1374 took $10 back and flower still read $240
      -- where the item arithmetic gives $232. Netting only unit-returns meant the panel was right
      -- for one kind of refund and wrong for the other. (T43 H2b)
      --
      -- The merchandise part of an amount refund (the money less its tax share, which the order row
      -- already tracks as refunded_tax) is spread across that order's lines in proportion to what is
      -- still outstanding on each. There is nothing more specific to go on — that is what "by amount"
      -- means — and it is the same reasoning refunds.ts uses to split an amount refund's tax.
      WITH line_net AS (
        SELECT oi.order_id,
               COALESCE(NULLIF(oi.category, ''), 'uncategorised') AS category,
               GREATEST(0, oi.quantity - COALESCE(oi.refunded_quantity, 0)) AS units_left,
               GREATEST(0, oi.line_total::numeric - COALESCE(oi.refunded_quantity, 0) * oi.unit_price::numeric) AS value_left,
               COALESCE(oi.refunded_quantity, 0) * oi.unit_price::numeric AS value_returned
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.company_id = ${currentUser.companyId}
          AND o.status IN ${settledSale}
          AND o.created_at >= ${dayStart}
          AND o.created_at < ${dayEnd}
      ),
      order_totals AS (
        SELECT ln.order_id,
               SUM(ln.value_left) AS value_left_total,
               -- What the amount refunds gave back in MERCHANDISE that no line has accounted for.
               GREATEST(0,
                 GREATEST(0, COALESCE(NULLIF(o.refunded_amount, '')::numeric, 0) - COALESCE(NULLIF(o.refunded_tax, '')::numeric, 0))
                 - SUM(ln.value_returned)
               ) AS unallocated
        FROM line_net ln
        JOIN orders o ON o.id = ln.order_id
        GROUP BY ln.order_id, o.refunded_amount, o.refunded_tax
      )
      SELECT ln.category as category,
             -- Units are untouched by an amount refund: no goods came back, so none are added back
             -- to stock and none are taken out of the count. Only the money moved. (T43 N5 per-line)
             SUM(ln.units_left)::int as units_sold,
             -- Rounded to cents. Postgres hands a numeric division back at full scale, so this
             -- came out as "617.00000000000000000000" and the screen rendered it verbatim.
             -- Money is two decimal places everywhere else in this product. (T45 L11)
             ROUND(COALESCE(SUM(GREATEST(0, ln.value_left - CASE WHEN ot.value_left_total > 0
               THEN ot.unallocated * (ln.value_left / ot.value_left_total) ELSE 0 END)), 0), 2) as revenue
      FROM line_net ln
      JOIN order_totals ot ON ot.order_id = ln.order_id
      GROUP BY ln.category
      ORDER BY revenue DESC
    `),
    // Payment method breakdown
    db.execute(sql`
      -- Settled row set and the NET measure, the same two the headline uses. This counted completed
      -- orders at GROSS, so it disagreed with the revenue above it twice over: a $87.50 debit sale
      -- with $43.75 handed back vanished entirely rather than showing $43.75, and 30 days of methods
      -- summed to $6,816.25 against a stated $9,039.75. (T42 H2)
      SELECT COALESCE(NULLIF(payment_method, ''), 'unrecorded') as payment_method,
             COUNT(*)::int as count,
             ROUND(COALESCE(SUM(${netExprBare}), 0), 2) as total
      FROM orders
      WHERE company_id = ${currentUser.companyId}
        AND status IN ${settledSale}
        AND created_at >= ${dayStart}
        AND created_at < ${dayEnd}
      GROUP BY COALESCE(NULLIF(payment_method, ''), 'unrecorded')
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
  const tz = await zoneFor(currentUser.companyId)
  const { start, end } = storeRange(tz, startDate, endDate)

  const result = await db.execute(sql`
    SELECT
      EXTRACT(HOUR FROM (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tz}))::int as hour,
      COUNT(*)::int as order_count,
      ROUND(COALESCE(SUM(total::numeric - COALESCE(NULLIF(refunded_amount, '')::numeric, 0)), 0), 2) as revenue,
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
  const { start, end, from, to } = storeRange(await zoneFor(currentUser.companyId), startDate, endDate)

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
      --
      -- REPEAT is a different question from RETURNING and the two must not be merged. Returning is a
      -- cohort split — did this person shop here before the window opened — and it has to reconcile
      -- with new (M-8). Repeat is "came back inside the window", which is what retention means to a
      -- shop owner and what the rate is built from below. T42 M4 asked for repeat and called it
      -- returning; answering that literally would have put a first-time customer with two visits in
      -- both buckets and broken the reconciliation M-8 was raised to fix.
      SELECT
        COUNT(*)::int AS unique_customers,
        COUNT(CASE WHEN fe.first_at < ${start} THEN 1 END)::int AS returning_customers,
        COUNT(CASE WHEN pc.order_count > 1 THEN 1 END)::int AS repeat_customers,
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
  const repeatCustomers = Number(range.repeat_customers || 0)
  // Retention is the repeat-purchase rate — how many of this window's customers came back inside it
  // — which is the industry definition and the one a shop owner reads off the tile. Deriving it from
  // the returning COHORT instead reported 0.0% on a window where six customers averaged 4.67 visits
  // each, because none of them had shopped before the window opened. Both numbers were true; only
  // one of them answers "are people coming back". (T42 M4)
  const retentionRate = uniqueCustomers > 0 ? (repeatCustomers / uniqueCustomers) * 100 : 0

  return c.json({
    uniqueCustomers,
    // Derived so the three always reconcile: new = unique − returning (M-8).
    newCustomers: Math.max(0, uniqueCustomers - returningCustomers),
    newCustomersLifetimeFirstOrder: Number(newRow.new_customers || 0),
    returningCustomers,
    repeatCustomers,
    retentionRate,
    avgVisits: Number(range.avg_visits || 0),
    lifetimeValue: Number(ltvRow.lifetime_value || 0),
    // The window these numbers were counted over, in the STORE's calendar. Omitting the dates means
    // the last 30 days, which nothing said: a tester read 4 customers / 4.75 visits off this endpoint
    // and 2 / 7.5 off the Analytics page, called it a disagreement, and both were right — the page had
    // asked for 7 days. Two figures cannot be compared until you can see what each one covers. (T31 L2)
    range: { from, to },
  })
})

export default app

import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { product, contact, company } from '../../db/schema.ts'
import { eq, and, gte, lt, lte, count, desc, sql } from 'drizzle-orm'
import { settledSale, taxCollected, netExprBare, refundedExprBare, taxNetExprBare } from '../utils/revenue.ts'
import { authenticate } from '../middleware/auth.ts'
import { storeTimeZone, storeDayRange, storeDateString } from '../utils/isoTime.ts'

const app = new Hono()
app.use('*', authenticate)

// Same converter the other routes in this template carry (kiosk.ts, cash.ts, compliance.ts and a dozen
// more each declare their own copy — worth pulling into utils/ as its own change, not inside a fix).
const camel = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}
const rowsOf = (result: any): any[] => ((result as any)?.rows || result || []) as any[]

app.get('/stats', async (c) => {
  const user = c.get('user') as any
  const companyId = user.companyId
  // "Today" is the STORE's day, not the server's. Render runs UTC, so setHours(0,0,0,0) put the tile's
  // window on UTC midnight: an Ohio shop's Today tile reset at 8pm, mid-shift, and the last four hours
  // of Saturday's trade showed up under Sunday. Every US zone loses the tail of the evening this way —
  // two hours for Central, three for Mountain, four for Pacific. (T24 N1)
  const [coRow] = await db.select({ settings: company.settings, state: company.state })
    .from(company).where(eq(company.id, companyId)).limit(1)
  const tz = storeTimeZone(coRow)
  const { start: today, end: tomorrow } = storeDayRange(tz)
  const thirtyDaysAgo = storeDayRange(tz, storeDateString(new Date(today.getTime() - 29 * 86400000), tz)).start

  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn() } catch { return fallback }
  }

  const [
    contactCount,
    todayOrdersResult,
    monthRevenueResult,
    lowStockResult,
    openSessionsResult,
    loyaltyMembersResult,
    todayDeliveriesResult,
    topProductsResult,
  ] = await Promise.all([
    // Total contacts/customers
    safe(() => db.select({ value: count() }).from(contact).where(eq(contact.companyId, companyId)), [{ value: 0 }]),

    // Today's orders
    safe(() => db.execute(sql`
      SELECT
        COUNT(*)::int as total_orders,
        -- Counted over the SAME row set as the revenue below it, or the tile contradicts itself: 26 sales
        -- sitting under a revenue figure that came from 33 of them, and an average order value that divides
        -- one by the other. A refunded sale still happened. (T23 H1)
        COUNT(CASE WHEN status IN ${settledSale} THEN 1 END)::int as completed,
        COUNT(CASE WHEN status = 'pending' OR status = 'processing' OR status = 'ready' THEN 1 END)::int as pending,
        -- Revenue is what the business KEPT, over every settled sale — not the gross of the ones that happen
        -- not to have been refunded. This tile, Analytics and the compliance report each used to answer this
        -- differently on the same day ($2,395 / $2,825 / $3,395). See utils/revenue.ts. (T21 H8)
        COALESCE(SUM(CASE WHEN status IN ${settledSale} THEN ${netExprBare} ELSE 0 END), 0) as revenue,
        COALESCE(SUM(CASE WHEN status IN ${settledSale} THEN ${refundedExprBare} ELSE 0 END), 0) as refunded,
        COALESCE(SUM(CASE WHEN status IN ${taxCollected} THEN ${taxNetExprBare} ELSE 0 END), 0) as tax_collected,
        COALESCE(AVG(CASE WHEN status IN ${settledSale} THEN ${netExprBare} END), 0) as avg_order_value,
        COUNT(CASE WHEN is_medical = true AND status IN ${settledSale} THEN 1 END)::int as medical_orders
      FROM orders
      WHERE company_id = ${companyId}
        AND created_at >= ${today}
        AND created_at < ${tomorrow}
    `), { rows: [{}] }),

    // 30-day revenue
    safe(() => db.execute(sql`
      SELECT
        COALESCE(SUM(${netExprBare}), 0) as revenue,
        COUNT(*)::int as order_count
      FROM orders
      WHERE company_id = ${companyId}
        AND status IN ${settledSale}
        AND completed_at >= ${thirtyDaysAgo}
    `), { rows: [{ revenue: 0, order_count: 0 }] }),

    // Low stock alerts
    safe(() => db.execute(sql`
      SELECT id, name, sku, category, stock_quantity, low_stock_threshold
      FROM products
      WHERE company_id = ${companyId}
        AND active = true
        AND track_inventory = true
        AND stock_quantity <= low_stock_threshold
      ORDER BY stock_quantity ASC
      LIMIT 10
    `), { rows: [] } as any),

    // Open cash sessions
    safe(() => db.execute(sql`
      SELECT cs.id, cs.register, cs.opening_amount, cs.opened_at,
             u.first_name || ' ' || u.last_name as opened_by
      FROM cash_sessions cs
      LEFT JOIN "user" u ON u.id = cs.opened_by_id
      WHERE cs.company_id = ${companyId} AND cs.status = 'open'
    `), { rows: [] }),

    // Loyalty member count
    safe(() => db.execute(sql`
      SELECT COUNT(*)::int as total FROM loyalty_members WHERE company_id = ${companyId}
    `), { rows: [{ total: 0 }] }),

    // Today's delivery orders
    safe(() => db.execute(sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(CASE WHEN delivery_status = 'pending' THEN 1 END)::int as pending,
        COUNT(CASE WHEN delivery_status = 'en_route' THEN 1 END)::int as en_route,
        COUNT(CASE WHEN delivery_status = 'delivered' THEN 1 END)::int as delivered
      FROM orders
      WHERE company_id = ${companyId}
        AND type = 'delivery'
        AND created_at >= ${today}
        AND created_at < ${tomorrow}
    `), { rows: [{}] }),
    // Top sellers today. The panel has existed since the dashboard shipped and nothing ever fed it —
    // topProducts was useState([]) and never set — so it read "No sales data yet" under 22 completed
    // sales. Counted over the SAME settled row set and the same store day as the tiles beside it, so
    // it cannot contradict them. (Dispensary T29 M8)
    safe(() => db.execute(sql`
      SELECT oi.product_id as id, oi.product_name as name, oi.category,
             SUM(oi.quantity)::int as units_sold,
             COALESCE(SUM(NULLIF(oi.line_total, '')::numeric), 0) as revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.company_id = ${companyId}
        AND o.status IN ${settledSale}
        AND o.completed_at >= ${today}
        AND o.completed_at < ${tomorrow}
      GROUP BY oi.product_id, oi.product_name, oi.category
      ORDER BY units_sold DESC
      LIMIT 5
    `), { rows: [] }),
  ])

  const todayOrders = ((todayOrdersResult as any).rows || todayOrdersResult)?.[0] || {}
  const monthRevenue = ((monthRevenueResult as any).rows || monthRevenueResult)?.[0] || {}
  const lowStockItems = (lowStockResult as any).rows || lowStockResult || []
  const openSessions = (openSessionsResult as any).rows || openSessionsResult || []
  const loyaltyMembers = ((loyaltyMembersResult as any).rows || loyaltyMembersResult)?.[0]?.total || 0
  const todayDeliveries = ((todayDeliveriesResult as any).rows || todayDeliveriesResult)?.[0] || {}
  const topProducts = (((topProductsResult as any).rows || topProductsResult) || []).map((r: any) => ({ id: r.id, name: r.name, category: r.category, unitsSold: Number(r.units_sold || 0), revenue: Number(r.revenue || 0) }))

  return c.json({
    customers: contactCount[0]?.value ?? 0,
    today: {
      revenue: Number(todayOrders.revenue || 0),
      /** What went back, beside what was kept — reported, never applied by omission. (T21 H8) */
      refunded: Number(todayOrders.refunded || 0),
      orderCount: Number(todayOrders.total_orders || 0),
      completedOrders: Number(todayOrders.completed || 0),
      pendingOrders: Number(todayOrders.pending || 0),
      taxCollected: Number(todayOrders.tax_collected || 0),
      avgOrderValue: Number(todayOrders.avg_order_value || 0),
      medicalOrders: Number(todayOrders.medical_orders || 0),
    },
    month: {
      revenue: Number(monthRevenue.revenue || 0),
      orderCount: Number(monthRevenue.order_count || 0),
    },
    topProducts,
    lowStockAlerts: lowStockItems,
    lowStockCount: lowStockItems.length,
    openCashSessions: openSessions,
    loyaltyMembers: Number(loyaltyMembers),
    deliveries: {
      total: Number(todayDeliveries.total || 0),
      pending: Number(todayDeliveries.pending || 0),
      enRoute: Number(todayDeliveries.en_route || 0),
      delivered: Number(todayDeliveries.delivered || 0),
    },
  })
})

app.get('/recent-activity', async (c) => {
  const user = c.get('user') as any
  const companyId = user.companyId

  const [recentOrdersResult, recentAuditResult] = await Promise.all([
    db.execute(sql`
      SELECT o.id, o.number, o.type, o.status, o.total, o.payment_method,
             -- The name lives on the linked CONTACT; orders.customer_name is only filled in for a
             -- walk-in. So every order with a real customer read "Walk-in" in this widget while
             -- /api/orders showed the name — two panels on the same screen disagreeing about who
             -- bought something. Same resolution the orders list uses. (Dispensary T29 M8)
             COALESCE(NULLIF(o.customer_name, ''), ct.name) AS customer_name,
             o.is_medical, o.created_at, o.completed_at
      FROM orders o
      LEFT JOIN contact ct ON ct.id = o.contact_id AND ct.company_id = o.company_id
      WHERE o.company_id = ${companyId}
      ORDER BY o.created_at DESC
      LIMIT 10
    `),
    db.execute(sql`
      SELECT id, action, entity, entity_name, user_email, created_at
      FROM audit_log
      WHERE company_id = ${companyId}
      ORDER BY created_at DESC
      LIMIT 10
    `),
  ])

  // Raw-SQL rows come back snake_case; every other route in this template converts before responding.
  // This one did not, so the Recent Orders widget — which reads camelCase like the rest of the app —
  // found no `orderNumber` and fell through to the row id, printing #lmb7ijjmytwf3b1y1fw58564 where the
  // order number belongs. The same mismatch made every customer read "Walk-in", because customer_name
  // was never customerName either. (Dispensary T24)
  return c.json({
    recentOrders: rowsOf(recentOrdersResult).map(camel),
    recentActivity: rowsOf(recentAuditResult).map(camel),
  })
})

export default app

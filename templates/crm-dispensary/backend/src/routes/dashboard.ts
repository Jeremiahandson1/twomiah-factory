import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { product, contact } from '../../db/schema.ts'
import { eq, and, gte, lt, lte, count, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

app.get('/stats', async (c) => {
  const user = c.get('user') as any
  const companyId = user.companyId
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today.getTime() + 86400000)
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 86400000)

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
  ] = await Promise.all([
    // Total contacts/customers
    safe(() => db.select({ value: count() }).from(contact).where(eq(contact.companyId, companyId)), [{ value: 0 }]),

    // Today's orders
    safe(() => db.execute(sql`
      SELECT
        COUNT(*)::int as total_orders,
        COUNT(CASE WHEN status = 'completed' THEN 1 END)::int as completed,
        COUNT(CASE WHEN status = 'pending' OR status = 'processing' OR status = 'ready' THEN 1 END)::int as pending,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN total::numeric ELSE 0 END), 0) as revenue,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN total_tax::numeric ELSE 0 END), 0) as tax_collected,
        COALESCE(AVG(CASE WHEN status = 'completed' THEN total::numeric END), 0) as avg_order_value,
        COUNT(CASE WHEN is_medical = true AND status = 'completed' THEN 1 END)::int as medical_orders
      FROM orders
      WHERE company_id = ${companyId}
        AND created_at >= ${today}
        AND created_at < ${tomorrow}
    `), { rows: [{}] }),

    // 30-day revenue
    safe(() => db.execute(sql`
      SELECT
        COALESCE(SUM(total::numeric), 0) as revenue,
        COUNT(*)::int as order_count
      FROM orders
      WHERE company_id = ${companyId}
        AND status = 'completed'
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
    `), { rows: [] }),

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
  ])

  const todayOrders = ((todayOrdersResult as any).rows || todayOrdersResult)?.[0] || {}
  const monthRevenue = ((monthRevenueResult as any).rows || monthRevenueResult)?.[0] || {}
  const lowStockItems = (lowStockResult as any).rows || lowStockResult || []
  const openSessions = (openSessionsResult as any).rows || openSessionsResult || []
  const loyaltyMembers = ((loyaltyMembersResult as any).rows || loyaltyMembersResult)?.[0]?.total || 0
  const todayDeliveries = ((todayDeliveriesResult as any).rows || todayDeliveriesResult)?.[0] || {}

  return c.json({
    customers: contactCount[0]?.value ?? 0,
    today: {
      revenue: Number(todayOrders.revenue || 0),
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
             o.customer_name, o.is_medical, o.created_at, o.completed_at
      FROM orders o
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

  return c.json({
    recentOrders: (recentOrdersResult as any).rows || recentOrdersResult,
    recentActivity: (recentAuditResult as any).rows || recentAuditResult,
  })
})

export default app

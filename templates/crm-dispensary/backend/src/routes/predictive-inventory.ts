import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// Raw db.execute rows come back snake_case; the admin UI reads camelCase. Convert keys.
const camel = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}

// POST /forecast — Generate forecasts for all products
app.post('/forecast', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  // Get all active products with inventory tracking
  const productsResult = await db.execute(sql`
    SELECT id, name, stock_quantity, low_stock_threshold, category, brand
    FROM products
    WHERE company_id = ${currentUser.companyId} AND active = true AND track_inventory = true
  `)
  const products = (productsResult as any).rows || productsResult

  let forecastCount = 0

  for (const prod of products) {
    // Query last 90 days of order_items grouped by day
    const salesResult = await db.execute(sql`
      SELECT DATE(o.created_at) as sale_date, COALESCE(SUM(oi.quantity), 0)::int as qty_sold
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = ${prod.id}
        AND oi.company_id = ${currentUser.companyId}
        AND o.status NOT IN ('cancelled', 'refunded')
        AND o.created_at >= NOW() - INTERVAL '90 days'
      GROUP BY DATE(o.created_at)
      ORDER BY sale_date ASC
    `)
    const dailySales = (salesResult as any).rows || salesResult

    // Calculate moving averages
    const totalSold = dailySales.reduce((sum: number, d: any) => sum + Number(d.qty_sold), 0)
    const daysWithData = dailySales.length || 1

    // 7-day moving average (use last 7 entries)
    const last7 = dailySales.slice(-7)
    const avg7Day = last7.length > 0
      ? last7.reduce((sum: number, d: any) => sum + Number(d.qty_sold), 0) / 7
      : 0

    // 30-day moving average (use last 30 entries)
    const last30 = dailySales.slice(-30)
    const avg30Day = last30.length > 0
      ? last30.reduce((sum: number, d: any) => sum + Number(d.qty_sold), 0) / 30
      : 0

    // Use the higher of the two averages for conservative stockout estimate
    const dailyAvgSales = Math.max(avg7Day, avg30Day, 0.01) // min 0.01 to avoid division by zero
    const currentStock = Number(prod.stock_quantity)
    const daysUntilStockout = Math.round(currentStock / dailyAvgSales)
    const suggestedReorderQty = Math.ceil(dailyAvgSales * 14) // 14 days of stock

    // Determine urgency
    let urgency = 'low'
    if (daysUntilStockout < 3) urgency = 'critical'
    else if (daysUntilStockout < 7) urgency = 'high'
    else if (daysUntilStockout < 14) urgency = 'normal'

    // Upsert forecast
    await db.execute(sql`
      INSERT INTO inventory_forecasts(id, product_id, current_stock, daily_avg_sales_7d, daily_avg_sales_30d, days_until_stockout, suggested_reorder_qty, urgency, total_sold_90d, data_points, company_id, created_at, updated_at)
      VALUES (gen_random_uuid(), ${prod.id}, ${currentStock}, ${avg7Day.toFixed(2)}, ${avg30Day.toFixed(2)}, ${daysUntilStockout}, ${suggestedReorderQty}, ${urgency}, ${totalSold}, ${daysWithData}, ${currentUser.companyId}, NOW(), NOW())
      ON CONFLICT (product_id, company_id) DO UPDATE SET
        current_stock = EXCLUDED.current_stock,
        daily_avg_sales_7d = EXCLUDED.daily_avg_sales_7d,
        daily_avg_sales_30d = EXCLUDED.daily_avg_sales_30d,
        days_until_stockout = EXCLUDED.days_until_stockout,
        suggested_reorder_qty = EXCLUDED.suggested_reorder_qty,
        urgency = EXCLUDED.urgency,
        total_sold_90d = EXCLUDED.total_sold_90d,
        data_points = EXCLUDED.data_points,
        updated_at = NOW()
    `)
    forecastCount++
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'inventory_forecast',
    metadata: { type: 'bulk_forecast', productsForecasted: forecastCount },
    req: c.req,
  })

  return c.json({ forecastCount, message: `Generated forecasts for ${forecastCount} products` })
})

// GET /forecasts — List forecasts
app.get('/forecasts', async (c) => {
  const currentUser = c.get('user') as any
  const productId = c.req.query('productId')
  const urgency = c.req.query('urgency')
  const locationId = c.req.query('locationId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let filters = sql``
  if (productId) filters = sql`${filters} AND f.product_id = ${productId}`
  if (urgency) filters = sql`${filters} AND f.urgency = ${urgency}`
  if (locationId) filters = sql`${filters} AND p.location_id = ${locationId}`

  const dataResult = await db.execute(sql`
    SELECT f.*, f.daily_avg_sales_7d AS daily_avg_sales, p.name as product_name, p.category, p.brand, p.image_url, p.sku
    FROM inventory_forecasts f
    JOIN products p ON p.id = f.product_id
    WHERE f.company_id = ${currentUser.companyId} ${filters}
    ORDER BY
      CASE f.urgency WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
      f.days_until_stockout ASC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total
    FROM inventory_forecasts f
    JOIN products p ON p.id = f.product_id
    WHERE f.company_id = ${currentUser.companyId} ${filters}
  `)

  const data = ((dataResult as any).rows || dataResult).map(camel)
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// GET /forecasts/:productId — Forecast detail with historical chart data
app.get('/forecasts/:productId', async (c) => {
  const currentUser = c.get('user') as any
  const productId = c.req.param('productId')

  const forecastResult = await db.execute(sql`
    SELECT f.*, p.name as product_name, p.category, p.brand, p.price, p.stock_quantity, p.low_stock_threshold
    FROM inventory_forecasts f
    JOIN products p ON p.id = f.product_id
    WHERE f.product_id = ${productId} AND f.company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const forecast = ((forecastResult as any).rows || forecastResult)?.[0]
  if (!forecast) return c.json({ error: 'Forecast not found' }, 404)

  // Historical daily sales for last 90 days
  const historyResult = await db.execute(sql`
    SELECT d.date as sale_date, COALESCE(s.qty_sold, 0)::int as qty_sold
    FROM generate_series(
      CURRENT_DATE - INTERVAL '90 days',
      CURRENT_DATE,
      '1 day'
    ) d(date)
    LEFT JOIN (
      SELECT DATE(o.created_at) as sale_date, SUM(oi.quantity)::int as qty_sold
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = ${productId}
        AND oi.company_id = ${currentUser.companyId}
        AND o.status NOT IN ('cancelled', 'refunded')
        AND o.created_at >= NOW() - INTERVAL '90 days'
      GROUP BY DATE(o.created_at)
    ) s ON s.sale_date = d.date
    ORDER BY d.date ASC
  `)
  const history = (historyResult as any).rows || historyResult

  return c.json({ ...forecast, dailySales: history })
})

// GET /reorder-suggestions — List reorder suggestions
app.get('/reorder-suggestions', async (c) => {
  const currentUser = c.get('user') as any
  const urgency = c.req.query('urgency')
  const status = c.req.query('status') || 'pending'
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let filters = sql``
  if (urgency) filters = sql`${filters} AND rs.urgency = ${urgency}`
  if (status) filters = sql`${filters} AND rs.status = ${status}`

  const dataResult = await db.execute(sql`
    SELECT rs.*, rs.suggested_qty AS reorder_qty,
           (rs.status = 'approved') AS approved, (rs.status = 'dismissed') AS dismissed,
           p.name as product_name, p.category, p.brand, p.sku, p.image_url, p.cost_price, p.stock_quantity
    FROM reorder_suggestions rs
    JOIN products p ON p.id = rs.product_id
    WHERE rs.company_id = ${currentUser.companyId} ${filters}
    ORDER BY
      CASE rs.urgency WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
      rs.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total
    FROM reorder_suggestions rs
    WHERE rs.company_id = ${currentUser.companyId} ${filters}
  `)

  const data = ((dataResult as any).rows || dataResult).map(camel)
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// POST /reorder-suggestions/generate — Generate reorder suggestions from forecasts
app.post('/reorder-suggestions/generate', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const forecastsResult = await db.execute(sql`
    SELECT f.*, p.name as product_name, p.cost_price, p.sku
    FROM inventory_forecasts f
    JOIN products p ON p.id = f.product_id
    WHERE f.company_id = ${currentUser.companyId}
      AND f.days_until_stockout < 14
  `)
  const forecasts = (forecastsResult as any).rows || forecastsResult

  let generated = 0
  for (const f of forecasts) {
    let urgency = 'low'
    if (f.days_until_stockout < 3) urgency = 'critical'
    else if (f.days_until_stockout < 7) urgency = 'high'
    else urgency = 'normal'

    const estimatedCost = f.suggested_reorder_qty * (Number(f.cost_price) || 0)

    await db.execute(sql`
      INSERT INTO reorder_suggestions(id, product_id, current_stock, daily_avg_sales, days_until_stockout, suggested_qty, urgency, estimated_cost, status, company_id, created_at, updated_at)
      VALUES (gen_random_uuid(), ${f.product_id}, ${f.current_stock}, ${f.daily_avg_sales_7d}, ${f.days_until_stockout}, ${f.suggested_reorder_qty}, ${urgency}, ${estimatedCost.toFixed(2)}, 'pending', ${currentUser.companyId}, NOW(), NOW())
      ON CONFLICT (product_id, company_id, status) WHERE status = 'pending' DO UPDATE SET
        current_stock = EXCLUDED.current_stock,
        daily_avg_sales = EXCLUDED.daily_avg_sales,
        days_until_stockout = EXCLUDED.days_until_stockout,
        suggested_qty = EXCLUDED.suggested_qty,
        urgency = EXCLUDED.urgency,
        estimated_cost = EXCLUDED.estimated_cost,
        updated_at = NOW()
    `)
    generated++
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'reorder_suggestion',
    metadata: { type: 'bulk_generate', generated },
    req: c.req,
  })

  return c.json({ generated, message: `Generated ${generated} reorder suggestions` })
})

// PUT /reorder-suggestions/:id/approve — Approve a suggestion (manager+)
app.put('/reorder-suggestions/:id/approve', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  // reorder_suggestions has no updated_at column in the schema; touching it 500s.
  const result = await db.execute(sql`
    UPDATE reorder_suggestions
    SET status = 'approved', approved_by = ${currentUser.userId}, approved_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND status = 'pending'
    RETURNING *
  `)

  const updated = camel(((result as any).rows || result)?.[0])
  if (!updated) return c.json({ error: 'Suggestion not found or already processed' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'reorder_suggestion',
    entityId: id,
    metadata: { type: 'approve', productId: updated.productId },
    req: c.req,
  })

  return c.json(updated)
})

// PUT /reorder-suggestions/:id/dismiss — Dismiss a suggestion
app.put('/reorder-suggestions/:id/dismiss', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  // reorder_suggestions has no updated_at column in the schema; touching it 500s.
  const result = await db.execute(sql`
    UPDATE reorder_suggestions
    SET status = 'dismissed'
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND status = 'pending'
    RETURNING *
  `)

  const updated = camel(((result as any).rows || result)?.[0])
  if (!updated) return c.json({ error: 'Suggestion not found or already processed' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'reorder_suggestion',
    entityId: id,
    metadata: { type: 'dismiss', productId: updated.productId },
    req: c.req,
  })

  return c.json(updated)
})

// GET /trends — Product sales trends
app.get('/trends', async (c) => {
  const currentUser = c.get('user') as any

  // daily_avg_sales_7d / _30d are TEXT columns; numeric comparison/arithmetic on them
  // (> 0, subtraction, division) throws in Postgres. Cast per-row to numeric (NULLIF guards
  // empty/NULL) for both ordering and the declining math. (schema fix)
  const topMoversResult = await db.execute(sql`
    SELECT f.product_id, p.name, p.category, p.brand, p.image_url,
           f.daily_avg_sales_7d, f.daily_avg_sales_30d, f.total_sold_90d, f.current_stock
    FROM inventory_forecasts f
    JOIN products p ON p.id = f.product_id
    WHERE f.company_id = ${currentUser.companyId}
    ORDER BY NULLIF(f.daily_avg_sales_7d, '')::numeric DESC NULLS LAST
    LIMIT 10
  `)
  const topMovers = ((topMoversResult as any).rows || topMoversResult).map(camel)

  // Declining: products where 7-day avg is significantly less than 30-day avg
  const decliningResult = await db.execute(sql`
    SELECT f.product_id, p.name, p.category, p.brand, p.image_url,
           f.daily_avg_sales_7d, f.daily_avg_sales_30d, f.total_sold_90d,
           CASE WHEN NULLIF(f.daily_avg_sales_30d, '')::numeric > 0
             THEN ROUND(((NULLIF(f.daily_avg_sales_7d, '')::numeric - NULLIF(f.daily_avg_sales_30d, '')::numeric) / NULLIF(f.daily_avg_sales_30d, '')::numeric * 100)::numeric, 1)
             ELSE 0
           END as change_pct
    FROM inventory_forecasts f
    JOIN products p ON p.id = f.product_id
    WHERE f.company_id = ${currentUser.companyId}
      AND NULLIF(f.daily_avg_sales_30d, '')::numeric > 0
      AND NULLIF(f.daily_avg_sales_7d, '')::numeric < NULLIF(f.daily_avg_sales_30d, '')::numeric * 0.7
    ORDER BY (NULLIF(f.daily_avg_sales_7d, '')::numeric / GREATEST(NULLIF(f.daily_avg_sales_30d, '')::numeric, 0.01)) ASC
    LIMIT 10
  `)
  const declining = ((decliningResult as any).rows || decliningResult).map(camel)

  // Seasonal patterns: sales by day of week over last 90 days
  const seasonalResult = await db.execute(sql`
    SELECT EXTRACT(DOW FROM o.created_at)::int as day_of_week,
           COALESCE(SUM(oi.quantity), 0)::int as total_sold,
           COUNT(DISTINCT DATE(o.created_at))::int as days_counted
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.company_id = ${currentUser.companyId}
      AND o.status NOT IN ('cancelled', 'refunded')
      AND o.created_at >= NOW() - INTERVAL '90 days'
    GROUP BY EXTRACT(DOW FROM o.created_at)
    ORDER BY day_of_week
  `)
  const seasonal = ((seasonalResult as any).rows || seasonalResult).map(camel)

  return c.json({ topMovers, declining, seasonal })
})

export default app

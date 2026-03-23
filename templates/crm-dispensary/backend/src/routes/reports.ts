import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// ── Saved Reports ──────────────────────────────────────────────────────

// List saved reports
app.get('/saved', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT sr.*, u.first_name || ' ' || u.last_name as created_by_name
    FROM saved_reports sr
    LEFT JOIN "user" u ON u.id = sr.created_by
    WHERE sr.company_id = ${currentUser.companyId}
      AND (sr.is_public = true OR sr.created_by = ${currentUser.id})
    ORDER BY sr.pinned DESC, sr.updated_at DESC
  `)

  return c.json((result as any).rows || result)
})

// Create saved report
app.post('/saved', async (c) => {
  const currentUser = c.get('user') as any

  const reportSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    reportType: z.string().min(1),
    config: z.object({
      metrics: z.array(z.string()).optional(),
      dimensions: z.array(z.string()).optional(),
      filters: z.record(z.any()).optional(),
      dateRange: z.object({
        start: z.string().optional(),
        end: z.string().optional(),
        preset: z.string().optional(),
      }).optional(),
      groupBy: z.string().optional(),
      sortBy: z.string().optional(),
      sortDir: z.enum(['asc', 'desc']).optional(),
      chartType: z.string().optional(),
    }),
    isPublic: z.boolean().default(false),
    pinned: z.boolean().default(false),
  })
  const data = reportSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO saved_reports(id, company_id, created_by, name, description, report_type, config, is_public, pinned, created_at, updated_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${currentUser.id}, ${data.name}, ${data.description || null}, ${data.reportType}, ${JSON.stringify(data.config)}::jsonb, ${data.isPublic}, ${data.pinned}, NOW(), NOW())
    RETURNING *
  `)

  const report = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'saved_report',
    entityId: report?.id,
    entityName: data.name,
    req: c.req,
  })

  return c.json(report, 201)
})

// Update saved report
app.put('/saved/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const reportSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    reportType: z.string().optional(),
    config: z.object({
      metrics: z.array(z.string()).optional(),
      dimensions: z.array(z.string()).optional(),
      filters: z.record(z.any()).optional(),
      dateRange: z.object({
        start: z.string().optional(),
        end: z.string().optional(),
        preset: z.string().optional(),
      }).optional(),
      groupBy: z.string().optional(),
      sortBy: z.string().optional(),
      sortDir: z.enum(['asc', 'desc']).optional(),
      chartType: z.string().optional(),
    }).optional(),
    isPublic: z.boolean().optional(),
    pinned: z.boolean().optional(),
  })
  const data = reportSchema.parse(await c.req.json())

  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.name !== undefined) sets.push(sql`name = ${data.name}`)
  if (data.description !== undefined) sets.push(sql`description = ${data.description}`)
  if (data.reportType !== undefined) sets.push(sql`report_type = ${data.reportType}`)
  if (data.config !== undefined) sets.push(sql`config = ${JSON.stringify(data.config)}::jsonb`)
  if (data.isPublic !== undefined) sets.push(sql`is_public = ${data.isPublic}`)
  if (data.pinned !== undefined) sets.push(sql`pinned = ${data.pinned}`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE saved_reports SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Report not found' }, 404)

  return c.json(updated)
})

// Delete saved report
app.delete('/saved/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    DELETE FROM saved_reports
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING id, name
  `)

  const deleted = ((result as any).rows || result)?.[0]
  if (!deleted) return c.json({ error: 'Report not found' }, 404)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'saved_report',
    entityId: id,
    entityName: deleted.name,
    req: c.req,
  })

  return c.json({ success: true })
})

// Execute a saved report
app.post('/saved/:id/run', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const reportResult = await db.execute(sql`
    SELECT * FROM saved_reports
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)

  const report = ((reportResult as any).rows || reportResult)?.[0]
  if (!report) return c.json({ error: 'Report not found' }, 404)

  const config = typeof report.config === 'string' ? JSON.parse(report.config) : report.config

  // Build date filter
  let dateStart = config.dateRange?.start || null
  let dateEnd = config.dateRange?.end || null
  if (config.dateRange?.preset) {
    const now = new Date()
    switch (config.dateRange.preset) {
      case 'today': dateStart = now.toISOString().split('T')[0]; dateEnd = dateStart; break
      case 'this_week': { const d = new Date(now); d.setDate(d.getDate() - d.getDay()); dateStart = d.toISOString().split('T')[0]; dateEnd = now.toISOString().split('T')[0]; break }
      case 'this_month': dateStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`; dateEnd = now.toISOString().split('T')[0]; break
      case 'last_30': { const d = new Date(now); d.setDate(d.getDate() - 30); dateStart = d.toISOString().split('T')[0]; dateEnd = now.toISOString().split('T')[0]; break }
      case 'last_90': { const d = new Date(now); d.setDate(d.getDate() - 90); dateStart = d.toISOString().split('T')[0]; dateEnd = now.toISOString().split('T')[0]; break }
      case 'this_year': dateStart = `${now.getFullYear()}-01-01`; dateEnd = now.toISOString().split('T')[0]; break
    }
  }

  let dateFilter = sql``
  if (dateStart) dateFilter = sql`AND o.created_at >= ${dateStart}::date`
  if (dateEnd) dateFilter = sql`${dateFilter} AND o.created_at <= (${dateEnd}::date + interval '1 day')`

  // Run report based on type
  let data: any[] = []
  switch (report.report_type) {
    case 'sales_summary': {
      const r = await db.execute(sql`
        SELECT DATE_TRUNC(${config.groupBy || 'day'}, o.created_at) as period,
               COUNT(*)::int as order_count,
               SUM(o.total)::numeric as revenue,
               AVG(o.total)::numeric as avg_order_value
        FROM orders o
        WHERE o.company_id = ${currentUser.companyId}
          AND o.status != 'cancelled'
          ${dateFilter}
        GROUP BY period
        ORDER BY period ASC
      `)
      data = (r as any).rows || r
      break
    }
    case 'product_sales': {
      const r = await db.execute(sql`
        SELECT p.name as product_name, p.category,
               SUM(oi.quantity)::int as units_sold,
               SUM(oi.quantity * oi.unit_price)::numeric as revenue
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        JOIN orders o ON o.id = oi.order_id
        WHERE o.company_id = ${currentUser.companyId}
          AND o.status != 'cancelled'
          ${dateFilter}
        GROUP BY p.id, p.name, p.category
        ORDER BY revenue DESC
      `)
      data = (r as any).rows || r
      break
    }
    case 'inventory_snapshot': {
      const r = await db.execute(sql`
        SELECT p.name, p.category, p.sku,
               ib.batch_number, ib.quantity_remaining, ib.unit,
               ib.expiration_date
        FROM inventory_batch ib
        JOIN products p ON p.id = ib.product_id
        WHERE ib.company_id = ${currentUser.companyId}
          AND ib.status = 'active'
        ORDER BY p.category, p.name
      `)
      data = (r as any).rows || r
      break
    }
    case 'loyalty_report': {
      const r = await db.execute(sql`
        SELECT lm.tier, COUNT(*)::int as member_count,
               SUM(lm.points_earned)::int as total_points_earned,
               SUM(lm.points_redeemed)::int as total_points_redeemed,
               AVG(lm.lifetime_spend)::numeric as avg_lifetime_spend
        FROM loyalty_members lm
        WHERE lm.company_id = ${currentUser.companyId}
        GROUP BY lm.tier
        ORDER BY avg_lifetime_spend DESC
      `)
      data = (r as any).rows || r
      break
    }
    default: {
      return c.json({ error: `Unknown report type: ${report.report_type}` }, 400)
    }
  }

  return c.json({ report: { id: report.id, name: report.name, reportType: report.report_type }, data })
})

// ── BI Widgets ─────────────────────────────────────────────────────────

// List BI widgets
app.get('/widgets', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT * FROM bi_widgets
    WHERE company_id = ${currentUser.companyId}
    ORDER BY position->>'y' ASC, position->>'x' ASC
  `)

  return c.json((result as any).rows || result)
})

// Create widget
app.post('/widgets', async (c) => {
  const currentUser = c.get('user') as any

  const widgetSchema = z.object({
    title: z.string().min(1),
    widgetType: z.enum(['kpi', 'line_chart', 'bar_chart', 'pie_chart', 'table', 'heatmap', 'gauge']),
    dataSource: z.enum(['sales', 'orders', 'inventory', 'loyalty', 'budtenders', 'compliance']),
    config: z.record(z.any()).default({}),
    position: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
    refreshInterval: z.number().int().min(0).default(300),
  })
  const data = widgetSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO bi_widgets(id, company_id, created_by, title, widget_type, data_source, config, position, refresh_interval, created_at, updated_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${currentUser.id}, ${data.title}, ${data.widgetType}, ${data.dataSource}, ${JSON.stringify(data.config)}::jsonb, ${JSON.stringify(data.position)}::jsonb, ${data.refreshInterval}, NOW(), NOW())
    RETURNING *
  `)

  const widget = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'bi_widget',
    entityId: widget?.id,
    entityName: data.title,
    req: c.req,
  })

  return c.json(widget, 201)
})

// Update widget
app.put('/widgets/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const widgetSchema = z.object({
    title: z.string().min(1).optional(),
    widgetType: z.enum(['kpi', 'line_chart', 'bar_chart', 'pie_chart', 'table', 'heatmap', 'gauge']).optional(),
    dataSource: z.enum(['sales', 'orders', 'inventory', 'loyalty', 'budtenders', 'compliance']).optional(),
    config: z.record(z.any()).optional(),
    position: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
    refreshInterval: z.number().int().min(0).optional(),
  })
  const data = widgetSchema.parse(await c.req.json())

  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.title !== undefined) sets.push(sql`title = ${data.title}`)
  if (data.widgetType !== undefined) sets.push(sql`widget_type = ${data.widgetType}`)
  if (data.dataSource !== undefined) sets.push(sql`data_source = ${data.dataSource}`)
  if (data.config !== undefined) sets.push(sql`config = ${JSON.stringify(data.config)}::jsonb`)
  if (data.position !== undefined) sets.push(sql`position = ${JSON.stringify(data.position)}::jsonb`)
  if (data.refreshInterval !== undefined) sets.push(sql`refresh_interval = ${data.refreshInterval}`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE bi_widgets SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Widget not found' }, 404)

  return c.json(updated)
})

// Delete widget
app.delete('/widgets/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    DELETE FROM bi_widgets
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING id, title
  `)

  const deleted = ((result as any).rows || result)?.[0]
  if (!deleted) return c.json({ error: 'Widget not found' }, 404)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'bi_widget',
    entityId: id,
    entityName: deleted.title,
    req: c.req,
  })

  return c.json({ success: true })
})

// Fetch data for a widget
app.post('/widgets/:id/data', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const widgetResult = await db.execute(sql`
    SELECT * FROM bi_widgets
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)

  const widget = ((widgetResult as any).rows || widgetResult)?.[0]
  if (!widget) return c.json({ error: 'Widget not found' }, 404)

  const config = typeof widget.config === 'string' ? JSON.parse(widget.config) : widget.config
  const dateRange = config.dateRange || 'last_30'

  // Build date filter
  const now = new Date()
  let daysBack = 30
  switch (dateRange) {
    case 'today': daysBack = 0; break
    case 'last_7': daysBack = 7; break
    case 'last_30': daysBack = 30; break
    case 'last_90': daysBack = 90; break
    case 'this_year': daysBack = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000); break
  }

  const startDate = new Date(now)
  startDate.setDate(startDate.getDate() - daysBack)
  const startDateStr = startDate.toISOString().split('T')[0]

  let data: any = null

  switch (widget.data_source) {
    case 'sales': {
      const r = await db.execute(sql`
        SELECT DATE_TRUNC('day', created_at) as period,
               COUNT(*)::int as order_count,
               SUM(total)::numeric as revenue
        FROM orders
        WHERE company_id = ${currentUser.companyId}
          AND status != 'cancelled'
          AND created_at >= ${startDateStr}::date
        GROUP BY period
        ORDER BY period ASC
      `)
      data = (r as any).rows || r
      break
    }
    case 'orders': {
      const r = await db.execute(sql`
        SELECT status, COUNT(*)::int as count, SUM(total)::numeric as total
        FROM orders
        WHERE company_id = ${currentUser.companyId}
          AND created_at >= ${startDateStr}::date
        GROUP BY status
      `)
      data = (r as any).rows || r
      break
    }
    case 'inventory': {
      const r = await db.execute(sql`
        SELECT p.category,
               COUNT(DISTINCT p.id)::int as product_count,
               SUM(ib.quantity_remaining)::numeric as total_quantity,
               SUM(ib.quantity_remaining * p.price)::numeric as total_value
        FROM inventory_batch ib
        JOIN products p ON p.id = ib.product_id
        WHERE ib.company_id = ${currentUser.companyId}
          AND ib.status = 'active'
        GROUP BY p.category
        ORDER BY total_value DESC
      `)
      data = (r as any).rows || r
      break
    }
    case 'loyalty': {
      const r = await db.execute(sql`
        SELECT
          COUNT(*)::int as total_members,
          COUNT(*) FILTER (WHERE created_at >= ${startDateStr}::date)::int as new_members,
          SUM(points_earned)::int as total_points_earned,
          SUM(points_redeemed)::int as total_points_redeemed,
          AVG(lifetime_spend)::numeric as avg_lifetime_spend
        FROM loyalty_members
        WHERE company_id = ${currentUser.companyId}
      `)
      data = ((r as any).rows || r)?.[0]
      break
    }
    case 'budtenders': {
      const r = await db.execute(sql`
        SELECT u.id, u.first_name || ' ' || u.last_name as name,
               COUNT(o.id)::int as order_count,
               SUM(o.total)::numeric as revenue,
               AVG(o.total)::numeric as avg_order_value
        FROM "user" u
        LEFT JOIN orders o ON o.budtender_id = u.id
          AND o.created_at >= ${startDateStr}::date
          AND o.status != 'cancelled'
        WHERE u.company_id = ${currentUser.companyId}
          AND u.role IN ('budtender', 'manager', 'admin')
        GROUP BY u.id, u.first_name, u.last_name
        ORDER BY revenue DESC NULLS LAST
      `)
      data = (r as any).rows || r
      break
    }
    case 'compliance': {
      const r = await db.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM metrc_sync_log WHERE company_id = ${currentUser.companyId} AND created_at >= ${startDateStr}::date) as total_syncs,
          (SELECT COUNT(*)::int FROM metrc_sync_log WHERE company_id = ${currentUser.companyId} AND created_at >= ${startDateStr}::date AND status = 'success') as successful_syncs,
          (SELECT COUNT(*)::int FROM metrc_sync_log WHERE company_id = ${currentUser.companyId} AND created_at >= ${startDateStr}::date AND status = 'error') as failed_syncs,
          (SELECT COUNT(*)::int FROM inventory_batch WHERE company_id = ${currentUser.companyId} AND metrc_tag IS NOT NULL AND status = 'active') as tagged_batches,
          (SELECT COUNT(*)::int FROM inventory_batch WHERE company_id = ${currentUser.companyId} AND metrc_tag IS NULL AND status = 'active') as untagged_batches
      `)
      data = ((r as any).rows || r)?.[0]
      break
    }
  }

  return c.json({ widgetId: widget.id, dataSource: widget.data_source, data })
})

// ── Budtender Performance ──────────────────────────────────────────────

app.get('/budtender-performance', async (c) => {
  const currentUser = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')

  let dateFilter = sql``
  if (startDate) dateFilter = sql`AND o.created_at >= ${startDate}::date`
  if (endDate) dateFilter = sql`${dateFilter} AND o.created_at <= (${endDate}::date + interval '1 day')`

  const result = await db.execute(sql`
    SELECT
      u.id as budtender_id,
      u.first_name || ' ' || u.last_name as name,
      COUNT(o.id)::int as order_count,
      COALESCE(SUM(o.total), 0)::numeric as revenue,
      COALESCE(AVG(o.total), 0)::numeric as avg_order_value,
      (
        SELECT p.category FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        JOIN orders o2 ON o2.id = oi.order_id
        WHERE o2.budtender_id = u.id AND o2.status != 'cancelled'
        GROUP BY p.category
        ORDER BY SUM(oi.quantity) DESC
        LIMIT 1
      ) as top_category,
      (
        SELECT COUNT(*)::int FROM loyalty_members lm
        WHERE lm.enrolled_by = u.id AND lm.company_id = ${currentUser.companyId}
      ) as loyalty_enrollments,
      COALESCE(SUM(o.tip_amount), 0)::numeric as tips_earned
    FROM "user" u
    LEFT JOIN orders o ON o.budtender_id = u.id
      AND o.company_id = ${currentUser.companyId}
      AND o.status != 'cancelled'
      ${dateFilter}
    WHERE u.company_id = ${currentUser.companyId}
      AND u.role IN ('budtender', 'manager', 'admin')
    GROUP BY u.id, u.first_name, u.last_name
    ORDER BY revenue DESC
  `)

  return c.json((result as any).rows || result)
})

export default app

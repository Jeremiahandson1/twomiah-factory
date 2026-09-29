import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'
import { zodRefusal } from '../utils/errors.ts'
import { storeTimeZone } from '../utils/isoTime.ts'

/**
 * A stored instant, read on the shop's clock.
 *
 * `created_at` is a naive timestamp holding UTC, so it is labelled UTC and then converted — the
 * two-step `AT TIME ZONE` that every report in this codebase needs and that DATE_TRUNC on its own
 * silently skips. (T46 L-k)
 */
const storeLocal = (column: any, tz: string) => sql`((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${tz})`

const app = new Hono()
app.use('*', authenticate)

// Raw-SQL rows come back snake_case, but the frontend reads camelCase — so fields
// (created_by_name, report_type, is_public, widget_type, avg_order_value, etc.)
// rendered blank. Convert row keys to camelCase before responding.
const camel = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}

// ── Saved Reports ──────────────────────────────────────────────────────

// The New Report dialog sends { name, type, config: { metrics, dateRange: '30d', groupBy } } and
// this route wanted { name, reportType, config: { dateRange: { start, end, preset } } } - so every
// custom report was refused with a 400 and none could be saved. Both vocabularies are now read.
//
// The type also has to be one this file can actually RUN. The runner below knows four reports;
// the dialog used to offer five names, none of which matched any of them, so even a saved report
// would have answered "Unknown report type" when run. Refuse an unrunnable type at save time,
// where the person can still change it. (T45 H14)
const REPORT_TYPES = ['sales_summary', 'product_sales', 'inventory_snapshot', 'loyalty_report']
const REPORT_TYPE_ALIASES: Record<string, string> = {
  sales: 'sales_summary', sales_summary: 'sales_summary', revenue: 'sales_summary',
  products: 'product_sales', product: 'product_sales', product_sales: 'product_sales',
  inventory: 'inventory_snapshot', inventory_snapshot: 'inventory_snapshot', stock: 'inventory_snapshot',
  loyalty: 'loyalty_report', loyalty_report: 'loyalty_report', members: 'loyalty_report',
}
const reportType = z.string().transform((v, ctx) => {
  const canonical = REPORT_TYPE_ALIASES[String(v).trim().toLowerCase()]
  if (!canonical) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `There is no "${v}" report. Choose one of: ${REPORT_TYPES.join(', ')}` })
    return z.NEVER
  }
  return canonical
})

// The dialog's Date Range is a single string ('7d' | '30d' | '90d' | 'ytd' | 'all'); the runner
// reads { start, end, preset } with preset names of its own. Normalise a bare string into the
// object rather than let it through as one - a string dateRange silently disabled the filter and
// the report quietly covered all time.
const DATE_PRESETS: Record<string, string> = {
  '7d': 'last_7', last_7: 'last_7', this_week: 'this_week',
  '30d': 'last_30', last_30: 'last_30', this_month: 'this_month',
  '90d': 'last_90', last_90: 'last_90',
  ytd: 'this_year', this_year: 'this_year',
  today: 'today',
  all: 'all', all_time: 'all',
}
const dateRange = z.preprocess((raw: any) => {
  if (typeof raw !== 'string') return raw
  const preset = DATE_PRESETS[raw.trim().toLowerCase()]
  return preset ? { preset } : { preset: raw.trim().toLowerCase() }
}, z.object({
  start: z.string().optional(),
  end: z.string().optional(),
  preset: z.string().optional(),
}))

// DATE_TRUNC only understands time units. 'category' and 'budtender' are dimensions of a different
// report, and passing either one straight into DATE_TRUNC is a Postgres error - a 500 on run.
const GROUP_BY_UNITS = ['hour', 'day', 'week', 'month', 'quarter', 'year']
const truncUnit = (v: unknown) => {
  const unit = String(v || 'day').trim().toLowerCase()
  return GROUP_BY_UNITS.includes(unit) ? unit : 'day'
}

// `type` is the dialog's name for reportType; take either.
const withReportAliases = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((raw: any) => {
    if (!raw || typeof raw !== 'object') return raw
    const out = { ...raw }
    if (out.reportType === undefined && out.type !== undefined) out.reportType = out.type
    delete out.type
    return out
  }, schema)

// List saved reports
app.get('/saved', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT sr.*, u.first_name || ' ' || u.last_name as created_by_name
    FROM saved_reports sr
    LEFT JOIN "user" u ON u.id = sr.created_by
    WHERE sr.company_id = ${currentUser.companyId}
      AND (sr.is_public = true OR sr.created_by = ${currentUser.userId})
    ORDER BY sr.pinned DESC, sr.updated_at DESC
  `)

  return c.json(((result as any).rows || result).map(camel))
})

// Create saved report
app.post('/saved', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const reportSchema = withReportAliases(z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    reportType,
    config: z.object({
      metrics: z.array(z.string()).optional(),
      dimensions: z.array(z.string()).optional(),
      filters: z.record(z.any()).optional(),
      dateRange: dateRange.optional(),
      groupBy: z.string().optional(),
      sortBy: z.string().optional(),
      sortDir: z.enum(['asc', 'desc']).optional(),
      chartType: z.string().optional(),
    }).default({}),
    isPublic: z.boolean().default(false),
    pinned: z.boolean().default(false),
  }))

  let data: any
  try {
    data = reportSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) return c.json(zodRefusal(err), 400)
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const result = await db.execute(sql`
    INSERT INTO saved_reports(id, company_id, created_by, name, description, report_type, config, is_public, pinned, created_at, updated_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${currentUser.userId}, ${data.name}, ${data.description || null}, ${data.reportType}, ${JSON.stringify(data.config)}::jsonb, ${data.isPublic}, ${data.pinned}, NOW(), NOW())
    RETURNING *
  `)

  const report = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'saved_report',
    entityId: report?.id,
    entityName: data.name,
    req: c,
  })

  return c.json(camel(report), 201)
})

// Update saved report
app.put('/saved/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const reportSchema = withReportAliases(z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    reportType: reportType.optional(),
    config: z.object({
      metrics: z.array(z.string()).optional(),
      dimensions: z.array(z.string()).optional(),
      filters: z.record(z.any()).optional(),
      dateRange: dateRange.optional(),
      groupBy: z.string().optional(),
      sortBy: z.string().optional(),
      sortDir: z.enum(['asc', 'desc']).optional(),
      chartType: z.string().optional(),
    }).optional(),
    isPublic: z.boolean().optional(),
    pinned: z.boolean().optional(),
  }))

  let data: any
  try {
    data = reportSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) return c.json(zodRefusal(err), 400)
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

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

  return c.json(camel(updated))
})

// Delete saved report
app.delete('/saved/:id', requireRole('manager'), async (c) => {
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
    req: c,
  })

  return c.json({ success: true })
})

// Execute a saved report
app.post('/saved/:id/run', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const reportResult = await db.execute(sql`
    SELECT * FROM saved_reports
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)

  const report = ((reportResult as any).rows || reportResult)?.[0]
  if (!report) return c.json({ error: 'Report not found' }, 404)

  // The bucket a sale falls in belongs to the SHOP's day, and the label on it is a date a person
  // reads — not the ISO instant Postgres hands back from DATE_TRUNC.
  //
  // T46 L-k: the sales report's periods came back as UTC timestamps, so the last hours of every
  // evening's trade were filed under the next day and the column header read
  // "2026-09-28T00:00:00.000Z". The same bug this codebase has fixed on the dashboard, the
  // analytics series, cash reconciliation and the compliance report. (T24 N1, and every round since.)
  const [reportCo] = ((await db.execute(sql`SELECT state, settings FROM company WHERE id = ${currentUser.companyId} LIMIT 1`)) as any).rows || []
  const reportZone = storeTimeZone(reportCo)

  const config = typeof report.config === 'string' ? JSON.parse(report.config) : report.config

  // Build date filter. A report saved before the dialog and this runner agreed can still hold a
  // bare string here ('30d'), so read that shape too rather than silently run over all time.
  const rangeRaw = config.dateRange
  const range = typeof rangeRaw === 'string'
    ? { preset: DATE_PRESETS[rangeRaw.trim().toLowerCase()] || rangeRaw.trim().toLowerCase() }
    : (rangeRaw || {})
  let dateStart = range.start || null
  let dateEnd = range.end || null
  if (range.preset) {
    const now = new Date()
    const daysAgo = (n: number) => { const d = new Date(now); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0] }
    const today = now.toISOString().split('T')[0]
    switch (range.preset) {
      case 'today': dateStart = today; dateEnd = today; break
      case 'this_week': { const d = new Date(now); d.setDate(d.getDate() - d.getDay()); dateStart = d.toISOString().split('T')[0]; dateEnd = today; break }
      case 'this_month': dateStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`; dateEnd = today; break
      case 'last_7': dateStart = daysAgo(7); dateEnd = today; break
      case 'last_30': dateStart = daysAgo(30); dateEnd = today; break
      case 'last_90': dateStart = daysAgo(90); dateEnd = today; break
      case 'this_year': dateStart = `${now.getFullYear()}-01-01`; dateEnd = today; break
      case 'all': dateStart = null; dateEnd = null; break
    }
  }

  let dateFilter = sql``
  if (dateStart) dateFilter = sql`AND o.created_at >= ${dateStart}::date`
  if (dateEnd) dateFilter = sql`${dateFilter} AND o.created_at <= (${dateEnd}::date + interval '1 day')`

  // Run report based on type. Reports saved under the dialog's old names ('sales', 'inventory')
  // are read through the same alias map, so an existing saved report still runs.
  const runType = REPORT_TYPE_ALIASES[String(report.report_type || '').trim().toLowerCase()] || report.report_type
  let data: any[] = []
  switch (runType) {
    // Every one of these four queries was written against columns that are not there, so a saved
    // report that DID run would have answered 500 rather than data. Money columns on orders and
    // order_items are TEXT (SUM(text) is not a function), the batch table is `batches` with
    // current_quantity / unit_of_measure, and loyalty_members stores total_points_earned and
    // total_spent - there is no points_earned, points_redeemed or lifetime_spend. (T45 H14)
    case 'sales_summary': {
      const r = await db.execute(sql`
        SELECT (DATE_TRUNC(${truncUnit(config.groupBy)}, ${storeLocal(sql`o.created_at`, reportZone)}))::date as period,
               COUNT(*)::int as order_count,
               SUM(COALESCE(NULLIF(o.total, ''), '0')::numeric) as revenue,
               ROUND(AVG(COALESCE(NULLIF(o.total, ''), '0')::numeric), 2) as avg_order_value,
               SUM(COALESCE(NULLIF(o.refunded_amount, ''), '0')::numeric) as refunded
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
      // Units sold nets off anything handed back - order_items.refunded_quantity is exactly that
      // count, and a units-sold figure that still counts returned product is not one to file.
      const r = await db.execute(sql`
        SELECT p.name as product_name, p.category,
               SUM(GREATEST(COALESCE(oi.quantity, 0) - COALESCE(oi.refunded_quantity, 0), 0))::int as units_sold,
               SUM(GREATEST(COALESCE(oi.quantity, 0) - COALESCE(oi.refunded_quantity, 0), 0)
                   * COALESCE(NULLIF(oi.unit_price, ''), '0')::numeric) as revenue
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
               b.batch_number, b.current_quantity, b.unit_of_measure,
               b.expiration_date
        FROM batches b
        JOIN products p ON p.id = b.product_id
        WHERE b.company_id = ${currentUser.companyId}
          AND b.status = 'active'
        ORDER BY p.category, p.name
      `)
      data = (r as any).rows || r
      break
    }
    case 'loyalty_report': {
      const r = await db.execute(sql`
        SELECT lm.tier, COUNT(*)::int as member_count,
               SUM(COALESCE(lm.total_points_earned, 0))::int as total_points_earned,
               SUM(COALESCE(redeemed.points, 0))::int as total_points_redeemed,
               SUM(COALESCE(lm.points_balance, 0))::int as points_outstanding,
               ROUND(AVG(COALESCE(NULLIF(lm.total_spent, ''), '0')::numeric), 2) as avg_lifetime_spend
        FROM loyalty_members lm
        LEFT JOIN (
          SELECT member_id, SUM(ABS(points))::int as points
          FROM loyalty_transactions
          WHERE type = 'redeem'
          GROUP BY member_id
        ) redeemed ON redeemed.member_id = lm.id
        WHERE lm.company_id = ${currentUser.companyId}
        GROUP BY lm.tier
        ORDER BY avg_lifetime_spend DESC
      `)
      data = (r as any).rows || r
      break
    }
    default: {
      return c.json({ error: `There is no "${report.report_type}" report. Saved reports must be one of: ${REPORT_TYPES.join(', ')}` }, 400)
    }
  }

  return c.json({ report: { id: report.id, name: report.name, reportType: report.report_type }, data: data.map(camel) })
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

  return c.json(((result as any).rows || result).map(camel))
})

// Create widget
app.post('/widgets', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const widgetSchema = z.object({
    title: z.string().min(1),
    widgetType: z.enum(['kpi', 'line_chart', 'bar_chart', 'pie_chart', 'table', 'heatmap', 'gauge']),
    dataSource: z.enum(['sales', 'orders', 'inventory', 'loyalty', 'budtenders', 'compliance']),
    config: z.record(z.any()).default({}),
    position: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).default({ x: 0, y: 0, w: 4, h: 4 }),
    refreshInterval: z.number().int().min(0).default(300),
  })
  const data = widgetSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO bi_widgets(id, company_id, created_by, title, widget_type, data_source, config, position, refresh_interval, created_at, updated_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${currentUser.userId}, ${data.title}, ${data.widgetType}, ${data.dataSource}, ${JSON.stringify(data.config ?? {})}::jsonb, ${JSON.stringify(data.position ?? { x: 0, y: 0, w: 4, h: 4 })}::jsonb, ${data.refreshInterval ?? null}, NOW(), NOW())
    RETURNING *
  `)

  const widget = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'bi_widget',
    entityId: widget?.id,
    entityName: data.title,
    req: c,
  })

  return c.json(camel(widget), 201)
})

// Update widget
app.put('/widgets/:id', requireRole('manager'), async (c) => {
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

  return c.json(camel(updated))
})

// Delete widget
app.delete('/widgets/:id', requireRole('manager'), async (c) => {
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
    req: c,
  })

  return c.json({ success: true })
})

// Fetch data for a widget
app.post('/widgets/:id/data', requireRole('manager'), async (c) => {
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

  return c.json({ widgetId: widget.id, dataSource: widget.data_source, data: Array.isArray(data) ? data.map(camel) : camel(data) })
})

// ── Budtender Performance ──────────────────────────────────────────────

// Manager and up: this returns EVERY employee's sales, by name. A budtender reading their
// colleagues' figures is not part of serving a customer. The saved reports and widgets above stay
// open — those are the caller's own. (Dispensary T39 M3)
app.get('/budtender-performance', requireRole('manager'), async (c) => {
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
      COALESCE(SUM(o.total::numeric), 0)::numeric as revenue,
      COALESCE(AVG(o.total::numeric), 0)::numeric as avg_order_value,
      (
        SELECT p.category FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        JOIN orders o2 ON o2.id = oi.order_id
        WHERE o2.budtender_id = u.id AND o2.status != 'cancelled'
        GROUP BY p.category
        ORDER BY SUM(oi.quantity) DESC
        LIMIT 1
      ) as top_category,
      -- loyalty_members has no enrolled_by/budtender attribution column in the schema,
      -- so per-budtender enrollment counts aren't derivable; report 0 rather than 500.
      0::int as loyalty_enrollments,
      COALESCE(SUM(o.tip_amount::numeric), 0)::numeric as tips_earned
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

  return c.json(((result as any).rows || result).map(camel))
})

export default app

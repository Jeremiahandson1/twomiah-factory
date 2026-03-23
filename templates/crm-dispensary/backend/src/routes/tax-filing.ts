import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /filings — List tax filings (paginated, filterable)
app.get('/filings', async (c) => {
  const currentUser = c.get('user') as any
  const filingType = c.req.query('type')
  const period = c.req.query('period')
  const status = c.req.query('status')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let typeFilter = sql``
  if (filingType) typeFilter = sql`AND filing_type = ${filingType}`

  let periodFilter = sql``
  if (period) periodFilter = sql`AND period = ${period}`

  let statusFilter = sql``
  if (status) statusFilter = sql`AND status = ${status}`

  const dataResult = await db.execute(sql`
    SELECT * FROM tax_filings
    WHERE company_id = ${currentUser.companyId}
      ${typeFilter}
      ${periodFilter}
      ${statusFilter}
    ORDER BY period_end DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM tax_filings
    WHERE company_id = ${currentUser.companyId}
      ${typeFilter}
      ${periodFilter}
      ${statusFilter}
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// POST /filings/generate — Generate a tax filing
app.post('/filings/generate', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const generateSchema = z.object({
    filingType: z.enum(['excise_tax', 'sales_tax', 'local_tax', 'combined']),
    period: z.enum(['monthly', 'quarterly', 'annual']),
    periodStart: z.string(),
    periodEnd: z.string(),
    state: z.string().length(2).transform(v => v.toUpperCase()),
    jurisdiction: z.string().optional(),
  })
  const data = generateSchema.parse(await c.req.json())

  const periodStart = new Date(data.periodStart)
  const periodEnd = new Date(data.periodEnd)

  // Query completed orders in the period
  const ordersResult = await db.execute(sql`
    SELECT
      COUNT(*)::int as total_orders,
      COALESCE(SUM(CAST(subtotal AS numeric)), 0) as total_subtotal,
      COALESCE(SUM(CAST(excise_tax AS numeric)), 0) as total_excise_tax,
      COALESCE(SUM(CAST(sales_tax AS numeric)), 0) as total_sales_tax,
      COALESCE(SUM(CAST(total_tax AS numeric)), 0) as total_tax_collected,
      COALESCE(SUM(CAST(total AS numeric)), 0) as total_revenue
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND status = 'completed'
      AND completed_at >= ${periodStart}
      AND completed_at <= ${periodEnd}
  `)
  const orderStats = ((ordersResult as any).rows || ordersResult)?.[0] || {}

  // Category breakdown
  const categoryResult = await db.execute(sql`
    SELECT
      oi.category,
      COUNT(DISTINCT o.id)::int as order_count,
      SUM(oi.quantity)::int as units_sold,
      COALESCE(SUM(CAST(oi.line_total AS numeric)), 0) as category_revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.company_id = ${currentUser.companyId}
      AND o.status = 'completed'
      AND o.completed_at >= ${periodStart}
      AND o.completed_at <= ${periodEnd}
    GROUP BY oi.category
    ORDER BY category_revenue DESC
  `)
  const categoryBreakdown = (categoryResult as any).rows || categoryResult

  // Build filing number
  const filingNumber = `TAX-${data.filingType.toUpperCase().replace(/_/g, '')}-${data.state}-${data.periodStart.slice(0, 7)}-${Date.now().toString(36).toUpperCase()}`

  // Determine tax amounts based on filing type
  let exciseTaxDue = Number(orderStats.total_excise_tax) || 0
  let salesTaxDue = Number(orderStats.total_sales_tax) || 0
  let localTaxDue = 0 // Would be calculated from jurisdiction-specific rates

  if (data.filingType === 'excise_tax') {
    salesTaxDue = 0
  } else if (data.filingType === 'sales_tax') {
    exciseTaxDue = 0
  } else if (data.filingType === 'local_tax') {
    exciseTaxDue = 0
    salesTaxDue = 0
    // Local tax would use jurisdiction-specific rates
    localTaxDue = Number(orderStats.total_subtotal) * 0.03 // placeholder 3% local
  }

  const totalTaxDue = exciseTaxDue + salesTaxDue + localTaxDue

  // Store filing
  const result = await db.execute(sql`
    INSERT INTO tax_filings (id, filing_number, filing_type, period, period_start, period_end, state, jurisdiction, status, total_orders, total_taxable_sales, excise_tax_due, sales_tax_due, local_tax_due, total_tax_due, category_breakdown, company_id, created_at, updated_at)
    VALUES (
      gen_random_uuid(), ${filingNumber}, ${data.filingType}, ${data.period},
      ${periodStart}, ${periodEnd}, ${data.state}, ${data.jurisdiction || null},
      'calculated',
      ${orderStats.total_orders || 0},
      ${Number(orderStats.total_subtotal) || 0},
      ${exciseTaxDue}, ${salesTaxDue}, ${localTaxDue}, ${totalTaxDue},
      ${JSON.stringify(categoryBreakdown)}::jsonb,
      ${currentUser.companyId}, NOW(), NOW()
    )
    RETURNING *
  `)

  const filing = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'tax_filing',
    entityId: filing?.id,
    entityName: filingNumber,
    metadata: { filingType: data.filingType, period: data.period, state: data.state, totalTaxDue },
    req: c.req,
  })

  return c.json(filing, 201)
})

// GET /filings/:id — Filing detail with breakdown
app.get('/filings/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    SELECT * FROM tax_filings
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)

  const filing = ((result as any).rows || result)?.[0]
  if (!filing) return c.json({ error: 'Filing not found' }, 404)

  return c.json(filing)
})

// PUT /filings/:id/review — Mark as reviewed (manager+)
app.put('/filings/:id/review', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE tax_filings
    SET status = 'reviewed', reviewed_at = NOW(), reviewed_by = ${currentUser.userId}, updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Filing not found' }, 404)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'tax_filing',
    entityId: id,
    entityName: updated.filing_number,
    changes: { status: { old: 'calculated', new: 'reviewed' } },
    req: c.req,
  })

  return c.json(updated)
})

// PUT /filings/:id/file — Mark as filed
app.put('/filings/:id/file', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const { confirmationNumber } = z.object({ confirmationNumber: z.string().min(1) }).parse(await c.req.json())

  const result = await db.execute(sql`
    UPDATE tax_filings
    SET status = 'filed', confirmation_number = ${confirmationNumber}, filed_at = NOW(), filed_by = ${currentUser.userId}, updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Filing not found' }, 404)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'tax_filing',
    entityId: id,
    entityName: updated.filing_number,
    changes: { status: { old: updated.status, new: 'filed' } },
    metadata: { confirmationNumber },
    req: c.req,
  })

  return c.json(updated)
})

// GET /filings/upcoming — Upcoming filing deadlines
app.get('/filings/upcoming', async (c) => {
  const currentUser = c.get('user') as any

  // Determine upcoming deadlines based on common filing periods
  const now = new Date()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()

  const deadlines: any[] = []

  // Monthly excise tax: due 20th of following month
  const monthlyDue = new Date(currentYear, currentMonth + 1, 20)
  deadlines.push({
    type: 'excise_tax',
    period: 'monthly',
    periodLabel: new Date(currentYear, currentMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    dueDate: monthlyDue.toISOString().split('T')[0],
    daysUntilDue: Math.ceil((monthlyDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
  })

  // Monthly sales tax: due last day of following month
  const salesTaxDue = new Date(currentYear, currentMonth + 2, 0)
  deadlines.push({
    type: 'sales_tax',
    period: 'monthly',
    periodLabel: new Date(currentYear, currentMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    dueDate: salesTaxDue.toISOString().split('T')[0],
    daysUntilDue: Math.ceil((salesTaxDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
  })

  // Quarterly: due last day of month following quarter end
  const quarterEnd = Math.floor(currentMonth / 3) * 3 + 2
  if (currentMonth <= quarterEnd) {
    const quarterlyDue = new Date(currentYear, quarterEnd + 2, 0)
    const quarterLabel = `Q${Math.floor(quarterEnd / 3) + 1} ${currentYear}`
    deadlines.push({
      type: 'combined',
      period: 'quarterly',
      periodLabel: quarterLabel,
      dueDate: quarterlyDue.toISOString().split('T')[0],
      daysUntilDue: Math.ceil((quarterlyDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
    })
  }

  // Check which filings already exist
  const existingResult = await db.execute(sql`
    SELECT filing_type, period, period_start, period_end, status FROM tax_filings
    WHERE company_id = ${currentUser.companyId}
      AND status IN ('calculated', 'reviewed', 'filed')
    ORDER BY period_end DESC
    LIMIT 20
  `)
  const existingFilings = (existingResult as any).rows || existingResult

  return c.json({ deadlines, recentFilings: existingFilings })
})

// GET /filings/summary — Tax summary: YTD totals
app.get('/filings/summary', async (c) => {
  const currentUser = c.get('user') as any

  const yearStart = new Date(new Date().getFullYear(), 0, 1)

  // Tax collected YTD from orders
  const collectedResult = await db.execute(sql`
    SELECT
      COALESCE(SUM(CAST(excise_tax AS numeric)), 0) as excise_collected,
      COALESCE(SUM(CAST(sales_tax AS numeric)), 0) as sales_collected,
      COALESCE(SUM(CAST(total_tax AS numeric)), 0) as total_collected
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND status = 'completed'
      AND completed_at >= ${yearStart}
  `)
  const collected = ((collectedResult as any).rows || collectedResult)?.[0] || {}

  // Tax filed YTD
  const filedResult = await db.execute(sql`
    SELECT
      COALESCE(SUM(total_tax_due), 0) as total_filed,
      COUNT(*) FILTER (WHERE status = 'filed')::int as filings_filed,
      COUNT(*) FILTER (WHERE status IN ('calculated', 'reviewed'))::int as filings_outstanding
    FROM tax_filings
    WHERE company_id = ${currentUser.companyId}
      AND period_end >= ${yearStart}
  `)
  const filed = ((filedResult as any).rows || filedResult)?.[0] || {}

  return c.json({
    totalCollectedYTD: Number(collected.total_collected) || 0,
    exciseCollectedYTD: Number(collected.excise_collected) || 0,
    salesCollectedYTD: Number(collected.sales_collected) || 0,
    totalFiledYTD: Number(filed.total_filed) || 0,
    totalOutstanding: Math.max(0, (Number(collected.total_collected) || 0) - (Number(filed.total_filed) || 0)),
    filingsFiled: filed.filings_filed || 0,
    filingsOutstanding: filed.filings_outstanding || 0,
  })
})

export default app

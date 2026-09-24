import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'
import { settledSale, taxCollected, taxNetExprBare, exciseNetExprBare, salesNetExprBare } from '../utils/revenue.ts'

const app = new Hono()
// Manager and up. Every route in this file is the shop's position with the state — what it owes,
// what it has filed, what is outstanding. A budtender needs none of it to serve a customer, and it
// was readable by anyone signed in. Generating and reviewing a filing already required manager.
// (Dispensary T39 M3)
app.use('*', authenticate, requireRole('manager'))

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
    SELECT *,
      filing_type   AS "type",
      period_start  AS "startDate",
      period_end    AS "endDate",
      total_tax_due AS "totalAmount"
    FROM tax_filings
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

// Map the filing-type values the UI offers onto the schema's filing_type enum
// (excise_tax|sales_tax|local_tax|combined).
const FILING_TYPE_MAP: Record<string, string> = {
  state_excise: 'excise_tax',
  local_excise: 'local_tax',
  city_tax: 'local_tax',
  sales_tax: 'sales_tax',
  excise_tax: 'excise_tax',
  local_tax: 'local_tax',
  combined: 'combined',
}

// POST /filings/generate — Generate a tax filing.
// The Tax Filing page posts { type, period, startDate, endDate }; older/API callers may send
// { filingType, periodStart, periodEnd, state }. Accept either loosely. `state` is optional
// (the UI does not collect it). Tax breakdown is stored in filing_data (schema has no per-type
// columns); tax_filings has no filing_number/total_orders/*_tax_due/category_breakdown columns.
app.post('/filings/generate', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json().catch(() => ({}))

  const generateSchema = z.object({
    type: z.string().optional(),
    filingType: z.string().optional(),
    period: z.enum(['monthly', 'quarterly', 'annual']).default('monthly'),
    startDate: z.string().optional(),
    periodStart: z.string().optional(),
    endDate: z.string().optional(),
    periodEnd: z.string().optional(),
    state: z.string().optional(),
    jurisdiction: z.string().optional(),
  })
  const data = generateSchema.parse(body)

  const rawType = data.type || data.filingType || 'combined'
  const filingType = FILING_TYPE_MAP[rawType] || 'combined'
  const startStr = data.startDate || data.periodStart
  const endStr = data.endDate || data.periodEnd
  if (!startStr || !endStr) return c.json({ error: 'startDate and endDate are required' }, 400)

  const periodStart = new Date(startStr)
  const periodEnd = new Date(endStr)
  if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
    return c.json({ error: 'Invalid date range' }, 400)
  }
  // "2026-09-30" parses to the INSTANT that day begins, and the queries below bound on
  // `completed_at <= periodEnd` — so a September filing counted nothing that happened on the 30th,
  // and a single-day filing counted nothing at all. A period named by two dates means the whole of
  // both days, which is what the start bound already assumes. Only a bare date is extended; a caller
  // that sends a timestamp means that instant. (Dispensary T31, found proving L4)
  const periodEndBound = /^\d{4}-\d{2}-\d{2}$/.test(String(endStr))
    ? new Date(periodEnd.getTime() + 86_400_000 - 1)
    : periodEnd
  const state = data.state ? data.state.toUpperCase().slice(0, 2) : null

  // The sales tax was actually collected on, in the period. orders.subtotal/excise_tax/sales_tax/total_tax
  // are TEXT; NULLIF guards empty strings before the numeric cast.
  //
  // This counted status = 'completed' alone, which dropped every partially-refunded sale — and with it the
  // whole of that sale's tax, not just the refunded share. The figure a return is filed from was the one
  // under-reporting the liability. It now uses the same row set as the EOD and compliance tax reports, so
  // the number you file matches the number you reconcile against. (T23 H1)
  // Two row sets on purpose, and the difference is the whole of T31 L4.
  //
  // COUNT is "sales in this period", which has one answer everywhere in this product: the settled set,
  // fully refunded sales included. Filing over taxCollected alone reported 31 sales on a day every
  // other surface called 33, and a count that disagrees with the rest of the CRM is the kind of thing
  // a person notices on the one report they sign.
  //
  // MONEY stays on taxCollected. A sale handed back in full handed its tax back too, so it owes
  // nothing — but a legacy row refunded before refunded_tax existed records no returned tax, and
  // widening the sums would credit the state with its gross. The filing is not the place to find out.
  // (Dispensary T31 L4)
  const ordersResult = await db.execute(sql`
    SELECT
      COUNT(*)::int as total_orders,
      COALESCE(SUM(CAST(NULLIF(subtotal, '') AS numeric)) FILTER (WHERE status IN ${taxCollected}), 0) as total_subtotal,
      -- NET of tax handed back with refunds, like every other tax surface. This summed the gross, so
      -- once refunds started being netted elsewhere (T29 M4) this became the one report left
      -- over-stating: $1,056.00 here against $1,031.68 everywhere else, the gap widening with every
      -- amount refund — on the figure someone actually files. There are TWO tax-filing surfaces, this
      -- route and the block inside compliance.ts, and M4 only found the other one. (Dispensary T31)
      COALESCE(SUM(${exciseNetExprBare}) FILTER (WHERE status IN ${taxCollected}), 0) as total_excise_tax,
      COALESCE(SUM(${salesNetExprBare}) FILTER (WHERE status IN ${taxCollected}), 0) as total_sales_tax,
      COALESCE(SUM(${taxNetExprBare}) FILTER (WHERE status IN ${taxCollected}), 0) as total_tax_collected,
      COALESCE(SUM(CAST(NULLIF(total, '') AS numeric)) FILTER (WHERE status IN ${taxCollected}), 0) as total_revenue
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND status IN ${settledSale}
      AND completed_at >= ${periodStart}
      AND completed_at <= ${periodEndBound}
  `)
  const orderStats = ((ordersResult as any).rows || ordersResult)?.[0] || {}

  // Category breakdown
  const categoryResult = await db.execute(sql`
    SELECT
      oi.category,
      COUNT(DISTINCT o.id)::int as order_count,
      SUM(oi.quantity)::int as units_sold,
      COALESCE(SUM(CAST(NULLIF(oi.line_total, '') AS numeric)), 0) as category_revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.company_id = ${currentUser.companyId}
      AND o.status = 'completed'
      AND o.completed_at >= ${periodStart}
      AND o.completed_at <= ${periodEndBound}
    GROUP BY oi.category
    ORDER BY category_revenue DESC
  `)
  const categoryBreakdown = (categoryResult as any).rows || categoryResult

  const filingNumber = `TAX-${filingType.toUpperCase().replace(/_/g, '')}-${state || 'NA'}-${startStr.slice(0, 7)}-${Date.now().toString(36).toUpperCase()}`

  // Local tax uses the rate configured in Settings (company.local_tax_rate, a
  // percent). Default 0 — never fabricate a rate. Excise/sales come from the real
  // per-order tax columns summed above.
  const localRateResult: any = await db.execute(sql`SELECT COALESCE(NULLIF(local_tax_rate, ''), '0') AS local_tax_rate FROM company WHERE id = ${currentUser.companyId}`)
  const localRatePct = Number(((localRateResult.rows || localRateResult)[0] || {}).local_tax_rate) || 0

  // Determine tax amounts based on filing type
  let exciseTaxDue = Number(orderStats.total_excise_tax) || 0
  let salesTaxDue = Number(orderStats.total_sales_tax) || 0
  let localTaxDue = 0

  if (filingType === 'excise_tax') {
    salesTaxDue = 0
  } else if (filingType === 'sales_tax') {
    exciseTaxDue = 0
  } else if (filingType === 'local_tax') {
    exciseTaxDue = 0
    salesTaxDue = 0
    localTaxDue = (Number(orderStats.total_subtotal) || 0) * (localRatePct / 100)
  }

  const totalTaxDue = exciseTaxDue + salesTaxDue + localTaxDue
  const taxableAmount = Number(orderStats.total_subtotal) || 0
  const totalCollected = Number(orderStats.total_tax_collected) || 0

  // Line items the detail modal renders (only non-zero components).
  const lineItems = [
    { description: 'Excise Tax', amount: exciseTaxDue },
    { description: 'Sales Tax', amount: salesTaxDue },
    { description: 'Local Tax', amount: localTaxDue },
  ].filter(li => li.amount > 0)

  const filingData = {
    filingNumber,
    totalOrders: orderStats.total_orders || 0,
    taxableSales: taxableAmount,
    exciseTaxDue,
    salesTaxDue,
    localTaxDue,
    categoryBreakdown,
    lineItems,
  }

  // Store filing using the real tax_filings columns.
  const result = await db.execute(sql`
    INSERT INTO tax_filings (
      id, filing_type, period, period_start, period_end, state, jurisdiction, status,
      total_taxable_amount, total_tax_due, total_tax_collected, filing_data,
      company_id, created_at, updated_at
    )
    VALUES (
      gen_random_uuid(), ${filingType}, ${data.period},
      ${periodStart}, ${periodEnd}, ${state}, ${data.jurisdiction || null},
      'calculated',
      ${taxableAmount.toFixed(2)}, ${totalTaxDue.toFixed(2)}, ${totalCollected.toFixed(2)},
      ${JSON.stringify(filingData)}::jsonb,
      ${currentUser.companyId}, NOW(), NOW()
    )
    RETURNING *, filing_type AS "type", period_start AS "startDate", period_end AS "endDate", total_tax_due AS "totalAmount"
  `)

  const filing = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'tax_filing',
    entityId: filing?.id,
    entityName: filingNumber,
    metadata: { filingType, period: data.period, state, totalTaxDue },
    req: c,
  })

  return c.json(filing, 201)
})

// PUT /filings/:id/review — Mark as reviewed (manager+)
app.put('/filings/:id/review', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  // tax_filings has no reviewed_at / reviewed_by columns — only status + updated_at.
  const result = await db.execute(sql`
    UPDATE tax_filings
    SET status = 'reviewed', updated_at = NOW()
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
    req: c,
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
    req: c,
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

  // orders.excise_tax/sales_tax/total_tax are TEXT; NULLIF guards empty strings before cast.
  const collectedResult = await db.execute(sql`
    SELECT
      -- NET of tax handed back with returns, like every other tax surface in this product. Summing
      -- the gross here is what made Tax Filing read $1,056.00 against $1,031.68 everywhere else, and
      -- the gap grew with every amount refund. (Dispensary T31 M3)
      COALESCE(SUM(${exciseNetExprBare}), 0) as excise_collected,
      COALESCE(SUM(${salesNetExprBare}), 0) as sales_collected,
      COALESCE(SUM(${taxNetExprBare}), 0) as total_collected
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND status IN ${taxCollected}
      AND completed_at >= ${yearStart}
  `)
  const collected = ((collectedResult as any).rows || collectedResult)?.[0] || {}

  // tax_filings.total_tax_due is a TEXT column; SUM(text) throws — cast per-row (NULLIF guards
  // empty strings). (schema fix)
  const filedResult = await db.execute(sql`
    SELECT
      COALESCE(SUM(CAST(NULLIF(total_tax_due, '') AS numeric)), 0) as total_filed,
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

// GET /filings/:id — Filing detail with breakdown.
// Declared AFTER the literal /filings/upcoming and /filings/summary routes so the ':id'
// wildcard doesn't shadow them (previously they resolved here and 404'd as "Filing not found").
app.get('/filings/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    SELECT *,
      filing_type   AS "type",
      period_start  AS "startDate",
      period_end    AS "endDate",
      total_tax_due AS "totalAmount",
      filing_data->'lineItems' AS "lineItems"
    FROM tax_filings
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)

  const filing = ((result as any).rows || result)?.[0]
  if (!filing) return c.json({ error: 'Filing not found' }, 404)

  return c.json(filing)
})

// GET /deadlines — Upcoming filing deadlines as a flat array (Upcoming tab).
// Each item: { type, period, description, dueDate }.
app.get('/deadlines', async (c) => {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const monthLabel = new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const deadlines: any[] = []

  // Monthly excise tax: due the 20th of the following month
  deadlines.push({
    type: 'excise_tax',
    period: 'monthly',
    description: `Excise tax for ${monthLabel}`,
    dueDate: new Date(y, m + 1, 20).toISOString().split('T')[0],
  })

  // Monthly sales tax: due the last day of the following month
  deadlines.push({
    type: 'sales_tax',
    period: 'monthly',
    description: `Sales tax for ${monthLabel}`,
    dueDate: new Date(y, m + 2, 0).toISOString().split('T')[0],
  })

  // Quarterly combined: due the last day of the month following quarter end
  const quarterEnd = Math.floor(m / 3) * 3 + 2
  deadlines.push({
    type: 'combined',
    period: 'quarterly',
    description: `Q${Math.floor(quarterEnd / 3) + 1} ${y} combined filing`,
    dueDate: new Date(y, quarterEnd + 2, 0).toISOString().split('T')[0],
  })

  return c.json(deadlines)
})

// GET /summary — YTD tax summary (Summary tab).
// { totalCollected, totalFiled, outstanding, breakdown: [{ type, collected, filed, outstanding }] }.
app.get('/summary', async (c) => {
  const currentUser = c.get('user') as any
  const yearStart = new Date(new Date().getFullYear(), 0, 1)

  // orders.excise_tax/sales_tax/total_tax/total are TEXT; NULLIF guards empty strings.
  const collectedResult = await db.execute(sql`
    SELECT
      -- NET of tax handed back with returns, like every other tax surface in this product. Summing
      -- the gross here is what made Tax Filing read $1,056.00 against $1,031.68 everywhere else, and
      -- the gap grew with every amount refund. (Dispensary T31 M3)
      COALESCE(SUM(${exciseNetExprBare}), 0) as excise_collected,
      COALESCE(SUM(${salesNetExprBare}), 0) as sales_collected,
      COALESCE(SUM(${taxNetExprBare}), 0) as total_collected
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND status IN ${taxCollected}
      AND completed_at >= ${yearStart}
  `)
  const collected = ((collectedResult as any).rows || collectedResult)?.[0] || {}

  // tax_filings.total_tax_due is TEXT; cast per-row. Group filed amounts by filing_type.
  const filedResult = await db.execute(sql`
    SELECT filing_type,
      COALESCE(SUM(CAST(NULLIF(total_tax_due, '') AS numeric)), 0) as filed
    FROM tax_filings
    WHERE company_id = ${currentUser.companyId}
      AND period_end >= ${yearStart}
    GROUP BY filing_type
  `)
  const filedRows = (filedResult as any).rows || filedResult
  const filedByType: Record<string, number> = {}
  let totalFiled = 0
  for (const r of filedRows) {
    filedByType[r.filing_type] = Number(r.filed) || 0
    totalFiled += Number(r.filed) || 0
  }

  const exciseCollected = Number(collected.excise_collected) || 0
  const salesCollected = Number(collected.sales_collected) || 0
  const totalCollected = Number(collected.total_collected) || 0
  const localCollected = Math.max(0, totalCollected - exciseCollected - salesCollected)

  const row = (type: string, label: string, coll: number, filed: number) => ({
    type: label,
    collected: coll,
    filed,
    outstanding: Math.max(0, coll - filed),
  })

  const breakdown = [
    row('excise_tax', 'Excise Tax', exciseCollected, filedByType['excise_tax'] || 0),
    row('sales_tax', 'Sales Tax', salesCollected, filedByType['sales_tax'] || 0),
    row('local_tax', 'Local Tax', localCollected, (filedByType['local_tax'] || 0) + (filedByType['combined'] || 0)),
  ]

  return c.json({
    totalCollected,
    totalFiled,
    outstanding: Math.max(0, totalCollected - totalFiled),
    breakdown,
  })
})

export default app

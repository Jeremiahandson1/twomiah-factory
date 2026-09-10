import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// Raw-SQL rows come back snake_case, but the frontend reads camelCase — so fields
// (license_type, expiration_date, report_data, etc.) rendered blank. Convert row keys
// to camelCase before responding.
const camel = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}

// -- Zod schemas --

const licenseSchema = z.object({
  licenseType: z.string().min(1),
  licenseNumber: z.string().min(1),
  issuedBy: z.string().optional(),
  issuedDate: z.string().optional(),
  expirationDate: z.string().optional(),
  status: z.enum(['active', 'expired', 'pending', 'suspended', 'revoked']).default('active'),
  state: z.string().optional(),
  city: z.string().optional(),
  category: z.string().optional(),
  notes: z.string().optional(),
  documentUrl: z.string().optional(),
  autoRenew: z.boolean().default(false),
})

// Canonical report types. The Compliance page (and older clients) send friendlier names —
// sales_tax / excise_tax / inventory_summary / waste_disposal / track_trace / patient_count /
// diversion_prevention — which used to fail the enum with a 400 the UI swallowed, so
// "Generate" did nothing (go-live QA H-1). Accept the aliases and map them here.
const REPORT_TYPES = ['daily_sales', 'inventory_snapshot', 'waste', 'transfer', 'metrc_reconciliation', 'tax', 'patient_count', 'diversion'] as const
type ReportType = typeof REPORT_TYPES[number]
const REPORT_TYPE_ALIASES: Record<string, ReportType> = {
  sales_tax: 'tax', excise_tax: 'tax', tax_report: 'tax', taxes: 'tax',
  inventory_summary: 'inventory_snapshot', inventory: 'inventory_snapshot',
  waste_disposal: 'waste', waste_log: 'waste',
  track_trace: 'transfer', track_and_trace: 'transfer', transfers: 'transfer',
  metrc: 'metrc_reconciliation', metrc_reconcile: 'metrc_reconciliation',
  patients: 'patient_count', patient_counts: 'patient_count',
  diversion_prevention: 'diversion', diversion_report: 'diversion',
  sales: 'daily_sales', daily: 'daily_sales',
}
const reportGenerateSchema = z.object({
  reportType: z.string().min(1).transform((v, ctx) => {
    const key = v.trim().toLowerCase()
    const canonical = (REPORT_TYPES as readonly string[]).includes(key) ? (key as ReportType) : REPORT_TYPE_ALIASES[key]
    if (!canonical) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown reportType "${v}". Allowed: ${REPORT_TYPES.join(', ')} (aliases: ${Object.keys(REPORT_TYPE_ALIASES).join(', ')})` })
      return z.NEVER
    }
    return canonical
  }),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
})

// Waste entries: the Compliance form sends { unit, witness, batchNumber, notes } while the
// API wanted { unitOfMeasure, witnessedBy, batchId } — a 400 the modal swallowed, so nothing
// was ever saved (go-live QA H-2). Accept both spellings.
const wasteSchema = z.object({
  productId: z.string().min(1),
  batchId: z.string().min(1).optional(),
  batchNumber: z.string().optional(),
  metrcTag: z.string().optional(),
  wasteType: z.string().min(1).optional(),
  waste_type: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  quantity: z.coerce.number().min(0),
  unitOfMeasure: z.string().min(1).optional(),
  unit_of_measure: z.string().min(1).optional(),
  unit: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  waste_reason: z.string().min(1).optional(),
  method: z.string().optional(),
  disposalMethod: z.string().optional(),
  disposal_method: z.string().optional(),
  witnessedBy: z.string().optional(),
  witnessed_by: z.string().optional(),
  witness: z.string().optional(),
  witnessName: z.string().optional(),
  witness_name: z.string().optional(),
  notes: z.string().optional(),
}).transform((d, ctx) => {
  // Accept camelCase, snake_case and the form's short names for every field (retest: API field map).
  const wasteType = d.wasteType || d.waste_type || d.type
  const reason = d.reason || d.waste_reason
  if (!wasteType) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['wasteType'], message: 'wasteType is required' })
  if (!reason) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'reason is required' })
  return {
    ...d,
    wasteType: wasteType as string,
    reason: reason as string,
    unitOfMeasure: d.unitOfMeasure || d.unit_of_measure || d.unit || 'grams',
    method: d.method || d.disposalMethod || d.disposal_method || undefined,
    witnessedBy: d.witnessedBy || d.witnessed_by || d.witness || d.witnessName || d.witness_name || undefined,
  }
})

// ==========================================
// Licenses
// ==========================================

// List licenses
app.get('/licenses', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT * FROM licenses
    WHERE company_id = ${currentUser.companyId}
    ORDER BY expiration_date ASC NULLS LAST
  `)

  return c.json(((result as any).rows || result).map(camel))
})

// Create license (manager+)
app.post('/licenses', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const data = licenseSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO licenses (
      id, company_id, license_type, license_number, issuing_authority,
      issued_date, expiration_date, status, state, city,
      notes, document_url,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), ${currentUser.companyId},
      ${data.licenseType}, ${data.licenseNumber},
      ${data.issuedBy || null},
      ${data.issuedDate ? new Date(data.issuedDate) : null},
      ${data.expirationDate ? new Date(data.expirationDate) : null},
      ${data.status}, ${data.state || null}, ${data.city || null},
      ${data.notes || null},
      ${data.documentUrl || null},
      NOW(), NOW()
    ) RETURNING *
  `)

  const created = ((result as any).rows || result)[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'license',
    entityId: created.id,
    entityName: `${created.license_type} - ${created.license_number}`,
    req: c.req,
  })

  return c.json(camel(created), 201)
})

// Update license (manager+)
app.put('/licenses/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = licenseSchema.partial().parse(await c.req.json())

  const existing = await db.execute(sql`
    SELECT * FROM licenses
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const found = ((existing as any).rows || existing)[0]
  if (!found) return c.json({ error: 'License not found' }, 404)

  const result = await db.execute(sql`
    UPDATE licenses SET
      license_type = COALESCE(${data.licenseType ?? null}, license_type),
      license_number = COALESCE(${data.licenseNumber ?? null}, license_number),
      issuing_authority = COALESCE(${data.issuedBy ?? null}, issuing_authority),
      issued_date = COALESCE(${data.issuedDate ? new Date(data.issuedDate) : null}, issued_date),
      expiration_date = COALESCE(${data.expirationDate ? new Date(data.expirationDate) : null}, expiration_date),
      status = COALESCE(${data.status ?? null}, status),
      state = COALESCE(${data.state ?? null}, state),
      city = COALESCE(${data.city ?? null}, city),
      notes = COALESCE(${data.notes ?? null}, notes),
      document_url = COALESCE(${data.documentUrl ?? null}, document_url),
      updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)[0]

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'license',
    entityId: updated.id,
    entityName: `${updated.license_type} - ${updated.license_number}`,
    req: c.req,
  })

  return c.json(camel(updated))
})

// Delete license (manager+)
app.delete('/licenses/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const existing = await db.execute(sql`
    SELECT * FROM licenses
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const found = ((existing as any).rows || existing)[0]
  if (!found) return c.json({ error: 'License not found' }, 404)

  await db.execute(sql`
    DELETE FROM licenses WHERE id = ${id}
  `)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'license',
    entityId: found.id,
    entityName: `${found.license_type} - ${found.license_number}`,
    req: c.req,
  })

  return c.json({ success: true })
})

// Licenses expiring soon
app.get('/licenses/expiring', async (c) => {
  const currentUser = c.get('user') as any
  const days = +(c.req.query('days') || '60')

  const result = await db.execute(sql`
    SELECT * FROM licenses
    WHERE company_id = ${currentUser.companyId}
      AND status = 'active'
      AND expiration_date IS NOT NULL
      AND expiration_date <= NOW() + INTERVAL '1 day' * ${days}
    ORDER BY expiration_date ASC
  `)

  return c.json(((result as any).rows || result).map(camel))
})

// ==========================================
// Compliance Reports
// ==========================================

// List reports (paginated, filterable)
app.get('/reports', async (c) => {
  const currentUser = c.get('user') as any
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')
  const reportType = c.req.query('type')
  const offset = (page - 1) * limit

  let typeFilter = sql``
  if (reportType) {
    typeFilter = sql`AND report_type = ${reportType}`
  }

  const [dataResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT * FROM compliance_reports
      WHERE company_id = ${currentUser.companyId}
        ${typeFilter}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int as total
      FROM compliance_reports
      WHERE company_id = ${currentUser.companyId}
        ${typeFilter}
    `),
  ])

  const data = ((dataResult as any).rows || dataResult).map(camel)
  const total = Number(((countResult as any).rows || countResult)[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Generate compliance report
app.post('/reports/generate', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const data = reportGenerateSchema.parse(await c.req.json())

  const startDate = new Date(data.startDate)
  const endDate = new Date(data.endDate)
  let reportData: any = null

  switch (data.reportType) {
    case 'daily_sales': {
      const result = await db.execute(sql`
        SELECT
          o.completed_at::date as sale_date,
          COUNT(*)::int as total_orders,
          COALESCE(SUM(o.total::numeric), 0) as total_revenue,
          COALESCE(SUM(o.total_tax::numeric), 0) as total_tax,
          COALESCE(SUM(o.discount_amount::numeric), 0) as total_discounts,
          COUNT(CASE WHEN o.is_medical = true THEN 1 END)::int as medical_orders,
          COUNT(CASE WHEN o.is_medical = false OR o.is_medical IS NULL THEN 1 END)::int as recreational_orders,
          COUNT(CASE WHEN o.type = 'delivery' THEN 1 END)::int as delivery_orders
        FROM orders o
        WHERE o.company_id = ${currentUser.companyId}
          AND o.status = 'completed'
          AND o.completed_at >= ${startDate}
          AND o.completed_at <= ${endDate}
        GROUP BY 1
        ORDER BY 1 ASC
      `)
      reportData = (result as any).rows || result
      break
    }

    case 'inventory_snapshot': {
      const result = await db.execute(sql`
        SELECT
          p.category,
          COUNT(*)::int as product_count,
          SUM(p.stock_quantity)::int as total_units,
          COALESCE(SUM(p.stock_quantity * p.cost_price::numeric), 0) as total_cost_value,
          COALESCE(SUM(p.stock_quantity * p.price::numeric), 0) as total_retail_value,
          COUNT(CASE WHEN p.stock_quantity <= p.low_stock_threshold THEN 1 END)::int as low_stock_count,
          COUNT(CASE WHEN p.stock_quantity = 0 THEN 1 END)::int as out_of_stock_count
        FROM products p
        WHERE p.company_id = ${currentUser.companyId}
          AND p.active = true
        GROUP BY p.category
        ORDER BY p.category ASC
      `)
      reportData = (result as any).rows || result
      break
    }

    case 'waste': {
      const result = await db.execute(sql`
        SELECT
          wl.waste_type,
          wl.reason,
          COUNT(*)::int as log_count,
          COALESCE(SUM(NULLIF(wl.quantity, '')::numeric), 0) as total_quantity,
          wl.unit_of_measure,
          COUNT(CASE WHEN wl.metrc_reported = true THEN 1 END)::int as reported_count,
          COUNT(CASE WHEN wl.metrc_reported = false OR wl.metrc_reported IS NULL THEN 1 END)::int as unreported_count
        FROM waste_log wl
        WHERE wl.company_id = ${currentUser.companyId}
          AND wl.created_at >= ${startDate}
          AND wl.created_at <= ${endDate}
        GROUP BY wl.waste_type, wl.reason, wl.unit_of_measure
        ORDER BY total_quantity DESC
      `)
      reportData = (result as any).rows || result
      break
    }

    case 'transfer': {
      // inventory_transfers has no transfer_type / total_items / metrc_manifest_id columns —
      // the old query 500'd. Summarise by route (from → to) and status, with item units from
      // the transfer lines, plus Metrc-tagged products moved.
      const result = await db.execute(sql`
        SELECT
          COALESCE(lf.name, 'external') as from_location,
          COALESCE(lt.name, 'external') as to_location,
          t.status,
          COUNT(DISTINCT t.id)::int as transfer_count,
          COALESCE(SUM(ti.quantity), 0)::int as total_units,
          COALESCE(SUM(ti.received_quantity), 0)::int as received_units,
          COUNT(DISTINCT ti.product_id) FILTER (WHERE p.metrc_tag IS NOT NULL AND p.metrc_tag <> '')::int as metrc_tagged_products,
          COUNT(DISTINCT ti.product_id) FILTER (WHERE p.metrc_tag IS NULL OR p.metrc_tag = '')::int as untagged_products
        FROM inventory_transfers t
        LEFT JOIN locations lf ON lf.id = t.from_location_id
        LEFT JOIN locations lt ON lt.id = t.to_location_id
        LEFT JOIN inventory_transfer_items ti ON ti.transfer_id = t.id
        LEFT JOIN products p ON p.id = ti.product_id
        WHERE t.company_id = ${currentUser.companyId}
          AND COALESCE(t.transferred_at, t.created_at) >= ${startDate}
          AND COALESCE(t.transferred_at, t.created_at) <= ${endDate}
        GROUP BY lf.name, lt.name, t.status
        ORDER BY lf.name, lt.name, t.status
      `)
      reportData = (result as any).rows || result
      break
    }

    case 'metrc_reconciliation': {
      const result = await db.execute(sql`
        SELECT
          p.id as product_id,
          p.name as product_name,
          p.sku,
          p.metrc_tag,
          p.stock_quantity as system_quantity,
          p.category,
          CASE WHEN p.metrc_tag IS NULL OR p.metrc_tag = '' THEN true ELSE false END as missing_metrc_tag
        FROM products p
        WHERE p.company_id = ${currentUser.companyId}
          AND p.active = true
          AND p.category != 'accessory'
          AND p.category != 'apparel'
        ORDER BY p.category, p.name
      `)
      reportData = (result as any).rows || result
      break
    }

    case 'tax': {
      const result = await db.execute(sql`
        SELECT
          o.completed_at::date as sale_date,
          COUNT(*)::int as order_count,
          COALESCE(SUM(o.subtotal::numeric), 0) as subtotal,
          COALESCE(SUM(o.total_tax::numeric), 0) as total_tax,
          COALESCE(SUM(NULLIF(o.excise_tax, '')::numeric), 0) as excise_tax,
          COALESCE(SUM(NULLIF(o.sales_tax, '')::numeric), 0) as sales_tax,
          -- orders has no city_tax column (that reference 500'd every tax report); local tax
          -- is whatever total tax isn't excise or sales.
          GREATEST(0, COALESCE(SUM(NULLIF(o.total_tax, '')::numeric), 0) - COALESCE(SUM(NULLIF(o.excise_tax, '')::numeric), 0) - COALESCE(SUM(NULLIF(o.sales_tax, '')::numeric), 0)) as local_tax,
          COALESCE(SUM(o.total::numeric), 0) as total_collected
        FROM orders o
        WHERE o.company_id = ${currentUser.companyId}
          AND o.status IN ('completed', 'partially_refunded')
          AND o.completed_at >= ${startDate}
          AND o.completed_at <= ${endDate}
        GROUP BY 1
        ORDER BY 1 ASC
      `)
      const rows = (result as any).rows || result
      const sum = (k: string) => rows.reduce((s: number, r: any) => s + Number(r[k] || 0), 0)
      reportData = {
        byDay: rows,
        totals: { orderCount: sum('order_count'), subtotal: sum('subtotal'), exciseTax: sum('excise_tax'), salesTax: sum('sales_tax'), localTax: sum('local_tax'), totalTax: sum('total_tax'), totalCollected: sum('total_collected') },
      }
      break
    }

    // Medical patient activity in the period (patient-count filings).
    case 'patient_count': {
      const result = await db.execute(sql`
        SELECT
          COUNT(DISTINCT o.contact_id) FILTER (WHERE o.is_medical = true)::int as unique_medical_patients,
          COUNT(*) FILTER (WHERE o.is_medical = true)::int as medical_orders,
          COUNT(DISTINCT o.contact_id) FILTER (WHERE o.is_medical = false OR o.is_medical IS NULL)::int as unique_adult_use_customers,
          COUNT(*) FILTER (WHERE o.is_medical = false OR o.is_medical IS NULL)::int as adult_use_orders,
          COUNT(DISTINCT o.medical_card_number) FILTER (WHERE o.medical_card_number IS NOT NULL AND o.medical_card_number <> '')::int as distinct_medical_cards
        FROM orders o
        WHERE o.company_id = ${currentUser.companyId}
          AND o.status IN ('completed', 'partially_refunded', 'refunded')
          AND o.completed_at >= ${startDate}
          AND o.completed_at <= ${endDate}
      `)
      const patientsOnFile = await db.execute(sql`
        SELECT COUNT(*)::int as patients_on_file,
               COUNT(*) FILTER (WHERE medical_card_expiry IS NOT NULL AND medical_card_expiry < CURRENT_DATE)::int as expired_cards
        FROM contact
        WHERE company_id = ${currentUser.companyId} AND medical_card_number IS NOT NULL AND medical_card_number <> ''
      `)
      reportData = { ...(((result as any).rows || result)[0] || {}), ...(((patientsOnFile as any).rows || patientsOnFile)[0] || {}) }
      break
    }

    // Diversion-prevention indicators: purchase-limit pressure, repeat same-day buyers,
    // unverified-ID completions, and voids/refunds in the period.
    case 'diversion': {
      const result = await db.execute(sql`
        SELECT
          COUNT(*)::int as completed_orders,
          COUNT(*) FILTER (WHERE COALESCE(NULLIF(o.total_cannabis_weight_oz, ''), '0')::numeric >= 0.8 * COALESCE(NULLIF(co.purchase_limit_oz, ''), '2.5')::numeric)::int as near_limit_orders,
          COUNT(*) FILTER (WHERE o.id_verified IS NOT TRUE)::int as unverified_id_orders,
          COUNT(*) FILTER (WHERE o.type = 'delivery')::int as delivery_orders,
          COALESCE(SUM(NULLIF(o.total_cannabis_weight_oz, '')::numeric), 0) as total_cannabis_oz_sold
        FROM orders o
        JOIN company co ON co.id = o.company_id
        WHERE o.company_id = ${currentUser.companyId}
          AND o.status IN ('completed', 'partially_refunded', 'refunded')
          AND o.completed_at >= ${startDate}
          AND o.completed_at <= ${endDate}
      `)
      const repeat = await db.execute(sql`
        SELECT o.contact_id, c.name as customer_name, o.completed_at::date as sale_date, COUNT(*)::int as orders_that_day,
               COALESCE(SUM(NULLIF(o.total_cannabis_weight_oz, '')::numeric), 0) as cannabis_oz_that_day
        FROM orders o LEFT JOIN contact c ON c.id = o.contact_id
        WHERE o.company_id = ${currentUser.companyId}
          AND o.status IN ('completed', 'partially_refunded', 'refunded')
          AND o.contact_id IS NOT NULL
          AND o.completed_at >= ${startDate}
          AND o.completed_at <= ${endDate}
        GROUP BY o.contact_id, c.name, o.completed_at::date
        HAVING COUNT(*) > 1
        ORDER BY cannabis_oz_that_day DESC
        LIMIT 100
      `)
      const voids = await db.execute(sql`
        SELECT COUNT(*) FILTER (WHERE status = 'cancelled')::int as voided_orders,
               COUNT(*) FILTER (WHERE status IN ('refunded', 'partially_refunded'))::int as refunded_orders
        FROM orders
        WHERE company_id = ${currentUser.companyId}
          AND COALESCE(refunded_at, updated_at, created_at) >= ${startDate}
          AND COALESCE(refunded_at, updated_at, created_at) <= ${endDate}
      `)
      reportData = {
        ...(((result as any).rows || result)[0] || {}),
        ...(((voids as any).rows || voids)[0] || {}),
        repeatSameDayBuyers: (repeat as any).rows || repeat,
      }
      break
    }
  }

  // Store report. Columns per schema.ts: the JSON lives in `data` (there is no report_data
  // column and no updated_at) — the old INSERT named both, which is why every generate 500'd.
  const period = Math.round((endDate.getTime() - startDate.getTime()) / 86400000) <= 1 ? 'daily'
    : Math.round((endDate.getTime() - startDate.getTime()) / 86400000) <= 7 ? 'weekly'
    : Math.round((endDate.getTime() - startDate.getTime()) / 86400000) <= 31 ? 'monthly'
    : Math.round((endDate.getTime() - startDate.getTime()) / 86400000) <= 92 ? 'quarterly' : 'annual'
  const [companyRow] = ((await db.execute(sql`SELECT state FROM company WHERE id = ${currentUser.companyId} LIMIT 1`)) as any).rows || []
  const reportResult = await db.execute(sql`
    INSERT INTO compliance_reports (
      id, company_id, report_type, period, start_date, end_date, state,
      data, status, generated_by, created_at
    ) VALUES (
      gen_random_uuid(), ${currentUser.companyId}, ${data.reportType}, ${period},
      ${startDate}, ${endDate}, ${companyRow?.state || null},
      ${JSON.stringify({ reportType: data.reportType, generatedAt: new Date().toISOString(), rows: reportData })}::json, 'generated',
      ${currentUser.userId}, NOW()
    ) RETURNING *
  `)

  const report = ((reportResult as any).rows || reportResult)[0]
  // Every report is downloadable as CSV (regulator-friendly) and printable as a formatted page.
  const fileUrl = `/api/compliance/reports/${report.id}/export?format=csv`
  await db.execute(sql`UPDATE compliance_reports SET file_url = ${fileUrl} WHERE id = ${report.id}`)
  report.file_url = fileUrl

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'compliance_report',
    entityId: report.id,
    metadata: { reportType: data.reportType, startDate: data.startDate, endDate: data.endDate },
    req: c.req,
  })

  return c.json({ ...camel(report), printUrl: `/api/compliance/reports/${report.id}/export?format=html` }, 201)
})

// ---- Export: CSV (download) or HTML (print → PDF) -------------------------------------------
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const csvCell = (v: unknown) => { let s = v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
const titleCase = (k: string) => k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, ch => ch.toUpperCase())
// Flatten a report's data into named sections: arrays of objects → tables, objects → key/value.
function reportSections(data: any): Array<{ name: string; columns?: string[]; rows?: any[]; pairs?: Array<[string, any]> }> {
  const out: Array<{ name: string; columns?: string[]; rows?: any[]; pairs?: Array<[string, any]> }> = []
  const walk = (name: string, v: any) => {
    if (Array.isArray(v)) {
      if (v.length && typeof v[0] === 'object') { const cols = Array.from(new Set(v.flatMap((r: any) => Object.keys(r || {})))); out.push({ name, columns: cols, rows: v }) }
      else out.push({ name, pairs: v.map((x: any, i: number) => [String(i + 1), x] as [string, any]) })
    } else if (v && typeof v === 'object') {
      const pairs: Array<[string, any]> = []
      for (const [k, val] of Object.entries(v)) { if (val && typeof val === 'object') walk(`${name === 'Report' ? '' : name + ' › '}${titleCase(k)}`, val); else pairs.push([titleCase(k), val]) }
      if (pairs.length) out.unshift({ name, pairs })
    } else out.push({ name, pairs: [[name, v]] })
  }
  const payload = data && typeof data === 'object' && 'rows' in data ? data.rows : data
  walk('Report', payload)
  return out
}

app.get('/reports/:id/export', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const format = (c.req.query('format') || 'csv').toLowerCase()
  const result = await db.execute(sql`
    SELECT r.*, co.name as company_name, co.license_number, co.state as company_state, co.address, co.city, co.zip
    FROM compliance_reports r JOIN company co ON co.id = r.company_id
    WHERE r.id = ${id} AND r.company_id = ${currentUser.companyId} LIMIT 1
  `)
  const report = ((result as any).rows || result)[0]
  if (!report) return c.json({ error: 'Report not found' }, 404)
  const data = typeof report.data === 'string' ? JSON.parse(report.data) : report.data
  const label = String(report.report_type || 'report')
  const period = `${String(report.start_date).slice(0, 10)} to ${String(report.end_date).slice(0, 10)}`
  const sections = reportSections(data)
  const fname = `${label}-${String(report.start_date).slice(0, 10)}_${String(report.end_date).slice(0, 10)}`

  if (format === 'csv') {
    const lines: string[] = []
    lines.push(['Report', titleCase(label)].map(csvCell).join(','))
    lines.push(['Licensee', report.company_name, 'License', report.license_number || '', 'State', report.company_state || ''].map(csvCell).join(','))
    lines.push(['Period', period, 'Status', report.status, 'Generated', String(report.created_at)].map(csvCell).join(','))
    lines.push('')
    for (const s of sections) {
      lines.push(csvCell(s.name))
      if (s.columns) { lines.push(s.columns.map(k => csvCell(titleCase(k))).join(',')); for (const r of s.rows || []) lines.push(s.columns.map(k => csvCell(r?.[k])).join(',')) }
      else for (const [k, v] of s.pairs || []) lines.push([k, v].map(csvCell).join(','))
      lines.push('')
    }
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', `attachment; filename="${fname}.csv"`)
    return c.body('﻿' + lines.join('\r\n'))
  }

  // Printable HTML (browser → Save as PDF). Escaped throughout; no scripts.
  const sectionHtml = sections.map(s => {
    if (s.columns) return `<h2>${esc(s.name)}</h2><table><thead><tr>${s.columns.map(k => `<th>${esc(titleCase(k))}</th>`).join('')}</tr></thead><tbody>${(s.rows || []).map(r => `<tr>${s.columns!.map(k => `<td>${esc(typeof r?.[k] === 'object' && r?.[k] != null ? JSON.stringify(r[k]) : r?.[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    return `<h2>${esc(s.name)}</h2><table class="kv"><tbody>${(s.pairs || []).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`
  }).join('')
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(titleCase(label))} — ${esc(period)}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:32px;color:#111;font-size:12px}h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 6px;border-bottom:1px solid #ddd;padding-bottom:2px}.meta{color:#555;margin-bottom:8px}table{border-collapse:collapse;width:100%;margin-bottom:8px}th,td{border:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}th{background:#f5f5f5}table.kv th{width:32%}.foot{margin-top:24px;color:#777;font-size:10px}@media print{body{margin:12mm}}</style></head>
<body><h1>${esc(titleCase(label))}</h1>
<div class="meta"><strong>${esc(report.company_name)}</strong>${report.license_number ? ` · License ${esc(report.license_number)}` : ''}${report.company_state ? ` · ${esc(report.company_state)}` : ''}<br>Period ${esc(period)} · Status ${esc(report.status)} · Generated ${esc(String(report.created_at))}${report.submitted_at ? ` · Submitted ${esc(String(report.submitted_at))}` : ''}</div>
${sectionHtml}
<div class="foot">Report ${esc(report.id)} · generated by the point-of-sale compliance module. Figures are as recorded at generation time.</div>
</body></html>`
  c.header('Content-Type', 'text/html; charset=utf-8')
  c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
  return c.body(html)
})

// Get report detail
app.get('/reports/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    SELECT * FROM compliance_reports
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const report = ((result as any).rows || result)[0]
  if (!report) return c.json({ error: 'Report not found' }, 404)

  return c.json(camel(report))
})

// Submit report
app.post('/reports/:id/submit', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const existing = await db.execute(sql`
    SELECT * FROM compliance_reports
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const found = ((existing as any).rows || existing)[0]
  if (!found) return c.json({ error: 'Report not found' }, 404)

  // compliance_reports has submitted_at but no submitted_by/updated_at; record who submitted in notes.
  const result = await db.execute(sql`
    UPDATE compliance_reports
    SET status = 'submitted', submitted_at = NOW(),
        notes = COALESCE(notes, '') || ${`Submitted by ${currentUser.email || currentUser.userId} at ${new Date().toISOString()}. `}
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)[0]

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'compliance_report',
    entityId: id,
    changes: { status: { from: found.status, to: 'submitted' } },
    req: c.req,
  })

  return c.json(camel(updated))
})

// ==========================================
// Waste Tracking
// ==========================================

// List waste logs (paginated)
app.get('/waste', async (c) => {
  const currentUser = c.get('user') as any
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')
  const offset = (page - 1) * limit

  const [dataResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT wl.*, p.name as product_name, p.sku as product_sku, b.batch_number,
             wl.witnessed_by as witness, wl.unit_of_measure as unit,
             wl.metrc_reported as reported_to_metrc
      FROM waste_log wl
      LEFT JOIN products p ON p.id = wl.product_id
      LEFT JOIN batches b ON b.id = wl.batch_id
      WHERE wl.company_id = ${currentUser.companyId}
      ORDER BY wl.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int as total
      FROM waste_log
      WHERE company_id = ${currentUser.companyId}
    `),
  ])

  const data = ((dataResult as any).rows || dataResult).map(camel)
  const total = Number(((countResult as any).rows || countResult)[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Log waste
app.post('/waste', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const data = wasteSchema.parse(await c.req.json())

  // Resolve a typed batch number to the batch row (the form collects a number, not an id).
  let batchId: string | null = data.batchId || null
  if (!batchId && data.batchNumber) {
    const b = await db.execute(sql`SELECT id FROM batches WHERE company_id = ${currentUser.companyId} AND batch_number = ${data.batchNumber.trim()} LIMIT 1`)
    batchId = (((b as any).rows || b)[0]?.id as string) || null
  }
  // waste_log has no notes column; keep the operator's note with the reason so it is not lost.
  const reason = data.notes ? `${data.reason} — ${data.notes}` : data.reason

  // Columns per schema.ts: metrc_reported (not reported_to_metrc), no updated_at, quantity is
  // TEXT. The old INSERT named two non-existent columns, so every waste entry 500'd.
  const result = await db.execute(sql`
    INSERT INTO waste_log (
      id, company_id, product_id, batch_id, metrc_tag,
      waste_type, quantity, unit_of_measure, reason, method,
      witnessed_by, metrc_reported, logged_by, created_at
    ) VALUES (
      gen_random_uuid(), ${currentUser.companyId},
      ${data.productId}, ${batchId}, ${data.metrcTag || null},
      ${data.wasteType}, ${String(data.quantity)}, ${data.unitOfMeasure},
      ${reason}, ${data.method || null},
      ${data.witnessedBy || null}, false, ${currentUser.userId},
      NOW()
    ) RETURNING *, witnessed_by as witness, unit_of_measure as unit, metrc_reported as reported_to_metrc
  `)

  const created = ((result as any).rows || result)[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'waste_log',
    entityId: created.id,
    metadata: {
      productId: data.productId,
      wasteType: data.wasteType,
      quantity: data.quantity,
      unitOfMeasure: data.unitOfMeasure,
      reason: data.reason,
    },
    req: c.req,
  })

  return c.json(camel(created), 201)
})

// Mark waste as reported to Metrc
app.put('/waste/:id/metrc', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const existing = await db.execute(sql`
    SELECT * FROM waste_log
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const found = ((existing as any).rows || existing)[0]
  if (!found) return c.json({ error: 'Waste log not found' }, 404)

  const result = await db.execute(sql`
    UPDATE waste_log
    SET metrc_reported = true, metrc_reported_at = NOW()
    WHERE id = ${id}
    RETURNING *, witnessed_by as witness, unit_of_measure as unit, metrc_reported as reported_to_metrc
  `)

  const updated = ((result as any).rows || result)[0]

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'waste_log',
    entityId: id,
    changes: { metrc_reported: { from: false, to: true } },
    req: c.req,
  })

  return c.json(camel(updated))
})

export default app

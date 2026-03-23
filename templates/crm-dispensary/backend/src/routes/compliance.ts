import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

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

const reportGenerateSchema = z.object({
  reportType: z.enum(['daily_sales', 'inventory_snapshot', 'waste', 'transfer', 'metrc_reconciliation', 'tax']),
  startDate: z.string(),
  endDate: z.string(),
})

const wasteSchema = z.object({
  productId: z.string().uuid(),
  batchId: z.string().uuid().optional(),
  metrcTag: z.string().optional(),
  wasteType: z.string().min(1),
  quantity: z.number().min(0),
  unitOfMeasure: z.string().min(1),
  reason: z.string().min(1),
  method: z.string().optional(),
  witnessedBy: z.string().optional(),
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

  return c.json((result as any).rows || result)
})

// Create license (manager+)
app.post('/licenses', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const data = licenseSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO licenses (
      id, company_id, license_type, license_number, issued_by,
      issued_date, expiration_date, status, state, city,
      category, notes, document_url, auto_renew,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), ${currentUser.companyId},
      ${data.licenseType}, ${data.licenseNumber},
      ${data.issuedBy || null},
      ${data.issuedDate ? new Date(data.issuedDate) : null},
      ${data.expirationDate ? new Date(data.expirationDate) : null},
      ${data.status}, ${data.state || null}, ${data.city || null},
      ${data.category || null}, ${data.notes || null},
      ${data.documentUrl || null}, ${data.autoRenew},
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

  return c.json(created, 201)
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
      issued_by = COALESCE(${data.issuedBy ?? null}, issued_by),
      issued_date = COALESCE(${data.issuedDate ? new Date(data.issuedDate) : null}, issued_date),
      expiration_date = COALESCE(${data.expirationDate ? new Date(data.expirationDate) : null}, expiration_date),
      status = COALESCE(${data.status ?? null}, status),
      state = COALESCE(${data.state ?? null}, state),
      city = COALESCE(${data.city ?? null}, city),
      category = COALESCE(${data.category ?? null}, category),
      notes = COALESCE(${data.notes ?? null}, notes),
      document_url = COALESCE(${data.documentUrl ?? null}, document_url),
      auto_renew = COALESCE(${data.autoRenew ?? null}, auto_renew),
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

  return c.json(updated)
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

  return c.json((result as any).rows || result)
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

  const data = (dataResult as any).rows || dataResult
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
          SUM(wl.quantity) as total_quantity,
          wl.unit_of_measure,
          COUNT(CASE WHEN wl.reported_to_metrc = true THEN 1 END)::int as reported_count,
          COUNT(CASE WHEN wl.reported_to_metrc = false OR wl.reported_to_metrc IS NULL THEN 1 END)::int as unreported_count
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
      const result = await db.execute(sql`
        SELECT
          t.transfer_type,
          t.status,
          COUNT(*)::int as transfer_count,
          COALESCE(SUM(t.total_items)::int, 0) as total_items,
          COUNT(CASE WHEN t.metrc_manifest_id IS NOT NULL THEN 1 END)::int as with_manifest,
          COUNT(CASE WHEN t.metrc_manifest_id IS NULL THEN 1 END)::int as without_manifest
        FROM inventory_transfers t
        WHERE t.company_id = ${currentUser.companyId}
          AND t.created_at >= ${startDate}
          AND t.created_at <= ${endDate}
        GROUP BY t.transfer_type, t.status
        ORDER BY t.transfer_type, t.status
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
          COALESCE(SUM(o.excise_tax::numeric), 0) as excise_tax,
          COALESCE(SUM(o.sales_tax::numeric), 0) as sales_tax,
          COALESCE(SUM(o.city_tax::numeric), 0) as city_tax,
          COALESCE(SUM(o.total::numeric), 0) as total_collected
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
  }

  // Store report
  const reportResult = await db.execute(sql`
    INSERT INTO compliance_reports (
      id, company_id, report_type, start_date, end_date,
      report_data, status, generated_by, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), ${currentUser.companyId}, ${data.reportType},
      ${startDate}, ${endDate},
      ${JSON.stringify(reportData)}::jsonb, 'generated',
      ${currentUser.userId}, NOW(), NOW()
    ) RETURNING *
  `)

  const report = ((reportResult as any).rows || reportResult)[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'compliance_report',
    entityId: report.id,
    metadata: { reportType: data.reportType, startDate: data.startDate, endDate: data.endDate },
    req: c.req,
  })

  return c.json(report, 201)
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

  return c.json(report)
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

  const result = await db.execute(sql`
    UPDATE compliance_reports
    SET status = 'submitted', submitted_at = NOW(), submitted_by = ${currentUser.userId}, updated_at = NOW()
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

  return c.json(updated)
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
      SELECT wl.*, p.name as product_name, p.sku as product_sku
      FROM waste_log wl
      LEFT JOIN products p ON p.id = wl.product_id
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

  const data = (dataResult as any).rows || dataResult
  const total = Number(((countResult as any).rows || countResult)[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Log waste
app.post('/waste', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const data = wasteSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO waste_log (
      id, company_id, product_id, batch_id, metrc_tag,
      waste_type, quantity, unit_of_measure, reason, method,
      witnessed_by, reported_to_metrc, logged_by,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(), ${currentUser.companyId},
      ${data.productId}, ${data.batchId || null}, ${data.metrcTag || null},
      ${data.wasteType}, ${data.quantity}, ${data.unitOfMeasure},
      ${data.reason}, ${data.method || null},
      ${data.witnessedBy || null}, false, ${currentUser.userId},
      NOW(), NOW()
    ) RETURNING *
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

  return c.json(created, 201)
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
    SET reported_to_metrc = true, metrc_reported_at = NOW(), updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)[0]

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'waste_log',
    entityId: id,
    changes: { reported_to_metrc: { from: false, to: true } },
    req: c.req,
  })

  return c.json(updated)
})

export default app

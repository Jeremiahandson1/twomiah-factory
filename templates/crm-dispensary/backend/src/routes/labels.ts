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

const labelFieldSchema = z.object({
  key: z.string(),
  label: z.string().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  fontSize: z.number().optional(),
  fontWeight: z.string().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
})

const templateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['product', 'package', 'shelf', 'receipt']),
  width: z.number().min(0.5),
  height: z.number().min(0.5),
  orientation: z.enum(['portrait', 'landscape']).default('landscape'),
  fields: z.array(labelFieldSchema),
  includeQrCode: z.boolean().default(false),
  includeBarcode: z.boolean().default(false),
  includeLogo: z.boolean().default(false),
  includeThcWarning: z.boolean().default(true),
  includeLabResults: z.boolean().default(false),
  complianceState: z.string().optional(),
  isDefault: z.boolean().default(false),
})

const printJobSchema = z.object({
  templateId: z.string().uuid(),
  productId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  quantity: z.number().int().min(1).default(1),
})

const generateSchema = z.object({
  productId: z.string().uuid(),
  templateId: z.string().uuid(),
})

// ==========================================
// Label Templates
// ==========================================

// List label templates
app.get('/templates', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT * FROM label_templates
    WHERE company_id = ${currentUser.companyId}
    ORDER BY is_default DESC, name ASC
  `)

  return c.json((result as any).rows || result)
})

// Create label template (manager+)
app.post('/templates', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const data = templateSchema.parse(await c.req.json())

  // If setting as default, unset existing defaults of same type
  if (data.isDefault) {
    await db.execute(sql`
      UPDATE label_templates
      SET is_default = false
      WHERE company_id = ${currentUser.companyId}
        AND type = ${data.type}
        AND is_default = true
    `)
  }

  const result = await db.execute(sql`
    INSERT INTO label_templates (
      id, company_id, name, type, width, height, orientation,
      fields, include_qr_code, include_barcode, include_logo,
      include_thc_warning, include_lab_results, compliance_state,
      is_default, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), ${currentUser.companyId}, ${data.name}, ${data.type},
      ${data.width}, ${data.height}, ${data.orientation},
      ${JSON.stringify(data.fields)}::jsonb,
      ${data.includeQrCode}, ${data.includeBarcode}, ${data.includeLogo},
      ${data.includeThcWarning}, ${data.includeLabResults},
      ${data.complianceState || null}, ${data.isDefault},
      NOW(), NOW()
    ) RETURNING *
  `)

  const created = ((result as any).rows || result)[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'label_template',
    entityId: created.id,
    entityName: created.name,
    req: c.req,
  })

  return c.json(created, 201)
})

// Update label template (manager+)
app.put('/templates/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = templateSchema.partial().parse(await c.req.json())

  // Verify ownership
  const existing = await db.execute(sql`
    SELECT * FROM label_templates
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const found = ((existing as any).rows || existing)[0]
  if (!found) return c.json({ error: 'Template not found' }, 404)

  // If setting as default, unset existing defaults of same type
  if (data.isDefault) {
    const type = data.type || found.type
    await db.execute(sql`
      UPDATE label_templates
      SET is_default = false
      WHERE company_id = ${currentUser.companyId}
        AND type = ${type}
        AND is_default = true
        AND id != ${id}
    `)
  }

  const result = await db.execute(sql`
    UPDATE label_templates SET
      name = COALESCE(${data.name ?? null}, name),
      type = COALESCE(${data.type ?? null}, type),
      width = COALESCE(${data.width ?? null}, width),
      height = COALESCE(${data.height ?? null}, height),
      orientation = COALESCE(${data.orientation ?? null}, orientation),
      fields = COALESCE(${data.fields ? JSON.stringify(data.fields) : null}::jsonb, fields),
      include_qr_code = COALESCE(${data.includeQrCode ?? null}, include_qr_code),
      include_barcode = COALESCE(${data.includeBarcode ?? null}, include_barcode),
      include_logo = COALESCE(${data.includeLogo ?? null}, include_logo),
      include_thc_warning = COALESCE(${data.includeThcWarning ?? null}, include_thc_warning),
      include_lab_results = COALESCE(${data.includeLabResults ?? null}, include_lab_results),
      compliance_state = COALESCE(${data.complianceState ?? null}, compliance_state),
      is_default = COALESCE(${data.isDefault ?? null}, is_default),
      updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)[0]

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'label_template',
    entityId: updated.id,
    entityName: updated.name,
    req: c.req,
  })

  return c.json(updated)
})

// Delete label template (manager+)
app.delete('/templates/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const existing = await db.execute(sql`
    SELECT * FROM label_templates
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const found = ((existing as any).rows || existing)[0]
  if (!found) return c.json({ error: 'Template not found' }, 404)

  await db.execute(sql`
    DELETE FROM label_templates WHERE id = ${id}
  `)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'label_template',
    entityId: found.id,
    entityName: found.name,
    req: c.req,
  })

  return c.json({ success: true })
})

// ==========================================
// Template Preview
// ==========================================

app.post('/templates/:id/preview', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const existing = await db.execute(sql`
    SELECT * FROM label_templates
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const template = ((existing as any).rows || existing)[0]
  if (!template) return c.json({ error: 'Template not found' }, 404)

  const fields = typeof template.fields === 'string' ? JSON.parse(template.fields) : template.fields
  const sampleData: Record<string, string> = {
    product_name: 'Blue Dream',
    strain: 'Blue Dream',
    strain_type: 'Hybrid',
    category: 'Flower',
    thc_percent: '24.5',
    cbd_percent: '0.8',
    weight: '3.5g',
    price: '$35.00',
    sku: 'FLW-BD-35',
    metrc_tag: '1A40F0000000001000000001',
    batch_number: 'BTH-2026-0322',
    tested_date: '2026-03-15',
    lab_name: 'SC Labs',
  }

  const html = buildLabelHtml(template, fields, sampleData)

  return c.json({ html, template, sampleData })
})

// ==========================================
// Print Jobs
// ==========================================

// Create print job
app.post('/print', async (c) => {
  const currentUser = c.get('user') as any
  const data = printJobSchema.parse(await c.req.json())

  // Get template
  const tmplResult = await db.execute(sql`
    SELECT * FROM label_templates
    WHERE id = ${data.templateId} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const template = ((tmplResult as any).rows || tmplResult)[0]
  if (!template) return c.json({ error: 'Template not found' }, 404)

  // Resolve label data from product/batch
  let labelData: Record<string, string> = {}

  if (data.productId) {
    const prodResult = await db.execute(sql`
      SELECT * FROM products
      WHERE id = ${data.productId} AND company_id = ${currentUser.companyId}
      LIMIT 1
    `)
    const prod = ((prodResult as any).rows || prodResult)[0]
    if (!prod) return c.json({ error: 'Product not found' }, 404)

    labelData = {
      product_name: prod.name || '',
      strain: prod.strain || '',
      strain_type: prod.strain_type || '',
      category: prod.category || '',
      thc_percent: prod.thc_percent != null ? String(prod.thc_percent) : '',
      cbd_percent: prod.cbd_percent != null ? String(prod.cbd_percent) : '',
      weight: prod.weight != null ? `${prod.weight}${prod.weight_unit || 'g'}` : '',
      price: prod.price != null ? `$${Number(prod.price).toFixed(2)}` : '',
      sku: prod.sku || '',
      metrc_tag: prod.metrc_tag || '',
    }
  }

  if (data.batchId) {
    const batchResult = await db.execute(sql`
      SELECT * FROM batches
      WHERE id = ${data.batchId} AND company_id = ${currentUser.companyId}
      LIMIT 1
    `)
    const batch = ((batchResult as any).rows || batchResult)[0]
    if (batch) {
      labelData.batch_number = batch.batch_number || ''
      labelData.metrc_tag = batch.metrc_tag || labelData.metrc_tag || ''
    }
  }

  const fields = typeof template.fields === 'string' ? JSON.parse(template.fields) : template.fields
  const html = buildLabelHtml(template, fields, labelData)

  // Create print job record
  const jobResult = await db.execute(sql`
    INSERT INTO label_print_jobs (
      id, company_id, template_id, product_id, batch_id,
      quantity, status, label_data, label_html,
      created_by, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), ${currentUser.companyId}, ${data.templateId},
      ${data.productId || null}, ${data.batchId || null},
      ${data.quantity}, 'pending',
      ${JSON.stringify(labelData)}::jsonb, ${html},
      ${currentUser.userId}, NOW(), NOW()
    ) RETURNING *
  `)

  const job = ((jobResult as any).rows || jobResult)[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'label_print_job',
    entityId: job.id,
    metadata: { templateId: data.templateId, quantity: data.quantity },
    req: c.req,
  })

  return c.json({ job, labelData, html }, 201)
})

// List print jobs (paginated)
app.get('/print-jobs', async (c) => {
  const currentUser = c.get('user') as any
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')
  const status = c.req.query('status')
  const offset = (page - 1) * limit

  let statusFilter = sql``
  if (status) {
    statusFilter = sql`AND status = ${status}`
  }

  const [dataResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT lpj.*, lt.name as template_name, lt.type as template_type
      FROM label_print_jobs lpj
      LEFT JOIN label_templates lt ON lt.id = lpj.template_id
      WHERE lpj.company_id = ${currentUser.companyId}
        ${statusFilter}
      ORDER BY lpj.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int as total
      FROM label_print_jobs
      WHERE company_id = ${currentUser.companyId}
        ${statusFilter}
    `),
  ])

  const data = (dataResult as any).rows || dataResult
  const total = Number(((countResult as any).rows || countResult)[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Update print job status
app.put('/print-jobs/:id/status', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const { status } = z.object({
    status: z.enum(['printing', 'completed', 'failed']),
  }).parse(await c.req.json())

  const existing = await db.execute(sql`
    SELECT * FROM label_print_jobs
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const found = ((existing as any).rows || existing)[0]
  if (!found) return c.json({ error: 'Print job not found' }, 404)

  const result = await db.execute(sql`
    UPDATE label_print_jobs
    SET status = ${status}, updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)[0]

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'label_print_job',
    entityId: id,
    changes: { status: { from: found.status, to: status } },
    req: c.req,
  })

  return c.json(updated)
})

// ==========================================
// Generate Label
// ==========================================

app.post('/generate', async (c) => {
  const currentUser = c.get('user') as any
  const data = generateSchema.parse(await c.req.json())

  // Get template
  const tmplResult = await db.execute(sql`
    SELECT * FROM label_templates
    WHERE id = ${data.templateId} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const template = ((tmplResult as any).rows || tmplResult)[0]
  if (!template) return c.json({ error: 'Template not found' }, 404)

  // Get product
  const prodResult = await db.execute(sql`
    SELECT * FROM products
    WHERE id = ${data.productId} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const prod = ((prodResult as any).rows || prodResult)[0]
  if (!prod) return c.json({ error: 'Product not found' }, 404)

  // Get batch if linked
  let batch: any = null
  if (prod.batch_id) {
    const batchResult = await db.execute(sql`
      SELECT * FROM batches
      WHERE id = ${prod.batch_id} AND company_id = ${currentUser.companyId}
      LIMIT 1
    `)
    batch = ((batchResult as any).rows || batchResult)[0] || null
  }

  // Get lab test data if available
  let labTest: any = null
  const labResult = await db.execute(sql`
    SELECT * FROM lab_tests
    WHERE company_id = ${currentUser.companyId}
      AND (product_id = ${data.productId} OR batch_id = ${prod.batch_id || null})
    ORDER BY tested_at DESC
    LIMIT 1
  `)
  labTest = ((labResult as any).rows || labResult)[0] || null

  // Build resolved label data
  const labelData: Record<string, any> = {
    product_name: prod.name || '',
    strain: prod.strain || '',
    strain_type: prod.strain_type || '',
    category: prod.category || '',
    thc_percent: prod.thc_percent != null ? String(prod.thc_percent) : '',
    cbd_percent: prod.cbd_percent != null ? String(prod.cbd_percent) : '',
    weight: prod.weight != null ? `${prod.weight}${prod.weight_unit || 'g'}` : '',
    price: prod.price != null ? `$${Number(prod.price).toFixed(2)}` : '',
    sku: prod.sku || '',
    metrc_tag: prod.metrc_tag || '',
    batch_number: batch?.batch_number || '',
    qr_code_data: JSON.stringify({
      id: prod.id,
      name: prod.name,
      sku: prod.sku,
      metrc_tag: prod.metrc_tag,
      thc: prod.thc_percent,
      cbd: prod.cbd_percent,
      strain: prod.strain,
    }),
    barcode_value: prod.sku || prod.metrc_tag || '',
    compliance_warnings: getComplianceWarnings(template.compliance_state),
    lab_results_summary: null as any,
  }

  if (labTest) {
    labelData.lab_results_summary = {
      lab: labTest.lab_name,
      testedAt: labTest.tested_at,
      totalThc: labTest.total_thc,
      totalCbd: labTest.total_cbd,
      terpenes: labTest.terpenes,
      passed: labTest.passed,
    }
  }

  const fields = typeof template.fields === 'string' ? JSON.parse(template.fields) : template.fields
  const html = buildLabelHtml(template, fields, labelData)

  return c.json({ labelData, html, template })
})

// ==========================================
// Helpers
// ==========================================

function getComplianceWarnings(state: string | null): string[] {
  const warnings: string[] = []

  // Universal cannabis warnings
  warnings.push('GOVERNMENT WARNING: This product contains cannabis, a Schedule I controlled substance.')
  warnings.push('Keep out of reach of children.')

  switch (state?.toLowerCase()) {
    case 'california':
    case 'ca':
      warnings.push('CA PROP 65 WARNING: Smoking this product exposes you to chemicals known to the State of California to cause cancer.')
      warnings.push('For use only by adults 21 years of age and older.')
      break
    case 'colorado':
    case 'co':
      warnings.push('There may be health risks associated with the consumption of this product.')
      warnings.push('This product is infused with marijuana or includes marijuana.')
      break
    case 'oregon':
    case 'or':
      warnings.push('Do not drive a motor vehicle while under the influence of marijuana.')
      warnings.push('For use by adults 21 and older.')
      break
    case 'washington':
    case 'wa':
      warnings.push('This product has intoxicating effects and may be habit forming.')
      warnings.push('Marijuana can impair concentration, coordination, and judgment. Do not operate a vehicle or machinery under the influence of this drug.')
      break
    case 'michigan':
    case 'mi':
      warnings.push('It is illegal to drive a motor vehicle while under the influence of marijuana.')
      warnings.push('National Poison Control Center 1-800-222-1222.')
      break
    case 'illinois':
    case 'il':
      warnings.push('This product may cause impairment and may be habit-forming.')
      warnings.push('For use only by adults 21 years of age and older.')
      break
    default:
      warnings.push('For use only by adults 21 years of age and older.')
      warnings.push('This product may cause impairment. Do not drive or operate heavy machinery while using this product.')
  }

  return warnings
}

function buildLabelHtml(
  template: any,
  fields: any[],
  data: Record<string, any>,
): string {
  const w = template.width
  const h = template.height
  const orientation = template.orientation || 'landscape'
  const labelW = orientation === 'landscape' ? Math.max(w, h) : Math.min(w, h)
  const labelH = orientation === 'landscape' ? Math.min(w, h) : Math.max(w, h)

  let fieldsHtml = ''
  for (const field of fields) {
    const value = data[field.key] ?? ''
    const fontSize = field.fontSize || 10
    const fontWeight = field.fontWeight || 'normal'
    const align = field.align || 'left'
    fieldsHtml += `<div style="position:absolute;left:${field.x}px;top:${field.y}px;${field.width ? `width:${field.width}px;` : ''}${field.height ? `height:${field.height}px;` : ''}font-size:${fontSize}px;font-weight:${fontWeight};text-align:${align};">${field.label ? `<span style="font-size:${Math.max(fontSize - 2, 7)}px;color:#666;">${field.label}</span><br/>` : ''}${value}</div>`
  }

  let extrasHtml = ''

  if (template.include_qr_code) {
    extrasHtml += `<div style="position:absolute;right:4px;top:4px;width:48px;height:48px;border:1px solid #ccc;display:flex;align-items:center;justify-content:center;font-size:7px;color:#999;">QR CODE</div>`
  }

  if (template.include_barcode) {
    extrasHtml += `<div style="position:absolute;bottom:4px;left:50%;transform:translateX(-50%);width:80%;height:20px;background:repeating-linear-gradient(90deg,#000 0px,#000 1px,#fff 1px,#fff 3px);opacity:0.7;"></div><div style="position:absolute;bottom:2px;left:50%;transform:translateX(-50%);font-size:7px;text-align:center;">${data.barcode_value || data.sku || ''}</div>`
  }

  if (template.include_thc_warning) {
    const warnings = Array.isArray(data.compliance_warnings) ? data.compliance_warnings : getComplianceWarnings(template.compliance_state)
    extrasHtml += `<div style="position:absolute;bottom:${template.include_barcode ? 28 : 4}px;left:4px;right:4px;font-size:6px;color:#c00;line-height:1.2;">${warnings[0] || ''}</div>`
  }

  if (template.include_lab_results && data.lab_results_summary) {
    const lab = data.lab_results_summary
    extrasHtml += `<div style="position:absolute;right:4px;bottom:${template.include_barcode ? 28 : 4}px;font-size:7px;text-align:right;line-height:1.3;">Lab: ${lab.lab || 'N/A'}<br/>THC: ${lab.totalThc ?? 'N/A'}% | CBD: ${lab.totalCbd ?? 'N/A'}%<br/>${lab.passed ? 'PASS' : 'FAIL'}</div>`
  }

  if (template.include_logo) {
    extrasHtml += `<div style="position:absolute;left:4px;top:4px;width:32px;height:32px;border:1px solid #ddd;display:flex;align-items:center;justify-content:center;font-size:6px;color:#999;">LOGO</div>`
  }

  return `<div style="position:relative;width:${labelW}in;height:${labelH}in;border:1px solid #ccc;font-family:Arial,sans-serif;overflow:hidden;box-sizing:border-box;padding:4px;">${fieldsHtml}${extrasHtml}</div>`
}

export default app

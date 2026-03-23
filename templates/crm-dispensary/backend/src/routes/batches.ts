import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// List batches
app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const productId = c.req.query('productId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let statusFilter = sql``
  if (status) statusFilter = sql`AND b.status = ${status}`

  let productFilter = sql``
  if (productId) productFilter = sql`AND b.product_id = ${productId}`

  const dataResult = await db.execute(sql`
    SELECT b.*, p.name as product_name, p.sku as product_sku, p.category as product_category,
           l.name as location_name
    FROM batches b
    LEFT JOIN products p ON p.id = b.product_id
    LEFT JOIN locations l ON l.id = b.location_id
    WHERE b.company_id = ${currentUser.companyId}
      ${statusFilter}
      ${productFilter}
    ORDER BY b.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM batches b
    WHERE b.company_id = ${currentUser.companyId}
      ${statusFilter}
      ${productFilter}
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Get batch detail with lab tests and inventory adjustments
app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const batchResult = await db.execute(sql`
    SELECT b.*, p.name as product_name, p.sku as product_sku, p.category as product_category,
           l.name as location_name
    FROM batches b
    LEFT JOIN products p ON p.id = b.product_id
    LEFT JOIN locations l ON l.id = b.location_id
    WHERE b.id = ${id} AND b.company_id = ${currentUser.companyId}
  `)
  const batch = ((batchResult as any).rows || batchResult)?.[0]
  if (!batch) return c.json({ error: 'Batch not found' }, 404)

  const labTestsResult = await db.execute(sql`
    SELECT * FROM lab_tests
    WHERE batch_id = ${id}
    ORDER BY tested_at DESC
  `)
  const labTests = (labTestsResult as any).rows || labTestsResult

  const adjustmentsResult = await db.execute(sql`
    SELECT ia.*, u.first_name || ' ' || u.last_name as adjusted_by_name
    FROM inventory_adjustments ia
    LEFT JOIN "user" u ON u.id = ia.user_id
    WHERE ia.product_id = ${batch.product_id}
      AND ia.company_id = ${currentUser.companyId}
    ORDER BY ia.created_at DESC
    LIMIT 50
  `)
  const adjustments = (adjustmentsResult as any).rows || adjustmentsResult

  return c.json({ ...batch, labTests, adjustments })
})

// Create batch
app.post('/', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const batchSchema = z.object({
    batchNumber: z.string().min(1),
    productId: z.string(),
    metrcTag: z.string().optional(),
    initialQuantity: z.number().min(0),
    unitOfMeasure: z.string().min(1),
    receivedDate: z.string().optional(),
    expirationDate: z.string().optional(),
    manufacturingDate: z.string().optional(),
    supplier: z.string().optional(),
    supplierLicense: z.string().optional(),
    cost: z.number().min(0).optional(),
    locationId: z.string().optional(),
    notes: z.string().optional(),
  })
  const data = batchSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO batches(id, batch_number, product_id, metrc_tag, initial_quantity, current_quantity, unit_of_measure, received_date, expiration_date, manufacturing_date, supplier, supplier_license, cost, location_id, notes, status, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.batchNumber}, ${data.productId}, ${data.metrcTag || null}, ${data.initialQuantity}, ${data.initialQuantity}, ${data.unitOfMeasure}, ${data.receivedDate || null}, ${data.expirationDate || null}, ${data.manufacturingDate || null}, ${data.supplier || null}, ${data.supplierLicense || null}, ${data.cost || null}, ${data.locationId || null}, ${data.notes || null}, 'active', ${currentUser.companyId}, NOW(), NOW())
    RETURNING *
  `)

  const batch = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'batch',
    entityId: batch?.id,
    entityName: data.batchNumber,
    req: c.req,
  })

  return c.json(batch, 201)
})

// Update batch
app.put('/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const batchSchema = z.object({
    batchNumber: z.string().min(1).optional(),
    metrcTag: z.string().optional(),
    unitOfMeasure: z.string().optional(),
    receivedDate: z.string().optional(),
    expirationDate: z.string().optional(),
    manufacturingDate: z.string().optional(),
    supplier: z.string().optional(),
    supplierLicense: z.string().optional(),
    cost: z.number().min(0).optional(),
    locationId: z.string().optional(),
    notes: z.string().optional(),
  })
  const data = batchSchema.parse(await c.req.json())

  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.batchNumber !== undefined) sets.push(sql`batch_number = ${data.batchNumber}`)
  if (data.metrcTag !== undefined) sets.push(sql`metrc_tag = ${data.metrcTag}`)
  if (data.unitOfMeasure !== undefined) sets.push(sql`unit_of_measure = ${data.unitOfMeasure}`)
  if (data.receivedDate !== undefined) sets.push(sql`received_date = ${data.receivedDate}`)
  if (data.expirationDate !== undefined) sets.push(sql`expiration_date = ${data.expirationDate}`)
  if (data.manufacturingDate !== undefined) sets.push(sql`manufacturing_date = ${data.manufacturingDate}`)
  if (data.supplier !== undefined) sets.push(sql`supplier = ${data.supplier}`)
  if (data.supplierLicense !== undefined) sets.push(sql`supplier_license = ${data.supplierLicense}`)
  if (data.cost !== undefined) sets.push(sql`cost = ${data.cost}`)
  if (data.locationId !== undefined) sets.push(sql`location_id = ${data.locationId}`)
  if (data.notes !== undefined) sets.push(sql`notes = ${data.notes}`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE batches SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Batch not found' }, 404)

  return c.json(updated)
})

// Change batch status
app.put('/:id/status', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const statusSchema = z.object({
    status: z.enum(['active', 'quarantine', 'depleted', 'recalled', 'expired']),
    reason: z.string().optional(),
  })
  const data = statusSchema.parse(await c.req.json())

  // Get current batch for audit
  const currentResult = await db.execute(sql`
    SELECT * FROM batches
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)
  const current = ((currentResult as any).rows || currentResult)?.[0]
  if (!current) return c.json({ error: 'Batch not found' }, 404)

  const result = await db.execute(sql`
    UPDATE batches SET status = ${data.status}, status_reason = ${data.reason || null}, updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'batch',
    entityId: id,
    entityName: current.batch_number,
    changes: { status: { old: current.status, new: data.status } },
    req: c.req,
  })

  return c.json(updated)
})

// Record batch depletion
app.post('/:id/deplete', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const depleteSchema = z.object({
    quantity: z.number().min(0.01),
    reason: z.string().min(1),
  })
  const data = depleteSchema.parse(await c.req.json())

  // Get current batch
  const currentResult = await db.execute(sql`
    SELECT * FROM batches
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)
  const current = ((currentResult as any).rows || currentResult)?.[0]
  if (!current) return c.json({ error: 'Batch not found' }, 404)

  const newQuantity = Math.max(Number(current.current_quantity) - data.quantity, 0)
  const newStatus = newQuantity === 0 ? 'depleted' : current.status

  // Update batch
  const result = await db.execute(sql`
    UPDATE batches SET current_quantity = ${newQuantity}, status = ${newStatus}, updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]

  // Create inventory adjustment record
  await db.execute(sql`
    INSERT INTO inventory_adjustments(id, product_id, quantity_before, quantity_after, quantity_change, reason, user_id, company_id, created_at)
    VALUES (gen_random_uuid(), ${current.product_id}, ${current.current_quantity}, ${newQuantity}, ${-data.quantity}, ${data.reason}, ${currentUser.id}, ${currentUser.companyId}, NOW())
  `)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'batch',
    entityId: id,
    entityName: current.batch_number,
    changes: { currentQuantity: { old: current.current_quantity, new: newQuantity }, reason: data.reason },
    req: c.req,
  })

  return c.json(updated)
})

// Get batches expiring in next N days
app.get('/expiring', async (c) => {
  const currentUser = c.get('user') as any
  const days = +(c.req.query('days') || '30')

  const result = await db.execute(sql`
    SELECT b.*, p.name as product_name, p.sku as product_sku, l.name as location_name
    FROM batches b
    LEFT JOIN products p ON p.id = b.product_id
    LEFT JOIN locations l ON l.id = b.location_id
    WHERE b.company_id = ${currentUser.companyId}
      AND b.status = 'active'
      AND b.expiration_date IS NOT NULL
      AND b.expiration_date <= NOW() + INTERVAL '1 day' * ${days}
      AND b.expiration_date >= NOW()
    ORDER BY b.expiration_date ASC
  `)

  return c.json((result as any).rows || result)
})

// Get all quarantined batches
app.get('/quarantine', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT b.*, p.name as product_name, p.sku as product_sku, l.name as location_name
    FROM batches b
    LEFT JOIN products p ON p.id = b.product_id
    LEFT JOIN locations l ON l.id = b.location_id
    WHERE b.company_id = ${currentUser.companyId}
      AND b.status = 'quarantine'
    ORDER BY b.updated_at DESC
  `)

  return c.json((result as any).rows || result)
})

export default app

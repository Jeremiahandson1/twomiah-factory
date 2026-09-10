import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// Raw-SQL rows come back snake_case but the frontend reads camelCase, so tables
// rendered blank. Convert row keys to camelCase before responding.
const camel = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}

// The Batches page reads quantity/unit/harvestDate/packageDate/thcPercent/strain, while the
// table stores current_quantity/unit_of_measure/manufacturing_date/received_date and THC/strain
// live on the product. Without these aliases the list showed "—" for Quantity and THC even
// though 500 g was stored (go-live QA M-6). Expose both spellings.
const presentBatch = (row: any): any => {
  const b = camel(row)
  if (!b) return b
  b.quantity = b.currentQuantity ?? b.initialQuantity ?? null
  b.unit = b.unitOfMeasure || null
  b.harvestDate = b.manufacturingDate || null
  b.packageDate = b.receivedDate || null
  if (b.thcPercent == null && b.productThcPercent != null) b.thcPercent = b.productThcPercent
  if (b.cbdPercent == null && b.productCbdPercent != null) b.cbdPercent = b.productCbdPercent
  if (!b.strain) b.strain = b.productStrain || null
  return b
}
const BATCH_PRODUCT_COLS = sql`p.name as product_name, p.sku as product_sku, p.category as product_category,
           p.thc_percent as product_thc_percent, p.cbd_percent as product_cbd_percent,
           COALESCE(p.strain_name, p.strain) as product_strain`

// Normalise a YYYY-MM-DD (or ISO) date string; null when blank/invalid.
const toDateOnly = (v: unknown): string | null => {
  if (v == null || v === '') return null
  const s = String(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime()) ? s : null
}
const todayIso = () => new Date().toISOString().slice(0, 10)

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

  // Auto-expire: a batch whose expiration date has passed is no longer 'active' — flag it so
  // the list, EOD and compliance views never show expired product as sellable. (M-6)
  await db.execute(sql`
    UPDATE batches SET status = 'expired', updated_at = NOW()
    WHERE company_id = ${currentUser.companyId} AND status = 'active'
      AND expiration_date IS NOT NULL AND expiration_date < CURRENT_DATE
  `)

  const dataResult = await db.execute(sql`
    SELECT b.*, ${BATCH_PRODUCT_COLS},
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

  const data = ((dataResult as any).rows || dataResult).map(presentBatch)
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Create batch
app.post('/', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  // The form sends harvestDate / packageDate / quantity / unit; the columns are
  // manufacturing_date / received_date / initial_quantity / unit_of_measure. The old schema
  // silently dropped the two dates (stored NULL — data loss on compliance fields, QA M-5).
  // Accept both spellings and validate the date order.
  const batchSchema = z.object({
    batchNumber: z.string().min(1),
    productId: z.string().min(1),
    metrcTag: z.string().optional(),
    initialQuantity: z.coerce.number().min(0).optional(),
    quantity: z.coerce.number().min(0).optional(),
    unitOfMeasure: z.string().min(1).optional(),
    unit: z.string().min(1).optional(),
    receivedDate: z.string().optional(),
    packageDate: z.string().optional(),
    expirationDate: z.string().optional(),
    manufacturingDate: z.string().optional(),
    harvestDate: z.string().optional(),
    supplier: z.string().optional(),
    grower: z.string().optional(),
    supplierLicense: z.string().optional(),
    cost: z.coerce.number().min(0).optional(),
    locationId: z.string().optional(),
    notes: z.string().optional(),
  }).passthrough()
  const data = batchSchema.parse(await c.req.json())

  const initialQuantity = data.initialQuantity ?? data.quantity
  if (initialQuantity == null) return c.json({ error: 'quantity (initialQuantity) is required' }, 400)
  const unitOfMeasure = data.unitOfMeasure || data.unit || 'grams'
  const harvest = toDateOnly(data.manufacturingDate ?? data.harvestDate)
  const packaged = toDateOnly(data.receivedDate ?? data.packageDate)
  const expiration = toDateOnly(data.expirationDate)
  if (data.expirationDate && !expiration) return c.json({ error: 'expirationDate must be a valid date (YYYY-MM-DD)' }, 400)
  if (harvest && expiration && expiration < harvest) {
    return c.json({ error: `Expiration date (${expiration}) cannot be before the harvest date (${harvest})`, code: 'expiration_before_harvest' }, 400)
  }
  if (harvest && packaged && packaged < harvest) {
    return c.json({ error: `Package date (${packaged}) cannot be before the harvest date (${harvest})`, code: 'package_before_harvest' }, 400)
  }
  // A batch that is already past its expiration is recorded as 'expired', never 'active'.
  const status = expiration && expiration < todayIso() ? 'expired' : 'active'

  const result = await db.execute(sql`
    INSERT INTO batches(id, batch_number, product_id, metrc_tag, initial_quantity, current_quantity, unit_of_measure, received_date, expiration_date, manufacturing_date, supplier, supplier_license, cost, location_id, notes, status, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.batchNumber}, ${data.productId}, ${data.metrcTag || null}, ${Math.round(initialQuantity)}, ${Math.round(initialQuantity)}, ${unitOfMeasure}, ${packaged}, ${expiration}, ${harvest}, ${data.supplier || data.grower || null}, ${data.supplierLicense || null}, ${data.cost != null ? String(data.cost) : null}, ${data.locationId || null}, ${data.notes || null}, ${status}, ${currentUser.companyId}, NOW(), NOW())
    RETURNING *
  `)

  const batch = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'batch',
    entityId: batch?.id,
    entityName: data.batchNumber,
    metadata: { status, harvestDate: harvest, packageDate: packaged, expirationDate: expiration },
    req: c.req,
  })

  return c.json({ ...presentBatch(batch), ...(status === 'expired' ? { warning: 'Expiration date is in the past — batch recorded as expired' } : {}) }, 201)
})

// Update batch
app.put('/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const batchSchema = z.object({
    batchNumber: z.string().min(1).optional(),
    metrcTag: z.string().optional(),
    unitOfMeasure: z.string().optional(),
    unit: z.string().optional(),
    receivedDate: z.string().optional(),
    packageDate: z.string().optional(),
    expirationDate: z.string().optional(),
    manufacturingDate: z.string().optional(),
    harvestDate: z.string().optional(),
    supplier: z.string().optional(),
    grower: z.string().optional(),
    supplierLicense: z.string().optional(),
    cost: z.coerce.number().min(0).optional(),
    locationId: z.string().optional(),
    notes: z.string().optional(),
  }).passthrough()
  const data = batchSchema.parse(await c.req.json())

  const [current] = ((await db.execute(sql`SELECT * FROM batches WHERE id = ${id} AND company_id = ${currentUser.companyId} LIMIT 1`)) as any).rows || []
  if (!current) return c.json({ error: 'Batch not found' }, 404)

  const harvestIn = data.manufacturingDate ?? data.harvestDate
  const packagedIn = data.receivedDate ?? data.packageDate
  const harvest = harvestIn !== undefined ? toDateOnly(harvestIn) : toDateOnly(current.manufacturing_date)
  const packaged = packagedIn !== undefined ? toDateOnly(packagedIn) : toDateOnly(current.received_date)
  const expiration = data.expirationDate !== undefined ? toDateOnly(data.expirationDate) : toDateOnly(current.expiration_date)
  if (harvest && expiration && expiration < harvest) {
    return c.json({ error: `Expiration date (${expiration}) cannot be before the harvest date (${harvest})`, code: 'expiration_before_harvest' }, 400)
  }
  if (harvest && packaged && packaged < harvest) {
    return c.json({ error: `Package date (${packaged}) cannot be before the harvest date (${harvest})`, code: 'package_before_harvest' }, 400)
  }

  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.batchNumber !== undefined) sets.push(sql`batch_number = ${data.batchNumber}`)
  if (data.metrcTag !== undefined) sets.push(sql`metrc_tag = ${data.metrcTag}`)
  const unit = data.unitOfMeasure ?? data.unit
  if (unit !== undefined) sets.push(sql`unit_of_measure = ${unit}`)
  if (packagedIn !== undefined) sets.push(sql`received_date = ${packaged}`)
  if (data.expirationDate !== undefined) sets.push(sql`expiration_date = ${expiration}`)
  if (harvestIn !== undefined) sets.push(sql`manufacturing_date = ${harvest}`)
  const supplier = data.supplier ?? data.grower
  if (supplier !== undefined) sets.push(sql`supplier = ${supplier}`)
  if (data.supplierLicense !== undefined) sets.push(sql`supplier_license = ${data.supplierLicense}`)
  if (data.cost !== undefined) sets.push(sql`cost = ${String(data.cost)}`)
  if (data.locationId !== undefined) sets.push(sql`location_id = ${data.locationId}`)
  if (data.notes !== undefined) sets.push(sql`notes = ${data.notes}`)
  // Keep status honest against the (possibly new) expiration date.
  if (expiration && expiration < todayIso() && current.status === 'active') sets.push(sql`status = 'expired'`)
  else if (expiration && expiration >= todayIso() && current.status === 'expired') sets.push(sql`status = 'active'`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE batches SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Batch not found' }, 404)

  return c.json(presentBatch(updated))
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

  return c.json(camel(updated))
})

// Record batch depletion
app.post('/:id/deplete', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  // Both fields optional: the Batches UI "Deplete" button posts no body, meaning "deplete the
  // whole remaining batch". A partial depletion may still pass an explicit quantity + reason.
  const depleteSchema = z.object({
    quantity: z.coerce.number().min(0.01).optional(),
    reason: z.string().optional(),
  })
  const body = await c.req.json().catch(() => ({}))
  let data: z.infer<typeof depleteSchema>
  try {
    data = depleteSchema.parse(body)
  } catch (err) {
    if (err instanceof z.ZodError) return c.json({ error: 'Invalid request', details: err.errors }, 400)
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Get current batch
  const currentResult = await db.execute(sql`
    SELECT * FROM batches
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)
  const current = ((currentResult as any).rows || currentResult)?.[0]
  if (!current) return c.json({ error: 'Batch not found' }, 404)

  const available = Number(current.current_quantity) || 0
  const depleteQty = data.quantity ?? available
  // Refuse depleting more than the batch holds rather than clamping to 0 — clamping recorded the
  // requested (e.g. −999) in the adjustment ledger while stock only dropped by what was there,
  // desynchronising the ledger from the shelf. (quantity/amount sweep)
  if (depleteQty > available) {
    return c.json({ error: `Cannot deplete ${depleteQty} — the batch only holds ${available}.` }, 400)
  }
  const reason = data.reason || 'Batch depleted'
  const newQuantity = Math.max(available - depleteQty, 0)
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
    VALUES (gen_random_uuid(), ${current.product_id}, ${current.current_quantity}, ${newQuantity}, ${-depleteQty}, ${reason}, ${currentUser.userId}, ${currentUser.companyId}, NOW())
  `)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'batch',
    entityId: id,
    entityName: current.batch_number,
    changes: { currentQuantity: { old: current.current_quantity, new: newQuantity }, reason },
    req: c.req,
  })

  return c.json(camel(updated))
})

// Generic batch status action (quarantine | recall | activate | expire). The Batches UI posts
// /:id/:action with no body. `deplete` has its own dedicated route above, which Hono's router
// matches ahead of this dynamic segment, so it is not affected here.
app.post('/:id/:action', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const action = c.req.param('action')

  const actionToStatus: Record<string, string> = {
    activate: 'active',
    quarantine: 'quarantine',
    recall: 'recalled',
    expire: 'expired',
  }
  const status = actionToStatus[action]
  if (!status) return c.json({ error: `Unknown batch action: ${action}` }, 400)

  const currentResult = await db.execute(sql`
    SELECT * FROM batches WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)
  const current = ((currentResult as any).rows || currentResult)?.[0]
  if (!current) return c.json({ error: 'Batch not found' }, 404)

  const result = await db.execute(sql`
    UPDATE batches SET status = ${status}, updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)
  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'batch',
    entityId: id,
    entityName: current.batch_number,
    changes: { status: { old: current.status, new: status } },
    req: c.req,
  })

  return c.json(camel(updated))
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

  return c.json(((result as any).rows || result).map(camel))
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

  return c.json(((result as any).rows || result).map(camel))
})

// Get batch detail with lab tests and inventory adjustments
// Registered AFTER the static routes above (/expiring, /quarantine) so the `/:id`
// param does not shadow them.
app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const batchResult = await db.execute(sql`
    SELECT b.*, ${BATCH_PRODUCT_COLS},
           l.name as location_name
    FROM batches b
    LEFT JOIN products p ON p.id = b.product_id
    LEFT JOIN locations l ON l.id = b.location_id
    WHERE b.id = ${id} AND b.company_id = ${currentUser.companyId}
  `)
  const batchRaw = ((batchResult as any).rows || batchResult)?.[0]
  if (!batchRaw) return c.json({ error: 'Batch not found' }, 404)
  const batch = { ...batchRaw, ...presentBatch(batchRaw) }

  const labTestsResult = await db.execute(sql`
    SELECT * FROM lab_tests
    WHERE batch_id = ${id}
    ORDER BY tested_at DESC
  `)
  const labTests = ((labTestsResult as any).rows || labTestsResult).map(camel)

  const adjustmentsResult = await db.execute(sql`
    SELECT ia.*, u.first_name || ' ' || u.last_name as adjusted_by_name
    FROM inventory_adjustments ia
    LEFT JOIN "user" u ON u.id = ia.user_id
    WHERE ia.product_id = ${batch.product_id}
      AND ia.company_id = ${currentUser.companyId}
    ORDER BY ia.created_at DESC
    LIMIT 50
  `)
  const adjustments = ((adjustmentsResult as any).rows || adjustmentsResult).map(camel)

  return c.json({ ...camel(batch), labTests, adjustments })
})

// Delete batch
app.delete('/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const existingResult = await db.execute(sql`
    SELECT * FROM batches
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Not found' }, 404)

  // F-40: a batch that feeds a manufacturing job is part of the production trail. Deleting it
  // leaves every one of those jobs referencing a record that no longer exists. Refuse if any
  // manufacturing job lists this batch among its inputs. (input_batches is a JSONB array of
  // { batchId, quantity }; @> tests containment.)
  const refResult = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM manufacturing_jobs
    WHERE company_id = ${currentUser.companyId}
      AND input_batches::jsonb @> ${JSON.stringify([{ batchId: id }])}::jsonb
  `)
  const refCount = Number(((refResult as any).rows || refResult)?.[0]?.n || 0)
  if (refCount > 0) {
    return c.json({ error: `Cannot delete this batch — it is the input to ${refCount} manufacturing job(s). Remove or void those jobs first.` }, 409)
  }

  await db.execute(sql`
    DELETE FROM batches
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'batch',
    entityId: id,
    entityName: existing.batch_number,
    req: c.req,
  })

  return c.json({ success: true })
})

export default app

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// List locations for company
app.get('/', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT * FROM locations
    WHERE company_id = ${currentUser.companyId} AND is_active = true
    ORDER BY is_default DESC, name ASC
  `)

  return c.json((result as any).rows || result)
})

// Create location (manager+)
app.post('/', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const locationSchema = z.object({
    name: z.string().min(1),
    type: z.string().min(1),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    phone: z.string().optional(),
    licenseNumber: z.string().optional(),
    isDefault: z.boolean().default(false),
    storeHours: z.record(z.any()).optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
  })
  const data = locationSchema.parse(await c.req.json())

  // If setting as default, unset other defaults first
  if (data.isDefault) {
    await db.execute(sql`
      UPDATE locations SET is_default = false
      WHERE company_id = ${currentUser.companyId}
    `)
  }

  const result = await db.execute(sql`
    INSERT INTO locations(id, name, type, address, city, state, zip, phone, license_number, is_default, store_hours, lat, lng, is_active, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.name}, ${data.type}, ${data.address || null}, ${data.city || null}, ${data.state || null}, ${data.zip || null}, ${data.phone || null}, ${data.licenseNumber || null}, ${data.isDefault}, ${data.storeHours ? JSON.stringify(data.storeHours) : null}::jsonb, ${data.lat || null}, ${data.lng || null}, true, ${currentUser.companyId}, NOW(), NOW())
    RETURNING *
  `)

  const location = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'location',
    entityId: location?.id,
    entityName: data.name,
    req: c.req,
  })

  return c.json(location, 201)
})

// Update location (manager+)
app.put('/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const locationSchema = z.object({
    name: z.string().min(1).optional(),
    type: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    phone: z.string().optional(),
    licenseNumber: z.string().optional(),
    isDefault: z.boolean().optional(),
    storeHours: z.record(z.any()).optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
  })
  const data = locationSchema.parse(await c.req.json())

  // If setting as default, unset other defaults first
  if (data.isDefault) {
    await db.execute(sql`
      UPDATE locations SET is_default = false
      WHERE company_id = ${currentUser.companyId}
    `)
  }

  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.name !== undefined) sets.push(sql`name = ${data.name}`)
  if (data.type !== undefined) sets.push(sql`type = ${data.type}`)
  if (data.address !== undefined) sets.push(sql`address = ${data.address}`)
  if (data.city !== undefined) sets.push(sql`city = ${data.city}`)
  if (data.state !== undefined) sets.push(sql`state = ${data.state}`)
  if (data.zip !== undefined) sets.push(sql`zip = ${data.zip}`)
  if (data.phone !== undefined) sets.push(sql`phone = ${data.phone}`)
  if (data.licenseNumber !== undefined) sets.push(sql`license_number = ${data.licenseNumber}`)
  if (data.isDefault !== undefined) sets.push(sql`is_default = ${data.isDefault}`)
  if (data.storeHours !== undefined) sets.push(sql`store_hours = ${JSON.stringify(data.storeHours)}::jsonb`)
  if (data.lat !== undefined) sets.push(sql`lat = ${data.lat}`)
  if (data.lng !== undefined) sets.push(sql`lng = ${data.lng}`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE locations SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND is_active = true
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Location not found' }, 404)

  return c.json(updated)
})

// Soft delete location
app.delete('/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE locations SET is_active = false, updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND is_active = true
    RETURNING *
  `)

  const deleted = ((result as any).rows || result)?.[0]
  if (!deleted) return c.json({ error: 'Location not found' }, 404)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'location',
    entityId: id,
    entityName: deleted.name,
    req: c.req,
  })

  return c.json({ success: true })
})

// Get inventory at a location
app.get('/:id/inventory', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    SELECT pl.*, p.name as product_name, p.sku, p.category, p.brand, p.thc_percentage, p.cbd_percentage, p.unit_price, p.image_url
    FROM product_locations pl
    JOIN products p ON p.id = pl.product_id
    WHERE pl.location_id = ${id} AND p.company_id = ${currentUser.companyId}
    ORDER BY p.name ASC
  `)

  return c.json((result as any).rows || result)
})

// Submit inventory count for a location
app.post('/:id/count', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const locationId = c.req.param('id')

  const countSchema = z.object({
    items: z.array(z.object({
      productId: z.string(),
      counted: z.number().int().min(0),
    })),
  })
  const data = countSchema.parse(await c.req.json())

  const adjustments: any[] = []

  for (const item of data.items) {
    // Get current quantity
    const currentResult = await db.execute(sql`
      SELECT quantity FROM product_locations
      WHERE product_id = ${item.productId} AND location_id = ${locationId}
    `)
    const current = ((currentResult as any).rows || currentResult)?.[0]
    const previousQuantity = current?.quantity ?? 0
    const discrepancy = item.counted - previousQuantity

    // Update quantity
    if (current) {
      await db.execute(sql`
        UPDATE product_locations SET quantity = ${item.counted}, updated_at = NOW()
        WHERE product_id = ${item.productId} AND location_id = ${locationId}
      `)
    } else {
      await db.execute(sql`
        INSERT INTO product_locations(id, product_id, location_id, quantity, created_at, updated_at)
        VALUES (gen_random_uuid(), ${item.productId}, ${locationId}, ${item.counted}, NOW(), NOW())
      `)
    }

    // Create adjustment record if discrepancy
    if (discrepancy !== 0) {
      const adjResult = await db.execute(sql`
        INSERT INTO inventory_adjustments(id, product_id, location_id, previous_quantity, new_quantity, adjustment, reason, adjusted_by, company_id, created_at)
        VALUES (gen_random_uuid(), ${item.productId}, ${locationId}, ${previousQuantity}, ${item.counted}, ${discrepancy}, 'inventory_count', ${currentUser.id}, ${currentUser.companyId}, NOW())
        RETURNING *
      `)
      const adj = ((adjResult as any).rows || adjResult)?.[0]
      if (adj) adjustments.push(adj)
    }
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'inventory_count',
    entityId: locationId,
    entityName: `Count: ${data.items.length} items, ${adjustments.length} discrepancies`,
    req: c.req,
  })

  return c.json({ counted: data.items.length, discrepancies: adjustments.length, adjustments })
})

// ── Transfers ──────────────────────────────────────────────

// List inventory transfers
app.get('/transfers', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let statusFilter = sql``
  if (status) statusFilter = sql`AND it.status = ${status}`

  const dataResult = await db.execute(sql`
    SELECT it.*,
           fl.name as from_location_name,
           tl.name as to_location_name,
           u.first_name || ' ' || u.last_name as created_by_name
    FROM inventory_transfers it
    LEFT JOIN locations fl ON fl.id = it.from_location_id
    LEFT JOIN locations tl ON tl.id = it.to_location_id
    LEFT JOIN "user" u ON u.id = it.created_by
    WHERE it.company_id = ${currentUser.companyId}
      ${statusFilter}
    ORDER BY it.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM inventory_transfers it
    WHERE it.company_id = ${currentUser.companyId}
      ${statusFilter}
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Create transfer
app.post('/transfers', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const transferSchema = z.object({
    fromLocationId: z.string(),
    toLocationId: z.string(),
    items: z.array(z.object({
      productId: z.string(),
      quantity: z.number().int().min(1),
    })).min(1),
    notes: z.string().optional(),
  })
  const data = transferSchema.parse(await c.req.json())

  if (data.fromLocationId === data.toLocationId) {
    return c.json({ error: 'Cannot transfer to the same location' }, 400)
  }

  // Create transfer record
  const transferResult = await db.execute(sql`
    INSERT INTO inventory_transfers(id, from_location_id, to_location_id, status, notes, created_by, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.fromLocationId}, ${data.toLocationId}, 'pending', ${data.notes || null}, ${currentUser.id}, ${currentUser.companyId}, NOW(), NOW())
    RETURNING *
  `)

  const transfer = ((transferResult as any).rows || transferResult)?.[0]

  // Create transfer items
  for (const item of data.items) {
    await db.execute(sql`
      INSERT INTO inventory_transfer_items(id, transfer_id, product_id, quantity, received_quantity, created_at)
      VALUES (gen_random_uuid(), ${transfer.id}, ${item.productId}, ${item.quantity}, 0, NOW())
    `)
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'inventory_transfer',
    entityId: transfer.id,
    entityName: `Transfer: ${data.items.length} items`,
    req: c.req,
  })

  return c.json(transfer, 201)
})

// Ship transfer (mark as in_transit)
app.put('/transfers/:id/ship', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE inventory_transfers
    SET status = 'in_transit', shipped_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND status = 'pending'
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Transfer not found or not in pending status' }, 404)

  // Deduct quantities from source location
  const items = await db.execute(sql`
    SELECT * FROM inventory_transfer_items WHERE transfer_id = ${id}
  `)
  const transferItems = (items as any).rows || items

  for (const item of transferItems) {
    await db.execute(sql`
      UPDATE product_locations
      SET quantity = GREATEST(quantity - ${item.quantity}, 0), updated_at = NOW()
      WHERE product_id = ${item.product_id} AND location_id = ${updated.from_location_id}
    `)
  }

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'inventory_transfer',
    entityId: id,
    changes: { status: { old: 'pending', new: 'in_transit' } },
    req: c.req,
  })

  return c.json(updated)
})

// Receive transfer
app.put('/transfers/:id/receive', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const receiveSchema = z.object({
    items: z.array(z.object({
      itemId: z.string(),
      receivedQuantity: z.number().int().min(0),
    })).min(1),
  })
  const data = receiveSchema.parse(await c.req.json())

  // Verify transfer exists and is in_transit
  const transferResult = await db.execute(sql`
    SELECT * FROM inventory_transfers
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND status = 'in_transit'
  `)
  const transfer = ((transferResult as any).rows || transferResult)?.[0]
  if (!transfer) return c.json({ error: 'Transfer not found or not in transit' }, 404)

  // Update each item's received quantity and destination inventory
  for (const item of data.items) {
    // Update transfer item received quantity
    const itemResult = await db.execute(sql`
      UPDATE inventory_transfer_items
      SET received_quantity = ${item.receivedQuantity}
      WHERE id = ${item.itemId} AND transfer_id = ${id}
      RETURNING *
    `)
    const transferItem = ((itemResult as any).rows || itemResult)?.[0]
    if (!transferItem) continue

    // Add to destination location inventory
    const existing = await db.execute(sql`
      SELECT id FROM product_locations
      WHERE product_id = ${transferItem.product_id} AND location_id = ${transfer.to_location_id}
    `)
    const existingRow = ((existing as any).rows || existing)?.[0]

    if (existingRow) {
      await db.execute(sql`
        UPDATE product_locations
        SET quantity = quantity + ${item.receivedQuantity}, updated_at = NOW()
        WHERE product_id = ${transferItem.product_id} AND location_id = ${transfer.to_location_id}
      `)
    } else {
      await db.execute(sql`
        INSERT INTO product_locations(id, product_id, location_id, quantity, created_at, updated_at)
        VALUES (gen_random_uuid(), ${transferItem.product_id}, ${transfer.to_location_id}, ${item.receivedQuantity}, NOW(), NOW())
      `)
    }
  }

  // Mark transfer as received
  const result = await db.execute(sql`
    UPDATE inventory_transfers
    SET status = 'received', received_at = NOW(), received_by = ${currentUser.id}, updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'inventory_transfer',
    entityId: id,
    changes: { status: { old: 'in_transit', new: 'received' } },
    req: c.req,
  })

  return c.json(updated)
})

export default app

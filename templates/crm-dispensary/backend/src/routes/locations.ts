import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// Thrown inside a transfer transaction when an atomic conditional write touches 0 rows (a
// concurrent caller moved the stock / received the line first) — caught to return 400 not 500.
class TransferConflict extends Error {}

// Raw db.execute(sql`...`) rows come back snake_case, but the frontend reads
// camelCase. Convert row keys to camelCase before responding. (matches cash.ts et al.)
const camel = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}

// List locations for company
app.get('/', async (c) => {
  const currentUser = c.get('user') as any

  // Per-location product count + retail inventory value. Stock is tracked per location in
  // product_locations; a location with no per-location rows (single-store tenants never
  // create any) falls back to the whole catalog when it is the default store, so "Main Store"
  // no longer shows 0 products / $0 (go-live QA L-4).
  const result = await db.execute(sql`
    SELECT l.*,
           COALESCE(pl.product_count, 0)::int AS product_count,
           COALESCE(pl.inventory_value, 0) AS inventory_value,
           COALESCE(pl.units, 0)::int AS units_on_hand,
           (pl.product_count IS NULL OR pl.product_count = 0) AND l.is_default = true AS uses_catalog_fallback
    FROM locations l
    LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE COALESCE(x.quantity, 0) > 0) AS product_count,
             COALESCE(SUM(COALESCE(x.quantity, 0) * COALESCE(NULLIF(p.price, '')::numeric, 0)), 0) AS inventory_value,
             COALESCE(SUM(COALESCE(x.quantity, 0)), 0) AS units
      FROM product_locations x JOIN products p ON p.id = x.product_id
      WHERE x.location_id = l.id AND x.company_id = l.company_id AND p.active = true
    ) pl ON true
    WHERE l.company_id = ${currentUser.companyId} AND l.is_active = true
    ORDER BY l.is_default DESC, l.name ASC
  `)
  const rows = ((result as any).rows || result).map(camel)
  if (rows.some((r: any) => r.usesCatalogFallback)) {
    const cat = await db.execute(sql`
      SELECT COUNT(*)::int AS product_count,
             COALESCE(SUM(COALESCE(stock_quantity, 0) * COALESCE(NULLIF(price, '')::numeric, 0)), 0) AS inventory_value,
             COALESCE(SUM(COALESCE(stock_quantity, 0)), 0)::int AS units
      FROM products WHERE company_id = ${currentUser.companyId} AND active = true
    `)
    const c0 = ((cat as any).rows || cat)?.[0] || {}
    for (const r of rows) if (r.usesCatalogFallback) { r.productCount = Number(c0.product_count || 0); r.inventoryValue = Number(c0.inventory_value || 0); r.unitsOnHand = Number(c0.units || 0) }
  }
  for (const r of rows) { r.inventoryValue = Number(r.inventoryValue || 0); delete r.usesCatalogFallback }

  return c.json(rows)
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

  return c.json(camel(location), 201)
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

  return c.json(camel(updated))
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
    SELECT pl.*, p.name as product_name, p.sku, p.category, p.brand, p.thc_percent, p.cbd_percent, p.price as unit_price, p.image_url
    FROM product_locations pl
    JOIN products p ON p.id = pl.product_id
    WHERE pl.location_id = ${id} AND p.company_id = ${currentUser.companyId}
    ORDER BY p.name ASC
  `)

  return c.json(((result as any).rows || result).map(camel))
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

  // Apply the count and its adjustment records atomically. Previously the product_locations write
  // committed and the inventory_adjustments INSERT then 500'd — it targeted columns that don't
  // exist (location_id/previous_quantity/new_quantity/adjustment/adjusted_by) and omitted NOT-NULL
  // adjustment_type — so a cycle count adjusted stock while reporting failure (F-31). The real
  // columns are user_id / adjustment_type / quantity_change / quantity_before / quantity_after.
  await db.transaction(async (tx) => {
    for (const item of data.items) {
      const currentResult = await tx.execute(sql`
        SELECT quantity FROM product_locations
        WHERE product_id = ${item.productId} AND location_id = ${locationId}
      `)
      const current = ((currentResult as any).rows || currentResult)?.[0]
      const previousQuantity = Number(current?.quantity ?? 0)
      const discrepancy = item.counted - previousQuantity

      if (current) {
        await tx.execute(sql`
          UPDATE product_locations SET quantity = ${item.counted}, updated_at = NOW()
          WHERE product_id = ${item.productId} AND location_id = ${locationId}
        `)
      } else {
        await tx.execute(sql`
          INSERT INTO product_locations(id, product_id, location_id, company_id, quantity, created_at, updated_at)
          VALUES (gen_random_uuid(), ${item.productId}, ${locationId}, ${currentUser.companyId}, ${item.counted}, NOW(), NOW())
        `)
      }

      if (discrepancy !== 0) {
        const adjResult = await tx.execute(sql`
          INSERT INTO inventory_adjustments(id, company_id, product_id, user_id, adjustment_type, quantity_change, quantity_before, quantity_after, reason, created_at)
          VALUES (gen_random_uuid(), ${currentUser.companyId}, ${item.productId}, ${currentUser.userId}, 'count_correction', ${discrepancy}, ${previousQuantity}, ${item.counted}, 'inventory_count', NOW())
          RETURNING *
        `)
        const adj = ((adjResult as any).rows || adjResult)?.[0]
        if (adj) adjustments.push(adj)
      }
    }
  })

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'inventory_count',
    entityId: locationId,
    entityName: `Count: ${data.items.length} items, ${adjustments.length} discrepancies`,
    req: c.req,
  })

  return c.json({ counted: data.items.length, discrepancies: adjustments.length, adjustments: adjustments.map(camel) })
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
    LEFT JOIN "user" u ON u.id = it.initiated_by
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

  // Attach each transfer's line items (with their ids) — /transfers/:id/receive requires itemId,
  // and without the items in the read model the client can never learn those ids (F-22).
  const ids = data.map((t: any) => t.id)
  let itemsByTransfer: Record<string, any[]> = {}
  if (ids.length) {
    const idList = sql.join(ids.map((i: string) => sql`${i}`), sql`, `)
    const itemsResult = await db.execute(sql`
      SELECT ti.*, p.name as product_name
      FROM inventory_transfer_items ti
      LEFT JOIN products p ON p.id = ti.product_id
      WHERE ti.transfer_id IN (${idList})
    `)
    for (const row of ((itemsResult as any).rows || itemsResult)) {
      (itemsByTransfer[row.transfer_id] ||= []).push(camel(row))
    }
  }

  return c.json({ data: data.map((t: any) => ({ ...camel(t), items: itemsByTransfer[t.id] || [] })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
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
    INSERT INTO inventory_transfers(id, from_location_id, to_location_id, status, notes, initiated_by, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.fromLocationId}, ${data.toLocationId}, 'pending', ${data.notes || null}, ${currentUser.userId}, ${currentUser.companyId}, NOW(), NOW())
    RETURNING *
  `)

  const transfer = ((transferResult as any).rows || transferResult)?.[0]

  // Create transfer items and collect them (with their generated ids) for the response, so the
  // client immediately has the itemIds that /transfers/:id/receive requires (F-22).
  const createdItems: any[] = []
  for (const item of data.items) {
    const itemResult = await db.execute(sql`
      INSERT INTO inventory_transfer_items(id, transfer_id, product_id, quantity, received_quantity)
      VALUES (gen_random_uuid(), ${transfer.id}, ${item.productId}, ${item.quantity}, 0)
      RETURNING *
    `)
    const row = ((itemResult as any).rows || itemResult)?.[0]
    if (row) createdItems.push(camel(row))
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'inventory_transfer',
    entityId: transfer.id,
    entityName: `Transfer: ${data.items.length} items`,
    req: c.req,
  })

  return c.json({ ...camel(transfer), items: createdItems }, 201)
})

// Ship transfer (mark as in_transit)
app.put('/transfers/:id/ship', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  // Load the pending transfer + its items first (no writes yet).
  const tres = await db.execute(sql`
    SELECT * FROM inventory_transfers
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND status = 'pending'
    LIMIT 1
  `)
  const transfer = ((tres as any).rows || tres)?.[0]
  if (!transfer) return c.json({ error: 'Transfer not found or not in pending status' }, 404)

  const itemsRes = await db.execute(sql`SELECT * FROM inventory_transfer_items WHERE transfer_id = ${id}`)
  const transferItems = (itemsRes as any).rows || itemsRes

  // Validate source stock AT SHIP TIME (stock can change between create and ship) and REFUSE the
  // shipment if any line exceeds what the source holds — never clamp to zero, which silently
  // created phantom units (F-26: shipping 99 from a source of 3 left source 0 + dest 99).
  for (const item of transferItems) {
    const locRes = await db.execute(sql`
      SELECT quantity FROM product_locations
      WHERE product_id = ${item.product_id} AND location_id = ${transfer.from_location_id}
    `)
    const available = Number(((locRes as any).rows || locRes)?.[0]?.quantity || 0)
    if (Number(item.quantity) > available) {
      return c.json({ error: `Insufficient stock at source location: need ${item.quantity}, have ${available}. Adjust the transfer or restock before shipping.` }, 400)
    }
  }

  // All lines fit — set status and deduct source inventory atomically. Each deduction is a single
  // conditional statement (WHERE quantity >= qty); under concurrency two shipments drawing the same
  // source can't both succeed — the loser touches 0 rows and the whole shipment aborts. The status
  // flip is likewise guarded by WHERE status='pending' so only one ship wins. (concurrency sweep)
  let updated: any
  try {
    await db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        UPDATE inventory_transfers
        SET status = 'in_transit', transferred_at = NOW(), updated_at = NOW()
        WHERE id = ${id} AND company_id = ${currentUser.companyId} AND status = 'pending'
        RETURNING *
      `)
      updated = ((result as any).rows || result)?.[0]
      if (!updated) throw new TransferConflict('Transfer was already shipped.')
      for (const item of transferItems) {
        const dec = await tx.execute(sql`
          UPDATE product_locations
          SET quantity = quantity - ${item.quantity}, updated_at = NOW()
          WHERE product_id = ${item.product_id} AND location_id = ${transfer.from_location_id}
            AND quantity >= ${item.quantity}
          RETURNING id
        `)
        if (!(((dec as any).rows || dec)?.length > 0)) {
          throw new TransferConflict('Source stock changed — no longer enough to ship. Nothing was moved.')
        }
      }
    })
  } catch (e) {
    if (e instanceof TransferConflict) return c.json({ error: (e as Error).message }, 400)
    throw e
  }

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'inventory_transfer',
    entityId: id,
    changes: { status: { old: 'pending', new: 'in_transit' } },
    req: c.req,
  })

  return c.json(camel(updated))
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

  // Receivable while in transit or already partially received.
  const transferResult = await db.execute(sql`
    SELECT * FROM inventory_transfers
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND status IN ('in_transit', 'partial_received')
  `)
  const transfer = ((transferResult as any).rows || transferResult)?.[0]
  if (!transfer) return c.json({ error: 'Transfer not found or not receivable (must be in transit)' }, 404)

  // Load the shipped lines so we can bound each receipt.
  const lineRes = await db.execute(sql`SELECT * FROM inventory_transfer_items WHERE transfer_id = ${id}`)
  const lines: any[] = (lineRes as any).rows || lineRes
  const lineById = new Map(lines.map((l: any) => [l.id, l]))

  // F-29: a receipt cannot exceed what is still outstanding on that line (shipped − already
  // received). Mirror of the ship guard — refuse, don't clamp; a 3-unit shipment received as 99
  // previously created phantom stock from the opposite door.
  for (const item of data.items) {
    const line = lineById.get(item.itemId)
    if (!line) return c.json({ error: `Line item ${item.itemId} is not part of this transfer` }, 400)
    const outstanding = Number(line.quantity) - Number(line.received_quantity || 0)
    if (item.receivedQuantity > outstanding) {
      return c.json({ error: `Received quantity ${item.receivedQuantity} exceeds the outstanding shipped quantity of ${outstanding}.` }, 400)
    }
  }

  // Apply the whole receipt atomically (per-item accumulation, destination inventory, status).
  let updated: any
  try {
  await db.transaction(async (tx) => {
    for (const item of data.items) {
      if (item.receivedQuantity <= 0) continue
      // Accumulate rather than overwrite (F-30), and bound the accumulation against the line's own
      // CURRENT received_quantity in the same statement (WHERE quantity - received >= qty). Under
      // concurrency two receipts on one line can't both slip past the outstanding amount — the
      // loser updates 0 rows and the receipt aborts. (concurrency sweep)
      const itemResult = await tx.execute(sql`
        UPDATE inventory_transfer_items
        SET received_quantity = COALESCE(received_quantity, 0) + ${item.receivedQuantity}
        WHERE id = ${item.itemId} AND transfer_id = ${id}
          AND (quantity - COALESCE(received_quantity, 0)) >= ${item.receivedQuantity}
        RETURNING *
      `)
      const transferItem = ((itemResult as any).rows || itemResult)?.[0]
      if (!transferItem) throw new TransferConflict('Received quantity exceeds what is still outstanding (another receipt may have just posted).')

      const existing = await tx.execute(sql`
        SELECT id FROM product_locations
        WHERE product_id = ${transferItem.product_id} AND location_id = ${transfer.to_location_id}
      `)
      const existingRow = ((existing as any).rows || existing)?.[0]

      if (existingRow) {
        await tx.execute(sql`
          UPDATE product_locations
          SET quantity = quantity + ${item.receivedQuantity}, updated_at = NOW()
          WHERE product_id = ${transferItem.product_id} AND location_id = ${transfer.to_location_id}
        `)
      } else {
        await tx.execute(sql`
          INSERT INTO product_locations(id, product_id, location_id, company_id, quantity, created_at, updated_at)
          VALUES (gen_random_uuid(), ${transferItem.product_id}, ${transfer.to_location_id}, ${transfer.company_id}, ${item.receivedQuantity}, NOW(), NOW())
        `)
      }
    }

    // F-30: only close the transfer when every line is fully received; otherwise it stays
    // 'partial_received' so the outstanding units remain visible and receivable, not lost.
    const afterRes = await tx.execute(sql`SELECT quantity, received_quantity FROM inventory_transfer_items WHERE transfer_id = ${id}`)
    const afterLines: any[] = (afterRes as any).rows || afterRes
    const fullyReceived = afterLines.every((l: any) => Number(l.received_quantity || 0) >= Number(l.quantity))
    const newStatus = fullyReceived ? 'received' : 'partial_received'

    const result = await tx.execute(sql`
      UPDATE inventory_transfers
      SET status = ${newStatus},
          received_at = ${fullyReceived ? sql`NOW()` : sql`received_at`},
          received_by = ${currentUser.userId}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `)
    updated = ((result as any).rows || result)?.[0]
  })
  } catch (e) {
    if (e instanceof TransferConflict) return c.json({ error: (e as Error).message }, 400)
    throw e
  }

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'inventory_transfer',
    entityId: id,
    changes: { status: { old: 'in_transit', new: updated?.status } },
    req: c.req,
  })

  return c.json(camel(updated))
})

// Delete a transfer (and its items). Closes the create-only gap so erroneous/test transfers can
// be removed. Only pending/cancelled transfers delete cleanly (an in_transit/received one has
// already moved stock).
app.delete('/transfers/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const found = await db.execute(sql`
    SELECT status FROM inventory_transfers WHERE id = ${id} AND company_id = ${currentUser.companyId} LIMIT 1
  `)
  const row = ((found as any).rows || found)?.[0]
  if (!row) return c.json({ error: 'Transfer not found' }, 404)
  if (!['pending', 'cancelled'].includes(row.status)) {
    return c.json({ error: `Cannot delete a transfer that is '${row.status}' — it has already moved stock` }, 400)
  }
  await db.execute(sql`DELETE FROM inventory_transfer_items WHERE transfer_id = ${id}`)
  await db.execute(sql`DELETE FROM inventory_transfers WHERE id = ${id} AND company_id = ${currentUser.companyId}`)
  audit.log({ action: audit.ACTIONS.DELETE, entity: 'inventory_transfer', entityId: id, req: c.req })
  return c.json({ success: true })
})

export default app

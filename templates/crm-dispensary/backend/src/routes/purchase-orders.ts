import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// Thrown inside the receive transaction (after re-checking under a row lock) — caught to return
// a 4xx instead of a 500. Carries the intended HTTP status.
class PoConflict extends Error { status: number; constructor(msg: string, status = 400) { super(msg); this.status = status } }

// Raw db.execute rows come back snake_case; the frontend reads camelCase
// (supplierName, poNumber, createdAt, …). Convert row keys before responding.
const camel = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}

// The list/detail rows carry line items in the `items` JSON array but the frontend renders
// `po.itemCount`, which the raw row doesn't have — surface it (line-item count) so the list
// stops showing "0 items" for POs that carry items.
const withItemCount = (po: any): any => {
  if (!po || typeof po !== 'object') return po
  let items = po.items
  if (typeof items === 'string') { try { items = JSON.parse(items) } catch { items = [] } }
  return { ...po, itemCount: Array.isArray(items) ? items.length : 0 }
}

// ─── GET / ── List purchase orders ───────────────────────────────────────────

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const supplierName = c.req.query('supplier')
  const locationId = c.req.query('locationId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let filters = sql``
  if (status) filters = sql`${filters} AND po.status = ${status}`
  if (supplierName) filters = sql`${filters} AND po.supplier_name ILIKE ${'%' + supplierName + '%'}`
  if (locationId) filters = sql`${filters} AND po.location_id = ${locationId}`

  const [dataResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT po.*, u.first_name || ' ' || u.last_name as created_by_name
      FROM purchase_orders po
      LEFT JOIN "user" u ON u.id = po.created_by
      WHERE po.company_id = ${currentUser.companyId} ${filters}
      ORDER BY po.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int as total
      FROM purchase_orders po
      WHERE po.company_id = ${currentUser.companyId} ${filters}
    `),
  ])

  const data = ((dataResult as any).rows || dataResult).map(camel).map(withItemCount)
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// ─── GET /by-supplier ── POs grouped by supplier ─────────────────────────────
// NOTE: must be declared BEFORE the dynamic `/:id` route, otherwise "/by-supplier"
// is captured as an :id and 404s as a missing purchase order. (route ordering)

app.get('/by-supplier', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT po.*, u.first_name || ' ' || u.last_name as created_by_name
    FROM purchase_orders po
    LEFT JOIN "user" u ON u.id = po.created_by
    WHERE po.company_id = ${currentUser.companyId}
    ORDER BY po.created_at DESC
  `)
  const rows = ((result as any).rows || result).map(camel).map(withItemCount)

  // Group by supplier and shape to what the frontend renders:
  // { supplierName, supplierEmail, orderCount, totalSpent, orders: [...] }
  const groups = new Map<string, any>()
  for (const po of rows) {
    const key = po.supplierName || 'Unknown Supplier'
    if (!groups.has(key)) {
      groups.set(key, { supplierName: key, supplierEmail: po.supplierEmail || null, orderCount: 0, totalSpent: 0, orders: [] as any[] })
    }
    const g = groups.get(key)
    g.orderCount++
    if (po.status !== 'cancelled') g.totalSpent += Number(po.subtotal || 0)
    g.orders.push(po)
  }

  return c.json({ data: Array.from(groups.values()) })
})

// ─── GET /:id ── PO detail with items and receiving status ───────────────────

app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const poResult = await db.execute(sql`
    SELECT po.*, u.first_name || ' ' || u.last_name as created_by_name
    FROM purchase_orders po
    LEFT JOIN "user" u ON u.id = po.created_by
    WHERE po.id = ${id} AND po.company_id = ${currentUser.companyId}
    LIMIT 1
  `)

  const po = ((poResult as any).rows || poResult)?.[0]
  if (!po) return c.json({ error: 'Purchase order not found' }, 404)

  // Items are stored as JSON on the purchase_orders table
  const items = typeof po.items === 'string' ? JSON.parse(po.items) : (po.items || [])

  return c.json({ ...camel(po), items })
})

// ─── POST / ── Create purchase order ─────────────────────────────────────────

const createPOSchema = z.object({
  supplierName: z.string().min(1),
  // Dialog always sends supplierEmail (empty string when unset) — accept '' as "no email".
  supplierEmail: z.string().email().or(z.literal('')).optional(),
  items: z.array(z.object({
    productId: z.string().min(1),
    // The dialog sends `productName`; `name` is optional and derived from the product when absent.
    name: z.string().optional(),
    productName: z.string().optional(),
    sku: z.string().optional(),
    quantity: z.number().int().min(1),
    unitCost: z.number().min(0),
  })).min(1),
  expectedDate: z.string().optional(),
  // Optional — the dialog does not collect a location; column is nullable.
  locationId: z.string().min(1).optional(),
  notes: z.string().optional(),
  reorderSuggestionId: z.string().min(1).optional(),
})

app.post('/', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  let data: z.infer<typeof createPOSchema>
  try {
    data = createPOSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Generate PO number
  const poNumber = `PO-${Date.now().toString(36).toUpperCase()}`

  // Calculate totals
  const subtotal = data.items.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0)
  const itemCount = data.items.reduce((sum, item) => sum + item.quantity, 0)

  // Build items JSON with line totals and received tracking. The dialog sends `productName`
  // (not `name`); when neither is present, derive the name from the products table.
  const itemsJson: any[] = []
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i]
    let name = item.name || item.productName
    if (!name) {
      const prodResult = await db.execute(sql`
        SELECT name FROM products
        WHERE id = ${item.productId} AND company_id = ${currentUser.companyId}
        LIMIT 1
      `)
      name = ((prodResult as any).rows || prodResult)?.[0]?.name || 'Unknown Product'
    }
    itemsJson.push({
      itemIndex: i,
      productId: item.productId,
      name,
      sku: item.sku || null,
      quantity: item.quantity,
      unitCost: item.unitCost,
      lineTotal: item.quantity * item.unitCost,
      receivedQty: 0,
    })
  }

  // Insert PO with items as JSON. purchase_orders has no total_items column (schema.ts is
  // truth); the item count lives in the items JSON array and is surfaced as `itemCount` below.
  // total = subtotal + tax + shipping; the create dialog collects no tax/shipping (default 0),
  // so total == subtotal. Previously `total` was left at its '0' default, so the list/detail
  // always rendered $0 even though subtotal was correct.
  void itemCount
  const poResult = await db.execute(sql`
    INSERT INTO purchase_orders (id, po_number, supplier_name, supplier_email, status, subtotal, total,
      items, expected_date, location_id, notes, reorder_suggestion_id, created_by,
      company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${poNumber}, ${data.supplierName}, ${data.supplierEmail || null},
      'draft', ${subtotal.toFixed(2)}, ${subtotal.toFixed(2)}, ${JSON.stringify(itemsJson)}::jsonb,
      ${data.expectedDate || null},
      ${data.locationId || null}, ${data.notes || null}, ${data.reorderSuggestionId || null},
      ${currentUser.userId}, ${currentUser.companyId}, NOW(), NOW())
    RETURNING *
  `)
  const po = withItemCount(camel(((poResult as any).rows || poResult)?.[0]))

  // Link to reorder suggestion if provided
  if (data.reorderSuggestionId) {
    await db.execute(sql`
      UPDATE reorder_suggestions
      SET status = 'ordered'
      WHERE id = ${data.reorderSuggestionId} AND company_id = ${currentUser.companyId}
    `)
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'purchase_order',
    entityId: po.id,
    entityName: poNumber,
    metadata: { supplier: data.supplierName, itemCount: data.items.length, subtotal },
    req: c.req,
  })

  return c.json(po, 201)
})

// ─── POST /from-suggestions ── Auto-create POs from approved reorder suggestions ─

app.post('/from-suggestions', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  // Get all approved suggestions. reorder_suggestions carries the supplier (as `supplier`) and
  // `suggested_quantity`; products has no supplier columns (schema.ts is truth). Cost comes from
  // products.cost_price.
  const suggestionsResult = await db.execute(sql`
    SELECT rs.*, p.name as product_name, p.sku, p.cost_price
    FROM reorder_suggestions rs
    JOIN products p ON p.id = rs.product_id
    WHERE rs.company_id = ${currentUser.companyId}
      AND rs.status = 'approved'
  `)
  const suggestions = (suggestionsResult as any).rows || suggestionsResult

  if (!suggestions.length) {
    return c.json({ message: 'No approved suggestions to process', created: 0 })
  }

  // Group by supplier
  const bySupplier = new Map<string, any[]>()
  for (const s of suggestions) {
    const supplier = s.supplier || 'Unknown Supplier'
    if (!bySupplier.has(supplier)) bySupplier.set(supplier, [])
    bySupplier.get(supplier)!.push(s)
  }

  const createdPOs: any[] = []

  for (const [supplierName, items] of bySupplier) {
    const poNumber = `PO-AUTO-${Date.now().toString(36).toUpperCase()}-${createdPOs.length}`
    const subtotal = items.reduce((sum: number, s: any) => sum + (Number(s.suggested_quantity || 0) * Number(s.cost_price || 0)), 0)
    // reorder_suggestions has no supplier email column
    const supplierEmail = null

    // Build items JSON
    const itemsJson = items.map((s: any, i: number) => {
      const unitCost = Number(s.cost_price || 0)
      const quantity = Number(s.suggested_quantity || 0)
      return {
        itemIndex: i,
        productId: s.product_id,
        name: s.product_name,
        sku: s.sku || null,
        quantity,
        unitCost,
        lineTotal: quantity * unitCost,
        receivedQty: 0,
      }
    })

    const poResult = await db.execute(sql`
      INSERT INTO purchase_orders (id, po_number, supplier_name, supplier_email, status, subtotal,
        items, location_id, notes, created_by, company_id, created_at, updated_at)
      VALUES (gen_random_uuid(), ${poNumber}, ${supplierName}, ${supplierEmail},
        'draft', ${subtotal.toFixed(2)}, ${JSON.stringify(itemsJson)}::jsonb,
        ${items[0]?.location_id || null},
        'Auto-generated from reorder suggestions', ${currentUser.userId},
        ${currentUser.companyId}, NOW(), NOW())
      RETURNING *
    `)
    const po = camel(((poResult as any).rows || poResult)?.[0])

    // Mark suggestions as ordered (reorder_suggestions has no updated_at column)
    for (const s of items) {
      await db.execute(sql`
        UPDATE reorder_suggestions SET status = 'ordered'
        WHERE id = ${s.id}
      `)
    }

    createdPOs.push(po)
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'purchase_order',
    entityName: 'Auto-created POs from suggestions',
    metadata: { count: createdPOs.length, suggestionCount: suggestions.length },
    req: c.req,
  })

  return c.json({ created: createdPOs.length, purchaseOrders: createdPOs })
})

// ─── PUT /:id ── Update PO (only while draft) ───────────────────────────────

const updatePOSchema = z.object({
  supplierName: z.string().min(1).optional(),
  supplierEmail: z.string().email().optional(),
  expectedDate: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().min(1),
    name: z.string().min(1),
    sku: z.string().optional(),
    quantity: z.number().int().min(1),
    unitCost: z.number().min(0),
  })).optional(),
})

app.put('/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  let data: z.infer<typeof updatePOSchema>
  try {
    data = updatePOSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Verify draft status
  const existingResult = await db.execute(sql`
    SELECT * FROM purchase_orders
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Purchase order not found' }, 404)
  if (existing.status !== 'draft') return c.json({ error: 'Can only edit draft purchase orders' }, 400)

  // Update PO header
  await db.execute(sql`
    UPDATE purchase_orders
    SET supplier_name = COALESCE(${data.supplierName || null}, supplier_name),
        supplier_email = COALESCE(${data.supplierEmail || null}, supplier_email),
        expected_date = COALESCE(${data.expectedDate || null}, expected_date),
        notes = COALESCE(${data.notes || null}, notes),
        updated_at = NOW()
    WHERE id = ${id}
  `)

  // Replace items if provided
  if (data.items) {
    let subtotal = 0
    let totalItems = 0
    const itemsJson = data.items.map((item, i) => {
      const lineTotal = item.quantity * item.unitCost
      subtotal += lineTotal
      totalItems += item.quantity
      return {
        itemIndex: i,
        productId: item.productId,
        name: item.name,
        sku: item.sku || null,
        quantity: item.quantity,
        unitCost: item.unitCost,
        lineTotal,
        receivedQty: 0,
      }
    })

    // purchase_orders has no total_items column (schema.ts is truth); count lives in items JSON.
    void totalItems
    await db.execute(sql`
      UPDATE purchase_orders SET
        items = ${JSON.stringify(itemsJson)}::jsonb,
        subtotal = ${subtotal.toFixed(2)},
        updated_at = NOW()
      WHERE id = ${id}
    `)
  }

  const updatedResult = await db.execute(sql`SELECT * FROM purchase_orders WHERE id = ${id}`)
  const updated = camel(((updatedResult as any).rows || updatedResult)?.[0])

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'purchase_order',
    entityId: id,
    entityName: existing.po_number,
    metadata: { updatedFields: Object.keys(data) },
    req: c.req,
  })

  return c.json(updated)
})

// ─── PUT /:id/submit ── Submit PO (optionally send email to supplier) ────────

app.put('/:id/submit', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE purchase_orders
    SET status = 'submitted', submitted_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND status = 'draft'
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Purchase order not found or not in draft status' }, 404)

  // TODO: Send email to supplier if supplier_email is set
  // For now, just log it
  const emailSent = false
  if (updated.supplier_email) {
    // Would integrate with email service here
    // await emailService.send({ to: updated.supplier_email, subject: `Purchase Order ${updated.po_number}`, ... })
  }

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'purchase_order',
    entityId: id,
    entityName: updated.po_number,
    changes: { status: { old: 'draft', new: 'submitted' } },
    metadata: { emailSent },
    req: c.req,
  })

  return c.json({ ...updated, emailSent })
})

// ─── PUT /:id/receive ── Receive PO items ────────────────────────────────────

const receiveSchema = z.object({
  items: z.array(z.object({
    itemIndex: z.number().int().min(0),
    receivedQty: z.number().int().min(0),
  })).min(1),
})

app.put('/:id/receive', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  let data: z.infer<typeof receiveSchema>
  try {
    data = receiveSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Verify PO exists and is in receivable state
  const poResult = await db.execute(sql`
    SELECT * FROM purchase_orders
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const po = ((poResult as any).rows || poResult)?.[0]
  if (!po) return c.json({ error: 'Purchase order not found' }, 404)
  if (!['submitted', 'partial_received'].includes(po.status)) {
    return c.json({ error: 'Purchase order is not in a receivable state' }, 400)
  }

  // Get items from JSON column
  const poItems = typeof po.items === 'string' ? JSON.parse(po.items) : (po.items || [])

  // A receipt cannot exceed the outstanding ordered quantity on its line (ordered − already
  // received) — receiving more than was ordered manufactures phantom stock, the same class as the
  // transfer-receive gap. Refuse, don't clamp. (quantity/amount sweep)
  for (const received of data.items) {
    const poItem = poItems.find((i: any) => i.itemIndex === received.itemIndex)
    if (!poItem) continue
    const outstanding = Number(poItem.quantity) - (Number(poItem.receivedQty) || 0)
    if (received.receivedQty > outstanding) {
      return c.json({ error: `Received quantity ${received.receivedQty} exceeds the outstanding ordered quantity of ${outstanding} for "${poItem.name || poItem.productId}".` }, 400)
    }
  }

  // Determine new PO status: fully received or partial (computed after applying receipts below)
  let allFullyReceived = false
  let newStatus = po.status

  // Apply the whole receipt atomically: stock increments, adjustment records, the updated
  // items JSON and the status change must all commit together or not at all. Previously the
  // stock UPDATE committed and a later failing statement left inventory inflated with the PO
  // still reading receivedQty:0 — so an operator retry double-counted stock (F-12).
  try {
    await db.transaction(async (tx) => {
      // Lock the PO row so concurrent receives against the same PO serialize. Its line items live
      // in a JSON blob, so a conditional-column guard isn't possible; the row lock makes the second
      // caller wait for the first to commit, then read its updated receivedQty. Re-parse and
      // re-validate against the LOCKED state (the pre-check above is only the uncontended fast path).
      // (concurrency sweep)
      const locked = await tx.execute(sql`SELECT * FROM purchase_orders WHERE id = ${id} AND company_id = ${currentUser.companyId} FOR UPDATE`)
      const lpo = ((locked as any).rows || locked)?.[0]
      if (!lpo) throw new PoConflict('Purchase order not found', 404)
      if (!['submitted', 'partial_received'].includes(lpo.status)) throw new PoConflict('Purchase order is no longer in a receivable state', 400)
      const poItems = typeof lpo.items === 'string' ? JSON.parse(lpo.items) : (lpo.items || [])
      for (const received of data.items) {
        const poItem = poItems.find((i: any) => i.itemIndex === received.itemIndex)
        if (!poItem) continue
        const outstanding = Number(poItem.quantity) - (Number(poItem.receivedQty) || 0)
        if (received.receivedQty > outstanding) {
          throw new PoConflict(`Received quantity ${received.receivedQty} exceeds the outstanding ordered quantity of ${outstanding} for "${poItem.name || poItem.productId}".`, 400)
        }
      }

      for (const received of data.items) {
        const poItem = poItems.find((i: any) => i.itemIndex === received.itemIndex)
        if (!poItem) continue

        poItem.receivedQty = (Number(poItem.receivedQty) || 0) + received.receivedQty

        if (poItem.productId && received.receivedQty > 0) {
          await tx.execute(sql`
            UPDATE products
            SET stock_quantity = stock_quantity + ${received.receivedQty}, updated_at = NOW()
            WHERE id = ${poItem.productId} AND company_id = ${currentUser.companyId}
          `)

          // inventory_adjustments columns: company_id, product_id, user_id, adjustment_type,
          // quantity_change, reason (see schema.ts). No adjusted_by / location_id columns exist.
          await tx.execute(sql`
            INSERT INTO inventory_adjustments (id, company_id, product_id, user_id, adjustment_type, quantity_change, reason, created_at)
            VALUES (gen_random_uuid(), ${currentUser.companyId}, ${poItem.productId}, ${currentUser.userId},
              'restock', ${received.receivedQty}, ${'PO Received: ' + (po.po_number || '')}, NOW())
          `)
        }
      }

      await tx.execute(sql`
        UPDATE purchase_orders SET items = ${JSON.stringify(poItems)}::jsonb, updated_at = NOW()
        WHERE id = ${id}
      `)

      allFullyReceived = poItems.every((i: any) => Number(i.receivedQty) >= Number(i.quantity))
      newStatus = allFullyReceived ? 'received' : 'partial_received'

      await tx.execute(sql`
        UPDATE purchase_orders
        SET status = ${newStatus}, received_at = ${allFullyReceived ? sql`NOW()` : sql`received_at`}, updated_at = NOW()
        WHERE id = ${id}
      `)
    })
  } catch (err) {
    if (err instanceof PoConflict) return c.json({ error: err.message }, err.status as any)
    console.error('PO receive failed (rolled back):', err)
    return c.json({ error: 'Failed to receive purchase order' }, 500)
  }

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'purchase_order',
    entityId: id,
    entityName: po.po_number,
    changes: { status: { old: po.status, new: newStatus } },
    metadata: { receivedItems: data.items.length, fullyReceived: allFullyReceived },
    req: c.req,
  })

  return c.json({ message: allFullyReceived ? 'All items received' : 'Partial receive recorded', status: newStatus })
})

// ─── PUT /:id/cancel ── Cancel PO ───────────────────────────────────────────

app.put('/:id/cancel', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE purchase_orders
    SET status = 'cancelled', updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND status IN ('draft', 'submitted')
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Purchase order not found or cannot be cancelled' }, 404)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'purchase_order',
    entityId: id,
    entityName: updated.po_number,
    changes: { status: { old: updated.status, new: 'cancelled' } },
    req: c.req,
  })

  return c.json(updated)
})

// ─── DELETE /:id ── Remove PO (safe: void once it feeds compliance) ───────────
// Draft/pending/submitted POs have not yet affected inventory or compliance, so they can be
// hard-deleted. Once a PO is received (or partially received / any later state) it is part of
// the compliance trail — instead of deleting, mark it 'voided' and record the reason.

app.delete('/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const existingResult = await db.execute(sql`
    SELECT * FROM purchase_orders
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const hardDeletable = ['draft', 'pending', 'submitted']
  if (hardDeletable.includes(existing.status)) {
    await db.execute(sql`
      DELETE FROM purchase_orders
      WHERE id = ${id} AND company_id = ${currentUser.companyId}
    `)

    audit.log({
      action: audit.ACTIONS.DELETE,
      entity: 'purchase_order',
      entityId: id,
      entityName: existing.po_number,
      req: c.req,
    })

    return c.json({ success: true })
  }

  // Received or later: void instead of delete, storing the reason in notes.
  let reason = ''
  try {
    const body = await c.req.json()
    reason = (body && typeof body.reason === 'string') ? body.reason : ''
  } catch {
    // No/invalid body — void with no reason.
  }
  const voidNote = reason ? `[VOIDED] ${reason}` : '[VOIDED]'

  // F-38: voiding a RECEIVED PO must UNDO the stock its receipt added — the void says the goods
  // were never accepted, so those units can't remain on hand with no source. Reverse each line's
  // received quantity (decrement stock, floored at 0 in case some were already sold) and log a
  // reversing inventory_adjustment, then flip status — all in one transaction. Unreceived POs
  // hard-delete above and never reach here, so there is nothing to reverse for them.
  const voidItems = typeof existing.items === 'string' ? JSON.parse(existing.items || '[]') : (existing.items || [])
  await db.transaction(async (tx) => {
    for (const item of voidItems) {
      const rec = Number(item?.receivedQty) || 0
      if (!item?.productId || rec <= 0) continue
      await tx.execute(sql`
        UPDATE products
        SET stock_quantity = GREATEST(0, stock_quantity - ${rec}), updated_at = NOW()
        WHERE id = ${item.productId} AND company_id = ${currentUser.companyId}
      `)
      await tx.execute(sql`
        INSERT INTO inventory_adjustments (id, company_id, product_id, user_id, adjustment_type, quantity_change, reason, created_at)
        VALUES (gen_random_uuid(), ${currentUser.companyId}, ${item.productId}, ${currentUser.userId},
          'void', ${-rec}, ${'PO Voided: ' + (existing.po_number || '')}, NOW())
      `)
    }
    await tx.execute(sql`
      UPDATE purchase_orders
      SET status = 'voided',
          notes = COALESCE(notes || ' ', '') || ${voidNote},
          updated_at = NOW()
      WHERE id = ${id} AND company_id = ${currentUser.companyId}
    `)
  })

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'purchase_order',
    entityId: id,
    entityName: existing.po_number,
    changes: { status: { old: existing.status, new: 'voided' } },
    metadata: { reason: reason || null },
    req: c.req,
  })

  return c.json({ success: true, voided: true })
})

export default app

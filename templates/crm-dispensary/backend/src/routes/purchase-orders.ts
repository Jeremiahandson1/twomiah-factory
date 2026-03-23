import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

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

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
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

  return c.json({ ...po, items })
})

// ─── POST / ── Create purchase order ─────────────────────────────────────────

const createPOSchema = z.object({
  supplierName: z.string().min(1),
  supplierEmail: z.string().email().optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    name: z.string().min(1),
    sku: z.string().optional(),
    quantity: z.number().int().min(1),
    unitCost: z.number().min(0),
  })).min(1),
  expectedDate: z.string().optional(),
  locationId: z.string().uuid(),
  notes: z.string().optional(),
  reorderSuggestionId: z.string().uuid().optional(),
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

  // Build items JSON with line totals and received tracking
  const itemsJson = data.items.map((item, i) => ({
    itemIndex: i,
    productId: item.productId,
    name: item.name,
    sku: item.sku || null,
    quantity: item.quantity,
    unitCost: item.unitCost,
    lineTotal: item.quantity * item.unitCost,
    receivedQty: 0,
  }))

  // Insert PO with items as JSON
  const poResult = await db.execute(sql`
    INSERT INTO purchase_orders (id, po_number, supplier_name, supplier_email, status, subtotal,
      total_items, items, expected_date, location_id, notes, reorder_suggestion_id, created_by,
      company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${poNumber}, ${data.supplierName}, ${data.supplierEmail || null},
      'draft', ${subtotal.toFixed(2)}, ${itemCount}, ${JSON.stringify(itemsJson)}::jsonb,
      ${data.expectedDate || null},
      ${data.locationId}, ${data.notes || null}, ${data.reorderSuggestionId || null},
      ${currentUser.userId}, ${currentUser.companyId}, NOW(), NOW())
    RETURNING *
  `)
  const po = ((poResult as any).rows || poResult)?.[0]

  // Link to reorder suggestion if provided
  if (data.reorderSuggestionId) {
    await db.execute(sql`
      UPDATE reorder_suggestions
      SET status = 'ordered', updated_at = NOW()
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

  // Get all approved suggestions with supplier info
  const suggestionsResult = await db.execute(sql`
    SELECT rs.*, p.name as product_name, p.sku, p.cost_price, p.supplier_name, p.supplier_email
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
    const supplier = s.supplier_name || 'Unknown Supplier'
    if (!bySupplier.has(supplier)) bySupplier.set(supplier, [])
    bySupplier.get(supplier)!.push(s)
  }

  const createdPOs: any[] = []

  for (const [supplierName, items] of bySupplier) {
    const poNumber = `PO-AUTO-${Date.now().toString(36).toUpperCase()}-${createdPOs.length}`
    const subtotal = items.reduce((sum: number, s: any) => sum + (s.suggested_qty * Number(s.cost_price || 0)), 0)
    const totalItems = items.reduce((sum: number, s: any) => sum + s.suggested_qty, 0)
    const supplierEmail = items[0]?.supplier_email || null

    // Build items JSON
    const itemsJson = items.map((s: any, i: number) => {
      const unitCost = Number(s.cost_price || 0)
      return {
        itemIndex: i,
        productId: s.product_id,
        name: s.product_name,
        sku: s.sku || null,
        quantity: s.suggested_qty,
        unitCost,
        lineTotal: s.suggested_qty * unitCost,
        receivedQty: 0,
      }
    })

    const poResult = await db.execute(sql`
      INSERT INTO purchase_orders (id, po_number, supplier_name, supplier_email, status, subtotal,
        total_items, items, location_id, notes, created_by, company_id, created_at, updated_at)
      VALUES (gen_random_uuid(), ${poNumber}, ${supplierName}, ${supplierEmail},
        'draft', ${subtotal.toFixed(2)}, ${totalItems}, ${JSON.stringify(itemsJson)}::jsonb,
        ${items[0]?.location_id || null},
        'Auto-generated from reorder suggestions', ${currentUser.userId},
        ${currentUser.companyId}, NOW(), NOW())
      RETURNING *
    `)
    const po = ((poResult as any).rows || poResult)?.[0]

    // Mark suggestions as ordered
    for (const s of items) {
      await db.execute(sql`
        UPDATE reorder_suggestions SET status = 'ordered', updated_at = NOW()
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
    productId: z.string().uuid(),
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

    await db.execute(sql`
      UPDATE purchase_orders SET
        items = ${JSON.stringify(itemsJson)}::jsonb,
        subtotal = ${subtotal.toFixed(2)},
        total_items = ${totalItems},
        updated_at = NOW()
      WHERE id = ${id}
    `)
  }

  const updatedResult = await db.execute(sql`SELECT * FROM purchase_orders WHERE id = ${id}`)
  const updated = ((updatedResult as any).rows || updatedResult)?.[0]

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

  // Process each received item
  for (const received of data.items) {
    const poItem = poItems.find((i: any) => i.itemIndex === received.itemIndex)
    if (!poItem) continue

    poItem.receivedQty = (Number(poItem.receivedQty) || 0) + received.receivedQty

    // Update product stock
    if (poItem.productId && received.receivedQty > 0) {
      await db.execute(sql`
        UPDATE products
        SET stock_quantity = stock_quantity + ${received.receivedQty},
            updated_at = NOW()
        WHERE id = ${poItem.productId} AND company_id = ${currentUser.companyId}
      `)

      // Create inventory adjustment record
      await db.execute(sql`
        INSERT INTO inventory_adjustments (id, product_id, quantity_change, reason, adjusted_by,
          location_id, company_id, created_at)
        VALUES (gen_random_uuid(), ${poItem.productId}, ${received.receivedQty},
          ${'PO Received: ' + po.po_number}, ${currentUser.userId},
          ${po.location_id}, ${currentUser.companyId}, NOW())
      `)
    }
  }

  // Write updated items back to JSON column
  await db.execute(sql`
    UPDATE purchase_orders SET items = ${JSON.stringify(poItems)}::jsonb, updated_at = NOW()
    WHERE id = ${id}
  `)

  // Determine new PO status: fully received or partial
  const allFullyReceived = poItems.every((i: any) => Number(i.receivedQty) >= Number(i.quantity))
  const newStatus = allFullyReceived ? 'received' : 'partial_received'

  await db.execute(sql`
    UPDATE purchase_orders
    SET status = ${newStatus}, received_at = ${allFullyReceived ? sql`NOW()` : sql`received_at`}, updated_at = NOW()
    WHERE id = ${id}
  `)

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

// ─── GET /by-supplier ── POs grouped by supplier ─────────────────────────────

app.get('/by-supplier', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT
      supplier_name,
      supplier_email,
      COUNT(*)::int as total_pos,
      COUNT(*) FILTER (WHERE status = 'draft')::int as draft_count,
      COUNT(*) FILTER (WHERE status = 'submitted')::int as submitted_count,
      COUNT(*) FILTER (WHERE status IN ('partial_received', 'received'))::int as received_count,
      COALESCE(SUM(subtotal::numeric), 0) as total_value,
      COALESCE(SUM(subtotal::numeric) FILTER (WHERE status NOT IN ('cancelled')), 0) as active_value,
      MAX(created_at) as last_order_date
    FROM purchase_orders
    WHERE company_id = ${currentUser.companyId}
    GROUP BY supplier_name, supplier_email
    ORDER BY total_value DESC
  `)

  const data = (result as any).rows || result

  return c.json({ data })
})

export default app

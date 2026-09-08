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

// ── Wholesale Customers ────────────────────────────────────────────────

// List wholesale customers (paginated, searchable)
app.get('/customers', async (c) => {
  const currentUser = c.get('user') as any
  const search = c.req.query('search')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let searchFilter = sql``
  if (search) searchFilter = sql`AND (wc.name ILIKE ${'%' + search + '%'} OR wc.license_number ILIKE ${'%' + search + '%'} OR wc.email ILIKE ${'%' + search + '%'})`

  const dataResult = await db.execute(sql`
    SELECT wc.*
    FROM wholesale_customers wc
    WHERE wc.company_id = ${currentUser.companyId}
      ${searchFilter}
    ORDER BY wc.name ASC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM wholesale_customers wc
    WHERE wc.company_id = ${currentUser.companyId}
      ${searchFilter}
  `)

  const data = ((dataResult as any).rows || dataResult).map(camel)
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Create wholesale customer
app.post('/customers', async (c) => {
  const currentUser = c.get('user') as any

  const customerSchema = z.object({
    name: z.string().min(1),
    licenseNumber: z.string().optional(),
    licenseType: z.string().optional(),
    licenseExpiration: z.string().optional(),
    contactName: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    paymentTerms: z.enum(['net_15', 'net_30', 'net_60', 'cod', 'prepaid']).default('net_30'),
    creditLimit: z.number().min(0).optional(),
    taxExempt: z.boolean().default(false),
    notes: z.string().optional(),
  })
  const data = customerSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO wholesale_customers(id, company_id, name, license_number, license_type, contact_name, email, phone, address, city, state, zip, payment_terms, credit_limit, notes, expiration_date, tax_exempt, status, created_at, updated_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${data.name}, ${data.licenseNumber || null}, ${data.licenseType || null}, ${data.contactName || null}, ${data.email || null}, ${data.phone || null}, ${data.address || null}, ${data.city || null}, ${data.state || null}, ${data.zip || null}, ${data.paymentTerms}, ${data.creditLimit || null}, ${data.notes || null}, ${data.licenseExpiration || null}, ${data.taxExempt ?? false}, ${(data as any).status || 'active'}, NOW(), NOW())
    RETURNING *
  `)

  const customer = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'wholesale_customers',
    entityId: customer?.id,
    entityName: data.name,
    req: c.req,
  })

  return c.json(camel(customer), 201)
})

// Update wholesale customer
app.put('/customers/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const customerSchema = z.object({
    name: z.string().min(1).optional(),
    licenseNumber: z.string().optional(),
    licenseType: z.string().optional(),
    licenseExpiration: z.string().optional(),
    contactName: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    paymentTerms: z.enum(['net_15', 'net_30', 'net_60', 'cod', 'prepaid']).optional(),
    creditLimit: z.number().min(0).optional(),
    taxExempt: z.boolean().optional(),
    notes: z.string().optional(),
    status: z.enum(['active', 'inactive', 'suspended']).optional(),
  })
  const data = customerSchema.parse(await c.req.json())

  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.name !== undefined) sets.push(sql`name = ${data.name}`)
  if (data.licenseNumber !== undefined) sets.push(sql`license_number = ${data.licenseNumber}`)
  if (data.licenseType !== undefined) sets.push(sql`license_type = ${data.licenseType}`)
  if (data.contactName !== undefined) sets.push(sql`contact_name = ${data.contactName}`)
  if (data.email !== undefined) sets.push(sql`email = ${data.email}`)
  if (data.phone !== undefined) sets.push(sql`phone = ${data.phone}`)
  if (data.address !== undefined) sets.push(sql`address = ${data.address}`)
  if (data.city !== undefined) sets.push(sql`city = ${data.city}`)
  if (data.state !== undefined) sets.push(sql`state = ${data.state}`)
  if (data.zip !== undefined) sets.push(sql`zip = ${data.zip}`)
  if (data.paymentTerms !== undefined) sets.push(sql`payment_terms = ${data.paymentTerms}`)
  if (data.creditLimit !== undefined) sets.push(sql`credit_limit = ${data.creditLimit}`)
  if (data.notes !== undefined) sets.push(sql`notes = ${data.notes}`)
  if (data.licenseExpiration !== undefined) sets.push(sql`expiration_date = ${data.licenseExpiration}`)
  if (data.taxExempt !== undefined) sets.push(sql`tax_exempt = ${data.taxExempt}`)
  if (data.status !== undefined) sets.push(sql`status = ${data.status}`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE wholesale_customers SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Customer not found' }, 404)

  return c.json(camel(updated))
})

// Delete wholesale customer
app.delete('/customers/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const existingResult = await db.execute(sql`
    SELECT * FROM wholesale_customers
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.execute(sql`
    DELETE FROM wholesale_customers
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'wholesale_customers',
    entityId: id,
    entityName: existing.name,
    req: c.req,
  })

  return c.json({ success: true })
})

// Customer detail with order history
app.get('/customers/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const customerResult = await db.execute(sql`
    SELECT * FROM wholesale_customers
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)

  const customer = ((customerResult as any).rows || customerResult)?.[0]
  if (!customer) return c.json({ error: 'Customer not found' }, 404)

  const ordersResult = await db.execute(sql`
    SELECT * FROM wholesale_orders
    WHERE customer_id = ${id} AND company_id = ${currentUser.companyId}
    ORDER BY created_at DESC
    LIMIT 50
  `)

  const orders = ((ordersResult as any).rows || ordersResult).map(camel)

  // Summary stats
  const statsResult = await db.execute(sql`
    SELECT
      COUNT(*)::int as total_orders,
      COALESCE(SUM(total), 0)::numeric as total_revenue,
      COALESCE(AVG(total), 0)::numeric as avg_order_value,
      COALESCE(SUM(CASE WHEN status = 'pending' OR status = 'confirmed' THEN total ELSE 0 END), 0)::numeric as outstanding_balance
    FROM wholesale_orders
    WHERE customer_id = ${id} AND company_id = ${currentUser.companyId}
  `)

  const stats = camel(((statsResult as any).rows || statsResult)?.[0] || {})

  return c.json({ ...camel(customer), orders, stats })
})

// ── Wholesale Orders ───────────────────────────────────────────────────

// List wholesale orders (paginated, filterable)
app.get('/orders', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const customerId = c.req.query('customerId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let statusFilter = sql``
  if (status) statusFilter = sql`AND wo.status = ${status}`

  let customerFilter = sql``
  if (customerId) customerFilter = sql`AND wo.customer_id = ${customerId}`

  const dataResult = await db.execute(sql`
    SELECT wo.*, wc.name as customer_name, wc.license_number as customer_license
    FROM wholesale_orders wo
    LEFT JOIN wholesale_customers wc ON wc.id = wo.customer_id
    WHERE wo.company_id = ${currentUser.companyId}
      ${statusFilter}
      ${customerFilter}
    ORDER BY wo.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM wholesale_orders wo
    WHERE wo.company_id = ${currentUser.companyId}
      ${statusFilter}
      ${customerFilter}
  `)

  const data = ((dataResult as any).rows || dataResult).map(camel)
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Create wholesale order
app.post('/orders', async (c) => {
  const currentUser = c.get('user') as any

  const orderSchema = z.object({
    customerId: z.string().min(1),
    items: z.array(z.object({
      productId: z.string(),
      batchId: z.string().optional(),
      quantity: z.number().min(0),
      unitPrice: z.number().min(0),
      metrcTag: z.string().optional(),
    })).min(1),
    shippingAddress: z.string().optional(),
    notes: z.string().optional(),
    dueDate: z.string().optional(),
  })
  const data = orderSchema.parse(await c.req.json())

  // Validate the customer exists for this company, otherwise the customer_id FK throws a raw 500
  // on a bogus id (retest#14 F-16 — crashes past validation). Return a clean 400 instead.
  const custResult = await db.execute(sql`
    SELECT id FROM wholesale_customers WHERE id = ${data.customerId} AND company_id = ${currentUser.companyId} LIMIT 1
  `)
  if (!((custResult as any).rows || custResult)?.[0]) {
    return c.json({ error: 'Wholesale customer not found' }, 400)
  }

  // Calculate totals. subtotal/total are TEXT columns, so store as strings.
  const subtotal = data.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0)

  // Auto-generate order number
  const orderNumber = `WO-${Date.now().toString(36).toUpperCase()}`

  const result = await db.execute(sql`
    INSERT INTO wholesale_orders(id, company_id, customer_id, order_number, items, subtotal, total, shipping_address, notes, due_date, status, created_by, created_at, updated_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${data.customerId}, ${orderNumber}, ${JSON.stringify(data.items)}::jsonb, ${subtotal.toFixed(2)}, ${subtotal.toFixed(2)}, ${data.shippingAddress || null}, ${data.notes || null}, ${data.dueDate || null}, 'draft', ${currentUser.userId}, NOW(), NOW())
    RETURNING *
  `)

  const order = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'wholesale_orders',
    entityId: order?.id,
    entityName: orderNumber,
    req: c.req,
  })

  return c.json(camel(order), 201)
})

// Update wholesale order
app.put('/orders/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const orderSchema = z.object({
    items: z.array(z.object({
      productId: z.string(),
      batchId: z.string().optional(),
      quantity: z.number().min(0),
      unitPrice: z.number().min(0),
      metrcTag: z.string().optional(),
    })).optional(),
    shippingAddress: z.string().optional(),
    notes: z.string().optional(),
    dueDate: z.string().optional(),
  })
  const data = orderSchema.parse(await c.req.json())

  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.items !== undefined) {
    const subtotal = data.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0)
    sets.push(sql`items = ${JSON.stringify(data.items)}::jsonb`)
    sets.push(sql`subtotal = ${subtotal.toFixed(2)}`)
    sets.push(sql`total = ${subtotal.toFixed(2)}`)
  }
  if (data.shippingAddress !== undefined) sets.push(sql`shipping_address = ${data.shippingAddress}`)
  if (data.notes !== undefined) sets.push(sql`notes = ${data.notes}`)
  if (data.dueDate !== undefined) sets.push(sql`due_date = ${data.dueDate}`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE wholesale_orders SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND status IN ('draft', 'pending')
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Order not found or not editable' }, 404)

  return c.json(camel(updated))
})

// Confirm order
app.put('/orders/:id/confirm', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const existingResult = await db.execute(sql`
    SELECT * FROM wholesale_orders
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Order not found' }, 404)
  if (existing.status !== 'draft' && existing.status !== 'pending') {
    return c.json({ error: `Cannot confirm order with status '${existing.status}'` }, 400)
  }

  const result = await db.execute(sql`
    UPDATE wholesale_orders
    SET status = 'confirmed', confirmed_at = NOW(), updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'wholesale_orders',
    entityId: id,
    entityName: existing.order_number,
    changes: { status: { old: existing.status, new: 'confirmed' } },
    req: c.req,
  })

  return c.json(camel(updated))
})

// Ship order
app.put('/orders/:id/ship', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const shipSchema = z.object({
    manifestNumber: z.string().min(1),
  })
  const data = shipSchema.parse(await c.req.json())

  const existingResult = await db.execute(sql`
    SELECT * FROM wholesale_orders
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Order not found' }, 404)
  if (existing.status !== 'confirmed') return c.json({ error: `Cannot ship order with status '${existing.status}'` }, 400)

  const result = await db.execute(sql`
    UPDATE wholesale_orders
    SET status = 'shipped', manifest_number = ${data.manifestNumber}, shipped_at = NOW(), updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'wholesale_orders',
    entityId: id,
    entityName: existing.order_number,
    changes: { status: { old: 'confirmed', new: 'shipped' }, manifestNumber: data.manifestNumber },
    req: c.req,
  })

  return c.json(camel(updated))
})

// Mark delivered
app.put('/orders/:id/deliver', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const existingResult = await db.execute(sql`
    SELECT * FROM wholesale_orders
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Order not found' }, 404)
  if (existing.status !== 'shipped') return c.json({ error: `Cannot mark delivered with status '${existing.status}'` }, 400)

  const result = await db.execute(sql`
    UPDATE wholesale_orders
    SET status = 'delivered', delivered_at = NOW(), updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'wholesale_orders',
    entityId: id,
    entityName: existing.order_number,
    changes: { status: { old: 'shipped', new: 'delivered' } },
    req: c.req,
  })

  return c.json(camel(updated))
})

// Generate invoice
app.put('/orders/:id/invoice', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const existingResult = await db.execute(sql`
    SELECT * FROM wholesale_orders
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Order not found' }, 404)
  if (existing.status !== 'delivered' && existing.status !== 'confirmed' && existing.status !== 'shipped') {
    return c.json({ error: `Cannot invoice order with status '${existing.status}'` }, 400)
  }

  const invoiceNumber = `WI-${Date.now().toString(36).toUpperCase()}`

  // Issuing an invoice is a billing document, not a fulfillment step — record the invoice fields
  // but DO NOT change `status`, so ship/deliver stay reachable afterward (F-24). Invoiced-ness is
  // tracked by invoice_number being set.
  const result = await db.execute(sql`
    UPDATE wholesale_orders
    SET invoice_number = ${invoiceNumber}, invoiced_at = NOW(), updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'wholesale_orders',
    entityId: id,
    entityName: existing.order_number,
    changes: { status: { old: existing.status, new: 'invoiced' }, invoiceNumber },
    req: c.req,
  })

  return c.json(camel(updated))
})

// Record payment
app.put('/orders/:id/payment', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const paymentSchema = z.object({
    amount: z.number().min(0.01),
    method: z.enum(['check', 'wire', 'ach', 'cash', 'credit_card', 'other']),
    reference: z.string().optional(),
    notes: z.string().optional(),
  })
  const data = paymentSchema.parse(await c.req.json())

  const existingResult = await db.execute(sql`
    SELECT * FROM wholesale_orders
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (!existing) return c.json({ error: 'Order not found' }, 404)

  const total = Number(existing.total || 0)
  const currentPaid = Number(existing.amount_paid || 0)
  const balanceDue = Math.max(0, total - currentPaid)

  // Cap the payment at the outstanding balance — a $50 order must not accept $9,999 (F-27).
  // (Small floating tolerance so an exact final payment isn't rejected by rounding.)
  if (data.amount > balanceDue + 0.005) {
    return c.json({ error: `Payment of $${data.amount.toFixed(2)} exceeds the balance due of $${balanceDue.toFixed(2)}.`, balanceDue }, 400)
  }

  const newPaid = currentPaid + data.amount
  const isFullyPaid = newPaid >= total - 0.005
  // Billing state lives in payment_status; it must NOT overwrite the fulfillment `status`, or an
  // order paid before shipping becomes un-shippable (F-24). Fulfillment (confirm/ship/deliver)
  // and billing (invoice/pay) advance independently. (F-28: this field was never written before.)
  const paymentStatus = isFullyPaid ? 'paid' : (newPaid > 0 ? 'partial' : 'unpaid')

  const paymentRecord = {
    id: crypto.randomUUID ? crypto.randomUUID() : `pay-${Date.now().toString(36)}`,
    amount: data.amount,
    method: data.method,
    reference: data.reference || null,
    notes: data.notes || null,
    recordedBy: currentUser.userId,
    createdAt: new Date().toISOString(),
  }

  void newPaid; void isFullyPaid; void paymentStatus // superseded by the atomic SQL below
  // Apply the payment ATOMICALLY: the WHERE clause re-checks the outstanding balance against the
  // row's CURRENT amount_paid (pre-UPDATE value), so two concurrent payments can't both slip under
  // the balance — the second updates 0 rows and is refused. amount_paid/payment_status/paid_at are
  // all computed in-statement from the live balance. The JS pre-check above just gives a friendlier
  // message in the common (uncontended) case. payments is `json`, so cast to jsonb for the append.
  const result = await db.execute(sql`
    UPDATE wholesale_orders
    SET amount_paid = (COALESCE(NULLIF(amount_paid, ''), '0')::numeric + ${data.amount})::text,
        payment_method = ${data.method},
        payment_reference = ${data.reference || null},
        payment_status = CASE
          WHEN COALESCE(NULLIF(amount_paid, ''), '0')::numeric + ${data.amount} >= COALESCE(NULLIF(total, ''), '0')::numeric - 0.005 THEN 'paid'
          WHEN COALESCE(NULLIF(amount_paid, ''), '0')::numeric + ${data.amount} > 0 THEN 'partial'
          ELSE 'unpaid' END,
        paid_at = CASE
          WHEN COALESCE(NULLIF(amount_paid, ''), '0')::numeric + ${data.amount} >= COALESCE(NULLIF(total, ''), '0')::numeric - 0.005 THEN NOW()
          ELSE paid_at END,
        payments = COALESCE(payments::jsonb, '[]'::jsonb) || ${JSON.stringify(paymentRecord)}::jsonb,
        updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
      AND (COALESCE(NULLIF(total, ''), '0')::numeric - COALESCE(NULLIF(amount_paid, ''), '0')::numeric) >= ${data.amount} - 0.005
    RETURNING *
  `)
  const updated = ((result as any).rows || result)?.[0]
  if (!updated) {
    return c.json({ error: 'Payment exceeds the balance due (another payment may have just posted). Reload and try again.' }, 400)
  }

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'wholesale_orders',
    entityId: id,
    entityName: existing.order_number,
    changes: { amountPaid: { old: currentPaid, new: newPaid }, paymentMethod: data.method },
    req: c.req,
  })

  return c.json({ ...camel(updated), balanceDue: Math.max(0, total - newPaid) })
})

// Delete a wholesale order (closes the create-only gap; managers can remove test/erroneous orders)
app.delete('/orders/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const result = await db.execute(sql`
    DELETE FROM wholesale_orders
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING id
  `)
  if (!((result as any).rows || result)?.[0]) return c.json({ error: 'Order not found' }, 404)
  audit.log({ action: audit.ACTIONS.DELETE, entity: 'wholesale_orders', entityId: id, req: c.req })
  return c.json({ success: true })
})

// ── Lab Tests ──────────────────────────────────────────────────────────

// List lab tests (paginated, filterable)
app.get('/lab-tests', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const batchId = c.req.query('batchId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let statusFilter = sql``
  if (status) statusFilter = sql`AND lt.status = ${status}`

  let batchFilter = sql``
  if (batchId) batchFilter = sql`AND lt.batch_id = ${batchId}`

  // schema.ts source-of-truth: the batch table is `batches` (not `inventory_batch`), and
  // lab_tests carries product_id directly (fallback to the batch's product). (schema fix)
  const dataResult = await db.execute(sql`
    SELECT lt.*, b.batch_number, p.name as product_name
    FROM lab_tests lt
    LEFT JOIN batches b ON b.id = lt.batch_id
    LEFT JOIN products p ON p.id = COALESCE(lt.product_id, b.product_id)
    WHERE lt.company_id = ${currentUser.companyId}
      ${statusFilter}
      ${batchFilter}
    ORDER BY lt.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM lab_tests lt
    WHERE lt.company_id = ${currentUser.companyId}
      ${statusFilter}
      ${batchFilter}
  `)

  const data = ((dataResult as any).rows || dataResult).map(camel)
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Create lab test
app.post('/lab-tests', async (c) => {
  const currentUser = c.get('user') as any

  const testSchema = z.object({
    batchId: z.string().min(1),
    labName: z.string().min(1),
    testType: z.enum(['potency', 'terpenes', 'pesticides', 'heavy_metals', 'microbial', 'mycotoxins', 'residual_solvents', 'moisture', 'full_panel']),
    sampleId: z.string().optional(),
    submittedDate: z.string().optional(),
    results: z.record(z.any()).optional(),
    thcPercent: z.number().min(0).max(100).optional(),
    cbdPercent: z.number().min(0).max(100).optional(),
    totalCannabinoids: z.number().min(0).max(100).optional(),
    terpeneProfile: z.record(z.number()).optional(),
    passed: z.boolean().optional(),
    coaUrl: z.string().optional(),
    notes: z.string().optional(),
    metrcTag: z.string().optional(),
  })
  const data = testSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO lab_tests(id, company_id, batch_id, lab_name, test_type, sample_id, submitted_date, results, thc_percent, cbd_percent, total_cannabinoids, terpene_profile, passed, coa_url, notes, metrc_tag, status, created_at, updated_at)
    VALUES (gen_random_uuid(), ${currentUser.companyId}, ${data.batchId}, ${data.labName}, ${data.testType}, ${data.sampleId || null}, ${data.submittedDate || new Date().toISOString().split('T')[0]}, ${data.results ? JSON.stringify(data.results) : '{}'}::jsonb, ${data.thcPercent || null}, ${data.cbdPercent || null}, ${data.totalCannabinoids || null}, ${data.terpeneProfile ? JSON.stringify(data.terpeneProfile) : null}::jsonb, ${data.passed ?? null}, ${data.coaUrl || null}, ${data.notes || null}, ${data.metrcTag || null}, 'submitted', NOW(), NOW())
    RETURNING *
  `)

  const test = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'lab_tests',
    entityId: test?.id,
    entityName: `${data.labName} - ${data.testType}`,
    req: c.req,
  })

  return c.json(camel(test), 201)
})

// Update lab test results
app.put('/lab-tests/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const testSchema = z.object({
    results: z.record(z.any()).optional(),
    thcPercent: z.number().min(0).max(100).optional(),
    cbdPercent: z.number().min(0).max(100).optional(),
    totalCannabinoids: z.number().min(0).max(100).optional(),
    terpeneProfile: z.record(z.number()).optional(),
    passed: z.boolean().optional(),
    coaUrl: z.string().optional(),
    notes: z.string().optional(),
    status: z.enum(['submitted', 'in_progress', 'completed', 'failed', 'retesting']).optional(),
    completedDate: z.string().optional(),
  })
  const data = testSchema.parse(await c.req.json())

  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.results !== undefined) sets.push(sql`results = ${JSON.stringify(data.results)}::jsonb`)
  if (data.thcPercent !== undefined) sets.push(sql`thc_percent = ${data.thcPercent}`)
  if (data.cbdPercent !== undefined) sets.push(sql`cbd_percent = ${data.cbdPercent}`)
  if (data.totalCannabinoids !== undefined) sets.push(sql`total_cannabinoids = ${data.totalCannabinoids}`)
  if (data.terpeneProfile !== undefined) sets.push(sql`terpene_profile = ${JSON.stringify(data.terpeneProfile)}::jsonb`)
  if (data.passed !== undefined) sets.push(sql`passed = ${data.passed}`)
  if (data.coaUrl !== undefined) sets.push(sql`coa_url = ${data.coaUrl}`)
  if (data.notes !== undefined) sets.push(sql`notes = ${data.notes}`)
  if (data.status !== undefined) sets.push(sql`status = ${data.status}`)
  if (data.completedDate !== undefined) sets.push(sql`completed_date = ${data.completedDate}`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE lab_tests SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Lab test not found' }, 404)

  return c.json(camel(updated))
})

// Record lab-test results (the Wholesale lab-test "Results" modal posts here). Maps the modal's
// payload to the REAL lab_tests columns (schema.ts): potency lives in total_thc/total_cbd/
// total_cannabinoids/total_terpenes (all text), the panels are pesticides/heavy_metals/
// microbials/mycotoxins/residual_solvents/foreign_matter (pass|fail), and overall_result drives
// status. (The generic PUT /lab-tests/:id above targets a different, older column set.)
app.put('/lab-tests/:id/results', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const resultsSchema = z.object({
    thc: z.coerce.number().nullable().optional(),
    cbd: z.coerce.number().nullable().optional(),
    totalCannabinoids: z.coerce.number().nullable().optional(),
    terpenes: z.coerce.number().nullable().optional(),
    pesticides: z.string().optional(),
    heavyMetals: z.string().optional(),
    microbials: z.string().optional(),
    mycotoxins: z.string().optional(),
    residualSolvents: z.string().optional(),
    foreignMatter: z.string().optional(),
    overallResult: z.string().optional(),
  })

  let data: z.infer<typeof resultsSchema>
  try {
    data = resultsSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) return c.json({ error: 'Invalid request', details: err.errors }, 400)
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const toStr = (v: number | null | undefined) => (v === null || v === undefined ? null : String(v))
  const overall = data.overallResult || 'pass'
  const status = overall === 'fail' ? 'failed' : 'passed'

  const result = await db.execute(sql`
    UPDATE lab_tests SET
      total_thc = ${toStr(data.thc)},
      total_cbd = ${toStr(data.cbd)},
      total_cannabinoids = ${toStr(data.totalCannabinoids)},
      total_terpenes = ${toStr(data.terpenes)},
      pesticides = ${data.pesticides || null},
      heavy_metals = ${data.heavyMetals || null},
      microbials = ${data.microbials || null},
      mycotoxins = ${data.mycotoxins || null},
      residual_solvents = ${data.residualSolvents || null},
      foreign_matter = ${data.foreignMatter || null},
      overall_result = ${overall},
      status = ${status},
      results_received_at = NOW(),
      updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Lab test not found' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'lab_tests',
    entityId: id,
    entityName: updated.lab_name || 'Lab test',
    changes: { overallResult: overall, status },
    req: c.req,
  })

  return c.json(camel(updated))
})

// Get CoA document URL/data
app.get('/lab-tests/:id/coa', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  // Only real schema.ts columns: lab_tests has no test_type/thc_percent/cbd_percent/
  // results/passed/terpene_profile/completed_date. Map to the actual columns
  // (total_thc/total_cbd, terpenes, coa_data, overall_result, results_received_at). (schema fix)
  const result = await db.execute(sql`
    SELECT lt.id, lt.coa_url, lt.lab_name, lt.status, lt.overall_result, lt.batch_id,
           lt.total_thc, lt.total_cbd, lt.total_cannabinoids, lt.total_terpenes,
           lt.terpenes, lt.coa_data, lt.results_received_at, lt.tested_at, lt.expires_at,
           b.batch_number, p.name as product_name
    FROM lab_tests lt
    LEFT JOIN batches b ON b.id = lt.batch_id
    LEFT JOIN products p ON p.id = COALESCE(lt.product_id, b.product_id)
    WHERE lt.id = ${id} AND lt.company_id = ${currentUser.companyId}
  `)

  const test = ((result as any).rows || result)?.[0]
  if (!test) return c.json({ error: 'Lab test not found' }, 404)

  return c.json({
    id: test.id,
    coaUrl: test.coa_url,
    labName: test.lab_name,
    status: test.status,
    overallResult: test.overall_result,
    passed: test.overall_result === 'pass' || test.status === 'passed',
    batchId: test.batch_id,
    batchNumber: test.batch_number,
    productName: test.product_name,
    thc: test.total_thc,
    cbd: test.total_cbd,
    totalCannabinoids: test.total_cannabinoids,
    totalTerpenes: test.total_terpenes,
    terpenes: test.terpenes,
    coaData: test.coa_data,
    completedDate: test.results_received_at || test.tested_at,
    expiresAt: test.expires_at,
  })
})

export default app

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()

// Raw-SQL rows come back snake_case, but the kiosk UI and the manager Sessions page read
// camelCase (sessionToken, ageVerified, locationName, strainType, thcPercent, imageUrl...).
// Convert row keys to camelCase before responding — same pattern as cash.ts.
const camel = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}

const rows = (result: any): any[] => ((result as any)?.rows || result) as any[]

// Public kiosk endpoints have no auth (a customer stands at the device), and this CRM is a
// single-tenant deployment. Resolve the owning company from the supplied location when we
// have one, otherwise fall back to the single company row. This is what lets a session
// start / the menu load with no kioskId and no locationId.
async function resolveCompanyId(locationId?: string | null): Promise<string | null> {
  if (locationId) {
    const r = await db.execute(sql`SELECT company_id FROM locations WHERE id = ${locationId} LIMIT 1`)
    const row = rows(r)?.[0]
    if (row?.company_id) return row.company_id
  }
  const r = await db.execute(sql`SELECT id FROM company LIMIT 1`)
  return rows(r)?.[0]?.id ?? null
}

const sessionItems = (session: any): any[] => {
  const raw = session?.items
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') { try { return JSON.parse(raw) || [] } catch { return [] } }
  return raw || []
}

// --- Helper: validate session token ---
async function getSession(token: string) {
  const result = await db.execute(sql`
    SELECT * FROM kiosk_sessions
    WHERE session_token = ${token}
      AND status NOT IN ('completed', 'abandoned')
  `)
  return rows(result)?.[0]
}

// ===== SESSION MANAGEMENT (no auth — kiosk device) =====

// POST /session/start — Start a kiosk session.
// kioskId is optional: the customer-facing kiosk has no kiosk-provisioning concept, it only
// knows (at most) a location. locationId is optional too (single-location tenants). We store
// kiosk_id as a plain string (defaulting to the location or 'default') and always stamp the
// resolved company_id (NOT NULL) so the age gate can start with an empty body.
app.post('/session/start', async (c) => {
  const sessionSchema = z.object({
    kioskId: z.string().optional(),
    locationId: z.string().optional(),
  })
  const body = await c.req.json().catch(() => ({}))
  const data = sessionSchema.parse(body ?? {})

  const companyId = await resolveCompanyId(data.locationId)
  if (!companyId) return c.json({ error: 'No company configured' }, 400)

  const sessionToken = crypto.randomUUID()
  const kioskId = data.kioskId || data.locationId || 'default'

  const result = await db.execute(sql`
    INSERT INTO kiosk_sessions(id, company_id, session_token, kiosk_id, location_id, status, age_verified, items, started_at, updated_at)
    VALUES (gen_random_uuid(), ${companyId}, ${sessionToken}, ${kioskId}, ${data.locationId || null}, 'started', false, '[]'::json, NOW(), NOW())
    RETURNING *
  `)

  return c.json(camel(rows(result)?.[0]), 201)
})

// GET /session/:token — Get session status
app.get('/session/:token', async (c) => {
  const token = c.req.param('token')
  const session = await getSession(token)
  if (!session) return c.json({ error: 'Session not found or expired' }, 404)
  return c.json(camel(session))
})

// POST /session/:token/verify-age — Age verification step
app.post('/session/:token/verify-age', async (c) => {
  const token = c.req.param('token')
  const session = await getSession(token)
  if (!session) return c.json({ error: 'Session not found or expired' }, 404)

  const ageSchema = z.object({
    verified: z.boolean(),
    dobProvided: z.string().optional(), // YYYY-MM-DD
  })
  const data = ageSchema.parse(await c.req.json().catch(() => ({})))

  if (!data.verified) {
    // Mark session as failed verification
    await db.execute(sql`
      UPDATE kiosk_sessions
      SET status = 'abandoned', age_verified = false, updated_at = NOW()
      WHERE session_token = ${token}
    `)
    return c.json({ error: 'Age verification failed. Session ended.' }, 403)
  }

  const result = await db.execute(sql`
    UPDATE kiosk_sessions
    SET age_verified = true, id_verified = true, dob_provided = ${data.dobProvided || null}, status = 'browsing', updated_at = NOW()
    WHERE session_token = ${token}
    RETURNING *
  `)

  return c.json(camel(rows(result)?.[0]))
})

// GET /menu — Kiosk menu (no auth). locationId is optional; without it we return the
// company's active, in-stock products (the menu). Products are scoped by company, not
// location, so there is no location filter on the catalog.
app.get('/menu', async (c) => {
  const locationId = c.req.query('locationId')
  const companyId = await resolveCompanyId(locationId)

  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')
  const offset = (page - 1) * limit
  const category = c.req.query('category')
  const search = c.req.query('search')

  if (!companyId) {
    return c.json({ data: [], pagination: { page, limit, total: 0, pages: 0 } })
  }

  let categoryFilter = sql``
  if (category) categoryFilter = sql`AND p.category = ${category}`

  let searchFilter = sql``
  if (search) searchFilter = sql`AND (p.name ILIKE ${'%' + search + '%'} OR p.strain_name ILIKE ${'%' + search + '%'})`

  const dataResult = await db.execute(sql`
    SELECT p.id, p.name, p.description, p.category, p.strain_name, p.strain_type,
           p.thc_percent, p.cbd_percent, p.weight, p.weight_unit, p.price, p.sale_price,
           p.image_url, p.in_stock
    FROM products p
    WHERE p.company_id = ${companyId}
      AND p.active = true
      AND COALESCE(p.in_stock, true) = true
      ${categoryFilter}
      ${searchFilter}
    ORDER BY p.category ASC, p.name ASC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM products p
    WHERE p.company_id = ${companyId}
      AND p.active = true
      AND COALESCE(p.in_stock, true) = true
      ${categoryFilter}
      ${searchFilter}
  `)

  const data = rows(dataResult).map(camel)
  const total = Number(rows(countResult)?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// POST /session/:token/add-item — Add item to kiosk order
app.post('/session/:token/add-item', async (c) => {
  const token = c.req.param('token')
  const session = await getSession(token)
  if (!session) return c.json({ error: 'Session not found or expired' }, 404)
  if (!session.age_verified) return c.json({ error: 'Age verification required' }, 403)

  const itemSchema = z.object({
    productId: z.string(),
    quantity: z.number().int().min(1).max(100),
    notes: z.string().optional(),
  })
  const data = itemSchema.parse(await c.req.json())

  // Validate product exists and is in stock. Products are company-scoped, not location-scoped.
  const productResult = await db.execute(sql`
    SELECT id, name, price, sale_price, in_stock FROM products
    WHERE id = ${data.productId} AND company_id = ${session.company_id} AND active = true
  `)
  const product = rows(productResult)?.[0]
  if (!product) return c.json({ error: 'Product not found' }, 404)
  if (product.in_stock === false) return c.json({ error: 'Product is out of stock' }, 400)

  const items = sessionItems(session)
  const unitPrice = Number(product.sale_price || product.price)

  items.push({
    productId: data.productId,
    productName: product.name,
    quantity: data.quantity,
    unitPrice,
    total: unitPrice * data.quantity,
    notes: data.notes || null,
  })

  const result = await db.execute(sql`
    UPDATE kiosk_sessions
    SET items = ${JSON.stringify(items)}::json, status = 'browsing', updated_at = NOW()
    WHERE session_token = ${token}
    RETURNING *
  `)

  return c.json(camel(rows(result)?.[0]))
})

// POST /session/:token/checkout — Submit kiosk order
app.post('/session/:token/checkout', async (c) => {
  const token = c.req.param('token')
  const session = await getSession(token)
  if (!session) return c.json({ error: 'Session not found or expired' }, 404)
  if (!session.age_verified) return c.json({ error: 'Age verification required' }, 403)

  const companyId = session.company_id
  const body = await c.req.json().catch(() => ({} as any))
  const customerName = typeof body?.customerName === 'string' && body.customerName.trim() ? body.customerName.trim() : null
  const customerPhone = typeof body?.customerPhone === 'string' && body.customerPhone.trim() ? body.customerPhone.trim() : null

  // Prefer the cart the customer is actually looking at (the frontend sends the authoritative
  // cart, reflecting any quantity edits / removals) and re-price it server-side. Fall back to
  // the running session cart accumulated via add-item. Never trust client prices.
  let items: any[] = []
  if (Array.isArray(body?.items) && body.items.length) {
    for (const bi of body.items) {
      if (!bi?.productId) continue
      const pr = await db.execute(sql`
        SELECT id, name, price, sale_price FROM products
        WHERE id = ${bi.productId} AND company_id = ${companyId} AND active = true
        LIMIT 1
      `)
      const p = rows(pr)?.[0]
      if (!p) continue
      const qty = Math.max(1, Number(bi.quantity) || 1)
      const unitPrice = Number(p.sale_price || p.price)
      items.push({ productId: p.id, productName: p.name, quantity: qty, unitPrice, total: unitPrice * qty })
    }
  }
  if (!items.length) items = sessionItems(session)
  if (!items.length) return c.json({ error: 'No items in order' }, 400)

  const subtotal = items.reduce((sum: number, item: any) => sum + Number(item.total || 0), 0)

  // Sequential per-company order number for the Orders list (integer order_number); the
  // `number` text column holds the human-facing kiosk code shown on the thank-you screen.
  const maxResult = await db.execute(sql`
    SELECT COALESCE(MAX(order_number), 1000)::int as maxnum FROM orders WHERE company_id = ${companyId}
  `)
  const nextNumber = Number(rows(maxResult)?.[0]?.maxnum || 1000) + 1
  const orderCode = 'K-' + String(nextNumber)

  const noteParts = [customerName ? `Kiosk order for ${customerName}` : 'Kiosk order']
  if (customerPhone) noteParts.push(`Phone: ${customerPhone}`)

  // Create order (walk-in style; a budtender reviews and completes it at the register).
  const orderResult = await db.execute(sql`
    INSERT INTO orders(id, order_number, number, type, status, subtotal, total, kiosk_session_id, location_id, company_id, customer_name, notes, created_at, updated_at)
    VALUES (
      gen_random_uuid(),
      ${nextNumber},
      ${orderCode},
      'kiosk',
      'pending',
      ${String(subtotal)},
      ${String(subtotal)},
      ${session.id},
      ${session.location_id || null},
      ${companyId},
      ${customerName},
      ${noteParts.join(' — ')},
      NOW(),
      NOW()
    )
    RETURNING *
  `)

  const order = rows(orderResult)?.[0]

  // Order line items live in order_items (the orders list / detail read from there).
  for (const item of items) {
    await db.execute(sql`
      INSERT INTO order_items(id, order_id, product_id, product_name, quantity, unit_price, total_price, line_total, company_id)
      VALUES (
        gen_random_uuid(),
        ${order.id},
        ${item.productId},
        ${item.productName},
        ${item.quantity},
        ${String(item.unitPrice)},
        ${String(item.total)},
        ${String(item.total)},
        ${companyId}
      )
    `)
  }

  // Update session to completed
  await db.execute(sql`
    UPDATE kiosk_sessions
    SET status = 'completed', order_id = ${order.id}, completed_at = NOW(), updated_at = NOW()
    WHERE session_token = ${token}
  `)

  return c.json({
    orderId: order.id,
    orderNumber: order.number,
    items,
    subtotal,
    total: subtotal,
    status: 'pending',
    message: 'Order submitted. A budtender will review your order shortly.',
  }, 201)
})

// POST /session/:token/abandon — Abandon kiosk session
app.post('/session/:token/abandon', async (c) => {
  const token = c.req.param('token')
  const session = await getSession(token)
  if (!session) return c.json({ error: 'Session not found or expired' }, 404)

  await db.execute(sql`
    UPDATE kiosk_sessions
    SET status = 'abandoned', updated_at = NOW()
    WHERE session_token = ${token}
  `)

  return c.json({ message: 'Session abandoned' })
})

// ===== ADMIN SESSION LIST (auth required) =====

// GET /sessions — List kiosk sessions (manager+)
app.get('/sessions', authenticate, requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit
  const status = c.req.query('status')
  const locationId = c.req.query('locationId')

  let statusFilter = sql``
  if (status) statusFilter = sql`AND ks.status = ${status}`

  let locationFilter = sql``
  if (locationId) locationFilter = sql`AND ks.location_id = ${locationId}`

  // Scope by ks.company_id (NOT NULL on every session) rather than the joined location's
  // company_id — a session can have a NULL location (single-location tenants), and the old
  // WHERE l.company_id filter dropped those rows. Order by started_at (there is no created_at
  // column on kiosk_sessions — the missing column is what 500'd this endpoint).
  const dataResult = await db.execute(sql`
    SELECT ks.*, l.name as location_name
    FROM kiosk_sessions ks
    LEFT JOIN locations l ON l.id = ks.location_id
    WHERE ks.company_id = ${currentUser.companyId}
      ${statusFilter}
      ${locationFilter}
    ORDER BY ks.started_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total
    FROM kiosk_sessions ks
    WHERE ks.company_id = ${currentUser.companyId}
      ${statusFilter}
      ${locationFilter}
  `)

  const data = rows(dataResult).map(camel)
  const total = Number(rows(countResult)?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Manager stats tiles for today's kiosk activity.
app.get('/stats', authenticate, requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const cid = currentUser.companyId

  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE started_at::date = current_date)::int as total_today,
      COUNT(*) FILTER (WHERE started_at::date = current_date AND status = 'completed')::int as completed_today,
      COUNT(*) FILTER (WHERE started_at::date = current_date AND status = 'abandoned')::int as abandoned_today,
      AVG(EXTRACT(EPOCH FROM (completed_at - started_at)))
        FILTER (WHERE started_at::date = current_date AND status = 'completed' AND completed_at IS NOT NULL) as avg_secs
    FROM kiosk_sessions
    WHERE company_id = ${cid}
  `)
  const row = rows(result)?.[0] || {}
  const total = Number(row.total_today || 0)
  const completed = Number(row.completed_today || 0)
  const abandoned = Number(row.abandoned_today || 0)
  const avgSecs = row.avg_secs != null ? Number(row.avg_secs) : null

  let avgSessionTime: string | null = null
  if (avgSecs != null) {
    const m = Math.floor(avgSecs / 60)
    const s = Math.round(avgSecs % 60)
    avgSessionTime = m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  return c.json({
    totalSessionsToday: total,
    completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    avgSessionTime,
    abandonedRate: total > 0 ? Math.round((abandoned / total) * 100) : 0,
  })
})

export default app

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()

// --- Helper: validate session token ---
async function getSession(token: string) {
  const result = await db.execute(sql`
    SELECT * FROM kiosk_sessions
    WHERE session_token = ${token}
      AND status NOT IN ('completed', 'abandoned')
  `)
  return ((result as any).rows || result)?.[0]
}

// ===== SESSION MANAGEMENT (no auth — kiosk device) =====

// POST /session/start — Start a kiosk session
app.post('/session/start', async (c) => {
  const sessionSchema = z.object({
    kioskId: z.string().min(1),
    locationId: z.string().min(1),
  })
  const data = sessionSchema.parse(await c.req.json())

  // Generate a unique session token
  const sessionToken = crypto.randomUUID()

  const result = await db.execute(sql`
    INSERT INTO kiosk_sessions(id, session_token, kiosk_id, location_id, status, age_verified, items, created_at, updated_at)
    VALUES (gen_random_uuid(), ${sessionToken}, ${data.kioskId}, ${data.locationId}, 'started', false, '[]'::jsonb, NOW(), NOW())
    RETURNING *
  `)

  const session = ((result as any).rows || result)?.[0]
  return c.json(session, 201)
})

// GET /session/:token — Get session status
app.get('/session/:token', async (c) => {
  const token = c.req.param('token')
  const session = await getSession(token)
  if (!session) return c.json({ error: 'Session not found or expired' }, 404)
  return c.json(session)
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
  const data = ageSchema.parse(await c.req.json())

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
    SET age_verified = true, dob_provided = ${data.dobProvided || null}, status = 'browsing', updated_at = NOW()
    WHERE session_token = ${token}
    RETURNING *
  `)

  return c.json(((result as any).rows || result)?.[0])
})

// GET /menu — Kiosk menu (no auth, filtered by location)
app.get('/menu', async (c) => {
  const locationId = c.req.query('locationId')
  if (!locationId) return c.json({ error: 'locationId is required' }, 400)

  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')
  const offset = (page - 1) * limit
  const category = c.req.query('category')
  const search = c.req.query('search')

  let categoryFilter = sql``
  if (category) categoryFilter = sql`AND p.category = ${category}`

  let searchFilter = sql``
  if (search) searchFilter = sql`AND (p.name ILIKE ${'%' + search + '%'} OR p.strain_name ILIKE ${'%' + search + '%'})`

  const dataResult = await db.execute(sql`
    SELECT p.id, p.name, p.description, p.category, p.strain_name, p.strain_type,
           p.thc_percent, p.cbd_percent, p.weight, p.unit, p.price, p.sale_price,
           p.image_url, p.in_stock
    FROM products p
    WHERE p.location_id = ${locationId}
      AND p.active = true
      AND p.in_stock = true
      ${categoryFilter}
      ${searchFilter}
    ORDER BY p.category ASC, p.name ASC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM products p
    WHERE p.location_id = ${locationId}
      AND p.active = true
      AND p.in_stock = true
      ${categoryFilter}
      ${searchFilter}
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

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

  // Validate product exists and is in stock
  const productResult = await db.execute(sql`
    SELECT id, name, price, sale_price, in_stock FROM products
    WHERE id = ${data.productId} AND location_id = ${session.location_id} AND active = true
  `)
  const product = ((productResult as any).rows || productResult)?.[0]
  if (!product) return c.json({ error: 'Product not found' }, 404)
  if (!product.in_stock) return c.json({ error: 'Product is out of stock' }, 400)

  const items = typeof session.items === 'string' ? JSON.parse(session.items) : (session.items || [])
  const unitPrice = product.sale_price || product.price

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
    SET items = ${JSON.stringify(items)}::jsonb, status = 'browsing', updated_at = NOW()
    WHERE session_token = ${token}
    RETURNING *
  `)

  return c.json(((result as any).rows || result)?.[0])
})

// POST /session/:token/checkout — Submit kiosk order
app.post('/session/:token/checkout', async (c) => {
  const token = c.req.param('token')
  const session = await getSession(token)
  if (!session) return c.json({ error: 'Session not found or expired' }, 404)
  if (!session.age_verified) return c.json({ error: 'Age verification required' }, 403)

  const items = typeof session.items === 'string' ? JSON.parse(session.items) : (session.items || [])
  if (!items.length) return c.json({ error: 'No items in order' }, 400)

  const subtotal = items.reduce((sum: number, item: any) => sum + item.total, 0)

  // Look up company from kiosk location
  const locationResult = await db.execute(sql`
    SELECT company_id FROM locations WHERE id = ${session.location_id}
  `)
  const location = ((locationResult as any).rows || locationResult)?.[0]
  if (!location) return c.json({ error: 'Location not found' }, 400)

  // Create order
  const orderResult = await db.execute(sql`
    INSERT INTO orders(id, number, type, status, items, subtotal, total, kiosk_session_id, location_id, company_id, created_at, updated_at)
    VALUES (
      gen_random_uuid(),
      'K-' || LPAD(FLOOR(RANDOM() * 999999)::text, 6, '0'),
      'kiosk',
      'pending_review',
      ${JSON.stringify(items)}::jsonb,
      ${subtotal},
      ${subtotal},
      ${session.id},
      ${session.location_id},
      ${location.company_id},
      NOW(),
      NOW()
    )
    RETURNING *
  `)

  const order = ((orderResult as any).rows || orderResult)?.[0]

  // Update session to completed
  await db.execute(sql`
    UPDATE kiosk_sessions
    SET status = 'completed', order_id = ${order.id}, updated_at = NOW()
    WHERE session_token = ${token}
  `)

  return c.json({
    orderId: order.id,
    orderNumber: order.number,
    items,
    subtotal,
    total: subtotal,
    status: 'pending_review',
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

  const dataResult = await db.execute(sql`
    SELECT ks.*, l.name as location_name
    FROM kiosk_sessions ks
    LEFT JOIN locations l ON l.id = ks.location_id
    WHERE l.company_id = ${currentUser.companyId}
      ${statusFilter}
      ${locationFilter}
    ORDER BY ks.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total
    FROM kiosk_sessions ks
    LEFT JOIN locations l ON l.id = ks.location_id
    WHERE l.company_id = ${currentUser.companyId}
      ${statusFilter}
      ${locationFilter}
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

export default app

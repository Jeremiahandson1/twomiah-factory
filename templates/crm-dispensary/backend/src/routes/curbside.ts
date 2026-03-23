import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()

// ─── Public Endpoints (no auth) ─────────────────────────────────────────────

// POST /checkin — Customer checks in for curbside pickup (no auth)
app.post('/checkin', async (c) => {
  const checkinSchema = z.object({
    orderId: z.string().uuid(),
    vehicleDescription: z.string().min(1),
    parkingSpot: z.string().optional(),
    customerNotes: z.string().optional(),
    locationId: z.string().uuid(),
  })

  let data: z.infer<typeof checkinSchema>
  try {
    data = checkinSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Validate order exists and is status=ready
  const orderResult = await db.execute(sql`
    SELECT id, number, status, contact_id, company_id
    FROM orders
    WHERE id = ${data.orderId}
    LIMIT 1
  `)
  const foundOrder = ((orderResult as any).rows || orderResult)?.[0]
  if (!foundOrder) return c.json({ error: 'Order not found' }, 404)
  if (foundOrder.status !== 'ready') {
    return c.json({ error: `Order is not ready for pickup. Current status: ${foundOrder.status}` }, 400)
  }

  const result = await db.execute(sql`
    INSERT INTO curbside_checkins (id, order_id, location_id, vehicle_description, parking_spot, customer_notes, status, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.orderId}, ${data.locationId}, ${data.vehicleDescription}, ${data.parkingSpot || null}, ${data.customerNotes || null}, 'waiting', ${foundOrder.company_id}, NOW(), NOW())
    RETURNING *
  `)

  const checkin = ((result as any).rows || result)?.[0]

  return c.json({
    checkinId: checkin?.id,
    message: 'Checked in for curbside pickup. A team member will bring your order out shortly.',
  }, 201)
})

// ─── Authenticated Endpoints ────────────────────────────────────────────────

app.use('*', authenticate)

// GET /queue — List active curbside checkins
app.get('/queue', async (c) => {
  const currentUser = c.get('user') as any
  const locationId = c.req.query('locationId')
  const status = c.req.query('status')

  let locationFilter = sql``
  if (locationId) locationFilter = sql`AND cc.location_id = ${locationId}`

  let statusFilter = sql``
  if (status) {
    statusFilter = sql`AND cc.status = ${status}`
  } else {
    statusFilter = sql`AND cc.status IN ('waiting', 'assigned', 'bringing_out')`
  }

  const result = await db.execute(sql`
    SELECT cc.*, o.number as order_number, o.total as order_total,
           c.name as customer_name, c.phone as customer_phone,
           u.first_name || ' ' || u.last_name as assigned_staff_name
    FROM curbside_checkins cc
    JOIN orders o ON o.id = cc.order_id
    LEFT JOIN contact c ON c.id = o.contact_id
    LEFT JOIN "user" u ON u.id = cc.assigned_staff_id
    WHERE cc.company_id = ${currentUser.companyId}
      AND DATE(cc.created_at) = CURRENT_DATE
      ${locationFilter}
      ${statusFilter}
    ORDER BY cc.created_at ASC
  `)

  const data = (result as any).rows || result

  return c.json({ data })
})

// PUT /:id/assign — Assign staff to bring order out
app.put('/:id/assign', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const { staffId } = z.object({ staffId: z.string().uuid() }).parse(await c.req.json())

  const result = await db.execute(sql`
    UPDATE curbside_checkins
    SET status = 'assigned', assigned_staff_id = ${staffId}, updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Curbside checkin not found' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'curbside_checkin',
    entityId: id,
    changes: { status: { old: 'waiting', new: 'assigned' }, assignedStaffId: { old: null, new: staffId } },
    req: c.req,
  })

  return c.json(updated)
})

// PUT /:id/bringing-out — Staff is bringing order out
app.put('/:id/bringing-out', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE curbside_checkins
    SET status = 'bringing_out', bringing_out_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Curbside checkin not found' }, 404)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'curbside_checkin',
    entityId: id,
    changes: { status: { old: updated.status, new: 'bringing_out' } },
    req: c.req,
  })

  return c.json(updated)
})

// PUT /:id/complete — Order handed off
app.put('/:id/complete', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE curbside_checkins
    SET status = 'completed', completed_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Curbside checkin not found' }, 404)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'curbside_checkin',
    entityId: id,
    changes: { status: { old: updated.status, new: 'completed' } },
    req: c.req,
  })

  return c.json(updated)
})

// GET /stats — Curbside stats
app.get('/stats', async (c) => {
  const currentUser = c.get('user') as any
  const locationId = c.req.query('locationId')

  let locationFilter = sql``
  if (locationId) locationFilter = sql`AND location_id = ${locationId}`

  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('waiting', 'assigned', 'bringing_out'))::int as active_pickups,
      COUNT(*) FILTER (WHERE status = 'completed')::int as completions_today,
      COUNT(*)::int as total_today,
      ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 60) FILTER (WHERE status = 'completed'), 1) as avg_completion_minutes
    FROM curbside_checkins
    WHERE company_id = ${currentUser.companyId}
      AND DATE(created_at) = CURRENT_DATE
      ${locationFilter}
  `)

  const stats = ((result as any).rows || result)?.[0] || {}

  return c.json({
    activePickups: stats.active_pickups || 0,
    avgCompletionMinutes: stats.avg_completion_minutes || 0,
    completionsToday: stats.completions_today || 0,
    totalToday: stats.total_today || 0,
  })
})

export default app

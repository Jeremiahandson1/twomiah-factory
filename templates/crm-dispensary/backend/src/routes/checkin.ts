import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()

// ─── Public Endpoints (no auth) ─────────────────────────────────────────────

// POST /qr-checkin — Customer scans QR code to check in (no auth)
app.post('/qr-checkin', async (c) => {
  const qrSchema = z.object({
    locationId: z.string().uuid(),
    name: z.string().min(1),
    phone: z.string().min(1),
  })

  let data: z.infer<typeof qrSchema>
  try {
    data = qrSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Get next position number for this location
  const posResult = await db.execute(sql`
    SELECT COALESCE(MAX(position), 0) + 1 as next_position
    FROM checkin_queue
    WHERE location_id = ${data.locationId}
      AND status IN ('waiting', 'called')
      AND DATE(created_at) = CURRENT_DATE
  `)
  const nextPosition = ((posResult as any).rows || posResult)?.[0]?.next_position || 1

  const result = await db.execute(sql`
    INSERT INTO checkin_queue (id, customer_name, customer_phone, location_id, source, position, status, is_medical, priority, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.name}, ${data.phone}, ${data.locationId}, 'qr_code', ${nextPosition}, 'waiting', false, 0, NOW(), NOW())
    RETURNING *
  `)

  const entry = ((result as any).rows || result)?.[0]
  const estimatedWait = nextPosition * 4

  return c.json({ entry, position: nextPosition, estimatedWaitMinutes: estimatedWait }, 201)
})

// GET /wait-time/:locationId — Public estimated wait time
app.get('/wait-time/:locationId', async (c) => {
  const locationId = c.req.param('locationId')

  const result = await db.execute(sql`
    SELECT COUNT(*)::int as waiting_count
    FROM checkin_queue
    WHERE location_id = ${locationId}
      AND status IN ('waiting', 'called')
      AND DATE(created_at) = CURRENT_DATE
  `)

  const waitingCount = ((result as any).rows || result)?.[0]?.waiting_count || 0
  const estimatedWaitMinutes = waitingCount * 4

  return c.json({ locationId, waitingCount, estimatedWaitMinutes })
})

// ─── Authenticated Endpoints ────────────────────────────────────────────────

app.use('*', authenticate)

// POST / — Check in a customer
app.post('/', async (c) => {
  const currentUser = c.get('user') as any

  const checkinSchema = z.object({
    customerName: z.string().min(1),
    customerPhone: z.string().min(1),
    contactId: z.string().uuid().optional(),
    source: z.enum(['walk_in', 'qr_code', 'online_order', 'curbside', 'kiosk']),
    orderId: z.string().uuid().optional(),
    locationId: z.string().uuid(),
    isMedical: z.boolean().default(false),
    medicalCardNumber: z.string().optional(),
    notes: z.string().optional(),
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

  // Get next position number for this location today
  const posResult = await db.execute(sql`
    SELECT COALESCE(MAX(position), 0) + 1 as next_position
    FROM checkin_queue
    WHERE location_id = ${data.locationId}
      AND status IN ('waiting', 'called')
      AND DATE(created_at) = CURRENT_DATE
  `)
  const nextPosition = ((posResult as any).rows || posResult)?.[0]?.next_position || 1

  // Medical customers get higher priority
  const priority = data.isMedical ? 1 : 0

  const result = await db.execute(sql`
    INSERT INTO checkin_queue (id, customer_name, customer_phone, contact_id, source, order_id, location_id, position, status, is_medical, medical_card_number, notes, priority, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.customerName}, ${data.customerPhone}, ${data.contactId || null}, ${data.source}, ${data.orderId || null}, ${data.locationId}, ${nextPosition}, 'waiting', ${data.isMedical}, ${data.medicalCardNumber || null}, ${data.notes || null}, ${priority}, ${currentUser.companyId}, NOW(), NOW())
    RETURNING *
  `)

  const entry = ((result as any).rows || result)?.[0]
  const estimatedWait = nextPosition * 4

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'checkin_queue',
    entityId: entry?.id,
    entityName: data.customerName,
    metadata: { source: data.source, position: nextPosition, isMedical: data.isMedical },
    req: c.req,
  })

  return c.json({ entry, estimatedWaitMinutes: estimatedWait }, 201)
})

// GET /queue — Get current queue
app.get('/queue', async (c) => {
  const currentUser = c.get('user') as any
  const locationId = c.req.query('locationId')
  const status = c.req.query('status')

  let locationFilter = sql``
  if (locationId) locationFilter = sql`AND cq.location_id = ${locationId}`

  let statusFilter = sql``
  if (status) {
    statusFilter = sql`AND cq.status = ${status}`
  } else {
    statusFilter = sql`AND cq.status IN ('waiting', 'called', 'serving')`
  }

  const result = await db.execute(sql`
    SELECT cq.*, c.name as contact_name, c.email as contact_email
    FROM checkin_queue cq
    LEFT JOIN contact c ON c.id = cq.contact_id
    WHERE cq.company_id = ${currentUser.companyId}
      AND DATE(cq.created_at) = CURRENT_DATE
      ${locationFilter}
      ${statusFilter}
    ORDER BY cq.priority DESC, cq.position ASC
  `)

  const data = (result as any).rows || result

  return c.json({ data })
})

// PUT /:id/call — Call a customer (budtender marks them next)
app.put('/:id/call', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const callSchema = z.object({
    assignedBudtenderId: z.string().uuid(),
  })

  let data: z.infer<typeof callSchema>
  try {
    data = callSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const result = await db.execute(sql`
    UPDATE checkin_queue
    SET status = 'called', called_at = NOW(), assigned_budtender_id = ${data.assignedBudtenderId}, updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Queue entry not found' }, 404)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'checkin_queue',
    entityId: id,
    entityName: updated.customer_name,
    changes: { status: { old: 'waiting', new: 'called' } },
    req: c.req,
  })

  return c.json(updated)
})

// PUT /:id/serve — Start serving customer
app.put('/:id/serve', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE checkin_queue
    SET status = 'serving', serving_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Queue entry not found' }, 404)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'checkin_queue',
    entityId: id,
    entityName: updated.customer_name,
    changes: { status: { old: 'called', new: 'serving' } },
    req: c.req,
  })

  return c.json(updated)
})

// PUT /:id/complete — Done serving
app.put('/:id/complete', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE checkin_queue
    SET status = 'completed', completed_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Queue entry not found' }, 404)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'checkin_queue',
    entityId: id,
    entityName: updated.customer_name,
    changes: { status: { old: 'serving', new: 'completed' } },
    req: c.req,
  })

  return c.json(updated)
})

// PUT /:id/no-show — Mark no-show
app.put('/:id/no-show', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE checkin_queue
    SET status = 'no_show', completed_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Queue entry not found' }, 404)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'checkin_queue',
    entityId: id,
    entityName: updated.customer_name,
    changes: { status: { old: updated.status, new: 'no_show' } },
    req: c.req,
  })

  return c.json(updated)
})

// GET /stats — Queue stats for today
app.get('/stats', async (c) => {
  const currentUser = c.get('user') as any
  const locationId = c.req.query('locationId')

  let locationFilter = sql``
  if (locationId) locationFilter = sql`AND location_id = ${locationId}`

  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('waiting', 'called'))::int as current_waiting,
      COUNT(*) FILTER (WHERE status = 'completed')::int as served_today,
      COUNT(*) FILTER (WHERE status = 'no_show')::int as no_show_today,
      COUNT(*)::int as total_today,
      ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(serving_at, completed_at) - created_at)) / 60) FILTER (WHERE status = 'completed'), 1) as avg_wait_minutes
    FROM checkin_queue
    WHERE company_id = ${currentUser.companyId}
      AND DATE(created_at) = CURRENT_DATE
      ${locationFilter}
  `)

  const stats = ((result as any).rows || result)?.[0] || {}
  const noShowRate = stats.total_today > 0
    ? Math.round((stats.no_show_today / stats.total_today) * 100)
    : 0

  return c.json({
    currentWaiting: stats.current_waiting || 0,
    servedToday: stats.served_today || 0,
    noShowToday: stats.no_show_today || 0,
    totalToday: stats.total_today || 0,
    avgWaitMinutes: stats.avg_wait_minutes || 0,
    noShowRate,
  })
})

export default app

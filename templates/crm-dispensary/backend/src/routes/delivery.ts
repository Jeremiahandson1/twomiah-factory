import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { order } from '../../db/schema.ts'
import { eq, and, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// List delivery zones
app.get('/zones', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT * FROM delivery_zones
    WHERE company_id = ${currentUser.companyId}
    ORDER BY name ASC
  `)

  return c.json((result as any).rows || result)
})

// Create delivery zone (manager+)
app.post('/zones', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const zoneSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    zipCodes: z.array(z.string()).optional(),
    radiusMiles: z.number().optional(),
    centerLat: z.number().optional(),
    centerLng: z.number().optional(),
    deliveryFee: z.number().min(0).default(0),
    minimumOrder: z.number().min(0).default(0),
    estimatedMinutes: z.number().int().min(0).default(60),
    active: z.boolean().default(true),
    hoursStart: z.string().optional(), // e.g. "09:00"
    hoursEnd: z.string().optional(),   // e.g. "21:00"
  })
  const data = zoneSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO delivery_zones(id, name, description, zip_codes, radius_miles, center_lat, center_lng, delivery_fee, minimum_order, estimated_minutes, active, hours_start, hours_end, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.name}, ${data.description || null}, ${JSON.stringify(data.zipCodes || [])}::jsonb, ${data.radiusMiles || null}, ${data.centerLat || null}, ${data.centerLng || null}, ${data.deliveryFee}, ${data.minimumOrder}, ${data.estimatedMinutes}, ${data.active}, ${data.hoursStart || null}, ${data.hoursEnd || null}, ${currentUser.companyId}, NOW(), NOW())
    RETURNING *
  `)

  const zone = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'delivery_zone',
    entityId: zone?.id,
    entityName: data.name,
    req: c.req,
  })

  return c.json(zone, 201)
})

// Update delivery zone
app.put('/zones/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const zoneSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    zipCodes: z.array(z.string()).optional(),
    radiusMiles: z.number().optional(),
    centerLat: z.number().optional(),
    centerLng: z.number().optional(),
    deliveryFee: z.number().min(0).optional(),
    minimumOrder: z.number().min(0).optional(),
    estimatedMinutes: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
    hoursStart: z.string().optional(),
    hoursEnd: z.string().optional(),
  })
  const data = zoneSchema.parse(await c.req.json())

  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.name !== undefined) sets.push(sql`name = ${data.name}`)
  if (data.description !== undefined) sets.push(sql`description = ${data.description}`)
  if (data.zipCodes !== undefined) sets.push(sql`zip_codes = ${JSON.stringify(data.zipCodes)}::jsonb`)
  if (data.radiusMiles !== undefined) sets.push(sql`radius_miles = ${data.radiusMiles}`)
  if (data.centerLat !== undefined) sets.push(sql`center_lat = ${data.centerLat}`)
  if (data.centerLng !== undefined) sets.push(sql`center_lng = ${data.centerLng}`)
  if (data.deliveryFee !== undefined) sets.push(sql`delivery_fee = ${data.deliveryFee}`)
  if (data.minimumOrder !== undefined) sets.push(sql`minimum_order = ${data.minimumOrder}`)
  if (data.estimatedMinutes !== undefined) sets.push(sql`estimated_minutes = ${data.estimatedMinutes}`)
  if (data.active !== undefined) sets.push(sql`active = ${data.active}`)
  if (data.hoursStart !== undefined) sets.push(sql`hours_start = ${data.hoursStart}`)
  if (data.hoursEnd !== undefined) sets.push(sql`hours_end = ${data.hoursEnd}`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE delivery_zones SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Zone not found' }, 404)

  return c.json(updated)
})

// List delivery orders queue
app.get('/orders', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const driverId = c.req.query('driverId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let statusFilter = sql``
  if (status) statusFilter = sql`AND o.delivery_status = ${status}`

  let driverFilter = sql``
  if (driverId) driverFilter = sql`AND o.driver_id = ${driverId}`

  const dataResult = await db.execute(sql`
    SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address,
           u.first_name || ' ' || u.last_name as driver_name
    FROM "order" o
    LEFT JOIN contact c ON c.id = o.contact_id
    LEFT JOIN "user" u ON u.id = o.driver_id
    WHERE o.company_id = ${currentUser.companyId}
      AND o.type = 'delivery'
      ${statusFilter}
      ${driverFilter}
    ORDER BY o.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM "order" o
    WHERE o.company_id = ${currentUser.companyId}
      AND o.type = 'delivery'
      ${statusFilter}
      ${driverFilter}
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Assign driver to delivery order
app.put('/orders/:id/assign', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const { driverId } = z.object({ driverId: z.string() }).parse(await c.req.json())

  const [existing] = await db.select().from(order)
    .where(and(eq(order.id, id), eq(order.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Order not found' }, 404)
  if (existing.type !== 'delivery') return c.json({ error: 'Not a delivery order' }, 400)

  const result = await db.execute(sql`
    UPDATE "order"
    SET driver_id = ${driverId}, delivery_status = 'assigned', updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'order',
    entityId: id,
    entityName: existing.number,
    changes: { driverId: { old: null, new: driverId }, deliveryStatus: { old: existing.status, new: 'assigned' } },
    req: c.req,
  })

  return c.json(updated)
})

// Update delivery status
app.put('/orders/:id/status', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const statusSchema = z.object({
    deliveryStatus: z.enum(['pending', 'assigned', 'picked_up', 'en_route', 'delivered', 'failed', 'returned']),
    notes: z.string().optional(),
    deliveryLat: z.number().optional(),
    deliveryLng: z.number().optional(),
  })
  const data = statusSchema.parse(await c.req.json())

  const [existing] = await db.select().from(order)
    .where(and(eq(order.id, id), eq(order.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Order not found' }, 404)

  const sets: any[] = [
    sql`delivery_status = ${data.deliveryStatus}`,
    sql`updated_at = NOW()`,
  ]
  if (data.notes) sets.push(sql`delivery_notes = ${data.notes}`)
  if (data.deliveryLat) sets.push(sql`delivery_lat = ${data.deliveryLat}`)
  if (data.deliveryLng) sets.push(sql`delivery_lng = ${data.deliveryLng}`)
  if (data.deliveryStatus === 'delivered') sets.push(sql`delivered_at = NOW()`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE "order" SET ${setClause}
    WHERE id = ${id}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'order',
    entityId: id,
    entityName: existing.number,
    changes: { deliveryStatus: { old: (existing as any).deliveryStatus, new: data.deliveryStatus } },
    req: c.req,
  })

  return c.json(updated)
})

export default app

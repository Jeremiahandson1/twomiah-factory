import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { order } from '../../db/schema.ts'
import { eq, and, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

// Raw db.execute rows come back snake_case; every screen in this app reads camelCase. A zone read
// back through this route rendered blank in all five fields — active, zipCodes, deliveryFee,
// minimumOrder — on a zone that had saved perfectly. (T45 H8)
const camelZone = (row: any): any => {
  if (!row || typeof row !== "object") return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}

// The Delivery board and this route were built to different words for the same states. Both are
// accepted and normalised to the stored set, so the board works, its filters match, and the
// database keeps one vocabulary. (T45 H7)
const DELIVERY_STATUSES = ['pending', 'assigned', 'picked_up', 'en_route', 'delivered', 'failed', 'returned']
const STATUS_ALIASES: Record<string, string> = {
  queued: 'pending', in_transit: 'en_route', out_for_delivery: 'en_route',
  cancelled: 'failed', canceled: 'failed', picked: 'picked_up',
  complete: 'delivered', completed: 'delivered',
}
const canonicalDeliveryStatus = (v: string) => STATUS_ALIASES[v] || v

import { zoneTerms } from '../utils/delivery.ts'

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

  // Raw rows are snake_case and the screen reads camelCase, so a zone saved active with two ZIPs, a
  // $5 fee and a $50 minimum rendered as "Inactive, ZIP codes —, fee $0.00, min $0.00" — every field
  // blank, on a zone that was saved correctly. (T45 H8)
  //
  // …and the fee and the minimum are RESOLVED before they leave, by the same helper the order path
  // uses. T46 N12: the table carries two spellings of the minimum — `min_order`, which defaults to
  // '0', and `minimum_order`, which is what the create actually writes — so the screen read 0 off
  // one column while an order was refused against 50 in the other. A screen and a till disagreeing
  // about a shop's own terms is worse than either being wrong on its own.
  return c.json(((result as any).rows || result).map((row: any) => {
    const terms = zoneTerms(row)
    return { ...camelZone(row), deliveryFee: terms.fee, minimumOrder: terms.minimum }
  }))
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

  // Both spellings of the minimum are written, always the same value. The table has carried
  // `min_order` and `minimum_order` side by side for a while; writing one and reading the other is
  // how the Zones screen came to show $0.00 for a zone that refuses orders under $50. (T46 N12)
  const result = await db.execute(sql`
    INSERT INTO delivery_zones(id, name, description, zip_codes, radius_miles, center_lat, center_lng, delivery_fee, minimum_order, min_order, estimated_minutes, active, hours_start, hours_end, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.name}, ${data.description || null}, ${JSON.stringify(data.zipCodes || [])}::jsonb, ${data.radiusMiles || null}, ${data.centerLat || null}, ${data.centerLng || null}, ${data.deliveryFee}, ${data.minimumOrder}, ${data.minimumOrder}, ${data.estimatedMinutes}, ${data.active}, ${data.hoursStart || null}, ${data.hoursEnd || null}, ${currentUser.companyId}, NOW(), NOW())
    RETURNING *
  `)

  const zone = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'delivery_zone',
    entityId: zone?.id,
    entityName: data.name,
    req: c,
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
  // Both spellings, always together — see the note on the create. (T46 N12)
  if (data.minimumOrder !== undefined) {
    sets.push(sql`minimum_order = ${data.minimumOrder}`)
    sets.push(sql`min_order = ${data.minimumOrder}`)
  }
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
  // Normalised here too: the board filters with its own words, so asking for "queued" matched no row
  // because the column holds "pending" — three of its tabs were permanently empty. (T45 H7)
  //
  // …and matched against the status the delivery ACTUALLY has. T46 N18: delivery_status is only
  // written once a driver is assigned, so an order that has been raised and not yet picked up has
  // NULL there and matched nothing — the Queued, Cancelled and In Transit tabs were still empty,
  // this time for a different reason than T45 H7. A delivery that has not started is queued, which
  // is what the board already calls it, and a cancelled ORDER is a cancelled delivery.
  if (status) {
    const wanted = canonicalDeliveryStatus(status)
    statusFilter = wanted === 'pending'
      ? sql`AND COALESCE(NULLIF(o.delivery_status, ''), 'pending') = 'pending' AND o.status <> 'cancelled'`
      : wanted === 'failed'
        ? sql`AND (COALESCE(NULLIF(o.delivery_status, ''), '') = 'failed' OR o.status = 'cancelled')`
        : sql`AND COALESCE(NULLIF(o.delivery_status, ''), 'pending') = ${wanted}`
  }

  let driverFilter = sql``
  if (driverId) driverFilter = sql`AND o.driver_id = ${driverId}`

  const dataResult = await db.execute(sql`
    SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address,
           u.first_name || ' ' || u.last_name as driver_name,
           COALESCE(NULLIF(o.delivery_status, ''), CASE WHEN o.status = 'cancelled' THEN 'failed' ELSE 'pending' END) as delivery_status,
           (SELECT COALESCE(SUM(oi.quantity), 0)::int FROM order_items oi WHERE oi.order_id = o.id) as item_count
    FROM orders o
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
    SELECT COUNT(*)::int as total FROM orders o
    WHERE o.company_id = ${currentUser.companyId}
      AND o.type = 'delivery'
      ${statusFilter}
      ${driverFilter}
  `)

  // Raw rows are snake_case and the board reads camelCase, which is why every card said
  // "#mhpqsx6q — Unknown — 0 items": the order number, the customer's name and the line count were
  // all there, under names the screen never looked up. Same fault as the Zones tab beside it.
  // (T46 N18)
  const data = ((dataResult as any).rows || dataResult).map(camelZone)
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
    UPDATE orders
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
    req: c,
  })

  return c.json(updated)
})

// Update delivery status
app.put('/orders/:id/status', requireRole('driver'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  // The screen and this route were built to different words for the same states: the Delivery board
  // offers queued / in_transit / cancelled, this enum knows pending / en_route / failed. So "Start"
  // answered 400 and three of the board's filters matched nothing, ever. Both vocabularies are
  // accepted and normalised to the stored one, so the board works and the database keeps one set of
  // values. (T45 H7)
  const statusSchema = z.object({
    deliveryStatus: z.string().transform((v, ctx) => {
      const canonical = canonicalDeliveryStatus(v)
      const allowed = DELIVERY_STATUSES
      if (!allowed.includes(canonical)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown delivery status "${v}". Allowed: ${allowed.join(', ')} (also accepted: ${Object.keys(STATUS_ALIASES).join(', ')})` })
        return z.NEVER
      }
      return canonical
    }),
    notes: z.string().optional(),
    deliveryLat: z.number().optional(),
    deliveryLng: z.number().optional(),
  })
  const data = statusSchema.parse(await c.req.json())

  const [existing] = await db.select().from(order)
    .where(and(eq(order.id, id), eq(order.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Order not found' }, 404)

  // This moved a DELIVERY along, and nothing checked the order was one. Run T45 H20 marked a
  // pending, unpaid walk-in "delivered" as a budtender and got a 200 — a record saying cannabis
  // left the building for a customer who never paid and never had their ID checked, on a ticket
  // that was never a delivery in the first place.
  if ((existing as any).type !== 'delivery') {
    return c.json({
      error: `${existing.number} is a ${(existing as any).type || 'walk-in'} order, not a delivery — its delivery status cannot be set.`,
      code: 'not_a_delivery',
    }, 400)
  }
  // "Delivered" says goods were handed over. A sale that has not been settled has not been handed
  // over, and saying so creates a false record of exactly the thing a regulator counts.
  if (data.deliveryStatus === 'delivered' && !existing.completedAt) {
    return c.json({
      error: `${existing.number} has not been completed, so it cannot be marked delivered. Settle the sale first.`,
      code: 'order_not_settled',
    }, 400)
  }

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
    UPDATE orders SET ${setClause}
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
    req: c,
  })

  return c.json(updated)
})

export default app

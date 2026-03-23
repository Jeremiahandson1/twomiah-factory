import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()

// --- Helper: Haversine distance in miles ---
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959 // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// --- Helper: Nearest-neighbor route ordering ---
function optimizeStops(stops: Array<{ lat: number; lng: number; orderId: string; address: string }>, startLat: number, startLng: number) {
  const remaining = [...stops]
  const ordered: typeof stops = []
  let currentLat = startLat
  let currentLng = startLng
  let totalDistance = 0

  while (remaining.length > 0) {
    let nearestIdx = 0
    let nearestDist = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineDistance(currentLat, currentLng, remaining[i].lat, remaining[i].lng)
      if (d < nearestDist) {
        nearestDist = d
        nearestIdx = i
      }
    }
    totalDistance += nearestDist
    currentLat = remaining[nearestIdx].lat
    currentLng = remaining[nearestIdx].lng
    ordered.push(remaining.splice(nearestIdx, 1)[0])
  }

  return { ordered, totalDistance }
}

// ===== DRIVER LOCATION (auth required) =====
app.use('/location/*', authenticate)
app.use('/location', authenticate)

// POST /location — Update driver location
app.post('/location', async (c) => {
  const currentUser = c.get('user') as any

  const locationSchema = z.object({
    lat: z.number(),
    lng: z.number(),
    heading: z.number().optional(),
    speed: z.number().optional(),
    accuracy: z.number().optional(),
    batteryLevel: z.number().min(0).max(100).optional(),
    orderId: z.string().optional(),
  })
  const data = locationSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO driver_locations(id, driver_id, lat, lng, heading, speed, accuracy, battery_level, order_id, company_id, created_at)
    VALUES (gen_random_uuid(), ${currentUser.id}, ${data.lat}, ${data.lng}, ${data.heading || null}, ${data.speed || null}, ${data.accuracy || null}, ${data.batteryLevel || null}, ${data.orderId || null}, ${currentUser.companyId}, NOW())
    RETURNING *
  `)

  const location = ((result as any).rows || result)?.[0]
  return c.json(location, 201)
})

// GET /location/:driverId — Latest location for a driver
app.get('/location/:driverId', async (c) => {
  const currentUser = c.get('user') as any
  const driverId = c.req.param('driverId')

  const result = await db.execute(sql`
    SELECT * FROM driver_locations
    WHERE driver_id = ${driverId} AND company_id = ${currentUser.companyId}
    ORDER BY created_at DESC
    LIMIT 1
  `)

  const location = ((result as any).rows || result)?.[0]
  if (!location) return c.json({ error: 'No location data found' }, 404)

  return c.json(location)
})

// GET /location/:driverId/history — Location history
app.get('/location/:driverId/history', async (c) => {
  const currentUser = c.get('user') as any
  const driverId = c.req.param('driverId')
  const hours = +(c.req.query('hours') || '8')

  const result = await db.execute(sql`
    SELECT * FROM driver_locations
    WHERE driver_id = ${driverId}
      AND company_id = ${currentUser.companyId}
      AND created_at >= NOW() - INTERVAL '1 hour' * ${hours}
    ORDER BY created_at ASC
  `)

  return c.json((result as any).rows || result)
})

// ===== ROUTE OPTIMIZATION (auth required) =====
app.use('/routes/*', authenticate)
app.use('/routes', authenticate)

// POST /routes — Create optimized delivery route
app.post('/routes', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const routeSchema = z.object({
    driverId: z.string(),
    orderIds: z.array(z.string()).min(1),
  })
  const data = routeSchema.parse(await c.req.json())

  // Fetch delivery addresses for each order
  const ordersResult = await db.execute(sql`
    SELECT o.id as order_id, c.address, c.lat, c.lng
    FROM orders o
    LEFT JOIN contact c ON c.id = o.contact_id
    WHERE o.id = ANY(${data.orderIds}::uuid[])
      AND o.company_id = ${currentUser.companyId}
      AND o.type = 'delivery'
  `)
  const orders = (ordersResult as any).rows || ordersResult

  if (!orders.length) return c.json({ error: 'No valid delivery orders found' }, 400)

  // Build stops with lat/lng
  const stops = orders
    .filter((o: any) => o.lat != null && o.lng != null)
    .map((o: any) => ({
      orderId: o.order_id,
      address: o.address || '',
      lat: Number(o.lat),
      lng: Number(o.lng),
      status: 'pending',
      arrivedAt: null,
      departedAt: null,
    }))

  if (!stops.length) return c.json({ error: 'No orders with valid coordinates' }, 400)

  // Get driver's current location as starting point (or use first stop)
  const driverLocResult = await db.execute(sql`
    SELECT lat, lng FROM driver_locations
    WHERE driver_id = ${data.driverId} AND company_id = ${currentUser.companyId}
    ORDER BY created_at DESC LIMIT 1
  `)
  const driverLoc = ((driverLocResult as any).rows || driverLocResult)?.[0]
  const startLat = driverLoc?.lat || stops[0].lat
  const startLng = driverLoc?.lng || stops[0].lng

  // Nearest-neighbor optimization
  const { ordered, totalDistance } = optimizeStops(stops, startLat, startLng)
  const estimatedMinutes = Math.round(totalDistance * 3) // ~3 min per mile avg

  const stopsJson = ordered.map((s, i) => ({ ...s, index: i }))

  const result = await db.execute(sql`
    INSERT INTO delivery_routes(id, driver_id, stops, status, total_distance_miles, estimated_minutes, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.driverId}, ${JSON.stringify(stopsJson)}::jsonb, 'planned', ${totalDistance}, ${estimatedMinutes}, ${currentUser.companyId}, NOW(), NOW())
    RETURNING *
  `)

  const route = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'delivery_route',
    entityId: route?.id,
    entityName: `Route for ${stopsJson.length} stops`,
    req: c.req,
  })

  return c.json(route, 201)
})

// GET /routes — List routes
app.get('/routes', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const driverId = c.req.query('driverId')
  const date = c.req.query('date') // YYYY-MM-DD
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let statusFilter = sql``
  if (status) statusFilter = sql`AND r.status = ${status}`

  let driverFilter = sql``
  if (driverId) driverFilter = sql`AND r.driver_id = ${driverId}`

  let dateFilter = sql``
  if (date) dateFilter = sql`AND r.created_at::date = ${date}::date`

  const dataResult = await db.execute(sql`
    SELECT r.*, u.first_name || ' ' || u.last_name as driver_name
    FROM delivery_routes r
    LEFT JOIN "user" u ON u.id = r.driver_id
    WHERE r.company_id = ${currentUser.companyId}
      ${statusFilter}
      ${driverFilter}
      ${dateFilter}
    ORDER BY r.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM delivery_routes r
    WHERE r.company_id = ${currentUser.companyId}
      ${statusFilter}
      ${driverFilter}
      ${dateFilter}
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// GET /routes/:id — Route detail
app.get('/routes/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    SELECT r.*, u.first_name || ' ' || u.last_name as driver_name
    FROM delivery_routes r
    LEFT JOIN "user" u ON u.id = r.driver_id
    WHERE r.id = ${id} AND r.company_id = ${currentUser.companyId}
  `)

  const route = ((result as any).rows || result)?.[0]
  if (!route) return c.json({ error: 'Route not found' }, 404)

  return c.json(route)
})

// PUT /routes/:id/start — Mark route as active
app.put('/routes/:id/start', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE delivery_routes
    SET status = 'active', started_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND status = 'planned'
    RETURNING *
  `)

  const route = ((result as any).rows || result)?.[0]
  if (!route) return c.json({ error: 'Route not found or not in planned status' }, 404)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'delivery_route',
    entityId: id,
    changes: { status: { old: 'planned', new: 'active' } },
    req: c.req,
  })

  return c.json(route)
})

// PUT /routes/:id/stops/:stopIndex/arrive — Mark arrival at stop
app.put('/routes/:id/stops/:stopIndex/arrive', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const stopIndex = parseInt(c.req.param('stopIndex'))

  const routeResult = await db.execute(sql`
    SELECT * FROM delivery_routes
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND status = 'active'
  `)
  const route = ((routeResult as any).rows || routeResult)?.[0]
  if (!route) return c.json({ error: 'Active route not found' }, 404)

  const stops = typeof route.stops === 'string' ? JSON.parse(route.stops) : route.stops
  if (stopIndex < 0 || stopIndex >= stops.length) return c.json({ error: 'Invalid stop index' }, 400)

  stops[stopIndex].arrivedAt = new Date().toISOString()
  stops[stopIndex].status = 'arrived'

  const result = await db.execute(sql`
    UPDATE delivery_routes
    SET stops = ${JSON.stringify(stops)}::jsonb, updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)

  return c.json(((result as any).rows || result)?.[0])
})

// PUT /routes/:id/stops/:stopIndex/depart — Mark departure from stop
app.put('/routes/:id/stops/:stopIndex/depart', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const stopIndex = parseInt(c.req.param('stopIndex'))

  const routeResult = await db.execute(sql`
    SELECT * FROM delivery_routes
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND status = 'active'
  `)
  const route = ((routeResult as any).rows || routeResult)?.[0]
  if (!route) return c.json({ error: 'Active route not found' }, 404)

  const stops = typeof route.stops === 'string' ? JSON.parse(route.stops) : route.stops
  if (stopIndex < 0 || stopIndex >= stops.length) return c.json({ error: 'Invalid stop index' }, 400)

  stops[stopIndex].departedAt = new Date().toISOString()
  stops[stopIndex].status = 'departed'

  const result = await db.execute(sql`
    UPDATE delivery_routes
    SET stops = ${JSON.stringify(stops)}::jsonb, updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)

  return c.json(((result as any).rows || result)?.[0])
})

// PUT /routes/:id/complete — Complete route
app.put('/routes/:id/complete', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE delivery_routes
    SET status = 'completed', completed_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND status = 'active'
    RETURNING *
  `)

  const route = ((result as any).rows || result)?.[0]
  if (!route) return c.json({ error: 'Active route not found' }, 404)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'delivery_route',
    entityId: id,
    changes: { status: { old: 'active', new: 'completed' } },
    req: c.req,
  })

  return c.json(route)
})

// ===== CUSTOMER-FACING TRACKING (no auth) =====

// GET /public/:trackingToken — Customer delivery status
app.get('/public/:trackingToken', async (c) => {
  const trackingToken = c.req.param('trackingToken')

  // Look up order by tracking token
  const orderResult = await db.execute(sql`
    SELECT o.id, o.delivery_status, o.estimated_delivery_at, o.driver_id,
           u.first_name as driver_first_name
    FROM orders o
    LEFT JOIN "user" u ON u.id = o.driver_id
    WHERE o.tracking_token = ${trackingToken}
      AND o.type = 'delivery'
  `)

  const order = ((orderResult as any).rows || orderResult)?.[0]
  if (!order) return c.json({ error: 'Tracking info not found' }, 404)

  // Get driver's latest location if en route
  let driverLocation = null
  if (order.driver_id && ['en_route', 'picked_up'].includes(order.delivery_status)) {
    const locResult = await db.execute(sql`
      SELECT lat, lng, heading, speed, created_at FROM driver_locations
      WHERE driver_id = ${order.driver_id}
      ORDER BY created_at DESC LIMIT 1
    `)
    const loc = ((locResult as any).rows || locResult)?.[0]
    if (loc) {
      driverLocation = {
        lat: loc.lat,
        lng: loc.lng,
        heading: loc.heading,
        updatedAt: loc.created_at,
      }
    }
  }

  // Find current route leg if applicable
  let currentLeg = null
  if (order.driver_id) {
    const routeResult = await db.execute(sql`
      SELECT stops FROM delivery_routes
      WHERE driver_id = ${order.driver_id} AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `)
    const route = ((routeResult as any).rows || routeResult)?.[0]
    if (route) {
      const stops = typeof route.stops === 'string' ? JSON.parse(route.stops) : route.stops
      const orderStop = stops.find((s: any) => s.orderId === order.id)
      if (orderStop) {
        currentLeg = {
          stopIndex: orderStop.index,
          totalStops: stops.length,
          status: orderStop.status,
        }
      }
    }
  }

  return c.json({
    status: order.delivery_status,
    driverFirstName: order.driver_first_name || null,
    estimatedArrival: order.estimated_delivery_at || null,
    driverLocation,
    currentLeg,
  })
})

export default app

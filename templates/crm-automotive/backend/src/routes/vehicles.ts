import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { vehicle } from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate)

const vehicleSchema = z.object({
  vin: z.string().min(1).max(17),
  stockNumber: z.string().optional(),
  year: z.number().int().min(1900).max(2030),
  make: z.string().min(1),
  model: z.string().min(1),
  trim: z.string().optional(),
  bodyType: z.string().optional(),
  exteriorColor: z.string().optional(),
  interiorColor: z.string().optional(),
  mileage: z.number().int().min(0).optional(),
  status: z.enum(['available', 'sold', 'pending', 'service']).default('available'),
  listedPrice: z.string().optional(),
  internetPrice: z.string().optional(),
  cost: z.string().optional(),
  photos: z.array(z.string()).optional(),
  description: z.string().optional(),
  features: z.array(z.string()).optional(),
  condition: z.enum(['new', 'used', 'cpo']).optional(),
  fuelType: z.string().optional(),
  transmission: z.string().optional(),
  drivetrain: z.string().optional(),
  engine: z.string().optional(),
})

// GET /vehicles — inventory list
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const search = c.req.query('search')
  const condition = c.req.query('condition')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')

  const conditions = [eq(vehicle.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(vehicle.status, status))
  if (condition) conditions.push(eq(vehicle.condition, condition))
  if (search) {
    conditions.push(or(
      ilike(vehicle.make, `%${search}%`),
      ilike(vehicle.model, `%${search}%`),
      ilike(vehicle.vin, `%${search}%`),
      ilike(vehicle.stockNumber, `%${search}%`),
    )!)
  }

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(vehicle).where(where).orderBy(desc(vehicle.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(vehicle).where(where),
  ])

  return c.json({ data, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

// GET /vehicles/:id
app.get('/:id', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const [v] = await db.select().from(vehicle).where(and(eq(vehicle.id, id), eq(vehicle.companyId, currentUser.companyId))).limit(1)
  if (!v) return c.json({ error: 'Vehicle not found' }, 404)
  return c.json(v)
})

// POST /vehicles — add vehicle
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = vehicleSchema.parse(await c.req.json())

  const [created] = await db.insert(vehicle).values({
    id: createId(),
    ...body,
    photos: body.photos || [],
    features: body.features || [],
    companyId: currentUser.companyId,
  }).returning()

  await audit.log({ action: 'create', entity: 'vehicle', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'vehicle' })
  return c.json(created, 201)
})

// PUT /vehicles/:id
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()

  const [existing] = await db.select().from(vehicle).where(and(eq(vehicle.id, id), eq(vehicle.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Vehicle not found' }, 404)

  const [updated] = await db.update(vehicle).set({ ...body, updatedAt: new Date() }).where(eq(vehicle.id, id)).returning()
  await audit.log({ action: 'update', entity: 'vehicle', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'vehicle' })
  return c.json(updated)
})

// DELETE /vehicles/:id
app.delete('/:id', requirePermission('contacts:delete'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const [existing] = await db.select().from(vehicle).where(and(eq(vehicle.id, id), eq(vehicle.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Vehicle not found' }, 404)

  await db.delete(vehicle).where(eq(vehicle.id, id))
  await audit.log({ action: 'delete', entity: 'vehicle', entityId: id, metadata: existing, req: { user: currentUser } })
  return c.json({ success: true })
})

// POST /vehicles/vin-decode — NHTSA free VIN decoder
app.post('/vin-decode', requirePermission('contacts:read'), async (c) => {
  const { vin } = await c.req.json()
  if (!vin || typeof vin !== 'string' || vin.length !== 17) {
    return c.json({ error: 'VIN must be exactly 17 characters' }, 400)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const res = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${encodeURIComponent(vin)}?format=json`,
      { signal: controller.signal }
    )
    clearTimeout(timeout)

    if (!res.ok) return c.json({ error: 'NHTSA API error' }, 502)
    const data = await res.json()

    const getValue = (varId: number) => {
      const item = data.Results?.find((r: any) => r.VariableId === varId)
      return item?.Value && item.Value !== 'Not Applicable' ? item.Value : null
    }

    return c.json({
      vin,
      year: parseInt(getValue(29) || '0') || null,
      make: getValue(26),
      model: getValue(28),
      trim: getValue(38),
      bodyType: getValue(5),
      fuelType: getValue(24),
      transmission: getValue(37),
      drivetrain: getValue(15),
      engine: [getValue(13), getValue(21)].filter(Boolean).join(' ') || null,
      displacement: getValue(11),
      cylinders: getValue(13),
    })
  } catch (err: any) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') return c.json({ error: 'NHTSA API timeout' }, 504)
    return c.json({ error: 'VIN decode failed' }, 500)
  }
})

export default app

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { unit } from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()
app.use('*', authenticate)

const unitSchema = z.object({
  category: z.string().min(1),
  vin: z.string().min(1).max(17).optional(),
  stockNumber: z.string().optional(),
  year: z.number().int().min(1900).max(2030).optional(),
  make: z.string().optional(),
  modelName: z.string().optional(),
  trim: z.string().optional(),
  exteriorColor: z.string().optional(),
  interiorColor: z.string().optional(),
  mileage: z.number().int().min(0).optional(),
  status: z.enum(['available', 'sold', 'pending', 'on_order', 'in_service']).default('available'),
  // Money fields are decimal-as-string; reject negatives (M-01: listedPrice "-500"
  // was accepted and syndicated) and non-numeric junk.
  msrp: z.string().refine(v => v === '' || (!isNaN(Number(v)) && Number(v) >= 0), 'Must be a non-negative amount').optional(),
  listedPrice: z.string().refine(v => v === '' || (!isNaN(Number(v)) && Number(v) >= 0), 'Must be a non-negative amount').optional(),
  internetPrice: z.string().refine(v => v === '' || (!isNaN(Number(v)) && Number(v) >= 0), 'Must be a non-negative amount').optional(),
  cost: z.string().refine(v => v === '' || (!isNaN(Number(v)) && Number(v) >= 0), 'Must be a non-negative amount').optional(),
  photos: z.array(z.string()).optional(),
  floorplanImg: z.string().optional(),
  description: z.string().optional(),
  features: z.array(z.string()).optional(),
  condition: z.enum(['new', 'used', 'consignment']).optional(),
  // RV-specific
  rvClass: z.string().optional(),
  towableType: z.string().optional(),
  lengthFt: z.string().optional(),
  sleeps: z.number().int().min(0).optional(),
  slideOuts: z.number().int().min(0).optional(),
  gvwr: z.number().int().min(0).optional(),
  dryWeight: z.number().int().min(0).optional(),
  hitchWeight: z.number().int().min(0).optional(),
  chassis: z.string().optional(),
  freshTankGal: z.number().int().min(0).optional(),
  greyTankGal: z.number().int().min(0).optional(),
  blackTankGal: z.number().int().min(0).optional(),
  generatorHours: z.number().int().min(0).optional(),
  awnings: z.number().int().min(0).optional(),
  // Motorized / powersports
  fuelType: z.string().optional(),
  engine: z.string().optional(),
  engineCc: z.number().int().min(0).optional(),
  hours: z.number().int().min(0).optional(),
  transmission: z.string().optional(),
  drivetrain: z.string().optional(),
  // Marine / boat-specific
  hin: z.string().optional(),
  beamFt: z.coerce.string().optional(),
  draftFt: z.coerce.string().optional(),
  hullMaterial: z.string().optional(),
  engineType: z.string().optional(),
  engineCount: z.number().int().min(0).optional(),
  engineHp: z.number().int().min(0).optional(),
  fuelCapacityGal: z.number().int().min(0).optional(),
  maxPersons: z.number().int().min(0).optional(),
  trailerIncluded: z.boolean().optional(),
})

// GET /units — inventory list
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const search = c.req.query('search')
  const condition = c.req.query('condition')
  const category = c.req.query('category')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')

  const conditions = [eq(unit.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(unit.status, status))
  if (condition) conditions.push(eq(unit.condition, condition))
  if (category) conditions.push(eq(unit.category, category))
  if (search) {
    conditions.push(or(
      ilike(unit.make, `%${search}%`),
      ilike(unit.modelName, `%${search}%`),
      ilike(unit.vin, `%${search}%`),
      ilike(unit.stockNumber, `%${search}%`),
    )!)
  }

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(unit).where(where).orderBy(desc(unit.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(unit).where(where),
  ])

  return c.json({ data, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

// GET /units/:id
app.get('/:id', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const [u] = await db.select().from(unit).where(and(eq(unit.id, id), eq(unit.companyId, currentUser.companyId))).limit(1)
  if (!u) return c.json({ error: 'Unit not found' }, 404)
  return c.json(u)
})

// POST /units — add unit
app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = unitSchema.parse(await c.req.json())

  // The stock number is the physical tag staff search by — duplicates make
  // lookup ambiguous (M-02). Reject a stock number already in use.
  if (body.stockNumber && String(body.stockNumber).trim()) {
    const [dupe] = await db.select({ id: unit.id }).from(unit)
      .where(and(eq(unit.companyId, currentUser.companyId), eq(unit.stockNumber, body.stockNumber)))
      .limit(1)
    if (dupe) return c.json({ error: `Stock number "${body.stockNumber}" is already in use` }, 409)
  }

  const [created] = await db.insert(unit).values({
    id: createId(),
    ...body,
    photos: body.photos || [],
    features: body.features || [],
    companyId: currentUser.companyId,
  }).returning()

  await audit.log({ action: 'create', entity: 'unit', entityId: created.id, metadata: created, req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'unit' })
  return c.json(created, 201)
})

// PUT /units/:id
app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()

  const [existing] = await db.select().from(unit).where(and(eq(unit.id, id), eq(unit.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Unit not found' }, 404)

  // Whitelist editable columns — never let companyId/id be reassigned from the body.
  const EDITABLE = ['category','condition','stockNumber','vin','year','make','modelName','trim','status','msrp','listedPrice','internetPrice','cost','photos','floorplanImg','description','features','exteriorColor','interiorColor','rvClass','towableType','lengthFt','sleeps','slideOuts','gvwr','dryWeight','hitchWeight','chassis','freshTankGal','greyTankGal','blackTankGal','generatorHours','awnings','fuelType','engine','engineCc','mileage','hours','transmission','drivetrain','hin','beamFt','draftFt','hullMaterial','engineType','engineCount','engineHp','fuelCapacityGal','maxPersons','trailerIncluded'] as const
  const updates: any = { updatedAt: new Date() }
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]
  const [updated] = await db.update(unit).set(updates).where(eq(unit.id, id)).returning()
  await audit.log({ action: 'update', entity: 'unit', entityId: id, changes: audit.diff(existing, updated), req: { user: currentUser } })
  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'unit' })
  return c.json(updated)
})

// DELETE /units/:id
app.delete('/:id', requirePermission('contacts:delete'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const [existing] = await db.select().from(unit).where(and(eq(unit.id, id), eq(unit.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Unit not found' }, 404)

  await db.delete(unit).where(eq(unit.id, id))
  await audit.log({ action: 'delete', entity: 'unit', entityId: id, metadata: existing, req: { user: currentUser } })
  return c.json({ success: true })
})

// POST /units/vin-decode — NHTSA free VIN decoder (motorized units / motorhomes)
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
      modelName: getValue(28),
      trim: getValue(38),
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

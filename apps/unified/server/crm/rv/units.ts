// The dealership's unit inventory: RVs, towables, powersports and boats for sale, the VIN decoder. What the store
// PAID (cost) is margin:read's (T41/T42); every selling price stays for the floor. Moved from
// templates/crm-rv/backend/src/routes/units.ts.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, or, ilike, count, desc, ne } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { roundsToNothing } from '@twomiah/tenant-backend'
import { unit } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, list, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

// Strip HTML tags from free-text so a stored <script> payload can never reach an un-escaped render path (a PDF quote,
// an email, a partner feed) — M-05. These fields never legitimately contain markup.
const noTags = z.string().transform(s => s.replace(/<[^>]*>/g, '')).optional()

/**
 * A money column on this table, as the one rule (T51 follow-up). Empty means "not set". Otherwise a number, not
 * negative, and not a positive amount that rounds to 0.00 in a decimal(…,2) column. An exact "0" stays allowed.
 */
const money = z.string()
  .refine(v => v === '' || !isNaN(Number(v)), 'Must be an amount')
  .refine(v => v === '' || Number(v) >= 0, 'Must be a non-negative amount')
  .refine(v => !roundsToNothing(v), 'That rounds to $0.00 — enter 0, or at least one cent')
  .optional()

// A unit that goes to the public marketplace feed needs a real identity (RV T19 M1).
export const UNIT_CATEGORIES = ['motorhome', 'towable', 'motorcycle', 'atv', 'utv', 'sxs', 'pwc', 'snowmobile', 'boat'] as const
const requiredText = (label: string) => z.string({ required_error: `${label} is required` })
  .transform(s => s.replace(/<[^>]*>/g, '').trim())
  .refine(s => s.length > 0, `${label} is required`)

const unitSchema = z.object({
  category: z.enum(UNIT_CATEGORIES, { errorMap: () => ({ message: `Category must be one of: ${UNIT_CATEGORIES.join(', ')}` }) }),
  vin: z.string()
    .transform(s => s.trim().toUpperCase())
    .refine(v => /^[A-HJ-NPR-Z0-9]{17}$/.test(v) || /^[A-Z0-9]{5,16}$/.test(v), 'VIN must be a 17-character VIN (letters and digits, no I, O or Q) or a 5–16 character serial number')
    .optional(),
  stockNumber: requiredText('Stock number'),
  year: z.number({ required_error: 'Year is required', invalid_type_error: 'Year must be a number' }).int().min(1900).max(2030),
  make: requiredText('Make'),
  modelName: requiredText('Model'),
  trim: noTags,
  exteriorColor: noTags,
  interiorColor: noTags,
  mileage: z.number().int().min(0).optional(),
  status: z.enum(['available', 'sold', 'pending', 'on_order', 'in_service']).default('available'),
  // Money fields are decimal-as-string; negatives, junk and amounts that round to nothing are refused (M-01, T51).
  msrp: money, listedPrice: money, internetPrice: money, cost: money,
  photos: z.array(z.string()).optional(),
  floorplanImg: z.string().optional(),
  description: noTags,
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
// an edit validates the fields it sends with the same rules
const unitUpdateSchema = unitSchema.partial()

const EDITABLE = ['category', 'condition', 'stockNumber', 'vin', 'year', 'make', 'modelName', 'trim', 'status', 'msrp', 'listedPrice', 'internetPrice', 'cost', 'photos', 'floorplanImg', 'description', 'features', 'exteriorColor', 'interiorColor', 'rvClass', 'towableType', 'lengthFt', 'sleeps', 'slideOuts', 'gvwr', 'dryWeight', 'hitchWeight', 'chassis', 'freshTankGal', 'greyTankGal', 'blackTankGal', 'generatorHours', 'awnings', 'fuelType', 'engine', 'engineCc', 'mileage', 'hours', 'transmission', 'drivetrain', 'hin', 'beamFt', 'draftFt', 'hullMaterial', 'engineType', 'engineCount', 'engineHp', 'fuelCapacityGal', 'maxPersons', 'trailerIncluded'] as const

// Unusual but possible pricing is saved with a warning rather than refused.
function priceWarnings(u: { msrp?: unknown; internetPrice?: unknown; cost?: unknown }): string[] {
  const n = (v: unknown) => (v === '' || v == null ? null : Number(v))
  const msrp = n(u.msrp), price = n(u.internetPrice), cost = n(u.cost)
  const out: string[] = []
  if (msrp && price != null && price > msrp * 2) out.push(`Internet price $${price.toLocaleString('en-US')} is more than double the MSRP ($${msrp.toLocaleString('en-US')}) — check it before it goes to the marketplaces.`)
  if (cost != null && price != null && price > 0 && cost > price) out.push(`Cost $${cost.toLocaleString('en-US')} is above the internet price ($${price.toLocaleString('en-US')}).`)
  return out
}

/** A unit without what the store paid for it. */
export const hideUnitCost = <T extends Record<string, any>>(row: T): T => {
  if (!row) return row
  const { cost: _cost, ...rest } = row as any
  return rest
}

export function createUnitRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission, hasPermission, getExtraPermissions } = d.permissions
  const app = new Hono<AppEnv>()

  /** WHAT THE DEALERSHIP PAID is not part of reading the inventory: margin:read (owner, admin, manager). (T41, T42) */
  const maySeeUnitCost = async (u: any): Promise<boolean> => hasPermission(u?.role, 'margin:read', await getExtraPermissions(u?.userId))

  app.get('/', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user')
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
    return list(c, (await maySeeUnitCost(currentUser)) ? data : data.map(hideUnitCost), { page, limit, total: Number(total) })
  })

  app.get('/:id', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user')
    const [u] = await db.select().from(unit).where(and(eq(unit.id, c.req.param('id')), eq(unit.companyId, currentUser.companyId))).limit(1)
    if (!u) return fail(c, 404, 'Unit not found')
    return one(c, (await maySeeUnitCost(currentUser)) ? u : hideUnitCost(u))
  })

  app.post('/', requirePermission('contacts:create'), async (c) => {
    const currentUser = c.get('user')
    const body = unitSchema.parse(await c.req.json())
    // The stock number is the physical tag staff search by — a duplicate makes lookup ambiguous (M-02).
    if (body.stockNumber && String(body.stockNumber).trim()) {
      const [dupe] = await db.select({ id: unit.id }).from(unit)
        .where(and(eq(unit.companyId, currentUser.companyId), eq(unit.stockNumber, body.stockNumber))).limit(1)
      if (dupe) return fail(c, 409, `Stock number "${body.stockNumber}" is already in use`)
    }
    const [created] = await db.insert(unit).values({
      id: createId(), ...body, photos: body.photos || [], features: body.features || [], companyId: currentUser.companyId,
    }).returning()
    await d.audit.log({ action: 'create', entity: 'unit', entityId: created.id, metadata: created, req: { user: currentUser } })
    d.realtime.emitToCompany(currentUser.companyId, d.realtime.EVENTS.REFRESH, { entity: 'unit' })
    const warnings = priceWarnings(created)
    return one(c, warnings.length ? { ...created, warnings } : created, 201)
  })

  app.put('/:id', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user')
    const id = c.req.param('id')
    const body = unitUpdateSchema.parse(await c.req.json())
    const [existing] = await db.select().from(unit).where(and(eq(unit.id, id), eq(unit.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Unit not found')
    if (body.stockNumber !== undefined && body.stockNumber !== existing.stockNumber) {
      const [dupe] = await db.select({ id: unit.id }).from(unit)
        .where(and(eq(unit.companyId, currentUser.companyId), eq(unit.stockNumber, body.stockNumber), ne(unit.id, existing.id))).limit(1)
      if (dupe) return fail(c, 409, `Stock number "${body.stockNumber}" is already in use`)
    }
    // Only the editable columns — never companyId or id from the body.
    const updates: any = { updatedAt: new Date() }
    for (const k of EDITABLE) if (k in body && (body as any)[k] !== undefined) updates[k] = (body as any)[k]
    const [updated] = await db.update(unit).set(updates).where(eq(unit.id, id)).returning()
    await d.audit.log({ action: 'update', entity: 'unit', entityId: id, changes: d.audit.diff(existing, updated), req: { user: currentUser } })
    d.realtime.emitToCompany(currentUser.companyId, d.realtime.EVENTS.REFRESH, { entity: 'unit' })
    const warnings = priceWarnings(updated)
    return one(c, warnings.length ? { ...updated, warnings } : updated)
  })

  app.delete('/:id', requirePermission('contacts:delete'), async (c) => {
    const currentUser = c.get('user')
    const id = c.req.param('id')
    const [existing] = await db.select().from(unit).where(and(eq(unit.id, id), eq(unit.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Unit not found')
    await db.delete(unit).where(eq(unit.id, id))
    await d.audit.log({ action: 'delete', entity: 'unit', entityId: id, metadata: existing, req: { user: currentUser } })
    return done(c)
  })

  // POST /vin-decode — NHTSA's free VIN decoder (motorized units / motorhomes)
  app.post('/vin-decode', requirePermission('contacts:read'), async (c) => {
    const { vin } = await c.req.json()
    if (!vin || typeof vin !== 'string' || vin.length !== 17) return fail(c, 400, 'VIN must be exactly 17 characters')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    try {
      const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${encodeURIComponent(vin)}?format=json`, { signal: controller.signal })
      clearTimeout(timeout)
      if (!res.ok) return fail(c, 502, 'NHTSA API error')
      const data: any = await res.json()
      const getValue = (varId: number) => {
        const item = data.Results?.find((r: any) => r.VariableId === varId)
        return item?.Value && item.Value !== 'Not Applicable' ? item.Value : null
      }
      return one(c, {
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
      if (err.name === 'AbortError') return fail(c, 504, 'NHTSA API timeout')
      return fail(c, 500, 'VIN decode failed')
    }
  })

  return app
}

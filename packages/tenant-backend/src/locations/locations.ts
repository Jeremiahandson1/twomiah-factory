/**
 * Locations — ONE implementation for every CRM that offers `multi_location` as a list of branches (crm,
 * crm-fieldservice, crm-landscaping, crm-basic). Vendored as ../shared; the template's routes/locations.ts
 * wires in its db and tables. crm-dispensary's multi-location is a different system (stock per store,
 * transfers) and keeps its own route.
 *
 * Was three byte-identical copies. What changed on the way in:
 *   · A BRANCH CODE IS UNIQUE PER COMPANY, and saying so is a 409 with words. The unique index already
 *     existed in migration 0005, so a duplicate code reached Postgres and came back as a 500.
 *   · THE MANAGER IS ONE OF YOUR PEOPLE. managerUserId was stored as typed, so any string — or another
 *     tenant's user id — saved happily.
 *   · A BRANCH CAN BE BROUGHT BACK. Deactivating was one-way: isActive was not in the schema, so a PUT
 *     with isActive:true was stripped by zod and answered 200 having done nothing (the T58k shape).
 *
 * Reads stay open to every signed-in person on purpose: a branch's name, address and phone are what a
 * picker shows anyone choosing where work happens, and are on the business's own website besides.
 *
 * Table: location (crm-fieldservice/landscaping/basic migration 0005, crm 0041).
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, ne } from 'drizzle-orm'
import { zipField } from '../address'

export interface LocationTables { location: any; user: any }
export interface LocationRoutesDeps {
  db: any
  tables: LocationTables
  authenticate: any
  requirePermission: (permission: string) => any
}

const optionalText = (max: number) => z.string().trim().max(max).optional()

const locationSchema = z.object({
  name: z.string().trim().min(1, 'A location needs a name').max(120),
  code: z.string().trim().min(1, 'A location needs a short code').max(10, 'Keep the code to 10 characters or fewer').transform((s) => s.toUpperCase()),
  address: optionalText(200),
  city: optionalText(100),
  state: optionalText(50),
  zip: zipField(),
  phone: optionalText(40),
  email: z.string().trim().email('That email address does not look right').optional().or(z.literal('')),
  timezone: z.string().trim().min(1).max(64).default('America/Chicago'),
  serviceAreaRadiusMiles: z.number().int('Use whole miles').min(0, 'A service radius cannot be negative').max(1000).default(25),
  managerUserId: z.string().min(1).nullable().optional(),
  notes: optionalText(2000),
  isActive: z.boolean().optional(),
})

/** Postgres unique_violation, as drizzle surfaces it from either driver. */
const isUniqueViolation = (err: any) => err?.code === '23505' || err?.cause?.code === '23505' || /unique/i.test(String(err?.message || ''))

export function createLocationRoutes(deps: LocationRoutesDeps) {
  const { db, tables: t, authenticate, requirePermission } = deps
  const app = new Hono()
  app.use('*', authenticate)

  const codeTaken = async (companyId: string, code: string, exceptId?: string) => {
    const conditions = [eq(t.location.companyId, companyId), eq(t.location.code, code)]
    if (exceptId) conditions.push(ne(t.location.id, exceptId))
    const [row] = await db.select({ id: t.location.id }).from(t.location).where(and(...conditions)).limit(1)
    return !!row
  }
  const managerRefusal = async (companyId: string, managerUserId?: string | null) => {
    if (!managerUserId) return null
    const [row] = await db.select({ id: t.user.id }).from(t.user).where(and(eq(t.user.id, managerUserId), eq(t.user.companyId, companyId))).limit(1)
    return row ? null : 'That manager is not one of your people'
  }
  const taken = (code: string) => ({ error: `Another location already uses the code ${code}. Pick a different one.`, code: 'location_code_taken' })

  app.get('/', async (c) => {
    const currentUser = c.get('user') as any
    const conditions = [eq(t.location.companyId, currentUser.companyId)]
    if (c.req.query('active') === 'true') conditions.push(eq(t.location.isActive, true))
    const data = await db.select().from(t.location).where(and(...conditions))
    return c.json({ data })
  })

  app.get('/:id', async (c) => {
    const currentUser = c.get('user') as any
    const [found] = await db.select().from(t.location)
      .where(and(eq(t.location.id, c.req.param('id')), eq(t.location.companyId, currentUser.companyId))).limit(1)
    if (!found) return c.json({ error: 'Location not found' }, 404)
    return c.json(found)
  })

  app.post('/', requirePermission('locations:create'), async (c) => {
    const currentUser = c.get('user') as any
    const parsed = locationSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Check the location', issues: parsed.error.issues }, 400)
    const data = parsed.data
    const refusal = await managerRefusal(currentUser.companyId, data.managerUserId)
    if (refusal) return c.json({ error: refusal }, 400)
    if (await codeTaken(currentUser.companyId, data.code)) return c.json(taken(data.code), 409)
    try {
      const [created] = await db.insert(t.location).values({ ...data, managerUserId: data.managerUserId || null, companyId: currentUser.companyId } as any).returning()
      return c.json(created, 201)
    } catch (err: any) {
      // Two people adding the same code at once: the index catches the second.
      if (isUniqueViolation(err)) return c.json(taken(data.code), 409)
      throw err
    }
  })

  app.put('/:id', requirePermission('locations:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const parsed = locationSchema.partial().safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Check the location', issues: parsed.error.issues }, 400)
    const data = parsed.data
    const refusal = await managerRefusal(currentUser.companyId, data.managerUserId)
    if (refusal) return c.json({ error: refusal }, 400)
    if (data.code && await codeTaken(currentUser.companyId, data.code, id)) return c.json(taken(data.code), 409)
    try {
      const [updated] = await db.update(t.location).set({ ...data, updatedAt: new Date() } as any)
        .where(and(eq(t.location.id, id), eq(t.location.companyId, currentUser.companyId))).returning()
      if (!updated) return c.json({ error: 'Location not found' }, 404)
      return c.json(updated)
    } catch (err: any) {
      if (isUniqueViolation(err) && data.code) return c.json(taken(data.code), 409)
      throw err
    }
  })

  // Deactivate, not delete, so anything that names the branch still resolves. PUT {isActive:true} brings it back.
  app.delete('/:id', requirePermission('locations:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const [updated] = await db.update(t.location).set({ isActive: false, updatedAt: new Date() } as any)
      .where(and(eq(t.location.id, c.req.param('id')), eq(t.location.companyId, currentUser.companyId))).returning()
    if (!updated) return c.json({ error: 'Location not found' }, 404)
    return c.json(updated)
  })

  return app
}

/**
 * Locations — Fleet tier feature (multi-location dispatch).
 *
 * A single agency can operate multiple branches (e.g., Joe's HVAC —
 * Chicago, Milwaukee, Indianapolis). Each location has its own service
 * area, phone number, manager, and tech roster. Techs and jobs can be
 * assigned to a location for dispatch routing.
 *
 * Table created in migration 0005_add_fleet_tier_features.sql.
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { location } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

const locationSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1).max(10),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  timezone: z.string().default('America/Chicago'),
  serviceAreaRadiusMiles: z.number().int().default(25),
  managerUserId: z.string().optional(),
  notes: z.string().optional(),
})

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const active = c.req.query('active')

  const conditions = [eq(location.companyId, currentUser.companyId)]
  if (active === 'true') conditions.push(eq(location.isActive, true))

  const data = await db.select().from(location).where(and(...conditions))
  return c.json({ data })
})

app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const [found] = await db
    .select()
    .from(location)
    .where(and(eq(location.id, id), eq(location.companyId, currentUser.companyId)))
    .limit(1)
  if (!found) return c.json({ error: 'Location not found' }, 404)
  return c.json(found)
})

app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const data = locationSchema.parse(await c.req.json())
  const [created] = await db
    .insert(location)
    .values({ ...data, companyId: currentUser.companyId } as any)
    .returning()
  return c.json(created, 201)
})

app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const data = locationSchema.partial().parse(await c.req.json())
  const [updated] = await db
    .update(location)
    .set({ ...data, updatedAt: new Date() } as any)
    .where(eq(location.id, id))
    .returning()
  return c.json(updated)
})

app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  // Soft delete — set inactive so historical assignments still resolve
  const [updated] = await db
    .update(location)
    .set({ isActive: false, updatedAt: new Date() } as any)
    .where(eq(location.id, id))
    .returning()
  return c.json(updated)
})

export default app

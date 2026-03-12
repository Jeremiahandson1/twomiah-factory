import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { crew, job } from '../../db/schema.ts'
import { eq, and, desc, count } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

const crewSchema = z.object({
  name: z.string().min(1),
  foremanName: z.string().min(1),
  foremanPhone: z.string().min(1),
  size: z.number().int().min(1),
  isSubcontractor: z.boolean().default(false),
  subcontractorCompanyName: z.string().optional(),
  isActive: z.boolean().default(true),
})

// List all crews
app.get('/', async (c) => {
  const currentUser = c.get('user') as any

  const crews = await db.select().from(crew)
    .where(eq(crew.companyId, currentUser.companyId))
    .orderBy(desc(crew.createdAt))

  return c.json(crews)
})

// Create crew
app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const data = crewSchema.parse(await c.req.json())

  const [newCrew] = await db.insert(crew).values({
    ...data,
    companyId: currentUser.companyId,
  }).returning()

  return c.json(newCrew, 201)
})

// Get crew detail with active job assignments
app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [foundCrew] = await db.select().from(crew)
    .where(and(eq(crew.id, id), eq(crew.companyId, currentUser.companyId)))
    .limit(1)
  if (!foundCrew) return c.json({ error: 'Crew not found' }, 404)

  // Get active jobs assigned to this crew (not collected/invoiced)
  const activeJobs = await db.select({
    id: job.id,
    jobNumber: job.jobNumber,
    jobType: job.jobType,
    status: job.status,
    propertyAddress: job.propertyAddress,
    city: job.city,
    state: job.state,
    installDate: job.installDate,
  }).from(job)
    .where(and(eq(job.assignedCrewId, id), eq(job.companyId, currentUser.companyId)))
    .orderBy(desc(job.createdAt))

  return c.json({ ...foundCrew, activeJobs })
})

// Update crew
app.put('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = crewSchema.partial().parse(await c.req.json())

  const [existing] = await db.select().from(crew)
    .where(and(eq(crew.id, id), eq(crew.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Crew not found' }, 404)

  const [updated] = await db.update(crew).set({
    ...data,
    updatedAt: new Date(),
  }).where(eq(crew.id, id)).returning()

  return c.json(updated)
})

// Delete crew
app.delete('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(crew)
    .where(and(eq(crew.id, id), eq(crew.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Crew not found' }, 404)

  await db.delete(crew).where(eq(crew.id, id))
  return c.body(null, 204)
})

export default app

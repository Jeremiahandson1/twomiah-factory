import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { timeEntry, user, project, job } from '../../db/schema.ts'
import { eq, and, gte, lte, count, desc } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

const timeSchema = z.object({
  date: z.string().optional(),
  hours: z.number().positive(),
  hourlyRate: z.number().optional(),
  description: z.string().optional(),
  billable: z.boolean().default(true),
  projectId: z.string().optional(),
  jobId: z.string().optional(),
})

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const userId = c.req.query('userId')
  const projectId = c.req.query('projectId')
  const jobId = c.req.query('jobId')
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions = [eq(timeEntry.companyId, currentUser.companyId)]
  if (userId) conditions.push(eq(timeEntry.userId, userId))
  if (projectId) conditions.push(eq(timeEntry.projectId, projectId))
  if (jobId) conditions.push(eq(timeEntry.jobId, jobId))
  if (startDate) conditions.push(gte(timeEntry.date, new Date(startDate)))
  if (endDate) conditions.push(lte(timeEntry.date, new Date(endDate)))

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(timeEntry).where(where).orderBy(desc(timeEntry.date)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(timeEntry).where(where),
  ])

  // Fetch related entities
  const userIds = [...new Set(data.map(e => e.userId))]
  const projectIds = [...new Set(data.filter(e => e.projectId).map(e => e.projectId!))]
  const jobIds = [...new Set(data.filter(e => e.jobId).map(e => e.jobId!))]

  const [users, projects, jobs] = await Promise.all([
    userIds.length ? db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName }).from(user).where(eq(user.companyId, currentUser.companyId)) : Promise.resolve([]),
    projectIds.length ? db.select({ id: project.id, name: project.name }).from(project).where(eq(project.companyId, currentUser.companyId)) : Promise.resolve([]),
    jobIds.length ? db.select({ id: job.id, title: job.title }).from(job).where(eq(job.companyId, currentUser.companyId)) : Promise.resolve([]),
  ])

  const userMap = Object.fromEntries(users.map(u => [u.id, u]))
  const projectMap = Object.fromEntries(projects.map(p => [p.id, p]))
  const jobMap = Object.fromEntries(jobs.map(j => [j.id, j]))

  const dataWithRelations = data.map(e => ({
    ...e,
    user: userMap[e.userId] || null,
    project: e.projectId ? projectMap[e.projectId] || null : null,
    job: e.jobId ? jobMap[e.jobId] || null : null,
  }))

  return c.json({ data: dataWithRelations, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

app.get('/summary', async (c) => {
  const currentUser = c.get('user') as any
  const userId = c.req.query('userId')
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')

  const conditions = [eq(timeEntry.companyId, currentUser.companyId)]
  if (userId) conditions.push(eq(timeEntry.userId, userId))
  if (startDate) conditions.push(gte(timeEntry.date, new Date(startDate)))
  if (endDate) conditions.push(lte(timeEntry.date, new Date(endDate)))

  const entries = await db.select({ hours: timeEntry.hours, billable: timeEntry.billable, hourlyRate: timeEntry.hourlyRate }).from(timeEntry).where(and(...conditions))

  const totalHours = entries.reduce((s, e) => s + Number(e.hours), 0)
  const billableHours = entries.filter(e => e.billable).reduce((s, e) => s + Number(e.hours), 0)
  const billableAmount = entries.filter(e => e.billable && e.hourlyRate).reduce((s, e) => s + Number(e.hours) * Number(e.hourlyRate), 0)

  return c.json({ totalHours, billableHours, nonBillableHours: totalHours - billableHours, billableAmount, entries: entries.length })
})

app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const data = timeSchema.parse(await c.req.json())

  const [entry] = await db.insert(timeEntry).values({
    id: createId(),
    hours: data.hours.toString(),
    hourlyRate: data.hourlyRate?.toString(),
    description: data.description,
    billable: data.billable,
    projectId: data.projectId || null,
    jobId: data.jobId || null,
    date: data.date ? new Date(data.date) : new Date(),
    companyId: currentUser.companyId,
    userId: currentUser.userId,
  }).returning()

  return c.json(entry, 201)
})

app.put('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = timeSchema.partial().parse(await c.req.json())

  const [existing] = await db.select().from(timeEntry).where(and(eq(timeEntry.id, id), eq(timeEntry.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Time entry not found' }, 404)

  const updateData: Record<string, any> = { ...data, updatedAt: new Date() }
  if (data.hours !== undefined) updateData.hours = data.hours.toString()
  if (data.hourlyRate !== undefined) updateData.hourlyRate = data.hourlyRate.toString()
  if (data.date) updateData.date = new Date(data.date)

  const [entry] = await db.update(timeEntry).set(updateData).where(eq(timeEntry.id, id)).returning()
  return c.json(entry)
})

app.delete('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(timeEntry).where(and(eq(timeEntry.id, id), eq(timeEntry.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Time entry not found' }, 404)

  await db.delete(timeEntry).where(eq(timeEntry.id, id))
  return c.body(null, 204)
})

app.post('/:id/approve', async (c) => {
  const id = c.req.param('id')
  const [entry] = await db.update(timeEntry).set({ approved: true, updatedAt: new Date() }).where(eq(timeEntry.id, id)).returning()
  return c.json(entry)
})

export default app

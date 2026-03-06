import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { job, project, contact, user, timeEntry } from '../../db/schema.ts'
import { eq, and, gte, lt, count, asc, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'

const app = new Hono()
app.use('*', authenticate)

const jobSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  projectId: z.string().optional().transform(v => v === '' ? undefined : v),
  contactId: z.string().optional().transform(v => v === '' ? undefined : v),
  assignedToId: z.string().optional().transform(v => v === '' ? undefined : v),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  scheduledDate: z.string().optional(),
  scheduledTime: z.string().optional(),
  estimatedHours: z.number().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  notes: z.string().optional(),
})

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const projectId = c.req.query('projectId')
  const assignedToId = c.req.query('assignedToId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions = [eq(job.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(job.status, status))
  if (projectId) conditions.push(eq(job.projectId, projectId))
  if (assignedToId) conditions.push(eq(job.assignedToId, assignedToId))

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(job).where(where).orderBy(asc(job.scheduledDate), desc(job.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(job).where(where),
  ])

  // Fetch related entities
  const projectIds = [...new Set(data.filter(j => j.projectId).map(j => j.projectId!))]
  const contactIds = [...new Set(data.filter(j => j.contactId).map(j => j.contactId!))]
  const userIds = [...new Set(data.filter(j => j.assignedToId).map(j => j.assignedToId!))]

  const [projects, contacts, users] = await Promise.all([
    projectIds.length ? db.select({ id: project.id, name: project.name }).from(project).where(eq(project.companyId, currentUser.companyId)) : Promise.resolve([]),
    contactIds.length ? db.select({ id: contact.id, name: contact.name }).from(contact).where(eq(contact.companyId, currentUser.companyId)) : Promise.resolve([]),
    userIds.length ? db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName }).from(user).where(eq(user.companyId, currentUser.companyId)) : Promise.resolve([]),
  ])

  const projectMap = Object.fromEntries(projects.map(p => [p.id, p]))
  const contactMap = Object.fromEntries(contacts.map(ct => [ct.id, ct]))
  const userMap = Object.fromEntries(users.map(u => [u.id, u]))

  const dataWithRelations = data.map(j => ({
    ...j,
    project: j.projectId ? projectMap[j.projectId] || null : null,
    contact: j.contactId ? contactMap[j.contactId] || null : null,
    assignedTo: j.assignedToId ? userMap[j.assignedToId] || null : null,
  }))

  return c.json({ data: dataWithRelations, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

app.get('/today', async (c) => {
  const currentUser = c.get('user') as any
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const jobs = await db.select().from(job).where(and(
    eq(job.companyId, currentUser.companyId),
    gte(job.scheduledDate, today),
    lt(job.scheduledDate, tomorrow),
  )).orderBy(asc(job.scheduledTime))

  // Fetch related entities
  const projectIds = [...new Set(jobs.filter(j => j.projectId).map(j => j.projectId!))]
  const contactIds = [...new Set(jobs.filter(j => j.contactId).map(j => j.contactId!))]
  const userIds = [...new Set(jobs.filter(j => j.assignedToId).map(j => j.assignedToId!))]

  const [projects, contacts, users] = await Promise.all([
    projectIds.length ? db.select({ id: project.id, name: project.name }).from(project).where(eq(project.companyId, currentUser.companyId)) : Promise.resolve([]),
    contactIds.length ? db.select({ id: contact.id, name: contact.name, phone: contact.phone }).from(contact).where(eq(contact.companyId, currentUser.companyId)) : Promise.resolve([]),
    userIds.length ? db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName }).from(user).where(eq(user.companyId, currentUser.companyId)) : Promise.resolve([]),
  ])

  const projectMap = Object.fromEntries(projects.map(p => [p.id, p]))
  const contactMap = Object.fromEntries(contacts.map(ct => [ct.id, ct]))
  const userMap = Object.fromEntries(users.map(u => [u.id, u]))

  const jobsWithRelations = jobs.map(j => ({
    ...j,
    project: j.projectId ? projectMap[j.projectId] || null : null,
    contact: j.contactId ? contactMap[j.contactId] || null : null,
    assignedTo: j.assignedToId ? userMap[j.assignedToId] || null : null,
  }))

  return c.json(jobsWithRelations)
})

app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [foundJob] = await db.select().from(job).where(and(eq(job.id, id), eq(job.companyId, currentUser.companyId))).limit(1)
  if (!foundJob) return c.json({ error: 'Job not found' }, 404)

  const [jobProject, jobContact, assignedUser, entries] = await Promise.all([
    foundJob.projectId ? db.select().from(project).where(eq(project.id, foundJob.projectId)).limit(1) : Promise.resolve([]),
    foundJob.contactId ? db.select().from(contact).where(eq(contact.id, foundJob.contactId)).limit(1) : Promise.resolve([]),
    foundJob.assignedToId ? db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone }).from(user).where(eq(user.id, foundJob.assignedToId)).limit(1) : Promise.resolve([]),
    db.select().from(timeEntry).where(eq(timeEntry.jobId, id)).orderBy(desc(timeEntry.date)).limit(10),
  ])

  return c.json({ ...foundJob, project: jobProject[0] || null, contact: jobContact[0] || null, assignedTo: assignedUser[0] || null, timeEntries: entries })
})

app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const data = jobSchema.parse(await c.req.json())

  const [{ value: cnt }] = await db.select({ value: count() }).from(job).where(eq(job.companyId, currentUser.companyId))
  const [newJob] = await db.insert(job).values({
    ...data,
    number: `JOB-${String(Number(cnt) + 1).padStart(5, '0')}`,
    scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : null,
    estimatedHours: data.estimatedHours?.toString(),
    companyId: currentUser.companyId,
  }).returning()

  // Fetch related data for response
  const [jobProject, jobContact, assignedUser] = await Promise.all([
    newJob.projectId ? db.select({ id: project.id, name: project.name }).from(project).where(eq(project.id, newJob.projectId)).limit(1) : Promise.resolve([]),
    newJob.contactId ? db.select({ id: contact.id, name: contact.name }).from(contact).where(eq(contact.id, newJob.contactId)).limit(1) : Promise.resolve([]),
    newJob.assignedToId ? db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName }).from(user).where(eq(user.id, newJob.assignedToId)).limit(1) : Promise.resolve([]),
  ])

  const jobWithRelations = { ...newJob, project: jobProject[0] || null, contact: jobContact[0] || null, assignedTo: assignedUser[0] || null }
  emitToCompany(currentUser.companyId, EVENTS.JOB_CREATED, jobWithRelations)
  return c.json(jobWithRelations, 201)
})

app.put('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = jobSchema.partial().parse(await c.req.json())

  const [existing] = await db.select().from(job).where(and(eq(job.id, id), eq(job.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Job not found' }, 404)

  const [updated] = await db.update(job).set({
    ...data,
    scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : undefined,
    estimatedHours: data.estimatedHours !== undefined ? data.estimatedHours.toString() : undefined,
    updatedAt: new Date(),
  }).where(eq(job.id, id)).returning()

  // Fetch related data for response
  const [jobProject, jobContact, assignedUser] = await Promise.all([
    updated.projectId ? db.select({ id: project.id, name: project.name }).from(project).where(eq(project.id, updated.projectId)).limit(1) : Promise.resolve([]),
    updated.contactId ? db.select({ id: contact.id, name: contact.name }).from(contact).where(eq(contact.id, updated.contactId)).limit(1) : Promise.resolve([]),
    updated.assignedToId ? db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName }).from(user).where(eq(user.id, updated.assignedToId)).limit(1) : Promise.resolve([]),
  ])

  const jobWithRelations = { ...updated, project: jobProject[0] || null, contact: jobContact[0] || null, assignedTo: assignedUser[0] || null }
  emitToCompany(currentUser.companyId, EVENTS.JOB_UPDATED, jobWithRelations)
  return c.json(jobWithRelations)
})

app.delete('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(job).where(and(eq(job.id, id), eq(job.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Job not found' }, 404)

  await db.delete(job).where(eq(job.id, id))
  emitToCompany(currentUser.companyId, EVENTS.JOB_DELETED, { id })
  return c.body(null, 204)
})

app.post('/:id/start', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(job).where(and(eq(job.id, id), eq(job.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Job not found' }, 404)

  const [updated] = await db.update(job).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(job.id, id)).returning()
  emitToCompany(currentUser.companyId, EVENTS.JOB_STATUS_CHANGED, { id: updated.id, status: 'in_progress' })
  return c.json(updated)
})

app.post('/:id/complete', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(job).where(and(eq(job.id, id), eq(job.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Job not found' }, 404)

  const [updated] = await db.update(job).set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() }).where(eq(job.id, id)).returning()
  emitToCompany(currentUser.companyId, EVENTS.JOB_STATUS_CHANGED, { id: updated.id, status: 'completed' })
  return c.json(updated)
})

app.post('/:id/dispatch', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(job).where(and(eq(job.id, id), eq(job.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Job not found' }, 404)

  const [updated] = await db.update(job).set({ status: 'dispatched', updatedAt: new Date() }).where(eq(job.id, id)).returning()
  emitToCompany(currentUser.companyId, EVENTS.JOB_STATUS_CHANGED, { id: updated.id, status: 'dispatched' })
  return c.json(updated)
})

export default app

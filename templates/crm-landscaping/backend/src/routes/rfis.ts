import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { rfi, project } from '../../db/schema.ts'
import { eq, and, count, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

const rfiSchema = z.object({
  subject: z.string().min(1),
  question: z.string().min(1),
  projectId: z.string(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  dueDate: z.string().optional(),
  assignedTo: z.string().optional(),
})

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const projectId = c.req.query('projectId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions = [eq(rfi.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(rfi.status, status))
  if (projectId) conditions.push(eq(rfi.projectId, projectId))

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(rfi).where(where).orderBy(desc(rfi.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(rfi).where(where),
  ])

  // Fetch related projects
  const projectIds = [...new Set(data.map(r => r.projectId))]
  const projects = projectIds.length
    ? await db.select({ id: project.id, name: project.name }).from(project).where(eq(project.companyId, currentUser.companyId))
    : []
  const projectMap = Object.fromEntries(projects.map(p => [p.id, p]))

  const dataWithRelations = data.map(r => ({ ...r, project: projectMap[r.projectId] || null }))

  return c.json({ data: dataWithRelations, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [foundRfi] = await db.select().from(rfi).where(and(eq(rfi.id, id), eq(rfi.companyId, currentUser.companyId))).limit(1)
  if (!foundRfi) return c.json({ error: 'RFI not found' }, 404)

  const [rfiProject] = await db.select().from(project).where(eq(project.id, foundRfi.projectId)).limit(1)

  return c.json({ ...foundRfi, project: rfiProject || null })
})

app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const data = rfiSchema.parse(await c.req.json())

  const [{ value: cnt }] = await db.select({ value: count() }).from(rfi).where(and(eq(rfi.companyId, currentUser.companyId), eq(rfi.projectId, data.projectId)))

  const [newRfi] = await db.insert(rfi).values({
    ...data,
    number: `RFI-${String(Number(cnt) + 1).padStart(3, '0')}`,
    dueDate: data.dueDate ? new Date(data.dueDate) : null,
    companyId: currentUser.companyId,
  }).returning()

  return c.json(newRfi, 201)
})

app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const data = rfiSchema.partial().parse(await c.req.json())

  const updateData: Record<string, any> = { ...data, updatedAt: new Date() }
  if (data.dueDate) updateData.dueDate = new Date(data.dueDate)

  const [updated] = await db.update(rfi).set(updateData).where(eq(rfi.id, id)).returning()
  return c.json(updated)
})

app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await db.delete(rfi).where(eq(rfi.id, id))
  return c.body(null, 204)
})

app.post('/:id/respond', async (c) => {
  const id = c.req.param('id')
  const { response, respondedBy } = await c.req.json()

  const [updated] = await db.update(rfi).set({ response, respondedBy, respondedAt: new Date(), status: 'answered', updatedAt: new Date() }).where(eq(rfi.id, id)).returning()
  return c.json(updated)
})

app.post('/:id/close', async (c) => {
  const id = c.req.param('id')
  const [updated] = await db.update(rfi).set({ status: 'closed', updatedAt: new Date() }).where(eq(rfi.id, id)).returning()
  return c.json(updated)
})

export default app

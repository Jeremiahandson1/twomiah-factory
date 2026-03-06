import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { punchListItem, project } from '../../db/schema.ts'
import { eq, and, count, desc, asc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

const schema = z.object({ description: z.string().min(1), projectId: z.string(), location: z.string().optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'), assignedTo: z.string().optional(), dueDate: z.string().optional(), notes: z.string().optional() })

app.get('/', async (c) => {
  const { status, projectId, page = '1', limit = '50' } = c.req.query() as any
  const user = c.get('user') as any
  const conditions = [eq(punchListItem.companyId, user.companyId)]
  if (status) conditions.push(eq(punchListItem.status, status))
  if (projectId) conditions.push(eq(punchListItem.projectId, projectId))

  const where = and(...conditions)
  const pageNum = +page
  const limitNum = +limit

  const [data, [{ value: total }]] = await Promise.all([
    db.select({
      punchListItem,
      project: { id: project.id, name: project.name },
    }).from(punchListItem)
      .leftJoin(project, eq(punchListItem.projectId, project.id))
      .where(where)
      .orderBy(desc(punchListItem.createdAt))
      .offset((pageNum - 1) * limitNum)
      .limit(limitNum),
    db.select({ value: count() }).from(punchListItem).where(where),
  ])

  return c.json({ data, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } })
})

app.get('/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const [item] = await db.select({
    punchListItem,
    project,
  }).from(punchListItem)
    .leftJoin(project, eq(punchListItem.projectId, project.id))
    .where(and(eq(punchListItem.id, id), eq(punchListItem.companyId, user.companyId)))
    .limit(1)
  if (!item) return c.json({ error: 'Punch list item not found' }, 404)
  return c.json(item)
})

app.post('/', async (c) => {
  const user = c.get('user') as any
  const data = schema.parse(await c.req.json())
  const [{ value: countVal }] = await db.select({ value: count() }).from(punchListItem).where(and(eq(punchListItem.companyId, user.companyId), eq(punchListItem.projectId, data.projectId)))
  const [item] = await db.insert(punchListItem).values({
    ...data,
    number: `PL-${String(countVal + 1).padStart(3, '0')}`,
    dueDate: data.dueDate ? new Date(data.dueDate) : null,
    companyId: user.companyId,
  }).returning()
  return c.json(item, 201)
})

app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const data = schema.partial().parse(await c.req.json())
  const [item] = await db.update(punchListItem).set({
    ...data,
    dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
    updatedAt: new Date(),
  }).where(eq(punchListItem.id, id)).returning()
  return c.json(item)
})

app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await db.delete(punchListItem).where(eq(punchListItem.id, id))
  return c.json(null, 204)
})

app.post('/:id/complete', async (c) => {
  const id = c.req.param('id')
  const [item] = await db.update(punchListItem).set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() }).where(eq(punchListItem.id, id)).returning()
  return c.json(item)
})

app.post('/:id/verify', async (c) => {
  const id = c.req.param('id')
  const { verifiedBy } = await c.req.json()
  const [item] = await db.update(punchListItem).set({ status: 'verified', verifiedAt: new Date(), verifiedBy, updatedAt: new Date() }).where(eq(punchListItem.id, id)).returning()
  return c.json(item)
})

export default app

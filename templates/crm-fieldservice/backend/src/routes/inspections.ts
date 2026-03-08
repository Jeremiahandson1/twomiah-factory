import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { inspection, project } from '../../db/schema.ts'
import { eq, and, count, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

const schema = z.object({ type: z.string(), projectId: z.string(), scheduledDate: z.string().optional(), inspector: z.string().optional(), notes: z.string().optional() })

app.get('/', async (c) => {
  const { status, projectId, page = '1', limit = '50' } = c.req.query() as any
  const user = c.get('user') as any
  const conditions: any[] = [eq(inspection.companyId, user.companyId)]
  if (status) conditions.push(eq(inspection.status, status))
  if (projectId) conditions.push(eq(inspection.projectId, projectId))

  const where = and(...conditions)
  const pageNum = +page
  const limitNum = +limit

  const [data, [{ value: total }]] = await Promise.all([
    db.select({
      inspection,
      project: { id: project.id, name: project.name },
    }).from(inspection)
      .leftJoin(project, eq(inspection.projectId, project.id))
      .where(where)
      .orderBy(desc(inspection.scheduledDate))
      .offset((pageNum - 1) * limitNum)
      .limit(limitNum),
    db.select({ value: count() }).from(inspection).where(where),
  ])

  return c.json({ data, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } })
})

app.post('/', async (c) => {
  const user = c.get('user') as any
  const data = schema.parse(await c.req.json())
  const [{ value: countVal }] = await db.select({ value: count() }).from(inspection).where(eq(inspection.companyId, user.companyId))
  const [item] = await db.insert(inspection).values({
    ...data,
    number: `INS-${String(countVal + 1).padStart(4, '0')}`,
    scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : null,
    companyId: user.companyId,
  }).returning()
  return c.json(item, 201)
})

app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const data = schema.partial().parse(await c.req.json())
  const [item] = await db.update(inspection).set({
    ...data,
    scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : undefined,
    updatedAt: new Date(),
  }).where(eq(inspection.id, id)).returning()
  return c.json(item)
})

app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await db.delete(inspection).where(eq(inspection.id, id))
  return c.json(null, 204)
})

app.post('/:id/pass', async (c) => {
  const id = c.req.param('id')
  const [item] = await db.update(inspection).set({ status: 'passed', result: 'pass', updatedAt: new Date() }).where(eq(inspection.id, id)).returning()
  return c.json(item)
})

app.post('/:id/fail', async (c) => {
  const id = c.req.param('id')
  const { deficiencies } = await c.req.json()
  const [item] = await db.update(inspection).set({ status: 'failed', result: 'fail', deficiencies, updatedAt: new Date() }).where(eq(inspection.id, id)).returning()
  return c.json(item)
})

export default app

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { dailyLog, project, user } from '../../db/schema.ts'
import { eq, and, gte, lte, count, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

const schema = z.object({ date: z.string().optional(), projectId: z.string(), weather: z.string().optional(), temperature: z.number().optional(), conditions: z.string().optional(), crewSize: z.number().optional(), hoursWorked: z.number().optional(), workPerformed: z.string().optional(), materials: z.string().optional(), equipment: z.string().optional(), visitors: z.string().optional(), delays: z.string().optional(), safetyNotes: z.string().optional(), notes: z.string().optional() })

app.get('/', async (c) => {
  const { projectId, startDate, endDate, page = '1', limit = '50' } = c.req.query() as any
  const currentUser = c.get('user') as any
  const conditions: any[] = [eq(dailyLog.companyId, currentUser.companyId)]
  if (projectId) conditions.push(eq(dailyLog.projectId, projectId))
  if (startDate) conditions.push(gte(dailyLog.date, new Date(startDate)))
  if (endDate) conditions.push(lte(dailyLog.date, new Date(endDate)))

  const where = and(...conditions)
  const pageNum = +page
  const limitNum = +limit

  const [data, [{ value: total }]] = await Promise.all([
    db.select({
      dailyLog,
      project: { id: project.id, name: project.name },
      user: { id: user.id, firstName: user.firstName, lastName: user.lastName },
    }).from(dailyLog)
      .leftJoin(project, eq(dailyLog.projectId, project.id))
      .leftJoin(user, eq(dailyLog.userId, user.id))
      .where(where)
      .orderBy(desc(dailyLog.date))
      .offset((pageNum - 1) * limitNum)
      .limit(limitNum),
    db.select({ value: count() }).from(dailyLog).where(where),
  ])

  return c.json({ data, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } })
})

app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const [log] = await db.select({
    dailyLog,
    project,
    user,
  }).from(dailyLog)
    .leftJoin(project, eq(dailyLog.projectId, project.id))
    .leftJoin(user, eq(dailyLog.userId, user.id))
    .where(and(eq(dailyLog.id, id), eq(dailyLog.companyId, currentUser.companyId)))
    .limit(1)
  if (!log) return c.json({ error: 'Daily log not found' }, 404)
  return c.json(log)
})

app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const data = schema.parse(await c.req.json())
  const [log] = await db.insert(dailyLog).values({
    ...data,
    date: data.date ? new Date(data.date) : new Date(),
    companyId: currentUser.companyId,
    userId: currentUser.userId,
  }).returning()
  return c.json(log, 201)
})

app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const data = schema.partial().parse(await c.req.json())
  const [log] = await db.update(dailyLog).set({
    ...data,
    date: data.date ? new Date(data.date) : undefined,
    updatedAt: new Date(),
  }).where(eq(dailyLog.id, id)).returning()
  return c.json(log)
})

app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await db.delete(dailyLog).where(eq(dailyLog.id, id))
  return c.json(null, 204)
})

export default app

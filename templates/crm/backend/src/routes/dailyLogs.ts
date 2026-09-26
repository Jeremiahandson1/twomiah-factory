import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { dailyLog, project, user } from '../../db/schema.ts'
import { eq, and, gte, lte, count, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

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

app.post('/', requirePermission('daily-logs:create'), async (c) => {
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

app.put('/:id', requirePermission('daily-logs:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = schema.partial().parse(await c.req.json())
  // Scoped to the caller's company like the reads above, not matched on id alone.
  const [log] = await db.update(dailyLog).set({
    ...data,
    date: data.date ? new Date(data.date) : undefined,
    updatedAt: new Date(),
  }).where(and(eq(dailyLog.id, id), eq(dailyLog.companyId, currentUser.companyId))).returning()
  if (!log) return c.json({ error: 'Daily log not found' }, 404)
  return c.json(log)
})

app.delete('/:id', requirePermission('daily-logs:delete'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  // `returning()` so a delete that matched nothing is a 404 rather than a silent "deleted".
  const [gone] = await db.delete(dailyLog).where(and(eq(dailyLog.id, id), eq(dailyLog.companyId, currentUser.companyId))).returning()
  if (!gone) return c.json({ error: 'Daily log not found' }, 404)
  return c.json(null, 204)
})

export default app

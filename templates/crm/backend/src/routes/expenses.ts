import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { expense, project, job } from '../../db/schema.ts'
import { eq, and, gte, lte, count, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

const expenseSchema = z.object({
  date: z.string().optional(),
  category: z.enum(['materials', 'equipment', 'labor', 'travel', 'other']),
  vendor: z.string().optional(),
  description: z.string().min(1),
  amount: z.number().positive(),
  billable: z.boolean().default(false),
  reimbursable: z.boolean().default(false),
  receiptUrl: z.string().optional(),
  projectId: z.string().optional(),
  jobId: z.string().optional(),
  notes: z.string().optional(),
})

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const category = c.req.query('category')
  const projectId = c.req.query('projectId')
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions = [eq(expense.companyId, currentUser.companyId)]
  if (category) conditions.push(eq(expense.category, category))
  if (projectId) conditions.push(eq(expense.projectId, projectId))
  if (startDate) conditions.push(gte(expense.date, new Date(startDate)))
  if (endDate) conditions.push(lte(expense.date, new Date(endDate)))

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(expense).where(where).orderBy(desc(expense.date)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(expense).where(where),
  ])

  // Fetch related entities
  const projectIds = [...new Set(data.filter(e => e.projectId).map(e => e.projectId!))]
  const jobIds = [...new Set(data.filter(e => e.jobId).map(e => e.jobId!))]

  const [projects, jobs] = await Promise.all([
    projectIds.length ? db.select({ id: project.id, name: project.name }).from(project).where(eq(project.companyId, currentUser.companyId)) : Promise.resolve([]),
    jobIds.length ? db.select({ id: job.id, title: job.title }).from(job).where(eq(job.companyId, currentUser.companyId)) : Promise.resolve([]),
  ])

  const projectMap = Object.fromEntries(projects.map(p => [p.id, p]))
  const jobMap = Object.fromEntries(jobs.map(j => [j.id, j]))

  const dataWithRelations = data.map(e => ({
    ...e,
    project: e.projectId ? projectMap[e.projectId] || null : null,
    job: e.jobId ? jobMap[e.jobId] || null : null,
  }))

  return c.json({ data: dataWithRelations, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

app.get('/summary', async (c) => {
  const currentUser = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')

  const conditions = [eq(expense.companyId, currentUser.companyId)]
  if (startDate) conditions.push(gte(expense.date, new Date(startDate)))
  if (endDate) conditions.push(lte(expense.date, new Date(endDate)))

  const where = and(...conditions)

  const expenses = await db.select({
    category: expense.category,
    totalAmount: sql<string>`sum(${expense.amount})`,
    cnt: count(),
  }).from(expense).where(where).groupBy(expense.category)

  const total = expenses.reduce((s, e) => s + Number(e.totalAmount || 0), 0)
  const byCategory = Object.fromEntries(expenses.map(e => [e.category, { amount: Number(e.totalAmount), count: e.cnt }]))

  return c.json({ total, byCategory })
})

app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const data = expenseSchema.parse(await c.req.json())

  const [newExpense] = await db.insert(expense).values({
      ...data,
      projectId: data.projectId || null,
      jobId: data.jobId || null,
      amount: data.amount.toString(),
    date: data.date ? new Date(data.date) : new Date(),
    companyId: currentUser.companyId,
  }).returning()

  return c.json(newExpense, 201)
})

app.put('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = expenseSchema.partial().parse(await c.req.json())

  const [existing] = await db.select().from(expense).where(and(eq(expense.id, id), eq(expense.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Expense not found' }, 404)

  const updateData: Record<string, any> = { ...data, updatedAt: new Date() }
  if (data.amount !== undefined) updateData.amount = data.amount.toString()
  if (data.date) updateData.date = new Date(data.date)

  const [updated] = await db.update(expense).set(updateData).where(eq(expense.id, id)).returning()
  return c.json(updated)
})

app.delete('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(expense).where(and(eq(expense.id, id), eq(expense.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Expense not found' }, 404)

  await db.delete(expense).where(eq(expense.id, id))
  return c.body(null, 204)
})

app.post('/:id/reimburse', async (c) => {
  const id = c.req.param('id')
  const [updated] = await db.update(expense).set({ reimbursed: true, updatedAt: new Date() }).where(eq(expense.id, id)).returning()
  return c.json(updated)
})

export default app

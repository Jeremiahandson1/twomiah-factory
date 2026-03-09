import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { expenses, users } from '../../db/schema.ts'
import { eq, and, gte, lte, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /api/expenses?startDate=&endDate=&userId=&status=&page=&limit=
app.get('/', async (c) => {
  const { startDate, endDate, userId, status, page, limit } = c.req.query()

  const conditions: any[] = []
  if (startDate) conditions.push(gte(expenses.date, startDate))
  if (endDate) conditions.push(lte(expenses.date, endDate))
  if (userId) conditions.push(eq(expenses.userId, userId))
  if (status) conditions.push(eq(expenses.status, status))

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const pageNum = parseInt(page || '1', 10)
  const pageSize = parseInt(limit || '50', 10)
  const offset = (pageNum - 1) * pageSize

  const rows = await db
    .select({
      id: expenses.id,
      userId: expenses.userId,
      category: expenses.category,
      description: expenses.description,
      amount: expenses.amount,
      date: expenses.date,
      receiptUrl: expenses.receiptUrl,
      status: expenses.status,
      notes: expenses.notes,
      createdAt: expenses.createdAt,
      updatedAt: expenses.updatedAt,
      userFirstName: users.firstName,
      userLastName: users.lastName,
    })
    .from(expenses)
    .leftJoin(users, eq(expenses.userId, users.id))
    .where(whereClause)
    .orderBy(desc(expenses.date))
    .limit(pageSize)
    .offset(offset)

  return c.json(rows)
})

// POST /api/expenses
app.post('/', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()

  if (!body.description || !body.amount || !body.date) {
    return c.json({ error: 'description, amount, and date are required' }, 400)
  }

  const [row] = await db
    .insert(expenses)
    .values({
      userId: user.userId,
      category: body.category,
      description: body.description,
      amount: body.amount,
      date: body.date,
      receiptUrl: body.receiptUrl,
      status: body.status || 'pending',
      notes: body.notes,
    })
    .returning()

  return c.json(row, 201)
})

// PUT /api/expenses/:id
app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const [row] = await db
    .update(expenses)
    .set({
      category: body.category,
      description: body.description,
      amount: body.amount,
      date: body.date,
      receiptUrl: body.receiptUrl,
      status: body.status,
      notes: body.notes,
      updatedAt: new Date(),
    })
    .where(eq(expenses.id, id))
    .returning()

  if (!row) return c.json({ error: 'Expense not found' }, 404)
  return c.json(row)
})

// DELETE /api/expenses/:id
app.delete('/:id', async (c) => {
  const id = c.req.param('id')

  const [row] = await db
    .delete(expenses)
    .where(eq(expenses.id, id))
    .returning()

  if (!row) return c.json({ error: 'Expense not found' }, 404)
  return c.json({ success: true })
})

export default app

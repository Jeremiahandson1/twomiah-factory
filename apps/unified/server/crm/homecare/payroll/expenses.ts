// /api/expenses for home care — the office's expense book (Expense Management), its own records (the `expenses` table),
// not the CRM's shared /api/expenses (the `expense` table), which home care does not mount (server/modules/crm.ts).
// Moved from templates/crm-homecare/backend/src/routes/expenses.ts.
//
// The template's router was requireAdmin for every path (CVHC expenseRoutes.js); no caregiver screen calls it. Here every
// action needs care-payroll:update — the payroll write a caregiver does not hold — and deleting needs care-payroll:delete.
//
// Changes from the template: the company's expenses only (a new one is the company's); GET / is a list reply
// ({ data, pagination }, was a bare array); DELETE answers { success: true } through done().
import { Hono } from 'hono'
import { and, count, desc, eq, gte, lte } from 'drizzle-orm'
import { expenses, user } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'

export function createHomecareExpenseRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  app.use('*', requirePermission('care-payroll:update'))

  // GET /?startDate=&endDate=&userId=&status=&page=&limit=
  app.get('/', async (c) => {
    const { companyId } = c.get('user')
    const { startDate, endDate, userId, status, page, limit } = c.req.query()
    const where = and(
      eq(expenses.companyId, companyId),
      startDate ? gte(expenses.date, startDate) : undefined,
      endDate ? lte(expenses.date, endDate) : undefined,
      userId ? eq(expenses.userId, userId) : undefined,
      status ? eq(expenses.status, status) : undefined,
    )
    const pageNum = Math.max(parseInt(page || '1', 10) || 1, 1)
    const pageSize = Math.max(parseInt(limit || '50', 10) || 50, 1)

    const [rows, [{ value: total }]] = await Promise.all([
      db.select({
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
        userFirstName: user.firstName,
        userLastName: user.lastName,
      })
        .from(expenses)
        .leftJoin(user, eq(expenses.userId, user.id))
        .where(where)
        .orderBy(desc(expenses.date))
        .limit(pageSize)
        .offset((pageNum - 1) * pageSize),
      db.select({ value: count() }).from(expenses).where(where),
    ])
    return list(c, rows, { page: pageNum, limit: pageSize, total: Number(total) })
  })

  // POST / — the signed-in person's expense.
  app.post('/', async (c) => {
    const me = c.get('user')
    const body = await c.req.json().catch(() => ({})) as any
    // The expense form posts `expenseDate`; accept it as an alias for `date` (C-02).
    const date = body.date ?? body.expenseDate
    if (!body.description || !body.amount || !date) return fail(c, 400, 'description, amount, and date are required')

    const [row] = await db.insert(expenses).values({
      companyId: me.companyId,
      userId: me.userId,
      category: body.category || null,
      description: body.description,
      amount: body.amount,
      date,
      receiptUrl: body.receiptUrl || null,
      status: body.status || 'pending',
      notes: body.notes || null,
    }).returning()
    return one(c, row, 201)
  })

  // PUT /:id
  app.put('/:id', async (c) => {
    const { companyId } = c.get('user')
    const body = await c.req.json().catch(() => ({})) as any
    const [row] = await db.update(expenses)
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
      .where(and(eq(expenses.id, c.req.param('id')), eq(expenses.companyId, companyId)))
      .returning()
    if (!row) return fail(c, 404, 'Expense not found')
    return one(c, row)
  })

  // DELETE /:id
  app.delete('/:id', requirePermission('care-payroll:delete'), async (c) => {
    const { companyId } = c.get('user')
    const [row] = await db.delete(expenses)
      .where(and(eq(expenses.id, c.req.param('id')), eq(expenses.companyId, companyId)))
      .returning()
    if (!row) return fail(c, 404, 'Expense not found')
    return done(c)
  })

  return app
}

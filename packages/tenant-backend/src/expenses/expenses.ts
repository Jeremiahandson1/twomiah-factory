// Expenses — ONE implementation for every CRM that offers expense_tracking (vendored into each template as ../shared).
// Before: two copies; no permission checks at all (any login could delete or reimburse), /:id/reimburse updated by id
// alone with no company scope, the crm-family refused a string amount ("12.50" from a form) while fieldservice coerced
// it, unknown project/job ids surfaced as FK 500s, paging unclamped.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, gte, lte, count, desc, sql, inArray } from 'drizzle-orm'

export interface ExpenseTables { expense: any; project?: any; job?: any }
export interface ExpenseDeps {
  db: any
  tables: ExpenseTables
  authenticate: any
  requirePermission: (permission: string) => any
  audit?: { log: (entry: any) => any }
  options?: {
    /** Allowed category ids. Default materials / equipment / labor / travel / other. */
    categories?: string[]
    maxLimit?: number
  }
}

export const DEFAULT_EXPENSE_CATEGORIES = ['materials', 'equipment', 'labor', 'travel', 'other']
const MANAGER_ROLES = new Set(['owner', 'admin', 'manager'])
const clampInt = (v: unknown, min: number, max: number, dflt: number) => { const n = parseInt(String(v ?? ''), 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt }
const stripTags = (s: string) => s.replace(/<[^>]*>/g, '').trim()
const dateField = z.string().optional().nullable().refine((v) => !v || !isNaN(new Date(v).getTime()), { message: 'Enter a valid date' })
/** '' from an unselected <select> → not set (an empty string is a FK violation → 409/500). */
const fk = z.string().optional().nullable().transform((v) => (v ? v : null))

export function createExpenseRoutes(deps: ExpenseDeps) {
  const { db, tables: t, authenticate, requirePermission, audit } = deps
  const categories = deps.options?.categories || DEFAULT_EXPENSE_CATEGORIES
  const maxLimit = deps.options?.maxLimit || 200
  const app = new Hono()
  app.use('*', authenticate)

  const schema = z.object({
    date: dateField,
    category: z.string().trim().refine((v) => categories.includes(v), { message: `Category must be one of ${categories.join(', ')}` }),
    vendor: z.string().trim().max(120).transform(stripTags).optional().nullable(),
    description: z.string().trim().min(1, 'Description is required').max(1000).transform(stripTags),
    amount: z.coerce.number().positive('Amount must be greater than 0').max(100_000_000),
    taxAmount: z.coerce.number().min(0).max(100_000_000).optional(),
    billable: z.boolean().default(false),
    reimbursable: z.boolean().default(false),
    receiptUrl: z.string().trim().url().max(2000).optional().nullable().or(z.literal('').transform(() => null)),
    projectId: fk,
    jobId: fk,
    notes: z.string().max(5000).optional().nullable(),
  })
  const invalid = (c: any, err: z.ZodError) => c.json({ error: err.errors[0]?.message || 'Invalid expense', details: err.flatten().fieldErrors }, 400)

  /** Project / job pickers must point at this company's rows (a foreign id is a 400, not a FK 500). */
  const checkRefs = async (companyId: string, data: { projectId?: string | null; jobId?: string | null }) => {
    if (data.projectId && t.project) { const [p] = await db.select({ id: t.project.id }).from(t.project).where(and(eq(t.project.id, data.projectId), eq(t.project.companyId, companyId))).limit(1); if (!p) return 'Unknown project' }
    if (data.jobId && t.job) { const [j] = await db.select({ id: t.job.id }).from(t.job).where(and(eq(t.job.id, data.jobId), eq(t.job.companyId, companyId))).limit(1); if (!j) return 'Unknown job' }
    return null
  }
  const ownExpense = async (id: string, companyId: string) => { const [row] = await db.select().from(t.expense).where(and(eq(t.expense.id, id), eq(t.expense.companyId, companyId))).limit(1); return row }
  const withRelations = async (companyId: string, rows: any[]) => {
    const projectIds = [...new Set(rows.filter((e) => e.projectId).map((e) => e.projectId))]
    const jobIds = [...new Set(rows.filter((e) => e.jobId).map((e) => e.jobId))]
    const [projects, jobs] = await Promise.all([
      projectIds.length && t.project ? db.select({ id: t.project.id, name: t.project.name }).from(t.project).where(and(eq(t.project.companyId, companyId), inArray(t.project.id, projectIds))) : Promise.resolve([]),
      jobIds.length && t.job ? db.select({ id: t.job.id, title: t.job.title, number: t.job.number }).from(t.job).where(and(eq(t.job.companyId, companyId), inArray(t.job.id, jobIds))) : Promise.resolve([]),
    ])
    const pm = Object.fromEntries(projects.map((p: any) => [p.id, p])), jm = Object.fromEntries(jobs.map((j: any) => [j.id, j]))
    return rows.map((e) => ({ ...e, project: e.projectId ? pm[e.projectId] || null : null, job: e.jobId ? jm[e.jobId] || null : null }))
  }

  app.get('/', requirePermission('expenses:read'), async (c) => {
    const currentUser = (c as any).get('user')
    const q = c.req.query()
    const page = clampInt(q.page, 1, 1_000_000, 1)
    const limit = clampInt(q.limit, 1, maxLimit, 50)
    const conditions: any[] = [eq(t.expense.companyId, currentUser.companyId)]
    if (q.category) conditions.push(eq(t.expense.category, String(q.category).slice(0, 40)))
    if (q.projectId) conditions.push(eq(t.expense.projectId, q.projectId))
    if (q.jobId) conditions.push(eq(t.expense.jobId, q.jobId))
    if (q.startDate && !isNaN(new Date(q.startDate).getTime())) conditions.push(gte(t.expense.date, new Date(q.startDate)))
    if (q.endDate && !isNaN(new Date(q.endDate).getTime())) { const end = new Date(q.endDate); end.setHours(23, 59, 59, 999); conditions.push(lte(t.expense.date, end)) }
    const where = and(...conditions)
    const [rows, [{ value: total }]] = await Promise.all([
      db.select().from(t.expense).where(where).orderBy(desc(t.expense.date)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(t.expense).where(where),
    ])
    return c.json({ data: await withRelations(currentUser.companyId, rows), pagination: { page, limit, total: Number(total), pages: Math.max(1, Math.ceil(Number(total) / limit)) } })
  })

  app.get('/summary', requirePermission('expenses:read'), async (c) => {
    const currentUser = (c as any).get('user')
    const q = c.req.query()
    const conditions: any[] = [eq(t.expense.companyId, currentUser.companyId)]
    if (q.startDate && !isNaN(new Date(q.startDate).getTime())) conditions.push(gte(t.expense.date, new Date(q.startDate)))
    if (q.endDate && !isNaN(new Date(q.endDate).getTime())) { const end = new Date(q.endDate); end.setHours(23, 59, 59, 999); conditions.push(lte(t.expense.date, end)) }
    const groups = await db.select({ category: t.expense.category, totalAmount: sql<string>`sum(${t.expense.amount})`, cnt: count() }).from(t.expense).where(and(...conditions)).groupBy(t.expense.category)
    const total = groups.reduce((s: number, g: any) => s + Number(g.totalAmount || 0), 0)
    return c.json({ total: Math.round(total * 100) / 100, byCategory: Object.fromEntries(groups.map((g: any) => [g.category, { amount: Number(g.totalAmount || 0), count: Number(g.cnt) }])) })
  })

  app.get('/:id', requirePermission('expenses:read'), async (c) => {
    const currentUser = (c as any).get('user')
    const row = await ownExpense(c.req.param('id'), currentUser.companyId)
    if (!row) return c.json({ error: 'Expense not found' }, 404)
    return c.json((await withRelations(currentUser.companyId, [row]))[0])
  })

  app.post('/', requirePermission('expenses:create'), async (c) => {
    const currentUser = (c as any).get('user')
    const parsed = schema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    const refErr = await checkRefs(currentUser.companyId, data)
    if (refErr) return c.json({ error: refErr }, 400)
    const [row] = await db.insert(t.expense).values({
      ...data,
      amount: String(data.amount),
      taxAmount: data.taxAmount === undefined ? undefined : String(data.taxAmount),
      date: data.date ? new Date(data.date) : new Date(),
      companyId: currentUser.companyId,
    }).returning()
    audit?.log({ action: 'create', entity: 'expense', entityId: row.id, metadata: { amount: row.amount, category: row.category }, req: { user: currentUser } })
    return c.json(row, 201)
  })

  app.put('/:id', requirePermission('expenses:update'), async (c) => {
    const currentUser = (c as any).get('user')
    const id = c.req.param('id')
    const parsed = schema.partial().safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    const existing = await ownExpense(id, currentUser.companyId)
    if (!existing) return c.json({ error: 'Expense not found' }, 404)
    const refErr = await checkRefs(currentUser.companyId, data)
    if (refErr) return c.json({ error: refErr }, 400)
    const updates: any = { updatedAt: new Date() }
    for (const [k, v] of Object.entries(data)) if (v !== undefined) updates[k] = v
    if (data.amount !== undefined) updates.amount = String(data.amount)
    if (data.taxAmount !== undefined) updates.taxAmount = String(data.taxAmount)
    if (data.date !== undefined) updates.date = data.date ? new Date(data.date) : existing.date
    const [row] = await db.update(t.expense).set(updates).where(and(eq(t.expense.id, id), eq(t.expense.companyId, currentUser.companyId))).returning()
    return c.json(row)
  })

  app.delete('/:id', requirePermission('expenses:delete'), async (c) => {
    const currentUser = (c as any).get('user')
    const id = c.req.param('id')
    const existing = await ownExpense(id, currentUser.companyId)
    if (!existing) return c.json({ error: 'Expense not found' }, 404)
    await db.delete(t.expense).where(and(eq(t.expense.id, id), eq(t.expense.companyId, currentUser.companyId)))
    audit?.log({ action: 'delete', entity: 'expense', entityId: id, metadata: { amount: existing.amount, description: existing.description }, req: { user: currentUser } })
    return c.body(null, 204)
  })

  // Reimburse / approve: managers only, scoped to the company.
  const managerAction = (field: 'reimbursed' | 'approved') => async (c: any) => {
    const currentUser = (c as any).get('user')
    if (!MANAGER_ROLES.has(currentUser.role)) return c.json({ error: `Only owners, admins and managers can mark expenses ${field}` }, 403)
    const id = c.req.param('id')
    const existing = await ownExpense(id, currentUser.companyId)
    if (!existing) return c.json({ error: 'Expense not found' }, 404)
    const updates: any = { [field]: true, updatedAt: new Date() }
    if (field === 'reimbursed') updates.reimbursedAt = new Date()
    const [row] = await db.update(t.expense).set(updates).where(and(eq(t.expense.id, id), eq(t.expense.companyId, currentUser.companyId))).returning()
    audit?.log({ action: 'status_change', entity: 'expense', entityId: id, metadata: { [field]: true }, req: { user: currentUser } })
    return c.json(row)
  }
  app.post('/:id/reimburse', requirePermission('expenses:update'), managerAction('reimbursed'))
  app.post('/:id/approve', requirePermission('expenses:update'), managerAction('approved'))

  return app
}

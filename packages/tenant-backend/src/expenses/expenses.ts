// Expenses — ONE implementation for every CRM that offers expense_tracking (vendored into each template as ../shared).
// Before: two copies; no permission checks at all (any login could delete or reimburse), /:id/reimburse updated by id
// alone with no company scope, the crm-family refused a string amount ("12.50" from a form) while fieldservice coerced
// it, unknown project/job ids surfaced as FK 500s, paging unclamped.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, gte, lte, count, desc, sql, inArray } from 'drizzle-orm'
import { checkFilter } from '../listFilter'
import { hasHappened } from '../dateInput'

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
    /** Nicer names for those ids, where title-casing the id is not good enough. */
    categoryLabels?: Record<string, string>
    maxLimit?: number
  }
}

export const DEFAULT_EXPENSE_CATEGORIES = ['materials', 'equipment', 'labor', 'travel', 'other']
const MANAGER_ROLES = new Set(['owner', 'admin', 'manager'])
const clampInt = (v: unknown, min: number, max: number, dflt: number) => { const n = parseInt(String(v ?? ''), 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt }
const stripTags = (s: string) => s.replace(/<[^>]*>/g, '').trim()
// An expense records money already spent — a receipt is a past event — so a date in the future is a typo, the
// same rule and the same one day of slack the timesheet uses. A 2099 expense is not merely odd: it sits outside
// every dated window, so it vanishes from the period totals rather than reading wrong. (Contractor T30 L1)
const dateField = z.string().optional().nullable()
  .refine((v) => !v || !isNaN(new Date(v).getTime()), { message: 'Enter a valid date' })
  .refine(hasHappened, { message: 'An expense can only be dated to a day that has happened' })
/** '' from an unselected <select> → not set (an empty string is a FK violation → 409/500). */
const fk = z.string().optional().nullable().transform((v) => (v ? v : null))

/**
 * What to do when a reimbursed figure turns out to be wrong. (Salon RR7 X6)
 *
 * The refusal used to say "add a new expense for the difference" and stop there, which only works
 * in one direction: if too little was paid you add the shortfall, but if too MUCH was paid the
 * difference is negative and `amount` refuses it — "Amount must be greater than 0" — so the advice
 * sent the reader round in a circle.
 *
 * Rather than weaken that rule (a negative expense is a credit note, and this module has no concept
 * of one), the message now says the true thing in both directions and admits the gap instead of
 * pretending. A refusal that recommends something impossible is worse than one that says so.
 */
const CORRECTION_ADVICE =
  'if too little was paid, add a new expense for the shortfall. If too much was paid, this sheet cannot record a repayment yet — settle it outside the expense sheet and note it here.'

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
    // RR4 L2: 'abc' fell through to zod's own "Expected number, received nan" — the type check fails
    // before .positive() ever runs, so the plain-English message never got a chance. Every number in
    // this module now says what it wants in words a person typed the box would recognise.
    amount: z.coerce.number({ invalid_type_error: 'Amount must be a number, for example 24.50' }).positive('Amount must be greater than 0').max(100_000_000),
    taxAmount: z.coerce.number({ invalid_type_error: 'Tax must be a number, for example 4.90' }).min(0, 'Tax cannot be negative').max(100_000_000).optional(),
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

  // ── whose expense is this? (Salon RR6 E1 / E7) ────────────────────────────────────────────────
  //
  // The table had no submitter, so the server could not tell. Three findings came out of that one
  // gap: a manager approved and reimbursed their own $45 expense (the whole chain the time module
  // closes, wide open here), a stylist saw every expense in the company, and the Edit and Delete
  // offered on their own row answered 403 — so someone who typed $95 for $9.50 could not fix it.
  //
  // Rows written before the column exists have no submitter. They stay visible and editable by a
  // manager rather than becoming nobody's problem; the self-approval rule only bites where a
  // submitter is actually recorded.
  const OWN_APPROVAL_OK = new Set(['owner', 'admin'])
  const isMine = (u: any, row: any) => !!row?.submittedById && String(row.submittedById) === String(u?.userId)
  const selfApprovalRefusal = (u: any, row: any) =>
    isMine(u, row) && !OWN_APPROVAL_OK.has(u.role)
      ? 'You cannot approve or reimburse your own expense. Approval is a second person checking the claim before the money goes out — ask an owner or admin.'
      : null

  app.get('/', requirePermission('expenses:read'), async (c) => {
    const currentUser = (c as any).get('user')
    const q = c.req.query()
    const page = clampInt(q.page, 1, 1_000_000, 1)
    const limit = clampInt(q.limit, 1, maxLimit, 50)
    // The same vocabulary that refuses an unknown category on the way IN refuses it as a filter, instead of
    // answering with an empty expense sheet. (T29 N2)
    const badCategory = checkFilter(c, 'category', q.category, categories)
    if (badCategory) return badCategory
    const conditions: any[] = [eq(t.expense.companyId, currentUser.companyId)]
    // A stylist sees their OWN claims, the way the timesheet already works. They saw the whole
    // company's — the owner's and the manager's included. Rows with no submitter (written before
    // the column existed) stay visible to managers only. (Salon RR6 E7)
    if (!MANAGER_ROLES.has(currentUser.role)) conditions.push(eq(t.expense.submittedById, currentUser.userId))
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

  /**
   * The categories this tenant accepts. (Salon RR7 X1)
   *
   * Registered BEFORE /:id, or the id route swallows it — the same ordering rule that bit the
   * feature gate this morning.
   *
   * X1 was a HIGH and it was a vocabulary split: this module refuses a category outside its list,
   * the salon passes ['stock','retail','tools','rent',…] here, and the SCREEN fell back to the
   * shared contractor default ['materials','equipment','labor','travel','other']. Only travel and
   * other existed on both sides, so pressing Save on the form as it opened answered 400 and a salon
   * could not record stock, colour or tools at all — the things it actually buys.
   *
   * Adding the list to the salon's UI config would have fixed the salon and left the next vertical
   * to make the same mistake. The server is the thing that validates, so the server is what the form
   * should ask. One list, and a vertical that customises it gets the screen for free.
   */
  app.get('/categories', requirePermission('expenses:read'), async (c) => {
    const labels = deps.options?.categoryLabels || {}
    return c.json({
      categories: categories.map((value) => ({
        value,
        label: labels[value] || value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()),
      })),
    })
  })

  app.get('/summary', requirePermission('expenses:read'), async (c) => {
    const currentUser = (c as any).get('user')
    const q = c.req.query()
    const conditions: any[] = [eq(t.expense.companyId, currentUser.companyId)]
    // The same scope as the list. (Salon RR7 X5)
    //
    // E7 narrowed the LIST to your own claims and left this alone, so a stylist who could see one
    // expense on screen could still read the salon's whole spend — $234.34 across 8 expenses, broken
    // down by category — from the summary. Scoping one door and not the other is not scoping.
    if (!MANAGER_ROLES.has(currentUser.role)) conditions.push(eq(t.expense.submittedById, currentUser.userId))
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
    // …and reading ONE by id is the third door. A stylist could fetch a colleague's claim in full
    // by id even though the list hid it. 404, not 403: whether an expense they may not see exists
    // is itself not their business. (Salon RR7 X5)
    if (!MANAGER_ROLES.has(currentUser.role) && !isMine(currentUser, row)) {
      return c.json({ error: 'Expense not found' }, 404)
    }
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
      // Who is claiming it. Everything about whose expense this is hangs off this one field.
      // (Salon RR6 E1/E7)
      submittedById: currentUser.userId,
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
    // Your own claim is yours to correct until somebody approves it — the rule the timesheet
    // already follows. Before this a stylist was offered Edit on their own row and got a 403,
    // so someone who typed $95 for $9.50 could not fix it. (Salon RR6 E7)
    if (!MANAGER_ROLES.has(currentUser.role)) {
      // Not found, not "you may not" — the same answer a made-up id gets. (Salon RR8 Y3)
      //
      // RR7 X5 made GET and DELETE answer 404 for a colleague's expense so the refusal could not be
      // used to confirm that a row exists. This door kept saying "You can only change expenses you
      // entered", which confirms exactly that: 403 means real, 404 means imaginary. One door left
      // open is not a closed door.
      if (!isMine(currentUser, existing)) return c.json({ error: 'Expense not found' }, 404)
      if (existing.approved) return c.json({ error: 'This expense has been approved. Ask a manager to change it.' }, 403)
    }
    const refErr = await checkRefs(currentUser.companyId, data)
    if (refErr) return c.json({ error: refErr }, 400)

    // ── what an approval vouches for, and what a payment settles (RR4 M2) ───────────────────────
    //
    // A $24.50 expense was reimbursed and then PUT to 500, and came back "$500.00, still reimbursed"
    // — a record claiming the shop paid out five hundred pounds it never paid. The two states are
    // not the same kind of thing and they do not get the same answer:
    //
    //   REIMBURSED  the money has left the building at a figure. The record of what was paid cannot
    //               be rewritten afterwards; a wrong payment is corrected with another entry, the
    //               way every other ledger in this product works.
    //   APPROVED    somebody vouched for a figure and nothing has been paid. Correcting it is
    //               normal — it just cannot keep the tick, so it goes back for re-approval.
    //
    // Only the figure matters. Fixing a typo in the description or attaching the receipt is left
    // alone, on both — refusing those would make the rule an obstacle rather than a control.
    // "The amount was SENT" is not "the amount CHANGED". (Salon RR7 X2)
    //
    // E2 fixed this for hours on a time entry and I did not carry it across. The Edit dialog PUTs
    // the whole expense back, so pressing Save on an approved $80 claim without touching anything
    // arrived carrying amount: 80 and ended the approval — and "80" and "80.00" both did it. The
    // comparison is numeric against the stored value, and the date by day, exactly as time does.
    const sameNumber = (a: any, b: any) => {
      const x = a === null || a === undefined || a === '' ? null : Number(a)
      const y = b === null || b === undefined || b === '' ? null : Number(b)
      if (x === null && y === null) return true
      if (x === null || y === null) return false
      return Math.abs(x - y) < 0.0001
    }
    const sameDay = (a: any, b: any) => {
      if (!a || !b) return !a && !b
      return new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10)
    }
    /**
     * Turning "Reimburse me" ON after approval ends the approval. (Salon RR8 Y1)
     *
     * A claim entered without it is a cost the salon has already paid — a card payment for stock.
     * Approving it says "yes, that was a proper expense". Flipping the flag on afterwards turns the
     * same approved row into MONEY OWED TO A PERSON, and the old approval now covers a payout
     * nobody approved. That changes who gets paid as much as changing the figure does, which is the
     * rule I already wrote for the amount, the tax and the date; I simply did not carry it to the
     * one field that decides whether money leaves the building at all.
     *
     * Off is not the same as on. Turning it OFF pays out less than was approved and cannot surprise
     * anybody, so it keeps the approval — the tester's suggestion, and right: making that end the
     * approval would punish someone for withdrawing a claim.
     */
    const claimBecamePayable =
      data.reimbursable !== undefined && !!data.reimbursable && !existing.reimbursable
    const moneyChanged =
      (data.amount !== undefined && !sameNumber(data.amount, existing.amount))
      || (data.taxAmount !== undefined && !sameNumber(data.taxAmount, existing.taxAmount))
      || (data.date !== undefined && !sameDay(data.date, existing.date))
      || claimBecamePayable
    /**
     * A paid row cannot be marked "not a claim". (Salon RR8 Y4)
     *
     * PUT { reimbursable: false } on a reimbursed expense answered 200 and left it `reimbursed:
     * true, reimbursable: false` — paid, and recorded as something nobody ever claimed. The amount
     * and the deletion are both locked once money has gone out; this flag is part of the same
     * record and was the one way left to contradict it.
     *
     * Its own message, because "the amount cannot be rewritten" is not what happened here.
     */
    if (existing.reimbursed && data.reimbursable !== undefined && !!data.reimbursable !== !!existing.reimbursable) {
      return c.json({
        error: `${existing.description ? `"${existing.description}" ` : 'This expense '}has already been reimbursed for ${existing.amount}. It cannot be marked as something nobody claimed — ${CORRECTION_ADVICE}`,
        code: 'already_reimbursed',
      }, 409)
    }
    if (existing.reimbursed && moneyChanged) {
      return c.json({
        // No "or reverse this one" — RR6 E5: there is no reverse action on the screen and
        // POST /:id/reverse is a 404. A refusal must not send someone after something that does
        // not exist; adding a correcting entry is the whole of the advice.
        error: `${existing.description ? `"${existing.description}" ` : 'This expense '}has already been reimbursed for ${existing.amount}. What was paid cannot be rewritten — ${CORRECTION_ADVICE}`,
        code: 'already_reimbursed',
      }, 409)
    }

    const updates: any = { updatedAt: new Date() }
    for (const [k, v] of Object.entries(data)) if (v !== undefined) updates[k] = v
    if (data.amount !== undefined) updates.amount = String(data.amount)
    if (data.taxAmount !== undefined) updates.taxAmount = String(data.taxAmount)
    if (data.date !== undefined) updates.date = data.date ? new Date(data.date) : existing.date

    const approvalCleared = existing.approved && moneyChanged
    if (approvalCleared) updates.approved = false

    const [row] = await db.update(t.expense).set(updates).where(and(eq(t.expense.id, id), eq(t.expense.companyId, currentUser.companyId))).returning()
    if (approvalCleared) {
      // Say which thing ended it. "The amount changed" on a row whose amount nobody touched is the
      // kind of message that teaches people to ignore messages. (Salon RR8 Y1)
      const why = claimBecamePayable
        ? 'it was marked reimbursable after approval, so the approval would have covered a payment to a person'
        : 'the amount, the tax or the date changed after approval'
      audit?.log({ action: 'status_change', entity: 'expense', entityId: id, metadata: { approved: false, reason: why }, req: { user: currentUser } })
      return c.json({
        ...row,
        warnings: [claimBecamePayable
          ? 'This expense was approved as a cost the business had already paid. Asking to be reimbursed for it is a payment to a person, so the approval has been removed and it needs approving again.'
          : 'This expense was approved. The amount, the tax or the date changed, so the approval has been removed and it needs approving again.'],
      })
    }
    return c.json(row)
  })

  app.delete('/:id', requirePermission('expenses:delete'), async (c) => {
    const currentUser = (c as any).get('user')
    const id = c.req.param('id')
    const existing = await ownExpense(id, currentUser.companyId)
    if (!existing) return c.json({ error: 'Expense not found' }, 404)
    // OWNERSHIP FIRST. (Salon RR7 X5)
    //
    // The payment check used to run before this, so a stylist trying to delete a colleague's claim
    // was told it had already been reimbursed — which answers a question about a record they are
    // not allowed to see. What they may touch is decided before anything about it is revealed.
    if (!MANAGER_ROLES.has(currentUser.role)) {
      if (!isMine(currentUser, existing)) return c.json({ error: 'Expense not found' }, 404)
      if (existing.approved) return c.json({ error: 'This expense has been approved. Ask a manager to remove it.' }, 403)
    }
    // The stronger version of the edit rule. Refusing to REWRITE a reimbursed amount while allowing
    // the row to be deleted outright protects nothing: deleting removes the record of the payment
    // altogether, which is worse than changing it. Same money, same answer. (Salon RR6 E4)
    if (existing.reimbursed) {
      return c.json({
        error: `${existing.description ? `"${existing.description}" ` : 'This expense '}has already been reimbursed for ${existing.amount}. The record of a payment cannot be deleted — ${CORRECTION_ADVICE}`,
        code: 'already_reimbursed',
      }, 409)
    }
    await db.delete(t.expense).where(and(eq(t.expense.id, id), eq(t.expense.companyId, currentUser.companyId)))
    audit?.log({ action: 'delete', entity: 'expense', entityId: id, metadata: { amount: existing.amount, description: existing.description }, req: { user: currentUser } })
    return c.body(null, 204)
  })

  // Reimburse / approve: managers only, scoped to the company.
  //
  // ── and reimbursing pays the money out, so it comes AFTER approval (RR4 M4) ───────────────────
  //
  // An expense read `reimbursed: true` while `approved: false`. Approval exists so somebody checks a
  // claim before it is paid; if the payment can be made without it, the check does nothing at all —
  // it is a tickbox next to a payment that has already happened. The order is now enforced, and the
  // refusal says which step is missing rather than just saying no.
  const managerAction = (field: 'reimbursed' | 'approved') => async (c: any) => {
    const currentUser = (c as any).get('user')
    if (!MANAGER_ROLES.has(currentUser.role)) return c.json({ error: `Only owners, admins and managers can mark expenses ${field}` }, 403)
    const id = c.req.param('id')
    const existing = await ownExpense(id, currentUser.companyId)
    if (!existing) return c.json({ error: 'Expense not found' }, 404)
    // Same rule as time, at both doors: you are not the second person for your own claim. (RR6 E1)
    const selfRefusal = selfApprovalRefusal(currentUser, existing)
    if (selfRefusal) return c.json({ error: selfRefusal, code: 'self_approval' }, 403)
    if (field === 'reimbursed' && !existing.approved) {
      return c.json({
        error: 'Approve this expense before reimbursing it. Reimbursing pays the money out, and approval is the check that happens first.',
        code: 'approval_required',
        approveWith: `POST /api/expenses/${id}/approve`,
      }, 409)
    }
    const updates: any = { [field]: true, updatedAt: new Date() }
    if (field === 'reimbursed') { updates.reimbursedAt = new Date(); updates.reimbursedById = currentUser.userId }
    if (field === 'approved') { updates.approvedAt = new Date(); updates.approvedById = currentUser.userId }
    const [row] = await db.update(t.expense).set(updates).where(and(eq(t.expense.id, id), eq(t.expense.companyId, currentUser.companyId))).returning()
    audit?.log({ action: 'status_change', entity: 'expense', entityId: id, metadata: { [field]: true }, req: { user: currentUser } })
    return c.json(row)
  }
  app.post('/:id/reimburse', requirePermission('expenses:update'), managerAction('reimbursed'))
  app.post('/:id/approve', requirePermission('expenses:update'), managerAction('approved'))

  return app
}

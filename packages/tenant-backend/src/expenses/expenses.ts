// Expenses — ONE implementation for every CRM that offers expense_tracking (vendored into each template as ../shared).
// Before: two copies; no permission checks at all (any login could delete or reimburse), /:id/reimburse updated by id
// alone with no company scope, the crm-family refused a string amount ("12.50" from a form) while fieldservice coerced
// it, unknown project/job ids surfaced as FK 500s, paging unclamped.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, gte, lte, count, desc, asc, sql, inArray } from 'drizzle-orm'
import { checkFilter } from '../listFilter'
import { hasHappened } from '../dateInput'
import { createStaffBalanceStore, SETTLE_ROUTES, payrollDeductionsAllowed, PAYROLL_DEDUCTION_SETTING, type SettleRoute } from '../team/staffBalance'

export interface ExpenseTables {
  expense: any
  project?: any
  job?: any
  /**
   * What staff owe the business, and the two tables that go with it. (Salon RR9)
   *
   * Optional so a template that has not wired them keeps working: the balance routes refuse with a
   * sentence saying so rather than the module failing to mount. A 500 on a feature a vertical never
   * asked for is worse than an honest "not available here".
   */
  staffAccountEntry?: any
  user?: any
  company?: any
}
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
 * of one), the message said the true thing in both directions and admitted the gap instead of
 * pretending. A refusal that recommends something impossible is worse than one that says so.
 *
 * RR8: the tester agreed the admission was right for now and said a real correction entry was worth
 * building before this ships to salons that reimburse heavily. It is built —
 * POST /:id/repayment — so the advice now names something that exists rather than sending the
 * reader outside the system. A refusal is only as good as the door it points at.
 */
const CORRECTION_ADVICE =
  'if too little was paid, add a new expense for the shortfall. If too much was paid, record what came back with Record repayment on this expense.'

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
    // WHO CLAIMED IT, by name. (T41)
    //
    //   salon: "'Reimburse me' when a manager edits someone else's expense"
    //
    // The row carried submittedById and nothing else, so the screen could tell whether a claim was
    // yours but not whose it was — and the reimbursement checkbox said "Reimburse me" to a manager
    // correcting a stylist's claim, about money that would go to the stylist. A manager already
    // sees these people by name in the Owed panel, and a non-manager only ever sees their own rows
    // (the list self-scopes above), so this adds no visibility to anyone.
    const submitterIds = [...new Set(rows.filter((e) => e.submittedById).map((e) => e.submittedById))]
    const [projects, jobs, submitters] = await Promise.all([
      projectIds.length && t.project ? db.select({ id: t.project.id, name: t.project.name }).from(t.project).where(and(eq(t.project.companyId, companyId), inArray(t.project.id, projectIds))) : Promise.resolve([]),
      jobIds.length && t.job ? db.select({ id: t.job.id, title: t.job.title, number: t.job.number }).from(t.job).where(and(eq(t.job.companyId, companyId), inArray(t.job.id, jobIds))) : Promise.resolve([]),
      submitterIds.length && t.user ? db.select({ id: t.user.id, firstName: t.user.firstName, lastName: t.user.lastName, email: t.user.email }).from(t.user).where(and(eq(t.user.companyId, companyId), inArray(t.user.id, submitterIds))) : Promise.resolve([]),
    ])
    const pm = Object.fromEntries(projects.map((p: any) => [p.id, p])), jm = Object.fromEntries(jobs.map((j: any) => [j.id, j]))
    const sm = Object.fromEntries((submitters as any[]).map((u: any) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || null]))
    return rows.map((e) => ({
      ...e,
      project: e.projectId ? pm[e.projectId] || null : null,
      job: e.jobId ? jm[e.jobId] || null : null,
      submittedByName: e.submittedById ? sm[e.submittedById] || null : null,
    }))
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
  // ── what staff owe (Salon RR9) ────────────────────────────────────────────────────────────────
  //
  // The ledger is the same implementation the client account balance uses, anchored on the user row
  // instead of the contact row. A template that has not wired the table gets an honest refusal.
  const NO_BALANCE_HERE = 'Staff balances are not set up in this product yet.'
  const staffStore = () => (t.staffAccountEntry && t.user ? createStaffBalanceStore(t.staffAccountEntry) : null)
  const companySettings = async (companyId: string) => {
    if (!t.company) return {}
    const [row] = await db.select({ settings: t.company.settings }).from(t.company).where(eq(t.company.id, companyId)).limit(1)
    return (row?.settings as any) || {}
  }
  /** Names for the owed list, so a screen does not show a column of ids. */
  const namesFor = async (companyId: string, ids: string[]) => {
    const out: Record<string, string> = {}
    if (!t.user || !ids.length) return out
    const rows = await db.select({ id: t.user.id, firstName: t.user.firstName, lastName: t.user.lastName })
      .from(t.user).where(and(eq(t.user.companyId, companyId), inArray(t.user.id, [...new Set(ids)])))
    for (const r of rows as any[]) out[String(r.id)] = [r.firstName, r.lastName].filter(Boolean).join(' ') || ''
    return out
  }

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
      /**
       * A TOTAL ORDER, so a row does not move when it is saved. (T51 follow-up)
       *
       * Owner, on the salon: "expense rows reorder after a save."
       *
       * This ordered by `date` alone. A salon enters most of a week's expenses on the same day, so
       * most rows TIE — and with a tie Postgres is free to return them in any order, which in
       * practice is physical row order. An UPDATE rewrites the row at the end of the heap, so the
       * one you just edited jumps somewhere else in the list and the rows around it shuffle. Nothing
       * is wrong with the data; the query simply never said what order it wanted.
       *
       * `createdAt` breaks almost every tie in the order people actually entered them, and `id` is
       * unique so the order is fully determined — the same list, every time, for the same filters.
       * This also makes the paging honest: with ties, a row could appear on page 1 and page 2 of the
       * same read, or on neither.
       */
      db.select().from(t.expense).where(where)
        .orderBy(desc(t.expense.date), desc(t.expense.createdAt), asc(t.expense.id))
        .offset((page - 1) * limit).limit(limit),
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
    /**
     * What the business actually spent — claimed, less anything handed back. (RR8/X6 repayments)
     *
     * A $50 claim paid at $50 with $10 returned cost the salon $40, and a total that still says $50
     * is the reason someone reaches for the amount field and tries to rewrite a payment. `claimed`
     * stays beside it so the two can be reconciled rather than one quietly replacing the other:
     * every other money surface in this product reports the gross and the deduction, not a single
     * number that has already had something taken off it without saying so.
     */
    const groups = await db.select({
      category: t.expense.category,
      totalAmount: sql<string>`sum(${t.expense.amount})`,
      repaid: sql<string>`sum(COALESCE(${t.expense.repaidAmount}, 0))`,
      cnt: count(),
    }).from(t.expense).where(and(...conditions)).groupBy(t.expense.category)
    const r2 = (n: number) => Math.round(n * 100) / 100
    const claimed = groups.reduce((s: number, g: any) => s + Number(g.totalAmount || 0), 0)
    const repaid = groups.reduce((s: number, g: any) => s + Number(g.repaid || 0), 0)
    return c.json({
      total: r2(claimed - repaid),
      claimed: r2(claimed),
      repaid: r2(repaid),
      byCategory: Object.fromEntries(groups.map((g: any) => [g.category, {
        amount: r2(Number(g.totalAmount || 0) - Number(g.repaid || 0)),
        claimed: Number(g.totalAmount || 0),
        repaid: Number(g.repaid || 0),
        count: Number(g.cnt),
      }])),
    })
  })

  /**
   * What staff owe the business. (Salon RR9)
   *
   * Registered ABOVE /:id, or Hono hands "owed" to the by-id route and the answer is "Expense not
   * found" for a word that is not an id. That mistake has its own guard (#175) because it has
   * happened twice.
   *
   * A manager sees everyone; anybody else sees only their own, and always their own — a stylist is
   * entitled to know what the shop says they owe, and in fact needs to.
   */
  app.get('/owed', requirePermission('expenses:read'), async (c) => {
    const currentUser = (c as any).get('user')
    const store = staffStore()
    if (!store) return c.json({ error: NO_BALANCE_HERE, code: 'not_available' }, 501)
    const manager = MANAGER_ROLES.has(currentUser.role)
    if (!manager) {
      const owed = await store.owed(db, currentUser.companyId, currentUser.userId)
      return c.json({
        total: owed,
        people: owed > 0.005 ? [{ userId: currentUser.userId, owed, history: await store.historyFor(db, currentUser.companyId, currentUser.userId, 20) }] : [],
        payrollDeductionsAllowed: false,
      })
    }
    const balances = await store.allOwed(db, currentUser.companyId)
    const names = await namesFor(currentUser.companyId, balances.map((b) => b.userId))
    return c.json({
      total: Math.round(balances.reduce((s, b) => s + b.owed, 0) * 100) / 100,
      people: await Promise.all(balances.map(async (b) => ({
        ...b,
        name: names[b.userId] || null,
        history: await store.historyFor(db, currentUser.companyId, b.userId, 20),
      }))),
      // So the screen can offer the payroll route, or explain why it cannot.
      payrollDeductionsAllowed: payrollDeductionsAllowed(await companySettings(currentUser.companyId)),
      payrollDeductionSetting: PAYROLL_DEDUCTION_SETTING,
    })
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

  /**
   * Money handed BACK against a claim that was paid too much. (Salon RR8/X6, and the tester asked
   * for it by name.)
   *
   * Until now the refusal on a reimbursed expense said: if too little was paid add another expense
   * for the shortfall, and if too much was paid the sheet cannot record a repayment — settle it
   * outside and note it here. Admitting the gap was better than the advice it replaced, which sent
   * people round in a circle, but "settle it outside the system" is not a feature. A salon that
   * over-pays a stylist $10 has $10 coming back and nowhere to put it.
   *
   * Three things this is NOT, on purpose:
   *
   *   · it does not rewrite the amount. $50 was paid; that is what happened, and the record of a
   *     payment is not editable. RR6 E4 and RR7 X2 both turn on that, and this must not undo it.
   *   · it is not a negative expense. A negative amount is refused everywhere in this module and a
   *     credit note is a different kind of document; inventing one under the word "expense" would
   *     leave every total and every filing to guess which rows are money out and which are money in.
   *   · it does not need a second person's approval. Approval exists so somebody checks a claim
   *     BEFORE money leaves the building. This is money arriving, and requiring a second signature
   *     on it would only delay putting the books right. It takes the authority that pays a claim out
   *     (manager+), it demands a written reason, and it is audited — which is the control that fits.
   *
   * Cumulative, because a repayment can arrive in instalments, and capped at what was actually paid:
   * more coming back than went out is not a correction, it is a different transaction.
   */
  const repaymentSchema = z.object({
    amount: z.coerce.number({ invalid_type_error: 'Amount must be a number, for example 10.00' })
      .positive('A repayment has to be more than 0')
      .max(100_000_000),
    // required_error as well as min(1): a field that is simply ABSENT gets zod's own "Required",
    // which is the sort of message this module has spent three rounds replacing with English.
    reason: z.string({ required_error: 'Say why the money came back — the sheet has to explain itself later' })
      .trim().min(1, 'Say why the money came back — the sheet has to explain itself later').max(500).transform(stripTags),
    date: dateField,
  })
  app.post('/:id/repayment', requirePermission('expenses:update'), async (c) => {
    const currentUser = (c as any).get('user')
    if (!MANAGER_ROLES.has(currentUser.role)) {
      return c.json({ error: 'Only owners, admins and managers can record a repayment' }, 403)
    }
    const id = c.req.param('id')
    const existing = await ownExpense(id, currentUser.companyId)
    if (!existing) return c.json({ error: 'Expense not found' }, 404)
    const parsed = repaymentSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)

    // Nothing went out, so nothing can come back. An unpaid claim that is wrong is simply corrected.
    if (!existing.reimbursed) {
      return c.json({
        error: `${existing.description ? `"${existing.description}" ` : 'This expense '}has not been reimbursed, so there is nothing to pay back. Correct the amount instead.`,
        code: 'not_reimbursed',
      }, 409)
    }
    const paid = Number(existing.amount) || 0
    const already = Number(existing.repaidAmount) || 0

    /**
     * A REPAYMENT CANNOT EXCEED WHAT WAS OVER-PAID. (T32 M6)
     *
     * The ceiling was what the CLAIM was worth, which is the right answer only when nobody has worked
     * out a figure. The report recorded a $29.55 over-payment and then put through repayments of $40
     * and $29.55 — $69.55 came back against $29.55 owed, both accepted, "Owed" reading $0, and "the
     * extra $40 taken from the employee is tracked nowhere". That is money off somebody's pay with
     * no record of why.
     *
     * So: when an over-payment HAS been recorded against this expense, that figure is the ceiling.
     * It is read from the ledger rather than the balance, because the balance is per PERSON and gets
     * settled — after the first repayment `owed` is 0, and capping on it would let the next repayment
     * fall through to the old rule and reopen exactly this hole. The ledger entry is permanent.
     *
     * When nothing has been recorded, the claim stays the ceiling: somebody handing back part of a
     * paid claim, which is the case this endpoint was built for, needs no debt raised first.
     */
    let ceiling = paid
    let ceilingIsDebt = false
    if (t.staffAccountEntry && existing.submittedById) {
      const [agg] = await db.select({
        raised: sql<string>`COALESCE(SUM(CASE WHEN ${t.staffAccountEntry.amount} < 0 THEN -${t.staffAccountEntry.amount} ELSE 0 END), 0)`,
      })
        .from(t.staffAccountEntry)
        .where(and(
          eq(t.staffAccountEntry.companyId, currentUser.companyId),
          eq(t.staffAccountEntry.userId, existing.submittedById),
          eq(t.staffAccountEntry.expenseId, id),
        ))
      const raised = Number(agg?.raised || 0)
      if (raised > 0.005) { ceiling = Math.round(raised * 100) / 100; ceilingIsDebt = true }
    }

    const left = Math.round((ceiling - already) * 100) / 100
    if (parsed.data.amount > left + 0.005) {
      return c.json({
        error: left <= 0
          ? ceilingIsDebt
            ? `The whole ${ceiling.toFixed(2)} over-paid on this expense has already come back.`
            : `The whole ${paid.toFixed(2)} paid on this expense has already been paid back.`
          : ceilingIsDebt
            ? `Only ${left.toFixed(2)} of the ${ceiling.toFixed(2)} over-paid on this expense is still owed, so ${parsed.data.amount.toFixed(2)} cannot come back against it. Taking more than was over-paid is money off somebody's pay with nothing to explain it.`
            : `Only ${left.toFixed(2)} of the ${paid.toFixed(2)} paid on this expense is still outstanding, so ${parsed.data.amount.toFixed(2)} cannot come back against it.`,
        code: ceilingIsDebt ? 'exceeds_overpayment' : 'exceeds_paid',
        paid, alreadyRepaid: already, outstanding: left,
        ...(ceilingIsDebt ? { overpaid: ceiling } : {}),
      }, 400)
    }

    const total = Math.round((already + parsed.data.amount) * 100) / 100
    const store = staffStore()
    /**
     * Money arriving also clears the debt, when there is one. (Salon RR9)
     *
     * Once a balance exists, these two facts have to move together: an expense that says $10 came
     * back while the person's balance still says they owe $10 is the product disagreeing with itself,
     * and whichever screen you looked at last would be the one you believed. Same transaction, so
     * one cannot land without the other.
     *
     * It settles at most what is owed — a repayment can be larger than the debt that was raised, or
     * there may be no debt at all, which is the ordinary case this endpoint was built for first.
     */
    const { row, clearedOwed } = await db.transaction(async (tx: any) => {
      const [updated] = await tx.update(t.expense).set({
        repaidAmount: String(total),
        repaidAt: parsed.data.date ? new Date(parsed.data.date) : new Date(),
        repaidById: currentUser.userId,
        // The latest reason, with the ones before it kept in the audit log rather than overwritten.
        repaidReason: parsed.data.reason,
        updatedAt: new Date(),
      }).where(and(eq(t.expense.id, id), eq(t.expense.companyId, currentUser.companyId))).returning()

      let cleared = 0
      if (store && existing.submittedById) {
        const owedNow = await store.owed(tx, currentUser.companyId, existing.submittedById, true)
        const settleNow = Math.min(owedNow, parsed.data.amount)
        if (settleNow > 0.005) {
          const res = await store.settle(tx, {
            companyId: currentUser.companyId, userId: existing.submittedById, amount: settleNow, route: 'cash',
            reason: `Repaid against "${existing.description || 'an expense'}" — ${parsed.data.reason}`,
            expenseId: id, createdBy: currentUser.userId,
          })
          if (res.ok) cleared = res.settled
        }
      }
      return { row: updated, clearedOwed: cleared }
    })
    audit?.log({
      action: 'payment', entity: 'expense', entityId: id,
      metadata: { repayment: parsed.data.amount, repaidTotal: total, of: paid, reason: parsed.data.reason, ...(clearedOwed ? { clearedOwed } : {}) },
      req: { user: currentUser },
    })
    return c.json({
      ...row,
      netAmount: Math.round((paid - total) * 100) / 100,
      fullyRepaid: total + 0.005 >= paid,
      ...(clearedOwed ? { clearedOwed } : {}),
    })
  })

  /**
   * "This paid claim was over-paid by X, and the person still owes it." (Salon RR9)
   *
   * The repayment endpoint above records money ARRIVING. This records the debt, which is the state
   * the business is actually in from the moment the error is found until the money comes back — days
   * or weeks, during which nobody could see it, chase it, or take it off a pay run.
   *
   * Same authority and same evidence as paying a claim out: manager+, a written reason, audited. The
   * claim itself is not touched — it was paid what it was paid.
   */
  app.post('/:id/overpayment', requirePermission('expenses:update'), async (c) => {
    const currentUser = (c as any).get('user')
    if (!MANAGER_ROLES.has(currentUser.role)) return c.json({ error: 'Only owners, admins and managers can record an over-payment' }, 403)
    const store = staffStore()
    if (!store) return c.json({ error: NO_BALANCE_HERE, code: 'not_available' }, 501)
    const id = c.req.param('id')
    const existing = await ownExpense(id, currentUser.companyId)
    if (!existing) return c.json({ error: 'Expense not found' }, 404)
    const parsed = repaymentSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    if (!existing.reimbursed) {
      return c.json({
        error: `${existing.description ? `"${existing.description}" ` : 'This expense '}has not been reimbursed, so nobody has been over-paid. Correct the amount instead.`,
        code: 'not_reimbursed',
      }, 409)
    }
    if (!existing.submittedById) {
      return c.json({
        error: 'This claim has no submitter recorded, so there is nobody to owe the money. It was entered before the sheet kept track of who claimed what.',
        code: 'no_submitter',
      }, 409)
    }
    // What is left of this payment that could have been over-paid: the amount, less anything already
    // returned and anything already raised against it.
    const paid = Number(existing.amount) || 0
    const already = Number(existing.repaidAmount) || 0
    const raisedHere = await store.historyFor(db, currentUser.companyId, existing.submittedById, 200)
    const outstandingOnThis = Math.round((raisedHere
      .filter((e) => e.expenseId === id && e.source === 'over_reimbursement')
      .reduce((s, e) => s + Math.abs(e.amount), 0)) * 100) / 100
    const room = Math.round((paid - already - outstandingOnThis) * 100) / 100
    if (parsed.data.amount > room + 0.005) {
      return c.json({
        error: room <= 0
          ? `The whole ${paid.toFixed(2)} paid on this claim is already accounted for — ${already.toFixed(2)} returned and ${outstandingOnThis.toFixed(2)} owed.`
          : `Only ${room.toFixed(2)} of the ${paid.toFixed(2)} paid on this claim is unaccounted for, so ${parsed.data.amount.toFixed(2)} cannot be owed against it.`,
        code: 'exceeds_paid', paid, alreadyRepaid: already, alreadyOwed: outstandingOnThis, room,
      }, 400)
    }

    const owedAfter = await db.transaction(async (tx: any) => {
      await store.raise(tx, {
        companyId: currentUser.companyId, userId: existing.submittedById,
        amount: parsed.data.amount, reason: parsed.data.reason, expenseId: id, createdBy: currentUser.userId,
      })
      return store.owed(tx, currentUser.companyId, existing.submittedById)
    })
    audit?.log({
      action: 'status_change', entity: 'expense', entityId: id,
      metadata: { overPaidBy: parsed.data.amount, owedBy: existing.submittedById, reason: parsed.data.reason },
      req: { user: currentUser },
    })
    return c.json({ expenseId: id, userId: existing.submittedById, raised: parsed.data.amount, owed: owedAfter })
  })

  /**
   * Clear what somebody owes, by one of four routes. (Salon RR9)
   *
   *   cash       they handed it back. Nothing else needed.
   *   offset     it comes off a claim of theirs that is approved and not yet paid. That claim is then
   *              settled in full on the record, with the held-back part named on it, because "paid
   *              $60, $10 of which went against what you owed" is the truth and "paid $50" is not.
   *   payroll    it comes off a pay run. OFF unless the business switches it on, and refused without
   *              a recorded authorisation — in most US states taking money from wages needs the
   *              employee's written consent, and this product is not going to do it silently.
   *   write_off  the business stops chasing it. Still a decision somebody made, with a reason.
   */
  const settleSchema = z.object({
    amount: z.coerce.number({ invalid_type_error: 'Amount must be a number, for example 10.00' }).positive('A settlement has to be more than 0').max(100_000_000),
    reason: z.string({ required_error: 'Say how this was settled — the balance has to explain itself later' })
      .trim().min(1, 'Say how this was settled — the balance has to explain itself later').max(500).transform(stripTags),
    via: z.enum(SETTLE_ROUTES as unknown as [SettleRoute, ...SettleRoute[]], {
      errorMap: () => ({ message: `How it was settled has to be one of ${SETTLE_ROUTES.join(', ')}` }),
    }),
    /** offset only: the claim of theirs it comes off. */
    againstExpenseId: z.string().optional().nullable(),
    /** payroll only: who authorised the deduction, and where that authorisation is recorded. */
    authorisation: z.string().trim().max(500).optional().nullable(),
  })
  app.post('/owed/:userId/settle', requirePermission('expenses:update'), async (c) => {
    const currentUser = (c as any).get('user')
    if (!MANAGER_ROLES.has(currentUser.role)) return c.json({ error: 'Only owners, admins and managers can settle what staff owe' }, 403)
    const store = staffStore()
    if (!store) return c.json({ error: NO_BALANCE_HERE, code: 'not_available' }, 501)
    const userId = c.req.param('userId')
    const parsed = settleSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const { amount, reason, via } = parsed.data

    // The person has to be one of ours — settling against an id from another tenant would write a
    // balance nobody in this company can see.
    const [person] = t.user
      ? await db.select({ id: t.user.id, firstName: t.user.firstName, lastName: t.user.lastName })
        .from(t.user).where(and(eq(t.user.id, userId), eq(t.user.companyId, currentUser.companyId))).limit(1)
      : [null]
    if (!person) return c.json({ error: 'That person could not be found' }, 404)

    if (via === 'payroll') {
      const settings = await companySettings(currentUser.companyId)
      if (!payrollDeductionsAllowed(settings)) {
        return c.json({
          error: 'Taking money off a pay run is switched off for this business. An owner can turn it on in Settings, and in most places it also needs the employee\'s written authorisation.',
          code: 'payroll_deductions_off', setting: PAYROLL_DEDUCTION_SETTING,
        }, 409)
      }
      if (!parsed.data.authorisation || !String(parsed.data.authorisation).trim()) {
        return c.json({
          error: 'Record who authorised this deduction and where that authorisation is kept. Money does not come off someone\'s pay on a verbal say-so.',
          code: 'authorisation_required',
        }, 400)
      }
    }

    let offsetClaim: any = null
    if (via === 'offset') {
      if (!parsed.data.againstExpenseId) {
        return c.json({ error: 'Say which claim of theirs this comes off.', code: 'claim_required' }, 400)
      }
      offsetClaim = await ownExpense(String(parsed.data.againstExpenseId), currentUser.companyId)
      if (!offsetClaim) return c.json({ error: 'That claim could not be found' }, 404)
      if (String(offsetClaim.submittedById || '') !== String(userId)) {
        return c.json({ error: 'That claim belongs to somebody else, so it cannot settle this balance.', code: 'wrong_claimant' }, 400)
      }
      if (!offsetClaim.reimbursable) return c.json({ error: 'That claim is not a reimbursement, so there is nothing to hold back from it.', code: 'not_a_claim' }, 409)
      if (offsetClaim.reimbursed) return c.json({ error: 'That claim has already been paid, so nothing can be held back from it.', code: 'already_reimbursed' }, 409)
      if (!offsetClaim.approved) return c.json({ error: 'Approve that claim first. Holding money back from a claim nobody has approved settles a debt against a figure nobody has checked.', code: 'approval_required' }, 409)
      if (amount > (Number(offsetClaim.amount) || 0) + 0.005) {
        return c.json({
          error: `That claim is for ${Number(offsetClaim.amount).toFixed(2)}, so ${amount.toFixed(2)} cannot come off it.`,
          code: 'exceeds_claim', claim: Number(offsetClaim.amount) || 0,
        }, 400)
      }
    }

    const result = await db.transaction(async (tx: any) => {
      const settled = await store.settle(tx, {
        companyId: currentUser.companyId, userId, amount, route: via,
        reason: via === 'payroll' ? `${reason} — authorised: ${String(parsed.data.authorisation).trim()}` : reason,
        expenseId: via === 'offset' ? offsetClaim.id : null,
        createdBy: currentUser.userId,
      })
      if (!settled.ok) return { settled }
      // The offset claim is paid in full on the record, with the held-back part named on it.
      if (via === 'offset') {
        await tx.update(t.expense).set({
          reimbursed: true, reimbursedAt: new Date(), reimbursedById: currentUser.userId,
          appliedToOwed: String(amount), updatedAt: new Date(),
        }).where(and(eq(t.expense.id, offsetClaim.id), eq(t.expense.companyId, currentUser.companyId)))
      }
      return { settled }
    })
    if (!result.settled.ok) return c.json({ error: result.settled.error, owed: result.settled.owed }, 409)

    audit?.log({
      action: 'payment', entity: 'expense', entityId: via === 'offset' ? offsetClaim.id : userId,
      metadata: {
        settledOwed: amount, via, userId, reason,
        ...(via === 'payroll' ? { authorisation: String(parsed.data.authorisation).trim() } : {}),
        ...(via === 'offset' ? { againstClaim: offsetClaim.id, claimPaid: Number(offsetClaim.amount) || 0, cashPaid: Math.round(((Number(offsetClaim.amount) || 0) - amount) * 100) / 100 } : {}),
      },
      req: { user: currentUser },
    })
    return c.json({
      userId, settled: amount, via,
      owed: result.settled.ok ? result.settled.owedAfter : undefined,
      ...(via === 'offset' ? {
        againstExpenseId: offsetClaim.id,
        claimAmount: Number(offsetClaim.amount) || 0,
        paidInCash: Math.round(((Number(offsetClaim.amount) || 0) - amount) * 100) / 100,
      } : {}),
    })
  })

  return app
}

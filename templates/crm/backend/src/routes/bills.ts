/**
 * Vendor bills — accounts payable. What vendors actually charge us, whether
 * or not a purchase order exists. Recording a payment moves the status
 * open -> partial -> paid; paying a PO-linked bill in full marks the PO
 * billed. /summary/job/:jobId is the job-costing rollup (committed vs billed).
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { vendorBill, vendorBillPayment, jobPurchaseOrder as purchaseOrder, contact, job, user } from '../../db/schema.ts'
import { eq, and, count, desc, sql, inArray, lt } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

const app = new Hono()
app.use('*', authenticate)
/**
 * Reads are checked against the matrix too — this is accounts payable — what the company owes, and to whom. (T32 H1)
 *
 * Every write below has always been gated on `bills:*`; the GETs were on `authenticate`
 * alone, so any signed-in user of the company could read them. The matrix already draws the line:
 * `bills` sits with admin and manager, and `field` and `viewer` hold none of it.
 *
 * On the MOUNT rather than per handler, so the next GET added to this file is gated by
 * construction and cannot repeat the omission.
 */
app.use('*', requirePermission('bills:read'))

/**
 * Which bill statuses are SPEND. One list, used by the job rollup, the PO commitment relief and the
 * over-billing check, so a void bill cannot count in one place and not another. (T32 M3)
 */
const BILL_IS_SPEND = ['open', 'partial', 'paid']
/** Money, to the cent. A float sum is not a money figure. (T32 L4) */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const fieldError = (err: any, fallback: string) => {
  const first = err?.issues?.[0]
  if (!first) return fallback
  // The PATH, the way the app's error handler already reports a thrown ZodError. Without it zod's
  // own "Required" is the whole message, on a form with fifteen fields. (T32 L3)
  const where = Array.isArray(first.path) && first.path.length ? `${first.path.join('.')}: ` : ''
  return where + (first.message || fallback)
}

const billSchema = z.object({
  vendorId: z.string().min(1),
  number: z.string().optional(),
  /** Bill more than the purchase order allows, deliberately. See POST / below. (T32 M3) */
  allowOverage: z.boolean().optional(),
  jobId: z.string().optional(),
  projectId: z.string().optional(),
  purchaseOrderId: z.string().optional(),
  billDate: z.string().optional(),
  dueDate: z.string().optional(),
  amount: z.number().positive(),
  fileUrl: z.string().optional(),
  notes: z.string().optional(),
})

async function hydrate(rows: any[], companyId: string) {
  const vendorIds = [...new Set(rows.filter(r => r.vendorId).map(r => r.vendorId))]
  const jobIds = [...new Set(rows.filter(r => r.jobId).map(r => r.jobId))]
  const poIds = [...new Set(rows.filter(r => r.purchaseOrderId).map(r => r.purchaseOrderId))]
  const [vendors, jobs, pos] = await Promise.all([
    vendorIds.length ? db.select({ id: contact.id, name: contact.name, company: contact.company }).from(contact).where(and(eq(contact.companyId, companyId), inArray(contact.id, vendorIds))) : Promise.resolve([]),
    jobIds.length ? db.select({ id: job.id, title: job.title }).from(job).where(and(eq(job.companyId, companyId), inArray(job.id, jobIds))) : Promise.resolve([]),
    poIds.length ? db.select({ id: purchaseOrder.id, number: purchaseOrder.number }).from(purchaseOrder).where(and(eq(purchaseOrder.companyId, companyId), inArray(purchaseOrder.id, poIds))) : Promise.resolve([]),
  ])
  const vMap = Object.fromEntries(vendors.map(v => [v.id, v]))
  const jMap = Object.fromEntries(jobs.map(j => [j.id, j]))
  const pMap = Object.fromEntries(pos.map(p => [p.id, p]))
  return rows.map(r => ({
    ...r,
    vendor: r.vendorId ? vMap[r.vendorId] || null : null,
    job: r.jobId ? jMap[r.jobId] || null : null,
    purchaseOrder: r.purchaseOrderId ? pMap[r.purchaseOrderId] || null : null,
  }))
}

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const jobId = c.req.query('jobId')
  const vendorId = c.req.query('vendorId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions = [eq(vendorBill.companyId, currentUser.companyId)]
  if (status === 'overdue') {
    conditions.push(inArray(vendorBill.status, ['open', 'partial']))
    conditions.push(lt(vendorBill.dueDate, new Date()))
  } else if (status) {
    conditions.push(eq(vendorBill.status, status))
  }
  if (jobId) conditions.push(eq(vendorBill.jobId, jobId))
  if (vendorId) conditions.push(eq(vendorBill.vendorId, vendorId))
  const where = and(...conditions)

  const [rows, [{ value: total }]] = await Promise.all([
    db.select().from(vendorBill).where(where).orderBy(desc(vendorBill.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(vendorBill).where(where),
  ])
  const data = await hydrate(rows, currentUser.companyId)
  return c.json({ data, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

app.get('/summary', async (c) => {
  const currentUser = c.get('user') as any
  const rows = await db.select({
    status: vendorBill.status,
    totalAmount: sql<string>`sum(${vendorBill.amount})`,
    totalPaid: sql<string>`sum(${vendorBill.amountPaid})`,
    cnt: count(),
  }).from(vendorBill).where(eq(vendorBill.companyId, currentUser.companyId)).groupBy(vendorBill.status)
  const byStatus = Object.fromEntries(rows.map(r => [r.status, { amount: Number(r.totalAmount || 0), paid: Number(r.totalPaid || 0), count: r.cnt }]))
  // Rounded to the cent. Summed in JavaScript, this returned 750.2500000000001 — a figure nobody
  // typed, on the AP total. Every money figure this file answers with goes through round2. (T32 L4)
  const outstanding = round2(rows.filter(r => ['open', 'partial'].includes(r.status))
    .reduce((s, r) => s + Number(r.totalAmount || 0) - Number(r.totalPaid || 0), 0))
  const [{ value: overdueCount }] = await db.select({ value: count() }).from(vendorBill)
    .where(and(eq(vendorBill.companyId, currentUser.companyId), inArray(vendorBill.status, ['open', 'partial']), lt(vendorBill.dueDate, new Date())))
  return c.json({ byStatus, outstanding, overdueCount: Number(overdueCount) })
})

/**
 * The job's project, for a bill that names a job but no project. (T34)
 *
 * `null` jobId means "nothing to inherit from", so the caller can pass the id it has without
 * branching around it.
 */
const projectOfJob = async (companyId: string, jobId: string | null): Promise<string | null> => {
  if (!jobId) return null
  const [row] = await db.select({ projectId: job.projectId }).from(job)
    .where(and(eq(job.id, jobId), eq(job.companyId, companyId))).limit(1)
  return row?.projectId ?? null
}

/**
 * ONE BILL, WITH THE PAYMENTS MADE AGAINST IT. (T34)
 *
 * Two findings, one missing route. There was no `GET /:id` at all — opening a single bill answered
 * 404, so the only way to see one was to find it in the list. And `vendor_bill_payment` has existed
 * and been written to all along (five simultaneous payments are all recorded, which the tester
 * confirmed), with nothing anywhere to read them back: a bill could say $300 paid and never say
 * when, by what method, or in how many parts.
 *
 * Declared AFTER `/summary`, which matters: Hono matches in registration order, so a `/:id` written
 * above it would swallow `/api/bills/summary` and the AP total would start looking for a bill with
 * the id "summary". `/summary/job/:jobId` is three segments and a single `/:id` cannot match it, so
 * that one is safe either side — but the literal route that IS one segment is not.
 */
app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [bill] = await db.select().from(vendorBill)
    .where(and(eq(vendorBill.id, id), eq(vendorBill.companyId, currentUser.companyId))).limit(1)
  if (!bill) return c.json({ error: 'Bill not found' }, 404)

  const [vendorRow, jobRow, payments] = await Promise.all([
    bill.vendorId
      ? db.select({ id: contact.id, name: contact.name, company: contact.company, email: contact.email })
        .from(contact).where(eq(contact.id, bill.vendorId)).limit(1)
      : Promise.resolve([]),
    bill.jobId
      ? db.select({ id: job.id, number: job.number, title: job.title, projectId: job.projectId })
        .from(job).where(eq(job.id, bill.jobId)).limit(1)
      : Promise.resolve([]),
    /*
     * WHO recorded it, by name. `recordedById` is an id, and an id on a reconciliation screen is
     * the same as nothing — the person checking the bank statement needs the name, the way
     * `respondedBy` on an RFI and `approvedBy` on a change order already carry one.
     */
    db.select({
      id: vendorBillPayment.id,
      amount: vendorBillPayment.amount,
      method: vendorBillPayment.method,
      reference: vendorBillPayment.reference,
      notes: vendorBillPayment.notes,
      paidAt: vendorBillPayment.paidAt,
      recordedById: vendorBillPayment.recordedById,
      recordedByFirst: user.firstName,
      recordedByLast: user.lastName,
      recordedByEmail: user.email,
    }).from(vendorBillPayment)
      .leftJoin(user, eq(user.id, vendorBillPayment.recordedById))
      .where(and(
        eq(vendorBillPayment.vendorBillId, id),
        eq(vendorBillPayment.companyId, currentUser.companyId),
      )).orderBy(desc(vendorBillPayment.paidAt)),
  ])

  const named = payments.map((p: any) => {
    const { recordedByFirst, recordedByLast, recordedByEmail, ...rest } = p
    const full = [recordedByFirst, recordedByLast].filter(Boolean).join(' ').trim()
    return { ...rest, recordedBy: full || recordedByEmail || null }
  })
  const paid = payments.reduce((s: number, p: any) => s + Number(p.amount || 0), 0)
  return c.json({
    ...bill,
    vendor: vendorRow[0] || null,
    job: jobRow[0] || null,
    payments: named,
    /*
     * The balance, computed here rather than left to the screen to subtract — the same figure
     * derived in two places is the shape that produced "to pay −$2.00" elsewhere in this product.
     * `paidTotal` is the sum of the PAYMENT ROWS, so it can be compared against the bill's own
     * `amountPaid`: if those two ever disagree, something wrote one without the other.
     */
    paidTotal: Math.round(paid * 100) / 100,
    balance: round2(Number(bill.amount || 0) - Number(bill.amountPaid || 0)),
  })
})

// Job-costing rollup: what we COMMITTED (open POs) vs what we've been
// BILLED vs what we've PAID for one job.
app.get('/summary/job/:jobId', async (c) => {
  const currentUser = c.get('user') as any
  const jobId = c.req.param('jobId')
  /**
   * COMMITTED is what is still OUTSTANDING on the purchase orders, not their face value. (T32 M3)
   *
   * This summed every live PO's total, with `billed` in the list — so a PO that had been fully
   * billed counted as a commitment AND its bill counted as billed: the same money twice. The report
   * saw Open committed stay at $723.72 after billing $723.72.
   *
   * A commitment is a promise still to be honoured. As bills land against a PO it falls, and reaches
   * zero when the PO is fully billed. Clamped at zero per PO, so one over-billed order cannot net
   * off another order's genuine commitment.
   */
  const billedPerPo = db.$with('billed_per_po').as(
    db.select({
      poId: vendorBill.purchaseOrderId,
      billed: sql<string>`coalesce(sum(${vendorBill.amount}), 0)`.as('billed'),
    }).from(vendorBill).where(and(
      eq(vendorBill.companyId, currentUser.companyId),
      inArray(vendorBill.status, BILL_IS_SPEND),
    )).groupBy(vendorBill.purchaseOrderId),
  )
  const [poRow] = await db.with(billedPerPo).select({
    committed: sql<string>`coalesce(sum(greatest(${purchaseOrder.total}::numeric - coalesce(${billedPerPo.billed}::numeric, 0), 0)), 0)`,
  }).from(purchaseOrder)
    .leftJoin(billedPerPo, eq(billedPerPo.poId, purchaseOrder.id))
    .where(and(
      eq(purchaseOrder.companyId, currentUser.companyId),
      eq(purchaseOrder.jobId, jobId),
      inArray(purchaseOrder.status, ['sent', 'acknowledged', 'received', 'billed']),
    ))
  const [billRow] = await db.select({
    billed: sql<string>`coalesce(sum(${vendorBill.amount}), 0)`,
    paid: sql<string>`coalesce(sum(${vendorBill.amountPaid}), 0)`,
  }).from(vendorBill).where(and(
    eq(vendorBill.companyId, currentUser.companyId),
    eq(vendorBill.jobId, jobId),
    inArray(vendorBill.status, ['open', 'partial', 'paid']),
  ))
  return c.json({
    committed: Number(poRow?.committed || 0),
    billed: Number(billRow?.billed || 0),
    paid: Number(billRow?.paid || 0),
  })
})

app.post('/', requirePermission('bills:create'), async (c) => {
  const currentUser = c.get('user') as any
  const body = billSchema.safeParse(((await c.req.json().catch(() => null)) ?? {}))
  if (!body.success) return c.json({ error: fieldError(body.error, 'Invalid bill') }, 400)
  const data = body.data

  const [vendor] = await db.select({ id: contact.id }).from(contact)
    .where(and(eq(contact.id, data.vendorId), eq(contact.companyId, currentUser.companyId))).limit(1)
  if (!vendor) return c.json({ error: 'Vendor not found' }, 400)

  let poJobId: string | null = null
  let po: any = null
  if (data.purchaseOrderId) {
    ;[po] = await db.select().from(purchaseOrder)
      .where(and(eq(purchaseOrder.id, data.purchaseOrderId), eq(purchaseOrder.companyId, currentUser.companyId))).limit(1)
    if (!po) return c.json({ error: 'Purchase order not found' }, 400)
    poJobId = po.jobId

    /**
     * OVER-BILLING A PURCHASE ORDER WENT THROUGH SILENTLY. (T32 M3)
     *
     * PO-00001 for $723.72 was billed $723.72 and then a further $5,000 against the SAME PO, with no
     * warning. A purchase order is the figure a vendor agreed to; a bill that exceeds it is either a
     * price change nobody approved or a duplicate invoice, and both are things somebody has to look
     * at before it is paid.
     *
     * Refused by default rather than warned, because a warning in a response body is something
     * nobody reads — and `allowOverage: true` is the way through, so a genuine extra takes one
     * deliberate act and the figures still say what happened.
     */
    const [billedAgg] = await db.select({
      billed: sql<string>`coalesce(sum(${vendorBill.amount}), 0)`,
    }).from(vendorBill).where(and(
      eq(vendorBill.companyId, currentUser.companyId),
      eq(vendorBill.purchaseOrderId, po.id),
      inArray(vendorBill.status, BILL_IS_SPEND),
    ))
    const already = Number(billedAgg?.billed || 0)
    const poTotal = Number(po.total || 0)
    const headroom = Math.round((poTotal - already) * 100) / 100
    if (data.amount > headroom + 0.005 && !data.allowOverage) {
      return c.json({
        error: already > 0.005
          ? `${po.number} is for ${poTotal.toFixed(2)} and ${already.toFixed(2)} has already been billed against it, so only ${Math.max(0, headroom).toFixed(2)} is left. This bill is ${data.amount.toFixed(2)}.`
          : `${po.number} is for ${poTotal.toFixed(2)} and this bill is ${data.amount.toFixed(2)}.`,
        code: 'exceeds_purchase_order',
        purchaseOrder: po.number,
        orderTotal: poTotal,
        alreadyBilled: already,
        remaining: Math.max(0, headroom),
        overBy: Math.round((data.amount - Math.max(0, headroom)) * 100) / 100,
        // Named so the screen can offer it rather than leaving the user stuck.
        override: 'Send allowOverage: true to bill it anyway — the overage will be on the record.',
      }, 409)
    }
  }

  /**
   * A BILL ON A JOB BELONGS TO THAT JOB'S PROJECT. (T34)
   *
   * `jobId` already fell back to the purchase order's job; `projectId` fell back to nothing. So a
   * bill raised against a job on a project was stored with no project, and every project-level
   * figure that counts spend simply did not see it — the cost was on the job and nowhere on the
   * job's project.
   *
   * Derived, not asked for. A job knows its project; making somebody pick it again is how the two
   * end up disagreeing. An explicit `projectId` still wins, for the case where a bill genuinely
   * belongs to a different project than the job's.
   */
  const effectiveJobId = data.jobId || poJobId || null
  const projectFromJob = await projectOfJob(currentUser.companyId, data.projectId ? null : effectiveJobId)

  const [bill] = await db.insert(vendorBill).values({
    companyId: currentUser.companyId,
    vendorId: data.vendorId,
    number: data.number || null,
    jobId: effectiveJobId,
    projectId: data.projectId || projectFromJob || null,
    purchaseOrderId: data.purchaseOrderId || null,
    billDate: data.billDate ? new Date(data.billDate) : new Date(),
    dueDate: data.dueDate ? new Date(data.dueDate) : null,
    amount: data.amount.toFixed(2),
    fileUrl: data.fileUrl || null,
    notes: data.notes || null,
  }).returning()

  /**
   * …and the commitment is relieved. (T32 M3)
   *
   * `billed` was in the list of statuses that count as committed, and NOTHING ever set it — there is
   * no transition to it in purchaseOrders.ts. So a fully-billed PO stayed `received`, kept counting
   * as an open commitment, and the bill counted as well: the same money twice, which is what the
   * report saw when Open committed stayed at $723.72.
   *
   * A PO becomes `billed` the moment bills against it reach its total. It is derived from the bills
   * rather than being a button somebody has to remember to press — a commitment that has to be
   * closed by hand is a commitment that stays open.
   */
  if (po && ['sent', 'acknowledged', 'received'].includes(po.status)) {
    const [agg] = await db.select({
      billed: sql<string>`coalesce(sum(${vendorBill.amount}), 0)`,
    }).from(vendorBill).where(and(
      eq(vendorBill.companyId, currentUser.companyId),
      eq(vendorBill.purchaseOrderId, po.id),
      inArray(vendorBill.status, BILL_IS_SPEND),
    ))
    if (Number(agg?.billed || 0) >= Number(po.total || 0) - 0.005) {
      await db.update(purchaseOrder).set({ status: 'billed', updatedAt: new Date() })
        .where(and(eq(purchaseOrder.id, po.id), eq(purchaseOrder.companyId, currentUser.companyId)))
    }
  }

  return c.json(bill, 201)
})

app.put('/:id', requirePermission('bills:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = billSchema.partial().safeParse(((await c.req.json().catch(() => null)) ?? {}))
  if (!body.success) return c.json({ error: fieldError(body.error, 'Invalid bill') }, 400)
  const data = body.data

  const [existing] = await db.select().from(vendorBill)
    .where(and(eq(vendorBill.id, id), eq(vendorBill.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Bill not found' }, 404)
  if (existing.status === 'paid') return c.json({ error: 'A paid bill can no longer be edited' }, 400)

  const update: Record<string, any> = { updatedAt: new Date() }
  if (data.vendorId) update.vendorId = data.vendorId
  if (data.number !== undefined) update.number = data.number || null
  if (data.jobId !== undefined) update.jobId = data.jobId || null
  if (data.projectId !== undefined) update.projectId = data.projectId || null
  /*
   * The same inheritance on EDIT, because a rule that only applies on create is a rule with a hole
   * in it: moving a bill onto a job would otherwise leave the old project on it, or none at all.
   * Only when the caller did not name a project itself. (T34 — one of the three standing rules)
   */
  if (data.jobId !== undefined && data.projectId === undefined) {
    const inherited = await projectOfJob(currentUser.companyId, data.jobId || null)
    if (inherited) update.projectId = inherited
  }
  if (data.purchaseOrderId !== undefined) update.purchaseOrderId = data.purchaseOrderId || null
  if (data.billDate) update.billDate = new Date(data.billDate)
  if (data.dueDate !== undefined) update.dueDate = data.dueDate ? new Date(data.dueDate) : null
  if (data.amount !== undefined) {
    // A bill cannot be worth less than has already been paid on it. (T32 H8)
    //
    // A $1,000 bill with $300 paid was edited to $100: it saved, went to status "partial" with a
    // balance of −$200, and that −$200 netted into Bills Outstanding — so the company's AP total was
    // understated by money it had actually spent. Invoices already refuse this; bills did not.
    const paid = Number(existing.amountPaid)
    if (data.amount + 0.005 < paid) {
      return c.json({
        error: `${paid.toFixed(2)} has already been paid on this bill, so it cannot be changed to ${data.amount.toFixed(2)}. Record a credit from the vendor instead.`,
        code: 'below_amount_paid',
        amountPaid: paid,
      }, 400)
    }
    update.amount = data.amount.toFixed(2)
    // Lowering the amount to exactly what was paid settles it; raising it reopens a settled bill.
    update.status = data.amount <= paid + 0.005 && paid > 0 ? 'paid' : (paid > 0 ? 'partial' : existing.status)
    update.paidAt = update.status === 'paid' ? (existing.paidAt ?? new Date()) : null
  }
  if (data.fileUrl !== undefined) update.fileUrl = data.fileUrl || null
  if (data.notes !== undefined) update.notes = data.notes || null

  const [updated] = await db.update(vendorBill).set(update).where(eq(vendorBill.id, id)).returning()
  return c.json(updated)
})

app.post('/:id/record-payment', requirePermission('bills:pay'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  // method / reference / notes are accepted now, because the ledger exists to record them — a payment
  // row with no cheque number or card reference is only half an answer when AP is reconciled.
  const body = z.object({
    amount: z.number().positive(),
    method: z.string().max(40).optional(),
    reference: z.string().max(120).optional(),
    notes: z.string().max(1000).optional(),
  }).safeParse(((await c.req.json().catch(() => null)) ?? {}))
  if (!body.success) return c.json({ error: 'A positive payment amount is required' }, 400)

  /**
   * Under a row lock, with a ledger row. (T32 B4)
   *
   * This read `amountPaid`, added to it in JavaScript and wrote the sum back — outside any
   * transaction. Five concurrent $150 payments on a $1,000 bill all read the same starting figure
   * and the last write won: all 15 requests across three bills answered 200, so $2,250 was
   * acknowledged, and $1,350 was recorded. $900 of acknowledged payments simply vanished, and
   * because there was no payment ledger they left no trace at all — the only record was a total
   * that disagreed with what the user had been told.
   *
   * Same shape the invoice side already uses (recordInvoicePayment): SELECT … FOR UPDATE inside a
   * transaction, then read-modify-write under that lock, and the ledger row written in the SAME
   * transaction so a payment can never exist without its total moving, or the reverse.
   */
  const outcome = await db.transaction(async (tx: any) => {
    const locked: any = await tx.execute(sql`
      SELECT * FROM vendor_bill WHERE id = ${id} AND company_id = ${currentUser.companyId} FOR UPDATE
    `)
    const existing = (locked.rows || locked)[0]
    if (!existing) return { status: 404 as const, body: { error: 'Bill not found' } }
    if (existing.status === 'void') return { status: 400 as const, body: { error: 'This bill is void' } }

    const amount = body.data.amount
    const alreadyPaid = Number(existing.amount_paid)
    const total = Number(existing.amount)
    const newPaid = Math.round((alreadyPaid + amount) * 100) / 100
    if (newPaid > total + 0.005) {
      return { status: 400 as const, body: { error: `Payment exceeds the bill balance (${(total - alreadyPaid).toFixed(2)} remaining)` } }
    }
    const fullyPaid = newPaid >= total - 0.005

    // The ledger first, so a row can never be missing for money that moved.
    const [recorded] = await tx.insert(vendorBillPayment).values({
      companyId: currentUser.companyId,
      vendorBillId: id,
      amount: amount.toFixed(2),
      method: body.data.method ?? null,
      reference: body.data.reference ?? null,
      notes: body.data.notes ?? null,
      recordedById: currentUser.userId,
    }).returning()

    const [updated] = await tx.update(vendorBill).set({
      amountPaid: newPaid.toFixed(2),
      status: fullyPaid ? 'paid' : 'partial',
      paidAt: fullyPaid ? new Date() : null,
      updatedAt: new Date(),
    }).where(eq(vendorBill.id, id)).returning()

    // A PO whose linked bill is fully paid is done: mark it billed.
    if (fullyPaid && existing.purchase_order_id) {
      await tx.update(purchaseOrder).set({ status: 'billed', updatedAt: new Date() })
        .where(and(eq(purchaseOrder.id, existing.purchase_order_id), eq(purchaseOrder.companyId, currentUser.companyId)))
    }
    return { status: 200 as const, body: { ...updated, payment: recorded } }
  })
  return c.json(outcome.body, outcome.status)
})

app.post('/:id/void', requirePermission('bills:pay'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const [existing] = await db.select().from(vendorBill)
    .where(and(eq(vendorBill.id, id), eq(vendorBill.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Bill not found' }, 404)
  if (existing.status === 'paid') return c.json({ error: 'A paid bill cannot be voided' }, 400)
  const [updated] = await db.update(vendorBill).set({ status: 'void', updatedAt: new Date() })
    .where(eq(vendorBill.id, id)).returning()
  return c.json(updated)
})

app.delete('/:id', requirePermission('bills:delete'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const [existing] = await db.select().from(vendorBill)
    .where(and(eq(vendorBill.id, id), eq(vendorBill.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Bill not found' }, 404)
  if (Number(existing.amountPaid) > 0) return c.json({ error: 'A bill with recorded payments cannot be deleted — void it instead' }, 400)
  await db.delete(vendorBill).where(eq(vendorBill.id, id))
  return c.body(null, 204)
})

export default app

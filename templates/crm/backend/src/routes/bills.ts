/**
 * Vendor bills — accounts payable. What vendors actually charge us, whether
 * or not a purchase order exists. Recording a payment moves the status
 * open -> partial -> paid; paying a PO-linked bill in full marks the PO
 * billed. /summary/job/:jobId is the job-costing rollup (committed vs billed).
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { vendorBill, vendorBillPayment, jobPurchaseOrder as purchaseOrder, contact, job } from '../../db/schema.ts'
import { eq, and, count, desc, sql, inArray, lt } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

const app = new Hono()
app.use('*', authenticate)

const billSchema = z.object({
  vendorId: z.string().min(1),
  number: z.string().optional(),
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
  const outstanding = rows.filter(r => ['open', 'partial'].includes(r.status))
    .reduce((s, r) => s + Number(r.totalAmount || 0) - Number(r.totalPaid || 0), 0)
  const [{ value: overdueCount }] = await db.select({ value: count() }).from(vendorBill)
    .where(and(eq(vendorBill.companyId, currentUser.companyId), inArray(vendorBill.status, ['open', 'partial']), lt(vendorBill.dueDate, new Date())))
  return c.json({ byStatus, outstanding, overdueCount: Number(overdueCount) })
})

// Job-costing rollup: what we COMMITTED (open POs) vs what we've been
// BILLED vs what we've PAID for one job.
app.get('/summary/job/:jobId', async (c) => {
  const currentUser = c.get('user') as any
  const jobId = c.req.param('jobId')
  const [poRow] = await db.select({
    committed: sql<string>`coalesce(sum(${purchaseOrder.total}), 0)`,
  }).from(purchaseOrder).where(and(
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
  if (!body.success) return c.json({ error: body.error.issues[0]?.message || 'Invalid bill' }, 400)
  const data = body.data

  const [vendor] = await db.select({ id: contact.id }).from(contact)
    .where(and(eq(contact.id, data.vendorId), eq(contact.companyId, currentUser.companyId))).limit(1)
  if (!vendor) return c.json({ error: 'Vendor not found' }, 400)

  let poJobId: string | null = null
  if (data.purchaseOrderId) {
    const [po] = await db.select().from(purchaseOrder)
      .where(and(eq(purchaseOrder.id, data.purchaseOrderId), eq(purchaseOrder.companyId, currentUser.companyId))).limit(1)
    if (!po) return c.json({ error: 'Purchase order not found' }, 400)
    poJobId = po.jobId
  }

  const [bill] = await db.insert(vendorBill).values({
    companyId: currentUser.companyId,
    vendorId: data.vendorId,
    number: data.number || null,
    jobId: data.jobId || poJobId || null,
    projectId: data.projectId || null,
    purchaseOrderId: data.purchaseOrderId || null,
    billDate: data.billDate ? new Date(data.billDate) : new Date(),
    dueDate: data.dueDate ? new Date(data.dueDate) : null,
    amount: data.amount.toFixed(2),
    fileUrl: data.fileUrl || null,
    notes: data.notes || null,
  }).returning()
  return c.json(bill, 201)
})

app.put('/:id', requirePermission('bills:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = billSchema.partial().safeParse(((await c.req.json().catch(() => null)) ?? {}))
  if (!body.success) return c.json({ error: body.error.issues[0]?.message || 'Invalid bill' }, 400)
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

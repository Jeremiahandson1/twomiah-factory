// Vendor bills — accounts payable: what vendors actually charge, with or without a purchase order. A payment
// moves the status open → partial → paid; bills reaching a PO's total mark it billed. /summary/job/:jobId is the
// job-costing roll-up (committed vs billed vs paid). Moved from templates/crm/backend/src/routes/bills.ts.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, count, desc, inArray, lt } from 'drizzle-orm'
import { vendorBill, vendorBillPayment, jobPurchaseOrder as purchaseOrder, contact, job, user } from '../../db/schema/index.ts'
import { billTotalsByStatus, jobCommitted, jobBilledAndPaid, billedAgainstPurchaseOrder, lockBill } from '../../data/bills.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'
import { partialOf } from '@twomiah/tenant-backend'

/**
 * Which bill statuses are SPEND. One list, used by the job roll-up, the PO commitment relief and the over-billing
 * check, so a void bill cannot count in one place and not another (T32 M3).
 */
const BILL_IS_SPEND = ['open', 'partial', 'paid']
/** Money, to the cent. A float sum is not a money figure (T32 L4). */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const billSchema = z.object({
  vendorId: z.string().min(1),
  number: z.string().optional(),
  /** Bill more than the purchase order allows, deliberately. See POST / below (T32 M3). */
  allowOverage: z.boolean().optional(),
  jobId: z.string().optional(),
  projectId: z.string().optional(),
  purchaseOrderId: z.string().optional(),
  billDate: z.string().optional(),
  dueDate: z.string().optional(),
  amount: z.number().positive(),
  fileUrl: z.string().optional(),
  notes: z.string().optional(),
  /** The project budget line this bill files under (cost_by_code). */
  costCode: z.string().trim().max(60).optional().nullable(),
})

export function createBillRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  // Reads are checked against the matrix too: accounts payable — what the company owes, and to whom (T32 H1).
  app.use('*', requirePermission('bills:read'))

  async function hydrate(rows: any[], companyId: string) {
    const vendorIds = [...new Set(rows.filter(r => r.vendorId).map(r => r.vendorId))]
    const jobIds = [...new Set(rows.filter(r => r.jobId).map(r => r.jobId))]
    const poIds = [...new Set(rows.filter(r => r.purchaseOrderId).map(r => r.purchaseOrderId))]
    const [vendors, jobs, pos] = await Promise.all([
      vendorIds.length ? db.select({ id: contact.id, name: contact.name, company: contact.company }).from(contact).where(and(eq(contact.companyId, companyId), inArray(contact.id, vendorIds))) : Promise.resolve([]),
      jobIds.length ? db.select({ id: job.id, title: job.title }).from(job).where(and(eq(job.companyId, companyId), inArray(job.id, jobIds))) : Promise.resolve([]),
      poIds.length ? db.select({ id: purchaseOrder.id, number: purchaseOrder.number }).from(purchaseOrder).where(and(eq(purchaseOrder.companyId, companyId), inArray(purchaseOrder.id, poIds))) : Promise.resolve([]),
    ]) as any[][]
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

  /** The job's project, for a bill that names a job but no project (T34). A null jobId inherits nothing. */
  const projectOfJob = async (companyId: string, jobId: string | null): Promise<string | null> => {
    if (!jobId) return null
    const [row] = await db.select({ projectId: job.projectId }).from(job)
      .where(and(eq(job.id, jobId), eq(job.companyId, companyId))).limit(1)
    return row?.projectId ?? null
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
    return list(c, data, { page, limit, total: Number(total) })
  })

  app.get('/summary', async (c) => {
    const currentUser = c.get('user') as any
    const rows = await billTotalsByStatus(db, currentUser.companyId)
    const byStatus = Object.fromEntries(rows.map(r => [r.status, { amount: Number(r.totalAmount || 0), paid: Number(r.totalPaid || 0), count: r.cnt }]))
    // Rounded to the cent: summed in JavaScript it read 750.2500000000001 (T32 L4).
    const outstanding = round2(rows.filter(r => ['open', 'partial'].includes(r.status))
      .reduce((s, r) => s + Number(r.totalAmount || 0) - Number(r.totalPaid || 0), 0))
    const [{ value: overdueCount }] = await db.select({ value: count() }).from(vendorBill)
      .where(and(eq(vendorBill.companyId, currentUser.companyId), inArray(vendorBill.status, ['open', 'partial']), lt(vendorBill.dueDate, new Date())))
    return one(c, { byStatus, outstanding, overdueCount: Number(overdueCount) })
  })

  /**
   * ONE BILL, WITH THE PAYMENTS MADE AGAINST IT (T34), each naming who recorded it. Declared AFTER `/summary`:
   * Hono matches in registration order, so a `/:id` above it would swallow `/summary`.
   */
  app.get('/:id', async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')

    const [bill] = await db.select().from(vendorBill)
      .where(and(eq(vendorBill.id, id), eq(vendorBill.companyId, currentUser.companyId))).limit(1)
    if (!bill) return fail(c, 404, 'Bill not found')

    const [vendorRow, jobRow, payments] = await Promise.all([
      bill.vendorId
        ? db.select({ id: contact.id, name: contact.name, company: contact.company, email: contact.email })
          .from(contact).where(eq(contact.id, bill.vendorId)).limit(1)
        : Promise.resolve([]),
      bill.jobId
        ? db.select({ id: job.id, number: job.number, title: job.title, projectId: job.projectId })
          .from(job).where(eq(job.id, bill.jobId)).limit(1)
        : Promise.resolve([]),
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
    ]) as any[][]

    const named = payments.map((p: any) => {
      const { recordedByFirst, recordedByLast, recordedByEmail, ...rest } = p
      const full = [recordedByFirst, recordedByLast].filter(Boolean).join(' ').trim()
      return { ...rest, recordedBy: full || recordedByEmail || null }
    })
    const paid = payments.reduce((s: number, p: any) => s + Number(p.amount || 0), 0)
    return one(c, {
      ...bill,
      vendor: vendorRow[0] || null,
      job: jobRow[0] || null,
      payments: named,
      // `paidTotal` sums the PAYMENT ROWS, so it can be compared against the bill's own `amountPaid`.
      paidTotal: Math.round(paid * 100) / 100,
      balance: round2(Number(bill.amount || 0) - Number(bill.amountPaid || 0)),
    })
  })

  // Job-costing roll-up: what we COMMITTED (still outstanding on live POs) vs BILLED vs PAID for one job (T32 M3).
  app.get('/summary/job/:jobId', async (c) => {
    const currentUser = c.get('user') as any
    const jobId = c.req.param('jobId')
    const committed = await jobCommitted(db, currentUser.companyId, jobId, BILL_IS_SPEND)
    const billRow = await jobBilledAndPaid(db, currentUser.companyId, jobId)
    return one(c, {
      committed: Number(committed || 0),
      billed: Number(billRow?.billed || 0),
      paid: Number(billRow?.paid || 0),
    })
  })

  app.post('/', requirePermission('bills:create'), async (c) => {
    const currentUser = c.get('user') as any
    const body = billSchema.safeParse(((await c.req.json().catch(() => null)) ?? {}))
    if (!body.success) return invalid(c, body.error)
    const data = body.data

    const [vendor] = await db.select({ id: contact.id }).from(contact)
      .where(and(eq(contact.id, data.vendorId), eq(contact.companyId, currentUser.companyId))).limit(1)
    if (!vendor) return fail(c, 400, 'Vendor not found')

    let poJobId: string | null = null
    let po: any = null
    if (data.purchaseOrderId) {
      ;[po] = await db.select().from(purchaseOrder)
        .where(and(eq(purchaseOrder.id, data.purchaseOrderId), eq(purchaseOrder.companyId, currentUser.companyId))).limit(1)
      if (!po) return fail(c, 400, 'Purchase order not found')
      poJobId = po.jobId

      // OVER-BILLING A PURCHASE ORDER is refused by default; `allowOverage: true` is the deliberate way through (T32 M3).
      const already = await billedAgainstPurchaseOrder(db, currentUser.companyId, po.id, BILL_IS_SPEND)
      const poTotal = Number(po.total || 0)
      const headroom = Math.round((poTotal - already) * 100) / 100
      if (data.amount > headroom + 0.005 && !data.allowOverage) {
        return fail(c, 409,
          already > 0.005
            ? `${po.number} is for ${poTotal.toFixed(2)} and ${already.toFixed(2)} has already been billed against it, so only ${Math.max(0, headroom).toFixed(2)} is left. This bill is ${data.amount.toFixed(2)}, ${(data.amount - Math.max(0, headroom)).toFixed(2)} over. Record it anyway to bill more than the order.`
            : `${po.number} is for ${poTotal.toFixed(2)} and this bill is ${data.amount.toFixed(2)}, ${(data.amount - poTotal).toFixed(2)} over. Record it anyway to bill more than the order.`,
          'exceeds_purchase_order')
      }
    }

    // A BILL ON A JOB BELONGS TO THAT JOB'S PROJECT (T34): derived from the job unless a project is named.
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
      costCode: data.costCode || null,
    }).returning()

    // …and the commitment is relieved: a PO becomes `billed` the moment bills against it reach its total (T32 M3).
    if (po && ['sent', 'acknowledged', 'received'].includes(po.status)) {
      const billed = await billedAgainstPurchaseOrder(db, currentUser.companyId, po.id, BILL_IS_SPEND)
      if (billed >= Number(po.total || 0) - 0.005) {
        await db.update(purchaseOrder).set({ status: 'billed', updatedAt: new Date() })
          .where(and(eq(purchaseOrder.id, po.id), eq(purchaseOrder.companyId, currentUser.companyId)))
      }
    }

    return one(c, bill, 201)
  })

  app.put('/:id', requirePermission('bills:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = partialOf(billSchema).safeParse(((await c.req.json().catch(() => null)) ?? {}))
    if (!body.success) return invalid(c, body.error)
    const data = body.data

    const [existing] = await db.select().from(vendorBill)
      .where(and(eq(vendorBill.id, id), eq(vendorBill.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Bill not found')
    if (existing.status === 'paid') return fail(c, 400, 'A paid bill can no longer be edited')

    const update: Record<string, any> = { updatedAt: new Date() }
    if (data.vendorId) update.vendorId = data.vendorId
    if (data.number !== undefined) update.number = data.number || null
    if (data.jobId !== undefined) update.jobId = data.jobId || null
    if (data.projectId !== undefined) update.projectId = data.projectId || null
    // The same project inheritance on EDIT, when the caller did not name a project itself (T34).
    if (data.jobId !== undefined && data.projectId === undefined) {
      const inherited = await projectOfJob(currentUser.companyId, data.jobId || null)
      if (inherited) update.projectId = inherited
    }
    if (data.purchaseOrderId !== undefined) update.purchaseOrderId = data.purchaseOrderId || null
    if (data.billDate) update.billDate = new Date(data.billDate)
    if (data.dueDate !== undefined) update.dueDate = data.dueDate ? new Date(data.dueDate) : null
    if (data.amount !== undefined) {
      // A bill cannot be worth less than has already been paid on it (T32 H8).
      const paid = Number(existing.amountPaid)
      if (data.amount + 0.005 < paid) {
        return fail(c, 400,
          `${paid.toFixed(2)} has already been paid on this bill, so it cannot be changed to ${data.amount.toFixed(2)}. Record a credit from the vendor instead.`,
          'below_amount_paid')
      }
      update.amount = data.amount.toFixed(2)
      // Lowering the amount to exactly what was paid settles it; raising it reopens a settled bill.
      update.status = data.amount <= paid + 0.005 && paid > 0 ? 'paid' : (paid > 0 ? 'partial' : existing.status)
      update.paidAt = update.status === 'paid' ? (existing.paidAt ?? new Date()) : null
    }
    if (data.fileUrl !== undefined) update.fileUrl = data.fileUrl || null
    if (data.notes !== undefined) update.notes = data.notes || null
    if (data.costCode !== undefined) update.costCode = data.costCode || null

    const [updated] = await db.update(vendorBill).set(update).where(eq(vendorBill.id, id)).returning()
    return one(c, updated)
  })

  app.post('/:id/record-payment', requirePermission('bills:pay'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = z.object({
      amount: z.number().positive(),
      method: z.string().max(40).optional(),
      reference: z.string().max(120).optional(),
      notes: z.string().max(1000).optional(),
    }).safeParse(((await c.req.json().catch(() => null)) ?? {}))
    if (!body.success) return fail(c, 400, 'A positive payment amount is required')

    /**
     * Under a row lock, with a ledger row (T32 B4): read-modify-write under SELECT … FOR UPDATE inside one
     * transaction, the ledger row written in the SAME transaction, so concurrent payments can't overwrite each
     * other and a payment never exists without its total moving.
     */
    const outcome = await db.transaction(async (tx: any) => {
      const existing = await lockBill(tx, id, currentUser.companyId)
      if (!existing) return { status: 404 as const, error: 'Bill not found' }
      if (existing.status === 'void') return { status: 400 as const, error: 'This bill is void' }

      const amount = body.data.amount
      const alreadyPaid = Number(existing.amountPaid)
      const total = Number(existing.amount)
      const newPaid = Math.round((alreadyPaid + amount) * 100) / 100
      if (newPaid > total + 0.005) {
        return { status: 400 as const, error: `Payment exceeds the bill balance (${(total - alreadyPaid).toFixed(2)} remaining)` }
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
      if (fullyPaid && existing.purchaseOrderId) {
        await tx.update(purchaseOrder).set({ status: 'billed', updatedAt: new Date() })
          .where(and(eq(purchaseOrder.id, existing.purchaseOrderId), eq(purchaseOrder.companyId, currentUser.companyId)))
      }
      return { status: 200 as const, record: { ...updated, payment: recorded } }
    })
    if (outcome.status !== 200) return fail(c, outcome.status, outcome.error)
    return one(c, outcome.record)
  })

  app.post('/:id/void', requirePermission('bills:pay'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [existing] = await db.select().from(vendorBill)
      .where(and(eq(vendorBill.id, id), eq(vendorBill.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Bill not found')
    if (existing.status === 'paid') return fail(c, 400, 'A paid bill cannot be voided')
    const [updated] = await db.update(vendorBill).set({ status: 'void', updatedAt: new Date() })
      .where(eq(vendorBill.id, id)).returning()
    return one(c, updated)
  })

  app.delete('/:id', requirePermission('bills:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [existing] = await db.select().from(vendorBill)
      .where(and(eq(vendorBill.id, id), eq(vendorBill.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Bill not found')
    if (Number(existing.amountPaid) > 0) return fail(c, 400, 'A bill with recorded payments cannot be deleted — void it instead')
    await db.delete(vendorBill).where(eq(vendorBill.id, id))
    return c.body(null, 204)
  })

  return app
}

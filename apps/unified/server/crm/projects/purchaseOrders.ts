// Purchase orders: what the company commits to spend with a vendor, per job/project. Lifecycle draft → sent →
// acknowledged | declined → received → billed; cancelled from anywhere. Vendors acknowledge/decline through the
// vendor portal; everything here is owner-side. Moved from templates/crm/backend/src/routes/purchaseOrders.ts.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, count, desc, inArray } from 'drizzle-orm'
import { nextNumber } from '@twomiah/tenant-backend'
import { jobPurchaseOrder as purchaseOrder, jobPurchaseOrderLine as purchaseOrderLine, vendorBill, contact, job } from '../../db/schema/index.ts'
import { purchaseOrderTotalsByStatus, openCommitted } from '../../data/purchaseOrders.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'
import { partialOf } from '@twomiah/tenant-backend'

const lineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive().default(1),
  unitCost: z.number().min(0).default(0),
})

const poSchema = z.object({
  vendorId: z.string().min(1),
  jobId: z.string().optional(),
  projectId: z.string().optional(),
  issueDate: z.string().optional(),
  expectedDate: z.string().optional(),
  shipTo: z.string().optional(),
  taxRate: z.number().min(0).max(100).default(0),
  notes: z.string().optional(),
  // Accepted so PUT {status} isn't a silent no-op (API-02); guided transitions still use /:id/action.
  status: z.enum(['draft', 'sent', 'acknowledged', 'declined', 'received', 'billed', 'cancelled']).optional(),
  lines: z.array(lineSchema).min(1),
})

function computeTotals(lines: Array<{ quantity: number; unitCost: number }>, taxRate: number) {
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitCost, 0)
  const taxAmount = subtotal * (taxRate / 100)
  return { subtotal, taxAmount, total: subtotal + taxAmount }
}

// Explicit transitions rather than a free-form status field, so the lifecycle can't be driven backwards.
const TRANSITIONS: Record<string, string[]> = {
  send: ['draft'],
  receive: ['sent', 'acknowledged'],
  cancel: ['draft', 'sent', 'acknowledged', 'declined'],
  reopen: ['cancelled'],
}
const TARGET: Record<string, string> = { send: 'sent', receive: 'received', cancel: 'cancelled', reopen: 'draft' }

export function createPurchaseOrderRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  // Reads are checked against the matrix too: this is committed spend with vendors (T32 H1).
  app.use('*', requirePermission('purchase-orders:read'))

  async function hydrate(rows: any[], companyId: string) {
    const vendorIds = [...new Set(rows.filter(r => r.vendorId).map(r => r.vendorId))]
    const jobIds = [...new Set(rows.filter(r => r.jobId).map(r => r.jobId))]
    const [vendors, jobs] = await Promise.all([
      vendorIds.length ? db.select({ id: contact.id, name: contact.name, company: contact.company }).from(contact).where(and(eq(contact.companyId, companyId), inArray(contact.id, vendorIds))) : Promise.resolve([]),
      jobIds.length ? db.select({ id: job.id, title: job.title }).from(job).where(and(eq(job.companyId, companyId), inArray(job.id, jobIds))) : Promise.resolve([]),
    ]) as any[][]
    const vMap = Object.fromEntries(vendors.map(v => [v.id, v]))
    const jMap = Object.fromEntries(jobs.map(j => [j.id, j]))
    return rows.map(r => ({ ...r, vendor: r.vendorId ? vMap[r.vendorId] || null : null, job: r.jobId ? jMap[r.jobId] || null : null }))
  }

  app.get('/', async (c) => {
    const currentUser = c.get('user') as any
    const status = c.req.query('status')
    const jobId = c.req.query('jobId')
    const vendorId = c.req.query('vendorId')
    const page = +(c.req.query('page') || '1')
    const limit = +(c.req.query('limit') || '50')

    const conditions = [eq(purchaseOrder.companyId, currentUser.companyId)]
    if (status) conditions.push(eq(purchaseOrder.status, status))
    if (jobId) conditions.push(eq(purchaseOrder.jobId, jobId))
    if (vendorId) conditions.push(eq(purchaseOrder.vendorId, vendorId))
    const where = and(...conditions)

    const [rows, [{ value: total }]] = await Promise.all([
      db.select().from(purchaseOrder).where(where).orderBy(desc(purchaseOrder.createdAt)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(purchaseOrder).where(where),
    ])
    const data = await hydrate(rows, currentUser.companyId)
    return list(c, data, { page, limit, total: Number(total) })
  })

  app.get('/summary', async (c) => {
    const currentUser = c.get('user') as any
    const rows = await purchaseOrderTotalsByStatus(db, currentUser.companyId)
    const byStatus = Object.fromEntries(rows.map(r => [r.status, { amount: Number(r.totalAmount || 0), count: r.cnt }]))
    // OPEN COMMITTED is what is still OUTSTANDING after the bills against each order, not face value (T32 M3).
    const outstanding = await openCommitted(db, currentUser.companyId)
    return one(c, {
      byStatus,
      openCommitted: Math.round(Number(outstanding || 0) * 100) / 100,
      /** The face value of live orders, kept beside it so the two can be reconciled. */
      orderedValue: rows.filter(r => !['draft', 'cancelled', 'declined'].includes(r.status))
        .reduce((s, r) => s + Number(r.totalAmount || 0), 0),
    })
  })

  app.get('/:id', async (c) => {
    const currentUser = c.get('user') as any
    const [po] = await db.select().from(purchaseOrder)
      .where(and(eq(purchaseOrder.id, c.req.param('id')), eq(purchaseOrder.companyId, currentUser.companyId))).limit(1)
    if (!po) return fail(c, 404, 'Purchase order not found')
    const lines = await db.select().from(purchaseOrderLine)
      .where(eq(purchaseOrderLine.purchaseOrderId, po.id)).orderBy(purchaseOrderLine.sortOrder)
    const [hydrated] = await hydrate([po], currentUser.companyId)
    return one(c, { ...hydrated, lines })
  })

  app.post('/', requirePermission('purchase-orders:create'), async (c) => {
    const currentUser = c.get('user') as any
    const body = poSchema.safeParse(((await c.req.json().catch(() => null)) ?? {}))
    if (!body.success) return invalid(c, body.error)
    const data = body.data

    // The vendor must belong to this company.
    const [vendor] = await db.select({ id: contact.id }).from(contact)
      .where(and(eq(contact.id, data.vendorId), eq(contact.companyId, currentUser.companyId))).limit(1)
    if (!vendor) return fail(c, 400, 'Vendor not found')

    const totals = computeTotals(data.lines, data.taxRate)

    // PO numbers only go forwards, taken inside the insert's own transaction where the lock holds (T58k). The
    // lines come with the order: a PO that commits without them is an empty order sent to a supplier.
    const po = await db.transaction(async (tx: any) => {
      const number = await nextNumber(tx, purchaseOrder, purchaseOrder.number, purchaseOrder.companyId, currentUser.companyId, { prefix: 'PO', pad: 5 })
      const [row] = await tx.insert(purchaseOrder).values({
        number,
        companyId: currentUser.companyId,
        vendorId: data.vendorId,
        jobId: data.jobId || null,
        projectId: data.projectId || null,
        issueDate: data.issueDate ? new Date(data.issueDate) : new Date(),
        expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
        shipTo: data.shipTo || null,
        taxRate: String(data.taxRate),
        subtotal: totals.subtotal.toFixed(2),
        taxAmount: totals.taxAmount.toFixed(2),
        total: totals.total.toFixed(2),
        notes: data.notes || null,
        createdById: currentUser.userId,
      }).returning()

      await tx.insert(purchaseOrderLine).values(data.lines.map((l, i) => ({
        purchaseOrderId: row.id,
        description: l.description,
        quantity: String(l.quantity),
        unitCost: l.unitCost.toFixed(2),
        total: (l.quantity * l.unitCost).toFixed(2),
        sortOrder: i,
      })))
      return row
    })

    return one(c, po, 201)
  })

  app.put('/:id', requirePermission('purchase-orders:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = partialOf(poSchema).safeParse(((await c.req.json().catch(() => null)) ?? {}))
    if (!body.success) return invalid(c, body.error)
    const data = body.data

    const [existing] = await db.select().from(purchaseOrder)
      .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Purchase order not found')
    if (!['draft', 'sent'].includes(existing.status)) {
      return fail(c, 400, `A ${existing.status} purchase order can no longer be edited`)
    }

    const update: Record<string, any> = { updatedAt: new Date() }
    if (data.vendorId) update.vendorId = data.vendorId
    if (data.jobId !== undefined) update.jobId = data.jobId || null
    if (data.projectId !== undefined) update.projectId = data.projectId || null
    if (data.issueDate) update.issueDate = new Date(data.issueDate)
    if (data.expectedDate !== undefined) update.expectedDate = data.expectedDate ? new Date(data.expectedDate) : null
    if (data.shipTo !== undefined) update.shipTo = data.shipTo || null
    if (data.notes !== undefined) update.notes = data.notes || null
    if (data.status) update.status = data.status

    const taxRate = data.taxRate !== undefined ? data.taxRate : Number(existing.taxRate)
    if (data.taxRate !== undefined) update.taxRate = String(data.taxRate)

    if (data.lines) {
      const totals = computeTotals(data.lines, taxRate)
      update.subtotal = totals.subtotal.toFixed(2)
      update.taxAmount = totals.taxAmount.toFixed(2)
      update.total = totals.total.toFixed(2)
      await db.delete(purchaseOrderLine).where(eq(purchaseOrderLine.purchaseOrderId, id))
      await db.insert(purchaseOrderLine).values(data.lines.map((l, i) => ({
        purchaseOrderId: id,
        description: l.description,
        quantity: String(l.quantity),
        unitCost: l.unitCost.toFixed(2),
        total: (l.quantity * l.unitCost).toFixed(2),
        sortOrder: i,
      })))
    }

    const [updated] = await db.update(purchaseOrder).set(update).where(eq(purchaseOrder.id, id)).returning()
    return one(c, updated)
  })

  for (const action of Object.keys(TRANSITIONS)) {
    app.post(`/:id/${action}`, requirePermission('purchase-orders:update'), async (c) => {
      const currentUser = c.get('user') as any
      const id = c.req.param('id')
      const [existing] = await db.select().from(purchaseOrder)
        .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.companyId, currentUser.companyId))).limit(1)
      if (!existing) return fail(c, 404, 'Purchase order not found')
      if (!TRANSITIONS[action].includes(existing.status)) {
        return fail(c, 400, `Cannot ${action} a ${existing.status} purchase order`)
      }
      const [updated] = await db.update(purchaseOrder)
        .set({ status: TARGET[action], updatedAt: new Date() })
        .where(eq(purchaseOrder.id, id)).returning()
      return one(c, updated)
    })
  }

  app.delete('/:id', requirePermission('purchase-orders:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [existing] = await db.select().from(purchaseOrder)
      .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Purchase order not found')
    if (existing.status !== 'draft') return fail(c, 400, 'Only draft purchase orders can be deleted — cancel instead')
    const [{ value: billCount }] = await db.select({ value: count() }).from(vendorBill).where(eq(vendorBill.purchaseOrderId, id))
    if (Number(billCount) > 0) return fail(c, 400, 'A bill references this purchase order')
    await db.delete(purchaseOrder).where(eq(purchaseOrder.id, id))
    return c.body(null, 204)
  })

  return app
}

/**
 * Purchase Orders — what we commit to spend with a vendor, per job/project.
 * Lifecycle: draft -> sent -> acknowledged | declined -> received -> billed;
 * cancelled from anywhere. Vendors acknowledge/decline through the vendor
 * portal (routes/vendorPortal.ts); everything here is owner-side.
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { jobPurchaseOrder as purchaseOrder, jobPurchaseOrderLine as purchaseOrderLine, vendorBill, contact, job, project } from '../../db/schema.ts'
import { eq, and, count, desc, sql, inArray } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

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
  lines: z.array(lineSchema).min(1),
})

const STATUSES = ['draft', 'sent', 'acknowledged', 'declined', 'received', 'billed', 'cancelled'] as const

function computeTotals(lines: Array<{ quantity: number; unitCost: number }>, taxRate: number) {
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitCost, 0)
  const taxAmount = subtotal * (taxRate / 100)
  return { subtotal, taxAmount, total: subtotal + taxAmount }
}

async function hydrate(rows: any[], companyId: string) {
  const vendorIds = [...new Set(rows.filter(r => r.vendorId).map(r => r.vendorId))]
  const jobIds = [...new Set(rows.filter(r => r.jobId).map(r => r.jobId))]
  const [vendors, jobs] = await Promise.all([
    vendorIds.length ? db.select({ id: contact.id, name: contact.name, company: contact.company }).from(contact).where(and(eq(contact.companyId, companyId), inArray(contact.id, vendorIds))) : Promise.resolve([]),
    jobIds.length ? db.select({ id: job.id, title: job.title }).from(job).where(and(eq(job.companyId, companyId), inArray(job.id, jobIds))) : Promise.resolve([]),
  ])
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
  return c.json({ data, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

app.get('/summary', async (c) => {
  const currentUser = c.get('user') as any
  const rows = await db.select({
    status: purchaseOrder.status,
    totalAmount: sql<string>`sum(${purchaseOrder.total})`,
    cnt: count(),
  }).from(purchaseOrder).where(eq(purchaseOrder.companyId, currentUser.companyId)).groupBy(purchaseOrder.status)
  const byStatus = Object.fromEntries(rows.map(r => [r.status, { amount: Number(r.totalAmount || 0), count: r.cnt }]))
  // A draft PO is not yet committed — exclude it (and terminal statuses) from
  // the "open committed" total, which was counting drafts as commitments.
  const open = rows.filter(r => !['draft', 'billed', 'cancelled', 'declined'].includes(r.status))
    .reduce((s, r) => s + Number(r.totalAmount || 0), 0)
  return c.json({ byStatus, openCommitted: open })
})

app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const [po] = await db.select().from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, c.req.param('id')), eq(purchaseOrder.companyId, currentUser.companyId))).limit(1)
  if (!po) return c.json({ error: 'Purchase order not found' }, 404)
  const lines = await db.select().from(purchaseOrderLine)
    .where(eq(purchaseOrderLine.purchaseOrderId, po.id)).orderBy(purchaseOrderLine.sortOrder)
  const [hydrated] = await hydrate([po], currentUser.companyId)
  return c.json({ ...hydrated, lines })
})

app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const body = poSchema.safeParse(((await c.req.json().catch(() => null)) ?? {}))
  if (!body.success) return c.json({ error: body.error.issues[0]?.message || 'Invalid purchase order' }, 400)
  const data = body.data

  // verify the vendor belongs to this company
  const [vendor] = await db.select({ id: contact.id }).from(contact)
    .where(and(eq(contact.id, data.vendorId), eq(contact.companyId, currentUser.companyId))).limit(1)
  if (!vendor) return c.json({ error: 'Vendor not found' }, 400)

  const [{ value: existing }] = await db.select({ value: count() }).from(purchaseOrder)
    .where(eq(purchaseOrder.companyId, currentUser.companyId))
  const number = `PO-${String(Number(existing) + 1).padStart(5, '0')}`
  const totals = computeTotals(data.lines, data.taxRate)

  const [po] = await db.insert(purchaseOrder).values({
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
    createdById: currentUser.id,
  }).returning()

  await db.insert(purchaseOrderLine).values(data.lines.map((l, i) => ({
    purchaseOrderId: po.id,
    description: l.description,
    quantity: String(l.quantity),
    unitCost: l.unitCost.toFixed(2),
    total: (l.quantity * l.unitCost).toFixed(2),
    sortOrder: i,
  })))

  return c.json(po, 201)
})

app.put('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = poSchema.partial().safeParse(((await c.req.json().catch(() => null)) ?? {}))
  if (!body.success) return c.json({ error: body.error.issues[0]?.message || 'Invalid purchase order' }, 400)
  const data = body.data

  const [existing] = await db.select().from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Purchase order not found' }, 404)
  if (!['draft', 'sent'].includes(existing.status)) {
    return c.json({ error: `A ${existing.status} purchase order can no longer be edited` }, 400)
  }

  const update: Record<string, any> = { updatedAt: new Date() }
  if (data.vendorId) update.vendorId = data.vendorId
  if (data.jobId !== undefined) update.jobId = data.jobId || null
  if (data.projectId !== undefined) update.projectId = data.projectId || null
  if (data.issueDate) update.issueDate = new Date(data.issueDate)
  if (data.expectedDate !== undefined) update.expectedDate = data.expectedDate ? new Date(data.expectedDate) : null
  if (data.shipTo !== undefined) update.shipTo = data.shipTo || null
  if (data.notes !== undefined) update.notes = data.notes || null

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
  return c.json(updated)
})

// Explicit transitions rather than a free-form status field, so the
// lifecycle can't be driven backwards from the UI.
const TRANSITIONS: Record<string, string[]> = {
  send: ['draft'],
  receive: ['sent', 'acknowledged'],
  cancel: ['draft', 'sent', 'acknowledged', 'declined'],
  reopen: ['cancelled'],
}
const TARGET: Record<string, string> = { send: 'sent', receive: 'received', cancel: 'cancelled', reopen: 'draft' }

for (const action of Object.keys(TRANSITIONS)) {
  app.post(`/:id/${action}`, async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [existing] = await db.select().from(purchaseOrder)
      .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.companyId, currentUser.companyId))).limit(1)
    if (!existing) return c.json({ error: 'Purchase order not found' }, 404)
    if (!TRANSITIONS[action].includes(existing.status)) {
      return c.json({ error: `Cannot ${action} a ${existing.status} purchase order` }, 400)
    }
    const [updated] = await db.update(purchaseOrder)
      .set({ status: TARGET[action], updatedAt: new Date() })
      .where(eq(purchaseOrder.id, id)).returning()
    return c.json(updated)
  })
}

app.delete('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const [existing] = await db.select().from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, id), eq(purchaseOrder.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Purchase order not found' }, 404)
  if (existing.status !== 'draft') return c.json({ error: 'Only draft purchase orders can be deleted — cancel instead' }, 400)
  const [{ value: billCount }] = await db.select({ value: count() }).from(vendorBill).where(eq(vendorBill.purchaseOrderId, id))
  if (Number(billCount) > 0) return c.json({ error: 'A bill references this purchase order' }, 400)
  await db.delete(purchaseOrder).where(eq(purchaseOrder.id, id))
  return c.body(null, 204)
})

export default app

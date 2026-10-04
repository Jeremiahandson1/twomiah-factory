import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { material, job } from '../../db/schema.ts'
import { eq, and, desc, count } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission, hasPermission, getExtraPermissions } from '../middleware/permissions.ts'
import { lineItemInput, normaliseLineItems, materialOrderStatus, optional } from '../lib/validation.ts'

const app = new Hono()
app.use('*', authenticate)

/**
 * A material order's COST is money, and both reads handed it to anybody who could open the screen.
 * (T42, Roofing HIGH — "Materials shows Total Cost".) Every write here asks for an inventory
 * permission; neither read asked for anything, so a viewer read the supplier's prices off the list.
 *
 * It is gated on the question roof's job and invoice reads already ask — `invoices:read` — and not on
 * an inventory permission, because knowing WHAT is on the truck is the part of this screen a crew lead
 * needs and `inventory:read` is exactly that permission. So the prices go and nothing else does: the
 * description, quantity and unit stay, and the order still reads as an order.
 */
const MATERIAL_MONEY = ['totalCost'] as const

/** The money inside a line item. The canonical line is {code?, description, qty, unit, unitPrice, total}. */
const MATERIAL_LINE_MONEY = ['unitPrice', 'total'] as const

/** A material row with the prices removed — the order's own total and each line's. Used by BOTH reads. */
const withoutMaterialMoney = (row: any) => {
  const out = { ...row }
  for (const f of MATERIAL_MONEY) delete out[f]
  if (Array.isArray(out.lineItems)) {
    out.lineItems = out.lineItems.map((li: any) => {
      const line = { ...li }
      for (const f of MATERIAL_LINE_MONEY) delete line[f]
      return line
    })
  }
  return out
}

// N1: the write schema and the read shape disagreed, silently.
//
// It demanded `quantity` and `unitCost`; the seed, the list page and every other module use `qty`,
// `unit`, `unitPrice`, `total`. Posting the documented shape returned 201 with the line item reduced
// to {description, quantity} — the prices simply stripped — and `totalCost` was only stored if the
// client sent it separately, never computed, so a $2,880 order listed with a blank Total Cost.
// Sending `qty` instead was refused outright, so no single payload satisfied both ends.
//
// Both spellings are accepted now and normalised to the canonical shape; the money is computed here.
const materialSchema = z.object({
  jobId: z.string().min(1),
  supplier: z.string().min(1),
  // was a free string, so `status: 'banana'` stored as not_ordered with a 201 — and the caller was
  // never told they had named the wrong field
  orderStatus: optional(materialOrderStatus),
  orderDate: z.string().optional(),
  deliveryDate: z.string().optional(),
  lineItems: z.array(lineItemInput).min(1),
  totalCost: z.number().optional(),
  supplierOrderNumber: z.string().optional(),
  deliveryAddress: z.string().optional(),
  notes: z.string().optional(),
})

// List materials with filters
app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const supplier = c.req.query('supplier')
  // The UI sends ?status=; the column is orderStatus. Accept either.
  const orderStatus = c.req.query('orderStatus') || c.req.query('status')
  const jobId = c.req.query('jobId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions: any[] = [eq(material.companyId, currentUser.companyId)]
  if (supplier) conditions.push(eq(material.supplier, supplier))
  if (orderStatus) conditions.push(eq(material.orderStatus, orderStatus))
  if (jobId) conditions.push(eq(material.jobId, jobId))

  const where = and(...conditions)
  const [rows, [{ value: total }]] = await Promise.all([
    db.select({ material, jobNumber: job.jobNumber }).from(material)
      .leftJoin(job, eq(material.jobId, job.id))
      .where(where).orderBy(desc(material.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(material).where(where),
  ])

  // Surface the real job number (not the raw id) and expose orderStatus as
  // `status` too, which is what the list reads.
  const data = rows.map((r: any) => ({ ...r.material, jobNumber: r.jobNumber, status: r.material.orderStatus }))

  // `moneyWithheld` so the SCREEN can drop the Total Cost column rather than print "$0" or "—" for a
  // real order — T42 calls that out fleet-wide ("Hidden money shown as $0 instead of hidden").
  const maySeeCost = hasPermission(currentUser?.role, 'invoices:read', await getExtraPermissions(currentUser?.userId))

  return c.json({
    data: maySeeCost ? data : data.map(withoutMaterialMoney),
    ...(maySeeCost ? {} : { moneyWithheld: true }),
    pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) },
  })
})

// Create material order
app.post('/', requirePermission('inventory:create'), async (c) => {
  const currentUser = c.get('user') as any
  const data = materialSchema.parse(await c.req.json())
  // the client's `totalCost` is accepted for compatibility and then ignored — the order is worth what
  // its line items are worth
  const { lineItems, total } = normaliseLineItems(data.lineItems)

  const [newMaterial] = await db.insert(material).values({
    companyId: currentUser.companyId,
    jobId: data.jobId,
    supplier: data.supplier,
    orderStatus: data.orderStatus || 'not_ordered',
    orderDate: data.orderDate ? new Date(data.orderDate) : null,
    deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
    lineItems,
    totalCost: total.toFixed(2),
    supplierOrderNumber: data.supplierOrderNumber,
    deliveryAddress: data.deliveryAddress,
    notes: data.notes,
  }).returning()

  return c.json(newMaterial, 201)
})

// Get material detail
app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [found] = await db.select().from(material)
    .where(and(eq(material.id, id), eq(material.companyId, currentUser.companyId)))
    .limit(1)
  if (!found) return c.json({ error: 'Material order not found' }, 404)

  const maySeeCost = hasPermission(currentUser?.role, 'invoices:read', await getExtraPermissions(currentUser?.userId))
  if (!maySeeCost) return c.json({ ...withoutMaterialMoney(found), moneyWithheld: true })

  return c.json(found)
})

// Update material
app.put('/:id', requirePermission('inventory:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = materialSchema.partial().parse(await c.req.json())

  const [existing] = await db.select().from(material)
    .where(and(eq(material.id, id), eq(material.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Material order not found' }, 404)

  const updateData: Record<string, any> = { ...data, updatedAt: new Date() }
  if (data.orderDate) updateData.orderDate = new Date(data.orderDate)
  if (data.deliveryDate) updateData.deliveryDate = new Date(data.deliveryDate)
  // Same rule as create: the line items are the money. An edit that changes them recomputes the
  // total, and the client's `totalCost` is never what gets stored.
  delete updateData.totalCost
  if (data.lineItems) {
    const { lineItems, total } = normaliseLineItems(data.lineItems)
    updateData.lineItems = lineItems
    updateData.totalCost = total.toFixed(2)
  }

  const [updated] = await db.update(material).set(updateData).where(eq(material.id, id)).returning()
  return c.json(updated)
})

// Delete material
app.delete('/:id', requirePermission('inventory:delete'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(material)
    .where(and(eq(material.id, id), eq(material.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Material order not found' }, 404)

  await db.delete(material).where(eq(material.id, id))
  return c.body(null, 204)
})

export default app

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { material } from '../../db/schema.ts'
import { eq, and, desc, count } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

const materialSchema = z.object({
  jobId: z.string().min(1),
  supplier: z.string().min(1),
  orderStatus: z.string().optional(),
  orderDate: z.string().optional(),
  deliveryDate: z.string().optional(),
  lineItems: z.array(z.object({
    description: z.string().min(1),
    quantity: z.number(),
    unit: z.string().optional(),
    unitCost: z.number().optional(),
  })),
  totalCost: z.number().optional(),
  supplierOrderNumber: z.string().optional(),
  deliveryAddress: z.string().optional(),
  notes: z.string().optional(),
})

// List materials with filters
app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const supplier = c.req.query('supplier')
  const orderStatus = c.req.query('orderStatus')
  const jobId = c.req.query('jobId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions: any[] = [eq(material.companyId, currentUser.companyId)]
  if (supplier) conditions.push(eq(material.supplier, supplier))
  if (orderStatus) conditions.push(eq(material.orderStatus, orderStatus))
  if (jobId) conditions.push(eq(material.jobId, jobId))

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(material).where(where).orderBy(desc(material.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(material).where(where),
  ])

  return c.json({ data, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

// Create material order
app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const data = materialSchema.parse(await c.req.json())

  const [newMaterial] = await db.insert(material).values({
    companyId: currentUser.companyId,
    jobId: data.jobId,
    supplier: data.supplier,
    orderStatus: data.orderStatus || 'not_ordered',
    orderDate: data.orderDate ? new Date(data.orderDate) : null,
    deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
    lineItems: data.lineItems,
    totalCost: data.totalCost?.toString(),
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

  return c.json(found)
})

// Update material
app.put('/:id', async (c) => {
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
  if (data.totalCost !== undefined) updateData.totalCost = data.totalCost.toString()

  const [updated] = await db.update(material).set(updateData).where(eq(material.id, id)).returning()
  return c.json(updated)
})

// Delete material
app.delete('/:id', async (c) => {
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

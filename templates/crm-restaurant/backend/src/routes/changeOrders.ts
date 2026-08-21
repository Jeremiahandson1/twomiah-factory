import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { changeOrder, changeOrderLineItem, project } from '../../db/schema.ts'
import { eq, and, count, desc, asc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

const lineItemSchema = z.object({ description: z.string().min(1), quantity: z.number().default(1), unitPrice: z.number().default(0) })
const changeOrderSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  projectId: z.string(),
  reason: z.string().optional(),
  daysAdded: z.number().default(0),
  lineItems: z.array(lineItemSchema).default([]),
})

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const projectId = c.req.query('projectId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions = [eq(changeOrder.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(changeOrder.status, status))
  if (projectId) conditions.push(eq(changeOrder.projectId, projectId))

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(changeOrder).where(where).orderBy(desc(changeOrder.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(changeOrder).where(where),
  ])

  // Fetch related projects and line items
  const coIds = data.map(co => co.id)
  const projectIds = [...new Set(data.map(co => co.projectId))]

  const [projects, lineItems] = await Promise.all([
    projectIds.length ? db.select({ id: project.id, name: project.name }).from(project).where(eq(project.companyId, currentUser.companyId)) : Promise.resolve([]),
    (async () => {
      const allItems: (typeof changeOrderLineItem.$inferSelect)[] = []
      for (const coid of coIds) {
        const items = await db.select().from(changeOrderLineItem).where(eq(changeOrderLineItem.changeOrderId, coid))
        allItems.push(...items)
      }
      return allItems
    })(),
  ])

  const projectMap = Object.fromEntries(projects.map(p => [p.id, p]))
  const lineItemMap: Record<string, (typeof changeOrderLineItem.$inferSelect)[]> = {}
  lineItems.forEach(li => { (lineItemMap[li.changeOrderId] ||= []).push(li) })

  const dataWithRelations = data.map(co => ({
    ...co,
    project: projectMap[co.projectId] || null,
    lineItems: lineItemMap[co.id] || [],
  }))

  return c.json({ data: dataWithRelations, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [foundCo] = await db.select().from(changeOrder).where(and(eq(changeOrder.id, id), eq(changeOrder.companyId, currentUser.companyId))).limit(1)
  if (!foundCo) return c.json({ error: 'Change order not found' }, 404)

  const [coProject, lineItems] = await Promise.all([
    db.select().from(project).where(eq(project.id, foundCo.projectId)).limit(1),
    db.select().from(changeOrderLineItem).where(eq(changeOrderLineItem.changeOrderId, id)).orderBy(asc(changeOrderLineItem.sortOrder)),
  ])

  return c.json({ ...foundCo, project: coProject[0] || null, lineItems })
})

app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const data = changeOrderSchema.parse(await c.req.json())
  const { lineItems, ...coData } = data

  const amount = lineItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const [{ value: cnt }] = await db.select({ value: count() }).from(changeOrder).where(and(eq(changeOrder.companyId, currentUser.companyId), eq(changeOrder.projectId, data.projectId)))

  const [newCo] = await db.insert(changeOrder).values({
    ...coData,
    number: `CO-${String(Number(cnt) + 1).padStart(3, '0')}`,
    amount: amount.toString(),
    companyId: currentUser.companyId,
  }).returning()

  const insertedLineItems = lineItems.length > 0
    ? await db.insert(changeOrderLineItem).values(lineItems.map((item, i) => ({
        ...item,
        quantity: item.quantity.toString(),
        unitPrice: item.unitPrice.toString(),
        total: (item.quantity * item.unitPrice).toString(),
        sortOrder: i,
        changeOrderId: newCo.id,
      }))).returning()
    : []

  return c.json({ ...newCo, lineItems: insertedLineItems }, 201)
})

app.put('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = changeOrderSchema.partial().parse(await c.req.json())
  const { lineItems, ...coData } = data

  const [existing] = await db.select().from(changeOrder).where(and(eq(changeOrder.id, id), eq(changeOrder.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Change order not found' }, 404)

  let amount = Number(existing.amount)
  if (lineItems) {
    await db.delete(changeOrderLineItem).where(eq(changeOrderLineItem.changeOrderId, id))
    amount = lineItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  }

  const [updated] = await db.update(changeOrder).set({ ...coData, amount: amount.toString(), updatedAt: new Date() }).where(eq(changeOrder.id, id)).returning()

  let insertedLineItems: (typeof changeOrderLineItem.$inferSelect)[] = []
  if (lineItems && lineItems.length > 0) {
    insertedLineItems = await db.insert(changeOrderLineItem).values(lineItems.map((item, i) => ({
      ...item,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
      total: (item.quantity * item.unitPrice).toString(),
      sortOrder: i,
      changeOrderId: id,
    }))).returning()
  }

  const result = { ...updated, lineItems: insertedLineItems.length > 0 ? insertedLineItems : await db.select().from(changeOrderLineItem).where(eq(changeOrderLineItem.changeOrderId, id)) }
  return c.json(result)
})

app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await db.delete(changeOrder).where(eq(changeOrder.id, id))
  return c.body(null, 204)
})

app.post('/:id/submit', async (c) => {
  const id = c.req.param('id')
  const [updated] = await db.update(changeOrder).set({ status: 'submitted', submittedDate: new Date(), updatedAt: new Date() }).where(eq(changeOrder.id, id)).returning()
  return c.json(updated)
})

app.post('/:id/approve', async (c) => {
  const id = c.req.param('id')
  const { approvedBy } = await c.req.json()
  const [updated] = await db.update(changeOrder).set({ status: 'approved', approvedDate: new Date(), approvedBy, updatedAt: new Date() }).where(eq(changeOrder.id, id)).returning()
  return c.json(updated)
})

app.post('/:id/reject', async (c) => {
  const id = c.req.param('id')
  const [updated] = await db.update(changeOrder).set({ status: 'rejected', updatedAt: new Date() }).where(eq(changeOrder.id, id)).returning()
  return c.json(updated)
})

export default app

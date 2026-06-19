/**
 * Lien Waivers — Construction tier feature.
 *
 * Lien waivers are documents a contractor/sub/supplier signs to waive their
 * right to file a mechanic's lien in exchange for payment. Required at
 * nearly every construction payment cycle. Four standard types:
 *   - Conditional Waiver on Progress Payment
 *   - Unconditional Waiver on Progress Payment
 *   - Conditional Waiver on Final Payment
 *   - Unconditional Waiver on Final Payment
 *
 * The `lien_waiver` table was already in db/schema.ts without a route;
 * this file is the missing CRUD + workflow API.
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { lienWaiver, project, contact } from '../../db/schema.ts'
import { eq, and, count, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

const WAIVER_TYPES = [
  'conditional_progress',
  'unconditional_progress',
  'conditional_final',
  'unconditional_final',
] as const

const lienWaiverSchema = z.object({
  projectId: z.string(),
  vendorId: z.string().optional(),
  vendorName: z.string().min(1),
  vendorType: z.enum(['contractor', 'subcontractor', 'supplier', 'laborer', 'other']).optional(),
  waiverType: z.enum(WAIVER_TYPES),
  throughDate: z.string().optional(),
  amountPrevious: z.number().default(0),
  amountCurrent: z.number().default(0),
  amountTotal: z.number().default(0),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
})

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const projectId = c.req.query('projectId')
  const waiverType = c.req.query('waiverType')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions = [eq(lienWaiver.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(lienWaiver.status, status))
  if (projectId) conditions.push(eq(lienWaiver.projectId, projectId))
  if (waiverType) conditions.push(eq(lienWaiver.waiverType, waiverType))

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(lienWaiver).where(where).orderBy(desc(lienWaiver.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(lienWaiver).where(where),
  ])

  // Enrich with project + vendor
  const projectIds = [...new Set(data.map((w) => w.projectId).filter(Boolean))]
  const vendorIds = [...new Set(data.map((w) => w.vendorId).filter(Boolean) as string[])]
  const projects = projectIds.length
    ? await db.select({ id: project.id, name: project.name }).from(project).where(eq(project.companyId, currentUser.companyId))
    : []
  const vendors = vendorIds.length
    ? await db.select({ id: contact.id, name: contact.name }).from(contact).where(eq(contact.companyId, currentUser.companyId))
    : []
  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p]))
  const vendorMap = Object.fromEntries(vendors.map((v) => [v.id, v]))

  const enriched = data.map((w) => ({
    ...w,
    project: projectMap[w.projectId] || null,
    vendor: w.vendorId ? vendorMap[w.vendorId] || null : null,
  }))

  return c.json({ data: enriched, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const [found] = await db
    .select()
    .from(lienWaiver)
    .where(and(eq(lienWaiver.id, id), eq(lienWaiver.companyId, currentUser.companyId)))
    .limit(1)
  if (!found) return c.json({ error: 'Lien waiver not found' }, 404)

  const [proj] = await db.select().from(project).where(eq(project.id, found.projectId)).limit(1)
  return c.json({ ...found, project: proj || null })
})

app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const data = lienWaiverSchema.parse(await c.req.json())

  const [created] = await db
    .insert(lienWaiver)
    .values({
      ...data,
      amountPrevious: String(data.amountPrevious),
      amountCurrent: String(data.amountCurrent),
      amountTotal: String(data.amountTotal || data.amountPrevious + data.amountCurrent),
      throughDate: data.throughDate ? new Date(data.throughDate) : null,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      status: 'draft',
      requestedAt: new Date(),
      companyId: currentUser.companyId,
    } as any)
    .returning()

  return c.json(created, 201)
})

app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const data = lienWaiverSchema.partial().parse(await c.req.json())
  const updateData: Record<string, any> = { ...data, updatedAt: new Date() }
  if (data.throughDate) updateData.throughDate = new Date(data.throughDate)
  if (data.dueDate) updateData.dueDate = new Date(data.dueDate)
  if (data.amountPrevious !== undefined) updateData.amountPrevious = String(data.amountPrevious)
  if (data.amountCurrent !== undefined) updateData.amountCurrent = String(data.amountCurrent)
  if (data.amountTotal !== undefined) updateData.amountTotal = String(data.amountTotal)

  const [updated] = await db.update(lienWaiver).set(updateData).where(eq(lienWaiver.id, id)).returning()
  return c.json(updated)
})

app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await db.delete(lienWaiver).where(eq(lienWaiver.id, id))
  return c.body(null, 204)
})

// Workflow: draft → requested → received → approved / rejected
app.post('/:id/request', async (c) => {
  const id = c.req.param('id')
  const [updated] = await db
    .update(lienWaiver)
    .set({ status: 'requested', requestedAt: new Date(), updatedAt: new Date() } as any)
    .where(eq(lienWaiver.id, id))
    .returning()
  return c.json(updated)
})

app.post('/:id/receive', async (c) => {
  const id = c.req.param('id')
  const { documentUrl, signedDate } = await c.req.json().catch(() => ({}))
  const [updated] = await db
    .update(lienWaiver)
    .set({
      status: 'received',
      receivedAt: new Date(),
      documentUrl,
      signedDate: signedDate ? new Date(signedDate) : new Date(),
      updatedAt: new Date(),
    } as any)
    .where(eq(lienWaiver.id, id))
    .returning()
  return c.json(updated)
})

app.post('/:id/approve', async (c) => {
  const id = c.req.param('id')
  const currentUser = c.get('user') as any
  const { notes } = await c.req.json().catch(() => ({}))
  const [updated] = await db
    .update(lienWaiver)
    .set({
      status: 'approved',
      approvedAt: new Date(),
      approvedById: currentUser.userId,
      approvalNotes: notes,
      updatedAt: new Date(),
    } as any)
    .where(eq(lienWaiver.id, id))
    .returning()
  return c.json(updated)
})

app.post('/:id/reject', async (c) => {
  const id = c.req.param('id')
  const { notes } = await c.req.json().catch(() => ({}))
  const [updated] = await db
    .update(lienWaiver)
    .set({ status: 'rejected', rejectedAt: new Date(), approvalNotes: notes, updatedAt: new Date() } as any)
    .where(eq(lienWaiver.id, id))
    .returning()
  return c.json(updated)
})

export default app

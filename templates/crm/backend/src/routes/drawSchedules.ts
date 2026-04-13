/**
 * Draw Schedules — Construction tier feature.
 *
 * A draw schedule is the plan for how construction loan funds get drawn
 * down against project milestones. Each draw request is submitted to the
 * lender for approval, usually tied to % complete + inspection photos.
 *
 * Tables created in migration 0010_add_construction_compliance.sql.
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { drawSchedule, drawRequest, project } from '../../db/schema.ts'
import { eq, and, count, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// ─────────────────────────────────────────────────────────────
// DRAW SCHEDULES
// ─────────────────────────────────────────────────────────────

const drawScheduleSchema = z.object({
  projectId: z.string(),
  name: z.string().min(1),
  totalAmount: z.number().positive(),
  lenderName: z.string().optional(),
  lenderContact: z.string().optional(),
  notes: z.string().optional(),
})

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const projectId = c.req.query('projectId')

  const conditions = [eq(drawSchedule.companyId, currentUser.companyId)]
  if (projectId) conditions.push(eq(drawSchedule.projectId, projectId))

  const schedules = await db.select().from(drawSchedule).where(and(...conditions)).orderBy(desc(drawSchedule.createdAt))

  // Attach project + draw count/totals
  const scheduleIds = schedules.map((s) => s.id)
  const requests = scheduleIds.length
    ? await db.select().from(drawRequest).where(eq(drawRequest.companyId, currentUser.companyId))
    : []
  const requestsBySchedule = requests.reduce((acc, r) => {
    if (!acc[r.drawScheduleId]) acc[r.drawScheduleId] = []
    acc[r.drawScheduleId].push(r)
    return acc
  }, {} as Record<string, any[]>)

  const enriched = schedules.map((s) => {
    const reqs = requestsBySchedule[s.id] || []
    const drawnAmount = reqs
      .filter((r) => ['approved', 'paid'].includes(r.status))
      .reduce((sum, r) => sum + Number(r.amountApproved || r.amountRequested), 0)
    return {
      ...s,
      drawCount: reqs.length,
      drawnAmount,
      remainingAmount: Number(s.totalAmount) - drawnAmount,
    }
  })

  return c.json({ data: enriched })
})

app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const [found] = await db
    .select()
    .from(drawSchedule)
    .where(and(eq(drawSchedule.id, id), eq(drawSchedule.companyId, currentUser.companyId)))
    .limit(1)
  if (!found) return c.json({ error: 'Draw schedule not found' }, 404)

  const requests = await db.select().from(drawRequest).where(eq(drawRequest.drawScheduleId, id)).orderBy(drawRequest.drawNumber)
  const [proj] = await db.select().from(project).where(eq(project.id, found.projectId)).limit(1)

  return c.json({ ...found, project: proj || null, requests })
})

app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const data = drawScheduleSchema.parse(await c.req.json())

  const [created] = await db
    .insert(drawSchedule)
    .values({
      ...data,
      totalAmount: String(data.totalAmount),
      companyId: currentUser.companyId,
    } as any)
    .returning()

  return c.json(created, 201)
})

app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const data = drawScheduleSchema.partial().parse(await c.req.json())
  const updateData: Record<string, any> = { ...data, updatedAt: new Date() }
  if (data.totalAmount !== undefined) updateData.totalAmount = String(data.totalAmount)

  const [updated] = await db.update(drawSchedule).set(updateData).where(eq(drawSchedule.id, id)).returning()
  return c.json(updated)
})

app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await db.delete(drawSchedule).where(eq(drawSchedule.id, id))
  return c.body(null, 204)
})

// ─────────────────────────────────────────────────────────────
// DRAW REQUESTS (nested under a schedule)
// ─────────────────────────────────────────────────────────────

const drawRequestSchema = z.object({
  drawScheduleId: z.string(),
  amountRequested: z.number().positive(),
  percentComplete: z.number().min(0).max(100).optional(),
  notes: z.string().optional(),
  inspectionPhotos: z.array(z.string()).optional(),
  supportingDocs: z.array(z.string()).optional(),
})

app.get('/requests/list', async (c) => {
  const currentUser = c.get('user') as any
  const scheduleId = c.req.query('scheduleId')
  const status = c.req.query('status')

  const conditions = [eq(drawRequest.companyId, currentUser.companyId)]
  if (scheduleId) conditions.push(eq(drawRequest.drawScheduleId, scheduleId))
  if (status) conditions.push(eq(drawRequest.status, status))

  const requests = await db.select().from(drawRequest).where(and(...conditions)).orderBy(desc(drawRequest.requestedAt))
  return c.json({ data: requests })
})

app.post('/requests', async (c) => {
  const currentUser = c.get('user') as any
  const data = drawRequestSchema.parse(await c.req.json())

  // Auto-assign draw number
  const [{ value: cnt }] = await db
    .select({ value: count() })
    .from(drawRequest)
    .where(and(eq(drawRequest.companyId, currentUser.companyId), eq(drawRequest.drawScheduleId, data.drawScheduleId)))

  const [created] = await db
    .insert(drawRequest)
    .values({
      ...data,
      drawNumber: Number(cnt) + 1,
      amountRequested: String(data.amountRequested),
      percentComplete: data.percentComplete !== undefined ? String(data.percentComplete) : null,
      companyId: currentUser.companyId,
    } as any)
    .returning()

  return c.json(created, 201)
})

app.post('/requests/:id/submit', async (c) => {
  const id = c.req.param('id')
  const [updated] = await db
    .update(drawRequest)
    .set({ status: 'submitted', submittedAt: new Date(), updatedAt: new Date() } as any)
    .where(eq(drawRequest.id, id))
    .returning()
  return c.json(updated)
})

app.post('/requests/:id/approve', async (c) => {
  const id = c.req.param('id')
  const { amountApproved, notes } = await c.req.json().catch(() => ({}))
  const [updated] = await db
    .update(drawRequest)
    .set({
      status: 'approved',
      amountApproved: amountApproved ? String(amountApproved) : undefined,
      notes,
      approvedAt: new Date(),
      updatedAt: new Date(),
    } as any)
    .where(eq(drawRequest.id, id))
    .returning()
  return c.json(updated)
})

app.post('/requests/:id/mark-paid', async (c) => {
  const id = c.req.param('id')
  const [updated] = await db
    .update(drawRequest)
    .set({ status: 'paid', paidAt: new Date(), updatedAt: new Date() } as any)
    .where(eq(drawRequest.id, id))
    .returning()
  return c.json(updated)
})

app.post('/requests/:id/reject', async (c) => {
  const id = c.req.param('id')
  const { notes } = await c.req.json().catch(() => ({}))
  const [updated] = await db
    .update(drawRequest)
    .set({ status: 'rejected', notes, updatedAt: new Date() } as any)
    .where(eq(drawRequest.id, id))
    .returning()
  return c.json(updated)
})

export default app

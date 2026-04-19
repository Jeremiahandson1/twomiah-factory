/**
 * Draw Schedules — Construction tier feature.
 *
 * A draw schedule (schedule of values) is the plan for how construction
 * loan funds get drawn down against project milestones. Each draw request
 * is submitted to the lender for approval.
 *
 * Uses the schedule_of_values + draw_request tables from migration 0000.
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { scheduleOfValues, drawRequest, project } from '../../db/schema.ts'
import { eq, and, count, desc } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// ─────────────────────────────────────────────────────────────
// DRAW SCHEDULES (schedule of values)
// ─────────────────────────────────────────────────────────────

const drawScheduleSchema = z.object({
  projectId: z.string(),
  // Accept both contractAmount (backend name) and totalAmount (frontend name)
  contractAmount: z.number().min(0).optional(),
  totalAmount: z.number().min(0).optional(),
  retainagePercent: z.number().min(0).max(100).default(10),
  name: z.string().optional(),
  lenderName: z.string().optional(),
  lenderContact: z.string().optional(),
  notes: z.string().optional(),
}).refine(d => d.contractAmount || d.totalAmount, { message: 'contractAmount or totalAmount required' })

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const projectId = c.req.query('projectId')

  const conditions = [eq(scheduleOfValues.companyId, currentUser.companyId)]
  if (projectId) conditions.push(eq(scheduleOfValues.projectId, projectId))

  const schedules = await db.select().from(scheduleOfValues).where(and(...conditions)).orderBy(desc(scheduleOfValues.createdAt))

  const scheduleIds = schedules.map((s) => s.id)
  const requests = scheduleIds.length
    ? await db.select().from(drawRequest).where(eq(drawRequest.companyId, currentUser.companyId))
    : []
  const requestsBySchedule = requests.reduce((acc, r) => {
    if (!acc[r.scheduleOfValuesId]) acc[r.scheduleOfValuesId] = []
    acc[r.scheduleOfValuesId].push(r)
    return acc
  }, {} as Record<string, any[]>)

  const enriched = schedules.map((s) => {
    const reqs = requestsBySchedule[s.id] || []
    const drawnAmount = reqs
      .filter((r) => ['approved', 'paid'].includes(r.status))
      .reduce((sum, r) => sum + Number(r.netAmount || r.grossAmount || 0), 0)
    return {
      ...s,
      totalAmount: Number(s.contractAmount) || 0, // alias for frontend
      drawCount: reqs.length,
      drawnAmount,
      remainingAmount: (Number(s.contractAmount) || 0) - drawnAmount,
    }
  })

  return c.json({ data: enriched })
})

app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const [found] = await db
    .select()
    .from(scheduleOfValues)
    .where(and(eq(scheduleOfValues.id, id), eq(scheduleOfValues.companyId, currentUser.companyId)))
    .limit(1)
  if (!found) return c.json({ error: 'Draw schedule not found' }, 404)

  const requests = await db.select().from(drawRequest).where(eq(drawRequest.scheduleOfValuesId, id)).orderBy(drawRequest.drawNumber)
  const [proj] = await db.select().from(project).where(eq(project.id, found.projectId)).limit(1)

  return c.json({ ...found, project: proj || null, requests })
})

app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const data = drawScheduleSchema.parse(await c.req.json())

  const [created] = await db
    .insert(scheduleOfValues)
    .values({
      id: createId(),
      projectId: data.projectId,
      contractAmount: String(data.contractAmount || data.totalAmount),
      retainagePercent: String(data.retainagePercent),
      status: 'draft',
      companyId: currentUser.companyId,
    })
    .returning()

  return c.json(created, 201)
})

app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const data = drawScheduleSchema.partial().parse(await c.req.json())
  const updateData: Record<string, any> = { updatedAt: new Date() }
  if (data.contractAmount !== undefined) updateData.contractAmount = String(data.contractAmount)
  if (data.retainagePercent !== undefined) updateData.retainagePercent = String(data.retainagePercent)
  if (data.projectId) updateData.projectId = data.projectId

  const [updated] = await db.update(scheduleOfValues).set(updateData).where(eq(scheduleOfValues.id, id)).returning()
  return c.json(updated)
})

app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await db.delete(scheduleOfValues).where(eq(scheduleOfValues.id, id))
  return c.body(null, 204)
})

// ─────────────────────────────────────────────────────────────
// DRAW REQUESTS (nested under a schedule of values)
// ─────────────────────────────────────────────────────────────

const drawRequestSchema = z.object({
  scheduleOfValuesId: z.string(),
  grossAmount: z.number().positive().optional(),
  notes: z.string().optional(),
})

app.get('/requests/list', async (c) => {
  const currentUser = c.get('user') as any
  const scheduleId = c.req.query('scheduleId')
  const status = c.req.query('status')

  const conditions = [eq(drawRequest.companyId, currentUser.companyId)]
  if (scheduleId) conditions.push(eq(drawRequest.scheduleOfValuesId, scheduleId))
  if (status) conditions.push(eq(drawRequest.status, status))

  const requests = await db.select().from(drawRequest).where(and(...conditions)).orderBy(desc(drawRequest.createdAt))
  return c.json({ data: requests })
})

app.post('/requests', async (c) => {
  const currentUser = c.get('user') as any
  const data = drawRequestSchema.parse(await c.req.json())

  const [{ value: cnt }] = await db
    .select({ value: count() })
    .from(drawRequest)
    .where(and(eq(drawRequest.companyId, currentUser.companyId), eq(drawRequest.scheduleOfValuesId, data.scheduleOfValuesId)))

  // Look up the SOV to get the projectId
  const [sov] = await db.select({ projectId: scheduleOfValues.projectId }).from(scheduleOfValues)
    .where(eq(scheduleOfValues.id, data.scheduleOfValuesId)).limit(1)
  if (!sov) return c.json({ error: 'Schedule of values not found' }, 404)

  const [created] = await db
    .insert(drawRequest)
    .values({
      id: createId(),
      scheduleOfValuesId: data.scheduleOfValuesId,
      projectId: sov.projectId,
      drawNumber: Number(cnt) + 1,
      grossAmount: data.grossAmount ? String(data.grossAmount) : '0',
      retainageAmount: '0',
      netAmount: data.grossAmount ? String(data.grossAmount) : '0',
      status: 'draft',
      companyId: currentUser.companyId,
    })
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
  const body = await c.req.json().catch(() => ({}))
  const [updated] = await db
    .update(drawRequest)
    .set({
      status: 'approved',
      approvedAt: new Date(),
      approvalNotes: body.notes,
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
    .set({ status: 'paid', updatedAt: new Date() } as any)
    .where(eq(drawRequest.id, id))
    .returning()
  return c.json(updated)
})

app.post('/requests/:id/reject', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const [updated] = await db
    .update(drawRequest)
    .set({ status: 'rejected', rejectionReason: body.notes, rejectedAt: new Date(), updatedAt: new Date() } as any)
    .where(eq(drawRequest.id, id))
    .returning()
  return c.json(updated)
})

export default app

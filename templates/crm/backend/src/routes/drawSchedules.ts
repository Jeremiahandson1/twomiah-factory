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
import { requirePermission } from '../middleware/permissions.ts'

const app = new Hono()
app.use('*', authenticate)

// ─────────────────────────────────────────────────────────────
// DRAW SCHEDULES (schedule of values)
// ─────────────────────────────────────────────────────────────

const drawScheduleSchema = z.object({
  projectId: z.string().min(1, 'Project is required'),
  contractAmount: z.number().min(0).optional(),
  totalAmount: z.number().min(0).optional().default(0),
  retainagePercent: z.number().min(0).max(100).default(10),
  name: z.string().optional(),
  lenderName: z.string().optional(),
  lenderContact: z.string().optional(),
  notes: z.string().optional(),
})

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

app.post('/', requirePermission('draw-schedules:create'), async (c) => {
  const currentUser = c.get('user') as any
  const data = drawScheduleSchema.parse(await c.req.json())

  const amount = data.contractAmount || data.totalAmount || 0

  // Check for existing schedule on this project (unique constraint on project_id)
  const [existing] = await db.select().from(scheduleOfValues)
    .where(and(eq(scheduleOfValues.projectId, data.projectId), eq(scheduleOfValues.companyId, currentUser.companyId)))
    .limit(1)
  if (existing) {
    return c.json({ error: 'A draw schedule already exists for this project. Edit the existing one instead.', existingId: existing.id }, 409)
  }

  const [created] = await db
    .insert(scheduleOfValues)
    .values({
      id: createId(),
      projectId: data.projectId,
      contractAmount: String(amount),
      retainagePercent: String(data.retainagePercent),
      status: 'draft',
      companyId: currentUser.companyId,
    })
    .returning()

  return c.json({ ...created, totalAmount: Number(created.contractAmount) || 0 }, 201)
})

app.put('/:id', requirePermission('draw-schedules:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = drawScheduleSchema.partial().parse(await c.req.json())
  const updateData: Record<string, any> = { updatedAt: new Date() }
  if (data.contractAmount !== undefined) updateData.contractAmount = String(data.contractAmount)
  if (data.retainagePercent !== undefined) updateData.retainagePercent = String(data.retainagePercent)
  if (data.projectId) updateData.projectId = data.projectId

  // Scoped to the caller's company like the reads above, not matched on id alone.
  const [updated] = await db.update(scheduleOfValues).set(updateData).where(and(eq(scheduleOfValues.id, id), eq(scheduleOfValues.companyId, currentUser.companyId))).returning()
  if (!updated) return c.json({ error: 'Draw schedule not found' }, 404)
  return c.json(updated)
})

app.delete('/:id', requirePermission('draw-schedules:delete'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  // `returning()` so a delete that matched nothing is a 404 rather than a silent "deleted".
  const [gone] = await db.delete(scheduleOfValues).where(and(eq(scheduleOfValues.id, id), eq(scheduleOfValues.companyId, currentUser.companyId))).returning()
  if (!gone) return c.json({ error: 'Draw schedule not found' }, 404)
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

app.post('/requests', requirePermission('draw-schedules:create'), async (c) => {
  const currentUser = c.get('user') as any
  const data = drawRequestSchema.parse(await c.req.json())

  const [{ value: cnt }] = await db
    .select({ value: count() })
    .from(drawRequest)
    .where(and(eq(drawRequest.companyId, currentUser.companyId), eq(drawRequest.scheduleOfValuesId, data.scheduleOfValuesId)))

  // Look up the SOV to get the projectId. Scoped to the caller's company: scheduleOfValuesId arrives in
  // the request BODY, so without this a caller could hang a draw request off another company's schedule
  // and copy its projectId across the boundary.
  const [sov] = await db.select({ projectId: scheduleOfValues.projectId }).from(scheduleOfValues)
    .where(and(eq(scheduleOfValues.id, data.scheduleOfValuesId), eq(scheduleOfValues.companyId, currentUser.companyId))).limit(1)
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

app.post('/requests/:id/submit', requirePermission('draw-schedules:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const [updated] = await db
    .update(drawRequest)
    .set({ status: 'submitted', submittedAt: new Date(), updatedAt: new Date() } as any)
    .where(and(eq(drawRequest.id, id), eq(drawRequest.companyId, currentUser.companyId)))
    .returning()
  if (!updated) return c.json({ error: 'Draw request not found' }, 404)
  return c.json(updated)
})

app.post('/requests/:id/approve', requirePermission('draw-schedules:update'), async (c) => {
  const currentUser = c.get('user') as any
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
    .where(and(eq(drawRequest.id, id), eq(drawRequest.companyId, currentUser.companyId)))
    .returning()
  if (!updated) return c.json({ error: 'Draw request not found' }, 404)
  return c.json(updated)
})

app.post('/requests/:id/mark-paid', requirePermission('draw-schedules:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const [updated] = await db
    .update(drawRequest)
    .set({ status: 'paid', updatedAt: new Date() } as any)
    .where(and(eq(drawRequest.id, id), eq(drawRequest.companyId, currentUser.companyId)))
    .returning()
  if (!updated) return c.json({ error: 'Draw request not found' }, 404)
  return c.json(updated)
})

app.post('/requests/:id/reject', requirePermission('draw-schedules:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const [updated] = await db
    .update(drawRequest)
    .set({ status: 'rejected', rejectionReason: body.notes, rejectedAt: new Date(), updatedAt: new Date() } as any)
    .where(and(eq(drawRequest.id, id), eq(drawRequest.companyId, currentUser.companyId)))
    .returning()
  if (!updated) return c.json({ error: 'Draw request not found' }, 404)
  return c.json(updated)
})

// A draw request had no delete at all, and drawRequest.scheduleOfValuesId references
// scheduleOfValues.id with no onDelete cascade — so one draw request made its schedule of values
// undeletable (409 "still in use") and, through projectId, its project too. The row could be created
// and then never removed by any route in the API.
app.delete('/requests/:id', requirePermission('draw-schedules:delete'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  // `returning()` so a delete that matched nothing is a 404 rather than a silent "deleted".
  const [gone] = await db.delete(drawRequest).where(and(eq(drawRequest.id, id), eq(drawRequest.companyId, currentUser.companyId))).returning()
  if (!gone) return c.json({ error: 'Draw request not found' }, 404)
  return c.body(null, 204)
})

export default app

// Draw schedules: the schedule of values a construction loan is drawn down against, and the draw requests made to
// the lender against it. Moved from templates/crm/backend/src/routes/drawSchedules.ts.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, count, desc } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { scheduleOfValues, drawRequest, project } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

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

const drawRequestSchema = z.object({
  scheduleOfValuesId: z.string(),
  grossAmount: z.number().positive().optional(),
  notes: z.string().optional(),
})

export function createDrawScheduleRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  // Reads gated like the writes: a draw schedule is the payment plan on the contract (T34).
  app.use('*', requirePermission('draw-schedules:read'))

  // ── Draw schedules (schedule of values) ──

  app.get('/', async (c) => {
    const currentUser = c.get('user') as any
    const projectId = c.req.query('projectId')

    const conditions = [eq(scheduleOfValues.companyId, currentUser.companyId)]
    if (projectId) conditions.push(eq(scheduleOfValues.projectId, projectId))

    const schedules: any[] = await db.select().from(scheduleOfValues).where(and(...conditions)).orderBy(desc(scheduleOfValues.createdAt))

    const requests: any[] = schedules.length
      ? await db.select().from(drawRequest).where(eq(drawRequest.companyId, currentUser.companyId))
      : []
    const requestsBySchedule = requests.reduce((acc, r) => {
      if (!acc[r.scheduleOfValuesId]) acc[r.scheduleOfValuesId] = []
      acc[r.scheduleOfValuesId].push(r)
      return acc
    }, {} as Record<string, any[]>)

    const enriched = schedules.map((s) => {
      const reqs: any[] = requestsBySchedule[s.id] || []
      const drawnAmount = reqs
        .filter((r) => ['approved', 'paid'].includes(r.status))
        .reduce((sum, r) => sum + Number(r.netAmount || r.grossAmount || 0), 0)
      return {
        ...s,
        totalAmount: Number(s.contractAmount) || 0, // alias for the screen
        drawCount: reqs.length,
        drawnAmount,
        remainingAmount: (Number(s.contractAmount) || 0) - drawnAmount,
      }
    })

    return list(c, enriched, { page: 1, limit: enriched.length, total: enriched.length })
  })

  app.get('/:id', async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [found] = await db
      .select()
      .from(scheduleOfValues)
      .where(and(eq(scheduleOfValues.id, id), eq(scheduleOfValues.companyId, currentUser.companyId)))
      .limit(1)
    if (!found) return fail(c, 404, 'Draw schedule not found')

    const requests = await db.select().from(drawRequest).where(eq(drawRequest.scheduleOfValuesId, id)).orderBy(drawRequest.drawNumber)
    const [proj] = await db.select().from(project).where(eq(project.id, found.projectId)).limit(1)

    return one(c, { ...found, project: proj || null, requests })
  })

  app.post('/', requirePermission('draw-schedules:create'), async (c) => {
    const currentUser = c.get('user') as any
    const data = drawScheduleSchema.parse(await c.req.json())

    const amount = data.contractAmount || data.totalAmount || 0

    // One schedule per project (unique constraint on project_id).
    const [existing] = await db.select().from(scheduleOfValues)
      .where(and(eq(scheduleOfValues.projectId, data.projectId), eq(scheduleOfValues.companyId, currentUser.companyId)))
      .limit(1)
    if (existing) {
      return fail(c, 409, 'A draw schedule already exists for this project. Edit the existing one instead.')
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

    return one(c, { ...created, totalAmount: Number(created.contractAmount) || 0 }, 201)
  })

  app.put('/:id', requirePermission('draw-schedules:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const data = drawScheduleSchema.partial().parse(await c.req.json())
    const updateData: Record<string, any> = { updatedAt: new Date() }
    if (data.contractAmount !== undefined) updateData.contractAmount = String(data.contractAmount)
    if (data.retainagePercent !== undefined) updateData.retainagePercent = String(data.retainagePercent)
    if (data.projectId) updateData.projectId = data.projectId

    const [updated] = await db.update(scheduleOfValues).set(updateData).where(and(eq(scheduleOfValues.id, id), eq(scheduleOfValues.companyId, currentUser.companyId))).returning()
    if (!updated) return fail(c, 404, 'Draw schedule not found')
    return one(c, updated)
  })

  app.delete('/:id', requirePermission('draw-schedules:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    // `returning()` so a delete that matched nothing is a 404 rather than a silent "deleted".
    const [gone] = await db.delete(scheduleOfValues).where(and(eq(scheduleOfValues.id, id), eq(scheduleOfValues.companyId, currentUser.companyId))).returning()
    if (!gone) return fail(c, 404, 'Draw schedule not found')
    return c.body(null, 204)
  })

  // ── Draw requests (under a schedule of values) ──

  app.get('/requests/list', async (c) => {
    const currentUser = c.get('user') as any
    const scheduleId = c.req.query('scheduleId')
    const status = c.req.query('status')

    const conditions = [eq(drawRequest.companyId, currentUser.companyId)]
    if (scheduleId) conditions.push(eq(drawRequest.scheduleOfValuesId, scheduleId))
    if (status) conditions.push(eq(drawRequest.status, status))

    const requests: any[] = await db.select().from(drawRequest).where(and(...conditions)).orderBy(desc(drawRequest.createdAt))
    return list(c, requests, { page: 1, limit: requests.length, total: requests.length })
  })

  app.post('/requests', requirePermission('draw-schedules:create'), async (c) => {
    const currentUser = c.get('user') as any
    const data = drawRequestSchema.parse(await c.req.json())

    const [{ value: cnt }] = await db
      .select({ value: count() })
      .from(drawRequest)
      .where(and(eq(drawRequest.companyId, currentUser.companyId), eq(drawRequest.scheduleOfValuesId, data.scheduleOfValuesId)))

    // The schedule, scoped to the caller's company: its id arrives in the BODY, so without this a caller could hang
    // a draw request off another company's schedule and copy its projectId across.
    const [sov] = await db.select({ projectId: scheduleOfValues.projectId }).from(scheduleOfValues)
      .where(and(eq(scheduleOfValues.id, data.scheduleOfValuesId), eq(scheduleOfValues.companyId, currentUser.companyId))).limit(1)
    if (!sov) return fail(c, 404, 'Schedule of values not found')

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

    return one(c, created, 201)
  })

  app.post('/requests/:id/submit', requirePermission('draw-schedules:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [updated] = await db
      .update(drawRequest)
      .set({ status: 'submitted', submittedAt: new Date(), updatedAt: new Date() } as any)
      .where(and(eq(drawRequest.id, id), eq(drawRequest.companyId, currentUser.companyId)))
      .returning()
    if (!updated) return fail(c, 404, 'Draw request not found')
    return one(c, updated)
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
    if (!updated) return fail(c, 404, 'Draw request not found')
    return one(c, updated)
  })

  app.post('/requests/:id/mark-paid', requirePermission('draw-schedules:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [updated] = await db
      .update(drawRequest)
      .set({ status: 'paid', updatedAt: new Date() } as any)
      .where(and(eq(drawRequest.id, id), eq(drawRequest.companyId, currentUser.companyId)))
      .returning()
    if (!updated) return fail(c, 404, 'Draw request not found')
    return one(c, updated)
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
    if (!updated) return fail(c, 404, 'Draw request not found')
    return one(c, updated)
  })

  // A draw request is deletable: its schedule has no cascade, so one undeletable request would pin the schedule
  // and, through projectId, the project.
  app.delete('/requests/:id', requirePermission('draw-schedules:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [gone] = await db.delete(drawRequest).where(and(eq(drawRequest.id, id), eq(drawRequest.companyId, currentUser.companyId))).returning()
    if (!gone) return fail(c, 404, 'Draw request not found')
    return c.body(null, 204)
  })

  return app
}

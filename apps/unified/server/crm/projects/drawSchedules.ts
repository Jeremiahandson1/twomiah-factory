// Draw schedules: the schedule of values a construction loan is drawn down against, and the draw requests made to
// the lender against it. Moved from templates/crm/backend/src/routes/drawSchedules.ts.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, count, desc, inArray, ne, sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { scheduleOfValues, drawRequest, project } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { partialOf } from '@twomiah/tenant-backend'

const drawScheduleSchema = z.object({
  projectId: z.string().min(1, 'Project is required'),
  contractAmount: z.number().min(0).optional(),
  totalAmount: z.number().min(0).optional().default(0),
  retainagePercent: z.number().min(0).max(100).default(10),
  name: z.string().trim().max(200).optional(),
  lenderName: z.string().trim().max(200).optional(),
  lenderContact: z.string().trim().max(200).optional(),
  notes: z.string().max(4000).optional(),
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

    return listAll(c, enriched)
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
        // The screen's own fields — they were asked for and dropped (no columns) until migration 0019.
        name: data.name || null,
        lenderName: data.lenderName || null,
        lenderContact: data.lenderContact || null,
        notes: data.notes || null,
        status: 'draft',
        companyId: currentUser.companyId,
      })
      .returning()

    return one(c, { ...created, totalAmount: Number(created.contractAmount) || 0 }, 201)
  })

  app.put('/:id', requirePermission('draw-schedules:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const data = partialOf(drawScheduleSchema).parse(await c.req.json())
    const updateData: Record<string, any> = { updatedAt: new Date() }
    if (data.contractAmount !== undefined) updateData.contractAmount = String(data.contractAmount)
    if (data.retainagePercent !== undefined) updateData.retainagePercent = String(data.retainagePercent)
    for (const k of ['name', 'lenderName', 'lenderContact', 'notes'] as const) if (data[k] !== undefined) updateData[k] = data[k] || null
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
    return listAll(c, requests)
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
    const [sov] = await db.select({ projectId: scheduleOfValues.projectId, contractAmount: scheduleOfValues.contractAmount, retainagePercent: scheduleOfValues.retainagePercent }).from(scheduleOfValues)
      .where(and(eq(scheduleOfValues.id, data.scheduleOfValuesId), eq(scheduleOfValues.companyId, currentUser.companyId))).limit(1)
    if (!sov) return fail(c, 404, 'Schedule of values not found')

    // A draw can't take more than the loan has left: every draw not rejected counts against it.
    const gross = Math.round((data.grossAmount || 0) * 100) / 100
    const [{ drawn }] = await db.select({ drawn: sql<string>`coalesce(sum(${drawRequest.grossAmount}), 0)` }).from(drawRequest)
      .where(and(eq(drawRequest.scheduleOfValuesId, data.scheduleOfValuesId), ne(drawRequest.status, 'rejected')))
    const left = Math.round((Number(sov.contractAmount) - Number(drawn)) * 100) / 100
    if (gross > left + 0.005) return fail(c, 400, `That is more than the loan has left to draw ($${left.toFixed(2)}).`, 'over_contract')
    // The lender holds back the schedule's retainage from each draw; the net is what is paid now. Retainage was stored
    // as $0 and the net as the whole gross, so every draw overstated what the lender pays.
    const retainage = Math.round(gross * Number(sov.retainagePercent || 0)) / 100

    const [created] = await db
      .insert(drawRequest)
      .values({
        id: createId(),
        scheduleOfValuesId: data.scheduleOfValuesId,
        projectId: sov.projectId,
        drawNumber: Number(cnt) + 1,
        grossAmount: gross.toFixed(2),
        retainageAmount: retainage.toFixed(2),
        netAmount: (gross - retainage).toFixed(2),
        status: 'draft',
        companyId: currentUser.companyId,
      })
      .returning()

    return one(c, created, 201)
  })

  /**
   * A draw moves draft → submitted → approved → paid, or submitted → rejected → submitted again — one step at a time.
   * Each move names the statuses it may start from; any other is refused (409), so a draft can't be approved or paid
   * before the lender has it, and a paid draw can't be approved again. Who approved or rejected it is recorded.
   */
  const move = (action: string, from: string[], set: (c: any, body: any) => Record<string, unknown>) =>
    app.post(`/requests/:id/${action}`, requirePermission('draw-schedules:update'), async (c) => {
      const currentUser = c.get('user') as any
      const id = c.req.param('id')
      const body = await c.req.json().catch(() => ({}))
      const [updated] = await db
        .update(drawRequest)
        .set({ ...set(c, body), updatedAt: new Date() } as any)
        .where(and(eq(drawRequest.id, id), eq(drawRequest.companyId, currentUser.companyId), inArray(drawRequest.status, from)))
        .returning()
      if (updated) return one(c, updated)
      const [found] = await db.select({ status: drawRequest.status }).from(drawRequest)
        .where(and(eq(drawRequest.id, id), eq(drawRequest.companyId, currentUser.companyId))).limit(1)
      if (!found) return fail(c, 404, 'Draw request not found')
      return fail(c, 409, `This draw is ${found.status}; it can't be ${action === 'mark-paid' ? 'marked paid' : action === 'submit' ? 'submitted' : action + 'd'} from there.`, 'wrong_status')
    })

  move('submit', ['draft', 'rejected'], () => ({ status: 'submitted', submittedAt: new Date() }))
  move('approve', ['submitted'], (c, body) => ({ status: 'approved', approvedAt: new Date(), approvedById: (c.get('user') as any).userId, approvalNotes: typeof body.notes === 'string' ? body.notes.slice(0, 4000) : null }))
  move('mark-paid', ['approved'], () => ({ status: 'paid' }))
  move('reject', ['submitted'], (c, body) => ({ status: 'rejected', rejectedAt: new Date(), rejectedById: (c.get('user') as any).userId, rejectionReason: typeof body.notes === 'string' ? body.notes.slice(0, 4000) : null }))

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

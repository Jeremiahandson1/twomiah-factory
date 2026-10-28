// RFIs: a question asked on a job and the answer somebody gave. Moved from templates/crm/backend/src/routes/rfis.ts.
// The registry signs the person in and applies the 'rfis' feature gate; each action keeps the template's permission.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, count, desc } from 'drizzle-orm'
import { createActorName, companyTimeZone, storeDateString } from '@twomiah/tenant-backend'
import { rfi, project, user } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'
import { partialOf } from '@twomiah/tenant-backend'

const rfiSchema = z.object({
  subject: z.string().min(1),
  question: z.string().min(1),
  projectId: z.string(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  dueDate: z.string().optional(),
  assignedTo: z.string().optional(),
})

/**
 * AN RFI IS A QUESTION AND THE ANSWER SOMEBODY GAVE. (T32 H11)
 *
 * On a construction job an RFI answer is the instruction the work was done to. Three rules:
 *   1. A CLOSED RFI TAKES NO NEW ANSWER. Reopen it first — a visible act with its own endpoint.
 *   2. AN ANSWER IS NOT OVERWRITTEN. Replacing one needs `?replace=true`, and the previous answer is kept, appended
 *      under a dated heading, so the thread reads in order. The answer column holds the whole thread.
 *   3. THE RESPONDER IS THE SIGNED-IN PERSON, never the body.
 */
const CLOSED = 'closed'

export function createRfiRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  /** Who answered this, by name, for the record. Never the request body. (shared: auth/actorName) */
  const actorName = createActorName({ db, tables: { user } } as any)

  const app = new Hono<AppEnv>()

  app.get('/', requirePermission('rfis:read'), async (c) => {
    const currentUser = c.get('user') as any
    const status = c.req.query('status')
    const projectId = c.req.query('projectId')
    const page = +(c.req.query('page') || '1')
    const limit = +(c.req.query('limit') || '50')

    const conditions = [eq(rfi.companyId, currentUser.companyId)]
    if (status) conditions.push(eq(rfi.status, status))
    if (projectId) conditions.push(eq(rfi.projectId, projectId))

    const where = and(...conditions)
    const [data, [{ value: total }]] = await Promise.all([
      db.select().from(rfi).where(where).orderBy(desc(rfi.createdAt)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(rfi).where(where),
    ])

    // Fetch related projects
    const projectIds = [...new Set(data.map((r: any) => r.projectId))]
    const projects: any[] = projectIds.length
      ? await db.select({ id: project.id, name: project.name }).from(project).where(eq(project.companyId, currentUser.companyId))
      : []
    const projectMap = Object.fromEntries(projects.map((p) => [p.id, p]))

    const dataWithRelations = data.map((r: any) => ({ ...r, project: projectMap[r.projectId] || null }))

    return list(c, dataWithRelations, { page, limit, total: Number(total) })
  })

  app.get('/:id', requirePermission('rfis:read'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')

    const [foundRfi] = await db.select().from(rfi).where(and(eq(rfi.id, id), eq(rfi.companyId, currentUser.companyId))).limit(1)
    if (!foundRfi) return fail(c, 404, 'RFI not found')

    const [rfiProject] = await db.select().from(project).where(eq(project.id, foundRfi.projectId)).limit(1)

    return one(c, { ...foundRfi, project: rfiProject || null })
  })

  app.post('/', requirePermission('rfis:create'), async (c) => {
    const currentUser = c.get('user') as any
    const data = rfiSchema.parse(await c.req.json())

    const [{ value: cnt }] = await db.select({ value: count() }).from(rfi).where(and(eq(rfi.companyId, currentUser.companyId), eq(rfi.projectId, data.projectId)))

    const [newRfi] = await db.insert(rfi).values({
      ...data,
      number: `RFI-${String(Number(cnt) + 1).padStart(3, '0')}`,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      companyId: currentUser.companyId,
    }).returning()

    return one(c, newRfi, 201)
  })

  app.put('/:id', requirePermission('rfis:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const data = partialOf(rfiSchema).parse(await c.req.json())

    const updateData: Record<string, any> = { ...data, updatedAt: new Date() }
    if (data.dueDate) updateData.dueDate = new Date(data.dueDate)

    // Scoped to the caller's company like the reads above, not matched on id alone.
    const [updated] = await db.update(rfi).set(updateData).where(and(eq(rfi.id, id), eq(rfi.companyId, currentUser.companyId))).returning()
    if (!updated) return fail(c, 404, 'RFI not found')
    return one(c, updated)
  })

  app.delete('/:id', requirePermission('rfis:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    // `returning()` so a delete that matched nothing is a 404 rather than a silent "deleted".
    const [gone] = await db.delete(rfi).where(and(eq(rfi.id, id), eq(rfi.companyId, currentUser.companyId))).returning()
    if (!gone) return fail(c, 404, 'RFI not found')
    return c.body(null, 204)
  })

  app.post('/:id/respond', requirePermission('rfis:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    const response = typeof body?.response === 'string' ? body.response.trim() : ''
    if (!response) return fail(c, 400, 'An answer is required.')

    const [existing] = await db.select().from(rfi)
      .where(and(eq(rfi.id, id), eq(rfi.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'RFI not found')

    if (existing.status === CLOSED) {
      return fail(c, 400, `${existing.number} is closed. Reopen it before answering (POST /api/rfis/${id}/reopen), so that the change is on the record rather than inside it.`, 'rfi_closed')
    }

    const replacing = existing.response && existing.response.trim().length > 0
    const wantsReplace = c.req.query('replace') === 'true' || body?.replace === true
    if (replacing && !wantsReplace) {
      return fail(c, 409,
        `${existing.number} has already been answered${existing.respondedBy ? ` by ${existing.respondedBy}` : ''}${existing.respondedAt ? ` on ${new Date(existing.respondedAt).toISOString().slice(0, 10)}` : ''}. Send replace=true to add a revised answer — the original is kept.`,
        'rfi_already_answered')
    }

    const responder = await actorName(currentUser)
    // The thread, not a replacement. The old answer stays above the new one, each with who and when.
    const text = replacing
      ? `${existing.response}\n\n--- Revised ${storeDateString(new Date(), await companyTimeZone(db, currentUser.companyId))} by ${responder} ---\n${response}`
      : response

    const [updated] = await db.update(rfi).set({
      response: text,
      respondedBy: responder,
      respondedAt: new Date(),
      status: 'answered',
      updatedAt: new Date(),
    }).where(and(eq(rfi.id, id), eq(rfi.companyId, currentUser.companyId))).returning()
    return one(c, updated)
  })

  /**
   * CLOSING AN UNANSWERED RFI IS DELIBERATE, NOT INCIDENTAL. (T34)
   *
   * It takes an explicit `closeUnanswered: true`: the accidental case is refused with the answer route named, the
   * deliberate one goes through. `status = closed` with `response` still null records which of the two happened,
   * and `reopen` reads that same field to decide where an RFI goes back to.
   */
  app.post('/:id/close', requirePermission('rfis:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))

    const [existing] = await db.select().from(rfi)
      .where(and(eq(rfi.id, id), eq(rfi.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'RFI not found')

    const answered = !!(existing.response && existing.response.trim().length > 0)
    if (!answered && body?.closeUnanswered !== true) {
      return fail(c, 400,
        `${existing.number} has no answer. Closing it now records a question nobody answered — answer it first (POST /api/rfis/${id}/respond), or send closeUnanswered: true to withdraw it.`,
        'rfi_unanswered')
    }

    const [updated] = await db.update(rfi).set({ status: CLOSED, closedAt: new Date(), updatedAt: new Date() }).where(and(eq(rfi.id, id), eq(rfi.companyId, currentUser.companyId))).returning()
    if (!updated) return fail(c, 404, 'RFI not found')
    // Says which of the two closes this was, so a caller does not have to infer it from a null.
    return one(c, { ...updated, closedUnanswered: !answered })
  })

  /**
   * Reopen — the visible act that rule 1 above requires. The status goes back to where the answer left it, so
   * reopening an unanswered one returns it to open and an answered one to answered.
   */
  app.post('/:id/reopen', requirePermission('rfis:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [existing] = await db.select().from(rfi)
      .where(and(eq(rfi.id, id), eq(rfi.companyId, currentUser.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'RFI not found')
    if (existing.status !== CLOSED) {
      return fail(c, 400, `${existing.number} is ${existing.status}, not closed.`, 'rfi_not_closed')
    }
    const [updated] = await db.update(rfi).set({
      status: existing.response ? 'answered' : 'open',
      closedAt: null,
      updatedAt: new Date(),
    }).where(and(eq(rfi.id, id), eq(rfi.companyId, currentUser.companyId))).returning()
    return one(c, updated)
  })

  return app
}

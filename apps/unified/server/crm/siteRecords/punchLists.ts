// Punch lists: the snag list a client walks at handover. Moved from templates/crm/backend/src/routes/punchLists.ts.
// The registry signs the person in and applies the 'punch_lists' feature gate.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, count, desc } from 'drizzle-orm'
import { createActorName } from '@twomiah/tenant-backend'
import { punchListItem, project, user } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'

/**
 * Signing off somebody else's work is manager and above. (T32 M2)
 *
 * `punch-lists:delete` rather than a new resource: the matrix gives field `punch-lists:read` and `punch-lists:update`
 * and nothing more, so delete is the nearest right that already draws exactly the line this verb needs.
 */
const SIGN_OFF_PERMISSION = 'punch-lists:delete'

const schema = z.object({ description: z.string().min(1), projectId: z.string(), location: z.string().optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'), assignedTo: z.string().optional(), dueDate: z.string().optional(), notes: z.string().optional() })

export function createPunchListRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission, hasPermission, getExtraPermissions } = d.permissions
  /** Who verified it, by name, for the record. Never the request body. (T32 M2) */
  const actorName = createActorName({ db, tables: { user } } as any)
  const maySignOff = async (c: any) => {
    const u = c.get('user') as any
    try { return hasPermission(u?.role, SIGN_OFF_PERMISSION, await getExtraPermissions(u?.userId)) } catch { return false }
  }
  const load = async (id: string, companyId: string) => {
    const [row] = await db.select().from(punchListItem)
      .where(and(eq(punchListItem.id, id), eq(punchListItem.companyId, companyId))).limit(1)
    return row || null
  }

  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const { status, projectId, page = '1', limit = '50' } = c.req.query() as any
    const me = c.get('user') as any
    const conditions = [eq(punchListItem.companyId, me.companyId)]
    if (status) conditions.push(eq(punchListItem.status, status))
    if (projectId) conditions.push(eq(punchListItem.projectId, projectId))

    const where = and(...conditions)
    const pageNum = +page
    const limitNum = +limit

    const [data, [{ value: total }]] = await Promise.all([
      db.select({
        punchListItem,
        project: { id: project.id, name: project.name },
      }).from(punchListItem)
        .leftJoin(project, eq(punchListItem.projectId, project.id))
        .where(where)
        .orderBy(desc(punchListItem.createdAt))
        .offset((pageNum - 1) * limitNum)
        .limit(limitNum),
      db.select({ value: count() }).from(punchListItem).where(where),
    ])

    return list(c, data, { page: pageNum, limit: limitNum, total: Number(total) })
  })

  app.get('/:id', async (c) => {
    const me = c.get('user') as any
    const id = c.req.param('id')
    const [item] = await db.select({
      punchListItem,
      project,
    }).from(punchListItem)
      .leftJoin(project, eq(punchListItem.projectId, project.id))
      .where(and(eq(punchListItem.id, id), eq(punchListItem.companyId, me.companyId)))
      .limit(1)
    if (!item) return fail(c, 404, 'Punch list item not found')
    return one(c, item)
  })

  app.post('/', requirePermission('punch-lists:create'), async (c) => {
    const me = c.get('user') as any
    const data = schema.parse(await c.req.json())
    const [{ value: countVal }] = await db.select({ value: count() }).from(punchListItem).where(and(eq(punchListItem.companyId, me.companyId), eq(punchListItem.projectId, data.projectId)))
    const [item] = await db.insert(punchListItem).values({
      ...data,
      number: `PL-${String(countVal + 1).padStart(3, '0')}`,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      companyId: me.companyId,
    }).returning()
    return one(c, item, 201)
  })

  app.put('/:id', requirePermission('punch-lists:update'), async (c) => {
    const me = c.get('user') as any
    const id = c.req.param('id')
    const data = schema.partial().parse(await c.req.json())
    // Scoped to the caller's company like the reads above, not matched on id alone.
    const [item] = await db.update(punchListItem).set({
      ...data,
      dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      updatedAt: new Date(),
    }).where(and(eq(punchListItem.id, id), eq(punchListItem.companyId, me.companyId))).returning()
    if (!item) return fail(c, 404, 'Punch list item not found')
    return one(c, item)
  })

  app.delete('/:id', requirePermission('punch-lists:delete'), async (c) => {
    const me = c.get('user') as any
    const id = c.req.param('id')
    // `returning()` so a delete that matched nothing is a 404 rather than a silent "deleted".
    const [gone] = await db.delete(punchListItem).where(and(eq(punchListItem.id, id), eq(punchListItem.companyId, me.companyId))).returning()
    if (!gone) return fail(c, 404, 'Punch list item not found')
    return c.body(null, 204)
  })

  /**
   * A PUNCH ITEM IS SIGNED OFF BY A SECOND PERSON. (T32 M2)
   *
   *   open ──complete──▶ completed ──verify──▶ verified
   *
   *  1. VERIFY NEEDS COMPLETE FIRST.
   *  2. SIGN-OFF IS MANAGER AND ABOVE. `punch-lists:update` is held by `field` deliberately — a technician marks their
   *     own work complete. Verification is somebody else checking it.
   * …and the verifier is the signed-in person.
   */
  app.post('/:id/complete', requirePermission('punch-lists:update'), async (c) => {
    const me = c.get('user') as any
    const id = c.req.param('id')
    const existing = await load(id, me.companyId)
    if (!existing) return fail(c, 404, 'Punch list item not found')
    if (existing.status === 'verified') {
      return fail(c, 400, `${existing.number} has been verified and signed off. Reopen it if the work has to be redone.`, 'punch_item_verified')
    }
    const [item] = await db.update(punchListItem).set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() }).where(and(eq(punchListItem.id, id), eq(punchListItem.companyId, me.companyId))).returning()
    return one(c, item)
  })

  app.post('/:id/verify', requirePermission('punch-lists:update'), async (c) => {
    const me = c.get('user') as any
    const id = c.req.param('id')
    const existing = await load(id, me.companyId)
    if (!existing) return fail(c, 404, 'Punch list item not found')

    // Rule 2 first: who may sign off at all.
    if (!(await maySignOff(c))) {
      return fail(c, 403, 'Verifying a punch item is a second person signing off somebody else\'s work, so it needs a manager or above.', 'punch_verify_not_permitted')
    }
    if (existing.status !== 'completed') {
      return fail(c, 400,
        existing.status === 'verified'
          ? `${existing.number} has already been verified.`
          : `${existing.number} is ${existing.status}. Mark it complete before verifying it — signing off work nobody has said is finished is what a punch list is for.`,
        'punch_item_not_complete')
    }

    const [item] = await db.update(punchListItem).set({
      status: 'verified',
      verifiedAt: new Date(),
      // The signed-in person, never the body.
      verifiedBy: await actorName(me),
      updatedAt: new Date(),
    }).where(and(eq(punchListItem.id, id), eq(punchListItem.companyId, me.companyId))).returning()
    return one(c, item)
  })

  /**
   * Reopen — "verified" has to be reversible by somebody, or a mis-click at handover is permanent. Same authority as
   * verifying: the person who can sign off can un-sign-off.
   */
  app.post('/:id/reopen', requirePermission('punch-lists:update'), async (c) => {
    const me = c.get('user') as any
    const id = c.req.param('id')
    const existing = await load(id, me.companyId)
    if (!existing) return fail(c, 404, 'Punch list item not found')
    if (existing.status === 'open') return fail(c, 400, `${existing.number} is already open.`, 'punch_item_open')
    if (existing.status === 'verified' && !(await maySignOff(c))) {
      return fail(c, 403, 'Reopening a verified punch item needs a manager or above, the same as verifying it.', 'punch_reopen_not_permitted')
    }
    const [item] = await db.update(punchListItem).set({
      status: 'open', completedAt: null, verifiedAt: null, verifiedBy: null, updatedAt: new Date(),
    }).where(and(eq(punchListItem.id, id), eq(punchListItem.companyId, me.companyId))).returning()
    return one(c, item)
  })

  return app
}

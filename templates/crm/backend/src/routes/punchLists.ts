import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { punchListItem, project, user } from '../../db/schema.ts'
import { eq, and, count, desc, asc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission, hasPermission, getExtraPermissions } from '../middleware/permissions.ts'
import { createActorName } from '../shared/index.ts'

const app = new Hono()
app.use('*', authenticate)

/** Who verified it, by name, for the record. Never the request body. (T32 M2) */
const actorName = createActorName({ db, tables: { user } })

/**
 * Signing off somebody else's work is manager and above. (T32 M2)
 *
 * `punch-lists:delete` rather than a new resource: the matrix gives field `punch-lists:read` and
 * `punch-lists:update` and nothing more, so delete is the nearest right that already draws exactly
 * the line this verb needs — and inventing `punch-lists:verify` would mean a new entry in the
 * vocabulary, in every role list, for one button.
 */
const SIGN_OFF_PERMISSION = 'punch-lists:delete'
const maySignOff = async (c: any) => {
  const u = c.get('user') as any
  try { return hasPermission(u?.role, SIGN_OFF_PERMISSION, await getExtraPermissions(u?.userId)) } catch { return false }
}

const schema = z.object({ description: z.string().min(1), projectId: z.string(), location: z.string().optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'), assignedTo: z.string().optional(), dueDate: z.string().optional(), notes: z.string().optional() })

app.get('/', async (c) => {
  const { status, projectId, page = '1', limit = '50' } = c.req.query() as any
  const user = c.get('user') as any
  const conditions = [eq(punchListItem.companyId, user.companyId)]
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

  return c.json({ data, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } })
})

app.get('/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const [item] = await db.select({
    punchListItem,
    project,
  }).from(punchListItem)
    .leftJoin(project, eq(punchListItem.projectId, project.id))
    .where(and(eq(punchListItem.id, id), eq(punchListItem.companyId, user.companyId)))
    .limit(1)
  if (!item) return c.json({ error: 'Punch list item not found' }, 404)
  return c.json(item)
})

app.post('/', requirePermission('punch-lists:create'), async (c) => {
  const user = c.get('user') as any
  const data = schema.parse(await c.req.json())
  const [{ value: countVal }] = await db.select({ value: count() }).from(punchListItem).where(and(eq(punchListItem.companyId, user.companyId), eq(punchListItem.projectId, data.projectId)))
  const [item] = await db.insert(punchListItem).values({
    ...data,
    number: `PL-${String(countVal + 1).padStart(3, '0')}`,
    dueDate: data.dueDate ? new Date(data.dueDate) : null,
    companyId: user.companyId,
  }).returning()
  return c.json(item, 201)
})

app.put('/:id', requirePermission('punch-lists:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const data = schema.partial().parse(await c.req.json())
  // Scoped to the caller's company like the reads above, not matched on id alone.
  const [item] = await db.update(punchListItem).set({
    ...data,
    dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
    updatedAt: new Date(),
  }).where(and(eq(punchListItem.id, id), eq(punchListItem.companyId, user.companyId))).returning()
  if (!item) return c.json({ error: 'Punch list item not found' }, 404)
  return c.json(item)
})

app.delete('/:id', requirePermission('punch-lists:delete'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  // `returning()` so a delete that matched nothing is a 404 rather than a silent "deleted".
  const [gone] = await db.delete(punchListItem).where(and(eq(punchListItem.id, id), eq(punchListItem.companyId, user.companyId))).returning()
  if (!gone) return c.json({ error: 'Punch list item not found' }, 404)
  return c.json(null, 204)
})

/**
 * A PUNCH ITEM IS SIGNED OFF BY A SECOND PERSON. (T32 M2)
 *
 * The report pressed Verify on an OPEN item — as owner and as field — and both answered 200 with
 * status Verified. So the list could be signed off without the work being done, by the person who
 * was supposed to do it, and `verifiedBy` came from the request body.
 *
 * A punch list is the snag list a client walks at handover. Two rules:
 *
 *   open ──complete──▶ completed ──verify──▶ verified
 *
 *  1. VERIFY NEEDS COMPLETE FIRST. Signing off work nobody has said is finished is the whole point
 *     of the document, lost.
 *  2. SIGN-OFF IS MANAGER AND ABOVE. `punch-lists:update` is held by `field` deliberately — a
 *     technician marks their own work complete, which is right. Verification is somebody else
 *     checking it, so it asks for a right field does not hold. The report asked for exactly this:
 *     "Expected complete before verify, with sign-off limited to manager and above."
 *
 * …and the verifier is the signed-in person.
 */
const load = async (id: string, companyId: string) => {
  const [row] = await db.select().from(punchListItem)
    .where(and(eq(punchListItem.id, id), eq(punchListItem.companyId, companyId))).limit(1)
  return row || null
}

app.post('/:id/complete', requirePermission('punch-lists:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const existing = await load(id, user.companyId)
  if (!existing) return c.json({ error: 'Punch list item not found' }, 404)
  if (existing.status === 'verified') {
    return c.json({
      error: `${existing.number} has been verified and signed off. Reopen it if the work has to be redone.`,
      code: 'punch_item_verified',
      status: existing.status,
    }, 400)
  }
  const [item] = await db.update(punchListItem).set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() }).where(and(eq(punchListItem.id, id), eq(punchListItem.companyId, user.companyId))).returning()
  return c.json(item)
})

app.post('/:id/verify', requirePermission('punch-lists:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const existing = await load(id, user.companyId)
  if (!existing) return c.json({ error: 'Punch list item not found' }, 404)

  // Rule 2 first: who may sign off at all. `punch-lists:delete` is the nearest existing right that
  // field does not hold — manager and above — so no new resource is invented for one verb.
  if (!(await maySignOff(c))) {
    return c.json({
      error: 'Verifying a punch item is a second person signing off somebody else\'s work, so it needs a manager or above.',
      code: 'punch_verify_not_permitted',
      required: SIGN_OFF_PERMISSION,
    }, 403)
  }
  if (existing.status !== 'completed') {
    return c.json({
      error: existing.status === 'verified'
        ? `${existing.number} has already been verified.`
        : `${existing.number} is ${existing.status}. Mark it complete before verifying it — signing off work nobody has said is finished is what a punch list is for.`,
      code: 'punch_item_not_complete',
      status: existing.status,
      allowedFrom: ['completed'],
    }, 400)
  }

  const [item] = await db.update(punchListItem).set({
    status: 'verified',
    verifiedAt: new Date(),
    // The signed-in person, never the body.
    verifiedBy: await actorName(user),
    updatedAt: new Date(),
  }).where(and(eq(punchListItem.id, id), eq(punchListItem.companyId, user.companyId))).returning()
  return c.json(item)
})

/**
 * Reopen — because "verified" has to be reversible by somebody, or a mis-click at handover is
 * permanent. Same authority as verifying: the person who can sign off can un-sign-off.
 */
app.post('/:id/reopen', requirePermission('punch-lists:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const existing = await load(id, user.companyId)
  if (!existing) return c.json({ error: 'Punch list item not found' }, 404)
  if (existing.status === 'open') return c.json({ error: `${existing.number} is already open.`, code: 'punch_item_open' }, 400)
  if (existing.status === 'verified' && !(await maySignOff(c))) {
    return c.json({
      error: 'Reopening a verified punch item needs a manager or above, the same as verifying it.',
      code: 'punch_reopen_not_permitted',
      required: SIGN_OFF_PERMISSION,
    }, 403)
  }
  const [item] = await db.update(punchListItem).set({
    status: 'open', completedAt: null, verifiedAt: null, verifiedBy: null, updatedAt: new Date(),
  }).where(and(eq(punchListItem.id, id), eq(punchListItem.companyId, user.companyId))).returning()
  return c.json(item)
})

export default app

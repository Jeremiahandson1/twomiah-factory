import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { inspection, project, user } from '../../db/schema.ts'
import { eq, and, count, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { createActorName } from '../shared/index.ts'

const app = new Hono()
app.use('*', authenticate)

/** Who recorded the result, by name, for the record. (T32 M1) */
const actorName = createActorName({ db, tables: { user } })

const schema = z.object({ type: z.string(), projectId: z.string(), scheduledDate: z.string().optional(), inspector: z.string().optional(), notes: z.string().optional() })

app.get('/', async (c) => {
  const { status, projectId, page = '1', limit = '50' } = c.req.query() as any
  const user = c.get('user') as any
  const conditions: any[] = [eq(inspection.companyId, user.companyId)]
  if (status) conditions.push(eq(inspection.status, status))
  if (projectId) conditions.push(eq(inspection.projectId, projectId))

  const where = and(...conditions)
  const pageNum = +page
  const limitNum = +limit

  const [data, [{ value: total }]] = await Promise.all([
    db.select({
      inspection,
      project: { id: project.id, name: project.name },
    }).from(inspection)
      .leftJoin(project, eq(inspection.projectId, project.id))
      .where(where)
      .orderBy(desc(inspection.scheduledDate))
      .offset((pageNum - 1) * limitNum)
      .limit(limitNum),
    db.select({ value: count() }).from(inspection).where(where),
  ])

  // Flatten {inspection, project} → the inspection fields with a nested project,
  // so the list table (which reads flat number/type/status/date/inspector) works.
  const flat = (data as any[]).map((d) => ({ ...d.inspection, project: d.project }))
  return c.json({ data: flat, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } })
})

app.post('/', requirePermission('inspections:create'), async (c) => {
  const user = c.get('user') as any
  const data = schema.parse(await c.req.json())
  const [{ value: countVal }] = await db.select({ value: count() }).from(inspection).where(eq(inspection.companyId, user.companyId))
  const [item] = await db.insert(inspection).values({
    ...data,
    number: `INS-${String(countVal + 1).padStart(4, '0')}`,
    scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : null,
    companyId: user.companyId,
  }).returning()
  return c.json(item, 201)
})

app.put('/:id', requirePermission('inspections:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const data = schema.partial().parse(await c.req.json())
  // Scoped to the caller's company like the list above, not matched on id alone.
  const [item] = await db.update(inspection).set({
    ...data,
    scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : undefined,
    updatedAt: new Date(),
  }).where(and(eq(inspection.id, id), eq(inspection.companyId, user.companyId))).returning()
  if (!item) return c.json({ error: 'Inspection not found' }, 404)
  return c.json(item)
})

app.delete('/:id', requirePermission('inspections:delete'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  // `returning()` so a delete that matched nothing is a 404 rather than a silent "deleted".
  const [gone] = await db.delete(inspection).where(and(eq(inspection.id, id), eq(inspection.companyId, user.companyId))).returning()
  if (!gone) return c.json({ error: 'Inspection not found' }, 404)
  return c.json(null, 204)
})

/**
 * AN INSPECTION RESULT IS A FACT ABOUT A DATE. (T32 M1)
 *
 * The report failed INS-0001 and then passed it. The pass overwrote the failure IN PLACE — status
 * failed → passed, result fail → pass, deficiencies gone — so an inspection a building inspector had
 * failed read as if it had passed first time, with nothing anywhere to say otherwise. On a
 * construction job that record is the evidence.
 *
 * Also: the deficiencies could not be recorded at all (the screen hard-coded "See notes"), and an
 * inspection scheduled for 9 October could be failed on the 1st.
 *
 * So:
 *   · A RESULT IS FINAL. Pass and fail are recorded once, with who and when.
 *   · A RE-INSPECTION IS A NEW RECORD — POST /:id/reinspect — carrying `reinspectionOfId` back to
 *     the one it re-does. The failure stays exactly as it was, which is the whole point.
 *   · FAILING NEEDS A REASON, in words. "See notes" is not a deficiency list.
 *   · NEITHER RESULT CAN PREDATE THE VISIT. You cannot record what an inspector found on a day they
 *     have not been.
 */
const RESULTABLE = ['scheduled', 'in_progress', 'rescheduled']

const load = async (id: string, companyId: string) => {
  const [row] = await db.select().from(inspection)
    .where(and(eq(inspection.id, id), eq(inspection.companyId, companyId))).limit(1)
  return row || null
}

const alreadyResulted = (c: any, item: any) => c.json({
  error: `${item.number} was ${item.status}${item.resultedAt ? ` on ${new Date(item.resultedAt).toISOString().slice(0, 10)}` : ''}. A result is the record of what an inspector found, so it is not edited — book a re-inspection instead.`,
  code: 'inspection_already_resulted',
  status: item.status,
  reinspect: `POST /api/inspections/${item.id}/reinspect`,
}, 400)

/** The scheduled visit cannot be in the future when its result is recorded. */
const notYetVisited = (c: any, item: any) => {
  if (!item.scheduledDate) return null
  const when = new Date(item.scheduledDate)
  // Compared by DAY, not instant: an inspection scheduled for today at 14:00 can be recorded at 09:00
  // because the inspector came early, and that is ordinary. A date in the future is not.
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  if (day(when) <= day(new Date())) return null
  return c.json({
    error: `${item.number} is scheduled for ${when.toISOString().slice(0, 10)}, which has not happened yet. Move the date if the inspector came early.`,
    code: 'inspection_not_yet_due',
    scheduledDate: item.scheduledDate,
  }, 400)
}

app.post('/:id/pass', requirePermission('inspections:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const existing = await load(id, user.companyId)
  if (!existing) return c.json({ error: 'Inspection not found' }, 404)
  if (!RESULTABLE.includes(existing.status)) return alreadyResulted(c, existing)
  const early = notYetVisited(c, existing)
  if (early) return early
  const [item] = await db.update(inspection).set({
    status: 'passed', result: 'pass', resultedAt: new Date(), resultedBy: await actorName(user), updatedAt: new Date(),
  }).where(and(eq(inspection.id, id), eq(inspection.companyId, user.companyId))).returning()
  return c.json(item)
})

app.post('/:id/fail', requirePermission('inspections:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const deficiencies = typeof body?.deficiencies === 'string' ? body.deficiencies.trim() : ''

  const existing = await load(id, user.companyId)
  if (!existing) return c.json({ error: 'Inspection not found' }, 404)
  if (!RESULTABLE.includes(existing.status)) return alreadyResulted(c, existing)
  const early = notYetVisited(c, existing)
  if (early) return early

  /**
   * A failure has to say what failed. The screen sent the literal string "See notes" on every fail,
   * so the one field that carries what has to be put right said nothing — and the notes it pointed
   * at were usually empty too. 10 characters is not a quality bar; it refuses "ok", "x" and "See
   * notes" while asking nothing of somebody writing a real sentence.
   */
  if (deficiencies.length < 10 || /^see notes\.?$/i.test(deficiencies)) {
    return c.json({
      error: 'Say what failed. A re-inspection is booked against this list, so "See notes" leaves the crew nothing to fix.',
      code: 'deficiencies_required',
    }, 400)
  }

  const [item] = await db.update(inspection).set({
    status: 'failed', result: 'fail', deficiencies,
    resultedAt: new Date(), resultedBy: await actorName(user), updatedAt: new Date(),
  }).where(and(eq(inspection.id, id), eq(inspection.companyId, user.companyId))).returning()
  return c.json(item)
})

/**
 * Book the re-visit. A NEW inspection, linked back to the one it re-does.
 *
 * Carries the type, the project and the inspector across, and copies the deficiencies into its notes
 * so whoever turns up knows what they are looking at. The failed record is not touched.
 */
app.post('/:id/reinspect', requirePermission('inspections:create'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const existing = await load(id, user.companyId)
  if (!existing) return c.json({ error: 'Inspection not found' }, 404)
  if (existing.status !== 'failed') {
    return c.json({
      error: `${existing.number} is ${existing.status}. A re-inspection follows a failure.`,
      code: 'inspection_not_failed',
      status: existing.status,
    }, 400)
  }
  const [existingRe] = await db.select({ id: inspection.id, number: inspection.number }).from(inspection)
    .where(and(eq(inspection.companyId, user.companyId), eq(inspection.reinspectionOfId, id))).limit(1)
  if (existingRe) {
    return c.json({
      error: `${existing.number} has already been re-booked as ${existingRe.number}.`,
      code: 'reinspection_exists',
      inspectionId: existingRe.id,
    }, 409)
  }

  const [{ value: cnt }] = await db.select({ value: count() }).from(inspection)
    .where(and(eq(inspection.companyId, user.companyId), eq(inspection.projectId, existing.projectId)))
  const [made] = await db.insert(inspection).values({
    companyId: user.companyId,
    projectId: existing.projectId,
    number: `INS-${String(Number(cnt) + 1).padStart(4, '0')}`,
    type: existing.type,
    status: 'scheduled',
    scheduledDate: body?.scheduledDate ? new Date(body.scheduledDate) : null,
    inspector: body?.inspector ?? existing.inspector,
    notes: [`Re-inspection of ${existing.number}.`, existing.deficiencies ? `To put right:\n${existing.deficiencies}` : null]
      .filter(Boolean).join('\n\n'),
    reinspectionOfId: existing.id,
  } as any).returning()
  return c.json({ inspection: made, reinspectionOf: existing }, 201)
})

export default app

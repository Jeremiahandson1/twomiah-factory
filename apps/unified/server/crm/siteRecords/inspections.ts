// Inspections: a building inspector's visit and what they found. Moved from
// templates/crm/backend/src/routes/inspections.ts. The registry signs the person in and applies the 'inspections' gate.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, count, desc } from 'drizzle-orm'
import { createActorName, companyTimeZone, storeDateString, markerDay } from '@twomiah/tenant-backend'
import { inspection, project, user } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'

const schema = z.object({ type: z.string(), projectId: z.string(), scheduledDate: z.string().optional(), inspector: z.string().optional(), notes: z.string().optional() })

/**
 * AN INSPECTION RESULT IS A FACT ABOUT A DATE. (T32 M1)
 *
 *   · A RESULT IS FINAL. Pass and fail are recorded once, with who and when.
 *   · A RE-INSPECTION IS A NEW RECORD — POST /:id/reinspect — carrying `reinspectionOfId` back to the one it re-does.
 *   · FAILING NEEDS A REASON, in words. "See notes" is not a deficiency list.
 *   · NEITHER RESULT CAN PREDATE THE VISIT.
 */
const RESULTABLE = ['scheduled', 'in_progress', 'rescheduled']

export function createInspectionRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  /** Who recorded the result, by name, for the record. (T32 M1) */
  const actorName = createActorName({ db, tables: { user } } as any)

  const load = async (id: string, companyId: string) => {
    const [row] = await db.select().from(inspection)
      .where(and(eq(inspection.id, id), eq(inspection.companyId, companyId))).limit(1)
    return row || null
  }

  // `resulted_at` is an INSTANT, so its day is read in the COMPANY'S zone (storeDateString). (T33)
  const alreadyResulted = (c: any, item: any, tz: string) => fail(c, 400,
    `${item.number} was ${item.status}${item.resultedAt ? ` on ${storeDateString(new Date(item.resultedAt), tz)}` : ''}. A result is the record of what an inspector found, so it is not edited — book a re-inspection instead (POST /api/inspections/${item.id}/reinspect).`,
    'inspection_already_resulted')

  /**
   * The scheduled visit cannot be in the future when its result is recorded. Compared by DAY: scheduled_date is a
   * calendar-day column taken at face value (markerDay); "today" is an instant read in the company's zone.
   */
  const notYetVisited = (c: any, item: any, tz: string) => {
    if (!item.scheduledDate) return null
    const when = new Date(item.scheduledDate)
    if (markerDay(when) <= storeDateString(new Date(), tz)) return null
    return fail(c, 400, `${item.number} is scheduled for ${markerDay(when)}, which has not happened yet. Move the date if the inspector came early.`, 'inspection_not_yet_due')
  }

  const app = new Hono<AppEnv>()

  app.get('/', async (c) => {
    const { status, projectId, page = '1', limit = '50' } = c.req.query() as any
    const me = c.get('user') as any
    const conditions: any[] = [eq(inspection.companyId, me.companyId)]
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

    // Flatten {inspection, project} → the inspection fields with a nested project, so the list table (which reads
    // flat number/type/status/date/inspector) works.
    const flat = (data as any[]).map((r) => ({ ...r.inspection, project: r.project }))
    return list(c, flat, { page: pageNum, limit: limitNum, total: Number(total) })
  })

  app.post('/', requirePermission('inspections:create'), async (c) => {
    const me = c.get('user') as any
    const data = schema.parse(await c.req.json())
    const [{ value: countVal }] = await db.select({ value: count() }).from(inspection).where(eq(inspection.companyId, me.companyId))
    const [item] = await db.insert(inspection).values({
      ...data,
      number: `INS-${String(countVal + 1).padStart(4, '0')}`,
      scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : null,
      companyId: me.companyId,
    }).returning()
    return one(c, item, 201)
  })

  app.put('/:id', requirePermission('inspections:update'), async (c) => {
    const me = c.get('user') as any
    const id = c.req.param('id')
    const data = schema.partial().parse(await c.req.json())
    // Scoped to the caller's company like the list above, not matched on id alone.
    const [item] = await db.update(inspection).set({
      ...data,
      scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : undefined,
      updatedAt: new Date(),
    }).where(and(eq(inspection.id, id), eq(inspection.companyId, me.companyId))).returning()
    if (!item) return fail(c, 404, 'Inspection not found')
    return one(c, item)
  })

  app.delete('/:id', requirePermission('inspections:delete'), async (c) => {
    const me = c.get('user') as any
    const id = c.req.param('id')
    // `returning()` so a delete that matched nothing is a 404 rather than a silent "deleted".
    const [gone] = await db.delete(inspection).where(and(eq(inspection.id, id), eq(inspection.companyId, me.companyId))).returning()
    if (!gone) return fail(c, 404, 'Inspection not found')
    return c.body(null, 204)
  })

  app.post('/:id/pass', requirePermission('inspections:update'), async (c) => {
    const me = c.get('user') as any
    const id = c.req.param('id')
    const existing = await load(id, me.companyId)
    if (!existing) return fail(c, 404, 'Inspection not found')
    const tz = await companyTimeZone(db, me.companyId)
    if (!RESULTABLE.includes(existing.status)) return alreadyResulted(c, existing, tz)
    const early = notYetVisited(c, existing, tz)
    if (early) return early
    const [item] = await db.update(inspection).set({
      status: 'passed', result: 'pass', resultedAt: new Date(), resultedBy: await actorName(me), updatedAt: new Date(),
    }).where(and(eq(inspection.id, id), eq(inspection.companyId, me.companyId))).returning()
    return one(c, item)
  })

  app.post('/:id/fail', requirePermission('inspections:update'), async (c) => {
    const me = c.get('user') as any
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    const deficiencies = typeof body?.deficiencies === 'string' ? body.deficiencies.trim() : ''

    const existing = await load(id, me.companyId)
    if (!existing) return fail(c, 404, 'Inspection not found')
    const tz = await companyTimeZone(db, me.companyId)
    if (!RESULTABLE.includes(existing.status)) return alreadyResulted(c, existing, tz)
    const early = notYetVisited(c, existing, tz)
    if (early) return early

    // A failure has to say what failed. 10 characters refuses "ok", "x" and "See notes" while asking nothing of
    // somebody writing a real sentence.
    if (deficiencies.length < 10 || /^see notes\.?$/i.test(deficiencies)) {
      return fail(c, 400, 'Say what failed. A re-inspection is booked against this list, so "See notes" leaves the crew nothing to fix.', 'deficiencies_required')
    }

    const [item] = await db.update(inspection).set({
      status: 'failed', result: 'fail', deficiencies,
      resultedAt: new Date(), resultedBy: await actorName(me), updatedAt: new Date(),
    }).where(and(eq(inspection.id, id), eq(inspection.companyId, me.companyId))).returning()
    return one(c, item)
  })

  /**
   * Book the re-visit. A NEW inspection, linked back to the one it re-does. Carries the type, the project and the
   * inspector across, and copies the deficiencies into its notes. The failed record is not touched.
   */
  app.post('/:id/reinspect', requirePermission('inspections:create'), async (c) => {
    const me = c.get('user') as any
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    const existing = await load(id, me.companyId)
    if (!existing) return fail(c, 404, 'Inspection not found')
    if (existing.status !== 'failed') {
      return fail(c, 400, `${existing.number} is ${existing.status}. A re-inspection follows a failure.`, 'inspection_not_failed')
    }
    const [existingRe] = await db.select({ id: inspection.id, number: inspection.number }).from(inspection)
      .where(and(eq(inspection.companyId, me.companyId), eq(inspection.reinspectionOfId, id))).limit(1)
    if (existingRe) {
      return fail(c, 409, `${existing.number} has already been re-booked as ${existingRe.number}.`, 'reinspection_exists')
    }

    const [{ value: cnt }] = await db.select({ value: count() }).from(inspection)
      .where(and(eq(inspection.companyId, me.companyId), eq(inspection.projectId, existing.projectId)))
    const [made] = await db.insert(inspection).values({
      companyId: me.companyId,
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
    return one(c, { inspection: made, reinspectionOf: existing }, 201)
  })

  return app
}

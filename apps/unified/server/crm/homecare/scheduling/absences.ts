// /api/absences — caregiver absences (call-outs, sick days). Moved from templates/crm-homecare/backend/src/routes/absences.ts.
//
// Permissions (care-schedule): the office's list is :update and the delete :delete (the template's requireAdmin, as
// CVHC's was — a caregiver holds neither); a caregiver reads their own (GET /my) and reports their own (POST /,
// core/selfService.ts selfSubject: naming anyone else is a 403) with :read. Only the office sets who covers it.
//
// Replies: the two lists are list replies ({ data, pagination }); DELETE is { success }. A failure is the app's error
// reply (server/http/errors.ts) — the template answered a database error's own message with a 500.
import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { absences, user, clients } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { selfSubject } from '../core/selfService.ts'
import { who } from './shared.ts'

const asList = (c: any, rows: any[]) => list(c, rows, { page: 1, limit: rows.length, total: rows.length })

export function createAbsencesRoutes(_core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission
  const db = d.db

  // GET / — every absence (optional ?caregiverId), with caregiver and client names. The office's list; a caregiver
  // reads their own through GET /my.
  app.get('/', perm('care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const caregiverId = c.req.query('caregiverId')
    const rows = await db
      .select({
        id: absences.id,
        caregiverId: absences.caregiverId,
        clientId: absences.clientId,
        date: absences.date,
        type: absences.type,
        reason: absences.reason,
        reportedById: absences.reportedById,
        coverageNeeded: absences.coverageNeeded,
        coverageAssignedTo: absences.coverageAssignedTo,
        createdAt: absences.createdAt,
        caregiverFirstName: user.firstName,
        caregiverLastName: user.lastName,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
      })
      .from(absences)
      .leftJoin(user, eq(absences.caregiverId, user.id))
      .leftJoin(clients, eq(absences.clientId, clients.id))
      .where(and(eq(absences.companyId, companyId), caregiverId ? eq(absences.caregiverId, caregiverId) : undefined))
      .orderBy(desc(absences.date))
    return asList(c, rows)
  })

  // GET /my — the signed-in caregiver's own absences
  app.get('/my', perm('care-schedule:read'), async (c) => {
    const { companyId, me } = who(c)
    const rows = await db
      .select({
        id: absences.id,
        caregiverId: absences.caregiverId,
        clientId: absences.clientId,
        date: absences.date,
        type: absences.type,
        reason: absences.reason,
        reportedById: absences.reportedById,
        coverageNeeded: absences.coverageNeeded,
        coverageAssignedTo: absences.coverageAssignedTo,
        createdAt: absences.createdAt,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
      })
      .from(absences)
      .leftJoin(clients, eq(absences.clientId, clients.id))
      .where(and(eq(absences.companyId, companyId), eq(absences.caregiverId, me)))
      .orderBy(desc(absences.date))
    return asList(c, rows)
  })

  // POST / — report an absence. The office records one for any caregiver; a caregiver reports their OWN — a
  // caregiverId naming anyone else is a 403 (CVHC let any signed-in user name any caregiver). Who covers it is the
  // office's to arrange, so only the office sets the coverage fields.
  app.post('/', perm('care-schedule:read'), async (c) => {
    const { companyId, me } = who(c)
    const body = await c.req.json().catch(() => ({})) as any
    const subject = await selfSubject(d, c, body.caregiverId, 'care-schedule:create')
    if ('refusal' in subject) return subject.refusal
    if (!body.date || !body.type) return fail(c, 400, 'caregiverId, date, and type are required')
    const [row] = await db
      .insert(absences)
      .values({
        companyId,
        caregiverId: subject.id,
        clientId: body.clientId || null,
        date: body.date,
        type: body.type,
        reason: body.reason || null,
        notes: body.notes || null,
        reportedById: me,
        ...(subject.office && body.coverageAssignedTo ? { coverageAssignedTo: body.coverageAssignedTo } : {}),
        ...(subject.office && typeof body.coverageNeeded === 'boolean' ? { coverageNeeded: body.coverageNeeded } : {}),
      })
      .returning()
    return one(c, row, 201)
  })

  // DELETE /:id — the office's (CVHC: requireAdmin)
  app.delete('/:id', perm('care-schedule:delete'), async (c) => {
    const { companyId } = who(c)
    await db.delete(absences).where(and(eq(absences.id, c.req.param('id')), eq(absences.companyId, companyId)))
    return done(c)
  })

  return app
}

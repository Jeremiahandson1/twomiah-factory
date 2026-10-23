// /api/blackout-dates — a caregiver's blackout dates (caregiver_time_off rows of type 'blackout'). Moved from
// templates/crm-homecare/backend/src/routes/blackoutDates.ts.
//
// A caregiver's blackout dates are their own: the office sees and edits everyone's, a caregiver only theirs (CVHC's
// DELETE had verifyToken only — any signed-in user could delete anyone's; the template made that a 403). Every action
// is care-schedule:read, which a caregiver holds, narrowed through core/selfService.ts (selfSubject, ownsRow) as the
// template narrowed it.
//
// Replies: the list is a list reply ({ data, pagination }); DELETE is { success }. A failure is the app's error reply
// (the template answered a database error's own message with a 500).
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { caregiverTimeOff, user } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { actsForAnyone } from '../core/caregiverAccess.ts'
import { selfSubject, ownsRow } from '../core/selfService.ts'
import { who } from './shared.ts'

export function createBlackoutDatesRoutes(_core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const db = d.db
  app.use('*', d.permissions.requirePermission('care-schedule:read'))

  // GET / — the blackout dates with the caregiver's name (a caregiver: their own)
  app.get('/', async (c) => {
    const { user: me, companyId, me: myId } = who(c)
    const mine = (await actsForAnyone(d, me, 'care-schedule:read')) ? undefined : eq(caregiverTimeOff.caregiverId, myId)
    const rows = await db
      .select({
        id: caregiverTimeOff.id,
        caregiverId: caregiverTimeOff.caregiverId,
        startDate: caregiverTimeOff.startDate,
        endDate: caregiverTimeOff.endDate,
        type: caregiverTimeOff.type,
        reason: caregiverTimeOff.reason,
        approvedById: caregiverTimeOff.approvedById,
        status: caregiverTimeOff.status,
        createdAt: caregiverTimeOff.createdAt,
        caregiverFirstName: user.firstName,
        caregiverLastName: user.lastName,
      })
      .from(caregiverTimeOff)
      .leftJoin(user, eq(caregiverTimeOff.caregiverId, user.id))
      .where(and(eq(caregiverTimeOff.companyId, companyId), eq(caregiverTimeOff.type, 'blackout'), mine))
    return listAll(c, rows)
  })

  // POST / — a blackout date. The office names the caregiver; a caregiver adds their own (a caregiverId for anyone else
  // is a 403).
  app.post('/', async (c) => {
    const { companyId } = who(c)
    const body = await c.req.json().catch(() => ({})) as any
    const subject = await selfSubject(d, c, body.caregiverId, 'care-schedule:create')
    if ('refusal' in subject) return subject.refusal
    if (!body.startDate || !body.endDate) return fail(c, 400, 'startDate and endDate are required')
    const [row] = await db
      .insert(caregiverTimeOff)
      .values({ companyId, caregiverId: subject.id, startDate: body.startDate, endDate: body.endDate, reason: body.reason || null, type: 'blackout' })
      .returning()
    return one(c, row, 201)
  })

  // DELETE /:id — the office any; a caregiver only their own
  app.delete('/:id', async (c) => {
    const { companyId } = who(c)
    const id = c.req.param('id')
    const mine = and(eq(caregiverTimeOff.id, id), eq(caregiverTimeOff.companyId, companyId), eq(caregiverTimeOff.type, 'blackout'))
    const [row] = await db.select({ caregiverId: caregiverTimeOff.caregiverId }).from(caregiverTimeOff).where(mine).limit(1)
    if (!row) return fail(c, 404, 'Blackout date not found')
    if (!(await ownsRow(d, c, row.caregiverId, 'care-schedule:delete'))) return fail(c, 403, 'You can only remove your own blackout dates.')
    await db.delete(caregiverTimeOff).where(mine)
    return done(c)
  })

  return app
}

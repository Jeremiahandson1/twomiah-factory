// /api/pto — paid time off, vacation and sick requests (caregiver_time_off rows of those types). Moved from
// templates/crm-homecare/backend/src/routes/pto.ts.
//
// Open to anyone signed in, as the template was, narrowed the same way: the office (admin / owner) lists everyone's and
// records a request for any caregiver; a caregiver lists and requests only their own — a caregiverId naming anyone else
// is a 403 (core/selfService.ts selfSubject). Gates: listing is care-payroll:read or a caregiver, requesting
// care-payroll:create or a caregiver (shared.ts payrollOrCaregiver); answering a request is care-payroll:update, which a
// caregiver does not hold (the template: requireAdmin).
//
// Changes from the template: the company's requests only (a new one is the company's, for a caregiver of the
// company); GET / is a list reply ({ data, pagination }, was a bare array).
import { Hono } from 'hono'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { caregiverTimeOff, user } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { actsForAnyone } from '../core/caregiverAccess.ts'
import { selfSubject } from '../core/selfService.ts'
import { isCompanyPerson, payrollOrCaregiver } from './shared.ts'

// The time-off kinds the office records: the payroll screen offers all seven (the template's route took three and refused
// personal days, bereavement, jury duty and unpaid leave, which the screen still offered). Kept as records; nothing pays
// from this table. 'blackout' rows share the table and are not time off.
const PTO_TYPES = ['pto', 'vacation', 'sick', 'personal', 'bereavement', 'jury_duty', 'unpaid']

export function createPtoRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  // GET / — every request for the office, a caregiver's own for a caregiver; latest start first.
  app.get('/', payrollOrCaregiver(d, 'read'), async (c) => {
    const me = c.get('user')
    const rows = await db.select({
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
      .where(and(
        eq(caregiverTimeOff.companyId, me.companyId),
        inArray(caregiverTimeOff.type, PTO_TYPES),
        (await actsForAnyone(d, me, 'care-payroll:read')) ? undefined : eq(caregiverTimeOff.caregiverId, me.userId),
      ))
      .orderBy(desc(caregiverTimeOff.startDate))
    const entries = (rows as any[]).map(({ caregiverFirstName, caregiverLastName, ...entry }) => ({
      ...entry,
      caregiverName: caregiverFirstName ? `${caregiverFirstName} ${caregiverLastName}` : null,
    }))
    return list(c, entries, { page: 1, limit: entries.length, total: entries.length })
  })

  // POST / — the office records a request for any caregiver of the company; a caregiver requests their own.
  app.post('/', payrollOrCaregiver(d, 'create'), async (c) => {
    const me = c.get('user')
    const body = await c.req.json().catch(() => ({})) as any
    const who = await selfSubject(d, c, body.caregiverId, 'care-payroll:create')
    if ('refusal' in who) return who.refusal
    if (who.office && who.id !== me.userId && !(await isCompanyPerson(d, me.companyId, who.id))) return fail(c, 404, 'Caregiver not found')

    const type = body.type || 'pto'
    if (!PTO_TYPES.includes(type)) return fail(c, 400, `Invalid type. Must be one of: ${PTO_TYPES.join(', ')}`)
    if (!body.startDate || !body.endDate) return fail(c, 400, 'startDate and endDate are required')

    const [entry] = await db.insert(caregiverTimeOff).values({
      companyId: me.companyId,
      caregiverId: who.id,
      startDate: body.startDate,
      endDate: body.endDate,
      type,
      reason: body.reason || body.notes || null,
      status: 'pending',
    }).returning()
    return one(c, entry, 201)
  })

  // POST /:id/approve | /:id/deny — the office answers a request.
  const answer = (status: 'approved' | 'denied') => async (c: any) => {
    const me = c.get('user')
    const [row] = await db.update(caregiverTimeOff)
      .set({ status, approvedById: status === 'approved' ? me.userId : null })
      .where(and(eq(caregiverTimeOff.id, c.req.param('id')), eq(caregiverTimeOff.companyId, me.companyId), inArray(caregiverTimeOff.type, PTO_TYPES)))
      .returning()
    if (!row) return fail(c, 404, 'Time-off request not found')
    return one(c, row)
  }
  app.post('/:id/approve', requirePermission('care-payroll:update'), answer('approved'))
  app.post('/:id/deny', requirePermission('care-payroll:update'), answer('denied'))

  return app
}

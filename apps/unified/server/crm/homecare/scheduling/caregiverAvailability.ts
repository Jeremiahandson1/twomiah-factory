// /api/caregiver-availability — a caregiver's availability (one row per caregiver). Moved from
// templates/crm-homecare/backend/src/routes/caregiverAvailability.ts.
//
// The office reads and edits anyone's, a caregiver only their own (CVHC caregiverRoutes.js: requireAdminOrSelf; here
// core/selfService.ts requireAdminOrSelf). The caregiver dashboard saves here. Both actions are care-schedule:read,
// which a caregiver holds, narrowed by requireAdminOrSelf as the template narrowed them.
//
// Replies: the row (camelCase). A missing row is { error: 'No availability record found' } 404 (the template answered
// { message } with the 404). A failure is the app's error reply (the template answered a database error's own message).
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { caregiverAvailability, user } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { requireAdminOrSelf } from '../core/selfService.ts'
import { who } from './shared.ts'

export function createCaregiverAvailabilityRoutes(_core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const perm = d.permissions.requirePermission
  const db = d.db

  // GET /:id — by caregiverId (not by row id)
  app.get('/:id', perm('care-schedule:read'), requireAdminOrSelf(d, 'id', 'care-schedule:read'), async (c) => {
    const { companyId } = who(c)
    const [row] = await db.select().from(caregiverAvailability)
      .where(and(eq(caregiverAvailability.caregiverId, c.req.param('id')!), eq(caregiverAvailability.companyId, companyId))).limit(1)
    if (!row) return fail(c, 404, 'No availability record found')
    return one(c, row)
  })

  // PUT /:id — upsert by caregiverId. The row's owner is the path's caregiver — an id / caregiverId / companyId in the
  // body never moves the row to someone else.
  app.put('/:id', perm('care-schedule:read'), requireAdminOrSelf(d, 'id', 'care-schedule:update'), async (c) => {
    const { companyId } = who(c)
    const caregiverId = c.req.param('id')!
    const { id: _id, caregiverId: _cg, companyId: _co, createdAt: _ca, updatedAt: _ua, ...body } = await c.req.json().catch(() => ({})) as any

    // "Hours I want" belongs to care_pickup_rewards: an agency without it answers 403 and the field is never stored.
    if (body.hoursWanted !== undefined && !(await d.features.isFeatureEnabled(companyId, 'care_pickup_rewards'))) return fail(c, 403, 'Hours wanted is not turned on for this agency', 'FEATURE_NOT_ENABLED')
    // Hours a week (care_pickup_rewards: the phone's "hours I want"): whole hours, 0 to 168; null clears the wish.
    for (const [key, label] of [['hoursWanted', 'Hours wanted'], ['maxHoursPerWeek', 'The most hours a week']] as const) {
      if (body[key] === undefined || (key === 'hoursWanted' && body[key] === null)) continue
      const n = typeof body[key] === 'string' && body[key].trim() !== '' ? Number(body[key]) : body[key]
      if (!Number.isInteger(n) || n < 0 || n > 168) return fail(c, 400, `${label} must be a whole number of hours from 0 to 168.`)
      body[key] = n
    }
    const [existing] = await db.select({ id: caregiverAvailability.id, companyId: caregiverAvailability.companyId }).from(caregiverAvailability)
      .where(eq(caregiverAvailability.caregiverId, caregiverId)).limit(1)
    if (existing) {
      if (existing.companyId !== companyId) return fail(c, 404, 'Caregiver not found')
      const [row] = await db.update(caregiverAvailability).set({ ...body, updatedAt: new Date() })
        .where(and(eq(caregiverAvailability.caregiverId, caregiverId), eq(caregiverAvailability.companyId, companyId))).returning()
      return one(c, row)
    }
    // A new row only for a person of this company.
    const [person] = await db.select({ id: user.id }).from(user).where(and(eq(user.id, caregiverId), eq(user.companyId, companyId))).limit(1)
    if (!person) return fail(c, 404, 'Caregiver not found')
    const [row] = await db.insert(caregiverAvailability).values({ ...body, caregiverId, companyId }).returning()
    return one(c, row, 201)
  })

  return app
}

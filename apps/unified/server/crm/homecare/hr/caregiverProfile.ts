// The office's notes, capabilities, limitations and billing ids about a caregiver (caregiver_profiles). Moved from
// templates/crm-homecare/backend/src/routes/caregiverProfile.ts, mounted at /api/caregiver-profile.
//
// Reads: the office reads anyone's, a caregiver only their own (requireAdminOrSelf, as the template). Writes: the office
// (care-hr:update; the template's requireAdmin). Changes: the company's rows only; a caregiver with no profile yet is a
// 404 with code none_on_file (the template answered null, which is not a record — RULEBOOK §3).
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { caregiverProfiles } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { requireAdminOrSelf } from '../core/selfService.ts'
import { body, companyOf, personInCompany, idOf } from './shared.ts'

export function createCaregiverProfileRoutes(_core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions

  // GET /api/caregiver-profile/:id — by caregiver id.
  app.get('/:id', requireAdminOrSelf('id'), async (c) => {
    const [row] = await d.db.select().from(caregiverProfiles)
      .where(and(eq(caregiverProfiles.companyId, companyOf(c)), eq(caregiverProfiles.caregiverId, idOf(c))))
      .limit(1)
    if (!row) return fail(c, 404, 'No profile on file for this caregiver yet', 'none_on_file')
    return one(c, row)
  })

  // PUT/PATCH /api/caregiver-profile/:id — upsert by caregiver id (the profile editor calls PATCH; PUT kept).
  const upsertProfile = async (c: any) => {
    const companyId = companyOf(c)
    const caregiverId = idOf(c)
    const b = await body(c)
    if (!(await personInCompany(d, companyId, caregiverId))) return fail(c, 404, 'Caregiver not found')
    const fields = {
      notes: b.notes,
      capabilities: b.capabilities,
      limitations: b.limitations,
      preferredHours: b.preferredHours,
      availableMon: b.availableMon,
      availableTue: b.availableTue,
      availableWed: b.availableWed,
      availableThu: b.availableThu,
      availableFri: b.availableFri,
      availableSat: b.availableSat,
      availableSun: b.availableSun,
      npiNumber: b.npiNumber,
      taxonomyCode: b.taxonomyCode,
      evvWorkerId: b.evvWorkerId,
      medicaidProviderId: b.medicaidProviderId,
    }
    const mine = and(eq(caregiverProfiles.companyId, companyId), eq(caregiverProfiles.caregiverId, caregiverId))
    const [existing] = await d.db.select({ id: caregiverProfiles.id }).from(caregiverProfiles).where(mine).limit(1)
    if (existing) {
      const [row] = await d.db.update(caregiverProfiles).set({ ...fields, updatedAt: new Date() }).where(mine).returning()
      return one(c, row)
    }
    const [row] = await d.db.insert(caregiverProfiles).values({ ...fields, caregiverId, companyId }).returning()
    return one(c, row, 201)
  }
  app.put('/:id', requirePermission('care-hr:update'), upsertProfile)
  app.patch('/:id', requirePermission('care-hr:update'), upsertProfile)

  return app
}

// The office's notes, capabilities, limitations and billing ids about a caregiver (caregiver_profiles). Moved from
// templates/crm-homecare/backend/src/routes/caregiverProfile.ts, mounted at /api/caregiver-profile.
//
// Reads: the office reads anyone's, a caregiver only their own (requireAdminOrSelf, as the template). Writes: the office
// (care-hr:update; the template's requireAdmin). Changes: the company's rows only; a caregiver with no profile yet is a
// 404 with code none_on_file (the template answered null, which is not a record — RULEBOOK §3).
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { caregiverProfiles, serviceLocations, user } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { requireAdminOrSelf } from '../core/selfService.ts'
import { body, companyOf, personInCompany, idOf } from './shared.ts'
import { isYmd } from '../core/agencyTime.ts'

/**
 * Row 11 (care_margin_reports): the placement keys of a profile body — branchId (one of the agency's service locations), team,
 * department, managerUserId (someone of the agency), leftOn (a date) and leftReason — each checked, each only when sent. An empty
 * string clears a field. A problem names the box.
 */
export type Placement = { branchId?: string | null; team?: string | null; department?: string | null; managerUserId?: string | null; leftOn?: string | null; leftReason?: string | null }
export async function placement(d: CrmDeps, companyId: string, b: any): Promise<{ placed: Placement } | { problem: string; fields: Record<string, string> }> {
  const out: Record<string, unknown> = {}
  const text = (k: string, max: number) => { if (b[k] !== undefined) out[k] = b[k] === null || String(b[k]).trim() === '' ? null : String(b[k]).trim().slice(0, max) }
  text('team', 80); text('department', 80); text('leftReason', 300)
  if (b.branchId !== undefined) {
    if (b.branchId === null || b.branchId === '') out.branchId = null
    else {
      const [row] = await d.db.select({ id: serviceLocations.id }).from(serviceLocations).where(and(eq(serviceLocations.id, String(b.branchId)), eq(serviceLocations.companyId, companyId))).limit(1)
      if (!row) return { problem: 'Pick one of the agency\'s branches.', fields: { branchId: 'Not one of your branches' } }
      out.branchId = row.id
    }
  }
  if (b.managerUserId !== undefined) {
    if (b.managerUserId === null || b.managerUserId === '') out.managerUserId = null
    else {
      const [row] = await d.db.select({ id: user.id }).from(user).where(and(eq(user.id, String(b.managerUserId)), eq(user.companyId, companyId))).limit(1)
      if (!row) return { problem: 'Pick a manager from your own staff.', fields: { managerUserId: 'Not one of your staff' } }
      out.managerUserId = row.id
    }
  }
  if (b.leftOn !== undefined) {
    if (b.leftOn === null || b.leftOn === '') out.leftOn = null
    else if (!isYmd(b.leftOn)) return { problem: 'The leaving date must be a date (YYYY-MM-DD).', fields: { leftOn: 'Enter a date' } }
    else out.leftOn = b.leftOn
  }
  return { placed: out as Placement }
}

export function createCaregiverProfileRoutes(_core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions

  // GET /api/caregiver-profile/:id — by caregiver id.
  app.get('/:id', requireAdminOrSelf(d, 'id', 'care-hr:read'), async (c) => {
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
    const placement_ = await placement(d, companyId, b)
    if ('problem' in placement_) return fail(c, 400, placement_.problem, 'bad_placement', placement_.fields)
    const placed = placement_.placed
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
      // Row 11 (care_margin_reports): where the caregiver sits (branch, team, department, manager) and the day they left. Checked
      // by placement(); a key the body did not send is left as it was.
      ...placed,
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

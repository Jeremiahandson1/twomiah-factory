// Reading a client's vitals (client_vitals), newest first, with the name of whoever took them. Shared by the staff
// route (/api/medications/vitals/*) and the family portal's vitals view. Moved from
// templates/crm-homecare/backend/src/services/vitals.ts.
//
// Changes: the query builder instead of raw SQL, scoped to the company; the row is camelCase (systolicBp,
// caregiverFirst …). recorded_at / created_at hold UTC and leave as instants, as the template made them leave (it
// formatted them 'YYYY-MM-DDTHH:MM:SSZ' by hand; the query builder's Date serialises to the same instant).
import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { clientVitals, user } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'

export function createVitals(d: CrmDeps) {
  async function listClientVitals(companyId: string, clientId: string, limit = 50, opts: { from?: Date; to?: Date } = {}): Promise<any[]> {
    const lim = Math.min(Math.max(Math.trunc(Number(limit)) || 50, 1), 500)
    const cv = clientVitals
    return d.db.select({
      id: cv.id, clientId: cv.clientId, caregiverId: cv.caregiverId, timeEntryId: cv.timeEntryId,
      systolicBp: cv.systolicBp, diastolicBp: cv.diastolicBp, pulse: cv.pulse, respirations: cv.respirations,
      oxygenSaturation: cv.oxygenSaturation, temperatureF: cv.temperatureF, bloodGlucose: cv.bloodGlucose,
      weightLbs: cv.weightLbs, painScale: cv.painScale, painLocation: cv.painLocation, notes: cv.notes,
      recordedAt: cv.recordedAt, createdAt: cv.createdAt,
      caregiverFirst: user.firstName, caregiverLast: user.lastName,
    })
      .from(cv)
      .leftJoin(user, eq(cv.caregiverId, user.id))
      .where(and(
        eq(cv.companyId, companyId),
        eq(cv.clientId, clientId),
        opts.from ? gte(cv.recordedAt, opts.from) : undefined,
        opts.to ? lte(cv.recordedAt, opts.to) : undefined,
      ))
      .orderBy(desc(cv.recordedAt))
      .limit(lim)
  }
  return { listClientVitals }
}

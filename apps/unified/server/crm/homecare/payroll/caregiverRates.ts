// /api/caregiver-rates — a caregiver's base, overtime and premium pay rates, each with the date it took effect. Moved
// from templates/crm-homecare/backend/src/routes/caregiverRates.ts.
//
// Reading: care-payroll:read or a caregiver (shared.ts payrollOrCaregiver), and the office reads anyone's while a caregiver reads only their own
// (core/selfService.ts requireAdminOrSelf — the template's rule). Setting: care-payroll:update, the payroll write a
// caregiver does not hold (the template: requireAdmin).
//
// Changes from the template: the company's rates and caregivers only (a rate set is the company's); "today" — which
// rate is in force, and the default effective date of a new one — is the agency's calendar day (core/agencyTime.ts;
// the template took UTC's, so from the evening on a rate starting tomorrow already showed as current); the history is a
// list reply ({ data, pagination }, was a bare array).
import { Hono } from 'hono'
import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm'
import { caregiverRates } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { requireAdminOrSelf } from '../core/selfService.ts'
import { isCompanyPerson, payrollOrCaregiver } from './shared.ts'

const RATE_TYPES = ['base', 'overtime', 'premium'] as const

export function createCaregiverRateRoutes(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  // GET /:caregiverId — the rates in force today, one per type.
  app.get('/:caregiverId', payrollOrCaregiver(d, 'read'), requireAdminOrSelf(d, 'caregiverId', 'care-payroll:read'), async (c) => {
    const { companyId } = c.get('user')
    const caregiverId = c.req.param('caregiverId') as string
    const today = await core.time.today(companyId)

    const rows = await db.select().from(caregiverRates)
      .where(and(
        eq(caregiverRates.companyId, companyId),
        eq(caregiverRates.caregiverId, caregiverId),
        lte(caregiverRates.effectiveDate, today),
        or(isNull(caregiverRates.endDate), gte(caregiverRates.endDate, today)),
      ))
      .orderBy(desc(caregiverRates.effectiveDate))

    // The most recent of each type.
    const current: Record<string, any> = {}
    for (const r of rows as any[]) if (!current[r.rateType]) current[r.rateType] = r
    return one(c, { caregiverId, base: current.base || null, overtime: current.overtime || null, premium: current.premium || null })
  })

  // GET /:caregiverId/history — every rate, newest first (at most 100).
  app.get('/:caregiverId/history', payrollOrCaregiver(d, 'read'), requireAdminOrSelf(d, 'caregiverId', 'care-payroll:read'), async (c) => {
    const { companyId } = c.get('user')
    const rows = await db.select().from(caregiverRates)
      .where(and(eq(caregiverRates.companyId, companyId), eq(caregiverRates.caregiverId, c.req.param('caregiverId') as string)))
      .orderBy(desc(caregiverRates.effectiveDate))
      .limit(100)
    return list(c, rows, { page: 1, limit: 100, total: rows.length })
  })

  // PUT /:caregiverId { base?, overtime?, premium?, effectiveDate?, notes? } — a new rate per type given; the one it
  // replaces ends on the new one's effective date.
  app.put('/:caregiverId', requirePermission('care-payroll:update'), async (c) => {
    const me = c.get('user')
    const caregiverId = c.req.param('caregiverId')
    const body = await c.req.json().catch(() => ({})) as any
    if (!(await isCompanyPerson(d, me.companyId, caregiverId))) return fail(c, 404, 'Caregiver not found')

    const effectiveDate = body.effectiveDate || await core.time.today(me.companyId)
    const results: any[] = []
    for (const rateType of RATE_TYPES) {
      const rateValue = body[rateType]
      if (rateValue === undefined || rateValue === null) continue

      // End-date the active rate of this type.
      await db.update(caregiverRates)
        .set({ endDate: effectiveDate, updatedAt: new Date() })
        .where(and(
          eq(caregiverRates.companyId, me.companyId),
          eq(caregiverRates.caregiverId, caregiverId),
          eq(caregiverRates.rateType, rateType),
          isNull(caregiverRates.endDate),
        ))
      const [newRate] = await db.insert(caregiverRates).values({
        companyId: me.companyId,
        caregiverId,
        rateType,
        hourlyRate: String(rateValue),
        effectiveDate,
        notes: body.notes || null,
        createdById: me.userId,
      }).returning()
      results.push(newRate)
    }
    return list(c, results, { page: 1, limit: results.length, total: results.length })
  })

  return app
}

// /api/caregiver-care-type-rates — a caregiver's pay per care type (hourly, overtime, holiday). Moved from
// templates/crm-homecare/backend/src/routes/caregiverCareTypeRates.ts.
//
// Reading: care-payroll:read or a caregiver (shared.ts payrollOrCaregiver); the office reads anyone's (or all), a caregiver only their own — a caregiverId naming
// anyone else is a 403 (core/selfService.ts selfSubject, the template's rule). Setting: care-payroll:update, the payroll
// write a caregiver does not hold (the template: requireAdmin) — a caregiver's pay is the office's to set.
//
// Changes from the template: the company's rates only; a new or changed rate takes only the rate's own fields (the
// template wrote the request body as it came, so a body could set any column, the company's included) and names a
// caregiver and a care type of the company; a PUT naming no rate of the company is a 404 (the template answered 200
// with nothing); GET / is a list reply ({ data, pagination }, was a bare array); errors are the app's error replies
// rather than a hand-made { error: message } 500.
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { careTypes, caregiverCareTypeRates } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { selfSubject } from '../core/selfService.ts'
import { isCompanyPerson, payrollOrCaregiver } from './shared.ts'

/** The fields of a rate the office sets. */
function rateFields(body: any) {
  const out: Record<string, unknown> = {}
  for (const k of ['caregiverId', 'careTypeId', 'hourlyRate', 'overtimeRate', 'holidayRate'] as const) {
    if (body?.[k] !== undefined) out[k] = body[k]
  }
  return out
}

export function createCaregiverCareTypeRateRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  async function isCompanyCareType(companyId: string, id: unknown): Promise<boolean> {
    if (typeof id !== 'string' || !id) return false
    const [t] = await db.select({ id: careTypes.id }).from(careTypes).where(and(eq(careTypes.id, id), eq(careTypes.companyId, companyId))).limit(1)
    return !!t
  }

  /** null when the rate's caregiver and care type (where given) are the company's; else the refusal. */
  async function namesRefusal(c: any, companyId: string, fields: Record<string, unknown>): Promise<Response | null> {
    if (fields.caregiverId !== undefined && !(await isCompanyPerson(d, companyId, fields.caregiverId))) return fail(c, 404, 'Caregiver not found')
    if (fields.careTypeId !== undefined && !(await isCompanyCareType(companyId, fields.careTypeId))) return fail(c, 404, 'Care type not found')
    return null
  }

  // GET /?caregiverId= — with each care type's name.
  app.get('/', payrollOrCaregiver(d, 'read'), async (c) => {
    const { companyId } = c.get('user')
    const who = selfSubject(c, c.req.query('caregiverId'))
    if ('refusal' in who) return who.refusal
    const caregiverId = who.office ? c.req.query('caregiverId') : who.id

    const rows = await db.select({
      id: caregiverCareTypeRates.id,
      caregiverId: caregiverCareTypeRates.caregiverId,
      careTypeId: caregiverCareTypeRates.careTypeId,
      hourlyRate: caregiverCareTypeRates.hourlyRate,
      overtimeRate: caregiverCareTypeRates.overtimeRate,
      holidayRate: caregiverCareTypeRates.holidayRate,
      createdAt: caregiverCareTypeRates.createdAt,
      updatedAt: caregiverCareTypeRates.updatedAt,
      careTypeName: careTypes.name,
    })
      .from(caregiverCareTypeRates)
      .leftJoin(careTypes, eq(caregiverCareTypeRates.careTypeId, careTypes.id))
      .where(and(eq(caregiverCareTypeRates.companyId, companyId), caregiverId ? eq(caregiverCareTypeRates.caregiverId, caregiverId) : undefined))
    return list(c, rows, { page: 1, limit: rows.length, total: rows.length })
  })

  // POST / { caregiverId, careTypeId, hourlyRate?, overtimeRate?, holidayRate? }
  app.post('/', requirePermission('care-payroll:update'), async (c) => {
    const { companyId } = c.get('user')
    const fields = rateFields(await c.req.json().catch(() => ({})))
    const refused = await namesRefusal(c, companyId, fields)
    if (refused) return refused
    const [row] = await db.insert(caregiverCareTypeRates).values({ ...(fields as any), companyId }).returning()
    return one(c, row, 201)
  })

  // PUT /:id
  app.put('/:id', requirePermission('care-payroll:update'), async (c) => {
    const { companyId } = c.get('user')
    const fields = rateFields(await c.req.json().catch(() => ({})))
    const refused = await namesRefusal(c, companyId, fields)
    if (refused) return refused
    const [row] = await db.update(caregiverCareTypeRates)
      .set({ ...(fields as any), updatedAt: new Date() })
      .where(and(eq(caregiverCareTypeRates.id, c.req.param('id')), eq(caregiverCareTypeRates.companyId, companyId)))
      .returning()
    if (!row) return fail(c, 404, 'Rate not found')
    return one(c, row)
  })

  return app
}

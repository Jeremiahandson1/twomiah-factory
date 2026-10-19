// /api/mileage — caregivers' trips, paid at the agency's rate per mile. Moved from
// templates/crm-homecare/backend/src/routes/mileage.ts.
//
// Open to anyone signed in, as the template was, narrowed the same way: the office (admin / owner) sees and records
// anyone's; a caregiver sees only their own and records only their own — a caregiverId they send is ignored, and so is
// a rate (the agency's, company.mileage_rate, set in Payroll → Settings). Gates: listing is care-payroll:read or a
// caregiver, recording care-payroll:create or a caregiver (shared.ts payrollOrCaregiver).
//
// Changes from the template: the company's trips only, at the company's rate; GET / is a list reply
// ({ data, pagination }, was { entries, total, page, pages }); the office naming a caregiver or a client who is not the
// company's is refused (404), rather than writing a row that points into another company.
import { Hono } from 'hono'
import { and, count, desc, eq, gte, lte } from 'drizzle-orm'
import { clients, mileageEntries, user } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { isOfficeUser } from '../core/caregiverAccess.ts'
import { MILEAGE_RATE_REFUSAL, parseMileageRate } from '../core/mileageRate.ts'
import { isCompanyClient, isCompanyPerson, payrollOrCaregiver } from './shared.ts'

export function createMileageRoutes(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()

  // GET / — trips, newest first, paged; a caregiver's own only.
  app.get('/', payrollOrCaregiver(d, 'read'), async (c) => {
    const me = c.get('user')
    const { caregiverId, startDate, endDate, page = '1', limit = '50' } = c.req.query()
    const pageNum = Math.max(parseInt(page) || 1, 1)
    const pageSize = Math.max(parseInt(limit) || 50, 1)

    const where = and(
      eq(mileageEntries.companyId, me.companyId),
      // The office sees everyone's mileage; a caregiver only their own (whatever caregiverId says).
      !isOfficeUser(me) ? eq(mileageEntries.caregiverId, me.userId) : caregiverId ? eq(mileageEntries.caregiverId, caregiverId) : undefined,
      startDate ? gte(mileageEntries.date, startDate) : undefined,
      endDate ? lte(mileageEntries.date, endDate) : undefined,
    )

    const [rows, [{ value: total }]] = await Promise.all([
      db.select({
        id: mileageEntries.id,
        caregiverId: mileageEntries.caregiverId,
        date: mileageEntries.date,
        startLocation: mileageEntries.startLocation,
        endLocation: mileageEntries.endLocation,
        miles: mileageEntries.miles,
        ratePerMile: mileageEntries.ratePerMile,
        amount: mileageEntries.amount,
        clientId: mileageEntries.clientId,
        notes: mileageEntries.notes,
        createdAt: mileageEntries.createdAt,
        caregiverFirstName: user.firstName,
        caregiverLastName: user.lastName,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
      })
        .from(mileageEntries)
        .leftJoin(user, eq(mileageEntries.caregiverId, user.id))
        .leftJoin(clients, eq(mileageEntries.clientId, clients.id))
        .where(where)
        .orderBy(desc(mileageEntries.date))
        .offset((pageNum - 1) * pageSize)
        .limit(pageSize),
      db.select({ value: count() }).from(mileageEntries).where(where),
    ])

    const entries = (rows as any[]).map(({ caregiverFirstName, caregiverLastName, clientFirstName, clientLastName, ...entry }) => ({
      ...entry,
      caregiverName: caregiverFirstName ? `${caregiverFirstName} ${caregiverLastName}` : null,
      clientName: clientFirstName ? `${clientFirstName} ${clientLastName}` : null,
    }))
    return list(c, entries, { page: pageNum, limit: pageSize, total: Number(total) })
  })

  // POST / — record a trip; the amount is miles × the agency's rate.
  app.post('/', payrollOrCaregiver(d, 'create'), async (c) => {
    const me = c.get('user')
    const body = await c.req.json().catch(() => ({})) as any

    // The office may record a trip for a caregiver; a caregiver records their own — a caregiverId they send is ignored.
    const office = isOfficeUser(me)
    const caregiverId = office && body.caregiverId ? body.caregiverId : me.userId
    if (office && body.caregiverId && !(await isCompanyPerson(d, me.companyId, caregiverId))) return fail(c, 404, 'Caregiver not found')
    if (body.clientId && !(await isCompanyClient(d, me.companyId, body.clientId))) return fail(c, 404, 'Client not found')
    const miles = parseFloat(body.miles) || 0
    // The rate is the agency's. A caregiver never sets their own; the office may record a trip at another rate.
    let ratePerMile = await core.mileage.agencyMileageRate(me.companyId)
    const asked = body.ratePerMile ?? body.rate
    if (office && asked !== undefined && asked !== null && String(asked).trim() !== '') {
      const r = parseMileageRate(asked)
      if (r === null) return fail(c, 400, MILEAGE_RATE_REFUSAL)
      ratePerMile = r
    }
    const amount = (miles * ratePerMile).toFixed(2)

    const [entry] = await db.insert(mileageEntries).values({
      companyId: me.companyId,
      caregiverId,
      date: body.date,
      startLocation: body.startLocation,
      endLocation: body.endLocation,
      miles: String(miles),
      ratePerMile: String(ratePerMile),
      amount,
      clientId: body.clientId || null,
      notes: body.notes,
    }).returning()
    return one(c, entry, 201)
  })

  return app
}

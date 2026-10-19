// /api/evv — the office's EVV records: the list, building a record from a closed punch, verifying one. Moved from
// templates/crm-homecare/backend/src/routes/evv.ts; the list's SQL is in server/data/homecareVisits.ts.
//
// All of it was requireAdmin: OFFICE_EVV here. Changes: every read and write is the company's; the list is
// { data, pagination } (the template answered { visits, total }).
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { evvVisits, timeEntries } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { clientPrivatePay } from '../../../data/homecareCore.ts'
import { evvVisitPage } from '../../../data/homecareVisits.ts'
import { OFFICE_EVV, who, intParam } from './shared.ts'

export function createEvvRoutes(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  app.use('*', requirePermission(OFFICE_EVV))

  // GET / — EVV applies only to payer-funded services: a private-pay client's visits are not listed (by the payer's
  // TYPE, never its name). New private-pay visits get no EVV record at all; this also keeps out rows written before.
  app.get('/', async (c) => {
    const { companyId } = who(c)
    const page = intParam(c.req.query('page'), 1)
    const limit = intParam(c.req.query('limit'), 50)
    const { rows, total } = await evvVisitPage(db, companyId, {
      status: c.req.query('status') || undefined, startDate: c.req.query('startDate') || undefined, endDate: c.req.query('endDate') || undefined,
    }, (page - 1) * limit, limit)
    const data = rows.map(({ teStartTime, teEndTime, teDurationMinutes, clientFirstName, clientLastName, clientMcoMemberId, ...v }: any) => ({
      ...v,
      timeEntry: { startTime: teStartTime, endTime: teEndTime, durationMinutes: teDurationMinutes },
      client: { firstName: clientFirstName, lastName: clientLastName, mcoMemberId: clientMcoMemberId },
    }))
    return list(c, data, { page, limit, total })
  })

  // One builder for EVV records: the same function every clock-out path uses (units, verification issues,
  // authorization, GPS, Sandata auto-submit when ready).
  app.post('/create-from-entry/:timeEntryId', async (c) => {
    const { companyId } = who(c)
    const [entry] = await db.select({ id: timeEntries.id, endTime: timeEntries.endTime, clientId: timeEntries.clientId }).from(timeEntries)
      .where(and(eq(timeEntries.id, c.req.param('timeEntryId')), eq(timeEntries.companyId, companyId))).limit(1)
    if (!entry) return fail(c, 404, 'Time entry not found')
    if (!entry.endTime) return fail(c, 400, 'This visit is still clocked in — close it first')
    if (await clientPrivatePay(db, companyId, entry.clientId)) {
      return fail(c, 400, 'This is a private-pay visit. EVV applies only to payer-funded services, so it has no EVV record.')
    }
    const visit = await core.evvVisits.createEVVFromTimeEntry(companyId, entry.id)
    if (!visit) return fail(c, 400, 'The EVV record could not be created')
    return one(c, visit, 201)
  })

  // The office verified the visit. This says nothing about Sandata: it used to also set sandata_status = 'accepted',
  // which marked visits as accepted by Sandata that were never sent.
  app.patch('/:id/verify', async (c) => {
    const [visit] = await db.update(evvVisits)
      .set({ isVerified: true, updatedAt: new Date() })
      .where(and(eq(evvVisits.id, c.req.param('id')), eq(evvVisits.companyId, who(c).companyId)))
      .returning()
    if (!visit) return fail(c, 404, 'EVV visit not found')
    return one(c, visit)
  })

  return app
}

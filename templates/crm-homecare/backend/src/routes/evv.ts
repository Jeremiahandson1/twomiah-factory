import { Hono } from 'hono'
import { eq, and, gte, lte, desc, count, sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import {
  evvVisits,
  timeEntries,
  clients,
} from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { createEVVFromTimeEntry } from '../services/evvVisits.ts'
import { privatePaySql } from '../helpers/payerFunding.ts'

const app = new Hono()

app.use('*', authenticate)
app.use('*', requireAdmin)

app.get('/', async (c) => {
  const status = c.req.query('status')
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '50')
  const skip = (page - 1) * limit

  // EVV applies only to payer-funded services: a private-pay client's visits are not listed
  // (helpers/payerFunding.ts — by the payer's TYPE, never its name). New private-pay visits get no
  // EVV record at all (services/evvVisits.ts); this also keeps out rows written before that rule.
  const conditions: any[] = [sql`NOT EXISTS (SELECT 1 FROM clients pc WHERE pc.id = ${evvVisits.clientId} AND ${privatePaySql('pc')})`]
  if (status) conditions.push(eq(evvVisits.sandataStatus, status))
  if (startDate) conditions.push(gte(evvVisits.serviceDate, startDate))
  if (endDate) conditions.push(lte(evvVisits.serviceDate, endDate))

  const whereClause = conditions.length ? and(...conditions) : undefined

  const [visits, [{ value: total }]] = await Promise.all([
    db.select({
      id: evvVisits.id,
      timeEntryId: evvVisits.timeEntryId,
      clientId: evvVisits.clientId,
      caregiverId: evvVisits.caregiverId,
      authorizationId: evvVisits.authorizationId,
      serviceCode: evvVisits.serviceCode,
      modifier: evvVisits.modifier,
      serviceDate: evvVisits.serviceDate,
      actualStart: evvVisits.actualStart,
      actualEnd: evvVisits.actualEnd,
      unitsOfService: evvVisits.unitsOfService,
      gpsInLat: evvVisits.gpsInLat,
      gpsInLng: evvVisits.gpsInLng,
      gpsOutLat: evvVisits.gpsOutLat,
      gpsOutLng: evvVisits.gpsOutLng,
      sandataStatus: evvVisits.sandataStatus,
      sandataVisitId: evvVisits.sandataVisitId,
      sandataSubmittedAt: evvVisits.sandataSubmittedAt,
      sandataResponse: evvVisits.sandataResponse,
      sandataExceptionCode: evvVisits.sandataExceptionCode,
      sandataExceptionDesc: evvVisits.sandataExceptionDesc,
      evvMethod: evvVisits.evvMethod,
      isVerified: evvVisits.isVerified,
      verificationIssues: evvVisits.verificationIssues,
      createdAt: evvVisits.createdAt,
      updatedAt: evvVisits.updatedAt,
      timeEntryStartTime: timeEntries.startTime,
      timeEntryEndTime: timeEntries.endTime,
      timeEntryDurationMinutes: timeEntries.durationMinutes,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
      clientMcoMemberId: clients.mcoMemberId,
    })
      .from(evvVisits)
      .leftJoin(timeEntries, eq(timeEntries.id, evvVisits.timeEntryId))
      .leftJoin(clients, eq(clients.id, evvVisits.clientId))
      .where(whereClause)
      .orderBy(desc(evvVisits.serviceDate))
      .offset(skip)
      .limit(limit),
    db.select({ value: count() }).from(evvVisits).where(whereClause),
  ])

  const result = visits.map((v) => ({
    id: v.id,
    timeEntryId: v.timeEntryId,
    clientId: v.clientId,
    caregiverId: v.caregiverId,
    authorizationId: v.authorizationId,
    serviceCode: v.serviceCode,
    modifier: v.modifier,
    serviceDate: v.serviceDate,
    actualStart: v.actualStart,
    actualEnd: v.actualEnd,
    unitsOfService: v.unitsOfService,
    gpsInLat: v.gpsInLat,
    gpsInLng: v.gpsInLng,
    gpsOutLat: v.gpsOutLat,
    gpsOutLng: v.gpsOutLng,
    sandataStatus: v.sandataStatus,
    sandataVisitId: v.sandataVisitId,
    sandataSubmittedAt: v.sandataSubmittedAt,
    sandataResponse: v.sandataResponse,
    sandataExceptionCode: v.sandataExceptionCode,
    sandataExceptionDesc: v.sandataExceptionDesc,
    evvMethod: v.evvMethod,
    isVerified: v.isVerified,
    verificationIssues: v.verificationIssues,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    timeEntry: {
      startTime: v.timeEntryStartTime,
      endTime: v.timeEntryEndTime,
      durationMinutes: v.timeEntryDurationMinutes,
    },
    client: {
      firstName: v.clientFirstName,
      lastName: v.clientLastName,
      mcoMemberId: v.clientMcoMemberId,
    },
  }))

  return c.json({ visits: result, total })
})

// One builder for EVV records: the same function every clock-out path uses (units, verification
// issues, authorization, GPS, Sandata auto-submit when ready).
app.post('/create-from-entry/:timeEntryId', async (c) => {
  const timeEntryId = c.req.param('timeEntryId')
  const [entry] = await db.select({ id: timeEntries.id, endTime: timeEntries.endTime }).from(timeEntries)
    .where(eq(timeEntries.id, timeEntryId))
    .limit(1)
  if (!entry) return c.json({ error: 'Time entry not found' }, 404)
  if (!entry.endTime) return c.json({ error: 'This visit is still clocked in — close it first' }, 400)
  const [pp] = (await db.execute(sql`SELECT ${privatePaySql('c')} AS private_pay FROM time_entries te JOIN clients c ON c.id = te.client_id WHERE te.id = ${entry.id}`) as any).rows ?? []
  if (pp?.private_pay) return c.json({ error: 'This is a private-pay visit. EVV applies only to payer-funded services, so it has no EVV record.' }, 400)
  const visit = await createEVVFromTimeEntry(entry.id)
  if (!visit) return c.json({ error: 'The EVV record could not be created' }, 400)
  return c.json(visit, 201)
})

// The office verified the visit. This says nothing about Sandata: it used to also set
// sandata_status = 'accepted', which marked visits as accepted by Sandata that were never sent.
app.patch('/:id/verify', async (c) => {
  const id = c.req.param('id')
  const [visit] = await db.update(evvVisits)
    .set({ isVerified: true, updatedAt: new Date() })
    .where(eq(evvVisits.id, id))
    .returning()
  if (!visit) return c.json({ error: 'EVV visit not found' }, 404)
  return c.json(visit)
})

export default app

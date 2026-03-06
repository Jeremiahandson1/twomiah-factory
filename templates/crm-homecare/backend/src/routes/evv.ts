import { Hono } from 'hono'
import { eq, and, gte, lte, desc, count } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import {
  evvVisits,
  timeEntries,
  clients,
} from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

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

  const conditions = []
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

app.post('/create-from-entry/:timeEntryId', async (c) => {
  const timeEntryId = c.req.param('timeEntryId')
  const body = await c.req.json()

  const [entry] = await db.select().from(timeEntries)
    .where(eq(timeEntries.id, timeEntryId))
    .limit(1)
  if (!entry) return c.json({ error: 'Time entry not found' }, 404)

  const clockInLocation = entry.clockInLocation as any
  const clockOutLocation = entry.clockOutLocation as any

  const [visit] = await db.insert(evvVisits)
    .values({
      timeEntryId: entry.id,
      clientId: entry.clientId,
      caregiverId: entry.caregiverId,
      serviceDate: entry.startTime.toISOString().split('T')[0],
      actualStart: entry.startTime,
      actualEnd: entry.endTime,
      gpsInLat: clockInLocation?.lat,
      gpsInLng: clockInLocation?.lng,
      gpsOutLat: clockOutLocation?.lat,
      gpsOutLng: clockOutLocation?.lng,
      ...body,
    })
    .returning()

  return c.json(visit, 201)
})

app.patch('/:id/verify', async (c) => {
  const id = c.req.param('id')
  const [visit] = await db.update(evvVisits)
    .set({ isVerified: true, sandataStatus: 'accepted', updatedAt: new Date() })
    .where(eq(evvVisits.id, id))
    .returning()
  return c.json(visit)
})

export default app

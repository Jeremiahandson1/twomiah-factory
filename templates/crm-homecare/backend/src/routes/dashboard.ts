import { Hono } from 'hono'
import { eq, and, gte, lt, lte, isNull, inArray, count, sql, desc, asc } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import {
  clients,
  users,
  openShifts,
  noshowAlerts,
  clientOnboarding,
  invoices,
  authorizations,
  timeEntries,
  absences,
  referralSources,
  performanceRatings,
} from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()

app.use('*', authenticate)

// GET /api/dashboard/stats
app.get('/stats', async (c) => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const thirtyDaysFromNow = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)

  const [
    activeClientsResult,
    activeCaregiversResult,
    openShiftsResult,
    openNoshowsResult,
    incompleteOnboardingResult,
    invoicesOutstandingResult,
    authsExpiringSoonResult,
    shiftsTodayResult,
  ] = await Promise.all([
    db.select({ count: count() }).from(clients).where(eq(clients.isActive, true)),
    db.select({ count: count() }).from(users).where(and(eq(users.role, 'caregiver'), eq(users.isActive, true))),
    db.select({ count: count() }).from(openShifts).where(and(eq(openShifts.status, 'open'), gte(openShifts.date, today.toISOString().split('T')[0]))),
    db.select({ count: count() }).from(noshowAlerts).where(eq(noshowAlerts.status, 'open')),
    db.select({ count: count() }).from(clientOnboarding).where(eq(clientOnboarding.allCompleted, false)),
    db.select({ sum: sql<string>`sum(${invoices.total})` }).from(invoices).where(inArray(invoices.paymentStatus, ['pending', 'overdue'])),
    db.select({ count: count() }).from(authorizations).where(and(eq(authorizations.status, 'active'), lte(authorizations.endDate, thirtyDaysFromNow.toISOString().split('T')[0]))),
    db.select({ count: count() }).from(timeEntries).where(and(gte(timeEntries.startTime, today), lt(timeEntries.startTime, tomorrow), eq(timeEntries.isComplete, false))),
  ])

  // Caregivers currently on shift
  const caregiversClockedIn = await db.selectDistinct({ caregiverId: timeEntries.caregiverId })
    .from(timeEntries)
    .where(and(gte(timeEntries.startTime, today), isNull(timeEntries.endTime), eq(timeEntries.isComplete, false)))

  return c.json({
    activeClients: activeClientsResult[0].count,
    activeCaregiversCount: activeCaregiversResult[0].count,
    caregiversClockedIn: caregiversClockedIn.length,
    openShifts: openShiftsResult[0].count,
    openNoshows: openNoshowsResult[0].count,
    incompleteOnboarding: incompleteOnboardingResult[0].count,
    outstandingRevenue: Number(invoicesOutstandingResult[0].sum || 0),
    authsExpiringSoon: authsExpiringSoonResult[0].count,
    shiftsToday: shiftsTodayResult[0].count,
  })
})

// GET /api/dashboard/recent-activity
app.get('/recent-activity', async (c) => {
  const [recentClientsRaw, recentTimeEntriesRaw, recentInvoicesRaw, pendingAbsencesRaw] = await Promise.all([
    db.select({
      id: clients.id,
      firstName: clients.firstName,
      lastName: clients.lastName,
      serviceType: clients.serviceType,
      createdAt: clients.createdAt,
    }).from(clients).where(eq(clients.isActive, true)).orderBy(desc(clients.createdAt)).limit(5),

    db.select({
      id: timeEntries.id,
      startTime: timeEntries.startTime,
      endTime: timeEntries.endTime,
      isComplete: timeEntries.isComplete,
      caregiverId: timeEntries.caregiverId,
      clientId: timeEntries.clientId,
    }).from(timeEntries).orderBy(desc(timeEntries.startTime)).limit(8),

    db.select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      total: invoices.total,
      paymentStatus: invoices.paymentStatus,
      createdAt: invoices.createdAt,
      clientId: invoices.clientId,
    }).from(invoices).orderBy(desc(invoices.createdAt)).limit(5),

    db.select({
      id: absences.id,
      date: absences.date,
      type: absences.type,
      caregiverId: absences.caregiverId,
    }).from(absences)
      .where(and(eq(absences.coverageNeeded, true), isNull(absences.coverageAssignedTo)))
      .orderBy(desc(absences.createdAt))
      .limit(5),
  ])

  // Fetch related user/client names for time entries
  const caregiverIds = [...new Set([...recentTimeEntriesRaw.map(t => t.caregiverId), ...pendingAbsencesRaw.map(a => a.caregiverId)])]
  const clientIds = [...new Set([...recentTimeEntriesRaw.map(t => t.clientId), ...recentInvoicesRaw.map(i => i.clientId)])]

  const [caregiverNames, clientNames] = await Promise.all([
    caregiverIds.length > 0
      ? db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users).where(inArray(users.id, caregiverIds))
      : [],
    clientIds.length > 0
      ? db.select({ id: clients.id, firstName: clients.firstName, lastName: clients.lastName }).from(clients).where(inArray(clients.id, clientIds))
      : [],
  ])

  const caregiverMap = new Map(caregiverNames.map(u => [u.id, { firstName: u.firstName, lastName: u.lastName }]))
  const clientMap = new Map(clientNames.map(c => [c.id, { firstName: c.firstName, lastName: c.lastName }]))

  const recentTimeEntries = recentTimeEntriesRaw.map(t => ({
    id: t.id,
    startTime: t.startTime,
    endTime: t.endTime,
    isComplete: t.isComplete,
    caregiver: caregiverMap.get(t.caregiverId) || null,
    client: clientMap.get(t.clientId) || null,
  }))

  const recentInvoices = recentInvoicesRaw.map(i => ({
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    total: i.total,
    paymentStatus: i.paymentStatus,
    createdAt: i.createdAt,
    client: clientMap.get(i.clientId) || null,
  }))

  const pendingAbsences = pendingAbsencesRaw.map(a => ({
    id: a.id,
    date: a.date,
    type: a.type,
    caregiver: caregiverMap.get(a.caregiverId) || null,
  }))

  return c.json({ recentClients: recentClientsRaw, recentTimeEntries, recentInvoices, pendingAbsences })
})

// GET /api/dashboard/alerts
app.get('/alerts', async (c) => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const fourteenDaysFromNow = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000)

  const [noshowAlertsRaw, expiringAuthsRaw, expiringCerts] = await Promise.all([
    db.select({
      id: noshowAlerts.id,
      scheduleId: noshowAlerts.scheduleId,
      caregiverId: noshowAlerts.caregiverId,
      clientId: noshowAlerts.clientId,
      shiftDate: noshowAlerts.shiftDate,
      expectedStart: noshowAlerts.expectedStart,
      alertedAt: noshowAlerts.alertedAt,
      resolvedAt: noshowAlerts.resolvedAt,
      resolvedById: noshowAlerts.resolvedById,
      resolutionNote: noshowAlerts.resolutionNote,
      status: noshowAlerts.status,
      smsSent: noshowAlerts.smsSent,
      createdAt: noshowAlerts.createdAt,
    }).from(noshowAlerts)
      .where(eq(noshowAlerts.status, 'open'))
      .orderBy(desc(noshowAlerts.createdAt))
      .limit(10),

    db.select({
      id: authorizations.id,
      clientId: authorizations.clientId,
      authNumber: authorizations.authNumber,
      procedureCode: authorizations.procedureCode,
      authorizedUnits: authorizations.authorizedUnits,
      usedUnits: authorizations.usedUnits,
      startDate: authorizations.startDate,
      endDate: authorizations.endDate,
      status: authorizations.status,
    }).from(authorizations)
      .where(and(eq(authorizations.status, 'active'), lte(authorizations.endDate, fourteenDaysFromNow.toISOString().split('T')[0])))
      .orderBy(asc(authorizations.endDate))
      .limit(10),

    db.select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      certifications: users.certifications,
      certificationsExpiry: users.certificationsExpiry,
    }).from(users)
      .where(and(eq(users.role, 'caregiver'), eq(users.isActive, true), sql`json_array_length(${users.certificationsExpiry}::json) > 0`))
      .limit(10),
  ])

  // Fetch related names for noshow alerts and expiring auths
  const noshowCaregiverIds = noshowAlertsRaw.map(a => a.caregiverId).filter(Boolean) as string[]
  const noshowClientIds = noshowAlertsRaw.map(a => a.clientId).filter(Boolean) as string[]
  const authClientIds = expiringAuthsRaw.map(a => a.clientId)
  const allClientIds = [...new Set([...noshowClientIds, ...authClientIds])]
  const allCaregiverIds = [...new Set(noshowCaregiverIds)]

  const [caregiverNames, clientNamesList] = await Promise.all([
    allCaregiverIds.length > 0
      ? db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users).where(inArray(users.id, allCaregiverIds))
      : [],
    allClientIds.length > 0
      ? db.select({ id: clients.id, firstName: clients.firstName, lastName: clients.lastName }).from(clients).where(inArray(clients.id, allClientIds))
      : [],
  ])

  const caregiverMap = new Map(caregiverNames.map(u => [u.id, { firstName: u.firstName, lastName: u.lastName }]))
  const clientMap = new Map(clientNamesList.map(c => [c.id, { firstName: c.firstName, lastName: c.lastName }]))

  const noshowAlertsResult = noshowAlertsRaw.map(a => ({
    ...a,
    caregiver: a.caregiverId ? caregiverMap.get(a.caregiverId) || null : null,
    client: a.clientId ? clientMap.get(a.clientId) || null : null,
  }))

  const expiringAuths = expiringAuthsRaw.map(a => ({
    ...a,
    client: clientMap.get(a.clientId) || null,
  }))

  return c.json({ noshowAlerts: noshowAlertsResult, expiringAuths, expiringCerts })
})

// GET /api/dashboard/referrals
app.get('/referrals', async (c) => {
  const sources = await db.select({
    id: referralSources.id,
    name: referralSources.name,
    type: referralSources.type,
  }).from(referralSources).where(eq(referralSources.isActive, true))

  const result = await Promise.all(sources.map(async (src) => {
    const [clientCount] = await db.select({ count: count() }).from(clients)
      .where(eq(clients.referredById, src.id))
    const revenueRows = await db.select({ total: invoices.total }).from(invoices)
      .innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(and(eq(clients.referredById, src.id), eq(invoices.paymentStatus, 'paid')))
    const totalRevenue = revenueRows.reduce((sum, r) => sum + Number(r.total || 0), 0)
    return {
      name: src.name,
      type: src.type || 'General',
      referral_count: clientCount.count,
      total_revenue: totalRevenue,
    }
  }))

  return c.json(result)
})

// GET /api/dashboard/caregiver-hours
app.get('/caregiver-hours', async (c) => {
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const caregivers = await db.select({
    id: users.id,
    firstName: users.firstName,
    lastName: users.lastName,
  }).from(users).where(and(eq(users.role, 'caregiver'), eq(users.isActive, true)))

  const result = await Promise.all(caregivers.map(async (cg) => {
    const entries = await db.select({
      durationMinutes: timeEntries.durationMinutes,
    }).from(timeEntries).where(and(
      eq(timeEntries.caregiverId, cg.id),
      eq(timeEntries.isComplete, true),
      gte(timeEntries.startTime, thirtyDaysAgo),
    ))

    const [satResult] = await db.select({
      avg: sql<string>`avg(${performanceRatings.satisfactionScore})`,
    }).from(performanceRatings).where(eq(performanceRatings.caregiverId, cg.id))

    const totalMinutes = entries.reduce((sum, e) => sum + (e.durationMinutes || 0), 0)

    return {
      id: cg.id,
      first_name: cg.firstName,
      last_name: cg.lastName,
      shifts: entries.length,
      total_hours: Math.round(totalMinutes / 60 * 10) / 10,
      avg_satisfaction: satResult.avg || null,
    }
  }))

  return c.json(result)
})

// GET /api/dashboard/summary
app.get('/summary', async (c) => {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const [
    activeClientsResult,
    activeCaregiversResult,
    monthlyRevenueResult,
    pendingInvoicesResult,
  ] = await Promise.all([
    db.select({ count: count() }).from(clients).where(eq(clients.isActive, true)),
    db.select({ count: count() }).from(users).where(and(eq(users.role, 'caregiver'), eq(users.isActive, true))),
    db.select({ sum: sql<string>`coalesce(sum(${invoices.total}), 0)` }).from(invoices)
      .where(and(eq(invoices.paymentStatus, 'paid'), gte(invoices.createdAt, monthStart))),
    db.select({ sum: sql<string>`coalesce(sum(${invoices.total}), 0)` }).from(invoices)
      .where(inArray(invoices.paymentStatus, ['pending', 'sent'])),
  ])

  return c.json({
    activeClients: activeClientsResult[0].count,
    activeCaregivers: activeCaregiversResult[0].count,
    monthlyRevenue: Number(monthlyRevenueResult[0].sum || 0),
    pendingInvoices: Number(pendingInvoicesResult[0].sum || 0),
  })
})

export default app

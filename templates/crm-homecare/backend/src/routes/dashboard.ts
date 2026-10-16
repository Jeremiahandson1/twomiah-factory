import { Hono } from 'hono'
import { eq, and, gte, lt, lte, isNull, inArray, count, sql, desc, asc, type SQL } from 'drizzle-orm'
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
} from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { occurrencesCte } from '../services/scheduleOccurrences.ts'
import { invoiceBalanceSql, releasedInvoiceSql } from '../services/invoiceMoney.ts'
import { agencyTimezone, agencyToday, localDate, localTs, nowUtc } from '../services/agencyTime.ts'
import { ON_TIME_GRACE_MINUTES } from '../helpers/punchRules.ts'

// "Late" is the one punctuality rule (helpers/punchRules.ts): more than the 7-minute grace after the start.
const LATE_AFTER_SQL = sql.raw(String(ON_TIME_GRACE_MINUTES))

const app = new Hono()

// The dashboard is the office's: revenue, caregiver hours, every client on today's board.
app.use('*', authenticate, requireAdmin)

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
    // Outstanding = released invoices' open balance (services/invoiceMoney.ts) — drafts are not owed yet.
    db.execute(sql`SELECT COALESCE(SUM(${invoiceBalanceSql()}), 0) AS sum FROM invoices i WHERE ${releasedInvoiceSql()} AND ${invoiceBalanceSql()} > 0.005`).then((r: any) => r.rows ?? r),
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

// ─── Ported from CVHC routes/dashboardRoutes.js (b2456a2) ────────────────────────────────────────
// Everything below counts the agency's day (services/agencyTime.ts), never the UTC server's: CVHC's
// dashboard used to roll over to tomorrow at 7pm, and its live board called a 9am visit five hours
// late. Shift counts come off the shared schedule engine, so a cancelled visit or an ended pattern is
// never shown as "not clocked in yet".
const rows = async (q: SQL): Promise<any[]> => ((await db.execute(q)) as any).rows || []

// The punch (`te`) that belongs to today's visit (`occ`): same caregiver and client, clocked in on
// the visit's agency day, and linked to that visit's schedule when the punch names one. One rule for
// the live board's status and the dashboard's "Shifts Remaining".
const punchForOcc = (tz: string): SQL => sql`te.caregiver_id = occ.caregiver_id
      AND te.client_id = occ.client_id
      AND ${localDate(sql`te.start_time`, tz)} = occ.occ_date
      AND (te.schedule_id IS NULL OR te.schedule_id = occ.schedule_id)`
const one = async (q: SQL): Promise<any> => (await rows(q))[0] || {}

// GET /api/dashboard/summary — the admin dashboard's tiles and "Today" panel
app.get('/summary', async (c) => {
  const tz = await agencyTimezone()
  const today = await agencyToday(tz)
  const [totalClients, activeCaregivers, pendingInvoices, thisMonthRevenue, clockedInNow, todayShifts, remainingShifts] = await Promise.all([
    one(sql`SELECT COUNT(*)::int AS count FROM clients WHERE is_active = true`),
    one(sql`SELECT COUNT(*)::int AS count FROM users WHERE role = 'caregiver' AND is_active = true`),
    // Pending = RELEASED invoices with a balance still owed, at that balance (services/invoiceMoney.ts).
    // A draft is not owed yet; it is counted separately below. A partly-paid invoice is pending for
    // what is left (it used to be left out, and an unpaid draft counted in full).
    one(sql`SELECT COUNT(*)::int AS count, COALESCE(SUM(${invoiceBalanceSql()}), 0) AS amount,
               (SELECT COUNT(*)::int FROM invoices d WHERE NOT ${releasedInvoiceSql('d')}) AS draft_count,
               (SELECT COALESCE(SUM(d.total), 0) FROM invoices d WHERE NOT ${releasedInvoiceSql('d')}) AS draft_amount
             FROM invoices i WHERE ${releasedInvoiceSql()} AND ${invoiceBalanceSql()} > 0.005`),
    // Cash received this calendar month: the payments recorded (invoice_payments) by payment date.
    // invoices.payment_date is stamped only when an invoice is paid IN FULL, so a part payment
    // counted nothing.
    one(sql`SELECT COALESCE(SUM(amount), 0) AS amount FROM invoice_payments
             WHERE payment_date >= date_trunc('month', (${today})::date)
               AND payment_date <  date_trunc('month', (${today})::date) + INTERVAL '1 month'`),
    // Caregivers clocked in right now (an open entry started on the agency's today).
    one(sql`SELECT COUNT(DISTINCT caregiver_id)::int AS count FROM time_entries
             WHERE end_time IS NULL AND ${localDate(sql`start_time`, tz)} = (${today})::date`),
    one(sql`WITH ${occurrencesCte(today, today)} SELECT COUNT(*)::int AS count FROM occ`),
    // Today's shifts not started yet: no punch at all for that visit. A visit in progress or
    // already done is not "remaining" (it used to be: only an OPEN punch counted, so a finished
    // visit came back as remaining). The punch↔visit match is the live board's (punchForOcc).
    one(sql`WITH ${occurrencesCte(today, today)}
      SELECT COUNT(*)::int AS count FROM occ
      WHERE NOT EXISTS (SELECT 1 FROM time_entries te WHERE ${punchForOcc(tz)})`),
  ])
  return c.json({
    totalClients: parseInt(totalClients.count) || 0,
    activeCaregivers: parseInt(activeCaregivers.count) || 0,
    pendingInvoices: {
      count: parseInt(pendingInvoices.count) || 0, amount: parseFloat(pendingInvoices.amount || 0),
      draftCount: parseInt(pendingInvoices.draft_count) || 0, draftAmount: parseFloat(pendingInvoices.draft_amount || 0),
    },
    thisMonthRevenue: parseFloat(thisMonthRevenue.amount || 0),
    clockedInNow: parseInt(clockedInNow.count) || 0,
    todayShifts: parseInt(todayShifts.count) || 0,
    remainingShifts: parseInt(remainingShifts.count) || 0,
    coverageGaps: 0,
  })
})

// GET /api/dashboard/action-items — the office's to-do list; each entry has a count and the page
// that clears it. Only non-zero items are returned.
app.get('/action-items', async (c) => {
  const tz = await agencyTimezone()
  const today = await agencyToday(tz)
  const n = async (q: SQL) => parseInt((await one(q)).n) || 0
  const [pendingApprovals, openShiftsCount, lowAuths, expiringAuths, expiringCerts, stuckPunches, pendingPayrollReviews, incidentResponsesDue] = await Promise.all([
    n(sql`SELECT COUNT(*)::int AS n FROM time_entries WHERE needs_approval = true AND is_complete = true`),
    n(sql`SELECT COUNT(*)::int AS n FROM open_shifts WHERE status = 'open' AND date >= (${today})::date AND date <= (${today})::date + 7`),
    n(sql`SELECT COUNT(*)::int AS n FROM authorizations WHERE status = 'active' AND (authorized_units - used_units) <= low_units_alert_threshold`),
    n(sql`SELECT COUNT(*)::int AS n FROM authorizations WHERE status = 'active' AND end_date BETWEEN (${today})::date AND (${today})::date + 14`),
    n(sql`SELECT COUNT(*)::int AS n FROM certification_records WHERE expiry_date BETWEEN (${today})::date AND (${today})::date + 30`),
    n(sql`SELECT COUNT(*)::int AS n FROM time_entries WHERE is_complete = false AND start_time < ${nowUtc} - INTERVAL '24 hours'`),
    n(sql`SELECT COUNT(*)::int AS n FROM payroll_shift_reviews WHERE status IN ('pending', 'flagged', 'missing_punch') AND created_at > ${nowUtc} - INTERVAL '30 days'`),
    // Payer/MCO incident responses due within 3 days (or overdue) and not yet sent — the same rule
    // as GET /api/incidents/responses-due.
    n(sql`SELECT COUNT(*)::int AS n FROM incidents
           WHERE COALESCE(investigation_status, 'open') <> 'closed'
             AND response_due_date IS NOT NULL AND response_sent_date IS NULL
             AND response_due_date <= (${today})::date + 3`),
  ])
  const items = [
    { key: 'shift_approvals', label: 'Time entries awaiting approval', count: pendingApprovals, page: 'shift-approvals', severity: 'high' },
    { key: 'stuck_punches', label: 'Open clock-ins more than 24h old', count: stuckPunches, page: 'live-board', severity: 'high' },
    { key: 'open_shifts', label: 'Open shifts in next 7 days', count: openShiftsCount, page: 'scheduling', severity: 'med' },
    { key: 'low_auths', label: 'Authorizations running low', count: lowAuths, page: 'authorizations', severity: 'high' },
    { key: 'expiring_auths', label: 'Authorizations expiring within 14 days', count: expiringAuths, page: 'authorizations', severity: 'high' },
    { key: 'expiring_certs', label: 'Caregiver certifications expiring within 30 days', count: expiringCerts, page: 'compliance', severity: 'med' },
    { key: 'payroll_reviews', label: 'Payroll shift reviews still pending', count: pendingPayrollReviews, page: 'payroll', severity: 'med' },
    { key: 'incident_responses_due', label: 'Incident responses due within 3 days or overdue', count: incidentResponsesDue, page: 'incidents', severity: 'high' },
  ].filter((item) => item.count > 0)
  return c.json({ items, totalCount: items.reduce((s, i) => s + i.count, 0) })
})

// GET /api/dashboard/referrals — client count and paid revenue per active referral source,
// aggregated separately (joining both multiplied the client count by each client's invoices).
app.get('/referrals', async (c) => {
  const result = await rows(sql`SELECT rs.name, rs.type,
      (SELECT COUNT(*) FROM clients c WHERE c.referred_by_id = rs.id)::int AS referral_count,
      COALESCE((SELECT SUM(ip.amount) FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
                 JOIN clients c2 ON c2.id = i.client_id WHERE c2.referred_by_id = rs.id), 0) AS total_revenue
    FROM referral_sources rs
    WHERE rs.is_active = true
    ORDER BY referral_count DESC`)
  return c.json(result)
})

// GET /api/dashboard/caregiver-hours — completed shifts, capped hours and average rating per active
// caregiver, aggregated separately (one join multiplied the hours by the rating count). Capped
// minutes, not raw duration: a missed clock-out inflates the raw figure.
app.get('/caregiver-hours', async (c) => {
  const result = await rows(sql`SELECT u.id, u.first_name, u.last_name,
      COALESCE(te.shifts, 0)::int AS shifts,
      COALESCE(te.total_hours, 0) AS total_hours,
      COALESCE(pr.avg_satisfaction, 0) AS avg_satisfaction
    FROM users u
    LEFT JOIN (
      SELECT caregiver_id, COUNT(*) AS shifts,
             ROUND(SUM(COALESCE(billable_minutes, duration_minutes)) / 60.0, 1) AS total_hours
      FROM time_entries WHERE end_time IS NOT NULL GROUP BY caregiver_id
    ) te ON te.caregiver_id = u.id
    LEFT JOIN (
      SELECT caregiver_id, AVG(satisfaction_score) AS avg_satisfaction
      FROM performance_ratings GROUP BY caregiver_id
    ) pr ON pr.caregiver_id = u.id
    WHERE u.role = 'caregiver' AND u.is_active = true
    ORDER BY total_hours DESC NULLS LAST`)
  return c.json(result)
})

// GET /api/dashboard/live-board — every shift happening today with its live clock status.
app.get('/live-board', async (c) => {
  const tz = await agencyTimezone()
  const today = await agencyToday(tz)
  const nowLocal = sql`(NOW() AT TIME ZONE ${tz})::time`
  const shifts = await rows(sql`WITH ${occurrencesCte(today, today)}
    SELECT
      occ.schedule_id, occ.caregiver_id, occ.client_id,
      to_char(occ.start_time, 'HH24:MI:SS') AS scheduled_start,
      to_char(occ.end_time, 'HH24:MI:SS') AS scheduled_end,
      u.first_name AS caregiver_first, u.last_name AS caregiver_last, u.phone AS caregiver_phone,
      u.latitude AS caregiver_lat, u.longitude AS caregiver_lng,
      c.first_name AS client_first, c.last_name AS client_last,
      c.address AS client_address, c.city AS client_city,
      c.latitude AS client_lat, c.longitude AS client_lng,
      te.id AS time_entry_id,
      to_char(te.start_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS clock_in_time,
      to_char(te.end_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS clock_out_time,
      te.clock_in_location, te.clock_out_location, te.duration_minutes,
      CASE
        WHEN te.end_time IS NOT NULL THEN 'completed'
        WHEN te.start_time IS NOT NULL AND te.end_time IS NULL THEN 'clocked_in'
        WHEN occ.start_time <= ${nowLocal} AND (${nowLocal} - occ.start_time) > INTERVAL '15 minutes' AND te.id IS NULL THEN 'late'
        WHEN occ.start_time <= ${nowLocal} AND te.id IS NULL THEN 'starting'
        ELSE 'upcoming'
      END AS shift_status,
      CASE WHEN te.start_time IS NOT NULL AND te.end_time IS NULL
        THEN ROUND(EXTRACT(EPOCH FROM (${nowUtc} - te.start_time)) / 60) ELSE NULL END AS minutes_elapsed,
      (
        -- Last 20 GPS points, newest first. The ORDER BY / LIMIT must sit in an inner subquery:
        -- at the aggregate's own level it is a GROUP BY error (42803).
        SELECT json_agg(pt) FROM (
          SELECT json_build_object('lat', gt.latitude, 'lng', gt.longitude, 'ts', to_char(gt.timestamp, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) AS pt
          FROM gps_tracking gt
          WHERE gt.time_entry_id = te.id
          ORDER BY gt.timestamp DESC
          LIMIT 20
        ) recent
      ) AS gps_trail
    FROM occ
    JOIN users u   ON u.id = occ.caregiver_id
    JOIN clients c ON c.id = occ.client_id
    LEFT JOIN time_entries te ON ${punchForOcc(tz)}
    WHERE u.is_active = true
    ORDER BY occ.start_time ASC`)

  const stats = {
    total: shifts.length,
    clocked_in: shifts.filter((s) => s.shift_status === 'clocked_in').length,
    completed: shifts.filter((s) => s.shift_status === 'completed').length,
    late: shifts.filter((s) => s.shift_status === 'late').length,
    upcoming: shifts.filter((s) => s.shift_status === 'upcoming').length,
    starting: shifts.filter((s) => s.shift_status === 'starting').length,
  }
  return c.json({ shifts, stats, asOf: new Date().toISOString(), timezone: tz })
})

// GET /api/dashboard/caregiver-patterns/:caregiverId — reliability by day of week (predictive
// scheduling): absences, no-shows and late clock-ins (more than the 7-minute grace after the scheduled start).
app.get('/caregiver-patterns/:caregiverId', async (c) => {
  const caregiverId = c.req.param('caregiverId')
  const months = Math.max(1, Math.min(36, parseInt(c.req.query('months') || '6') || 6))
  const tz = await agencyTimezone()
  const today = await agencyToday(tz)
  const since = (() => { const d = new Date(`${today}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - months); return d.toISOString().slice(0, 10) })()
  const teDay = localDate(sql`te.start_time`, tz)

  const [absenceRows, noShowRows, lateRows, totalRows] = await Promise.all([
    rows(sql`SELECT EXTRACT(DOW FROM date)::int AS day_of_week, type, COUNT(*)::int AS count
      FROM absences WHERE caregiver_id = ${caregiverId} AND date >= (${since})::date
      GROUP BY 1, 2 ORDER BY 1`),
    rows(sql`SELECT EXTRACT(DOW FROM shift_date)::int AS day_of_week, COUNT(*)::int AS count
      FROM noshow_alerts WHERE caregiver_id = ${caregiverId} AND shift_date >= (${since})::date
      GROUP BY 1 ORDER BY 1`),
    rows(sql`SELECT dow AS day_of_week, COUNT(*)::int AS count, ROUND(AVG(mins_late))::int AS avg_minutes_late FROM (
        SELECT EXTRACT(DOW FROM ${teDay})::int AS dow,
               EXTRACT(EPOCH FROM ((${localTs(sql`te.start_time`, tz)})::time - s.start_time::time)) / 60 AS mins_late
        FROM time_entries te JOIN schedules s ON te.schedule_id = s.id
        WHERE te.caregiver_id = ${caregiverId} AND te.is_complete = true AND ${teDay} >= (${since})::date
      ) t WHERE mins_late > ${LATE_AFTER_SQL}
      GROUP BY 1 ORDER BY 1`),
    rows(sql`SELECT dow AS day_of_week, COUNT(*)::int AS count FROM (
        SELECT EXTRACT(DOW FROM ${teDay})::int AS dow
        FROM time_entries te
        WHERE te.caregiver_id = ${caregiverId} AND te.is_complete = true AND ${teDay} >= (${since})::date
      ) t GROUP BY 1 ORDER BY 1`),
  ])

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const patterns = dayNames.map((name, dow) => {
    const total = Number(totalRows.find((r) => Number(r.day_of_week) === dow)?.count || 0)
    const absent = absenceRows.filter((r) => Number(r.day_of_week) === dow).reduce((s, r) => s + Number(r.count), 0)
    const noShow = Number(noShowRows.find((r) => Number(r.day_of_week) === dow)?.count || 0)
    const lateRow = lateRows.find((r) => Number(r.day_of_week) === dow)
    const late = Number(lateRow?.count || 0)
    const avgLate = Number(lateRow?.avg_minutes_late || 0)
    const issues = absent + noShow + late
    const reliability = total > 0 ? Math.round(((total - issues) / total) * 100) : 100
    return { day: name, dayOfWeek: dow, totalShifts: total, absences: absent, noShows: noShow, lateArrivals: late, avgMinutesLate: avgLate, reliabilityPct: reliability }
  })
  const totalShifts = patterns.reduce((s, p) => s + p.totalShifts, 0)
  return c.json({
    caregiverId,
    periodMonths: months,
    patterns,
    riskDays: patterns.filter((p) => p.totalShifts >= 3 && p.reliabilityPct < 80),
    overallReliability: totalShifts > 0
      ? Math.round(patterns.reduce((s, p) => s + p.reliabilityPct * p.totalShifts, 0) / Math.max(1, totalShifts))
      : 100,
  })
})

export default app

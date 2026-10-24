// Home care's dashboard (/api/dashboard for the home-care vertical: CrmSettings.dashboard 'homecare', mounted by
// server/modules/crm.ts in place of the jobs dashboard). Moved from templates/crm-homecare/backend/src/routes/dashboard.ts.
//
// Everything counts the agency's day (core/agencyTime.ts), never the UTC server's; visit counts come off the schedule
// engine (data/homecareCore.ts occurrencesCte), so a cancelled visit or an ended pattern is never "not clocked in yet".
//
// Who may: the template put the whole dashboard behind requireAdmin (owner, admin). Each action now asks a permission a
// caregiver does not hold: the money tiles (stats, recent activity with invoice totals, the summary, referral revenue)
// and the authorization alerts ask care-billing:read; the office's to-do list and the live board ask care-schedule:update
// (the schedule area's write — a caregiver holds only its read); a caregiver's hours, ratings and reliability ask care-hr:read.
import { Hono } from 'hono'
import type { AppEnv } from '../../../http/env.ts'
import { one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { createHomecareCore } from '../core/index.ts'
import { addDays } from '../core/agencyTime.ts'
import { ON_TIME_GRACE_MINUTES } from '../core/punchRules.ts'
import {
  dashboardStats, recentClients, recentTimeEntries, recentInvoices, absencesNeedingCover,
  openNoshowAlerts, authorizationsEndingBy, caregiversWithCertificationExpiry, dashboardSummary, actionItemCounts,
  referralSourceTotals, caregiverHoursAndRatings, liveBoardShifts,
  absencesByWeekday, noShowsByWeekday, lateArrivalsByWeekday, completedShiftsByWeekday,
} from '../../../data/homecarePlanning.ts'

const int = (v: unknown) => parseInt(String(v ?? '')) || 0
const dec = (v: unknown) => parseFloat(String(v ?? '')) || 0

/** `{ firstName, lastName }` of a joined person or client, or null when the row named nobody on file. */
const nameOf = (found: unknown, firstName: unknown, lastName: unknown) => (found ? { firstName, lastName } : null)

export function createHomecareDashboardRoutes(d: CrmDeps) {
  const core = createHomecareCore(d)
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  // GET /stats — the office's tiles on the agency's today.
  app.get('/stats', requirePermission('care-billing:read'), async (c) => {
    const { companyId } = c.get('user')
    const tz = await core.time.timezone(companyId)
    const today = await core.time.today(companyId, tz)
    const s = await dashboardStats(d.db, companyId, today, addDays(today, 30), tz)
    return one(c, {
      activeClients: int(s.activeClients),
      activeCaregiversCount: int(s.activeCaregivers),
      caregiversClockedIn: int(s.caregiversClockedIn),
      openShifts: int(s.openShifts),
      openNoshows: int(s.openNoshows),
      incompleteOnboarding: int(s.incompleteOnboarding),
      outstandingRevenue: Number(s.outstandingRevenue || 0),
      authsExpiringSoon: int(s.authsExpiringSoon),
      shiftsToday: int(s.shiftsToday),
    })
  })

  // GET /recent-activity — new clients, punches, invoices and absences needing cover.
  app.get('/recent-activity', requirePermission('care-billing:read'), async (c) => {
    const { companyId } = c.get('user')
    const [clients, punches, invoices, absences] = await Promise.all([
      recentClients(d.db, companyId), recentTimeEntries(d.db, companyId), recentInvoices(d.db, companyId), absencesNeedingCover(d.db, companyId),
    ])
    return one(c, {
      recentClients: clients,
      recentTimeEntries: punches.map((t: any) => ({
        id: t.id, startTime: t.startTime, endTime: t.endTime, isComplete: t.isComplete,
        caregiver: nameOf(t.caregiverFound, t.caregiverFirstName, t.caregiverLastName),
        client: nameOf(t.clientFound, t.clientFirstName, t.clientLastName),
      })),
      recentInvoices: invoices.map((i: any) => ({
        id: i.id, invoiceNumber: i.invoiceNumber, total: i.total, paymentStatus: i.paymentStatus, createdAt: i.createdAt,
        client: nameOf(i.clientFound, i.clientFirstName, i.clientLastName),
      })),
      pendingAbsences: absences.map((a: any) => ({
        id: a.id, date: a.date, type: a.type,
        caregiver: nameOf(a.caregiverFound, a.caregiverFirstName, a.caregiverLastName),
      })),
    })
  })

  // GET /alerts — open no-shows, authorizations ending within 14 days, caregivers with certification dates on file.
  app.get('/alerts', requirePermission('care-billing:read'), async (c) => {
    const { companyId } = c.get('user')
    const today = await core.time.today(companyId)
    const [noshows, auths, certs] = await Promise.all([
      openNoshowAlerts(d.db, companyId), authorizationsEndingBy(d.db, companyId, addDays(today, 14)), caregiversWithCertificationExpiry(d.db, companyId),
    ])
    const strip = ({ caregiverFound, caregiverFirstName, caregiverLastName, clientFound, clientFirstName, clientLastName, ...rest }: any) => rest
    return one(c, {
      noshowAlerts: noshows.map((a: any) => ({
        ...strip(a),
        caregiver: a.caregiverId ? nameOf(a.caregiverFound, a.caregiverFirstName, a.caregiverLastName) : null,
        client: a.clientId ? nameOf(a.clientFound, a.clientFirstName, a.clientLastName) : null,
      })),
      expiringAuths: auths.map((a: any) => ({ ...strip(a), client: nameOf(a.clientFound, a.clientFirstName, a.clientLastName) })),
      expiringCerts: certs,
    })
  })

  // GET /summary — the admin dashboard's tiles and "Today" panel. The read-only office seat (care-office:read) gets the
  // counts and not the money: pendingInvoices and thisMonthRevenue are care-billing:read's, and ABSENT for anyone else,
  // so no tile prints "$0.00" for a figure it was not given (live role check, 2026-10-23: the viewer's dashboard was
  // blank — every tile sat on the billing permission).
  app.get('/summary', d.permissions.requireAnyPermission(['care-billing:read', 'care-office:read']), async (c) => {
    const { companyId, role, userId } = c.get('user') as any
    const tz = await core.time.timezone(companyId)
    const today = await core.time.today(companyId, tz)
    const s = await dashboardSummary(d.db, companyId, today, tz)
    const money = d.permissions.hasPermission(role, 'care-billing:read', await d.permissions.getExtraPermissions(userId))
    return one(c, {
      totalClients: int(s.totalClients),
      activeCaregivers: int(s.activeCaregivers),
      ...(money ? {
        pendingInvoices: {
          count: int(s.pendingCount), amount: dec(s.pendingAmount),
          draftCount: int(s.draftCount), draftAmount: dec(s.draftAmount),
        },
        thisMonthRevenue: dec(s.thisMonthRevenue),
      } : {}),
      clockedInNow: int(s.clockedInNow),
      todayShifts: int(s.todayShifts),
      remainingShifts: int(s.remainingShifts),
      coverageGaps: int(s.coverageGaps),
    })
  })

  // GET /action-items — the office's to-do list; each entry has a count and the page that clears it. Only non-zero items.
  app.get('/action-items', requirePermission('care-schedule:update'), async (c) => {
    const { companyId } = c.get('user')
    const today = await core.time.today(companyId)
    const n = await actionItemCounts(d.db, companyId, today)
    const items = [
      { key: 'shift_approvals', label: 'Time entries awaiting approval', count: int(n.pendingApprovals), page: 'shift-approvals', severity: 'high' },
      { key: 'stuck_punches', label: 'Open clock-ins more than 24h old', count: int(n.stuckPunches), page: 'live-board', severity: 'high' },
      { key: 'open_shifts', label: 'Open shifts in next 7 days', count: int(n.openShifts), page: 'scheduling', severity: 'med' },
      { key: 'low_auths', label: 'Authorizations running low', count: int(n.lowAuths), page: 'authorizations', severity: 'high' },
      { key: 'expiring_auths', label: 'Authorizations expiring within 14 days', count: int(n.expiringAuths), page: 'authorizations', severity: 'high' },
      { key: 'expiring_certs', label: 'Caregiver certifications expiring within 30 days', count: int(n.expiringCerts), page: 'compliance', severity: 'med' },
      { key: 'payroll_reviews', label: 'Payroll shift reviews still pending', count: int(n.pendingPayrollReviews), page: 'payroll', severity: 'med' },
      { key: 'incident_responses_due', label: 'Incident responses due within 3 days or overdue', count: int(n.incidentResponsesDue), page: 'incidents', severity: 'high' },
    ].filter((item) => item.count > 0)
    return one(c, { items, totalCount: items.reduce((s, i) => s + i.count, 0) })
  })

  // GET /referrals — client count and paid revenue per active referral source.
  app.get('/referrals', requirePermission('care-billing:read'), async (c) => {
    const rows = await referralSourceTotals(d.db, c.get('user').companyId)
    return listAll(c, rows)
  })

  // GET /caregiver-hours — completed shifts, capped hours and average rating per active caregiver.
  app.get('/caregiver-hours', requirePermission('care-hr:read'), async (c) => {
    const rows = await caregiverHoursAndRatings(d.db, c.get('user').companyId)
    return listAll(c, rows)
  })

  // GET /live-board — every visit today with its live clock status.
  app.get('/live-board', requirePermission('care-schedule:update'), async (c) => {
    const { companyId } = c.get('user')
    const tz = await core.time.timezone(companyId)
    const today = await core.time.today(companyId, tz)
    const shifts = await liveBoardShifts(d.db, companyId, today, tz)
    const count = (s: string) => shifts.filter((x: any) => x.shiftStatus === s).length
    const stats = {
      total: shifts.length,
      clockedIn: count('clocked_in'),
      completed: count('completed'),
      late: count('late'),
      upcoming: count('upcoming'),
      starting: count('starting'),
    }
    return one(c, { shifts, stats, asOf: new Date().toISOString(), timezone: tz })
  })

  // GET /caregiver-patterns/:caregiverId — reliability by day of week (predictive scheduling): absences, no-shows and
  // late clock-ins (more than the 7-minute grace after the scheduled start).
  app.get('/caregiver-patterns/:caregiverId', requirePermission('care-hr:read'), async (c) => {
    const { companyId } = c.get('user')
    const caregiverId = c.req.param('caregiverId')
    const months = Math.max(1, Math.min(36, parseInt(c.req.query('months') || '6') || 6))
    const tz = await core.time.timezone(companyId)
    const today = await core.time.today(companyId, tz)
    const since = (() => { const x = new Date(`${today}T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() - months); return x.toISOString().slice(0, 10) })()

    const [absenceRows, noShowRows, lateRows, totalRows] = await Promise.all([
      absencesByWeekday(d.db, companyId, caregiverId, since),
      noShowsByWeekday(d.db, companyId, caregiverId, since),
      lateArrivalsByWeekday(d.db, companyId, caregiverId, since, tz, ON_TIME_GRACE_MINUTES),
      completedShiftsByWeekday(d.db, companyId, caregiverId, since, tz),
    ])

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const patterns = dayNames.map((name, dow) => {
      const total = Number(totalRows.find((r: any) => Number(r.dayOfWeek) === dow)?.count || 0)
      const absent = absenceRows.filter((r: any) => Number(r.dayOfWeek) === dow).reduce((s: number, r: any) => s + Number(r.count), 0)
      const noShow = Number(noShowRows.find((r: any) => Number(r.dayOfWeek) === dow)?.count || 0)
      const lateRow = lateRows.find((r: any) => Number(r.dayOfWeek) === dow)
      const late = Number(lateRow?.count || 0)
      const avgLate = Number(lateRow?.avgMinutesLate || 0)
      const issues = absent + noShow + late
      const reliability = total > 0 ? Math.round(((total - issues) / total) * 100) : 100
      return { day: name, dayOfWeek: dow, totalShifts: total, absences: absent, noShows: noShow, lateArrivals: late, avgMinutesLate: avgLate, reliabilityPct: reliability }
    })
    const totalShifts = patterns.reduce((s, p) => s + p.totalShifts, 0)
    return one(c, {
      caregiverId,
      periodMonths: months,
      patterns,
      riskDays: patterns.filter((p) => p.totalShifts >= 3 && p.reliabilityPct < 80),
      overallReliability: totalShifts > 0
        ? Math.round(patterns.reduce((s, p) => s + p.reliabilityPct * p.totalShifts, 0) / Math.max(1, totalShifts))
        : 100,
    })
  })

  return app
}

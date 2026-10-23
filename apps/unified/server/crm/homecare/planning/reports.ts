// Home care's Reports & Analytics (/api/reports for the home-care vertical: CrmSettings.reports.module 'homecare', mounted
// by server/modules/crm.ts in place of the shared CRM reports). Moved from
// templates/crm-homecare/backend/src/routes/reports.ts (ported from CVHC routes/reports.js).
//
// The business rules, as CVHC settled them (the SQL is server/data/homecarePlanning.ts):
//   · SCHEDULED hours come from the schedule engine — the actual occurrences in the range.
//   · WORKED hours = the CLOCKED time of completed punches; PAYABLE ("delivered") hours = payroll-reviewed shifts PLUS
//     clock entries no approved review covers yet.
//   · REVENUE = released invoices (counted whole, by their first day of service) + claims (by service date). Hours with
//     no rate on file count $0 and are reported as unvalued.
//   · Days are the agency's calendar days (core/agencyTime.ts), never the UTC server's.
//
// Who may: the template put every report behind requireAdmin. Each now asks a permission a caregiver does not hold:
// reports that show money (overview, revenue, P&L, by payer, client revenue, the client report with its invoices,
// Client Hours by Week for the insurer's portal, the visits summary for invoice prep) ask care-billing:read; hours and
// pay ask care-payroll:read; a caregiver's performance and ratings ask care-hr:read; incidents ask care-compliance:read.
// An export asks the permission of the report it exports.
import { Hono, type Context, type Next } from 'hono'
import PDFDocument from 'pdfkit'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { createHomecareCore } from '../core/index.ts'
import { addDays, isYmd } from '../core/agencyTime.ts'
import { ON_TIME_GRACE_MINUTES } from '../core/punchRules.ts'
import * as q from '../../../data/homecarePlanning.ts'

const num = (v: any) => parseFloat(v) || 0

/** Body/query dates: given → must be real YYYY-MM-DD; missing → the default range. */
function parseRange(start: unknown, end: unknown, defStart: string, defEnd: string): { startDate: string; endDate: string } | { error: string } {
  const s = start == null || start === '' ? defStart : start
  const e = end == null || end === '' ? defEnd : end
  if (!isYmd(s) || !isYmd(e)) return { error: 'startDate and endDate must be YYYY-MM-DD dates' }
  if (s > e) return { error: 'startDate must be on or before endDate' }
  return { startDate: s, endDate: e }
}
const idOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
async function postBody(c: Context): Promise<any> {
  try { return (await c.req.json()) || {} } catch { return {} }
}

// ==================== CSV / PDF ====================
const csvCell = (v: any) => {
  if (v == null) return ''
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
type Col = { key: string; label: string }
const toCSV = (data: any[], columns: Col[]) =>
  columns.map((col) => csvCell(col.label)).join(',') + '\n' +
  data.map((r) => columns.map((col) => csvCell(r[col.key])).join(',')).join('\n') + '\n'
const csvReply = (c: Context, filename: string, body: string) =>
  c.body(body, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` })
const pdfReply = (c: Context, filename: string, buf: Buffer) =>
  c.body(new Uint8Array(buf), 200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` })
function renderPdf(build: (doc: PDFKit.PDFDocument) => void, opts: any = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER', ...opts })
    const chunks: Buffer[] = []
    doc.on('data', (b: Buffer) => chunks.push(b))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    try { build(doc); doc.end() } catch (e) { reject(e) }
  })
}
const slug = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'agency'
/** A camelCase key as a column heading: payableHours → PAYABLE HOURS. */
const heading = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toUpperCase()
/** A CSV column's title, for a spreadsheet: "clockedHours" → "Clocked Hours" (the export's titles were the code's keys). */
const columnTitle = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())

// ==================== CLIENT HOURS BY WEEK: pairing ====================
/**
 * Pure pairing + payroll-note logic for Client Hours by Week. A punch pairs with a visit the way payroll pairs them:
 * same caregiver + client + local date, nearest scheduled start. Inputs are the data functions' camelCase rows.
 */
export function buildClientWeek({ occ, punches, cancelled, reviews }: { occ: any[]; punches: any[]; cancelled: any[]; reviews: any[] }) {
  // One payroll decision per shift: a correction beats a plain approval, then the newest decision wins.
  const RANK: Record<string, number> = { manual_entry: 3, excused: 3, approved: 2 }
  const better = (a: any, b: any) => !a ? b
    : ((RANK[b.status] || 0) - (RANK[a.status] || 0)
      || (new Date(b.decidedAt || 0).getTime() - new Date(a.decidedAt || 0).getTime())) > 0 ? b : a
  const reviewByEntry = new Map<string, any>(), reviewBySlot = new Map<string, any>()
  for (const r of reviews) {
    if (r.timeEntryId) reviewByEntry.set(r.timeEntryId, better(reviewByEntry.get(r.timeEntryId), r))
    if (r.scheduleId) {
      const k = `${r.caregiverId}|${r.day}|${r.scheduleId}`
      reviewBySlot.set(k, better(reviewBySlot.get(k), r))
    }
  }
  // Only what the office should see: corrections, and visits paid with no clock-in. Routine "Bulk approved at
  // scheduled hours" rows add nothing and are left out.
  const payrollNote = (rev: any) => {
    if (!rev) return null
    const note = rev.resolutionNotes && !/^Bulk approved/.test(rev.resolutionNotes) ? String(rev.resolutionNotes).trim() : null
    if (rev.status === 'manual_entry') return { kind: 'manual', payableMinutes: rev.payableMinutes, note }
    if (rev.status === 'excused') return { kind: 'excused', payableMinutes: 0, note }
    if (rev.status === 'approved' && !rev.timeEntryId) return { kind: 'paid_no_clock_in', payableMinutes: rev.payableMinutes, note }
    if (rev.status === 'approved' && rev.payableMinutes != null
        && rev.payableMinutes !== rev.scheduledMinutes && rev.payableMinutes !== rev.actualMinutes) {
      return { kind: 'adjusted', payableMinutes: rev.payableMinutes, note }
    }
    return note ? { kind: 'note', payableMinutes: rev.payableMinutes, note } : null
  }
  const flagsOf = (p: any) => p && p.approvalReason ? String(p.approvalReason).split(',').map((s) => s.trim()).filter(Boolean) : []
  const hmToMin = (t: string) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0) }

  const unmatched = [...punches]
  const visits = occ.map((v) => {
    const cands = unmatched.filter((p) => p.caregiverId === v.caregiverId && p.clientId === v.clientId && p.day === v.day)
    cands.sort((a, b) => Math.abs(hmToMin(a.startHm) - hmToMin(v.schedStart)) - Math.abs(hmToMin(b.startHm) - hmToMin(v.schedStart)))
    const p = cands[0] || null
    if (p) unmatched.splice(unmatched.indexOf(p), 1)
    const n = payrollNote((p && reviewByEntry.get(p.id)) || reviewBySlot.get(`${v.caregiverId}|${v.day}|${v.scheduleId}`))
    return {
      type: 'visit', day: v.day, clientId: v.clientId, caregiverName: v.caregiverName, isTraining: !!v.isTraining,
      schedStart: v.schedStart, schedEnd: v.schedEnd, schedMinutes: v.schedMinutes,
      clockIn: p ? p.startTime : null, clockOut: p ? p.endTime : null,
      clockedMinutes: p ? p.clockedMinutes : null, timeEntryId: p ? p.id : null,
      flags: flagsOf(p),
      // Never say "no clock-in" beside a visit that shows one.
      payroll: n && n.kind === 'paid_no_clock_in' && p ? null : n,
    }
  })
  const extra = unmatched.map((p) => ({
    type: 'unscheduled', day: p.day, clientId: p.clientId, caregiverName: p.caregiverName, isTraining: false,
    schedStart: null, schedEnd: null, schedMinutes: null,
    clockIn: p.startTime, clockOut: p.endTime, clockedMinutes: p.clockedMinutes, timeEntryId: p.id,
    flags: flagsOf(p),
    payroll: payrollNote(reviewByEntry.get(p.id)),
  }))
  const cancels = cancelled.map((x) => ({
    type: 'cancelled', day: x.day, clientId: x.clientId, caregiverName: x.caregiverName || '', cancelReason: x.cancelReason,
    isTraining: false,
    schedStart: x.schedStart, schedEnd: x.schedEnd, schedMinutes: null,
    clockIn: null, clockOut: null, clockedMinutes: null, timeEntryId: null, flags: [] as string[], payroll: null,
  }))
  return [...visits, ...extra, ...cancels] as any[]
}

// ==================== CLIENT COMPREHENSIVE REPORT: sections ====================
const ALL_CLIENT_REPORT_SECTIONS = [
  'demographics', 'care_plan', 'medications', 'adls',
  'visits', 'incidents', 'communications', 'documents',
  'authorizations', 'billing', 'audit',
]
/** Never put the portal credential or the SSN into a report. */
const SECRET_CLIENT_KEYS = ['ssnEncrypted', 'portalToken', 'portalTokenExp', 'portalPasswordHash']

/** Which permission an export of this report type asks. */
const exportPermission = (type: string) =>
  type === 'billing' || type === 'revenue' ? 'care-billing:read'
    : type === 'compliance' ? 'care-hr:read'
      // The client list is the office's (template requireAdmin); a caregiver holds care-clients:read for their own only.
      : type === 'clients' ? 'care-clients:update'
        : 'care-payroll:read'
/** Which permission a summary PDF of this tab asks. */
const exportPdfPermission = (type: string) =>
  type === 'overview' || type === 'hours' ? 'care-payroll:read' : type === 'performance' ? 'care-hr:read' : 'care-billing:read'

export function createHomecareReportsRoutes(d: CrmDeps) {
  const core = createHomecareCore(d)
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  /**
   * The Reports switch (Settings › Features, `reports`) is Reports & Analytics: every report it runs and exports. Off,
   * they are refused as every switched-off module is (FEATURE_NOT_ENABLED) — the switch hid nothing before (live test
   * 2026-10-22). A client's own report (Clients › Report, /client/:id) and the Client Week (/client-week) are those
   * pages' tools, not Reports & Analytics, and stay. Registered before the routes, so it runs first.
   */
  const reportsSwitch = d.features.requireEnabledFeature('reports')
  for (const p of ['/overview', '/hours', '/performance', '/satisfaction', '/revenue', '/pnl', '/caregiver-productivity', '/hours-by-payer',
    '/caregiver-utilization', '/client-incidents', '/client-revenue-by-month', '/client-visits-summary', '/:type/export', '/:type/export-pdf']) {
    app.use(p, reportsSwitch)
  }

  /** The permission that depends on the path's report type. */
  const byType =(perm: (type: string) => string) => (c: Context, next: Next) => requirePermission(perm(c.req.param('type') || ''))(c, next)

  /** The report window's default: one month back through the agency's today. */
  async function defaultRange(companyId: string, tz: string) {
    const today = await core.time.today(companyId, tz)
    const x = new Date(`${today}T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() - 1)
    return { defStart: x.toISOString().slice(0, 10), defEnd: today }
  }

  /** The POSTed report's range (the screen's default when missing), the filters, the zone. */
  async function postedRange(c: Context<AppEnv>) {
    const body = await postBody(c)
    const { companyId } = c.get('user')
    const tz = await core.time.timezone(companyId)
    const { defStart, defEnd } = await defaultRange(companyId, tz)
    const range = parseRange(body.startDate, body.endDate, defStart, defEnd)
    return { body, companyId, tz, range }
  }

  /** A drill-down's range: both dates required. */
  async function requireRange(c: Context<AppEnv>): Promise<{ startDate: string; endDate: string; tz: string; companyId: string } | Response> {
    const s = c.req.query('startDate'), e = c.req.query('endDate')
    if (!s || !e) return fail(c, 400, 'startDate + endDate required')
    const r = parseRange(s, e, s, e)
    if ('error' in r) return fail(c, 400, r.error)
    const { companyId } = c.get('user')
    return { ...r, tz: await core.time.timezone(companyId), companyId }
  }

  const agencyName = async (companyId: string) => (await q.companyBrand(d.db, companyId)).name || 'Home Care Agency'

  // ==================== OVERVIEW ====================
  app.post('/overview', requirePermission('care-billing:read'), async (c) => {
    const { body, companyId, tz, range } = await postedRange(c)
    if ('error' in range) return fail(c, 400, range.error)
    const { startDate, endDate } = range
    const f = { caregiverId: idOrNull(body.caregiverId), clientId: idOrNull(body.clientId) }

    const [summary, payable, clocked, satisfaction, revenue, topCaregivers, topClients] = await Promise.all([
      q.scheduledSummary(d.db, companyId, startDate, endDate, f),
      q.payableHours(d.db, companyId, startDate, endDate, tz, f),
      q.clockedHours(d.db, companyId, startDate, endDate, tz, f),
      // Under the filter like every other overview figure (it was the whole agency's).
      q.averageSatisfaction(d.db, companyId, startDate, endDate, tz, f),
      q.billedRevenue(d.db, companyId, startDate, endDate, f.clientId),
      q.topCaregivers(d.db, companyId, startDate, endDate, tz, f),
      q.topClients(d.db, companyId, startDate, endDate, f),
    ])
    const schedHours = num(summary.totalHours)
    const payableHours = num(payable.payable)
    return one(c, {
      summary: {
        totalHours: schedHours,
        // Worked = clocked time; payable = what payroll pays (delivered). Two numbers, two labels.
        workedHours: num(clocked.clocked),
        payableHours,
        deliveredPct: schedHours > 0 ? Math.round((payableHours / schedHours) * 100) : null,
        totalRevenue: num(revenue.totalRevenue),
        totalShifts: parseInt(summary.totalShifts) || 0,
        avgSatisfaction: num(satisfaction.avgSatisfaction) || null,
      },
      topCaregivers,
      topClients,
    })
  })

  // ==================== HOURS ====================
  app.post('/hours', requirePermission('care-payroll:read'), async (c) => {
    const { body, companyId, tz, range } = await postedRange(c)
    if ('error' in range) return fail(c, 400, range.error)
    const { startDate, endDate } = range
    const f = { caregiverId: idOrNull(body.caregiverId), clientId: idOrNull(body.clientId) }

    const [hoursByWeek, hoursByType, caregiverBreakdown, workedByCg] = await Promise.all([
      q.scheduledHoursByWeek(d.db, companyId, startDate, endDate, f),
      q.scheduledHoursByServiceType(d.db, companyId, startDate, endDate, f),
      q.scheduledHoursByCaregiver(d.db, companyId, startDate, endDate, f),
      q.payableAndWorkedByCaregiver(d.db, companyId, startDate, endDate, tz, f),
    ])
    const worked = Object.fromEntries(workedByCg.map((r: any) => [r.caregiverId, num(r.workedHours)]))
    const payableBy = Object.fromEntries(workedByCg.map((r: any) => [r.caregiverId, num(r.payableHours)]))
    const totalHours = hoursByType.reduce((s: number, r: any) => s + num(r.hours), 0)
    return one(c, {
      hoursByWeek,
      hoursByType: hoursByType.map((r: any) => ({
        ...r,
        percentage: totalHours > 0 ? ((num(r.hours) / totalHours) * 100).toFixed(1) : 0,
      })),
      caregiverBreakdown: caregiverBreakdown.map((r: any) => ({ ...r, workedHours: worked[r.id] ?? 0, payableHours: payableBy[r.id] ?? 0 })),
      totalHours,
    })
  })

  // ==================== PERFORMANCE ====================
  app.post('/performance', requirePermission('care-hr:read'), async (c) => {
    const { body, companyId, tz, range } = await postedRange(c)
    if ('error' in range) return fail(c, 400, range.error)
    const { startDate, endDate } = range
    const caregiverId = idOrNull(body.caregiverId)

    const [performance, ratingDistribution, punctuality, delivery, gps] = await Promise.all([
      q.caregiverPerformance(d.db, companyId, startDate, endDate, tz, caregiverId),
      q.ratingDistribution(d.db, companyId, startDate, endDate, tz),
      q.punctualityByCaregiver(d.db, companyId, startDate, endDate, tz, ON_TIME_GRACE_MINUTES),
      q.payableAndWorkedByCaregiver(d.db, companyId, startDate, endDate, tz, { caregiverId: null, clientId: null }),
      q.gpsCaptureByCaregiver(d.db, companyId, startDate, endDate, tz),
    ])
    const deliveryByCg = Object.fromEntries(delivery.map((r: any) => [r.caregiverId, r]))
    const gpsByCg = Object.fromEntries(gps.map((r: any) => [r.caregiverId, r.gpsCapturePct]))
    return one(c, {
      caregiverPerformance: performance.map((r: any) => ({
        ...r,
        workedHours: num(deliveryByCg[r.id]?.workedHours ?? 0),
        payableHours: num(deliveryByCg[r.id]?.payableHours ?? 0),
        gpsCapturePct: gpsByCg[r.id] ?? null,
      })),
      ratingDistribution,
      punctuality: punctuality.map((r: any) => ({
        ...r,
        onTimePercentage: r.totalShifts > 0 ? ((r.onTimeCount / r.totalShifts) * 100).toFixed(1) : 0,
      })),
      onTimeRule: { graceMinutes: ON_TIME_GRACE_MINUTES, earlyCountsOnTime: false },
    })
  })

  // ==================== SATISFACTION ====================
  app.post('/satisfaction', requirePermission('care-hr:read'), async (c) => {
    const { body, companyId, tz, range } = await postedRange(c)
    if ('error' in range) return fail(c, 400, range.error)
    const { startDate, endDate } = range
    const caregiverId = idOrNull(body.caregiverId)

    const [overall, trend, byClient, themes] = await Promise.all([
      q.satisfactionOverall(d.db, companyId, startDate, endDate, tz, caregiverId),
      q.satisfactionTrend(d.db, companyId, startDate, endDate, tz),
      q.satisfactionByClient(d.db, companyId, startDate, endDate, tz),
      q.satisfactionThemes(d.db, companyId, startDate, endDate, tz),
    ])
    const total = parseInt(overall.totalRatings) || 0
    const pct = (n: any) => (total > 0 ? ((num(n) / total) * 100).toFixed(1) : 0)
    return one(c, {
      satisfaction: {
        avgRating: num(overall.avgRating),
        totalRatings: total,
        positivePercentage: pct(overall.positiveCount),
        neutralPercentage: pct(overall.neutralCount),
        negativePercentage: pct(overall.negativeCount),
        trend,
        feedbackThemes: themes,
      },
      byClient,
    })
  })

  // ==================== REVENUE ====================
  app.post('/revenue', requirePermission('care-billing:read'), async (c) => {
    const { body, companyId, tz, range } = await postedRange(c)
    if ('error' in range) return fail(c, 400, range.error)
    const { startDate, endDate } = range
    const clientId = idOrNull(body.clientId)
    const today = await core.time.today(companyId, tz)

    const [inv, clm, hours, byServiceType, byPayer, aging, byClient] = await Promise.all([
      q.invoiceRevenueTotals(d.db, companyId, startDate, endDate, clientId),
      q.claimRevenueTotals(d.db, companyId, startDate, endDate, clientId),
      // The same client's scheduled hours: revenue per hour of one client over everyone's hours read low.
      q.scheduledSummary(d.db, companyId, startDate, endDate, { caregiverId: null, clientId }),
      q.revenueByServiceType(d.db, companyId, startDate, endDate, clientId),
      q.revenueByPayer(d.db, companyId, startDate, endDate, clientId),
      q.receivablesAging(d.db, companyId, today, clientId),
      q.revenueByClient(d.db, companyId, startDate, endDate, clientId),
    ])
    const totalRevenue = num(inv.total) + num(clm.total)
    const scheduledHours = num(hours.totalHours)
    return one(c, {
      revenue: {
        total: totalRevenue,
        collected: num(inv.collected) + num(clm.collected),
        outstanding: num(inv.outstanding) + num(clm.outstanding),
        invoiceCount: (parseInt(inv.invoiceCount) || 0) + (parseInt(clm.claimCount) || 0),
        avgPerScheduledHour: scheduledHours > 0 ? (totalRevenue / scheduledHours).toFixed(2) : 0,
        scheduledHours,
      },
      ar: aging,
      byPayer,
      byServiceType,
      byClient,
    })
  })

  // ==================== PROFIT & LOSS ====================
  // Earned basis on delivered work: payroll = delivered minutes × pay rate + 7.65% est. employer tax; earned revenue =
  // delivered minutes × the client's contract rate. Invoices count whole, released only, by their first day of service.
  app.get('/pnl', requirePermission('care-billing:read'), async (c) => {
    const { companyId } = c.get('user')
    const tz = await core.time.timezone(companyId)
    const today = await core.time.today(companyId, tz)
    const range = parseRange(c.req.query('startDate'), c.req.query('endDate'), `${today.slice(0, 8)}01`, today)
    if ('error' in range) return fail(c, 400, range.error)
    const { startDate: start, endDate: end } = range

    const [revenue, revenueByPayer, expenses, dm] = await Promise.all([
      q.pnlRevenue(d.db, companyId, start, end),
      q.pnlRevenueByPayer(d.db, companyId, start, end),
      q.expensesByCategory(d.db, companyId, start, end),
      q.deliveredMoney(d.db, companyId, start, end, tz),
    ])
    const totalExpenses = expenses.reduce((s: number, e: any) => s + num(e.categoryTotal), 0)
    const totalBilled = num(revenue.totalBilled)
    const totalCollected = num(revenue.totalCollected)
    const grossPayroll = num(dm.grossPayroll)
    const ppEarned = num(dm.ppEarned)
    const payerEarned = num(dm.payerEarned)
    const earnedRevenue = ppEarned + payerEarned
    const unbilledEst = Math.max(0, earnedRevenue - totalBilled)
    // Net subtracts payroll INCLUDING est. employer taxes — the number the summary table shows.
    const payrollTotal = grossPayroll * 1.0765
    const netIncome = earnedRevenue - totalExpenses - payrollTotal
    const netIncomeCash = totalCollected - totalExpenses - payrollTotal
    return one(c, {
      period: { start, end },
      revenue,
      revenueByPayer,
      expenses: { total: totalExpenses, byCategory: expenses },
      payroll: { gross: grossPayroll, estimatedTaxes: grossPayroll * 0.0765, total: payrollTotal },
      delivered: {
        hours: num(dm.deliveredHours),
        privatePayHours: num(dm.ppHours),
        privatePayEarned: ppEarned,
        payerHours: num(dm.payerHours),
        payerEarned,
        unvaluedHours: num(dm.unvaluedHours),
      },
      unbilledEst,
      earnedRevenue,
      netIncome,
      netIncomeCash,
      margin: earnedRevenue > 0 ? ((netIncome / earnedRevenue) * 100).toFixed(2) : 0,
    })
  })

  // ==================== CAREGIVER PRODUCTIVITY ====================
  app.get('/caregiver-productivity', requirePermission('care-payroll:read'), async (c) => {
    const { companyId } = c.get('user')
    const tz = await core.time.timezone(companyId)
    const today = await core.time.today(companyId, tz)
    const range = parseRange(c.req.query('startDate'), c.req.query('endDate'), addDays(today, -30), today)
    if ('error' in range) return fail(c, 400, range.error)
    const rows = await q.caregiverProductivity(d.db, companyId, range.startDate, range.endDate)
    return list(c, rows, { page: 1, limit: rows.length, total: rows.length })
  })

  // ==================== DRILL-DOWN REPORTS (GET, ?format=csv) ====================
  // Hours by payer — clocked and billable hours per referral source.
  app.get('/hours-by-payer', requirePermission('care-billing:read'), async (c) => {
    const r = await requireRange(c); if (r instanceof Response) return r
    const { startDate, endDate, tz, companyId } = r
    const rows = await q.hoursByPayer(d.db, companyId, startDate, endDate, tz)
    if (c.req.query('format') === 'csv') {
      return csvReply(c, `hours-by-payer-${startDate}-to-${endDate}.csv`, toCSV(rows, [
        { key: 'payerName', label: 'Payer' }, { key: 'payerType', label: 'Type' },
        { key: 'activeClients', label: 'Clients' }, { key: 'visits', label: 'Visits' },
        { key: 'totalHours', label: 'Clocked Hours' }, { key: 'billableHours', label: 'Billable Hours' },
        { key: 'avgVisitHours', label: 'Avg Clocked Visit Hours' },
        { key: 'firstVisit', label: 'First Visit' }, { key: 'lastVisit', label: 'Last Visit' },
      ]))
    }
    return one(c, { rows, period: { startDate, endDate } })
  })

  // Caregiver utilization — billable hours vs capacity (max hours a week × the weeks in the period).
  app.get('/caregiver-utilization', requirePermission('care-payroll:read'), async (c) => {
    const r = await requireRange(c); if (r instanceof Response) return r
    const { startDate, endDate, tz, companyId } = r
    const rows = (await q.caregiverUtilization(d.db, companyId, startDate, endDate, tz))
      .map((x: any) => ({ ...x, name: [x.firstName, x.lastName].filter(Boolean).join(' ') }))
    if (c.req.query('format') === 'csv') {
      return csvReply(c, `caregiver-utilization-${startDate}-to-${endDate}.csv`, toCSV(rows, [
        { key: 'name', label: 'Name' },
        { key: 'maxHoursPerWeek', label: 'Max Hrs/Week' },
        { key: 'capacityHours', label: 'Period Capacity (hrs)' },
        { key: 'actualHours', label: 'Billable (hrs)' },
        { key: 'visits', label: 'Visits' },
        { key: 'utilizationPct', label: 'Utilization %' },
      ]))
    }
    return one(c, { rows, period: { startDate, endDate } })
  })

  // Client incident history — incidents rolled up per client.
  app.get('/client-incidents', requirePermission('care-compliance:read'), async (c) => {
    const r = await requireRange(c); if (r instanceof Response) return r
    const { startDate, endDate, companyId } = r
    const rows = await q.incidentsByClient(d.db, companyId, startDate, endDate, idOrNull(c.req.query('clientId')))
    if (c.req.query('format') === 'csv') {
      return csvReply(c, `client-incidents-${startDate}-to-${endDate}.csv`, toCSV(rows, [
        { key: 'firstName', label: 'First' }, { key: 'lastName', label: 'Last' },
        { key: 'incidentCount', label: 'Incidents' },
        { key: 'criticalCount', label: 'Critical' }, { key: 'severeCount', label: 'Severe' },
        { key: 'moderateCount', label: 'Moderate' }, { key: 'minorCount', label: 'Minor' },
        { key: 'followupCount', label: 'Needs Follow-up' },
        { key: 'earliest', label: 'Earliest' }, { key: 'latest', label: 'Latest' },
      ]))
    }
    return one(c, { rows, period: { startDate, endDate } })
  })

  // Client revenue by month — per-client released-invoice totals, collected vs outstanding.
  app.get('/client-revenue-by-month', requirePermission('care-billing:read'), async (c) => {
    const r = await requireRange(c); if (r instanceof Response) return r
    const { startDate, endDate, tz, companyId } = r
    const today = await core.time.today(companyId, tz)
    const rows = await q.clientRevenueByMonth(d.db, companyId, startDate, endDate, today)
    if (c.req.query('format') === 'csv') {
      return csvReply(c, `client-revenue-by-month-${startDate}-to-${endDate}.csv`, toCSV(rows, [
        { key: 'month', label: 'Month' }, { key: 'firstName', label: 'First' }, { key: 'lastName', label: 'Last' },
        { key: 'invoiceCount', label: 'Invoices' }, { key: 'totalBilled', label: 'Billed' },
        { key: 'totalPaid', label: 'Paid' }, { key: 'outstanding', label: 'Outstanding' },
        { key: 'paidCount', label: 'Paid Invoices' }, { key: 'overdueCount', label: 'Overdue Invoices' },
        { key: 'lastBilled', label: 'Last Billed' },
      ]))
    }
    return one(c, { rows, period: { startDate, endDate } })
  })

  // Client visits summary — per-client visit count and hours (invoice prep).
  app.get('/client-visits-summary', requirePermission('care-billing:read'), async (c) => {
    const r = await requireRange(c); if (r instanceof Response) return r
    const { startDate, endDate, tz, companyId } = r
    const rows = await q.clientVisitsSummary(d.db, companyId, startDate, endDate, tz)
    if (c.req.query('format') === 'csv') {
      return csvReply(c, `client-visits-summary-${startDate}-to-${endDate}.csv`, toCSV(rows, [
        { key: 'firstName', label: 'First' }, { key: 'lastName', label: 'Last' },
        { key: 'payerName', label: 'Payer' }, { key: 'careTypeName', label: 'Care Type' },
        { key: 'visits', label: 'Visits' }, { key: 'distinctCaregivers', label: 'Distinct Caregivers' },
        { key: 'totalHours', label: 'Clocked Hours' }, { key: 'billableHours', label: 'Billable Hours' },
        { key: 'firstVisit', label: 'First Visit' }, { key: 'lastVisit', label: 'Last Visit' },
      ]))
    }
    return one(c, { rows, period: { startDate, endDate } })
  })

  // ==================== CLIENT HOURS BY WEEK ====================
  // Who was at each client, and when, for one Sunday–Saturday week: every scheduled visit beside the clock-in/out that
  // belongs to it, clock-ins with no visit, and visits cancelled with a reason. Built for entering hours into an
  // insurer's portal. Read-only — corrections are made in Payroll → Shift Review and shown here.
  app.get('/client-week', requirePermission('care-billing:read'), async (c) => {
    const { companyId } = c.get('user')
    // No weekStart → THIS week on the agency's clock (shared with Portal Claim Days).
    const asked = c.req.query('weekStart')
    const weekStart = asked == null || asked === '' ? await core.time.weekStart(companyId) : String(asked)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return fail(c, 400, 'weekStart must be YYYY-MM-DD')
    const start = new Date(`${weekStart}T12:00:00Z`)
    if (isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== weekStart || start.getUTCDay() !== 0) {
      return fail(c, 400, 'weekStart must be a Sunday')
    }
    const weekEnd = addDays(weekStart, 6)
    const cid = idOrNull(c.req.query('clientId'))
    const tz = await core.time.timezone(companyId)

    const [occ, punches, cancelled, reviews] = await Promise.all([
      q.weekVisits(d.db, companyId, weekStart, weekEnd, cid),
      q.weekPunches(d.db, companyId, weekStart, weekEnd, tz, cid),
      q.weekCancellations(d.db, companyId, weekStart, weekEnd, cid),
      q.weekPayrollReviews(d.db, companyId, weekStart, weekEnd, cid),
    ])
    const result = buildClientWeek({ occ, punches, cancelled, reviews })
    const ids = [...new Set(result.map((r) => r.clientId as string))]
    const byId = new Map((await q.clientNames(d.db, companyId, ids)).map((n: any) => [n.id, n]))
    const sortKey = (r: any) => `${r.day} ${r.schedStart || r.clockIn || ''}`
    const clients = ids.map((id) => {
      const cl: any = byId.get(id) || {}
      const rows = result.filter((r) => r.clientId === id).sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
      return {
        clientId: id,
        name: `${cl.firstName || ''} ${cl.lastName || ''}`.trim(),
        isPrivatePay: !!cl.isPrivatePay,
        rows,
        scheduledMinutes: rows.reduce((s, r) => s + (r.type === 'visit' ? r.schedMinutes || 0 : 0), 0),
        clockedMinutes: rows.reduce((s, r) => s + (r.clockedMinutes || 0), 0),
        missingClockIns: rows.filter((r) => r.type === 'visit' && !r.clockIn).length,
      }
    }).sort((a, b) => a.name.localeCompare(b.name))
    return one(c, { weekStart, weekEnd, timezone: tz, clients })
  })

  // ==================== CLIENT COMPREHENSIVE REPORT ====================
  // Every record tied to a client within a date range — one source for audits, surveyor visits, family requests,
  // incident investigations and legal requests. Generating it is written to the clinical audit trail.
  async function fetchClientReportData(companyId: string, clientId: string, from: string, to: string, sections: string[], tz: string) {
    const wants = new Set(sections)
    const client = await q.reportClient(d.db, companyId, clientId)
    if (!client) return null
    for (const k of SECRET_CLIENT_KEYS) delete client[k]
    const data: any = { clientId, period: { from, to }, sections: [...wants], timezone: tz, client }

    const [ec, onboard, assign] = await Promise.all([
      q.reportEmergencyContacts(d.db, companyId, clientId),
      q.reportOnboarding(d.db, companyId, clientId),
      q.reportAssignments(d.db, companyId, clientId),
    ])
    data.emergencyContacts = ec
    data.onboarding = onboard[0] || null
    data.assignments = assign

    if (wants.has('care_plan')) {
      const [plans, adlReq] = await Promise.all([q.reportCarePlans(d.db, companyId, clientId), q.reportAdlRequirements(d.db, companyId, clientId)])
      data.carePlans = plans
      data.adlRequirements = adlReq
    }
    if (wants.has('medications')) {
      const [meds, logs] = await Promise.all([
        q.reportMedications(d.db, companyId, clientId), q.reportMedicationLogs(d.db, companyId, clientId, from, to, tz),
      ])
      data.medications = meds
      data.medicationLogs = logs
    }
    if (wants.has('adls')) data.adlLogs = await q.reportAdlLogs(d.db, companyId, clientId, from, to, tz)
    if (wants.has('visits')) data.visits = await q.reportVisits(d.db, companyId, clientId, from, to, tz)
    if (wants.has('incidents')) data.incidents = await q.reportIncidents(d.db, companyId, clientId, from, to, tz)
    if (wants.has('communications')) data.communications = await q.reportCommunications(d.db, companyId, clientId, from, to, tz)
    if (wants.has('documents')) data.documents = await q.reportDocuments(d.db, companyId, clientId)
    if (wants.has('authorizations')) data.authorizations = await q.reportAuthorizations(d.db, companyId, clientId)
    // Every invoice is listed; only released ones count toward the total — a draft is neither billed nor owed.
    if (wants.has('billing')) data.invoices = await q.reportInvoices(d.db, companyId, clientId, from, to)
    if (wants.has('audit')) data.auditLog = await q.reportAuditTrail(d.db, companyId, clientId, from, to, tz)
    return data
  }

  async function clientReportParams(c: Context<AppEnv>, companyId: string, tz: string): Promise<{ from: string; to: string; sections: string[] } | { error: string }> {
    const today = await core.time.today(companyId, tz)
    const from = c.req.query('from') || addDays(today, -90)
    const to = c.req.query('to') || today
    if (!isYmd(from) || !isYmd(to)) return { error: 'from and to must be YYYY-MM-DD dates' }
    if (from > to) return { error: 'from must be on or before to' }
    const sectionsParam = String(c.req.query('sections') || '').trim()
    const sections = sectionsParam
      ? sectionsParam.split(',').map((s) => s.trim()).filter((s) => ALL_CLIENT_REPORT_SECTIONS.includes(s))
      : ALL_CLIENT_REPORT_SECTIONS
    return { from, to, sections }
  }

  // GET /client/:id — JSON preview (counts) for the report dialog.
  app.get('/client/:id', requirePermission('care-billing:read'), async (c) => {
    const user = c.get('user')
    const tz = await core.time.timezone(user.companyId)
    const p = await clientReportParams(c, user.companyId, tz)
    if ('error' in p) return fail(c, 400, p.error)
    const data = await fetchClientReportData(user.companyId, c.req.param('id'), p.from, p.to, p.sections, tz)
    if (!data) return fail(c, 404, 'Client not found')
    await core.careAudit.writeCareAudit(user, 'REPORT_GENERATED_JSON', 'clients', c.req.param('id'), { from: p.from, to: p.to, sections: p.sections })
    return one(c, data)
  })

  // GET /client/:id/pdf — the downloadable report.
  app.get('/client/:id/pdf', requirePermission('care-billing:read'), async (c) => {
    const user = c.get('user')
    const tz = await core.time.timezone(user.companyId)
    const p = await clientReportParams(c, user.companyId, tz)
    if ('error' in p) return fail(c, 400, p.error)
    const data = await fetchClientReportData(user.companyId, c.req.param('id'), p.from, p.to, p.sections, tz)
    if (!data) return fail(c, 404, 'Client not found')
    await core.careAudit.writeCareAudit(user, 'REPORT_GENERATED_PDF', 'clients', c.req.param('id'), { from: p.from, to: p.to, sections: p.sections })
    const brand = await q.companyBrand(d.db, user.companyId)
    const name = `${data.client.firstName}-${data.client.lastName}`.replace(/[^A-Za-z0-9-]/g, '')
    const buf = await renderPdf((doc) => renderClientReportPdf(doc, data, brand.name || 'Home Care Agency', brandColor(brand.primaryColor)), { bufferPages: true })
    return pdfReply(c, `client-report-${name}-${p.from}-to-${p.to}.pdf`, buf)
  })

  // ==================== EXPORTS ====================
  // POST /:type/export  { startDate, endDate, format: 'csv' | 'pdf' } — tabular export.
  app.post('/:type/export', byType(exportPermission), async (c) => {
    const type = c.req.param('type') || ''
    const body = await postBody(c)
    const format = body.format || 'csv'
    if (format !== 'csv' && format !== 'pdf') return fail(c, 400, `Unsupported format: ${format}`)
    const { companyId } = c.get('user')
    const tz = await core.time.timezone(companyId)
    const today = await core.time.today(companyId, tz)
    const range = parseRange(body.startDate, body.endDate, `${today.slice(0, 8)}01`, today)
    if ('error' in range) return fail(c, 400, range.error)
    const { startDate: sd, endDate: ed } = range
    // The report's own filter (the screen's caregiver and client pickers): the file holds what the report showed.
    const f = { caregiverId: idOrNull(body.caregiverId), clientId: idOrNull(body.clientId) }

    let data: any[]
    if (type === 'overview' || type === 'caregiver_hours' || type === 'caregiver-hours') data = await q.exportCaregiverHours(d.db, companyId, sd, ed, tz, f)
    else if (type === 'billing' || type === 'revenue') data = await q.exportBilling(d.db, companyId, sd, ed, f)
    else if (type === 'compliance') data = await q.exportCompliance(d.db, companyId, today, f)
    else if (type === 'clients') data = await q.exportClients(d.db, companyId, tz, f)
    // Pay is payroll's one rule (core/payrollPay.ts), never an estimate of its own: this was clocked minutes × the
    // default rate ($18 when none), which disagreed with Payroll → Calculate.
    else if (type === 'payroll') data = (await core.payroll.payrollForRange(companyId, sd, ed, { caregiverId: f.caregiverId })).map((l) => ({
      caregiver: `${l.firstName ?? ''} ${l.lastName ?? ''}`.trim(), shifts: l.shifts, regularHours: l.regularHours, overtimeHours: l.overtimeHours,
      baseRate: l.baseRate, overtimeRate: l.otRate, grossPay: l.grossPay,
    }))
    else data = await q.exportHours(d.db, companyId, sd, ed, tz, f)

    const agency = await agencyName(companyId)
    const filename = `${slug(agency)}-${type}-report-${sd}-to-${ed}`
    if (format === 'csv') {
      const keys = data.length ? Object.keys(data[0]) : []
      return csvReply(c, `${filename}.csv`, toCSV(data, keys.map((k) => ({ key: k, label: columnTitle(k) }))))
    }
    const buf = await renderPdf((doc) => {
      doc.fontSize(18).fillColor('#0F766E').text(agency, 50, 50)
      doc.fontSize(13).fillColor('#333').text(`${type.replace(/[_-]/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())} Report`, 50, 75)
      doc.fontSize(10).fillColor('#666').text(`Period: ${sd} – ${ed}`, 50, 95)
      doc.moveTo(50, 130).lineTo(562, 130).strokeColor('#0F766E').stroke()
      if (data.length === 0) {
        doc.fontSize(12).fillColor('#666').text('No data found for the selected period.', 50, 150)
        return
      }
      const keys = Object.keys(data[0])
      const colWidth = Math.min(Math.floor(512 / keys.length), 120)
      let y = 150
      doc.fontSize(9).fillColor('#fff')
      doc.rect(50, y, 512, 18).fill('#0F766E')
      keys.forEach((key, i) => { doc.fillColor('#fff').text(heading(key), 53 + i * colWidth, y + 4, { width: colWidth - 4, ellipsis: true }) })
      y += 20
      data.forEach((row, rowIdx) => {
        if (y > 700) { doc.addPage(); y = 50 }
        if (rowIdx % 2 === 0) doc.rect(50, y, 512, 16).fill('#F9FAFB')
        doc.fontSize(8).fillColor('#333')
        keys.forEach((key, i) => {
          const val = row[key] !== null && row[key] !== undefined ? (typeof row[key] === 'object' ? JSON.stringify(row[key]) : String(row[key])) : '—'
          doc.text(val, 53 + i * colWidth, y + 3, { width: colWidth - 4, ellipsis: true, lineBreak: false })
        })
        y += 18
      })
      doc.fontSize(10).fillColor('#333').text(`Total Records: ${data.length}`, 50, y + 10)
    })
    return pdfReply(c, `${filename}.pdf`, buf)
  })

  // POST /:type/export-pdf  { startDate, endDate } — the summary PDF for the tab on screen.
  app.post('/:type/export-pdf', byType(exportPdfPermission), async (c) => {
    const type = c.req.param('type') || ''
    const { body, companyId, tz, range } = await postedRange(c)
    if ('error' in range) return fail(c, 400, range.error)
    const { startDate, endDate } = range
    // The figures the report on screen showed: its filter, and the same queries.
    const f = { caregiverId: idOrNull(body.caregiverId), clientId: idOrNull(body.clientId) }

    let reportData: any = {}
    if (type === 'overview' || type === 'hours') {
      const [summary, caregivers] = await Promise.all([
        q.scheduledSummary(d.db, companyId, startDate, endDate, f),
        q.scheduledHoursPerCaregiver(d.db, companyId, startDate, endDate, f),
      ])
      reportData = { summary: { scheduledHours: summary.totalHours, totalShifts: summary.totalShifts }, caregivers }
    } else if (type === 'performance') {
      reportData = { caregivers: await q.ratingsPerCaregiver(d.db, companyId, startDate, endDate, tz, { caregiverId: f.caregiverId, clientId: null }) }
    } else if (type === 'revenue') {
      // The Revenue report's totals: invoices and stand-alone claims (it summed invoices alone, so the PDF and the
      // screen gave different totals for the same period).
      const [inv, clm] = await Promise.all([
        q.invoiceRevenueTotals(d.db, companyId, startDate, endDate, f.clientId),
        q.claimRevenueTotals(d.db, companyId, startDate, endDate, f.clientId),
      ])
      reportData = { revenue: {
        totalBilled: num(inv.total) + num(clm.total), collected: num(inv.collected) + num(clm.collected),
        outstanding: num(inv.outstanding) + num(clm.outstanding), invoiceCount: (parseInt(inv.invoiceCount) || 0) + (parseInt(clm.claimCount) || 0),
      } }
    }

    const agency = await agencyName(companyId)
    const buf = await renderPdf((doc) => {
      doc.rect(0, 0, doc.page.width, 80).fill('#0F766E')
      doc.fillColor('#fff').fontSize(22).font('Helvetica-Bold').text(agency, 50, 22)
      doc.fontSize(12).font('Helvetica').text(`${type.charAt(0).toUpperCase() + type.slice(1)} Report  •  ${startDate} to ${endDate}`, 50, 50)
      doc.fillColor('#111827')
      doc.y = 110
      if (type === 'overview' || type === 'hours') {
        const { summary, caregivers } = reportData
        doc.fontSize(16).font('Helvetica-Bold').text('Summary', 50, doc.y, { underline: true })
        doc.moveDown(0.5)
        doc.fontSize(12).font('Helvetica')
        doc.text(`Total Scheduled Hours: ${num(summary?.scheduledHours).toFixed(2)}`)
        doc.text(`Total Shifts: ${summary?.totalShifts || 0}`)
        doc.moveDown(1.5)
        doc.fontSize(14).font('Helvetica-Bold').text('Caregiver Breakdown', { underline: true })
        doc.moveDown(0.5)
        doc.fontSize(10).font('Helvetica-Bold')
        let y = doc.y
        doc.text('Caregiver', 50, y, { width: 200 }); doc.text('Hours', 250, y, { width: 80 }); doc.text('Clients', 330, y, { width: 80 })
        doc.moveTo(50, y + 14).lineTo(480, y + 14).stroke('#E5E7EB')
        doc.font('Helvetica').fontSize(10)
        y += 20
        for (const cg of caregivers || []) {
          if (y > 700) { doc.addPage(); y = 50 }
          doc.fillColor('#111827')
          doc.text(String(cg.name), 50, y, { width: 200 }); doc.text(num(cg.hours).toFixed(2), 250, y, { width: 80 }); doc.text(String(cg.clients || 0), 330, y, { width: 80 })
          y += 16
        }
      } else if (type === 'performance') {
        doc.fontSize(16).font('Helvetica-Bold').text('Caregiver Performance', 50, doc.y, { underline: true })
        doc.moveDown(0.5)
        doc.fontSize(10).font('Helvetica-Bold')
        let y = doc.y
        doc.text('Caregiver', 50, y, { width: 200 }); doc.text('Avg Rating', 250, y, { width: 100 }); doc.text('Reviews', 350, y, { width: 80 })
        doc.moveTo(50, y + 14).lineTo(480, y + 14).stroke('#E5E7EB')
        doc.font('Helvetica')
        y += 20
        for (const cg of reportData.caregivers || []) {
          if (y > 700) { doc.addPage(); y = 50 }
          doc.text(String(cg.name), 50, y, { width: 200 }); doc.text(num(cg.avgRating).toFixed(1) + ' / 5', 250, y, { width: 100 }); doc.text(String(cg.ratings || 0), 350, y, { width: 80 })
          y += 16
        }
      } else if (type === 'revenue') {
        const { revenue } = reportData
        const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
        doc.fontSize(16).font('Helvetica-Bold').text('Revenue Summary', 50, doc.y, { underline: true })
        doc.moveDown(0.5)
        doc.fontSize(12).font('Helvetica')
        doc.text(`Total Billed: ${money(num(revenue?.totalBilled))}`)
        doc.text(`Total Collected: ${money(num(revenue?.collected))}`)
        doc.text(`Invoices and claims: ${revenue?.invoiceCount || 0}`)
        doc.text(`Outstanding: ${money(num(revenue?.outstanding))}`)
      } else {
        doc.fontSize(12).font('Helvetica').text('This report has no PDF summary — use the CSV export.', 50, doc.y)
      }
    })
    return pdfReply(c, `${slug(agency)}-${type}-report-${startDate}-to-${endDate}.pdf`, buf)
  })

  return app
}

const brandColor = (v: any) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : '#0F766E')

/** The client comprehensive report as a PDF. `data` is fetchClientReportData's (camelCase). */
function renderClientReportPdf(doc: PDFKit.PDFDocument, data: any, agency: string, ACCENT: string) {
  const INK = '#111827', MUTED = '#6B7280', RULE = '#E5E7EB'
  const tz = data.timezone
  // A raw read hands back naive timestamps as Date instants (camelRows) and dates as 'YYYY-MM-DD'.
  const asDate = (v: any): Date | null => {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v
    const s = String(v)
    const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z')
    return isNaN(d.getTime()) ? null : d
  }
  const fmtDate = (v: any) => {
    if (!v) return '—'
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC' })
    const d = asDate(v)
    return d ? d.toLocaleDateString('en-US', { timeZone: tz }) : String(v)
  }
  const fmtDateTime = (v: any) => {
    if (!v) return '—'
    const d = asDate(v)
    return d ? d.toLocaleString('en-US', { timeZone: tz }) : String(v)
  }
  const fmtMoney = (v: any) => {
    const n = parseFloat(v)
    return isNaN(n) ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  const safe = (v: any) => (v === null || v === undefined || v === '') ? '—' : String(v)
  const minutesToHours = (m: any) => (m == null) ? '—' : (Number(m) / 60).toFixed(2) + ' h'
  const listOf = (v: any) => Array.isArray(v) ? v : (typeof v === 'string' && v.trim().startsWith('[') ? (() => { try { return JSON.parse(v) } catch { return [] } })() : [])
  const ensureSpace = (needed: number) => { if (doc.y + needed > doc.page.height - 60) doc.addPage() }
  const sectionHeader = (title: string) => {
    ensureSpace(40)
    doc.moveDown(0.75)
    doc.fillColor(ACCENT).fontSize(13).font('Helvetica-Bold').text(title, 50, doc.y, { paragraphGap: 2 })
    const y = doc.y
    doc.moveTo(50, y).lineTo(562, y).strokeColor(ACCENT).lineWidth(1.2).stroke()
    doc.moveDown(0.4)
    doc.fillColor(INK).fontSize(10).font('Helvetica')
  }
  const kv = (label: string, value: any) => {
    ensureSpace(14)
    doc.fontSize(9).fillColor(MUTED).font('Helvetica').text(label, 50, doc.y, { width: 140, continued: true })
    doc.fillColor(INK).font('Helvetica').text(safe(value), { width: 370 })
  }
  const paragraph = (text: any) => {
    ensureSpace(20)
    doc.fontSize(10).fillColor(INK).font('Helvetica').text(safe(text), 50, doc.y, { width: 512 })
    doc.moveDown(0.3)
  }
  const emptyNote = (msg: string) => {
    doc.fontSize(10).fillColor(MUTED).font('Helvetica-Oblique').text(msg, 50, doc.y)
    doc.fillColor(INK).font('Helvetica')
  }
  type TCol = { label: string; w: number; key?: string; get?: (r: any) => any }
  const renderTable = (columns: TCol[], rows: any[]) => {
    if (!rows || rows.length === 0) { emptyNote('No records in this period.'); return }
    const totalWidth = 512
    const colWidths = columns.map((col) => Math.floor(totalWidth * col.w))
    const startX = 50
    ensureSpace(24)
    let y = doc.y
    doc.rect(startX, y, totalWidth, 18).fill(ACCENT)
    doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold')
    let x = startX
    columns.forEach((col, i) => { doc.text(col.label, x + 4, y + 5, { width: colWidths[i] - 8, ellipsis: true }); x += colWidths[i] })
    doc.fillColor(INK).font('Helvetica')
    y += 18
    doc.y = y
    rows.forEach((row, idx) => {
      const cellTexts = columns.map((col) => safe(typeof col.get === 'function' ? col.get(row) : row[col.key as string]))
      doc.fontSize(8.5).font('Helvetica')
      let maxH = 12
      cellTexts.forEach((t, i) => { const h = doc.heightOfString(t, { width: colWidths[i] - 8 }); if (h > maxH) maxH = h })
      const rowH = maxH + 6
      ensureSpace(rowH + 2)
      y = doc.y
      if (idx % 2 === 0) doc.rect(startX, y, totalWidth, rowH).fill('#F9FAFB')
      doc.fillColor(INK)
      x = startX
      cellTexts.forEach((t, i) => { doc.text(t, x + 4, y + 3, { width: colWidths[i] - 8, height: rowH }); x += colWidths[i] })
      doc.moveTo(startX, y + rowH).lineTo(startX + totalWidth, y + rowH).strokeColor(RULE).lineWidth(0.5).stroke()
      doc.y = y + rowH
    })
    doc.moveDown(0.3)
  }

  // Header
  doc.rect(0, 0, doc.page.width, 72).fill(ACCENT)
  doc.fillColor('#fff').fontSize(18).font('Helvetica-Bold').text(agency, 50, 18)
  doc.fontSize(12).font('Helvetica').text('Client Comprehensive Report', 50, 42)
  doc.fillColor(INK)
  doc.y = 90
  const cl = data.client
  doc.fontSize(20).font('Helvetica-Bold').text(`${cl.firstName} ${cl.lastName}`, 50, doc.y)
  doc.moveDown(0.2)
  doc.fontSize(10).fillColor(MUTED).font('Helvetica').text(`Report Period: ${fmtDate(data.period.from)} – ${fmtDate(data.period.to)}`)
  doc.fillColor(INK)
  doc.moveDown(0.8)

  sectionHeader('Client Information')
  kv('Date of Birth', cl.dateOfBirth ? fmtDate(cl.dateOfBirth) : null)
  kv('Gender', cl.gender)
  kv('Phone', cl.phone)
  kv('Email', cl.email)
  kv('Address', [cl.address, cl.city, cl.state, cl.zip].filter(Boolean).join(', '))
  kv('Service Start', cl.startDate ? fmtDate(cl.startDate) : null)
  kv('Service Type', cl.serviceType)
  kv('Care Type', cl.careTypeName)
  kv('Referral Source', cl.referralSourceName)
  kv('Status', cl.isActive ? 'Active' : 'Inactive')

  sectionHeader('Insurance & Identifiers')
  kv('Primary Insurance', cl.insuranceProvider)
  kv('Insurance ID', cl.insuranceId)
  kv('Medicaid ID', cl.medicaidId)
  kv('MCO Member ID', cl.mcoMemberId)
  kv('Primary Diagnosis', cl.primaryDiagnosisCode)
  kv('Secondary Diagnosis', cl.secondaryDiagnosisCode)
  if (cl.isPrivatePay) kv('Private Pay Rate', cl.privatePayRate ? `$${cl.privatePayRate} / ${cl.privatePayRateType || 'hourly'}` : null)

  const conditions = listOf(cl.medicalConditions), allergies = listOf(cl.allergies), medsSummary = listOf(cl.medications)
  if (conditions.length || allergies.length || medsSummary.length) {
    sectionHeader('Medical Overview')
    if (conditions.length) kv('Conditions', conditions.join(', '))
    if (allergies.length) kv('Allergies', allergies.join(', '))
    if (medsSummary.length) kv('Medications (summary)', medsSummary.join(', '))
  }

  sectionHeader('Emergency Contacts')
  if (data.emergencyContacts.length === 0) emptyNote('No emergency contacts on file.')
  else renderTable([
    { label: 'Name', w: 0.28, key: 'name' }, { label: 'Relationship', w: 0.20, key: 'relationship' },
    { label: 'Phone', w: 0.22, key: 'phone' }, { label: 'Email', w: 0.22, key: 'email' },
    { label: 'Primary', w: 0.08, get: (r) => r.isPrimary ? 'Yes' : '' },
  ], data.emergencyContacts)

  sectionHeader('Caregiver Assignments')
  if (data.assignments.length === 0) emptyNote('No caregiver assignments on record.')
  else renderTable([
    { label: 'Caregiver', w: 0.32, key: 'caregiverName' }, { label: 'Assigned', w: 0.18, get: (r) => fmtDate(r.assignmentDate) },
    { label: 'Hrs/Wk', w: 0.12, key: 'hoursPerWeek' }, { label: 'Status', w: 0.18, key: 'status' },
    { label: 'Notes', w: 0.20, key: 'notes' },
  ], data.assignments)

  if (data.carePlans) {
    sectionHeader('Care Plan')
    if (data.carePlans.length === 0) emptyNote('No care plan on file.')
    data.carePlans.forEach((cp: any) => {
      ensureSpace(60)
      doc.fontSize(10).font('Helvetica-Bold').fillColor(INK).text(`${safe(cp.serviceType)} — ${fmtDate(cp.startDate)} to ${fmtDate(cp.endDate)}`, 50, doc.y)
      doc.font('Helvetica').fontSize(9)
      if (cp.serviceDescription) paragraph(`Service: ${cp.serviceDescription}`)
      if (cp.frequency) paragraph(`Frequency: ${cp.frequency}`)
      if (cp.careGoals) paragraph(`Goals: ${cp.careGoals}`)
      if (cp.specialInstructions) paragraph(`Special Instructions: ${cp.specialInstructions}`)
      if (cp.precautions) paragraph(`Precautions: ${cp.precautions}`)
      if (cp.medicationNotes) paragraph(`Medication Notes: ${cp.medicationNotes}`)
      if (cp.mobilityNotes) paragraph(`Mobility: ${cp.mobilityNotes}`)
      if (cp.dietaryNotes) paragraph(`Diet: ${cp.dietaryNotes}`)
      if (cp.communicationNotes) paragraph(`Communication: ${cp.communicationNotes}`)
      doc.moveDown(0.3)
    })
    if (data.adlRequirements?.length) {
      doc.moveDown(0.2)
      doc.fontSize(11).font('Helvetica-Bold').fillColor(INK).text('ADL Requirements', 50, doc.y)
      doc.moveDown(0.2)
      renderTable([
        { label: 'Category', w: 0.22, key: 'adlCategory' }, { label: 'Assistance', w: 0.18, key: 'assistanceLevel' },
        { label: 'Frequency', w: 0.18, key: 'frequency' }, { label: 'Instructions', w: 0.42, key: 'specialInstructions' },
      ], data.adlRequirements)
    }
  }

  if (data.medications) {
    sectionHeader('Medications')
    if (data.medications.length === 0) emptyNote('No medications on file.')
    else renderTable([
      { label: 'Medication', w: 0.26, key: 'medicationName' }, { label: 'Dosage', w: 0.12, key: 'dosage' },
      { label: 'Frequency', w: 0.15, key: 'frequency' }, { label: 'Route', w: 0.10, key: 'route' },
      { label: 'Prescriber', w: 0.20, key: 'prescriber' }, { label: 'Active', w: 0.09, get: (r) => r.isActive ? 'Yes' : 'No' },
      { label: 'PRN', w: 0.08, get: (r) => r.isPrn ? 'Yes' : '' },
    ], data.medications)
    if (data.medicationLogs) {
      doc.moveDown(0.3)
      doc.fontSize(11).font('Helvetica-Bold').fillColor(INK).text('Medication Administration (period)', 50, doc.y)
      doc.moveDown(0.2)
      renderTable([
        { label: 'Administered', w: 0.24, get: (r) => fmtDateTime(r.administeredTime) },
        { label: 'Medication', w: 0.24, key: 'medicationName' }, { label: 'Status', w: 0.14, key: 'status' },
        { label: 'Caregiver', w: 0.20, key: 'caregiverName' }, { label: 'Notes', w: 0.18, key: 'notes' },
      ], data.medicationLogs)
    }
  }

  if (data.adlLogs) {
    sectionHeader('ADL Activity Log')
    renderTable([
      { label: 'When', w: 0.20, get: (r) => fmtDateTime(r.performedAt) }, { label: 'Category', w: 0.20, key: 'adlCategory' },
      { label: 'Status', w: 0.12, key: 'status' }, { label: 'Assistance', w: 0.15, key: 'assistanceLevel' },
      { label: 'Caregiver', w: 0.18, key: 'caregiverName' }, { label: 'Notes', w: 0.15, key: 'notes' },
    ], data.adlLogs)
  }

  if (data.visits) {
    const visits = data.visits
    const totalMinutes = visits.reduce((s: number, v: any) => s + (v.durationMinutes || 0), 0)
    sectionHeader(`Visit / EVV History  (${visits.length} visits • ${(totalMinutes / 60).toFixed(2)} hours)`)
    const loc = (v: any) => { try { return typeof v === 'string' ? JSON.parse(v) : v } catch { return null } }
    renderTable([
      { label: 'Start', w: 0.16, get: (r) => fmtDateTime(r.startTime) },
      { label: 'End', w: 0.16, get: (r) => fmtDateTime(r.endTime) },
      { label: 'Dur.', w: 0.08, get: (r) => minutesToHours(r.durationMinutes) },
      { label: 'Caregiver', w: 0.18, key: 'caregiverName' },
      { label: 'EVV / Sandata', w: 0.20, get: (r) => r.sandataStatus ? `${r.sandataStatus}${r.sandataVisitId ? ' #' + r.sandataVisitId : ''}` : (r.isComplete ? 'complete' : 'open') },
      { label: 'Service', w: 0.10, get: (r) => [r.serviceCode, r.modifier].filter(Boolean).join(' ') },
      { label: 'GPS', w: 0.12, get: (r) => {
        if (r.gpsInLat) return `${Number(r.gpsInLat).toFixed(4)},${Number(r.gpsInLng).toFixed(4)}`
        const l = loc(r.clockInLocation)
        return l && l.lat ? `${Number(l.lat).toFixed(4)},${Number(l.lng).toFixed(4)}` : '—'
      } },
    ], visits)
  }

  if (data.incidents) {
    sectionHeader(`Incident Reports (${data.incidents.length})`)
    if (data.incidents.length === 0) emptyNote('No incidents reported in this period.')
    data.incidents.forEach((ir: any) => {
      ensureSpace(80)
      doc.fontSize(10).font('Helvetica-Bold').fillColor(INK).text(`${safe(ir.incidentType).replace(/_/g, ' ').toUpperCase()} — ${fmtDate(ir.incidentDate)}`, 50, doc.y)
      doc.fontSize(9).fillColor(MUTED).font('Helvetica').text(`Severity: ${safe(ir.severity)}    Caregiver: ${safe(ir.caregiverName)}    Reported by: ${safe(ir.reportedBy)}`)
      doc.fillColor(INK).fontSize(10)
      if (ir.description) paragraph(`Description: ${ir.description}`)
      if (ir.witnesses) paragraph(`Witnesses: ${ir.witnesses}`)
      if (ir.injuriesOrDamage) paragraph(`Injuries/Damage: ${ir.injuriesOrDamage}`)
      if (ir.actionsTaken) paragraph(`Actions Taken: ${ir.actionsTaken}`)
      if (ir.followUpRequired) paragraph(`Follow-up: ${safe(ir.followUpNotes)}`)
      doc.moveDown(0.2)
    })
  }

  if (data.communications) {
    sectionHeader(`Communication Log (${data.communications.length})`)
    if (data.communications.length === 0) emptyNote('No communications logged in this period.')
    data.communications.forEach((cm: any) => {
      ensureSpace(36)
      const tag = [cm.logType, cm.direction, cm.isPinned ? 'pinned' : null].filter(Boolean).join(' • ')
      doc.fontSize(9).fillColor(MUTED).font('Helvetica').text(`${fmtDateTime(cm.createdAt)} — ${tag} — by ${safe(cm.loggedByName)}`, 50, doc.y)
      if (cm.subject) doc.fontSize(10).fillColor(INK).font('Helvetica-Bold').text(safe(cm.subject), { width: 512 })
      doc.fontSize(10).fillColor(INK).font('Helvetica').text(safe(cm.body), { width: 512 })
      if (cm.followUpDate) doc.fontSize(9).fillColor(MUTED).text(`Follow-up by ${fmtDate(cm.followUpDate)} — ${cm.followUpDone ? 'done' : 'open'}`)
      doc.fillColor(INK)
      doc.moveDown(0.3)
    })
  }

  if (data.documents) {
    sectionHeader(`Documents on File (${data.documents.length})`)
    if (data.documents.length === 0) emptyNote('No documents on file.')
    else renderTable([
      { label: 'Name', w: 0.34, key: 'name' }, { label: 'Type', w: 0.18, key: 'documentType' },
      { label: 'Sent', w: 0.16, get: (r) => fmtDate(r.sentAt) }, { label: 'Status', w: 0.14, key: 'status' },
      { label: 'Signed', w: 0.18, get: (r) => r.signedAt ? fmtDate(r.signedAt) : '—' },
    ], data.documents)
  }

  if (data.authorizations) {
    sectionHeader(`Authorizations (${data.authorizations.length})`)
    if (data.authorizations.length === 0) emptyNote('No authorizations on file.')
    else renderTable([
      { label: 'Auth #', w: 0.14, key: 'authNumber' }, { label: 'Payer', w: 0.18, key: 'payerName' },
      { label: 'Code', w: 0.10, get: (r) => [r.procedureCode, r.modifier].filter(Boolean).join(' ') },
      { label: 'Period', w: 0.20, get: (r) => `${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}` },
      { label: 'Authorized', w: 0.10, key: 'authorizedUnits' }, { label: 'Used', w: 0.08, key: 'usedUnits' },
      { label: 'Remaining', w: 0.10, key: 'remainingUnits' }, { label: 'Status', w: 0.10, key: 'status' },
    ], data.authorizations)
  }

  if (data.invoices) {
    const isReleased = (i: any) => i.released === true || i.released === 't'
    const total = data.invoices.filter(isReleased).reduce((s: number, i: any) => s + (parseFloat(i.total) || 0), 0)
    const drafts = data.invoices.filter((i: any) => !isReleased(i)).length
    sectionHeader(`Invoices in Period (${data.invoices.length} • ${fmtMoney(total)} billed${drafts ? ` • ${drafts} draft${drafts === 1 ? '' : 's'} not counted` : ''})`)
    if (data.invoices.length === 0) emptyNote('No invoices in this period.')
    else renderTable([
      { label: 'Invoice #', w: 0.18, key: 'invoiceNumber' },
      { label: 'Period', w: 0.26, get: (r) => `${fmtDate(r.billingPeriodStart)} – ${fmtDate(r.billingPeriodEnd)}` },
      { label: 'Total', w: 0.14, get: (r) => fmtMoney(r.total) }, { label: 'Status', w: 0.14, get: (r) => (isReleased(r) ? r.paymentStatus : 'draft') },
      { label: 'Due', w: 0.14, get: (r) => fmtDate(r.paymentDueDate) }, { label: 'Paid', w: 0.14, get: (r) => fmtDate(r.paymentDate) },
    ], data.invoices)
  }

  if (data.auditLog) {
    sectionHeader(`Access / Change Audit Trail (${data.auditLog.length})`)
    if (data.auditLog.length === 0) emptyNote('No audit events in this period.')
    else renderTable([
      { label: 'When', w: 0.26, get: (r) => fmtDateTime(r.timestamp) }, { label: 'User', w: 0.26, key: 'userName' },
      { label: 'Action', w: 0.26, key: 'action' }, { label: 'Table', w: 0.14, key: 'tableName' },
      { label: 'IP', w: 0.08, key: 'ipAddress' },
    ], data.auditLog)
  }

  // Footer — page numbers
  const range = doc.bufferedPageRange()
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i)
    doc.fontSize(8).fillColor(MUTED).font('Helvetica').text(
      `${agency} • Confidential Client Record • Page ${i + 1} of ${range.count}`,
      50, doc.page.height - 40, { width: 512, align: 'center', lineBreak: false },
    )
  }
}

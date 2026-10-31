// The salon's own reports (salon gap #11; hidden feature `salon_reports`; docs/parity/salon-reports.md):
//   GET /retention  who came, who came back, how often, who has slipped away, and whether first-timers returned
//   GET /rebook     the rebook rate of each stylist: of the visits they did, how many left with a next appointment
//   GET /retail     retail sold on paid sales, by item and by stylist
//   GET /tips       tips taken on sales, by the stylist of the visit (card reader, or typed in with a payment)
// All three take ?from=YYYY-MM-DD&to=YYYY-MM-DD in the salon's own calendar (default: the last 90 days) and ask reports:read.
// What each figure means is written on the report, in words; a window too big to read is said, never quietly cut.
import { Hono } from 'hono'
import { createTipShares } from './tipShares.ts'
import { splitCents } from './tipSplit.ts'
import { clientsWithFutureBooking, peopleNames, REPORT_VISIT_CAP, retailSold, tipsBySale, visitorsBetween, visitsForReport, visitSpans } from '../../data/salon.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { calendarDateIn, createSalonClock, salonDayStart, shiftDays } from './days.ts'
import { retentionOf } from './retention.ts'
import { company } from '../../db/schema/index.ts'
import { eq } from 'drizzle-orm'

const DAY = 86400_000
const MAX_DAYS = 731
const pct = (n: number, of: number): number | null => (of > 0 ? Math.round((n / of) * 1000) / 10 : null)
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const realDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) && shiftDays(s, 0) === s

export class ReportError extends Error { constructor(message: string, public field: 'from' | 'to') { super(message) } }

export function createSalonReports(d: CrmDeps) {
  const { db } = d
  const clock = createSalonClock(db)

  /** The window as the salon's own days: from the start of `from` to the start of the day after `to`. */
  async function windowOf(companyId: string, q: { from?: string; to?: string }) {
    const tz = await clock.salonTimezone(companyId)
    const today = calendarDateIn(new Date(), tz)
    const to = q.to || today
    const from = q.from || shiftDays(to, -89)
    if (!realDay(to)) throw new ReportError('Choose a real end date.', 'to')
    if (!realDay(from)) throw new ReportError('Choose a real start date.', 'from')
    if (from > to) throw new ReportError('The start date is after the end date.', 'from')
    const days = Math.round((salonDayStart(shiftDays(to, 1), tz).getTime() - salonDayStart(from, tz).getTime()) / DAY)
    if (days > MAX_DAYS) throw new ReportError('Choose two years or less.', 'from')
    return { tz, from, to, days, start: salonDayStart(from, tz), end: salonDayStart(shiftDays(to, 1), tz) }
  }

  async function retention(companyId: string, q: { from?: string; to?: string }) {
    const w = await windowOf(companyId, q)
    const now = new Date()
    const priorStart = new Date(w.start.getTime() - (w.end.getTime() - w.start.getTime()))
    const [visits, prior, spans, future, [co]] = await Promise.all([
      visitsForReport(db, companyId, w.start, w.end), visitorsBetween(db, companyId, priorStart, w.start), visitSpans(db, companyId),
      clientsWithFutureBooking(db, companyId, now), db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1),
    ])
    const truncated = visits.length > REPORT_VISIT_CAP
    const rows = truncated ? visits.slice(0, REPORT_VISIT_CAP) : visits

    const perClient = new Map<string, Date[]>()
    for (const v of rows) { const l = perClient.get(v.contactId); if (l) l.push(v.performedAt); else perClient.set(v.contactId, [v.performedAt]) }
    const span = new Map(spans.map((s) => [s.contactId, s]))
    const active = [...perClient.keys()]
    const isNew = (id: string) => { const s = span.get(id); return !!s && s.first >= w.start && s.first < w.end }

    const frequency = { once: 0, twice: 0, threeToFour: 0, fivePlus: 0 }
    let gapSum = 0, gaps = 0
    for (const dates of perClient.values()) {
      const n = dates.length
      if (n === 1) frequency.once++; else if (n === 2) frequency.twice++; else if (n <= 4) frequency.threeToFour++; else frequency.fivePlus++
      for (let i = 1; i < n; i++) { gapSum += (dates[i].getTime() - dates[i - 1].getTime()) / DAY; gaps++ }
    }
    const retained = [...prior].filter((id) => perClient.has(id)).length
    const bookedAgain = active.filter((id) => future.has(id)).length
    const newClients = active.filter(isNew)
    const cameBack = newClients.filter((id) => (span.get(id)?.n ?? 0) >= 2 || future.has(id)).length
    const lapseDays = retentionOf(co?.settings).winBackDays
    const lapseCut = new Date(now.getTime() - lapseDays * DAY)
    const lapsed = spans.filter((s) => s.last < lapseCut && !future.has(s.contactId)).length

    return {
      range: { from: w.from, to: w.to, days: w.days }, truncated,
      visits: rows.length, activeClients: active.length, newClients: newClients.length, returningClients: active.length - newClients.length,
      visitsPerClient: active.length ? round2(rows.length / active.length) : null,
      frequency,
      averageDaysBetweenVisits: gaps ? Math.round(gapSum / gaps) : null,
      retention: { priorClients: prior.size, retained, ratePercent: pct(retained, prior.size) },
      // Timely's measure: of the clients who came in, how many hold an appointment from now on.
      bookedAgain: { count: bookedAgain, ratePercent: pct(bookedAgain, active.length) },
      firstTimers: { count: newClients.length, cameBack, ratePercent: pct(cameBack, newClients.length) },
      lapsed: { days: lapseDays, count: lapsed },
    }
  }

  const whoIs = (r: { stylistId: string | null; stylistMemberId: string | null; firstName: string | null; lastName: string | null; memberName: string | null }) => {
    const id = r.stylistId || r.stylistMemberId
    const name = [r.firstName, r.lastName].filter(Boolean).join(' ').trim() || String(r.memberName || '').trim()
    return { key: id ? `${r.stylistId ? 'u' : 'm'}:${id}` : 'none', id: id || null, name: name || 'No stylist recorded' }
  }

  async function rebook(companyId: string, q: { from?: string; to?: string }) {
    const w = await windowOf(companyId, q)
    const visits = await visitsForReport(db, companyId, w.start, w.end)
    const truncated = visits.length > REPORT_VISIT_CAP
    const rows = truncated ? visits.slice(0, REPORT_VISIT_CAP) : visits
    const by = new Map<string, { id: string | null; name: string; visits: number; rebooked: number }>()
    for (const v of rows) {
      const p = whoIs(v)
      const e = by.get(p.key) || { id: p.id, name: p.name, visits: 0, rebooked: 0 }
      e.visits++; if (v.rebooked) e.rebooked++
      by.set(p.key, e)
    }
    const stylists = [...by.values()].map((e) => ({ ...e, ratePercent: pct(e.rebooked, e.visits) }))
      .sort((a, b) => (b.ratePercent ?? -1) - (a.ratePercent ?? -1) || b.visits - a.visits || a.name.localeCompare(b.name))
    const rebooked = rows.filter((v) => v.rebooked).length
    return { range: { from: w.from, to: w.to, days: w.days }, truncated, total: { visits: rows.length, rebooked, ratePercent: pct(rebooked, rows.length) }, stylists }
  }

  async function retail(companyId: string, q: { from?: string; to?: string }) {
    const w = await windowOf(companyId, q)
    const rows = await retailSold(db, companyId, w.start, w.end)
    const items = new Map<string, { name: string; units: number; total: number }>()
    const people = new Map<string, { name: string; units: number; total: number }>()
    let units = 0, total = 0
    for (const r of rows) {
      const u = Number(r.qty) || 0, t = Number(r.total) || 0
      units += u; total += t
      const it = items.get(r.description) || { name: r.description, units: 0, total: 0 }; it.units += u; it.total += t; items.set(r.description, it)
      const p = whoIs(r); const pe = people.get(p.key) || { name: p.name, units: 0, total: 0 }; pe.units += u; pe.total += t; people.set(p.key, pe)
    }
    const fin = (m: Map<string, { name: string; units: number; total: number }>) => [...m.values()].map((e) => ({ ...e, total: round2(e.total) })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    return { range: { from: w.from, to: w.to, days: w.days }, total: round2(total), units, byItem: fin(items), byStylist: fin(people) }
  }

  /**
   * Tips taken in the window, net of tips given back, each SALE's tip split across the people on it (crm/salon/tipShares.ts): the shares the salon
   * set on that sale, else the value of each person's services on the visit. A sale with no visit is "No stylist recorded".
   */
  async function tips(companyId: string, q: { from?: string; to?: string }) {
    const w = await windowOf(companyId, q)
    const sales = await tipsBySale(db, companyId, w.start, w.end)
    const shares = createTipShares(db)
    const weights = await shares.weightsFor(companyId, sales)
    const userIds = new Set<string>(), memberIds = new Set<string>()
    const by = new Map<string, { key: string; tips: number; payments: number }>()
    let totalCents = 0, payments = 0
    for (const sale of sales) {
      const net = Math.round(Number(sale.tips) * 100) || 0
      const n = Number(sale.payments) || 0
      totalCents += net; payments += n
      for (const part of splitCents(net, weights.get(sale.invoiceId)!.weights)) {
        if (part.key.startsWith('u:')) userIds.add(part.key.slice(2)); else if (part.key.startsWith('m:')) memberIds.add(part.key.slice(2))
        const e = by.get(part.key) || { key: part.key, tips: 0, payments: 0 }
        e.tips += part.cents; if (n > 0 && (part.cents !== 0 || weights.get(sale.invoiceId)!.weights.length === 1)) e.payments += n
        by.set(part.key, e)
      }
    }
    const names = await peopleNames(db, [...userIds], [...memberIds])
    const stylists = [...by.values()].filter((e) => e.tips !== 0 || e.payments > 0).map((e) => ({
      id: e.key === 'none' ? null : e.key.slice(2), name: names.get(e.key) ?? 'No stylist recorded', tips: round2(e.tips / 100), payments: e.payments,
    })).sort((a, b) => b.tips - a.tips || a.name.localeCompare(b.name))
    return { range: { from: w.from, to: w.to, days: w.days }, total: round2(totalCents / 100), payments, stylists }
  }

  return { retention, rebook, retail, tips }
}
export type SalonReports = ReturnType<typeof createSalonReports>

/** /api/salon-reports (behind `salon_reports`). */
export function createSalonReportRoutes(d: CrmDeps, reports: SalonReports) {
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const answer = (name: 'retention' | 'rebook' | 'retail' | 'tips') => async (c: any) => {
    const u = c.get('user') as any
    c.header('Cache-Control', 'no-store')
    try {
      return one(c, await reports[name](u.companyId, { from: c.req.query('from') || undefined, to: c.req.query('to') || undefined }))
    } catch (e: any) {
      if (e instanceof ReportError) return fail(c, 400, e.message, 'BAD_RANGE', { [e.field]: e.message })
      d.logger.error('[salon-reports]', { error: e?.message || String(e) })
      return fail(c, 500, 'That report could not be made. Try again.')
    }
  }
  app.get('/retention', requirePermission('reports:read'), answer('retention'))
  app.get('/rebook', requirePermission('reports:read'), answer('rebook'))
  app.get('/retail', requirePermission('reports:read'), answer('retail'))
  app.get('/tips', requirePermission('reports:read'), answer('tips'))
  return app
}

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
import { clientsWithFutureBooking, peopleNames, REPORT_VISIT_CAP, retailSold, tipsBySale, visitorsBetween, visitsForReport, visitsWithNext, visitSpans } from '../../data/salon.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { calendarDateIn, createSalonClock, salonDayStart, shiftDays } from './days.ts'
import { retentionOf } from './retention.ts'
import { company, serviceMenu } from '../../db/schema/index.ts'
import { createCommissionReports, CommissionReportError } from './commissionReports.ts'
import { anchors, parseWindows, ratesFor, readWindows, WINDOWS_KEY } from './returnWindows.ts'
import { and, eq } from 'drizzle-orm'

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

  /** The windows to report on: ?windows= for one look, else the salon's saved ones. */
  async function windowsFor(companyId: string, asked?: string): Promise<number[]> {
    if (asked) {
      const p = parseWindows(asked)
      if ('problem' in p) throw new ReportError(p.problem, 'from')
      return p.windows
    }
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    return readWindows(co?.settings)
  }

  /** Save the salon's own windows (the owner's pick); returns what was saved. */
  async function saveWindows(companyId: string, raw: unknown): Promise<{ windows: number[] } | { problem: string }> {
    const p = parseWindows(raw)
    if ('problem' in p) return p
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    await db.update(company).set({ settings: { ...((co?.settings as any) || {}), [WINDOWS_KEY]: p.windows }, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    return p
  }

  /**
   * Client retention over several return windows, and the same for each stylist's clients (the stylist of the anchor visit): of the clients who
   * had a visit in the period, the share back within each window. `serviceId` slices both to clients whose first visit in the period was that service.
   */
  async function returnWindows(companyId: string, q: { from?: string; to?: string; windows?: string; serviceId?: string }) {
    const w = await windowOf(companyId, q)
    const windows = await windowsFor(companyId, q.windows)
    let service: { id: string; name: string } | null = null
    if (q.serviceId) {
      const [s] = await db.select({ id: serviceMenu.id, name: serviceMenu.name }).from(serviceMenu).where(and(eq(serviceMenu.id, q.serviceId), eq(serviceMenu.companyId, companyId))).limit(1)
      if (!s) throw new ReportError('That service is not on your menu.', 'from')
      service = s
    }
    const all = await visitsWithNext(db, companyId, w.start, w.end)
    const truncated = all.length > REPORT_VISIT_CAP
    const rows = (truncated ? all.slice(0, REPORT_VISIT_CAP) : all).filter((v) => !service || v.serviceId === service.id)
    const first = anchors(rows)
    const now = new Date()
    const by = new Map<string, { id: string | null; name: string; list: typeof first }>()
    for (const v of first) {
      const p = whoIs(v)
      const e = by.get(p.key) || { id: p.id, name: p.name, list: [] }
      e.list.push(v); by.set(p.key, e)
    }
    const stylists = [...by.values()].map((e) => ({ id: e.id, name: e.name, clients: e.list.length, windows: ratesFor(e.list, windows, now) }))
      .sort((a, b) => b.clients - a.clients || a.name.localeCompare(b.name))
    return {
      range: { from: w.from, to: w.to, days: w.days }, truncated, windowDays: windows, service,
      clients: first.length, windows: ratesFor(first, windows, now), stylists,
    }
  }

  return { retention, rebook, retail, tips, returnWindows, saveWindows, windowsFor }
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
  // Retention over several return windows, and per stylist (row 14): ?windows=30,60,90&serviceId=...
  app.get('/return-windows', requirePermission('reports:read'), async (c: any) => {
    const u = c.get('user') as any
    c.header('Cache-Control', 'no-store')
    try {
      return one(c, await reports.returnWindows(u.companyId, { from: c.req.query('from') || undefined, to: c.req.query('to') || undefined, windows: c.req.query('windows') || undefined, serviceId: c.req.query('serviceId') || undefined }))
    } catch (e: any) {
      if (e instanceof ReportError) return fail(c, 400, e.message, 'BAD_RANGE', { [e.field]: e.message })
      d.logger.error('[salon-reports]', { error: e?.message || String(e) })
      return fail(c, 500, 'That report could not be made. Try again.')
    }
  })
  // The owner's own windows, kept for the salon. Whoever changes the company settings.
  app.put('/return-windows', requirePermission('company:update'), async (c: any) => {
    const u = c.get('user') as any
    const body = ((await c.req.json().catch(() => null)) ?? {}) as { windows?: unknown }
    const saved = await reports.saveWindows(u.companyId, body.windows)
    if ('problem' in saved) return fail(c, 400, saved.problem, 'BAD_WINDOWS', { windows: saved.problem })
    return one(c, saved)
  })

  // ── Commission summary, line items and the payroll file (row 16; ./commissionReports.ts) ──────────────────────────────────────────────
  // Behind `salon_reports` (the mount) AND `salon_commissions` (the commissions themselves), and the commission ledger's own rights.
  const money = createCommissionReports(d)
  const commissionsOn = (fn: (u: any, c: any) => Promise<Response>) => async (c: any) => {
    const u = c.get('user') as any
    if (!(await d.features.isFeatureEnabled(u.companyId, 'salon_commissions'))) return fail(c, 404, 'Not found')
    c.header('Cache-Control', 'no-store')
    try { return await fn(u, c) } catch (e: any) {
      if (e instanceof CommissionReportError) return fail(c, e.status, e.message, e.status === 409 ? 'TOO_MANY' : 'BAD_RANGE', { [e.field]: e.message })
      d.logger.error('[salon-commission-reports]', { error: e?.message || String(e) })
      return fail(c, 500, 'That report could not be made. Try again.')
    }
  }
  const range = (c: any) => ({ from: c.req.query('from') || undefined, to: c.req.query('to') || undefined })
  app.get('/commissions/summary', requirePermission('commissions:read'), commissionsOn(async (u, c) => one(c, await money.summary(u.companyId, range(c)))))
  app.get('/commissions/lines', requirePermission('commissions:read'), commissionsOn(async (u, c) => {
    const r = await money.lineItems(u.companyId, { ...range(c), userId: c.req.query('userId') || undefined })
    return one(c, r)
  }))
  // The payroll file: a download, and a record of who took it. Only whoever approves payouts.
  app.get('/commissions/payroll.csv', requirePermission('commissions:update'), commissionsOn(async (u, c) => {
    const f = await money.payroll(u.companyId, { ...range(c), format: c.req.query('format') || undefined, statuses: c.req.query('statuses') || undefined, coCode: c.req.query('coCode') || undefined, earningCode: c.req.query('earningCode') || undefined })
    d.audit.log({ req: c, action: d.audit.ACTIONS.EXPORT, entity: 'commission-payroll', entityName: `${f.people} people, ${f.range.from} to ${f.range.to}`, metadata: { ...f.range, people: f.people, total: f.total }, userId: u.userId, companyId: u.companyId })
    return c.body(f.csv, 200, { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${f.filename}"`, 'X-Payroll-People': String(f.people), 'X-Payroll-Total': String(f.total), 'X-Payroll-Warnings': encodeURIComponent(f.warnings.join(' | ')) })
  }))
  app.get('/commissions/file-numbers', requirePermission('commissions:update'), commissionsOn(async (u, c) => one(c, { fileNumbers: await money.fileNumbers(u.companyId) })))
  app.put('/commissions/file-numbers', requirePermission('commissions:update'), commissionsOn(async (u, c) => {
    const body = ((await c.req.json().catch(() => null)) ?? {}) as { fileNumbers?: unknown }
    const r = await money.saveFileNumbers(u.companyId, body.fileNumbers)
    if ('problem' in r) return fail(c, 400, r.problem, 'BAD_FILE_NUMBER', { fileNumbers: r.problem })
    return one(c, { fileNumbers: r.saved })
  }))
  return app
}

// Lead-source and year-on-year event reports (restaurant-bar-depth #7; Tripleseat reports by source, Perfect Venue
// year-over-year), with the money behind them and a schedule (restaurant-bar parity #6). Read-only reports behind the 'event_reports'
// feature (not ready), reports:read; the money in them is invoices:read, so a seat without it gets the counts and not the values.
//
//   GET /api/event-reports/sources?from=&to=   enquiries that came in over the period, by source: how many became bookings,
//                                              how many were lost, the conversion, and the value of what was booked — and, with
//                                              'event_marketing_spend' on and the right to read money, what was spent on each
//                                              source over those days, the cost per enquiry and per booked event, and the value
//                                              booked for every dollar spent
//   GET /api/event-reports/years?year=2026     value booked each month of the year beside the year before, and the counts
//
// Behind their own not-ready features, each gated on both sides:
//   /api/event-spend               'event_marketing_spend'    marketing spend per source per month (read invoices:read, write invoices:update)
//   /api/event-report-schedules    'event_report_schedules'   a report emailed weekly or monthly to chosen seats (read reports:read,
//                                                             write settings:update — it sends mail); runScheduledReports is the timer's pass
import { Hono } from 'hono'
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { round2, companyTimeZone, storeDateString, money as dollars } from '@twomiah/tenant-backend'
import { event, invoice, eventMarketingSpend, eventReportSchedule, user, company, reminderLog } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, done, listAll } from '../../http/reply.ts'
import { shopClock } from '../lowStockDigest.ts'
import { isCalendarDate, eventDayWords } from './eventBooking.ts'
import { dayBefore } from './eventGuarantee.ts'
import { EVENT_SOURCES, sourceId, sourceRefusal, spendShare, MONTH_RE } from './eventSources.ts'

const BOOKED = ['confirmed', 'completed']
const cents = (n: number) => Math.round(n * 100)
const pct = (num: number, den: number) => (den ? Math.round((num / den) * 1000) / 10 : 0)
const centsWords = (c: number) => dollars(c / 100)

/** What an event is worth: its invoice if it has a live one, else its quoted total. */
const worth = (ev: any, inv: any) => round2(Number(inv && inv.status !== 'void' ? inv.total : ev.quotedTotal) || 0)

export interface SourceReportRow {
  source: string; label: string; enquiries: number; booked: number; lost: number; open: number; conversion: number
  bookedValue?: number
  /** With spend on: whole cents, the cost per enquiry and per booked event (null when there are none to divide by), and the value booked per dollar spent (null when nothing was spent). */
  spendCents?: number; costPerEnquiryCents?: number | null; costPerBookingCents?: number | null; returnOnSpend?: number | null
}
export interface SourceReport { from: string; to: string; sources: SourceReportRow[]; totals: Omit<SourceReportRow, 'source' | 'label' | 'open'> }

const labelOf = (id: string) => (id === 'none' ? 'No source given' : EVENT_SOURCES.find((s) => s.id === id)!.label)

/** The lead-source report for a company over from..to (venue days). `money`: the reader may see values; `spend`: spend is switched on too. */
export async function buildSourceReport(db: any, companyId: string, from: string, to: string, opts: { money: boolean; spend: boolean }): Promise<SourceReport> {
  const tz = await companyTimeZone(db, companyId)
  // Enquiries that came in on those days on the venue's clock (a day either side is read, then trimmed to the clock).
  const lo = new Date(Date.parse(from + 'T00:00:00Z') - 86400000), hi = new Date(Date.parse(to + 'T00:00:00Z') + 2 * 86400000)
  const rows = await db.select({ ev: event, inv: invoice }).from(event).leftJoin(invoice, eq(invoice.eventId, event.id))
    .where(and(eq(event.companyId, companyId), gte(event.createdAt, lo), lte(event.createdAt, hi)))
  const by = new Map<string, { enquiries: number; booked: number; lost: number; value: number }>()
  for (const s of EVENT_SOURCES) by.set(s.id, { enquiries: 0, booked: 0, lost: 0, value: 0 })
  by.set('none', { enquiries: 0, booked: 0, lost: 0, value: 0 })
  for (const { ev, inv } of rows) {
    const day = storeDateString(new Date(ev.createdAt), tz)
    if (day < from || day > to) continue
    const row = by.get(sourceId(ev.source) ?? 'none')!
    row.enquiries++
    if (ev.status === 'lost') row.lost++
    if (BOOKED.includes(ev.status) || (ev.bookedAt && ev.status !== 'cancelled' && ev.status !== 'lost')) { row.booked++; row.value += worth(ev, inv) }
  }
  const withSpend = opts.money && opts.spend
  const spent = new Map<string, number>()
  if (withSpend) {
    const spendRows = await db.select().from(eventMarketingSpend).where(and(eq(eventMarketingSpend.companyId, companyId), gte(eventMarketingSpend.month, from.slice(0, 7)), lte(eventMarketingSpend.month, to.slice(0, 7))))
    const grouped = new Map<string, Array<{ month: string; amountCents: number }>>()
    for (const r of spendRows) grouped.set(r.source, [...(grouped.get(r.source) || []), { month: r.month, amountCents: r.amountCents }])
    for (const [source, list] of grouped) spent.set(source, spendShare(list, from, to))
  }
  const money = (value: number, spendCents: number, enquiries: number, booked: number) => ({
    bookedValue: round2(value),
    ...(withSpend ? {
      spendCents,
      costPerEnquiryCents: enquiries && spendCents ? Math.round(spendCents / enquiries) : null,
      costPerBookingCents: booked && spendCents ? Math.round(spendCents / booked) : null,
      returnOnSpend: spendCents ? Math.round((cents(value) / spendCents) * 100) / 100 : null,
    } : {}),
  })
  const sources: SourceReportRow[] = [...by.entries()].map(([id, v]) => ({ id, v, spendCents: spent.get(id) || 0 }))
    .filter(({ v, spendCents }) => v.enquiries > 0 || spendCents > 0)
    .map(({ id, v, spendCents }) => ({
      source: id, label: labelOf(id), enquiries: v.enquiries, booked: v.booked, lost: v.lost, open: v.enquiries - v.booked - v.lost,
      conversion: pct(v.booked, v.enquiries), ...(opts.money ? money(v.value, spendCents, v.enquiries, v.booked) : {}),
    })).sort((a, b) => b.enquiries - a.enquiries || (b.spendCents || 0) - (a.spendCents || 0))
  const sum = (k: 'enquiries' | 'booked' | 'lost') => sources.reduce((s, r) => s + r[k], 0)
  const totalValue = sources.reduce((s, r) => s + (r.bookedValue || 0), 0)
  const totalSpend = sources.reduce((s, r) => s + (r.spendCents || 0), 0)
  return {
    from, to, sources,
    totals: { enquiries: sum('enquiries'), booked: sum('booked'), lost: sum('lost'), conversion: pct(sum('booked'), sum('enquiries')), ...(opts.money ? money(totalValue, totalSpend, sum('enquiries'), sum('booked')) : {}) },
  }
}

export interface YearReport { year: number; months: Array<{ month: number; booked: number; lastYearBooked: number; value?: number; lastYearValue?: number }>; totals: { booked: number; lastYearBooked: number; value?: number; lastYearValue?: number } }

/** Value booked each month of `year` beside the year before. */
export async function buildYearReport(db: any, companyId: string, year: number, opts: { money: boolean }): Promise<YearReport> {
  const tz = await companyTimeZone(db, companyId)
  const lo = new Date(Date.UTC(year - 1, 0, 1) - 86400000), hi = new Date(Date.UTC(year + 1, 0, 1) + 86400000)
  const rows = await db.select({ ev: event, inv: invoice }).from(event).leftJoin(invoice, eq(invoice.eventId, event.id))
    .where(and(eq(event.companyId, companyId), gte(event.bookedAt, lo), lte(event.bookedAt, hi)))
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, booked: 0, lastYearBooked: 0, value: 0, lastYearValue: 0 }))
  for (const { ev, inv } of rows) {
    if (!ev.bookedAt || ['cancelled', 'lost'].includes(ev.status)) continue
    const day = storeDateString(new Date(ev.bookedAt), tz)
    const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7)) - 1
    if (y === year) { months[m].booked++; months[m].value += worth(ev, inv) }
    else if (y === year - 1) { months[m].lastYearBooked++; months[m].lastYearValue += worth(ev, inv) }
  }
  const out = months.map((m) => ({ month: m.month, booked: m.booked, lastYearBooked: m.lastYearBooked, ...(opts.money ? { value: round2(m.value), lastYearValue: round2(m.lastYearValue) } : {}) }))
  const total = (k: string) => round2(out.reduce((s, m: any) => s + (m[k] || 0), 0))
  return { year, months: out, totals: { booked: total('booked'), lastYearBooked: total('lastYearBooked'), ...(opts.money ? { value: total('value'), lastYearValue: total('lastYearValue') } : {}) } }
}

export function createEventReportRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission, hasPermission, getExtraPermissions } = d.permissions
  const app = new Hono<AppEnv>()
  const seesMoney = async (u: any) => hasPermission(u?.role, 'invoices:read', await getExtraPermissions(u?.userId))

  app.get('/sources', requirePermission('reports:read'), async (c) => {
    const u = c.get('user') as any
    const from = c.req.query('from') || '', to = c.req.query('to') || ''
    if (!isCalendarDate(from) || !isCalendarDate(to) || to < from) return fail(c, 400, 'from and to are required as YYYY-MM-DD, from first')
    return one(c, await buildSourceReport(db, u.companyId, from, to, { money: await seesMoney(u), spend: await d.features.isFeatureEnabled(u.companyId, 'event_marketing_spend') }))
  })

  app.get('/years', requirePermission('reports:read'), async (c) => {
    const u = c.get('user') as any
    const tz = await companyTimeZone(db, u.companyId)
    const year = Number(c.req.query('year') || storeDateString(new Date(), tz).slice(0, 4))
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return fail(c, 400, 'year must be a four-digit year')
    return one(c, await buildYearReport(db, u.companyId, year, { money: await seesMoney(u) }))
  })

  return app
}

// ── Marketing spend ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const MAX_SPEND_CENTS = 100_000_000 // $1,000,000 in a month on one source is a typing slip, not a budget

export function createEventSpendRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const view = (r: any) => ({ id: r.id, source: r.source, sourceLabel: labelOf(r.source), month: r.month, amountCents: r.amountCents, note: r.note })

  // GET /?from=YYYY-MM&to=YYYY-MM — a price, so invoices:read like every other figure in the event book.
  app.get('/', requirePermission('invoices:read'), async (c) => {
    const u = c.get('user') as any
    const from = c.req.query('from') || '', to = c.req.query('to') || from
    if (!MONTH_RE.test(from) || !MONTH_RE.test(to) || to < from) return fail(c, 400, 'from and to are required as YYYY-MM, from first')
    const rows = await db.select().from(eventMarketingSpend)
      .where(and(eq(eventMarketingSpend.companyId, u.companyId), gte(eventMarketingSpend.month, from), lte(eventMarketingSpend.month, to))).orderBy(asc(eventMarketingSpend.month), asc(eventMarketingSpend.source))
    return listAll(c, rows.map(view))
  })

  // PUT / { source, month, amountCents, note? } — one source's spend for one month; entering it again changes it, 0 takes it away.
  app.put('/', requirePermission('invoices:update'), async (c) => {
    const u = c.get('user') as any
    const b = (await c.req.json().catch(() => null)) ?? ({} as any)
    if (typeof b.source !== 'string' || !b.source) return fail(c, 400, 'Choose the lead source the money was spent on.')
    const bad = sourceRefusal(b.source)
    if (bad) return fail(c, 400, bad)
    if (typeof b.month !== 'string' || !MONTH_RE.test(b.month)) return fail(c, 400, 'month is required as YYYY-MM.')
    if (!Number.isInteger(b.amountCents) || b.amountCents < 0 || b.amountCents > MAX_SPEND_CENTS) return fail(c, 400, 'The amount is a whole number of cents from 0 to 1,000,000 dollars.')
    const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 300) : null
    const [existing] = await db.select().from(eventMarketingSpend).where(and(eq(eventMarketingSpend.companyId, u.companyId), eq(eventMarketingSpend.source, b.source), eq(eventMarketingSpend.month, b.month))).limit(1)
    const name = `${labelOf(b.source)} spend, ${b.month}`
    if (b.amountCents === 0) {
      if (existing) {
        await db.delete(eventMarketingSpend).where(eq(eventMarketingSpend.id, existing.id))
        await audit.log({ action: 'delete', entity: 'event_marketing_spend', entityId: existing.id, entityName: name, metadata: existing, req: { user: u } })
      }
      return done(c)
    }
    if (existing) {
      const [row] = await db.update(eventMarketingSpend).set({ amountCents: b.amountCents, note, updatedBy: u.userId, updatedAt: new Date() }).where(eq(eventMarketingSpend.id, existing.id)).returning()
      await audit.log({ action: 'update', entity: 'event_marketing_spend', entityId: row.id, entityName: name, changes: audit.diff(existing, row), req: { user: u } })
      return one(c, view(row))
    }
    const [row] = await db.insert(eventMarketingSpend).values({ id: createId(), source: b.source, month: b.month, amountCents: b.amountCents, note, updatedBy: u.userId, companyId: u.companyId }).returning()
    await audit.log({ action: 'create', entity: 'event_marketing_spend', entityId: row.id, entityName: name, metadata: row, req: { user: u } })
    return one(c, view(row), 201)
  })

  return app
}

// ── Reports emailed on a schedule ────────────────────────────────────────────────────────────────────────────────────────────
export const REPORTS = [
  { id: 'sources', label: 'Where enquiries come from' },
  { id: 'years', label: 'Events booked each month, against last year' },
] as const
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`
const reportLabel = (id: string) => REPORTS.find((r) => r.id === id)?.label || 'Report'
const whenWords = (s: { frequency: string; weekday: number | null; monthDay: number | null }) => (s.frequency === 'weekly' ? `Every ${WEEKDAYS[s.weekday ?? 0]}` : `On the ${ordinal(s.monthDay ?? 1)} of each month`)
/** The hour of the venue's day a scheduled report may first go. */
export const REPORT_HOUR = 8
const MAX_RECIPIENTS = 20
const KIND = 'event_report_schedule'

const dowOf = (date: string) => new Date(date + 'T12:00:00Z').getUTCDay()
/** The latest day on or before `today` the schedule falls on. */
export function dueDayOf(s: { frequency: string; weekday: number | null; monthDay: number | null }, today: string): string {
  if (s.frequency === 'weekly') return dayBefore(today, (dowOf(today) - (s.weekday ?? 0) + 7) % 7)
  const dom = Number(today.slice(8, 10)), want = s.monthDay ?? 1
  if (dom >= want) return `${today.slice(0, 8)}${String(want).padStart(2, '0')}`
  const prev = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1))
  return `${prev.toISOString().slice(0, 8)}${String(want).padStart(2, '0')}`
}
/** The days a report sent on `due` covers: the seven before it (weekly) or the whole month before it (monthly). */
export function periodOf(frequency: string, due: string): { from: string; to: string } {
  if (frequency === 'weekly') return { from: dayBefore(due, 7), to: dayBefore(due, 1) }
  const first = new Date(Date.UTC(Number(due.slice(0, 4)), Number(due.slice(5, 7)) - 2, 1))
  const last = new Date(Date.UTC(Number(due.slice(0, 4)), Number(due.slice(5, 7)) - 1, 0))
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) }
}

interface Seat { id: string; name: string; email: string; role: string; extra: string[] }

export interface ReportEmail { subject: string; headline: string; intro: string; head: string[]; rows: string[][] }

/** One report as the email table, for a reader who may or may not see money. */
export async function reportEmail(d: CrmDeps, companyId: string, schedule: { report: string; frequency: string }, due: string, readerMoney: boolean): Promise<ReportEmail> {
  const spendOn = await d.features.isFeatureEnabled(companyId, 'event_marketing_spend')
  if (schedule.report === 'years') {
    const year = Number(due.slice(0, 4))
    const rep = await buildYearReport(d.db, companyId, year, { money: readerMoney })
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    return {
      subject: `${schedule.frequency === 'weekly' ? 'Weekly' : 'Monthly'} report: events booked each month, ${year}`,
      headline: `Events booked each month in ${year}, against ${year - 1}`, intro: `${rep.totals.booked} booked this year so far, ${rep.totals.lastYearBooked} last year${readerMoney ? ` (${dollars(rep.totals.value ?? 0)} against ${dollars(rep.totals.lastYearValue ?? 0)})` : ''}.`,
      head: ['Month', `Booked ${year}`, `Booked ${year - 1}`, ...(readerMoney ? [`Value ${year}`, `Value ${year - 1}`] : [])],
      rows: rep.months.map((m) => [MONTHS[m.month - 1], String(m.booked), String(m.lastYearBooked), ...(readerMoney ? [dollars(m.value ?? 0), dollars(m.lastYearValue ?? 0)] : [])]),
    }
  }
  const { from, to } = periodOf(schedule.frequency, due)
  const rep = await buildSourceReport(d.db, companyId, from, to, { money: readerMoney, spend: spendOn })
  const withSpend = readerMoney && spendOn
  const na = (v: number | null | undefined, f: (n: number) => string) => (v == null ? '—' : f(v))
  const line = (r: { label?: string; enquiries: number; booked: number; lost: number; conversion: number; bookedValue?: number; spendCents?: number; costPerEnquiryCents?: number | null; costPerBookingCents?: number | null; returnOnSpend?: number | null }, label: string) => [
    label, String(r.enquiries), String(r.booked), String(r.lost), `${r.conversion}%`,
    ...(readerMoney ? [dollars(r.bookedValue ?? 0)] : []),
    ...(withSpend ? [centsWords(r.spendCents ?? 0), na(r.costPerEnquiryCents, centsWords), na(r.costPerBookingCents, centsWords), na(r.returnOnSpend, (n) => `${dollars(n)} per $1`)] : []),
  ]
  const span = `${eventDayWords(from)} to ${eventDayWords(to)}`
  return {
    subject: `${schedule.frequency === 'weekly' ? 'Weekly' : 'Monthly'} report: where enquiries came from, ${shortSpan(from, to)}`,
    headline: 'Where enquiries came from', intro: `Enquiries that came in from ${span}, by where they came from.`,
    head: ['Source', 'Enquiries', 'Booked', 'Lost', 'Booked %', ...(readerMoney ? ['Booked value'] : []), ...(withSpend ? ['Spent', 'Per enquiry', 'Per booked event', 'Return'] : [])],
    rows: [...rep.sources.map((r) => line(r, r.label)), line(rep.totals, 'All')],
  }
}
const shortSpan = (from: string, to: string) => {
  const f = (x: string) => new Date(x + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return from.slice(0, 7) === to.slice(0, 7) && from.endsWith('-01') && Number(to.slice(8, 10)) >= 28 ? new Date(from + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : `${f(from)} – ${f(to)}`
}

/** The seats that can be sent a report: signed in people of this business who may read reports. */
async function eligibleSeats(d: CrmDeps, companyId: string, ids?: string[]): Promise<Seat[]> {
  const { hasPermission, getExtraPermissions } = d.permissions
  const rows = await d.db.select({ id: user.id, email: user.email, first: user.firstName, last: user.lastName, role: user.role, extra: user.extraPermissions, active: user.isActive }).from(user)
    .where(ids ? and(eq(user.companyId, companyId), inArray(user.id, ids)) : eq(user.companyId, companyId))
  const out: Seat[] = []
  for (const r of rows) {
    if (!r.active || !r.email) continue
    if (!hasPermission(r.role, 'reports:read', await getExtraPermissions(r.id))) continue
    out.push({ id: r.id, name: `${r.first} ${r.last}`.trim(), email: r.email, role: r.role, extra: (r.extra as string[]) || [] })
  }
  return out
}

/** Send one schedule's report for the day it was due to each recipient who may still read it. Returns how many emails went. */
async function sendScheduled(d: CrmDeps, co: { id: string; name: string }, s: any, due: string): Promise<number> {
  const { hasPermission, getExtraPermissions } = d.permissions
  const seats = await eligibleSeats(d, co.id, s.recipients as string[])
  let sent = 0
  for (const seat of seats) {
    const readerMoney = hasPermission(seat.role, 'invoices:read', await getExtraPermissions(seat.id))
    const r = await reportEmail(d, co.id, s, due, readerMoney)
    await d.services.emailService.send(seat.email, 'eventReport', { companyName: co.name, contactName: seat.name.split(' ')[0] || 'there', subject: r.subject, headline: r.headline, intro: r.intro, head: r.head, rows: r.rows, path: '/crm/event-insights', button: 'Open the report' })
    sent++
  }
  return sent
}

/**
 * The timer's pass: each active schedule whose day has come (from 8am on the venue's clock, or any later hour or day it was missed)
 * and has not been sent for that day is sent to its seats. The day is claimed first in reminder_log, so two passes at once — two
 * instances during a deploy — send one report, and a day with no email delivered is given back to try again. A schedule is first
 * sent on the first matching day AFTER it was made. Returns how many reports went out.
 */
export async function runScheduledReports(d: CrmDeps, now = new Date()): Promise<number> {
  let sent = 0
  const companies = await d.db.select({ id: company.id, name: company.name }).from(company)
  for (const co of companies) {
    if (!(await d.features.isFeatureEnabled(co.id, 'event_report_schedules')) || !(await d.features.isFeatureEnabled(co.id, 'event_reports'))) continue
    const tz = await companyTimeZone(d.db, co.id)
    const { day: today, hour } = shopClock(tz, now)
    const schedules = await d.db.select().from(eventReportSchedule).where(and(eq(eventReportSchedule.companyId, co.id), eq(eventReportSchedule.active, true)))
    for (const s of schedules) {
      const due = dueDayOf(s, today)
      if (due === today && hour < REPORT_HOUR) continue
      if (due <= storeDateString(new Date(s.createdAt), tz)) continue // made after (or on) its first day: that day is not sent
      const claimed = await d.db.insert(reminderLog).values({ companyId: co.id, kind: KIND, subjectId: s.id, step: due, status: 'sending' })
        .onConflictDoNothing({ target: [reminderLog.companyId, reminderLog.kind, reminderLog.subjectId, reminderLog.step] }).returning({ id: reminderLog.id })
      if (!claimed.length) continue
      try {
        const n = await sendScheduled(d, co, s, due)
        if (n === 0) { await d.db.delete(reminderLog).where(eq(reminderLog.id, claimed[0].id)); continue }
        await d.db.update(reminderLog).set({ status: 'sent', detail: `${n} email${n === 1 ? '' : 's'}`, updatedAt: new Date() }).where(eq(reminderLog.id, claimed[0].id))
        sent++
      } catch (err: any) {
        await d.db.delete(reminderLog).where(eq(reminderLog.id, claimed[0].id))
        d.logger.warn('[events] scheduled report not sent', { schedule: s.id, error: err?.message })
      }
    }
  }
  return sent
}

export function createEventReportScheduleRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  async function view(r: any, seats: Map<string, Seat>) {
    const [last] = await db.select({ step: reminderLog.step }).from(reminderLog)
      .where(and(eq(reminderLog.companyId, r.companyId), eq(reminderLog.kind, KIND), eq(reminderLog.subjectId, r.id), eq(reminderLog.status, 'sent'))).orderBy(desc(reminderLog.step)).limit(1)
    return {
      id: r.id, report: r.report, reportLabel: reportLabel(r.report), frequency: r.frequency, weekday: r.weekday, monthDay: r.monthDay, when: whenWords(r), active: r.active,
      recipients: (r.recipients as string[]).map((id) => ({ id, name: seats.get(id)?.name || 'Someone no longer able to read reports', email: seats.get(id)?.email || null, current: seats.has(id) })),
      lastSentFor: last?.step ?? null,
    }
  }

  app.get('/', requirePermission('reports:read'), async (c) => {
    const u = c.get('user') as any
    const rows = await db.select().from(eventReportSchedule).where(eq(eventReportSchedule.companyId, u.companyId)).orderBy(asc(eventReportSchedule.createdAt))
    const seats = new Map((await eligibleSeats(d, u.companyId)).map((s) => [s.id, s]))
    return listAll(c, await Promise.all(rows.map((r: any) => view(r, seats))))
  })

  // The seats a report can go to, and the reports there are to send.
  app.get('/options', requirePermission('settings:update'), async (c) => {
    const u = c.get('user') as any
    return one(c, {
      reports: REPORTS, weekdays: WEEKDAYS.map((label, id) => ({ id, label })),
      seats: (await eligibleSeats(d, u.companyId)).map((s) => ({ id: s.id, name: s.name, email: s.email, roleLabel: d.permissions.roleLabel(s.role) })),
    })
  })

  /** A schedule's fields, checked; the first problem as a sentence. */
  async function checked(companyId: string, b: any, creating: boolean, existing?: any): Promise<{ error: string } | { values: Record<string, any> }> {
    const v: Record<string, any> = {}
    const report = 'report' in b || creating ? b.report : existing.report
    if (!REPORTS.some((r) => r.id === report)) return { error: `Choose a report: ${REPORTS.map((r) => r.label).join(' or ')}.` }
    v.report = report
    const frequency = 'frequency' in b || creating ? b.frequency : existing.frequency
    if (frequency !== 'weekly' && frequency !== 'monthly') return { error: 'Choose weekly or monthly.' }
    v.frequency = frequency
    if (frequency === 'weekly') {
      const w = 'weekday' in b || creating ? b.weekday : existing.weekday
      if (!Number.isInteger(w) || w < 0 || w > 6) return { error: 'Choose the day of the week it goes out.' }
      v.weekday = w; v.monthDay = null
    } else {
      const m = 'monthDay' in b || creating ? b.monthDay : existing.monthDay
      if (!Number.isInteger(m) || m < 1 || m > 28) return { error: 'Choose a day of the month from the 1st to the 28th, so every month has it.' }
      v.monthDay = m; v.weekday = null
    }
    if ('recipients' in b || creating) {
      const ids = b.recipients
      if (!Array.isArray(ids) || ids.length === 0 || ids.some((x: unknown) => typeof x !== 'string')) return { error: 'Choose at least one person to send it to.' }
      const unique = [...new Set(ids as string[])]
      if (unique.length > MAX_RECIPIENTS) return { error: `A report goes to at most ${MAX_RECIPIENTS} people.` }
      const ok = new Set((await eligibleSeats(d, companyId, unique)).map((s) => s.id))
      const bad = unique.filter((id) => !ok.has(id))
      if (bad.length) return { error: 'Reports can only go to people on this business who can read reports.' }
      v.recipients = unique
    }
    if ('active' in b) { if (typeof b.active !== 'boolean') return { error: 'active must be true or false.' }; v.active = b.active }
    return { values: v }
  }

  app.post('/', requirePermission('settings:update'), async (c) => {
    const u = c.get('user') as any
    const b = (await c.req.json().catch(() => null)) ?? ({} as any)
    const r = await checked(u.companyId, b, true)
    if ('error' in r) return fail(c, 400, r.error)
    const [row] = await db.insert(eventReportSchedule).values({ id: createId(), ...r.values, createdBy: u.userId, companyId: u.companyId } as any).returning()
    await audit.log({ action: 'create', entity: 'event_report_schedule', entityId: row.id, entityName: `${reportLabel(row.report)}, ${whenWords(row)}`, metadata: row, req: { user: u } })
    return one(c, await view(row, new Map((await eligibleSeats(d, u.companyId)).map((s) => [s.id, s]))), 201)
  })

  app.put('/:id', requirePermission('settings:update'), async (c) => {
    const u = c.get('user') as any
    const b = (await c.req.json().catch(() => null)) ?? ({} as any)
    const [existing] = await db.select().from(eventReportSchedule).where(and(eq(eventReportSchedule.id, c.req.param('id')), eq(eventReportSchedule.companyId, u.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Schedule not found')
    const r = await checked(u.companyId, b, false, existing)
    if ('error' in r) return fail(c, 400, r.error)
    const [row] = await db.update(eventReportSchedule).set({ ...r.values, updatedAt: new Date() }).where(eq(eventReportSchedule.id, existing.id)).returning()
    await audit.log({ action: 'update', entity: 'event_report_schedule', entityId: row.id, entityName: reportLabel(row.report), changes: audit.diff(existing, row), req: { user: u } })
    return one(c, await view(row, new Map((await eligibleSeats(d, u.companyId)).map((s) => [s.id, s]))))
  })

  app.delete('/:id', requirePermission('settings:update'), async (c) => {
    const u = c.get('user') as any
    const [existing] = await db.select().from(eventReportSchedule).where(and(eq(eventReportSchedule.id, c.req.param('id')), eq(eventReportSchedule.companyId, u.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Schedule not found')
    await db.delete(eventReportSchedule).where(eq(eventReportSchedule.id, existing.id))
    await audit.log({ action: 'delete', entity: 'event_report_schedule', entityId: existing.id, entityName: reportLabel(existing.report), metadata: existing, req: { user: u } })
    return done(c)
  })

  // Send it now, to its seats, for the period that would be sent next: the way to see what a schedule sends. It does not use up the day.
  app.post('/:id/send-now', requirePermission('settings:update'), async (c) => {
    const u = c.get('user') as any
    const [row] = await db.select().from(eventReportSchedule).where(and(eq(eventReportSchedule.id, c.req.param('id')), eq(eventReportSchedule.companyId, u.companyId))).limit(1)
    if (!row) return fail(c, 404, 'Schedule not found')
    if (!(await d.features.isFeatureEnabled(u.companyId, 'event_reports'))) return fail(c, 404, 'Not found')
    const [co] = await db.select({ id: company.id, name: company.name }).from(company).where(eq(company.id, u.companyId)).limit(1)
    const today = shopClock(await companyTimeZone(db, u.companyId), new Date()).day
    const n = await sendScheduled(d, co, row, today)
    if (n === 0) return fail(c, 409, 'None of the people chosen can be sent this report any more. Choose who it goes to.')
    return done(c, `Sent to ${n} ${n === 1 ? 'person' : 'people'}.`)
  })

  return app
}

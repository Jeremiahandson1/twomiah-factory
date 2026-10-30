// Lead-source and year-on-year event reports (restaurant-bar-depth #7; Tripleseat reports by source, Perfect Venue
// year-over-year). Read-only, behind the 'event_reports' feature (not ready), reports:read; the money in them is
// invoices:read, so a seat without it gets the counts and not the values.
//
//   GET /api/event-reports/sources?from=&to=   enquiries that came in over the period, by source: how many became bookings,
//                                              how many were lost, the conversion, and the value of what was booked
//   GET /api/event-reports/years?year=2026     value booked each month of the year beside the year before, and the counts
import { Hono } from 'hono'
import { and, eq, gte, lte } from 'drizzle-orm'
import { round2, companyTimeZone, storeDateString } from '@twomiah/tenant-backend'
import { event, invoice } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import { isCalendarDate } from './eventBooking.ts'
import { EVENT_SOURCES, sourceId } from './eventSources.ts'

const BOOKED = ['confirmed', 'completed']

/** What an event is worth: its invoice if it has a live one, else its quoted total. */
const worth = (ev: any, inv: any) => round2(Number(inv && inv.status !== 'void' ? inv.total : ev.quotedTotal) || 0)

export function createEventReportRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission, hasPermission, getExtraPermissions } = d.permissions
  const app = new Hono<AppEnv>()
  const seesMoney = async (u: any) => hasPermission(u?.role, 'invoices:read', await getExtraPermissions(u?.userId))

  app.get('/sources', requirePermission('reports:read'), async (c) => {
    const u = c.get('user') as any
    const from = c.req.query('from') || '', to = c.req.query('to') || ''
    if (!isCalendarDate(from) || !isCalendarDate(to) || to < from) return fail(c, 400, 'from and to are required as YYYY-MM-DD, from first')
    const tz = await companyTimeZone(db, u.companyId)
    // Enquiries that came in on those days on the venue's clock (a day either side is read, then trimmed to the clock).
    const lo = new Date(Date.parse(from + 'T00:00:00Z') - 86400000), hi = new Date(Date.parse(to + 'T00:00:00Z') + 2 * 86400000)
    const rows = await db.select({ ev: event, inv: invoice }).from(event).leftJoin(invoice, eq(invoice.eventId, event.id))
      .where(and(eq(event.companyId, u.companyId), gte(event.createdAt, lo), lte(event.createdAt, hi)))
    const money = await seesMoney(u)
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
    const label = (id: string) => (id === 'none' ? 'No source given' : EVENT_SOURCES.find((s) => s.id === id)!.label)
    const sources = [...by.entries()].filter(([, v]) => v.enquiries > 0).map(([id, v]) => ({
      source: id, label: label(id), enquiries: v.enquiries, booked: v.booked, lost: v.lost, open: v.enquiries - v.booked - v.lost,
      conversion: v.enquiries ? Math.round((v.booked / v.enquiries) * 1000) / 10 : 0,
      ...(money ? { bookedValue: round2(v.value) } : {}),
    })).sort((a, b) => b.enquiries - a.enquiries)
    const sum = (k: 'enquiries' | 'booked' | 'lost') => sources.reduce((s, r) => s + r[k], 0)
    return one(c, {
      from, to, sources,
      totals: { enquiries: sum('enquiries'), booked: sum('booked'), lost: sum('lost'), conversion: sum('enquiries') ? Math.round((sum('booked') / sum('enquiries')) * 1000) / 10 : 0, ...(money ? { bookedValue: round2(sources.reduce((s, r) => s + ((r as any).bookedValue || 0), 0)) } : {}) },
    })
  })

  app.get('/years', requirePermission('reports:read'), async (c) => {
    const u = c.get('user') as any
    const tz = await companyTimeZone(db, u.companyId)
    const year = Number(c.req.query('year') || storeDateString(new Date(), tz).slice(0, 4))
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return fail(c, 400, 'year must be a four-digit year')
    const lo = new Date(Date.UTC(year - 1, 0, 1) - 86400000), hi = new Date(Date.UTC(year + 1, 0, 1) + 86400000)
    const rows = await db.select({ ev: event, inv: invoice }).from(event).leftJoin(invoice, eq(invoice.eventId, event.id))
      .where(and(eq(event.companyId, u.companyId), gte(event.bookedAt, lo), lte(event.bookedAt, hi)))
    const money = await seesMoney(u)
    const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, booked: 0, lastYearBooked: 0, value: 0, lastYearValue: 0 }))
    for (const { ev, inv } of rows) {
      if (!ev.bookedAt || ['cancelled', 'lost'].includes(ev.status)) continue
      const day = storeDateString(new Date(ev.bookedAt), tz)
      const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7)) - 1
      if (y === year) { months[m].booked++; months[m].value += worth(ev, inv) }
      else if (y === year - 1) { months[m].lastYearBooked++; months[m].lastYearValue += worth(ev, inv) }
    }
    const out = months.map((m) => ({ month: m.month, booked: m.booked, lastYearBooked: m.lastYearBooked, ...(money ? { value: round2(m.value), lastYearValue: round2(m.lastYearValue) } : {}) }))
    const total = (k: string) => round2(out.reduce((s, m: any) => s + (m[k] || 0), 0))
    return one(c, { year, months: out, totals: { booked: total('booked'), lastYearBooked: total('lastYearBooked'), ...(money ? { value: total('value'), lastYearValue: total('lastYearValue') } : {}) } })
  })

  return app
}

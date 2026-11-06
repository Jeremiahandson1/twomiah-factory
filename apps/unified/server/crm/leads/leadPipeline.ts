// /api/lead-pipeline — where the work stands from enquiry to signed quote, and the quotes still waiting on a customer
// (feature lead_pipeline, not ready).
//
//   GET /             leads:read    the strip: New → Contacted → Site visit booked → Quotes out → Won, and Lost beside them
//   GET /awaiting-reply   quotes:read   every quote sent and not answered, the longest-waiting first
//
// The strip counts ENQUIRIES for the first three steps, each enquiry in exactly one of them (an open enquiry with a visit still
// to come is "Site visit booked", not also New), and QUOTES for the last two: Quotes out = sent or viewed and not answered,
// Won = approved in the last 30 days. Lost = enquiries marked Lost in the last 30 days. Dollar figures are quote totals and are
// sent only to a seat that holds quotes:read; a seat that holds leads:read alone sees the counts and the step names.
// Days waiting are counted on the company's calendar, not the server's. Nothing here moves money.
import { Hono } from 'hono'
import { and, count, eq, gte, inArray, isNotNull } from 'drizzle-orm'
import { companyTimeZone, daysUntilMarker, storeDateString } from '@twomiah/tenant-backend'
import { lead, quote, contact, reminderLog } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { one, listAll } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { canSeeWith } from '../deps.ts'
import { KIND as FOLLOW_UP_KIND, AWAITING } from '../billing/quoteFollowUp.ts'

const WINDOW_DAYS = 30

export interface Stage { id: string; label: string; count: number; value?: number }

/** Whole days a quote has waited, counted on the company's calendar (sent on the 3rd, today the 5th → 2). */
export function daysWaiting(sentAt: Date | string, tz: string, now: Date = new Date()): number {
  const sentDay = storeDateString(new Date(sentAt), tz)
  return Math.max(0, -daysUntilMarker(sentDay, tz, now))
}

export function createLeadPipelineRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const mayWith = canSeeWith(d.permissions)
  const app = new Hono<AppEnv>()

  const awaiting = async (companyId: string) => {
    const rows = await db.select({
      id: quote.id, number: quote.number, name: quote.name, status: quote.status, total: quote.total, sentAt: quote.sentAt, issueDate: quote.issueDate,
      viewedAt: quote.viewedAt, expiryDate: quote.expiryDate, contactId: quote.contactId, contactName: contact.name,
    }).from(quote).leftJoin(contact, eq(quote.contactId, contact.id))
      .where(and(eq(quote.companyId, companyId), inArray(quote.status, AWAITING)))
    // The longest-waiting first: by the day it was sent (the day it was made, if a sent date was never kept), then by id.
    const waitingSince = (r: any) => new Date(r.sentAt || r.issueDate).getTime()
    return rows.sort((a: any, b: any) => waitingSince(a) - waitingSince(b) || String(a.id).localeCompare(String(b.id)))
  }

  app.get('/', requirePermission('leads:read'), async (c) => {
    const me = c.get('user')
    const companyId = me.companyId
    const now = new Date()
    const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000)
    const open = await db.select({ status: lead.status, siteVisitAt: lead.siteVisitAt }).from(lead)
      .where(and(eq(lead.companyId, companyId), inArray(lead.status, ['new', 'contacted'])))
    const withVisit = open.filter((l: any) => l.siteVisitAt && new Date(l.siteVisitAt) >= now).length
    const [{ n: lost }] = await db.select({ n: count() }).from(lead)
      .where(and(eq(lead.companyId, companyId), eq(lead.status, 'lost'), gte(lead.lostAt, since)))
    const stages: Stage[] = [
      { id: 'new', label: 'New', count: open.filter((l: any) => l.status === 'new' && !(l.siteVisitAt && new Date(l.siteVisitAt) >= now)).length },
      { id: 'contacted', label: 'Contacted', count: open.filter((l: any) => l.status === 'contacted' && !(l.siteVisitAt && new Date(l.siteVisitAt) >= now)).length },
      { id: 'site_visit', label: 'Site visit booked', count: withVisit },
    ]
    const maySeeQuotes = await mayWith(me.role, 'quotes:read', me.userId)
    let quotes: { count: number; value: number } | null = null
    if (maySeeQuotes) {
      const out = await awaiting(companyId)
      const won = await db.select({ total: quote.total }).from(quote)
        .where(and(eq(quote.companyId, companyId), eq(quote.status, 'approved'), isNotNull(quote.approvedAt), gte(quote.approvedAt, since)))
      const sum = (rows: any[]) => Math.round(rows.reduce((s, r) => s + Number(r.total), 0) * 100) / 100
      stages.push({ id: 'quotes_out', label: 'Quotes out', count: out.length, value: sum(out) })
      stages.push({ id: 'won', label: 'Won', count: won.length, value: sum(won) })
      quotes = { count: out.length, value: sum(out) }
    }
    stages.push({ id: 'lost', label: 'Lost', count: Number(lost) })
    return one(c, { stages, days: WINDOW_DAYS, quotes })
  })

  app.get('/awaiting-reply', requirePermission('quotes:read'), async (c) => {
    const companyId = c.get('user').companyId
    const [rows, tz] = await Promise.all([awaiting(companyId), companyTimeZone(db, companyId)])
    const nudges = rows.length
      ? await db.select({ subjectId: reminderLog.subjectId, n: count() }).from(reminderLog)
        .where(and(eq(reminderLog.companyId, companyId), eq(reminderLog.kind, FOLLOW_UP_KIND), eq(reminderLog.status, 'sent'), inArray(reminderLog.subjectId, rows.map((r: any) => r.id))))
        .groupBy(reminderLog.subjectId)
      : []
    const sentCount = new Map<string, number>(nudges.map((r: any) => [String(r.subjectId), Number(r.n)]))
    const now = new Date()
    return listAll(c, rows.map((r: any) => {
      const sent = r.sentAt || r.issueDate
      return {
        id: r.id, number: r.number, name: r.name, status: r.status, total: Number(r.total), contactId: r.contactId, contactName: r.contactName,
        sentAt: sent, viewed: !!r.viewedAt, daysWaiting: daysWaiting(sent, tz, now), followUpsSent: sentCount.get(r.id) || 0,
        expired: !!r.expiryDate && new Date(r.expiryDate) < now,
      }
    }))
  })

  return app
}

// The customer confirms a visit (Jobber's "Confirm" on the Client Hub and "reply Y / C"): three doors, one rule.
//   · the private link in a reminder — /visit/<token>, one visit and nothing else of the customer's (public, no sign-in);
//   · the customer portal's "Upcoming visits" (the same rule, by the portal's own link);
//   · a text back: Y, YES, C or CONFIRM to the reminder confirms the soonest visit they were reminded of.
// A confirmation is job.confirmed_at (and confirmed_via: link, portal or text). It only means something for a visit still to
// come: a finished, cancelled or past visit is not confirmed, and moving a visit clears it (jobs.ts, bulk.ts) because the
// customer confirmed the old time. The office sees it on the job and in the Client Communications report.
import { Hono } from 'hono'
import { and, eq, gte, inArray, desc } from 'drizzle-orm'
import { companyRowTimeZone, markerDay } from '@twomiah/tenant-backend'
import { company, job, reminderLog } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { one, fail } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { dateWords, timeWords, visitStart, JOB_NOTICE_KIND } from './jobReminders.ts'

export type ConfirmedVia = 'link' | 'portal' | 'text'
const OPEN = ['scheduled', 'dispatched']
/** Words a customer can text back to say yes. */
const YES = new Set(['Y', 'YES', 'C', 'CONFIRM', 'CONFIRMED'])
/** How far back a reminder still counts as the one a text is answering. */
const REPLY_DAYS = 14

/** A text's meaning: yes or nothing (anything else is just a text to the business). */
export const isConfirmReply = (body: unknown): boolean => YES.has(String(body ?? '').trim().replace(/[.!\s]+$/g, '').toUpperCase())

const dayBefore = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); d.setUTCHours(0, 0, 0, 0); return d }

export interface VisitView { jobId: string; title: string; when: string; address: string; companyName: string; confirmed: boolean; confirmedAt: string | null; open: boolean }

export function createJobConfirm(d: CrmDeps) {
  const { db } = d

  const viewOf = (j: any, co: any): VisitView => {
    const tz = companyRowTimeZone(co)
    const v = visitStart(j.scheduledDate, j.scheduledTime, tz, 8)
    const future = !!v && markerDay(j.scheduledDate) >= markerDay(dayBefore())
    return {
      jobId: j.id, title: j.title || 'Your visit', companyName: co.name || '',
      when: v ? (v.allDay ? dateWords(v.start, tz) : `${dateWords(v.start, tz)} at ${timeWords(v.start, tz)}`) : '',
      address: [j.address, j.city].filter(Boolean).join(', '),
      confirmed: !!j.confirmedAt, confirmedAt: j.confirmedAt ? new Date(j.confirmedAt).toISOString() : null,
      open: OPEN.includes(j.status) && future,
    }
  }

  /** Confirm one visit. Already confirmed is fine (nothing changes); a visit that is done, cancelled or past cannot be. */
  async function confirm(companyId: string, jobId: string, via: ConfirmedVia, now = new Date()): Promise<{ ok: true; visit: VisitView; already: boolean } | { ok: false; error: string; status: 404 | 409 }> {
    const [j] = await db.select().from(job).where(and(eq(job.id, jobId), eq(job.companyId, companyId))).limit(1)
    const [co] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
    if (!j || !co) return { ok: false, error: 'That visit was not found.', status: 404 }
    const view = viewOf(j, co)
    if (!view.open) return { ok: false, error: 'That visit has already happened or was cancelled, so there is nothing to confirm.', status: 409 }
    if (j.confirmedAt) return { ok: true, visit: view, already: true }
    await db.update(job).set({ confirmedAt: now, confirmedVia: via, updatedAt: now }).where(eq(job.id, j.id))
    return { ok: true, visit: { ...view, confirmed: true, confirmedAt: now.toISOString() }, already: false }
  }

  async function byToken(token: string) {
    if (!/^[0-9a-f]{64}$/.test(token)) return null
    const [j] = await db.select().from(job).where(eq(job.confirmToken, token)).limit(1)
    if (!j) return null
    const [co] = await db.select().from(company).where(eq(company.id, j.companyId)).limit(1)
    return co ? { j, co } : null
  }

  /**
   * A text back to the business. Y / YES / C / CONFIRM confirms the soonest visit this customer was reminded of lately and
   * gets a one-line answer; anything else (or no such visit) returns null and is an ordinary text for the inbox.
   */
  async function onReply(m: { companyId: string; contactId: string | null; body: string }, now = new Date()): Promise<string | null> {
    const contactId = m.contactId
    if (!contactId || !isConfirmReply(m.body)) return null
    const noticeKinds = [JOB_NOTICE_KIND.sms, JOB_NOTICE_KIND.email, JOB_NOTICE_KIND.movedSms, JOB_NOTICE_KIND.movedEmail]
    const since = new Date(now.getTime() - REPLY_DAYS * 86_400_000)
    const reminded = await db.select({ subjectId: reminderLog.subjectId }).from(reminderLog)
      .where(and(eq(reminderLog.companyId, m.companyId), inArray(reminderLog.kind, noticeKinds), eq(reminderLog.status, 'sent'), gte(reminderLog.createdAt, since)))
      .orderBy(desc(reminderLog.createdAt))
    const ids = Array.from(new Set<string>(reminded.map((r: any) => String(r.subjectId))))
    if (!ids.length) return null
    const rows: any[] = await db.select().from(job)
      .where(and(eq(job.companyId, m.companyId), eq(job.contactId, contactId), inArray(job.id, ids as any), inArray(job.status, OPEN as any), gte(job.scheduledDate, dayBefore())))
    if (!rows.length) return null
    rows.sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime() || String(a.scheduledTime ?? '').localeCompare(String(b.scheduledTime ?? '')))
    const [co] = await db.select().from(company).where(eq(company.id, m.companyId)).limit(1)
    const next = rows.find((r) => !r.confirmedAt) ?? rows[0]
    const r = await confirm(m.companyId, next.id, 'text', now)
    if (!r.ok) return null
    return r.already
      ? `${co?.name || 'We'}: your ${r.visit.title} visit on ${r.visit.when} is already confirmed. Thank you!`
      : `${co?.name || 'We'}: thank you — your ${r.visit.title} visit on ${r.visit.when} is confirmed.`
  }

  /** The customer's coming visits, for the portal. */
  async function upcomingFor(companyId: string, contactId: string): Promise<VisitView[]> {
    const rows: any[] = await db.select().from(job)
      .where(and(eq(job.companyId, companyId), eq(job.contactId, contactId), inArray(job.status, OPEN), gte(job.scheduledDate, dayBefore())))
    const [co] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
    if (!co) return []
    rows.sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime())
    return rows.map((j) => viewOf(j, co)).filter((v) => v.open).slice(0, 20)
  }

  /** /api/visit-confirm — the link in a reminder. Public: the 64-hex token is the key, and it opens one visit. */
  const routes = new Hono<AppEnv>()
  routes.get('/:token', async (c) => {
    const found = await byToken(c.req.param('token'))
    if (!found) return fail(c, 404, 'This link is not valid any more.')
    if (!(await d.features.isFeatureEnabled(found.j.companyId, 'job_reminders'))) return fail(c, 404, 'This link is not valid any more.')
    return one(c, viewOf(found.j, found.co))
  })
  routes.post('/:token', async (c) => {
    const found = await byToken(c.req.param('token'))
    if (!found || !(await d.features.isFeatureEnabled(found.j.companyId, 'job_reminders'))) return fail(c, 404, 'This link is not valid any more.')
    const r = await confirm(found.j.companyId, found.j.id, 'link')
    if (!r.ok) return fail(c, r.status, r.error)
    return one(c, r.visit)
  })

  return { confirm, onReply, upcomingFor, routes, byToken }
}

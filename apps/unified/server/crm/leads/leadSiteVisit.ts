// /api/lead-site-visit — book the visit to look at the work for an enquiry, straight onto the schedule (feature lead_site_visit,
// not ready).
//
//   POST   /:id    leads:update + schedule:create  { start, minutes?, assigneeId?, notes? } — book it, or move it
//   DELETE /:id    leads:update + schedule:update  cancel it
//
// A visit is an ordinary Schedule entry (type "site_visit"), so it shows on the calendar the crew already reads; the enquiry
// remembers when and which entry. Booking again MOVES that entry (never a second one). Cancelling greys the entry, as every
// schedule cancel does, and clears the enquiry. Booking a visit means the customer was reached, so a New enquiry becomes
// Contacted. A visit on a lost, dismissed, spam or converted-away enquiry is refused: reopen it first.
// The seat needs BOTH permissions, because it writes both a lead and a calendar entry. Nothing here moves money.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { lead, scheduleEvent, user as userTable } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'

export const SITE_VISIT = 'site_visit'
const CLOSED = ['lost', 'dismissed', 'spam']

const bookSchema = z.object({
  start: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Pick the day and time of the visit'),
  minutes: z.number({ error: 'Enter the length in minutes' }).int('Enter the length in minutes').min(15, 'At least 15 minutes').max(480, 'At most 8 hours').optional(),
  assigneeId: z.string().min(1).optional(),
  notes: z.string().trim().max(500, 'Keep the notes under 500 characters').optional(),
})

export function createLeadSiteVisitRoutes(d: CrmDeps) {
  const { db, audit, realtime } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  const find = async (companyId: string, id: string) =>
    (await db.select().from(lead).where(and(eq(lead.id, id), eq(lead.companyId, companyId))).limit(1))[0]

  app.post('/:id', requirePermission('leads:update'), requirePermission('schedule:create'), async (c) => {
    const parsed = bookSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const me = c.get('user')
    const row = await find(me.companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'Lead not found')
    if (CLOSED.includes(row.status)) return fail(c, 409, 'This enquiry is closed. Reopen it before booking a visit.')
    const start = new Date(parsed.data.start)
    const end = new Date(start.getTime() + (parsed.data.minutes ?? 60) * 60_000)
    let assignee = me.userId as string | undefined
    if (parsed.data.assigneeId) {
      const [who] = await db.select({ id: userTable.id }).from(userTable).where(and(eq(userTable.id, parsed.data.assigneeId), eq(userTable.companyId, me.companyId))).limit(1)
      if (!who) return fail(c, 400, 'That person is not on your team.', undefined, { assigneeId: 'Pick someone on your team' })
      assignee = who.id
    }
    const notes = [row.location && `Where: ${row.location}`, row.phone && `Phone: ${row.phone}`, row.jobType && `For: ${row.jobType}`, parsed.data.notes].filter(Boolean).join('\n')
    const fields = { title: `Site visit — ${row.homeownerName}`, type: SITE_VISIT, start, end, notes: notes || null, userId: assignee ?? null, status: 'scheduled', updatedAt: new Date() }
    let eventId: string | undefined
    let moved = false
    if (row.siteVisitEventId) {
      // Move the entry this enquiry already has (the company's own), not a second one.
      const [ev] = await db.update(scheduleEvent).set(fields).where(and(eq(scheduleEvent.id, row.siteVisitEventId), eq(scheduleEvent.companyId, me.companyId))).returning()
      if (ev) { eventId = ev.id; moved = true }
    }
    if (!eventId) {
      const [ev] = await db.insert(scheduleEvent).values({ ...fields, companyId: me.companyId }).returning()
      eventId = ev.id
    }
    const now = new Date()
    const [updated] = await db.update(lead).set({
      siteVisitAt: start, siteVisitEventId: eventId, updatedAt: now,
      ...(row.status === 'new' ? { status: 'contacted' } : {}), ...(!row.contactedAt ? { contactedAt: now } : {}),
    }).where(and(eq(lead.id, row.id), eq(lead.companyId, me.companyId))).returning()
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'lead', entityId: row.id, entityName: row.homeownerName, metadata: { siteVisit: start.toISOString(), moved }, req: c })
    realtime.emitToCompany(me.companyId, realtime.EVENTS.LEAD_UPDATED, { id: row.id, status: updated.status })
    return one(c, { ...updated, eventId }, moved ? 200 : 201)
  })

  app.delete('/:id', requirePermission('leads:update'), requirePermission('schedule:update'), async (c) => {
    const me = c.get('user')
    const row = await find(me.companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'Lead not found')
    if (!row.siteVisitAt) return fail(c, 409, 'No site visit is booked for this enquiry.')
    if (row.siteVisitEventId) {
      await db.update(scheduleEvent).set({ status: 'cancelled', updatedAt: new Date() }).where(and(eq(scheduleEvent.id, row.siteVisitEventId), eq(scheduleEvent.companyId, me.companyId)))
    }
    const [updated] = await db.update(lead).set({ siteVisitAt: null, siteVisitEventId: null, updatedAt: new Date() })
      .where(and(eq(lead.id, row.id), eq(lead.companyId, me.companyId))).returning()
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'lead', entityId: row.id, entityName: row.homeownerName, metadata: { siteVisitCancelled: true }, req: c })
    realtime.emitToCompany(me.companyId, realtime.EVENTS.LEAD_UPDATED, { id: row.id, status: updated.status })
    return one(c, updated)
  })

  return app
}

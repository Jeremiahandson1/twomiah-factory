// /api/lead-lost — an enquiry that will not become work, filed as Lost with the reason (feature lead_lost, not ready).
//
//   GET    /reasons    leads:read    the reasons to pick from, and how many enquiries were lost to each in the last 90 days
//   POST   /:id        leads:update  { reason, note? } — mark the enquiry Lost
//   DELETE /:id        leads:update  take it back: the enquiry is New again and the reason is cleared
//
// Lost is not Dismissed. Dismissed is "this was never a real enquiry" (a wrong number, a salesperson); Lost is "a real person
// who did not hire us", and the reason is what the owner learns from. A lost enquiry leaves New, Contacted and the pipeline, is
// counted under its reason, and can be reopened. A converted enquiry is not lost (it is already a customer): refused.
// Nothing here moves money.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, count, eq, gte } from 'drizzle-orm'
import { lead } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'

/** The reasons, in plain words a builder uses. `other` needs a note. */
export const LOST_REASONS = [
  { id: 'price', label: 'Our price was too high' },
  { id: 'chose_other', label: 'They hired someone else' },
  { id: 'not_ready', label: 'Not ready yet, or put it off' },
  { id: 'no_reply', label: 'Stopped replying' },
  { id: 'too_far', label: 'Outside the area we work in' },
  { id: 'not_our_work', label: 'Not the kind of work we do' },
  { id: 'too_small', label: 'Too small a job' },
  { id: 'other', label: 'Something else (say what)' },
] as const
export const LOST_REASON_IDS = LOST_REASONS.map((r) => r.id) as string[]

const lostSchema = z.object({
  reason: z.string().refine((v) => LOST_REASON_IDS.includes(v), 'Pick a reason'),
  note: z.string().trim().max(500, 'Keep the note under 500 characters').optional(),
}).refine((v) => v.reason !== 'other' || !!v.note, { message: 'Say what the reason was', path: ['note'] })

const WINDOW_DAYS = 90

export function createLeadLostRoutes(d: CrmDeps) {
  const { db, audit, realtime } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  const find = async (companyId: string, id: string) =>
    (await db.select().from(lead).where(and(eq(lead.id, id), eq(lead.companyId, companyId))).limit(1))[0]

  app.get('/reasons', requirePermission('leads:read'), async (c) => {
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
    const rows = await db.select({ reason: lead.lostReason, n: count() }).from(lead)
      .where(and(eq(lead.companyId, c.get('user').companyId), eq(lead.status, 'lost'), gte(lead.lostAt, since))).groupBy(lead.lostReason)
    const counts = new Map<string, number>(rows.map((r: any) => [String(r.reason), Number(r.n)]))
    return listAll(c, LOST_REASONS.map((r) => ({ id: r.id, label: r.label, lost: counts.get(r.id) || 0, days: WINDOW_DAYS })))
  })

  app.post('/:id', requirePermission('leads:update'), async (c) => {
    const parsed = lostSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const user = c.get('user')
    const row = await find(user.companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'Lead not found')
    if (row.status === 'converted') return fail(c, 409, 'This enquiry is already a customer, so it cannot be marked lost.')
    if (row.status === 'lost') return fail(c, 409, 'This enquiry is already marked lost.')
    const [updated] = await db.update(lead).set({
      status: 'lost', lostReason: parsed.data.reason, lostNote: parsed.data.note || null, lostAt: new Date(), updatedAt: new Date(),
    }).where(and(eq(lead.id, row.id), eq(lead.companyId, user.companyId))).returning()
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'lead', entityId: row.id, entityName: row.homeownerName, metadata: { lost: parsed.data.reason, was: row.status }, req: c })
    realtime.emitToCompany(user.companyId, realtime.EVENTS.LEAD_UPDATED, { id: row.id, status: 'lost' })
    return one(c, updated)
  })

  app.delete('/:id', requirePermission('leads:update'), async (c) => {
    const user = c.get('user')
    const row = await find(user.companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'Lead not found')
    if (row.status !== 'lost') return fail(c, 409, 'This enquiry is not marked lost.')
    const [updated] = await db.update(lead).set({ status: 'new', lostReason: null, lostNote: null, lostAt: null, updatedAt: new Date() })
      .where(and(eq(lead.id, row.id), eq(lead.companyId, user.companyId))).returning()
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'lead', entityId: row.id, entityName: row.homeownerName, metadata: { reopened: true, lostReason: row.lostReason }, req: c })
    realtime.emitToCompany(user.companyId, realtime.EVENTS.LEAD_UPDATED, { id: row.id, status: 'new' })
    return one(c, updated)
  })

  return app
}

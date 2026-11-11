// CALLER ID — the screen pop (parity tier 3, field service — ServiceTitan's caller ID with the customer's record; feature caller_id,
// not ready). A call to the business's tracking number is logged as it comes in (./calltrackingService.ts logCall, the number
// already matched to a customer) and the office's screens are told its id ('call:incoming'). Each screen then asks here who it is:
//
//   GET /api/caller-id/:callId    contacts:read    the caller: the customer it matched (name, phone, address), their open jobs and the
//                                                  next one, and — for a seat with invoices:read — what they owe; or "a new caller"
import { Hono } from 'hono'
import { and, asc, eq, notInArray } from 'drizzle-orm'
import { invoiceBalance } from '@twomiah/tenant-backend'
import { callLog, contact, invoice, job } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { canSeeWith } from '../deps.ts'

const OPEN = ['completed', 'cancelled']

export function createCallerIdRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const mayWith = canSeeWith(d.permissions)
  const app = new Hono<AppEnv>()

  app.get('/:callId', requirePermission('contacts:read'), async (c) => {
    const me = c.get('user')
    const [call] = await db.select().from(callLog).where(and(eq(callLog.id, c.req.param('callId')), eq(callLog.companyId, me.companyId))).limit(1)
    if (!call) return fail(c, 404, 'That call was not found.')
    const base = { callId: call.id, number: call.callerNumber ?? null, callerName: call.callerName ?? null, place: [call.callerCity, call.callerState].filter(Boolean).join(', ') || null, source: call.source ?? null }
    if (!call.contactId) return one(c, { ...base, customer: null })
    const [ct] = await db.select({ id: contact.id, name: contact.name, phone: contact.phone, address: contact.address, city: contact.city }).from(contact).where(and(eq(contact.id, call.contactId), eq(contact.companyId, me.companyId))).limit(1)
    if (!ct) return one(c, { ...base, customer: null })
    const jobs = await db.select({ id: job.id, number: job.number, title: job.title, scheduledDate: job.scheduledDate, status: job.status }).from(job)
      .where(and(eq(job.companyId, me.companyId), eq(job.contactId, ct.id), notInArray(job.status, OPEN))).orderBy(asc(job.scheduledDate), asc(job.id)).limit(20)
    const next = (jobs as any[]).find((j) => j.scheduledDate && new Date(j.scheduledDate) >= new Date(Date.now() - 86_400_000)) ?? null
    let owed: number | null = null
    if (await mayWith(me.role, 'invoices:read', me.userId).catch(() => false)) {
      // What is still owed on their issued invoices, by the invoices' own balance rule (a draft is not owed yet).
      const inv = await db.select({ status: invoice.status, total: invoice.total, amountPaid: invoice.amountPaid, amountRefunded: invoice.amountRefunded }).from(invoice)
        .where(and(eq(invoice.companyId, me.companyId), eq(invoice.contactId, ct.id), notInArray(invoice.status, ['draft', 'void'])))
      owed = Math.round((inv as any[]).reduce((n, i) => n + invoiceBalance(i) * 100, 0)) / 100
    }
    return one(c, {
      ...base,
      customer: { id: ct.id, name: ct.name, phone: ct.phone, address: [ct.address, ct.city].filter(Boolean).join(', ') || null },
      openJobs: jobs.length,
      nextJob: next ? { id: next.id, number: next.number, title: next.title, date: new Date(next.scheduledDate).toISOString().slice(0, 10) } : null,
      owed,
    })
  })

  return app
}

// Billing a route's visits (mounted under /api/recurring-routes/billing by recurringRoutes.ts, behind the recurring_routes
// feature). The leaders' way: bill a visit on its own, or run the month — one DRAFT invoice per customer from the completed,
// unbilled visits in a date range, optionally grouped by property — review the drafts, and undo the whole run while they are
// still drafts (Yardbook). The work is data/routeBilling.ts; this is the doors and their permissions.
import { Hono } from 'hono'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import { previewBatch, createBatch, billVisit, undoBatch, recentBatches, type BatchOptions } from '../../data/routeBilling.ts'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const realDay = (s: unknown) => typeof s === 'string' && DAY.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s
const MAX_RANGE_DAYS = 366

/** The run's dates and grouping, from a query or a body; a refusal is a sentence about the boxes on the screen. */
function readRange(src: Record<string, unknown>): { opts: BatchOptions } | { error: string; fields: Record<string, string> } {
  const from = String(src.from ?? ''), to = String(src.to ?? '')
  if (!realDay(from)) { const e = 'Pick the first service day to bill (YYYY-MM-DD).'; return { error: e, fields: { from: e } } }
  if (!realDay(to)) { const e = 'Pick the last service day to bill (YYYY-MM-DD).'; return { error: e, fields: { to: e } } }
  if (to < from) { const e = 'The last day cannot be before the first day.'; return { error: e, fields: { to: e } } }
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_RANGE_DAYS) { const e = 'Bill a year or less at a time.'; return { error: e, fields: { to: e } } }
  const groupBy = src.groupBy === 'property' ? 'property' : 'none'
  return { opts: { from, to, groupBy } }
}

export function createRouteBillingRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  // GET /preview?from=&to=&groupBy= — what the run would bill and what it leaves out, before anything is made
  app.get('/preview', requirePermission('invoices:read'), async (c) => {
    const u = c.get('user')
    const r = readRange(c.req.query())
    if ('error' in r) return fail(c, 400, r.error, undefined, r.fields)
    const { staleLinkIds: _s, ...plan } = await previewBatch(db, u.companyId, r.opts)
    return one(c, plan)
  })

  // POST /batches { from, to, groupBy? } — make the drafts
  app.post('/batches', requirePermission('invoices:create'), async (c) => {
    const u = c.get('user')
    const r = readRange(await c.req.json().catch(() => ({})))
    if ('error' in r) return fail(c, 400, r.error, undefined, r.fields)
    const out = await createBatch(db, u.companyId, u.userId, r.opts)
    if ('error' in out) return fail(c, 400, out.error as string, 'NOTHING_TO_BILL')
    audit.log({
      req: c, action: audit.ACTIONS.CREATE, entity: 'route_billing_batch', entityId: out.batch.id, entityName: `${r.opts.from} to ${r.opts.to}`,
      userId: u.userId, companyId: u.companyId, metadata: { invoices: out.invoices.length, visits: out.batch.visitCount, groupBy: r.opts.groupBy },
    })
    return one(c, {
      ...out,
      message: `Made ${out.invoices.length} draft ${out.invoices.length === 1 ? 'invoice' : 'invoices'} for ${out.batch.visitCount} ${out.batch.visitCount === 1 ? 'visit' : 'visits'}. Review them, then send.`,
    }, 201)
  })

  app.get('/batches', requirePermission('invoices:read'), async (c) => listAll(c, await recentBatches(db, c.get('user').companyId)))

  // POST /batches/:id/undo — deletes the run's untouched drafts; anything sent or paid stays and is named
  app.post('/batches/:id/undo', requirePermission('invoices:delete'), async (c) => {
    const u = c.get('user')
    const out = await undoBatch(db, u.companyId, c.req.param('id'))
    if (out.status !== 200) return fail(c, out.status, out.error)
    audit.log({ req: c, action: audit.ACTIONS.DELETE, entity: 'route_billing_batch', entityId: c.req.param('id'), entityName: 'batch undone', userId: u.userId, companyId: u.companyId, metadata: { removed: out.removed, kept: out.kept.length } })
    return one(c, {
      removed: out.removed, kept: out.kept, undone: out.undone,
      message: out.kept.length
        ? `Removed ${out.removed} draft ${out.removed === 1 ? 'invoice' : 'invoices'}. ${out.kept.length} could not be removed because ${out.kept.length === 1 ? 'it has' : 'they have'} been sent or paid: ${out.kept.map((k) => k.number).join(', ')}.`
        : `Removed ${out.removed} draft ${out.removed === 1 ? 'invoice' : 'invoices'}. Those visits can be billed again.`,
    })
  })

  // POST /visits/:jobId — bill one completed visit now
  app.post('/visits/:jobId', requirePermission('invoices:create'), async (c) => {
    const u = c.get('user')
    const out = await billVisit(db, u.companyId, c.req.param('jobId'))
    if (out.status !== 201) return fail(c, out.status, out.error, out.status === 409 ? 'ALREADY_BILLED' : undefined)
    audit.log({ req: c, action: audit.ACTIONS.CREATE, entity: 'invoice', entityId: out.invoice.id, entityName: out.invoice.number, userId: u.userId, companyId: u.companyId, metadata: { source: 'route_visit', jobId: c.req.param('jobId') } })
    return one(c, out.invoice, 201)
  })

  return app
}

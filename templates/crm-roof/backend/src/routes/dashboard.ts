// Home figures for a roofing company, in roofing's own words. (T59)
//
// The mobile app's roofing dashboard asked GET /api/dashboard/stats and this template had no such
// route, so the request 404'd and the roofing home screen showed no cards at all. The shared jobs-family
// dashboard does not fit: a roofing job has no scheduled_date or completed_at, there is no project table,
// quotes have no number and invoices no amount_refunded — mounting it would print zeros it never measured.
// So these are counted from the columns a roofing job actually has:
//
//   inspectionsToday / installsToday   jobs whose inspection_date / install_date fall on the company's
//                                      own calendar day (its time zone, not the server's)
//   open                               the pipeline still running: every stage short of `collected`
//   inProduction                       on the roof now
//   quotes.pending                     draft or sent, not yet approved or declined
//   invoices.outstandingValue          the balance still owed on issued invoices — ONLY for a caller who
//                                      may read invoices; the key is absent otherwise, as on every
//                                      other dashboard (a "$0" card is a wrong figure, not a hidden one)
//   newLeads                           Lead Inbox rows at `new`, where the inbox is on and the caller
//                                      may open it — the same rule as the jobs-family dashboard
import { Hono } from 'hono'
import { and, eq, gte, lt, count, sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { contact, job, quote, invoice, lead } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { hasPermission, getExtraPermissions } from '../middleware/permissions.ts'
import { enabledFeaturesFor } from '../middleware/enabledFeature.ts'
import { companyTimeZone, storeDayRange } from '../shared/index.ts'

const app = new Hono()
app.use('*', authenticate)

const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => { try { return await fn() } catch { return fallback } }
/** May this caller hold `permission`? A lookup that throws answers yes, so an owner is never shown less. */
const may = async (u: any, permission: string) => {
  try { return await hasPermission(u?.role, permission, await getExtraPermissions(u?.userId)) } catch { return true }
}
const n = (rows: any[]) => Number(rows?.[0]?.value ?? 0)

app.get('/stats', async (c) => {
  const u = c.get('user') as any
  const companyId = u.companyId
  const tz = await companyTimeZone(db, companyId)
  const { start, end } = storeDayRange(tz)
  const open = sql`${job.status} NOT IN ('collected', 'lost')`

  const [contacts, inspectionsToday, installsToday, openJobs, inProduction, pendingQuotes] = await Promise.all([
    safe(() => db.select({ value: count() }).from(contact).where(eq(contact.companyId, companyId)), [{ value: 0 }]),
    safe(() => db.select({ value: count() }).from(job).where(and(eq(job.companyId, companyId), gte(job.inspectionDate, start), lt(job.inspectionDate, end))), [{ value: 0 }]),
    safe(() => db.select({ value: count() }).from(job).where(and(eq(job.companyId, companyId), gte(job.installDate, start), lt(job.installDate, end))), [{ value: 0 }]),
    safe(() => db.select({ value: count() }).from(job).where(and(eq(job.companyId, companyId), open)), [{ value: 0 }]),
    safe(() => db.select({ value: count() }).from(job).where(and(eq(job.companyId, companyId), eq(job.status, 'in_production'))), [{ value: 0 }]),
    safe(() => db.select({ value: count() }).from(quote).where(and(eq(quote.companyId, companyId), sql`${quote.status} IN ('draft', 'sent')`)), [{ value: 0 }]),
  ])

  let invoices: { outstanding: number; outstandingValue: number } | undefined
  if (await may(u, 'invoices:read')) {
    const [row] = await safe(() => db.select({
      outstanding: count(),
      outstandingValue: sql<string>`COALESCE(SUM(${invoice.balance}::numeric), 0)`,
    }).from(invoice).where(and(eq(invoice.companyId, companyId), sql`${invoice.status} NOT IN ('draft', 'void', 'paid')`, sql`${invoice.balance}::numeric > 0`)), [{ outstanding: 0, outstandingValue: '0' }] as any[])
    invoices = { outstanding: Number(row?.outstanding ?? 0), outstandingValue: Math.round(Number(row?.outstandingValue ?? 0) * 100) / 100 }
  }

  let newLeads: number | undefined
  if (await may(u, 'contacts:read')) {
    const features = await safe(() => enabledFeaturesFor(companyId), [] as string[])
    if (features.includes('lead_inbox')) {
      newLeads = n(await safe(() => db.select({ value: count() }).from(lead).where(and(eq(lead.companyId, companyId), eq(lead.status, 'new'))), [{ value: 0 }]))
    }
  }

  return c.json({
    contacts: n(contacts),
    ...(newLeads === undefined ? {} : { newLeads }),
    jobs: { open: n(openJobs), inProduction: n(inProduction), inspectionsToday: n(inspectionsToday), installsToday: n(installsToday) },
    quotes: { pending: n(pendingQuotes) },
    ...(invoices ? { invoices } : {}),
  })
})

export default app

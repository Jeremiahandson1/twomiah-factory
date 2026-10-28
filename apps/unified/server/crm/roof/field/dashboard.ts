// Roofing's home figures, GET /api/dashboard/stats, in roofing's own words (T59). What /api/dashboard answers for the
// roof vertical in place of the jobs dashboard (server/modules/crm.ts chooses by CrmSettings.dashboard). Moved from
// templates/crm-roof/backend/src/routes/dashboard.ts. The registry signs the person in and applies the 'dashboard' gate.
//
// Counted from the columns a roofing job has (a roofing job has no scheduled_date or completed_at, so the jobs
// dashboard would print zeros it never measured):
//   inspectionsToday / installsToday   jobs whose inspection_date / install_date fall on the company's own calendar day
//                                      (its time zone, not the server's)
//   open                               the pipeline still running: not collected, and not closed as lost or cancelled
//   inProduction                       on the roof now
//   quotes.pending                     draft or sent
//   invoices                           the balance still owed on issued invoices — ONLY for a caller who may read
//                                      invoices (invoices:read, T41); the key is absent otherwise, never "$0" (T42)
//   newLeads                           the enquiries nobody has acted on (tenant-backend reporting/newLeads.ts), for a
//                                      caller who may open contacts (contacts:read) — the jobs dashboard's rule
// No job's money is read here: the figures are counts, and the one sum is invoices:read's (the one money rule,
// jobMoneyWithheld, would withhold nothing more — no job field is returned).
//
// Changes from the template:
//   · a job closed as CANCELLED is not open. The template's "open" left out collected and lost only; cancelled — the
//     other way a job ends unpaid (roofing's close, validation.ts TERMINAL_STATUSES) — was counted as still running;
//   · the balance owed is the CRM's invoice balance (invoiceBalance: total less what was paid, net of refunds), where
//     roofing's invoice kept a `balance` column; the same invoices count (issued: not draft, void or paid; something owed).
import { Hono } from 'hono'
import { and, count, eq, inArray, notInArray } from 'drizzle-orm'
import { companyTimeZone, invoiceBalance, countNewLeads, listNewLeads, pendingQuoteCondition, openInvoiceCondition } from '@twomiah/tenant-backend'
import { contact, invoice, job, lead, quote } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { one, fail } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { canSeeWith } from '../../deps.ts'
import { inspectionsTodayCondition, installsTodayCondition, openJobCondition } from '../tiles.ts'
import { ownJobsWhere } from '../../ownWork.ts'

export function createRoofDashboardRoutes(d: CrmDeps) {
  const { db } = d
  const canSee = canSeeWith(d.permissions)
  const app = new Hono<AppEnv>()

  const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => { try { return await fn() } catch { return fallback } }
  /** May this caller hold `permission`? A lookup that throws answers yes, so an owner is never shown less. */
  const may = async (u: any, permission: string) => { try { return !!(await canSee(u?.role, permission, u?.userId)) } catch { return true } }
  const n = (rows: any[]) => Number(rows?.[0]?.value ?? 0)
  const r2 = (v: number) => Math.round(v * 100) / 100

  // The rows the count counts, as one list (tenant-backend reporting/newLeads.ts) — the jobs dashboard's GET /new-leads.
  app.get('/new-leads', async (c) => {
    const u = c.get('user')
    // The Lead Inbox's own permission (leads:read), as the jobs dashboard's (live role check, 2026-10-23).
    if (!(await may(u, 'leads:read'))) return fail(c, 403, 'Permission denied', 'forbidden')
    const features = await safe(() => d.features.enabledFeaturesFor(u.companyId), [] as string[])
    const limit = Number(c.req.query('limit')) || undefined
    return one(c, await listNewLeads(db, { lead, contact, quote, job, invoice }, u.companyId, { inbox: features.includes('lead_inbox'), limit }))
  })

  app.get('/stats', async (c) => {
    const u = c.get('user')
    const companyId = u.companyId
    const tz = await companyTimeZone(db, companyId)
    // A seat without jobs:read-all lists only its own jobs (jobs.ts ownScope), so it counts only those: the tile opens
    // GET /api/jobs?tile=…, and the number is the rows.
    let own: any = undefined
    try { own = (await canSee(u.role, 'jobs:read-all', u.userId)) ? undefined : ownJobsWhere(db, String(u.userId)) } catch { own = ownJobsWhere(db, String(u.userId)) }
    const mine = and(eq(job.companyId, companyId), own)

    const [contacts, inspectionsToday, installsToday, openJobs, inProduction, pendingQuotes, byStatusRows] = await Promise.all([
      safe(() => db.select({ value: count() }).from(contact).where(eq(contact.companyId, companyId)), [{ value: 0 }]),
      safe(() => db.select({ value: count() }).from(job).where(and(mine, inspectionsTodayCondition(tz))), [{ value: 0 }]),
      safe(() => db.select({ value: count() }).from(job).where(and(mine, installsTodayCondition(tz))), [{ value: 0 }]),
      safe(() => db.select({ value: count() }).from(job).where(and(mine, openJobCondition())), [{ value: 0 }]),
      safe(() => db.select({ value: count() }).from(job).where(and(mine, eq(job.status, 'in_production'))), [{ value: 0 }]),
      safe(() => db.select({ value: count() }).from(quote).where(and(eq(quote.companyId, companyId), pendingQuoteCondition(quote))), [{ value: 0 }]),
      // The pipeline board: one count per stage. Each stage opens GET /api/jobs?status=<stage>.
      safe(() => db.select({ status: job.status, c: count() }).from(job).where(mine).groupBy(job.status), [] as any[]),
    ])

    let invoices: { outstanding: number; outstandingValue: number } | undefined
    if (await may(u, 'invoices:read')) {
      // Open = issued and not settled — the one condition (tenant-backend reporting/tileConditions.ts) the Open invoices list
      // uses (GET /api/invoices?tile=open). It said "not draft / void / paid, with a balance" before; the same rows, bar an
      // open invoice with nothing owing, which the list could not have filtered.
      const rows = await safe(() => db.select({ status: invoice.status, total: invoice.total, amountPaid: invoice.amountPaid, amountRefunded: invoice.amountRefunded })
        .from(invoice).where(and(eq(invoice.companyId, companyId), openInvoiceCondition(invoice))), [] as any[])
      const owed = rows.map((inv: any) => invoiceBalance(inv))
      invoices = { outstanding: owed.length, outstandingValue: r2(owed.reduce((s: number, b: number) => s + b, 0)) }
    }

    // The jobs dashboard's count (tenant-backend reporting/newLeads.ts): unanswered inbox enquiries and the lead contacts
    // nobody has acted on yet — one rule for every dashboard that shows the tile.
    let leads: Awaited<ReturnType<typeof countNewLeads>> | null = null
    if (await may(u, 'leads:read')) {
      const features = await safe(() => d.features.enabledFeaturesFor(companyId), [] as string[])
      leads = await safe(() => countNewLeads(db, { lead, contact, quote, job, invoice }, companyId, { inbox: features.includes('lead_inbox') }), null)
    }

    return one(c, {
      contacts: n(contacts),
      ...(leads ? { newLeads: leads.total, newLeadsFrom: { inbox: leads.inbox, contacts: leads.contacts } } : {}),
      jobs: { open: n(openJobs), inProduction: n(inProduction), inspectionsToday: n(inspectionsToday), installsToday: n(installsToday), byStatus: Object.fromEntries(byStatusRows.map((r: any) => [r.status, Number(r.c)])) },
      quotes: { pending: n(pendingQuotes) },
      ...(invoices ? { invoices } : {}),
    })
  })

  return app
}

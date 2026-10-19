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
//   newLeads                           Lead Inbox rows at `new`, where the inbox is on and the caller may open it
//                                      (contacts:read) — the jobs dashboard's rule
// No job's money is read here: the figures are counts, and the one sum is invoices:read's (the one money rule,
// jobMoneyWithheld, would withhold nothing more — no job field is returned).
//
// Changes from the template:
//   · a job closed as CANCELLED is not open. The template's "open" left out collected and lost only; cancelled — the
//     other way a job ends unpaid (roofing's close, validation.ts TERMINAL_STATUSES) — was counted as still running;
//   · the balance owed is the CRM's invoice balance (invoiceBalance: total less what was paid, net of refunds), where
//     roofing's invoice kept a `balance` column; the same invoices count (issued: not draft, void or paid; something owed).
import { Hono } from 'hono'
import { and, count, eq, gte, inArray, lt, notInArray } from 'drizzle-orm'
import { companyTimeZone, invoiceBalance, storeDayRange } from '@twomiah/tenant-backend'
import { contact, invoice, job, lead, quote } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { canSeeWith } from '../../deps.ts'
import { TERMINAL_STATUSES } from '../validation.ts'

const NOT_OPEN = ['collected', ...TERMINAL_STATUSES]

export function createRoofDashboardRoutes(d: CrmDeps) {
  const { db } = d
  const canSee = canSeeWith(d.permissions)
  const app = new Hono<AppEnv>()

  const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => { try { return await fn() } catch { return fallback } }
  /** May this caller hold `permission`? A lookup that throws answers yes, so an owner is never shown less. */
  const may = async (u: any, permission: string) => { try { return !!(await canSee(u?.role, permission, u?.userId)) } catch { return true } }
  const n = (rows: any[]) => Number(rows?.[0]?.value ?? 0)
  const r2 = (v: number) => Math.round(v * 100) / 100

  app.get('/stats', async (c) => {
    const u = c.get('user')
    const companyId = u.companyId
    const tz = await companyTimeZone(db, companyId)
    const { start, end } = storeDayRange(tz)
    const mine = eq(job.companyId, companyId)

    const [contacts, inspectionsToday, installsToday, openJobs, inProduction, pendingQuotes] = await Promise.all([
      safe(() => db.select({ value: count() }).from(contact).where(eq(contact.companyId, companyId)), [{ value: 0 }]),
      safe(() => db.select({ value: count() }).from(job).where(and(mine, gte(job.inspectionDate, start), lt(job.inspectionDate, end))), [{ value: 0 }]),
      safe(() => db.select({ value: count() }).from(job).where(and(mine, gte(job.installDate, start), lt(job.installDate, end))), [{ value: 0 }]),
      safe(() => db.select({ value: count() }).from(job).where(and(mine, notInArray(job.status, NOT_OPEN))), [{ value: 0 }]),
      safe(() => db.select({ value: count() }).from(job).where(and(mine, eq(job.status, 'in_production'))), [{ value: 0 }]),
      safe(() => db.select({ value: count() }).from(quote).where(and(eq(quote.companyId, companyId), inArray(quote.status, ['draft', 'sent']))), [{ value: 0 }]),
    ])

    let invoices: { outstanding: number; outstandingValue: number } | undefined
    if (await may(u, 'invoices:read')) {
      const rows = await safe(() => db.select({ status: invoice.status, total: invoice.total, amountPaid: invoice.amountPaid, amountRefunded: invoice.amountRefunded })
        .from(invoice).where(and(eq(invoice.companyId, companyId), notInArray(invoice.status, ['draft', 'void', 'paid']))), [] as any[])
      const owed = rows.map((inv: any) => invoiceBalance(inv)).filter((b: number) => b > 0)
      invoices = { outstanding: owed.length, outstandingValue: r2(owed.reduce((s: number, b: number) => s + b, 0)) }
    }

    let newLeads: number | undefined
    if (await may(u, 'contacts:read')) {
      const features = await safe(() => d.features.enabledFeaturesFor(companyId), [] as string[])
      if (features.includes('lead_inbox')) {
        newLeads = n(await safe(() => db.select({ value: count() }).from(lead).where(and(eq(lead.companyId, companyId), eq(lead.status, 'new'))), [{ value: 0 }]))
      }
    }

    return one(c, {
      contacts: n(contacts),
      ...(newLeads === undefined ? {} : { newLeads }),
      jobs: { open: n(openJobs), inProduction: n(inProduction), inspectionsToday: n(inspectionsToday), installsToday: n(installsToday) },
      quotes: { pending: n(pendingQuotes) },
      ...(invoices ? { invoices } : {}),
    })
  })

  return app
}

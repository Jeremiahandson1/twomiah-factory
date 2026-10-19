// Accounting sync: the dealership's own real, unposted invoices waiting to go to the books (QuickBooks Online is the
// bridge). The ledger is invoices:read, as the invoice routes are (T41). Moved from
// templates/crm-rv/backend/src/routes/accounting.ts.
import { Hono } from 'hono'
import { and, eq, isNull, isNotNull, inArray, desc, count } from 'drizzle-orm'
import { invoice, contact } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

// Invoice statuses that are real, postable revenue (not drafts or void).
const POSTABLE = ['sent', 'partial', 'paid', 'overdue']

export function createAccountingRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  async function isConnected(companyId: string): Promise<boolean> {
    try { const qb: any = await d.services.quickbooks.getConnectionStatus(companyId); return !!qb?.connected } catch { return false }
  }

  app.get('/status', requirePermission('invoices:read'), async (c) => {
    const u = c.get('user')
    const connected = await isConnected(u.companyId)
    const configured = !!(process.env.QBO_CLIENT_ID && process.env.QBO_REDIRECT_URI)
    // Pending = the tenant's OWN real, postable invoices not yet synced to the books. No demo data.
    const rows = await db.select({ number: invoice.number, total: invoice.total, createdAt: invoice.createdAt, customer: contact.name })
      .from(invoice).leftJoin(contact, eq(invoice.contactId, contact.id))
      .where(and(eq(invoice.companyId, u.companyId), isNull(invoice.qbInvoiceId), inArray(invoice.status, POSTABLE)))
      .orderBy(desc(invoice.createdAt)).limit(100)
    const pending = rows.map((r: any) => ({ type: 'Invoice', ref: r.number, customer: r.customer || '—', amount: Number(r.total) || 0, date: r.createdAt, posted: false }))
    const [{ value: postedCount }] = await db.select({ value: count() }).from(invoice)
      .where(and(eq(invoice.companyId, u.companyId), isNotNull(invoice.qbInvoiceId)))
    return one(c, { provider: 'QuickBooks Online', connected, configured, pending, postedCount: Number(postedCount) })
  })

  // Posting needs a real connection — a synced batch is never made up.
  app.post('/sync', requirePermission('integrations:update'), async (c) => {
    const u = c.get('user')
    if (!(await isConnected(u.companyId))) return fail(c, 400, 'Connect QuickBooks before posting to your books.')
    return fail(c, 400, 'Posting to QuickBooks will be available as soon as the connection is finished.')
  })

  return app
}

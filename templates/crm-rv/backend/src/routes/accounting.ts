import { Hono } from 'hono'
import { and, eq, isNull, isNotNull, inArray, desc, count } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { invoice, contact } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import quickbooks from '../services/quickbooks.ts'

// ── Accounting sync ─────────────────────────────────────────────────────────
// Post the dealership's real unposted invoices to the GL. QuickBooks Online is the
// bridge (connected:false until OAuth); native GL later. "Pending" is the tenant's
// OWN invoices not yet synced — never a hardcoded demo set (a fabricated $32,371 of
// fake deals used to show under the "Not connected" banner on every tenant).
const app = new Hono()
app.use('*', authenticate)

// Invoice statuses that represent real, postable revenue (not drafts/void).
const POSTABLE = ['sent', 'partial', 'paid', 'overdue']

async function isConnected(companyId: string): Promise<boolean> {
  try { const qb: any = await quickbooks.getConnectionStatus(companyId); return !!qb?.connected } catch { return false }
}

/**
 * `invoices:read` — this is the INVOICE LEDGER, not a connection status. (T41)
 *
 * It was `authenticate` alone, and T41 read the whole thing as the staff seat:
 *
 *   "Staff can read the whole ledger: /crm/accounting shows 64 entries, $29,065, each invoice with
 *    customer and amount (GET /api/accounting/status 200), plus Connect and Sync to QuickBooks
 *    buttons. /api/invoices is correctly 403."
 *
 * That last sentence is the whole argument: the invoice routes already refuse this seat, and this
 * endpoint handed over the same invoices — number, customer and amount — by a different door. The
 * same permission the invoice routes ask for, so the two now agree.
 *
 * POST /sync below already required integrations:update, so the write was never the hole.
 */
app.get('/status', requirePermission('invoices:read'), async (c) => {
  const u = c.get('user') as any
  const connected = await isConnected(u.companyId)
  const configured = !!(process.env.QBO_CLIENT_ID && process.env.QBO_REDIRECT_URI)
  // Pending = the tenant's OWN real, postable invoices not yet synced to the books. No demo data.
  const rows = await db.select({ number: invoice.number, total: invoice.total, createdAt: invoice.createdAt, customer: contact.name })
    .from(invoice).leftJoin(contact, eq(invoice.contactId, contact.id))
    .where(and(eq(invoice.companyId, u.companyId), isNull(invoice.qbInvoiceId), inArray(invoice.status, POSTABLE)))
    .orderBy(desc(invoice.createdAt)).limit(100)
  const pending = rows.map((r) => ({ type: 'Invoice', ref: r.number, customer: r.customer || '—', amount: Number(r.total) || 0, date: r.createdAt, posted: false }))
  const [{ value: postedCount }] = await db.select({ value: count() }).from(invoice)
    .where(and(eq(invoice.companyId, u.companyId), isNotNull(invoice.qbInvoiceId)))
  return c.json({ provider: 'QuickBooks Online', connected, configured, pending, postedCount: Number(postedCount) })
})

app.post('/sync', requirePermission('integrations:update'), async (c) => {
  const u = c.get('user') as any
  // Posting requires a real connection — never fabricate a synced batch. Once QuickBooks OAuth is wired,
  // this posts the real pending invoices and stamps qbInvoiceId/syncedAt on each.
  if (!(await isConnected(u.companyId))) return c.json({ error: 'Connect QuickBooks before posting to your books.' }, 400)
  return c.json({ error: 'Posting to QuickBooks will be available as soon as the connection is finished.' }, 400)
})

export default app

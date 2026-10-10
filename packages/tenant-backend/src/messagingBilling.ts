// Texting / AI usage billing, read-only in the tenant — the Factory owns the wallet and Stripe.
//
// Mounted at /api/messaging-billing in every CRM (routes/messagingBilling.ts glue adds auth):
//   GET /status       → { configured, enabled, aiEnabled, walletCents, enableMonthlyCents, ledger }
//                       Any signed-in user may read it: the send screens use it to warn BEFORE a text
//                       goes out that the wallet is empty (a failed send used to be reported as "sent").
//   GET /portal-link  → { url } — signed link to the Factory's hosted texting-billing page (enable,
//                       add funds, ledger). Admin/owner only (glue).
// Auth to the Factory is the tenant's own sync key; the browser never sees it.
import { Hono } from 'hono'

function cfg() {
  return { url: process.env.FACTORY_URL, key: process.env.FACTORY_SYNC_KEY, tenantId: process.env.TENANT_ID }
}

export interface MessagingBillingStatus {
  configured: boolean
  enabled: boolean
  aiEnabled: boolean
  walletCents: number
  enableMonthlyCents: number | null
  aiEnableMonthlyCents: number | null
  ledger: any[]
  error?: string
}

export async function fetchMessagingBillingStatus(): Promise<MessagingBillingStatus> {
  const { url, key, tenantId } = cfg()
  const none: MessagingBillingStatus = { configured: false, enabled: false, aiEnabled: false, walletCents: 0, enableMonthlyCents: null, aiEnableMonthlyCents: null, ledger: [] }
  if (!url || !key || !tenantId) return none
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/api/v1/factory/internal/messaging/self/${tenantId}`, {
      headers: { 'X-Factory-Key': key }, signal: AbortSignal.timeout(10_000),
    })
    const d: any = await r.json().catch(() => ({}))
    if (!r.ok) return { ...none, configured: true, error: d?.error || `Factory HTTP ${r.status}` }
    return {
      configured: true,
      enabled: !!d.enabled,
      aiEnabled: !!d.aiEnabled,
      walletCents: Number(d.walletCents) || 0,
      enableMonthlyCents: typeof d.enableMonthlyCents === 'number' ? d.enableMonthlyCents : null,
      aiEnableMonthlyCents: typeof d.aiEnableMonthlyCents === 'number' ? d.aiEnableMonthlyCents : null,
      ledger: Array.isArray(d.ledger) ? d.ledger.slice(0, 20) : [],
    }
  } catch (e: any) {
    return { ...none, configured: true, error: e?.message || 'Factory unreachable' }
  }
}

/**
 * WHO MAY READ THE WALLET. (T63: "/messaging-billing/status still returns the wallet balance" to staff.)
 *
 * The balance, the ledger and the monthly charges are the bill, and the bill stays with whoever settles it —
 * company:update, the line GET /api/company already draws (check-billing-visibility). Everyone else is told what a
 * send screen needs: is texting configured, is it on, and is the wallet empty. Not wired → the full status, so an
 * un-rewired template is unchanged.
 */
export interface MessagingBillingOptions { mayReadWallet?: (c: any) => Promise<boolean> }

export function createMessagingBillingRoutes(opts: MessagingBillingOptions = {}): Hono {
  const app = new Hono()

  app.get('/status', async (c) => {
    const s = await fetchMessagingBillingStatus()
    if (!opts.mayReadWallet || await opts.mayReadWallet(c).catch(() => false)) return c.json({ ...s, walletEmpty: s.walletCents <= 0 })
    return c.json({ configured: s.configured, enabled: s.enabled, aiEnabled: s.aiEnabled, walletEmpty: s.walletCents <= 0, ...(s.error ? { error: 'Billing service unavailable' } : {}) })
  })

  app.get('/portal-link', async (c) => {
    const { url, key, tenantId } = cfg()
    if (!url || !key || !tenantId) return c.json({ error: 'Billing not configured' }, 503)
    try {
      const r = await fetch(`${url.replace(/\/$/, '')}/api/v1/factory/internal/messaging/self/${tenantId}/portal`, {
        method: 'POST', headers: { 'X-Factory-Key': key }, signal: AbortSignal.timeout(10_000),
      })
      const d: any = await r.json().catch(() => ({}))
      if (!r.ok || !d.url) return c.json({ error: d.error || 'Failed to create billing link' }, 502)
      return c.json({ url: d.url })
    } catch { return c.json({ error: 'Billing service unavailable' }, 502) }
  })

  return app
}

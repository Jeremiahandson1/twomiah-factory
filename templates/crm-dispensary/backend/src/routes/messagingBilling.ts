import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

// Mint a signed self-serve billing-portal link (proxies to the Twomiah factory).
const app = new Hono()

app.get('/portal-link', authenticate, async (c) => {
  const url = process.env.FACTORY_URL, key = process.env.FACTORY_SYNC_KEY, tenantId = process.env.TENANT_ID
  if (!url || !key || !tenantId) return c.json({ error: 'Billing not configured' }, 503)
  try {
    const r = await fetch(`${url}/api/v1/factory/internal/messaging/self/${tenantId}/portal`, {
      method: 'POST', headers: { 'X-Factory-Key': key }, signal: AbortSignal.timeout(10000),
    })
    const d: any = await r.json().catch(() => ({}))
    // The factory refusing this tenant's key (401/403) or not knowing it (404) is a
    // configuration state of THIS tenant, not a gateway fault — report it as a handled 4xx
    // (424 Failed Dependency) so monitoring doesn't see a 5xx on an auth condition. (QA F-10)
    if (r.status === 401 || r.status === 403 || r.status === 404) {
      return c.json({ error: 'Messaging billing portal is not available for this tenant', code: 'billing_portal_unavailable', upstreamStatus: r.status }, 424)
    }
    if (!r.ok || !d.url) return c.json({ error: d.error || 'Failed to create billing link' }, 502)
    return c.json({ url: d.url })
  } catch { return c.json({ error: 'Billing service unavailable' }, 502) }
})

export default app

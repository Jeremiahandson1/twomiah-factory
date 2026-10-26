// "I already have a Stripe account — link it" (services/stripeConnectOAuth.ts has the why and the security model).
//   GET  /customers/:id/stripe-oauth              the business's app: is linking offered? (X-Factory-Key)
//   POST /customers/:id/stripe-oauth/start        the business's app, for an owner/admin who pressed the button (X-Factory-Key)
//   POST /customers/:id/stripe-oauth/deauthorize  the business's app, on Disconnect of a linked account (X-Factory-Key)
//   GET  /stripe/oauth/callback                   Stripe's redirect — the ONE redirect URI registered with Stripe
// Only a unified business is offered it: its app has the /api/internal/stripe-link door the account is handed to.
import { supabase } from '../../middleware/auth'
import { type FactoryApp, checkFactoryKey, UUID_RE, parseJsonBody, logTenantAudit } from './shared'
import { mayReturnTo, ourUnifiedOrigin } from '../../services/premiumSiteUrl'
import {
  stripeOAuthConfig, signState, authorizeUrl, createStateLedger, handleCallback, deauthorizeAccount, type CallbackTenant,
} from '../../services/stripeConnectOAuth'

const ledger = createStateLedger()
const TENANT_COLUMNS = 'id, slug, engine, website_url, domain, render_backend_url, factory_sync_key, stripe_connect_account_id'

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))
const page = (message: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stripe</title></head><body style="font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;color:#111;background:#fff"><p>${escapeHtml(message)}</p></body></html>`

export function registerStripeOAuthRoutes(factory: FactoryApp) {
  /** The tenant behind an X-Factory-Key call, or the refusal to answer with. */
  const tenantFor = async (c: any): Promise<{ tenant: any } | { error: Response }> => {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return { error: c.json({ error: 'Invalid tenant ID' }, 400) }
    const { data: tenant, error } = await supabase.from('tenants').select(TENANT_COLUMNS).eq('id', tenantId).single()
    if (error && error.code !== 'PGRST116') { console.error('[StripeOAuth] tenant lookup failed:', error.message); return { error: c.json({ error: 'Lookup failed' }, 500) } }
    if (!tenant || !checkFactoryKey(c, tenant)) return { error: c.json({ error: 'Unauthorized' }, 401) }
    return { tenant }
  }

  factory.get('/customers/:id/stripe-oauth', async (c) => {
    const r = await tenantFor(c)
    if ('error' in r) return r.error
    return c.json({ available: !!stripeOAuthConfig() && !!ourUnifiedOrigin(r.tenant) })
  })

  factory.post('/customers/:id/stripe-oauth/start', async (c) => {
    const r = await tenantFor(c)
    if ('error' in r) return r.error
    const cfg = stripeOAuthConfig()
    if (!cfg || !ourUnifiedOrigin(r.tenant)) return c.json({ error: 'Linking an existing Stripe account is not available yet.' }, 503)
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const { nonce, userId, returnUrl } = parsed.data
    if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(nonce)) return c.json({ error: 'nonce is required' }, 400)
    if (typeof userId !== 'string' || !userId || userId.length > 100) return c.json({ error: 'userId is required' }, 400)
    // Back only to the business's own app — an exact origin (the same rule as the Google sign-ins), never a prefix.
    if (typeof returnUrl !== 'string' || !mayReturnTo(r.tenant, returnUrl)) return c.json({ error: 'returnUrl must point to your own app' }, 400)
    const state = signState({ t: r.tenant.id, u: userId, n: nonce, r: returnUrl }, cfg.stateSecret)
    return c.json({ url: authorizeUrl(cfg, state) })
  })

  factory.post('/customers/:id/stripe-oauth/deauthorize', async (c) => {
    const r = await tenantFor(c)
    if ('error' in r) return r.error
    const cfg = stripeOAuthConfig()
    if (!cfg) return c.json({ error: 'Stripe linking is not configured' }, 503)
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const accountId = String(parsed.data.accountId || '')
    if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) return c.json({ error: 'accountId must be a Stripe account id' }, 400)
    // Only the account the Factory recorded for THIS business: one business's key cannot cut another's connection.
    if (r.tenant.stripe_connect_account_id !== accountId) return c.json({ error: 'That account is not the one linked to this business' }, 409)
    const result = await deauthorizeAccount(accountId, cfg)
    if (!result.ok) { console.warn('[StripeOAuth] deauthorize failed:', r.tenant.slug, result.detail); return c.json({ error: 'Stripe did not confirm the disconnect' }, 502) }
    console.log('[StripeOAuth] deauthorized', r.tenant.slug)
    return c.json({ deauthorized: true })
  })

  factory.get('/stripe/oauth/callback', async (c) => {
    const cfg = stripeOAuthConfig()
    if (!cfg) return c.html(page('Linking an existing Stripe account is not available yet.'), 503)
    const result = await handleCallback(c.req.query(), {
      config: cfg,
      ledger,
      findTenant: async (id) => {
        if (!UUID_RE.test(id)) return null
        const { data } = await supabase.from('tenants').select(TENANT_COLUMNS).eq('id', id).maybeSingle()
        return (data as CallbackTenant) || null
      },
      deliver: async (tenant, body) => {
        // The tenant's key goes only to the service the Factory built for it (never to a stored website address).
        const origin = ourUnifiedOrigin(tenant)
        if (!origin || !tenant.factory_sync_key) return { ok: false, status: 0, error: 'not routable' }
        const res = await fetch(origin + '/api/internal/stripe-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Factory-Key': tenant.factory_sync_key },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20_000),
        })
        return { ok: res.ok, status: res.status }
      },
      record: async (tenantId, accountId) => {
        const { data: before } = await supabase.from('tenants').select('stripe_connect_account_id').eq('id', tenantId).maybeSingle()
        const { error } = await supabase.from('tenants').update({ stripe_connect_account_id: accountId }).eq('id', tenantId)
        if (error) throw new Error(error.message)
        await logTenantAudit(tenantId, 'stripe_connect', { stripe_connect_account_id: { old: before?.stripe_connect_account_id || null, new: accountId } }, 'tenant', 'Existing Stripe account linked (OAuth)')
      },
      log: (msg, meta) => console.log('[StripeOAuth]', msg, meta || ''),
    })
    if (result.kind === 'redirect') return c.redirect(result.location, 302)
    return c.html(page(result.message), result.status as any)
  })
}

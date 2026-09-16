/**
 * Stripe Connect webhook → tenant. A business that clicked "Connect Stripe" in its CRM collects on its
 * own connected account; Stripe delivers that account's events to the Factory's Connect endpoint
 * (billing.ts POST /stripe/connect-webhook), and this forwards each one to the tenant that owns the
 * account over the signed Factory→tenant channel (X-Factory-Key, the same as subscription sync),
 * where the tenant's shared Stripe module records it (POST /api/stripe/factory-event).
 *
 * The lookup is tenants.stripe_connect_account_id, registered by the tenant when it connects
 * (POST /customers/:id/stripe-connect). Injected deps keep this testable without Supabase or a tenant.
 */
export interface ConnectWebhookDeps {
  /** tenant row for a connected account id, or null */
  findTenantByAccount: (accountId: string) => Promise<{ id: string; slug: string; render_backend_url: string | null; factory_sync_key: string | null } | null>
  fetch?: typeof fetch
  timeoutMs?: number
}

export type ForwardResult =
  | { status: 'forwarded'; slug: string; tenantStatus: number }
  | { status: 'no_account' }
  | { status: 'unknown_account'; accountId: string }
  | { status: 'not_provisioned'; slug: string }
  | { status: 'tenant_error'; slug: string; tenantStatus: number; body?: string }
  | { status: 'unreachable'; slug: string; error: string }

export async function forwardConnectEvent(event: any, deps: ConnectWebhookDeps): Promise<ForwardResult> {
  const accountId: string | undefined = event?.account
  if (!accountId) return { status: 'no_account' }
  const tenant = await deps.findTenantByAccount(accountId)
  if (!tenant) return { status: 'unknown_account', accountId }
  if (!tenant.render_backend_url || !tenant.factory_sync_key) return { status: 'not_provisioned', slug: tenant.slug }
  const doFetch = deps.fetch || fetch
  try {
    const res = await doFetch(tenant.render_backend_url.replace(/\/$/, '') + '/api/stripe/factory-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Factory-Key': tenant.factory_sync_key },
      body: JSON.stringify({ event }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 20_000),
    })
    if (!res.ok) return { status: 'tenant_error', slug: tenant.slug, tenantStatus: res.status, body: (await res.text().catch(() => '')).slice(0, 300) }
    return { status: 'forwarded', slug: tenant.slug, tenantStatus: res.status }
  } catch (err: any) {
    return { status: 'unreachable', slug: tenant.slug, error: err?.message || String(err) }
  }
}

/**
 * HTTP status the Factory answers Stripe with. 2xx tells Stripe the event is done; anything else makes
 * Stripe retry (for ~3 days), which is what we want while a tenant is asleep or redeploying. An account
 * nobody registered is answered 200 so Stripe doesn't retry it forever — it is logged instead.
 */
export function responseStatusFor(result: ForwardResult): number {
  switch (result.status) {
    case 'forwarded': return 200
    case 'no_account': return 400
    case 'unknown_account': return 200
    case 'not_provisioned': return 503
    case 'tenant_error': return result.tenantStatus >= 500 ? 502 : 200
    case 'unreachable': return 502
  }
}

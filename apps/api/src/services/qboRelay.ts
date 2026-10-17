// QuickBooks Online relay — Intuit redirects every tenant's Connect QuickBooks to the Factory, and the Factory sends the
// browser on to the tenant that started it.
//
// Why: Intuit only redirects to URIs registered by hand in the Intuit developer app. Every tenant used to send its own
// (<tenant backend>/api/quickbooks/callback), so each new customer needed someone to add their URL in Intuit's portal
// before Connect worked — it silently failed for every new signup. Now every tenant sends the Factory's QuickBooks
// callback (quickbooksOnline.ts qboRedirectUri — the URI the Factory's own connection already uses) and names its own
// callback in the state (packages/tenant-backend/src/integrations/quickbooksState.ts).
//
// What the relay trusts, and what it does not:
//   • It cannot check the state's signature (each tenant signs with its own secret) — the tenant does that, and the
//     signature covers the return URL. The relay's job is to never be an open redirect: the return URL must be https,
//     carry no credentials, query or fragment, have EXACTLY a tenant QuickBooks callback path, and its origin must be a
//     known tenant backend (tenants.render_backend_url — read, never composed: hosts carry a vertical suffix).
//   • Anything else is a 400 — never a redirect.
//   • code, state, realmId, error and error_description are passed through unchanged, so the tenant sees exactly what
//     Intuit sent (and can exchange the code with the same redirect_uri it authorized with).
// A state that is not relay-shaped (the Factory's own connection uses a random UUID) is not the relay's: the callback
// handles it as the Factory's own.

/** The tenant callback paths the relay may send to: the shared module's, and the integrations-router path (crm-dispensary's, and the legacy one every shared CRM also mounts). */
export const TENANT_QBO_CALLBACK_PATHS: ReadonlySet<string> = new Set(['/api/quickbooks/callback', '/api/integrations/quickbooks/callback'])

/** Query keys passed through to the tenant, as Intuit sent them. */
export const RELAYED_PARAMS = ['code', 'state', 'realmId', 'error', 'error_description'] as const

export type RelayDecision =
  | { kind: 'not-relay' }
  | { kind: 'redirect'; location: string }
  | { kind: 'refuse'; reason: string }

/** The return URL a tenant put in its state, or undefined when the state is not relay-shaped (the Factory's own). */
export function relayReturnUrl(state: string | undefined | null): { relay: false } | { relay: true; returnUrl: unknown } {
  if (!state || typeof state !== 'string') return { relay: false }
  let parsed: any
  try { parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) } catch { return { relay: false } }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('returnUrl' in parsed)) return { relay: false }
  return { relay: true, returnUrl: parsed.returnUrl }
}

/** The origin (scheme://host[:port], lower-case) of a stored tenant backend URL; null when it is not a URL. */
export function backendOrigin(stored: string | null | undefined): string | null {
  if (!stored) return null
  try { return new URL(String(stored).trim()).origin.toLowerCase() } catch { return null }
}

/**
 * Decide what the Factory's QuickBooks callback does with this request.
 * isKnownTenantOrigin answers whether an origin is a tenant backend the Factory deployed.
 */
export async function qboRelayDecision(query: Record<string, string | undefined>, isKnownTenantOrigin: (origin: string) => Promise<boolean>): Promise<RelayDecision> {
  const shape = relayReturnUrl(query.state)
  if (!shape.relay) return { kind: 'not-relay' }
  const raw = shape.returnUrl
  if (typeof raw !== 'string' || !raw) return { kind: 'refuse', reason: 'state has no return URL' }
  let url: URL
  try { url = new URL(raw) } catch { return { kind: 'refuse', reason: 'return URL is not a URL' } }
  if (url.protocol !== 'https:') return { kind: 'refuse', reason: 'return URL is not https' }
  if (url.username || url.password) return { kind: 'refuse', reason: 'return URL carries credentials' }
  if (url.search || url.hash || raw.includes('?') || raw.includes('#')) return { kind: 'refuse', reason: 'return URL carries a query or fragment' }
  if (!TENANT_QBO_CALLBACK_PATHS.has(url.pathname)) return { kind: 'refuse', reason: 'return URL is not a QuickBooks callback' }
  const origin = url.origin.toLowerCase()
  let known = false
  try { known = await isKnownTenantOrigin(origin) } catch { known = false }
  if (!known) return { kind: 'refuse', reason: 'return URL is not a known tenant' }
  const out = new URLSearchParams()
  for (const k of RELAYED_PARAMS) {
    const v = query[k]
    if (typeof v === 'string') out.set(k, v)
  }
  return { kind: 'redirect', location: `${origin}${url.pathname}?${out.toString()}` }
}

/**
 * isKnownTenantOrigin backed by the tenants table: an exact match on render_backend_url (with or without a trailing
 * slash). One indexed-size query per Connect click — rare enough that a cache would only add a window in which a
 * torn-down tenant's host stayed trusted.
 */
export function tenantOriginLookup(supabase: any): (origin: string) => Promise<boolean> {
  return async (origin: string) => {
    const { data, error } = await supabase.from('tenants').select('render_backend_url').in('render_backend_url', [origin, origin + '/']).limit(5)
    if (error || !Array.isArray(data)) return false
    return data.some((r: any) => backendOrigin(r?.render_backend_url) === origin)
  }
}

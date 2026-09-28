/**
 * The storefront's two calls into crm-store: the loyalty quote and hosted checkout.
 *
 * Deliberately framework-free — no Hono, no Request/Response, nothing that needs a web server. Two
 * reasons. server-static.ts calls serve() and starts backups and migrations the moment it is
 * imported, so nothing living inside it can be tested at all; and a proxy's rules are about what to
 * forward and what to do when the other end misbehaves, which has nothing to do with HTTP plumbing.
 * server-static.ts adapts these into routes in three lines.
 *
 * The rule running through all of it: a rewards lookup is a nicety, a cart is a purchase. Every
 * failure path here has to leave the customer able to buy.
 */

export interface StoreApiDeps {
  /** The crm-store backend, trailing slash optional. Empty means "not connected yet". */
  crmStoreApiUrl: string
  /** Injected so a test can stub it; defaults to the global. */
  fetchImpl?: typeof fetch
}

export interface LoyaltyQuote {
  pointsBalance: number
  punchCard: { enabled: boolean; visitsRequired: number; progress: number; remaining: number; unclaimed: number }
  rewards: unknown[]
}

/** What a shopper is told when the quote cannot be answered. Never an error — see above. */
export const EMPTY_QUOTE: LoyaltyQuote = {
  pointsBalance: 0,
  punchCard: { enabled: false, visitsRequired: 0, progress: 0, remaining: 0, unclaimed: 0 },
  rewards: [],
}

const base = (url: string) => (url || '').replace(/\/+$/, '')

/**
 * What this shopper can claim against the cart they are holding.
 *
 * Answers EMPTY_QUOTE rather than throwing on every failure — no crm-store configured, no email, an
 * upstream error, a timeout, a non-JSON reply. The cart hides the panel and carries on.
 */
export async function fetchLoyaltyQuote(
  deps: StoreApiDeps,
  params: { email?: string; subtotalCents?: unknown },
): Promise<LoyaltyQuote> {
  const CRM = base(deps.crmStoreApiUrl)
  const email = String(params.email || '').trim()
  if (!CRM || !email) return EMPTY_QUOTE

  // Floored and coerced here rather than trusted: this value comes off a query string.
  const subtotalCents = Math.max(0, Math.floor(Number(params.subtotalCents) || 0))
  const doFetch = deps.fetchImpl || fetch

  try {
    const qs = `email=${encodeURIComponent(email)}&subtotalCents=${encodeURIComponent(String(subtotalCents))}`
    const res = await doFetch(`${CRM}/api/public/loyalty?${qs}`, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return EMPTY_QUOTE
    const json = await res.json().catch(() => null)
    return (json && typeof json === 'object') ? json as LoyaltyQuote : EMPTY_QUOTE
  } catch {
    return EMPTY_QUOTE
  }
}

export interface CheckoutOutcome {
  status: number
  body: { url?: string; error?: string }
}

/**
 * Hand a cart to crm-store's hosted checkout.
 *
 * The body is forwarded as the browser sent it plus the origin the customer is actually on, so the
 * post-payment redirect returns to the live storefront rather than a custom domain that is not live
 * yet. Note what is NOT added: a loyalty reward travels as an id and nothing else, because a
 * discount the browser can name is a discount the browser can invent.
 */
export async function forwardCheckout(
  deps: StoreApiDeps,
  args: { body: any; origin?: string },
): Promise<CheckoutOutcome> {
  const CRM = base(deps.crmStoreApiUrl)
  if (!CRM) return { status: 503, body: { error: 'Checkout is not available yet.' } }
  if (!args.body || typeof args.body !== 'object') return { status: 400, body: { error: 'Invalid request' } }

  const payload = { ...args.body }
  if (args.origin) payload.origin = args.origin

  const doFetch = deps.fetchImpl || fetch
  try {
    const res = await doFetch(`${CRM}/api/public/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    })
    const data: any = await res.json().catch(() => ({}))
    // An upstream refusal keeps its status and its wording: "Cart is empty" is worth showing, and
    // flattening it to a generic 502 would tell the customer nothing they can act on.
    if (!res.ok) return { status: res.status || 502, body: { error: data?.error || 'Checkout failed' } }
    if (!data?.url) return { status: 502, body: { error: 'Checkout did not return a URL' } }
    return { status: 200, body: { url: data.url } }
  } catch {
    return { status: 502, body: { error: 'Could not reach the checkout service.' } }
  }
}

/** The origin a customer is actually browsing, from the proxy headers, else the configured site URL. */
export function originFromHeaders(
  headers: { host?: string | null; forwardedHost?: string | null; forwardedProto?: string | null },
  baseUrl = '',
): string {
  const host = headers.forwardedHost || headers.host
  if (!host) return baseUrl
  const proto = (headers.forwardedProto || 'https').split(',')[0]
  return `${proto}://${host}`
}

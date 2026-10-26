/**
 * "I already have a Stripe account — link it": Stripe Connect OAuth for a business's EXISTING Standard account.
 *
 * Why the Factory runs it: Stripe redirects only to URIs registered by hand in the platform's Connect settings, and every
 * business has its own address — so ONE redirect is registered, this Factory's /stripe/oauth/callback, as the QuickBooks
 * and Google sign-ins do (qboRelay.ts, lifecycle.ts). The code is exchanged here with the platform's key and only the
 * account id (acct_…) goes on to the business's own app (POST /api/internal/stripe-link, X-Factory-Key), which stores it
 * where "Create a new Stripe account" stores its own — so a linked account takes payments, receipts, refunds and
 * disconnect exactly like a created one. Nothing here is offered until STRIPE_CONNECT_CLIENT_ID is set.
 *
 * The state is the security of the whole thing (CSRF, and "whose business does this account land on"):
 *   • signed (HMAC-SHA256) — unforgeable without the Factory's secret, which no tenant holds;
 *   • short-lived (10 minutes; Stripe's code itself lives 5);
 *   • single-use — this process's ledger refuses a second use, and the business's app refuses a nonce it already
 *     consumed (it keeps only the nonce's hash, for the one sign-in it started), which survives a Factory restart.
 *     Single-use matters doubly here: Stripe REVOKES the connection when one code is exchanged twice;
 *   • bound to the business AND the admin who started it — the business's app checks that admin is still its owner/admin.
 * A state that fails any check never reaches a business: the browser gets a plain page, never a redirect (no open redirect).
 *
 * The functions take their outside world (tenant lookup, the HTTP calls, the clock) as deps, so tests never call Stripe
 * or a tenant (tests/unified/factory/stripe-link.test.ts).
 */
import crypto from 'crypto'

export const STRIPE_AUTHORIZE_URL = 'https://connect.stripe.com/oauth/authorize'
export const STRIPE_TOKEN_URL = 'https://connect.stripe.com/oauth/token'
export const STRIPE_DEAUTHORIZE_URL = 'https://connect.stripe.com/oauth/deauthorize'
/** The callback path under the Factory's public URL (routes are served at /api/v1/factory). */
export const CALLBACK_PATH = '/api/v1/factory/stripe/oauth/callback'
export const STATE_TTL_MS = 10 * 60_000

export interface StripeOAuthConfig { clientId: string; secretKey: string; redirectUri: string; stateSecret: string }

// No STRIPE_CONNECT_STATE_SECRET: a random secret for this process. Its states die with a restart — the owner presses the
// button again — which is the same life the replay ledger below has, and needs no new setting to be safe.
const processSecret = crypto.randomBytes(32).toString('hex')

/** The Factory's public base URL — the one Stripe redirects to (FACTORY_PUBLIC_URL, as the Google sign-ins use). */
export function factoryPublicUrl(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.FACTORY_PUBLIC_URL || env.RENDER_EXTERNAL_URL || 'https://twomiah-factory-api.onrender.com').replace(/\/+$/, '')
}

/** Everything the flow needs, or null — then nothing is offered (default-safe: no client id, no change). */
export function stripeOAuthConfig(env: NodeJS.ProcessEnv = process.env): StripeOAuthConfig | null {
  const clientId = String(env.STRIPE_CONNECT_CLIENT_ID || '').trim()
  const secretKey = String(env.STRIPE_SECRET_KEY || '').trim()
  if (!/^ca_[A-Za-z0-9]+$/.test(clientId) || !secretKey) return null
  return {
    clientId,
    secretKey,
    redirectUri: String(env.STRIPE_CONNECT_REDIRECT_URI || '').trim() || factoryPublicUrl(env) + CALLBACK_PATH,
    stateSecret: String(env.STRIPE_CONNECT_STATE_SECRET || '').trim() || processSecret,
  }
}

export interface LinkState {
  /** The business (tenants.id). */
  t: string
  /** The admin who pressed the button (the business's own user id). */
  u: string
  /** The business's one-time nonce; its app holds only the hash. */
  n: string
  /** Where the owner comes back to — an exact origin of their own app (premiumSiteUrl.ts mayReturnTo, checked at start). */
  r: string
  /** Expiry, ms since epoch. */
  e: number
  /** This state's own id, for the replay ledger. */
  j: string
}

const hmac = (secret: string, body: string) => crypto.createHmac('sha256', secret).update(body).digest('base64url')

export function signState(p: Omit<LinkState, 'e' | 'j'>, secret: string, now = Date.now()): string {
  const payload: LinkState = { ...p, e: now + STATE_TTL_MS, j: crypto.randomBytes(16).toString('base64url') }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${hmac(secret, body)}`
}

/** The state's contents when its signature is ours and it has not expired; null otherwise. Never throws. */
export function verifyState(state: string | undefined | null, secret: string, now = Date.now()): LinkState | null {
  if (!state || typeof state !== 'string' || state.length > 2000) return null
  const dot = state.indexOf('.')
  if (dot < 1 || state.indexOf('.', dot + 1) !== -1) return null
  const body = state.slice(0, dot), sig = state.slice(dot + 1)
  const want = Buffer.from(hmac(secret, body)), got = Buffer.from(sig)
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null
  let p: any
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) } catch { return null }
  if (!p || typeof p !== 'object') return null
  for (const k of ['t', 'u', 'n', 'r', 'j'] as const) if (typeof p[k] !== 'string' || !p[k]) return null
  if (typeof p.e !== 'number' || now > p.e) return null
  return p as LinkState
}

/** States already used in this process (id → expiry). A second use is refused before any code is exchanged. */
export function createStateLedger() {
  const used = new Map<string, number>()
  return {
    /** True the first time a state id is seen; false ever after (until it would have expired anyway). */
    consume(id: string, expiresAt: number, now = Date.now()): boolean {
      for (const [k, exp] of used) if (exp < now) used.delete(k)
      if (used.has(id)) return false
      used.set(id, expiresAt)
      return true
    },
  }
}

export function authorizeUrl(cfg: StripeOAuthConfig, state: string): string {
  const q = new URLSearchParams({ response_type: 'code', client_id: cfg.clientId, scope: 'read_write', redirect_uri: cfg.redirectUri, state })
  return `${STRIPE_AUTHORIZE_URL}?${q.toString()}`
}

/** What the owner is told — a word the business's app turns into a sentence (IntegrationsPage stripeOutcome). */
export type LinkOutcome = 'linked' | 'cancelled' | 'other_platform' | 'expired' | 'already_connected' | 'not_allowed' | 'failed'

/**
 * Stripe's error, in the owner's terms. access_denied = they pressed Cancel. invalid_grant = the code was used, expired
 * (5 minutes) or is not ours. Since June 2021 a read_write platform cannot connect a Standard account another platform
 * controls (docs.stripe.com/connect/oauth-changes-for-standard-platforms): Stripe normally steers the owner to make a
 * separate account, but if it answers with an error naming another platform, that is said plainly rather than "failed".
 */
export function outcomeForStripeError(error: unknown, description: unknown): LinkOutcome {
  const e = String(error || ''), d = String(description || '')
  if (e === 'access_denied') return 'cancelled'
  if (/platform|controlled by|another application|already connected/i.test(d)) return 'other_platform'
  if (e === 'invalid_grant') return 'expired'
  return 'failed'
}

type Fetch = typeof fetch
const form = (secretKey: string, body: Record<string, string>) => ({
  method: 'POST',
  headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(body).toString(),
  signal: AbortSignal.timeout(20_000),
})

/** Exchange the code for the account id with the platform key. The access/refresh tokens Stripe returns are deprecated and never kept. */
export async function exchangeCode(code: string, cfg: StripeOAuthConfig, http: Fetch = fetch): Promise<{ ok: true; accountId: string } | { ok: false; outcome: LinkOutcome; detail: string }> {
  try {
    const res = await http(STRIPE_TOKEN_URL, form(cfg.secretKey, { grant_type: 'authorization_code', code }))
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok || data?.error) return { ok: false, outcome: outcomeForStripeError(data?.error, data?.error_description), detail: String(data?.error || res.status) }
    const accountId = String(data?.stripe_user_id || '')
    if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) return { ok: false, outcome: 'failed', detail: 'no account id in the token response' }
    return { ok: true, accountId }
  } catch (err: any) {
    return { ok: false, outcome: 'failed', detail: err?.name === 'TimeoutError' ? 'timeout' : 'network' }
  }
}

/**
 * Withdraw the platform's access to an OAuth-linked account. Stripe's invalid_client also means "not connected to this
 * application any more" (the owner already removed us in their dashboard) — the goal is met, so it is not a failure.
 */
export async function deauthorizeAccount(accountId: string, cfg: StripeOAuthConfig, http: Fetch = fetch): Promise<{ ok: boolean; detail?: string }> {
  try {
    const res = await http(STRIPE_DEAUTHORIZE_URL, form(cfg.secretKey, { client_id: cfg.clientId, stripe_user_id: accountId }))
    const data: any = await res.json().catch(() => ({}))
    if (res.ok && data?.stripe_user_id) return { ok: true }
    if (data?.error === 'invalid_client') return { ok: true, detail: 'not connected' }
    return { ok: false, detail: String(data?.error || res.status) }
  } catch (err: any) {
    return { ok: false, detail: err?.name === 'TimeoutError' ? 'timeout' : 'network' }
  }
}

export interface CallbackTenant { id: string; slug?: string | null; engine?: string | null; render_backend_url?: string | null; factory_sync_key?: string | null }

export interface CallbackDeps {
  config: StripeOAuthConfig
  ledger: ReturnType<typeof createStateLedger>
  findTenant: (id: string) => Promise<CallbackTenant | null>
  /** The business's app at /api/internal/stripe-link: accepts or refuses this account for this nonce and admin. */
  deliver: (tenant: CallbackTenant, body: { nonce: string; userId: string; accountId?: string; outcome?: LinkOutcome }) => Promise<{ ok: boolean; status: number; error?: string }>
  /** The Factory's record of the account (tenants.stripe_connect_account_id), for webhook routing and the deauthorize check. */
  record: (tenantId: string, accountId: string) => Promise<void>
  fetch?: Fetch
  now?: () => number
  log?: (msg: string, meta?: Record<string, unknown>) => void
}

export type CallbackResult = { kind: 'redirect'; location: string } | { kind: 'page'; status: number; message: string }

const INVALID = 'This Stripe link is not valid or has expired. Go back to Settings › Integrations in your app and press "I already have a Stripe account" again.'

const back = (returnUrl: string, outcome: LinkOutcome): CallbackResult => {
  const u = new URL(returnUrl)
  u.searchParams.set('stripe', outcome)
  return { kind: 'redirect', location: u.toString() }
}

/** Stripe's redirect back, start to finish. Exactly one code exchange per state; the account lands only on the business that started it. */
export async function handleCallback(query: Record<string, string | undefined>, d: CallbackDeps): Promise<CallbackResult> {
  const now = (d.now || Date.now)()
  const log = d.log || (() => {})
  const st = verifyState(query.state, d.config.stateSecret, now)
  if (!st) { log('state refused'); return { kind: 'page', status: 400, message: INVALID } }
  if (!d.ledger.consume(st.j, st.e, now)) { log('state replayed', { tenant: st.t }); return { kind: 'page', status: 400, message: INVALID } }
  const tenant = await d.findTenant(st.t).catch(() => null)
  if (!tenant || !tenant.factory_sync_key) { log('tenant missing', { tenant: st.t }); return { kind: 'page', status: 400, message: INVALID } }

  // Cancelled or refused at Stripe: no account to hand over — the business's app forgets its pending sign-in, and the
  // owner is told why (only access_denied is redirected by Stripe; the rest are shown on Stripe's own page).
  if (query.error || !query.code) {
    const outcome = query.error ? outcomeForStripeError(query.error, query.error_description) : 'failed'
    await d.deliver(tenant, { nonce: st.n, userId: st.u, outcome }).catch(() => null)
    return back(st.r, outcome)
  }

  const ex = await exchangeCode(String(query.code), d.config, d.fetch)
  if (!ex.ok) {
    log('code exchange refused', { tenant: tenant.slug || tenant.id, error: ex.detail })
    await d.deliver(tenant, { nonce: st.n, userId: st.u, outcome: ex.outcome }).catch(() => null)
    return back(st.r, ex.outcome)
  }

  const res = await d.deliver(tenant, { nonce: st.n, userId: st.u, accountId: ex.accountId }).catch((e: any) => ({ ok: false, status: 0, error: e?.message || 'unreachable' }))
  if (!res.ok) {
    // The business would not take it (its sign-in was replaced or used, the admin is no longer an admin, it is already
    // connected) or could not be reached: the platform must not keep access to an account nobody here holds.
    const undo = await deauthorizeAccount(ex.accountId, d.config, d.fetch)
    log('business refused the account; access withdrawn', { tenant: tenant.slug || tenant.id, status: res.status, deauthorized: undo.ok })
    const outcome: LinkOutcome = res.status === 409 ? 'already_connected' : res.status === 403 ? 'not_allowed' : res.status === 410 ? 'expired' : 'failed'
    return back(st.r, outcome)
  }
  await d.record(tenant.id, ex.accountId).catch((e: any) => log('record failed', { tenant: tenant.slug || tenant.id, error: e?.message }))
  log('linked', { tenant: tenant.slug || tenant.id })
  return back(st.r, 'linked')
}

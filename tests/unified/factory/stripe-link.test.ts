// "I already have a Stripe account — link it", the Factory's half (apps/api services/stripeConnectOAuth.ts; the
// business's half is apps/unified/tests/stripe-link.test.ts). Stripe redirects every business to the Factory's one
// registered callback, which must: refuse a forged, tampered, expired or replayed state without exchanging anything and
// without redirecting; exchange each code exactly once with the platform key; hand the account only to the business in
// the state; tell the owner plainly when they cancelled, the code expired or the account is another platform's; and
// withdraw the platform's access when the business refuses the account. Stripe and the business are stand-ins.
import { describe, test, expect } from 'bun:test'
import {
  stripeOAuthConfig, signState, verifyState, createStateLedger, authorizeUrl, handleCallback, exchangeCode, deauthorizeAccount,
  outcomeForStripeError, STATE_TTL_MS, STRIPE_TOKEN_URL, STRIPE_DEAUTHORIZE_URL, type CallbackDeps, type CallbackTenant,
} from '../../../apps/api/src/services/stripeConnectOAuth'

const ENV = { STRIPE_CONNECT_CLIENT_ID: 'ca_TEST123', STRIPE_SECRET_KEY: 'sk_test_platform', FACTORY_PUBLIC_URL: 'https://twomiah-factory-api.onrender.com', STRIPE_CONNECT_STATE_SECRET: 'state-secret' } as any
const cfg = stripeOAuthConfig(ENV)!
const A: CallbackTenant = { id: 'aaaaaaaa-0000-0000-0000-000000000001', slug: 'acme', engine: 'unified', render_backend_url: 'https://acme-app.onrender.com', factory_sync_key: 'key-a' }
const B: CallbackTenant = { id: 'bbbbbbbb-0000-0000-0000-000000000002', slug: 'beta', engine: 'unified', render_backend_url: 'https://beta-app.onrender.com', factory_sync_key: 'key-b' }
const RETURN = 'https://acme-app.onrender.com/crm/settings/integrations'
const NONCE = 'n'.repeat(43)

type StripeAnswer = { status: number; body: any }
function world(opts: { token?: StripeAnswer; deauth?: StripeAnswer; deliver?: (t: CallbackTenant, b: any) => { ok: boolean; status: number } } = {}) {
  const stripeCalls: Array<{ url: string; auth: string | null; body: URLSearchParams }> = []
  const delivered: Array<{ tenant: string; body: any }> = []
  const recorded: Array<{ tenant: string; account: string }> = []
  const fetchFake = (async (url: any, init: any) => {
    stripeCalls.push({ url: String(url), auth: init?.headers?.Authorization ?? null, body: new URLSearchParams(String(init?.body || '')) })
    const a = String(url) === STRIPE_TOKEN_URL ? (opts.token ?? { status: 200, body: { stripe_user_id: 'acct_LINKED', token_type: 'bearer', access_token: 'sk_never_kept' } })
      : (opts.deauth ?? { status: 200, body: { stripe_user_id: 'acct_LINKED' } })
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } })
  }) as any
  const deps: CallbackDeps = {
    config: cfg,
    ledger: createStateLedger(),
    findTenant: async (id) => [A, B].find((t) => t.id === id) || null,
    deliver: async (t, body) => { delivered.push({ tenant: t.id, body }); return opts.deliver ? opts.deliver(t, body) : { ok: true, status: 200 } },
    record: async (tenant, account) => { recorded.push({ tenant, account }) },
    fetch: fetchFake,
  }
  return { deps, stripeCalls, delivered, recorded }
}
const stateFor = (t = A, extra: Partial<{ u: string; n: string; r: string }> = {}, now = Date.now()) => signState({ t: t.id, u: extra.u ?? 'owner-1', n: extra.n ?? NONCE, r: extra.r ?? RETURN }, cfg.stateSecret, now)

describe('configuration', () => {
  test('no client id: nothing (default-safe); a client id: the exact registered redirect', () => {
    expect(stripeOAuthConfig({ STRIPE_SECRET_KEY: 'sk_test_x' } as any)).toBeNull()
    expect(stripeOAuthConfig({ STRIPE_CONNECT_CLIENT_ID: 'ca_X' } as any)).toBeNull()
    expect(stripeOAuthConfig({ STRIPE_CONNECT_CLIENT_ID: 'not-a-client-id', STRIPE_SECRET_KEY: 'sk_test_x' } as any)).toBeNull()
    expect(cfg.redirectUri).toBe('https://twomiah-factory-api.onrender.com/api/v1/factory/stripe/oauth/callback')
    const u = new URL(authorizeUrl(cfg, 'S'))
    expect(u.origin + u.pathname).toBe('https://connect.stripe.com/oauth/authorize')
    expect(Object.fromEntries(u.searchParams)).toEqual({ response_type: 'code', client_id: 'ca_TEST123', scope: 'read_write', redirect_uri: cfg.redirectUri, state: 'S' })
  })

  test('without STRIPE_CONNECT_STATE_SECRET the state is still signed (a per-process secret)', () => {
    const c = stripeOAuthConfig({ ...ENV, STRIPE_CONNECT_STATE_SECRET: '' })!
    expect(c.stateSecret.length).toBeGreaterThanOrEqual(32)
    expect(verifyState(signState({ t: A.id, u: 'u', n: NONCE, r: RETURN }, c.stateSecret), 'guess')).toBeNull()
  })
})

describe('the state', () => {
  test('ours verifies; forged, tampered, re-signed with another secret, or expired does not', () => {
    const s = stateFor()
    expect(verifyState(s, cfg.stateSecret)).toMatchObject({ t: A.id, u: 'owner-1', n: NONCE, r: RETURN })
    const [body, sig] = s.split('.')
    const swapped = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), t: B.id })).toString('base64url')
    expect(verifyState(`${swapped}.${sig}`, cfg.stateSecret)).toBeNull()
    expect(verifyState(signState({ t: B.id, u: 'x', n: NONCE, r: RETURN }, 'attacker-secret'), cfg.stateSecret)).toBeNull()
    expect(verifyState('garbage', cfg.stateSecret)).toBeNull()
    expect(verifyState(`${body}.${sig}.extra`, cfg.stateSecret)).toBeNull()
    expect(verifyState(s, cfg.stateSecret, Date.now() + STATE_TTL_MS + 1)).toBeNull()
  })
})

describe('the callback', () => {
  test('success: one exchange with the platform key, the account to the business in the state, recorded, back with "linked"', async () => {
    const w = world()
    const r = await handleCallback({ code: 'ac_1', state: stateFor(A), scope: 'read_write' }, w.deps)
    expect(r).toEqual({ kind: 'redirect', location: `${RETURN}?stripe=linked` })
    expect(w.stripeCalls).toHaveLength(1)
    expect(w.stripeCalls[0].url).toBe(STRIPE_TOKEN_URL)
    expect(w.stripeCalls[0].auth).toBe('Bearer sk_test_platform')
    expect(Object.fromEntries(w.stripeCalls[0].body)).toEqual({ grant_type: 'authorization_code', code: 'ac_1' })
    expect(w.delivered).toEqual([{ tenant: A.id, body: { nonce: NONCE, userId: 'owner-1', accountId: 'acct_LINKED' } }])
    // Only the account id travels: never Stripe's (deprecated) tokens.
    expect(JSON.stringify(w.delivered)).not.toContain('sk_never_kept')
    expect(w.recorded).toEqual([{ tenant: A.id, account: 'acct_LINKED' }])
  })

  test('a replayed state is refused before any exchange (Stripe revokes a code used twice)', async () => {
    const w = world()
    const s = stateFor(A)
    await handleCallback({ code: 'ac_1', state: s }, w.deps)
    const again = await handleCallback({ code: 'ac_2', state: s }, w.deps)
    expect(again.kind).toBe('page')
    expect((again as any).status).toBe(400)
    expect(w.stripeCalls).toHaveLength(1)
    expect(w.delivered).toHaveLength(1)
  })

  test('a forged or expired state: a plain page, no redirect, no exchange, no business told', async () => {
    for (const state of [signState({ t: B.id, u: 'x', n: NONCE, r: 'https://evil.example/' }, 'attacker'), stateFor(A, {}, Date.now() - STATE_TTL_MS - 1), undefined]) {
      const w = world()
      const r = await handleCallback({ code: 'ac_1', state }, w.deps)
      expect(r.kind).toBe('page')
      expect((r as any).message).toContain('not valid or has expired')
      expect(w.stripeCalls).toHaveLength(0)
      expect(w.delivered).toHaveLength(0)
    }
  })

  test('cancelled at Stripe (access_denied): no exchange, the business forgets its press, the owner is told', async () => {
    const w = world()
    const r = await handleCallback({ error: 'access_denied', error_description: 'The user denied your request', state: stateFor(A) }, w.deps)
    expect(r).toEqual({ kind: 'redirect', location: `${RETURN}?stripe=cancelled` })
    expect(w.stripeCalls).toHaveLength(0)
    expect(w.delivered).toEqual([{ tenant: A.id, body: { nonce: NONCE, userId: 'owner-1', outcome: 'cancelled' } }])
    expect(w.recorded).toHaveLength(0)
  })

  test('a bad or expired code: "expired"; another platform\'s account: said so; nothing linked', async () => {
    const bad = world({ token: { status: 400, body: { error: 'invalid_grant', error_description: 'Authorization code does not exist: ac_x' } } })
    expect(await handleCallback({ code: 'ac_x', state: stateFor(A) }, bad.deps)).toEqual({ kind: 'redirect', location: `${RETURN}?stripe=expired` })
    expect(bad.recorded).toHaveLength(0)
    expect(bad.delivered[0].body).toEqual({ nonce: NONCE, userId: 'owner-1', outcome: 'expired' })
    const other = world({ token: { status: 400, body: { error: 'invalid_request', error_description: 'This account is controlled by another platform and cannot be connected.' } } })
    expect(await handleCallback({ code: 'ac_y', state: stateFor(A) }, other.deps)).toEqual({ kind: 'redirect', location: `${RETURN}?stripe=other_platform` })
    expect(other.recorded).toHaveLength(0)
  })

  test('the business refuses the account: the platform\'s access is withdrawn, nothing recorded', async () => {
    for (const [status, outcome] of [[409, 'already_connected'], [403, 'not_allowed'], [410, 'expired'], [0, 'failed']] as const) {
      const w = world({ deliver: () => ({ ok: false, status }) })
      const r = await handleCallback({ code: 'ac_1', state: stateFor(A) }, w.deps)
      expect(r).toEqual({ kind: 'redirect', location: `${RETURN}?stripe=${outcome}` })
      const deauth = w.stripeCalls.find((c) => c.url === STRIPE_DEAUTHORIZE_URL)!
      expect(Object.fromEntries(deauth.body)).toEqual({ client_id: 'ca_TEST123', stripe_user_id: 'acct_LINKED' })
      expect(w.recorded).toHaveLength(0)
    }
  })

  test('a state naming a business the Factory does not know: refused', async () => {
    const w = world()
    const ghost = signState({ t: 'cccccccc-0000-0000-0000-000000000003', u: 'x', n: NONCE, r: RETURN }, cfg.stateSecret)
    expect((await handleCallback({ code: 'ac_1', state: ghost }, w.deps)).kind).toBe('page')
    expect(w.stripeCalls).toHaveLength(0)
  })
})

describe('Stripe calls', () => {
  test('deauthorize: confirmed, or already not connected (invalid_client), counts as done; anything else does not', async () => {
    expect((await deauthorizeAccount('acct_1', cfg, world().deps.fetch)).ok).toBe(true)
    expect((await deauthorizeAccount('acct_1', cfg, world({ deauth: { status: 400, body: { error: 'invalid_client' } } }).deps.fetch)).ok).toBe(true)
    expect((await deauthorizeAccount('acct_1', cfg, world({ deauth: { status: 500, body: { error: 'api_error' } } }).deps.fetch)).ok).toBe(false)
  })

  test('a token answer without an account id is a failure, never a link', async () => {
    const r = await exchangeCode('ac_1', cfg, world({ token: { status: 200, body: { token_type: 'bearer' } } }).deps.fetch)
    expect(r.ok).toBe(false)
  })

  test("Stripe's errors in the owner's terms", () => {
    expect(outcomeForStripeError('access_denied', 'The user denied your request')).toBe('cancelled')
    expect(outcomeForStripeError('invalid_grant', 'Authorization code expired')).toBe('expired')
    expect(outcomeForStripeError('invalid_request', 'Account is controlled by another platform')).toBe('other_platform')
    expect(outcomeForStripeError('invalid_scope', 'Invalid scope')).toBe('failed')
  })
})

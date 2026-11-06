// Square, read-only, for the tips a venue took on ITS OWN Square register (restaurant-bar parity #17).
//
// What this file knows, and where it comes from (Square's developer pages, read 2026-10):
//   · OAuth: authorize at https://connect.squareup.com/oauth2/authorize (client_id, scope, session=false, state); the redirect
//     brings back code + state; POST /oauth2/token trades the code (grant_type authorization_code) or a refresh token (grant_type
//     refresh_token) for { access_token, refresh_token, expires_at, merchant_id }. An access token lasts 30 days and Square asks
//     to renew at 7 days or less. Sandbox is connect.squareupsandbox.com.
//   · GET /v2/payments: begin_time, end_time (RFC 3339, on created_at), location_id, cursor, limit (max 100), sort_order. Each
//     payment carries status (only COMPLETED is money that stayed), tip_money.amount in cents and team_member_id.
//   · POST /v2/team-members/search: { query: { filter: { status, location_ids } }, limit (max 200), cursor } answers team_members
//     (id, given_name, family_name, email_address, status) and a cursor.
//   · Scopes: PAYMENTS_READ and EMPLOYEES_READ.
// NOT confirmed from a page that could be read: that tip_money sits on the payment object (the list page's example omits it; it is
// in Square's Payment object), and the revoke endpoint (we never call it: disconnecting deletes our copy of the tokens and the owner
// removes the app in Square). Nothing here needs a live account to be tested: every call takes an injectable fetch.
//
// Secrets never pass through this file's logs or errors: an error carries Square's reason, never the token or the app secret.

export const SQUARE_VERSION = '2024-10-17'
export const SQUARE_SCOPES = 'PAYMENTS_READ EMPLOYEES_READ'
/** Square asks for a renewal at 7 days or less before the token ends. */
export const SQUARE_RENEW_WITHIN_MS = 7 * 24 * 60 * 60 * 1000

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface SquareApp { clientId: string; clientSecret: string; sandbox?: boolean; fetch?: FetchLike }

/** `auth` = the venue has to connect again (revoked, expired beyond refresh); `other` = try again later. */
export class ProviderError extends Error {
  constructor(message: string, public kind: 'auth' | 'other' = 'other') { super(message) }
}

export const squareHost = (sandbox?: boolean) => (sandbox ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com')
const doFetch = (app: { fetch?: FetchLike }): FetchLike => app.fetch ?? ((u, i) => fetch(u, i))

export function squareAuthorizeUrl(app: Pick<SquareApp, 'clientId' | 'sandbox'>, state: string): string {
  const q = new URLSearchParams({ client_id: app.clientId, scope: SQUARE_SCOPES, session: 'false', state })
  return `${squareHost(app.sandbox)}/oauth2/authorize?${q}`
}

export interface SquareTokens { accessToken: string; refreshToken: string; expiresAt: string; merchantId: string }

async function body(res: Response): Promise<any> {
  try { return await res.json() } catch { return {} }
}
const reason = (j: any, fallback: string) => String(j?.errors?.[0]?.detail || j?.error_description || j?.message || fallback).slice(0, 200)

async function token(app: SquareApp, params: Record<string, string>): Promise<SquareTokens> {
  const res = await doFetch(app)(`${squareHost(app.sandbox)}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Square-Version': SQUARE_VERSION },
    body: JSON.stringify({ client_id: app.clientId, client_secret: app.clientSecret, ...params }),
  })
  const j = await body(res)
  if (!res.ok || !j.access_token) {
    const bad = res.status === 400 || res.status === 401 || res.status === 403
    throw new ProviderError(`Square would not accept the connection: ${reason(j, `it answered ${res.status}`)}`, bad ? 'auth' : 'other')
  }
  return { accessToken: String(j.access_token), refreshToken: String(j.refresh_token || ''), expiresAt: String(j.expires_at || ''), merchantId: String(j.merchant_id || '') }
}
export const squareExchangeCode = (app: SquareApp, code: string) => token(app, { code, grant_type: 'authorization_code' })
export const squareRefresh = (app: SquareApp, refreshToken: string) => token(app, { refresh_token: refreshToken, grant_type: 'refresh_token' })

async function call(app: SquareApp, accessToken: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
  const res = await doFetch(app)(`${squareHost(app.sandbox)}${path}`, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, 'Square-Version': SQUARE_VERSION, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  })
  const j = await body(res)
  if (res.status === 401 || res.status === 403) throw new ProviderError('Square says this connection is no longer allowed. Connect Square again.', 'auth')
  if (!res.ok) throw new ProviderError(`Square could not be read: ${reason(j, `it answered ${res.status}`)}`)
  return j
}

export interface SquareTip { id: string; tipCents: number; staffId: string | null; paidAt: Date }

/** Tips on completed payments created from…to (the venue's main location unless one is named). Pages of 100 until Square stops giving a cursor. */
export async function squareTips(app: SquareApp, accessToken: string, range: { from: Date; to: Date; locationId?: string | null }): Promise<SquareTip[]> {
  const out: SquareTip[] = []
  let cursor = ''
  for (let page = 0; page < 200; page++) {
    const q = new URLSearchParams({ begin_time: range.from.toISOString(), end_time: range.to.toISOString(), sort_order: 'ASC', limit: '100' })
    if (range.locationId) q.set('location_id', range.locationId)
    if (cursor) q.set('cursor', cursor)
    const j = await call(app, accessToken, `/v2/payments?${q}`)
    for (const p of Array.isArray(j.payments) ? j.payments : []) {
      if (p?.status !== 'COMPLETED') continue
      const cents = Number(p?.tip_money?.amount)
      if (!Number.isInteger(cents) || cents <= 0) continue
      const at = new Date(p.created_at)
      if (Number.isNaN(at.getTime())) continue
      out.push({ id: String(p.id), tipCents: cents, staffId: p.team_member_id ? String(p.team_member_id) : null, paidAt: at })
    }
    cursor = String(j.cursor || '')
    if (!cursor) return out
  }
  throw new ProviderError('Square returned more pages of payments than one night can have.')
}

export interface ProviderStaff { id: string; name: string; email: string | null }

export async function squareStaff(app: SquareApp, accessToken: string, locationId?: string | null): Promise<ProviderStaff[]> {
  const out: ProviderStaff[] = []
  let cursor = ''
  for (let page = 0; page < 50; page++) {
    const j = await call(app, accessToken, '/v2/team-members/search', {
      method: 'POST',
      body: { query: { filter: { status: 'ACTIVE', ...(locationId ? { location_ids: [locationId] } : {}) } }, limit: 200, ...(cursor ? { cursor } : {}) },
    })
    for (const m of Array.isArray(j.team_members) ? j.team_members : []) {
      out.push({ id: String(m.id), name: [m.given_name, m.family_name].filter(Boolean).join(' ').trim() || String(m.email_address || m.id), email: m.email_address ? String(m.email_address) : null })
    }
    cursor = String(j.cursor || '')
    if (!cursor) return out
  }
  return out
}

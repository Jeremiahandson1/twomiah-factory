// Plaid webhook verification (plaid.com/docs/api/webhooks/webhook-verification).
//
// crm-dispensary's Pay-by-Bank webhook (POST /api/pay-by-bank/webhook) accepted ANY caller and moved
// ach_transactions to completed / failed on its word — anyone could mark a bank payment settled.
//
// Plaid's scheme, step for step:
//   · the `Plaid-Verification` header is a JWT; its header's alg MUST be ES256 (reject anything else);
//   · its `kid` names a key fetched from POST /webhook_verification_key/get {client_id, secret, key_id};
//   · the signature verifies against that JWK;
//   · `iat` is no more than 5 minutes old;
//   · the payload's `request_body_sha256` equals SHA-256 (hex) of the RAW body, compared in constant time.
import crypto from 'crypto'

const b64urlJson = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'))
const MAX_AGE_S = 5 * 60

export type PlaidKeyFetcher = (keyId: string) => Promise<any | null>

/**
 * Is this request Plaid's? `fetchKey` returns the JWK for a key id (null when Plaid has none), so the
 * network call stays with the caller, which holds the client id + secret. With no fetcher (Plaid not
 * configured): refused in production, allowed outside it — the policy every webhook verifier here has.
 */
export async function verifyPlaidWebhook(rawBody: string, jwt: string | undefined, fetchKey: PlaidKeyFetcher | null, nowMs: number = Date.now()): Promise<{ ok: boolean; reason?: string }> {
  if (!fetchKey) {
    return process.env.NODE_ENV === 'production'
      ? { ok: false, reason: 'Plaid not configured (Pay by Bank › Settings: client id + secret)' }
      : { ok: true, reason: 'Plaid not configured (non-production)' }
  }
  if (!jwt) return { ok: false, reason: 'missing Plaid-Verification header' }
  const parts = String(jwt).split('.')
  if (parts.length !== 3) return { ok: false, reason: 'malformed Plaid-Verification JWT' }
  let header: any, payload: any
  try { header = b64urlJson(parts[0]); payload = b64urlJson(parts[1]) } catch { return { ok: false, reason: 'malformed Plaid-Verification JWT' } }
  if (header?.alg !== 'ES256') return { ok: false, reason: 'Plaid-Verification alg is not ES256' }
  if (!header?.kid) return { ok: false, reason: 'Plaid-Verification has no kid' }
  let jwk: any
  try { jwk = await fetchKey(String(header.kid)) } catch { return { ok: false, reason: 'could not fetch the Plaid verification key' } }
  if (!jwk) return { ok: false, reason: 'unknown Plaid verification key' }
  // /webhook_verification_key/get answers expired_at (Unix seconds, null while the key is live). A key Plaid has
  // retired verifies nothing from then on: a signature under it after that moment is refused.
  const expiredAt = jwk.expired_at === null || jwk.expired_at === undefined ? null : Number(jwk.expired_at)
  if (expiredAt !== null && (!Number.isFinite(expiredAt) || expiredAt <= nowMs / 1000)) return { ok: false, reason: 'Plaid verification key has expired' }
  let valid = false
  try {
    const key = crypto.createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: 'jwk' })
    valid = crypto.verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url'))
  } catch { valid = false }
  if (!valid) return { ok: false, reason: 'signature mismatch' }
  const iat = Number(payload?.iat)
  if (!Number.isFinite(iat) || nowMs / 1000 - iat > MAX_AGE_S) return { ok: false, reason: 'Plaid webhook is more than 5 minutes old' }
  const want = Buffer.from(String(payload?.request_body_sha256 || ''))
  const got = Buffer.from(crypto.createHash('sha256').update(Buffer.from(rawBody, 'utf8')).digest('hex'))
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return { ok: false, reason: 'body does not match request_body_sha256' }
  return { ok: true }
}

/** The fetcher for a plaid_config row: POST {base}/webhook_verification_key/get. */
export function plaidKeyFetcher(cfg: { client_id?: string; secret?: string; environment?: string } | null | undefined): PlaidKeyFetcher | null {
  if (!cfg?.client_id || !cfg?.secret) return null
  const base = cfg.environment === 'production' ? 'https://production.plaid.com'
    : cfg.environment === 'development' ? 'https://development.plaid.com' : 'https://sandbox.plaid.com'
  return async (keyId: string) => {
    const r = await fetch(`${base}/webhook_verification_key/get`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: cfg.client_id, secret: cfg.secret, key_id: keyId }),
    })
    if (!r.ok) return null
    const j: any = await r.json().catch(() => null)
    return j?.key || null
  }
}

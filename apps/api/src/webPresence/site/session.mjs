// Sign-in and sessions for a Web presence site. Dependency-free (WebCrypto only): the Factory mints and checks with it, and the
// site's function checks with it. There is NO shared password: every site has its OWN secret, held as that site's Netlify env
// var (WP_SECRET) and derivable by the Factory alone from its master key (siteSecret) — so a link or a session made for site A
// is worthless at site B, and a support person reaches a site only by asking the Factory for a link.
//
//   sign-in link  v1.<payload>.<sig>   payload { s: site id, e: expiry, j: single-use id }   15 minutes, used once
//   session       v1.<payload>.<sig>   payload { s: site id, e: expiry, i: session id }       12 hours, revocable (sign-out)
//   request       HMAC over `${ts}.${body}` — the site's function asking the Factory to render (stateless; nothing stored there)
const enc = new TextEncoder()
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const jsonB64u = (o) => b64u(enc.encode(JSON.stringify(o)))

export const SIGNIN_TTL_SEC = 15 * 60
export const SESSION_TTL_SEC = 12 * 60 * 60

async function key(secret) {
  return crypto.subtle.importKey('raw', enc.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}
/** HMAC-SHA256 of `data` under `secret`, base64url. */
export async function hmac(secret, data) {
  return b64u(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(String(data))))
}
/** Compare two strings without stopping at the first difference. */
export function safeEqual(a, b) {
  a = String(a); b = String(b)
  let d = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return d === 0
}
export function randomId(bytes = 16) { return b64u(crypto.getRandomValues(new Uint8Array(bytes))) }

/** The site's own secret, from the Factory's master key and the site's id. Only the Factory can compute it for another site. */
export async function siteSecret(master, siteId) {
  if (!master || String(master).length < 16) throw new Error('WEB_PRESENCE_SECRET_KEY is not set (16+ characters)')
  if (!siteId) throw new Error('site id missing')
  return hmac(master, 'wp-site:' + siteId)
}

async function mint(secret, payload) {
  const body = jsonB64u(payload)
  return 'v1.' + body + '.' + await hmac(secret, 'v1.' + body)
}
async function open(secret, token) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return null
  if (!safeEqual(await hmac(secret, 'v1.' + parts[1]), parts[2])) return null
  try { return JSON.parse(new TextDecoder().decode(fromB64u(parts[1]))) } catch { return null }
}

export async function mintSignin(secret, siteId, now = Date.now(), ttlSec = SIGNIN_TTL_SEC) {
  return mint(secret, { k: 'in', s: siteId, e: Math.floor(now / 1000) + ttlSec, j: randomId(12) })
}
/** { ok:true, jti, exp } or { ok:false, error:'invalid'|'expired'|'wrong site' }. Single use is the caller's: it records `jti`. */
export async function verifySignin(secret, token, siteId, now = Date.now()) {
  const p = await open(secret, token)
  if (!p || p.k !== 'in') return { ok: false, error: 'invalid' }
  if (p.s !== siteId) return { ok: false, error: 'wrong site' }
  if (!(p.e > Math.floor(now / 1000))) return { ok: false, error: 'expired' }
  return { ok: true, jti: p.j, exp: p.e }
}

export async function mintSession(secret, siteId, now = Date.now(), ttlSec = SESSION_TTL_SEC) {
  return mint(secret, { k: 'ses', s: siteId, e: Math.floor(now / 1000) + ttlSec, i: randomId(12) })
}
/** { ok:true, sid, exp } or { ok:false, error }. Revocation (sign-out) is the caller's: it keeps the revoked `sid`s. */
export async function verifySession(secret, token, siteId, now = Date.now()) {
  const p = await open(secret, token)
  if (!p || p.k !== 'ses') return { ok: false, error: 'invalid' }
  if (p.s !== siteId) return { ok: false, error: 'wrong site' }
  if (!(p.e > Math.floor(now / 1000))) return { ok: false, error: 'expired' }
  return { ok: true, sid: p.i, exp: p.e }
}

/** The signature a site's function puts on a request to the Factory. */
export async function signRequest(secret, ts, body) { return hmac(secret, ts + '.' + body) }
/** Whether a request's signature is right and fresh (5 minutes either way). */
export async function verifyRequest(secret, ts, body, sig, now = Date.now(), skewSec = 300) {
  const t = Number(ts)
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > skewSec) return false
  return safeEqual(await signRequest(secret, ts, body), sig)
}

/**
 * A fixed-window rate limit over any store with get(key) / set(key, value) (the site's Blobs in production, a Map in tests).
 * Returns { allowed, remaining }. The count is kept per `key` and per window, so an old window never blocks a new one.
 */
export async function rateLimit(store, key, limit, windowSec, now = Date.now()) {
  const win = Math.floor(now / 1000 / windowSec)
  const k = 'rl:' + key + ':' + win
  const n = Number((await store.get(k)) || 0)
  if (n >= limit) return { allowed: false, remaining: 0 }
  await store.set(k, n + 1)
  return { allowed: true, remaining: limit - n - 1 }
}

/** A salted hash of an address for rate-limit keys, so no visitor address is kept as-is. */
export async function hashAddr(secret, addr) { return (await hmac(secret, 'ip:' + String(addr || ''))).slice(0, 22) }

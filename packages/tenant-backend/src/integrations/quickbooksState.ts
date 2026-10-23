// QuickBooks OAuth state — ONE signer for every CRM's Connect QuickBooks (the shared module, and the two forks
// in crm-dispensary and crm-roof, which import this file from ../shared).
//
// Why the state carries a return URL. Intuit only redirects to URIs registered by hand in the Intuit developer
// app, and every tenant used its own (<tenant>/api/quickbooks/callback), so each new customer needed someone to
// add their URL in Intuit's portal before Connect worked. Now every tenant sends Intuit ONE redirect URI — the
// Factory's QuickBooks callback (apps/api/src/services/qboRelay.ts) — and puts its own callback in the state.
// The Factory reads it, refuses any host that is not a known tenant backend, and 302s the browser there with
// code / state / realmId untouched. The tenant then checks the signature, which covers the return URL, so a
// state cannot be re-pointed at another tenant without breaking it.
//
// Shapes (base64url JSON), all accepted by verifyQboState:
//   legacy  { companyId, ts, sig }                       sig = HMAC(secret, "<companyId>.<ts>")
//   new     { companyId, ts, userId?, returnUrl?, sig }  sig = HMAC(secret, "<companyId>.<ts>." + JSON({u, r}))
// The legacy shape is produced whenever there is neither a userId nor a returnUrl, so a tenant whose env has no
// QBO_RETURN_URL signs exactly what it signed before this file existed.
import crypto from 'crypto'

export const QBO_STATE_TTL_MS = 15 * 60 * 1000

export interface QboStatePayload { companyId: string; userId?: string; returnUrl?: string }

function material(companyId: string, ts: number, userId?: string, returnUrl?: string): string {
  if (userId === undefined && returnUrl === undefined) return `${companyId}.${ts}`
  return `${companyId}.${ts}.` + JSON.stringify({ u: userId ?? null, r: returnUrl ?? null })
}
const hmac = (secret: string, s: string) => crypto.createHmac('sha256', secret).update(s).digest('hex')

/** A signed state. Throws without a secret — an unsigned state lets anyone attach their books to any company. */
export function signQboState(p: QboStatePayload, secret: string, now: number = Date.now()): string {
  // Reaches the owner through GET /quickbooks/auth-url, so it is said in their words; the missing setting is
  // QBO_STATE_SECRET (or JWT_SECRET).
  if (!secret) throw new Error('QuickBooks can’t be connected right now. Email support@twomiah.com and we will fix it.')
  const ts = now
  const body: Record<string, unknown> = { companyId: p.companyId, ts }
  if (p.userId !== undefined) body.userId = p.userId
  if (p.returnUrl !== undefined) body.returnUrl = p.returnUrl
  body.sig = hmac(secret, material(p.companyId, ts, p.userId, p.returnUrl))
  return Buffer.from(JSON.stringify(body)).toString('base64url')
}

/** The payload when the state is ours, unexpired and untampered (return URL included); null otherwise. */
export function verifyQboState(state: string | undefined | null, secret: string, now: number = Date.now()): QboStatePayload | null {
  if (!state || !secret) return null
  let parsed: any
  try { parsed = JSON.parse(Buffer.from(String(state), 'base64url').toString('utf8')) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  const { companyId, ts, sig, userId, returnUrl } = parsed
  if (!companyId || typeof companyId !== 'string' || typeof ts !== 'number' || typeof sig !== 'string') return null
  if (userId !== undefined && typeof userId !== 'string') return null
  if (returnUrl !== undefined && typeof returnUrl !== 'string') return null
  if (Math.abs(now - ts) > QBO_STATE_TTL_MS) return null
  const expected = Buffer.from(hmac(secret, material(companyId, ts, userId, returnUrl)))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null
  const out: QboStatePayload = { companyId }
  if (userId !== undefined) out.userId = userId
  if (returnUrl !== undefined) out.returnUrl = returnUrl
  return out
}

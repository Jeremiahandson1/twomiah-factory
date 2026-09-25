// Twilio plumbing shared by the SMS and reviews modules: E.164 formatting, a lazily-built client, the
// webhook body parser (Twilio posts application/x-www-form-urlencoded — every template used to call
// c.req.json() on it, which threw, was swallowed, and answered 200 while the inbound text was dropped),
// and REAL request-signature validation. The crm-family "verifyTwilioSignature" returned true and only
// checked that the header existed; fieldservice/landscaping checked nothing.
import crypto from 'crypto'

/**
 * Could this be dialled at all? Ten digits (North America), eleven starting with 1, or an explicitly
 * international +NN… of 8 to 15 digits, which is E.164's own range.
 *
 * formatPhoneE164 will happily turn "123" into "+123", and that went to the carrier: a send was spent,
 * a failed message was written into the customer's thread, and the caller got a 502 — for a typo. The
 * form checked for ten digits; the API, which is the one that can be called directly, did not.
 * (Field Service T30 L-SMS)
 */
export function isDialablePhone(phone: string): boolean {
  const raw = String(phone || '').trim()
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return true
  if (digits.length === 11 && digits.startsWith('1')) return true
  return raw.startsWith('+') && digits.length >= 8 && digits.length <= 15
}

export function formatPhoneE164(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return String(phone || '').startsWith('+') ? String(phone) : `+${digits}`
}

export interface TwilioConfig {
  accountSid?: string
  authToken?: string
  from?: string
  messagingServiceSid?: string
}
export function twilioConfigFromEnv(): TwilioConfig {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    from: process.env.TWILIO_PHONE_NUMBER,
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
  }
}
export const twilioConfigured = (cfg: TwilioConfig) => !!(cfg.accountSid && cfg.authToken && (cfg.from || cfg.messagingServiceSid))

/**
 * The Twilio account a company texts from. Settings → Integrations stores the company's own account in
 * company.integrations (twilioAccountSid / twilioAuthToken / twilioPhoneNumber); older rows carry the same
 * three as columns; the platform account (TWILIO_* env) is the fallback. Before this the SMS service only
 * ever read the env, so a company's own Twilio account was saved and then ignored.
 */
export function twilioConfigFor(companyRow: any): TwilioConfig {
  const j = (companyRow?.integrations || {}) as any
  const env = twilioConfigFromEnv()
  const own = {
    accountSid: j.twilioAccountSid || companyRow?.twilioAccountSid || undefined,
    authToken: j.twilioAuthToken || companyRow?.twilioAuthToken || undefined,
    from: j.twilioPhoneNumber || companyRow?.twilioPhoneNumber || undefined,
  }
  if (own.accountSid && own.authToken) return { accountSid: own.accountSid, authToken: own.authToken, from: own.from || env.from, messagingServiceSid: undefined }
  return { ...env, from: own.from || env.from }
}
/** Every number a company row claims (column + integrations JSON), E.164. */
export function companyTwilioNumbers(companyRow: any): string[] {
  const j = (companyRow?.integrations || {}) as any
  return [companyRow?.twilioPhoneNumber, j.twilioPhoneNumber].filter(Boolean).map((n: string) => formatPhoneE164(n))
}

let _client: any = null
let _clientKey = ''
/** Twilio REST client built on first use (module-load construction crashed boots with empty env). */
export async function twilioClient(cfg: TwilioConfig): Promise<any> {
  if (!cfg.accountSid || !cfg.authToken) throw new Error('SMS not configured')
  const key = `${cfg.accountSid}:${cfg.authToken}`
  if (_client && _clientKey === key) return _client
  const mod: any = await import('twilio')
  _client = (mod.default || mod)(cfg.accountSid, cfg.authToken)
  _clientKey = key
  return _client
}
/** The `from`/`messagingServiceSid` half of a messages.create() call. */
export const twilioSender = (cfg: TwilioConfig) => (cfg.messagingServiceSid ? { messagingServiceSid: cfg.messagingServiceSid } : { from: cfg.from })

/** Twilio webhook body → flat string map. Form-encoded (what Twilio sends) or JSON (tools/tests). */
export async function parseTwilioBody(c: any): Promise<Record<string, string>> {
  const ct = String(c.req.header('content-type') || '').toLowerCase()
  if (ct.includes('application/json')) {
    const j = await c.req.json().catch(() => null)
    return j && typeof j === 'object' ? Object.fromEntries(Object.entries(j).map(([k, v]) => [k, String(v ?? '')])) : {}
  }
  const fd = await c.req.parseBody().catch(() => ({}))
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(fd || {})) if (typeof v === 'string') out[k] = v
  return out
}

/** Twilio's signature: base64(HMAC-SHA1(authToken, url + concat(sorted param key+value))). */
export function twilioSignatureFor(authToken: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('')
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64')
}

/**
 * Validate X-Twilio-Signature against the URL Twilio actually requested. Behind Render's proxy the
 * request reaches us as http, so the https form (from x-forwarded-proto/host) and the port-less form are
 * tried too. With no auth token configured: allowed outside production (local/dev), refused in production.
 */
export function verifyTwilioRequest(c: any, params: Record<string, string>, authToken: string | undefined = process.env.TWILIO_AUTH_TOKEN): { ok: boolean; reason?: string } {
  if (!authToken) return process.env.NODE_ENV === 'production' ? { ok: false, reason: 'TWILIO_AUTH_TOKEN not configured' } : { ok: true, reason: 'no auth token (non-production)' }
  const sig = c.req.header('x-twilio-signature')
  if (!sig) return { ok: false, reason: 'missing X-Twilio-Signature' }
  let u: URL
  try { u = new URL(c.req.url) } catch { return { ok: false, reason: 'bad url' } }
  const host = c.req.header('x-forwarded-host') || c.req.header('host') || u.host
  const proto = c.req.header('x-forwarded-proto') || u.protocol.replace(':', '')
  const pathQ = u.pathname + u.search
  const candidates = new Set<string>([`${proto}://${host}${pathQ}`, `https://${host}${pathQ}`, `http://${host}${pathQ}`, c.req.url])
  for (const cand of Array.from(candidates)) {
    try { const cu = new URL(cand); if (cu.port) candidates.add(`${cu.protocol}//${cu.hostname}${cu.pathname}${cu.search}`) } catch { /* skip */ }
  }
  const given = Buffer.from(sig)
  for (const cand of candidates) {
    const expected = Buffer.from(twilioSignatureFor(authToken, cand, params))
    if (expected.length === given.length && crypto.timingSafeEqual(expected, given)) return { ok: true }
  }
  return { ok: false, reason: 'signature mismatch' }
}

export const TWIML_EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'

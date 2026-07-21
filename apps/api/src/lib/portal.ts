import crypto from 'crypto'

// Signed, short-lived token for the tenant billing portal. The CRM (with its
// factory key) or the factory itself mints a link; the hosted page + its API
// calls authenticate with the token instead of any secret.

function portalSecret(): string {
  return process.env.PORTAL_TOKEN_SECRET || process.env.WEBHOOK_SECRET || process.env.CRON_SECRET || ''
}

export function signPortalToken(tenantId: string, ttlMs = 3_600_000): string {
  const b = Buffer.from(`${tenantId}.${Date.now() + ttlMs}`).toString('base64url')
  const sig = crypto.createHmac('sha256', portalSecret()).update(b).digest('base64url')
  return `${b}.${sig}`
}

export function verifyPortalToken(token: string): string | null {
  try {
    const [b, sig] = (token || '').split('.')
    if (!b || !sig || !portalSecret()) return null
    const expect = crypto.createHmac('sha256', portalSecret()).update(b).digest('base64url')
    const a = Buffer.from(sig), e = Buffer.from(expect)
    if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return null
    const [tenantId, exp] = Buffer.from(b, 'base64url').toString().split('.')
    if (!tenantId || !exp || Date.now() > Number(exp)) return null
    return tenantId
  } catch { return null }
}

export const PORTAL_BASE_URL = process.env.PORTAL_BASE_URL || 'https://twomiah-factory-api.onrender.com'

// A ready-to-open billing-portal link for a tenant (used in emails + by the
// CRM/admin link-minters). TTL is longer here so an emailed link stays usable.
export function portalUrlFor(tenantId: string, ttlMs = 7 * 24 * 3_600_000): string {
  return `${PORTAL_BASE_URL}/api/v1/factory/public/sms-billing?tenant=${tenantId}&t=${signPortalToken(tenantId, ttlMs)}`
}

import { Hono } from 'hono'
import { supabase, authenticate, requireRole } from '../../middleware/auth'
import { timingSafeEqual } from 'crypto'

export type FactoryAuthVariables = {
  user?: { id?: string; email?: string; [k: string]: any }
  userId?: string
  userRole?: string
  factoryUserId?: string
}
export type FactoryApp = Hono<{ Variables: FactoryAuthVariables }>
export const FRONTEND_URL = process.env.PLATFORM_URL || (process.env.NODE_ENV === 'production' ? 'https://twomiah-factory-platform.onrender.com' : 'http://localhost:5173')

// ─── Rate Limiting (in-memory, per IP) ──────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
export function rateLimit(windowMs: number, maxRequests: number) {
  return async (c: any, next: any) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('cf-connecting-ip') || 'unknown'
    const now = Date.now()
    const entry = rateLimitMap.get(ip)
    if (!entry || now > entry.resetAt) {
      rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs })
      return next()
    }
    if (entry.count >= maxRequests) {
      return c.json({ error: 'Too many requests. Please try again later.' }, 429)
    }
    entry.count++
    return next()
  }
}
// Clean up stale entries every 10 minutes
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip)
  }
}, 10 * 60 * 1000)

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const DOMAIN_RE = /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/

// ─── Shared-secret validation (constant-time) ───────────────────────────────
export function secureEquals(a: string, b: string): boolean {
  if (!a || !b) return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

// X-Factory-Key header must match the tenant's stored sync key. Fails closed
// when the tenant has no key or the header is missing.
export function checkFactoryKey(c: { req: { header: (name: string) => string | undefined } }, tenant: { factory_sync_key?: string | null } | null | undefined): boolean {
  const supplied = c.req.header('X-Factory-Key') || ''
  return !!tenant?.factory_sync_key && secureEquals(supplied, tenant.factory_sync_key)
}

// Cron endpoints accept the secret via x-cron-secret or Authorization: Bearer.
// Fails closed when CRON_SECRET is unset.
export function checkCronSecret(c: { req: { header: (name: string) => string | undefined } }): boolean {
  const got = c.req.header('x-cron-secret') || c.req.header('authorization')?.replace(/^Bearer\s+/i, '') || ''
  return secureEquals(got, process.env.CRON_SECRET || '')
}

// Dual auth for tenant self-service endpoints on /customers/:id/* — the
// tenant's CRM calls them with its X-Factory-Key (no Supabase session exists
// on a tenant box), while the platform calls them with an admin JWT. The
// route's path param must be named :id.
export function factoryKeyOrRole(...roles: string[]) {
  return async (c: any, next: any) => {
    if (c.req.header('X-Factory-Key')) {
      const tenantId = c.req.param('id')
      if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID' }, 400)
      const { data: t } = await supabase.from('tenants').select('id, factory_sync_key').eq('id', tenantId).single()
      if (!t || !checkFactoryKey(c, t)) return c.json({ error: 'Unauthorized' }, 401)
      return next()
    }
    // Platform admin path. Run authenticate with a flag-setting next so its
    // 401 Response propagates as our return value, then role-check inline —
    // composing requireRole inside authenticate's next would drop the 403.
    let authed = false
    const authRes = await authenticate(c, async () => { authed = true })
    if (!authed) return authRes
    const userRole = c.get('userRole') as string | undefined
    if (!userRole || !roles.includes(userRole)) {
      return c.json({ error: 'Forbidden — requires role: ' + roles.join(' or ') }, 403)
    }
    return next()
  }
}

// ─── QBO OAuth state tokens (in-memory, 10min expiry) ────────────────────────
export const qboOAuthStates = new Map<string, number>()  // state -> expiry timestamp
export function cleanExpiredStates() {
  const now = Date.now()
  for (const [key, expiry] of qboOAuthStates) {
    if (now > expiry) qboOAuthStates.delete(key)
  }
}

// ─── Tenant Audit Helper ─────────────────────────────────────────────────────
// Logs a row into tenant_audit_log whenever a tenant is modified.
export async function logTenantAudit(
  tenantId: string,
  action: string,
  changes: Record<string, { old: any; new: any }>,
  changedBy?: string,
  note?: string
) {
  if (Object.keys(changes).length === 0) return
  try {
    await supabase.from('tenant_audit_log').insert({
      tenant_id: tenantId,
      action,
      changes,
      changed_by: changedBy || 'system',
      note: note || null,
    })
  } catch (err: any) {
    console.error('[Audit] Failed to write tenant audit log:', err.message)
  }
}

// Build a changes diff object from old and new values
export function diffTenantChanges(
  oldValues: Record<string, any>,
  newValues: Record<string, any>
): Record<string, { old: any; new: any }> {
  const changes: Record<string, { old: any; new: any }> = {}
  for (const key of Object.keys(newValues)) {
    const oldVal = oldValues[key] ?? null
    const newVal = newValues[key] ?? null
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes[key] = { old: oldVal, new: newVal }
    }
  }
  return changes
}

export async function parseJsonBody(c: any): Promise<{ data: any; error?: undefined } | { data?: undefined; error: Response }> {
  try {
    const body = await c.req.json()
    if (body === null || typeof body !== 'object') return { error: c.json({ error: 'Request body must be a JSON object' }, 400) }
    return { data: body }
  } catch {
    return { error: c.json({ error: 'Invalid or missing JSON in request body' }, 400) }
  }
}

/**
 * Append-only audit log. Every admin mutation calls writeAudit(). The
 * write is fire-and-forget — we never want a failed log entry to block
 * a legitimate user action, but a successful one gives the owner a
 * tamper-evident history.
 */
import type { Context } from 'hono'
import { db } from '../db'
import { auditLog as auditLogTbl } from '../db/schema'

function clientIp(c: Context): string {
  const xff = c.req.header('X-Forwarded-For') || ''
  if (xff) return xff.split(',')[0].trim()
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Real-IP') || 'unknown'
}

export async function writeAudit(c: Context, opts: {
  userId?: string | null
  userEmail?: string | null
  action: string
  target?: string | null
  meta?: Record<string, unknown> | null
}): Promise<void> {
  try {
    await db.insert(auditLogTbl).values({
      userId: opts.userId || null,
      userEmail: opts.userEmail || null,
      action: opts.action,
      target: opts.target || null,
      ip: clientIp(c),
      userAgent: (c.req.header('User-Agent') || '').slice(0, 500),
      meta: (opts.meta || null) as any,
    })
  } catch (err: any) {
    console.warn('[audit] write failed:', err?.message)
  }
}

export { clientIp }

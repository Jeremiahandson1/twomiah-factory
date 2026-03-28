// Tenant authentication middleware
// Supports two modes:
// 1. API key in header: Authorization: Bearer re_xxxxx
// 2. JWT token for web UI users

import { Context, Next } from 'hono'
import { db } from '../../db/index.ts'
import { tenant, user } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'roof-estimator-dev-secret'

/**
 * Authenticate via API key or JWT token.
 * Sets c.set('tenant', {...}) and optionally c.set('user', {...})
 */
export async function authenticate(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')
  if (!authHeader) {
    return c.json({ error: 'Authorization header required' }, 401)
  }

  const token = authHeader.replace('Bearer ', '').trim()

  // API key auth (starts with re_)
  if (token.startsWith('re_')) {
    const [t] = await db.select().from(tenant)
      .where(eq(tenant.apiKey, token))
      .limit(1)

    if (!t || !t.active) {
      return c.json({ error: 'Invalid or inactive API key' }, 401)
    }

    c.set('tenant', t)
    return next()
  }

  // JWT auth (web UI)
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any
    const [u] = await db.select().from(user)
      .where(eq(user.id, payload.userId))
      .limit(1)

    if (!u) return c.json({ error: 'User not found' }, 401)

    const [t] = await db.select().from(tenant)
      .where(eq(tenant.id, u.tenantId))
      .limit(1)

    if (!t || !t.active) return c.json({ error: 'Tenant inactive' }, 401)

    c.set('tenant', t)
    c.set('user', u)
    return next()
  } catch {
    return c.json({ error: 'Invalid token' }, 401)
  }
}

/**
 * Optional auth — allows unauthenticated access but sets tenant if present.
 */
export async function optionalAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')
  if (!authHeader) return next()

  try {
    await authenticate(c, async () => {})
  } catch {
    // Ignore auth failures in optional mode
  }
  return next()
}

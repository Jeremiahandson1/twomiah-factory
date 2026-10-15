// Server-side logout (ported from CVHC v51).
//
// Logout used to be client-side only: the browser dropped its token, but the token stayed valid
// until it expired, so a phone or a second tab still holding it kept full access. Now
// POST /api/auth/logout stamps users.last_logout_at, and authenticate refuses any STAFF token issued
// before that moment — one logout ends every session on every device.
//
// Lookups are cached for 30 seconds so the per-request cost is a Map hit, not a query. The check
// FAILS OPEN on a database error: revocation is defence in depth, token expiry is the backstop, and a
// blip must not 401 the whole API. Client-portal tokens carry no userId and pass straight through.
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { users } from '../../db/schema.ts'

const CACHE_TTL_MS = 30 * 1000
const cache = new Map<string, { lastLogoutMs: number | null; expiresAt: number }>()

async function getLastLogoutMs(userId: string): Promise<number | null> {
  const hit = cache.get(userId)
  if (hit && hit.expiresAt > Date.now()) return hit.lastLogoutMs
  const [row] = await db.select({ lastLogoutAt: users.lastLogoutAt }).from(users).where(eq(users.id, userId)).limit(1)
  const lastLogoutMs = row?.lastLogoutAt ? new Date(row.lastLogoutAt).getTime() : null
  cache.set(userId, { lastLogoutMs, expiresAt: Date.now() + CACHE_TTL_MS })
  return lastLogoutMs
}

export async function isStaffTokenRevoked(decoded: any): Promise<boolean> {
  try {
    const userId = decoded?.userId
    if (!userId || typeof userId !== 'string' || !decoded.iat || decoded.role === 'client') return false
    const lastLogoutMs = await getLastLogoutMs(userId)
    if (!lastLogoutMs) return false
    // iat has second granularity — floor the logout time so a re-login in the same second as the
    // logout is not bounced.
    return decoded.iat < Math.floor(lastLogoutMs / 1000)
  } catch (e: any) {
    console.error('Token revocation check failed (allowing request):', e?.message)
    return false
  }
}

/** Stamp the logout and update the cache in place, so revocation is immediate in this process. */
export async function markUserLoggedOut(userId: string): Promise<void> {
  const now = new Date()
  const [row] = await db.update(users)
    .set({ lastLogoutAt: now, refreshToken: null, updatedAt: now })
    .where(eq(users.id, userId))
    .returning({ lastLogoutAt: users.lastLogoutAt })
  const lastLogoutMs = row?.lastLogoutAt ? new Date(row.lastLogoutAt).getTime() : now.getTime()
  cache.set(userId, { lastLogoutMs, expiresAt: Date.now() + CACHE_TTL_MS })
}

/** Test seam: forget cached lookups. */
export function clearRevocationCache() { cache.clear() }

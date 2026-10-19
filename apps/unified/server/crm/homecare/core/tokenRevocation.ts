// Server-side logout (ported to the template from CVHC v51). Moved from
// templates/crm-homecare/backend/src/services/tokenRevocation.ts.
//
// POST /api/auth/logout stamps user.last_logout_at, and a STAFF token issued before that moment is refused — one logout
// ends every session on every device. Lookups are cached for 30 seconds. The check FAILS OPEN on a database error:
// revocation is defence in depth, token expiry is the backstop. Client-portal tokens carry no userId and pass.
//
// In the template, home care's own authenticate called isStaffTokenRevoked. The unified app's sign-in (d.authenticate)
// is the shared one and does not; this keeps both halves so the sign-in step can wire the check where it belongs.
import { eq } from 'drizzle-orm'
import { user } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'

const CACHE_TTL_MS = 30 * 1000

// One cache per database: the app's sign-in check (office/signIn.ts, built before the CRM's deps) and the core's
// instance must see the same sign-out at once, or a logout recorded through one is missed by the other for 30 seconds.
const caches = new WeakMap<object, Map<string, { lastLogoutMs: number | null; expiresAt: number }>>()

export function createTokenRevocation(d: Pick<CrmDeps, 'db' | 'logger'>) {
  const cache = caches.get(d.db) ?? new Map<string, { lastLogoutMs: number | null; expiresAt: number }>()
  caches.set(d.db, cache)

  async function getLastLogoutMs(userId: string): Promise<number | null> {
    const hit = cache.get(userId)
    if (hit && hit.expiresAt > Date.now()) return hit.lastLogoutMs
    const [row] = await d.db.select({ lastLogoutAt: user.lastLogoutAt }).from(user).where(eq(user.id, userId)).limit(1)
    const lastLogoutMs = row?.lastLogoutAt ? new Date(row.lastLogoutAt).getTime() : null
    cache.set(userId, { lastLogoutMs, expiresAt: Date.now() + CACHE_TTL_MS })
    return lastLogoutMs
  }

  /** `decoded` is the verified token's payload ({ userId, role, iat }). */
  async function isStaffTokenRevoked(decoded: any): Promise<boolean> {
    try {
      const userId = decoded?.userId
      if (!userId || typeof userId !== 'string' || !decoded.iat || decoded.role === 'client') return false
      const lastLogoutMs = await getLastLogoutMs(userId)
      if (!lastLogoutMs) return false
      // iat has second granularity — floor the logout time so a re-login in the same second is not bounced.
      return decoded.iat < Math.floor(lastLogoutMs / 1000)
    } catch (e: any) {
      d.logger.error('Token revocation check failed (allowing request)', { error: e?.message })
      return false
    }
  }

  /** Stamp the logout and update the cache in place, so revocation is immediate in this process. */
  async function markUserLoggedOut(userId: string): Promise<void> {
    const now = new Date()
    const [row] = await d.db.update(user)
      .set({ lastLogoutAt: now, refreshToken: null, updatedAt: now })
      .where(eq(user.id, userId))
      .returning({ lastLogoutAt: user.lastLogoutAt })
    const lastLogoutMs = row?.lastLogoutAt ? new Date(row.lastLogoutAt).getTime() : now.getTime()
    cache.set(userId, { lastLogoutMs, expiresAt: Date.now() + CACHE_TTL_MS })
  }

  /** Test seam: forget cached lookups. */
  function clearRevocationCache() { cache.clear() }

  return { isStaffTokenRevoked, markUserLoggedOut, clearRevocationCache }
}

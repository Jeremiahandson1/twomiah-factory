// Gate a route family on the tenant's enabled features — the one feature vocabulary the sidebar, the URL
// gate and the Factory all use (company.enabledFeatures, the switches the owner sees in Settings ›
// Features). The plan-based requireFeature() in each template's featureGate.ts is a different axis.
// Hiding a module in the menu used to leave its API wide open (POST /api/projects still created
// projects — SALON-M1); the salon carried this gate alone until #165 made it the shared one, and #167
// put it in front of every sidebar-gated family fleet-wide. A list of ids means ANY of them unlocks
// the family — the same reading the sidebar gives an item's `features` (e.g. /api/inventory serves
// both Inventory and Parts Inventory).
import type { Context, Next } from 'hono'
import { eq } from 'drizzle-orm'

export interface EnabledFeatureDeps {
  db: any
  tables: { company: any }
}

export function createEnabledFeatureGate({ db, tables: { company } }: EnabledFeatureDeps) {
  const cache = new Map<string, { at: number; list: string[] }>()

  /** The tenant's enabled feature ids, cached for 15 s per company. */
  async function enabledFeaturesFor(companyId: string): Promise<string[]> {
    const hit = cache.get(companyId)
    if (hit && Date.now() - hit.at < 15_000) return hit.list
    const [co] = await db.select({ enabledFeatures: company.enabledFeatures }).from(company).where(eq(company.id, companyId)).limit(1)
    const list = Array.isArray(co?.enabledFeatures) ? (co!.enabledFeatures as string[]) : []
    cache.set(companyId, { at: Date.now(), list })
    return list
  }

  /** One id: is it on. A list: is ANY of them on. */
  const isFeatureEnabled = async (companyId: string, feature: string | string[]) => {
    const list = await enabledFeaturesFor(companyId)
    return (Array.isArray(feature) ? feature : [feature]).some((f) => list.includes(f))
  }

  function requireEnabledFeature(feature: string | string[]) {
    const ids = Array.isArray(feature) ? feature : [feature]
    return async (c: Context, next: Next) => {
      const u = c.get('user') as any
      if (!u?.companyId) return c.json({ error: 'Authentication required' }, 401)
      if (!(await isFeatureEnabled(u.companyId, ids))) return c.json({ error: 'This module is not enabled for your account.', code: 'FEATURE_NOT_ENABLED', feature: ids[0], ...(ids.length > 1 ? { features: ids } : {}) }, 403)
      await next()
    }
  }

  /**
   * Drop the cached list so the very next request re-reads it.
   *
   * Without this the 15 s TTL is also a 15 s lie: the owner switches a module on, the sidebar shows
   * the link immediately (the frontend re-reads /api/auth/me), and the API goes on refusing it —
   * "This module is not enabled for your account" on a module they just enabled. Call it from
   * whatever writes company.enabledFeatures.
   */
  const forgetFeatures = (companyId?: string) => { companyId ? cache.delete(companyId) : cache.clear() }

  return { requireEnabledFeature, isFeatureEnabled, enabledFeaturesFor, forgetFeatures }
}

export type EnabledFeatureGate = ReturnType<typeof createEnabledFeatureGate>

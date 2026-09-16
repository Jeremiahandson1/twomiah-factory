// Gate a route family on the tenant's enabled features — the one feature vocabulary the sidebar, the URL
// gate and the Factory all use (company.enabledFeatures, the switches the owner sees in Settings ›
// Features). The plan-based requireFeature() in each template's featureGate.ts is a different axis.
// Hiding a module in the menu used to leave its API wide open (POST /api/projects still created
// projects — SALON-M1); the salon carried this gate alone until #165 made it the shared one.
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

  const isFeatureEnabled = async (companyId: string, featureId: string) => (await enabledFeaturesFor(companyId)).includes(featureId)

  function requireEnabledFeature(featureId: string) {
    return async (c: Context, next: Next) => {
      const u = c.get('user') as any
      if (!u?.companyId) return c.json({ error: 'Authentication required' }, 401)
      if (!(await isFeatureEnabled(u.companyId, featureId))) return c.json({ error: 'This module is not enabled for your account.', code: 'FEATURE_NOT_ENABLED', feature: featureId }, 403)
      await next()
    }
  }

  return { requireEnabledFeature, isFeatureEnabled, enabledFeaturesFor }
}

export type EnabledFeatureGate = ReturnType<typeof createEnabledFeatureGate>

import type { Context, Next } from 'hono'
import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'

// Gate a route family on the tenant's enabled features (the one feature vocabulary the sidebar,
// the URL gate and the Factory all use). The plan-based requireFeature() in featureGate.ts is a
// different axis; this is the switch the owner sees in Settings › Features. Hiding a module in the
// menu used to leave its API wide open (POST /api/projects still created projects). (SALON-M1)
const cache = new Map<string, { at: number; list: string[] }>()
export function requireEnabledFeature(featureId: string) {
  return async (c: Context, next: Next) => {
    const u = c.get('user') as any
    if (!u?.companyId) return c.json({ error: 'Authentication required' }, 401)
    const hit = cache.get(u.companyId)
    let list = hit && Date.now() - hit.at < 15_000 ? hit.list : null
    if (!list) {
      const [co] = await db.select({ enabledFeatures: company.enabledFeatures }).from(company).where(eq(company.id, u.companyId)).limit(1)
      list = Array.isArray(co?.enabledFeatures) ? (co!.enabledFeatures as string[]) : []
      cache.set(u.companyId, { at: Date.now(), list })
    }
    if (!list.includes(featureId)) return c.json({ error: 'This module is not enabled for your account.', code: 'FEATURE_NOT_ENABLED', feature: featureId }, 403)
    await next()
  }
}

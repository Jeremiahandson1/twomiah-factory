import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { getFeaturesForPlan, getFeaturesForTemplate } from '../shared/featureRegistry.ts'
import { CRM_TEMPLATE } from '../config/template.ts'

// Boot-time fill for a company whose enabledFeatures is EMPTY (tenants provisioned before the Factory
// seeded features, or a wiped column). Resolves the plan through the shared registry — the same
// function the Factory uses — so only registry ids ever land in the column. A populated list is never
// touched here: the Factory sync and Settings → Features own it from then on.
export async function syncFeatures() {
  try {
    const [comp] = await db.select().from(company).limit(1)
    if (!comp) return
    const current = (comp.enabledFeatures || []) as string[]
    if (current.length > 0) {
      console.log(`[featureSync] Company has ${current.length} features — skipping`)
      return
    }
    const plan = process.env.FEATURE_PACKAGE || (comp as any).subscriptionTier || 'starter'
    const desired = new Set(getFeaturesForPlan(CRM_TEMPLATE, plan))
    // The Exterior Visualizer is a paid add-on switched on by the Factory setting VISION_URL.
    if (process.env.VISION_URL && getFeaturesForTemplate(CRM_TEMPLATE).some(f => f.id === 'visualizer')) desired.add('visualizer')
    await db.update(company).set({ enabledFeatures: [...desired], subscriptionTier: plan } as any).where(eq(company.id, comp.id))
    console.log(`[featureSync] Enabled ${desired.size} features for ${plan} plan`)
  } catch (err: any) {
    console.error('[featureSync] Failed to sync features:', err.message)
  }
}

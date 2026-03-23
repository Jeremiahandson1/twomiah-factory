import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { PLAN_FEATURES } from '../shared/plans.ts'

export async function syncFeatures() {
  try {
    const [comp] = await db.select().from(company).limit(1)
    if (!comp) return

    const current = (comp.enabledFeatures || []) as string[]

    // If features are already populated, nothing to do
    if (current.length > 0) {
      console.log(`[featureSync] Company has ${current.length} features — skipping`)
      return
    }

    // Features are empty — resolve from plan tier
    // Priority: FEATURE_PACKAGE env var → company.subscriptionTier → default to starter
    const plan = process.env.FEATURE_PACKAGE || comp.subscriptionTier || 'starter'
    const planFeatures = PLAN_FEATURES[plan]

    if (!planFeatures) {
      // Enterprise or unknown plan — enable everything
      const allFeatures = Object.values(PLAN_FEATURES).flat()
      const desired = [...new Set(allFeatures)]
      await db.update(company).set({ enabledFeatures: desired }).where(eq(company.id, comp.id))
      console.log(`[featureSync] Enabled ${desired.length} features for ${plan} plan (all features)`)
      return
    }

    // Merge plan features with any add-ons from VISION_URL etc.
    const desired = [...new Set(planFeatures)]
    if (process.env.VISION_URL) desired.push('visualizer')

    await db.update(company).set({ enabledFeatures: desired, subscriptionTier: plan }).where(eq(company.id, comp.id))
    console.log(`[featureSync] Enabled ${desired.length} features for ${plan} plan`)
  } catch (err: any) {
    console.error('[featureSync] Failed to sync features:', err.message)
  }
}

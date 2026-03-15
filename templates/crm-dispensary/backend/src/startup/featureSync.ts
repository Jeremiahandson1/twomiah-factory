import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'

// Feature sets by plan tier — dispensary-specific
const PLAN_FEATURES: Record<string, string[]> = {
  starter: [
    'customers', 'products', 'orders', 'pos', 'inventory', 'cash_management',
    'team', 'dashboard', 'receipts', 'compliance',
  ],
  pro: [
    'customers', 'products', 'orders', 'pos', 'inventory', 'cash_management',
    'team', 'dashboard', 'receipts', 'compliance',
    'loyalty', 'analytics', 'sms', 'email_marketing', 'documents',
    'customer_portal', 'order_ahead', 'reports',
  ],
  business: [
    'customers', 'products', 'orders', 'pos', 'inventory', 'cash_management',
    'team', 'dashboard', 'receipts', 'compliance',
    'loyalty', 'analytics', 'sms', 'email_marketing', 'documents',
    'customer_portal', 'order_ahead', 'reports',
    'delivery', 'merch_store', 'advanced_reporting', 'api_access',
  ],
  enterprise: [
    'customers', 'products', 'orders', 'pos', 'inventory', 'cash_management',
    'team', 'dashboard', 'receipts', 'compliance',
    'loyalty', 'analytics', 'sms', 'email_marketing', 'documents',
    'customer_portal', 'order_ahead', 'reports',
    'delivery', 'merch_store', 'advanced_reporting', 'api_access',
    'multi_location', 'custom_integrations', 'priority_support',
  ],
}

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
    const plan = process.env.FEATURE_PACKAGE || comp.subscriptionTier || 'starter'
    const planFeatures = PLAN_FEATURES[plan]

    if (!planFeatures) {
      // Unknown plan — enable everything
      const allFeatures = Object.values(PLAN_FEATURES).flat()
      const desired = [...new Set(allFeatures)]
      await db.update(company).set({ enabledFeatures: desired }).where(eq(company.id, comp.id))
      console.log(`[featureSync] Enabled ${desired.length} features for ${plan} plan (all features)`)
      return
    }

    const desired = [...new Set(planFeatures)]
    await db.update(company).set({ enabledFeatures: desired, subscriptionTier: plan }).where(eq(company.id, comp.id))
    console.log(`[featureSync] Enabled ${desired.length} features for ${plan} plan`)
  } catch (err: any) {
    console.error('[featureSync] Failed to sync features:', err.message)
  }
}

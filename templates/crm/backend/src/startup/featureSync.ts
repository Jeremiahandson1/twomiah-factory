import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'

// Feature sets by plan tier — must stay in sync with auth.ts PLAN_FEATURES
const PLAN_FEATURES: Record<string, string[]> = {
  starter: [
    'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'payments',
    'time_tracking', 'expenses', 'documents', 'customer_portal', 'dashboard', 'mobile_app',
  ],
  pro: [
    'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'payments',
    'time_tracking', 'expenses', 'documents', 'customer_portal', 'dashboard', 'mobile_app',
    'team_management', 'sms', 'sms_templates', 'gps_tracking', 'geofencing', 'auto_clock',
    'route_optimization', 'online_booking', 'review_requests', 'service_agreements',
    'pricebook', 'quickbooks_sync', 'recurring_jobs', 'job_costing',
  ],
  business: [
    'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'payments',
    'time_tracking', 'expenses', 'documents', 'customer_portal', 'dashboard', 'mobile_app',
    'team_management', 'sms', 'sms_templates', 'scheduled_sms', 'gps_tracking', 'geofencing',
    'auto_clock', 'route_optimization', 'online_booking', 'review_requests', 'service_agreements',
    'pricebook', 'quickbooks_sync', 'recurring_jobs', 'job_costing', 'inventory',
    'inventory_locations', 'stock_levels', 'inventory_transfers', 'purchase_orders',
    'equipment_tracking', 'equipment_maintenance', 'fleet_vehicles', 'fleet_maintenance',
    'fleet_fuel', 'warranties', 'warranty_claims', 'email_templates', 'email_campaigns',
    'call_tracking', 'automations', 'custom_forms', 'consumer_financing', 'advanced_reporting',
  ],
  construction: [
    'contacts', 'jobs', 'scheduling', 'quotes', 'invoices', 'payments',
    'time_tracking', 'expenses', 'documents', 'customer_portal', 'dashboard', 'mobile_app',
    'team_management', 'sms', 'sms_templates', 'scheduled_sms', 'gps_tracking', 'geofencing',
    'auto_clock', 'route_optimization', 'online_booking', 'review_requests', 'service_agreements',
    'pricebook', 'quickbooks_sync', 'recurring_jobs', 'job_costing', 'inventory',
    'inventory_locations', 'stock_levels', 'inventory_transfers', 'purchase_orders',
    'equipment_tracking', 'equipment_maintenance', 'fleet_vehicles', 'fleet_maintenance',
    'fleet_fuel', 'warranties', 'warranty_claims', 'email_templates', 'email_campaigns',
    'call_tracking', 'automations', 'custom_forms', 'consumer_financing', 'advanced_reporting',
    'projects', 'project_budgets', 'project_phases', 'change_orders', 'rfis', 'submittals',
    'daily_logs', 'punch_lists', 'inspections', 'bids', 'gantt_charts', 'selections',
    'selection_portal', 'takeoffs', 'lien_waivers', 'draw_schedules', 'draw_requests', 'aia_forms',
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

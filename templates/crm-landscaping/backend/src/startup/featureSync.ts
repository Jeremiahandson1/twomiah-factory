import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'

const ALL_FEATURES = [
  'contacts', 'jobs', 'quotes', 'invoices', 'scheduling', 'team', 'dashboard',
  'documents', 'photos', 'payments',
  'gps_tracking', 'route_optimization', 'equipment_tracking', 'fleet',
  'inspections', 'daily_logs', 'punch_lists',
  'projects', 'change_orders', 'rfis', 'bids', 'gantt', 'selections',
  'takeoffs', 'takeoff_tools', 'lien_waivers', 'draw_schedules', 'job_costing',
  'service_agreements', 'warranties', 'recurring_jobs', 'pricebook',
  'consumer_financing',
  'email_campaigns', 'email_marketing', 'google_reviews', 'reviews',
  'referral_program', 'call_tracking', 'two_way_texting', 'sms',
  'quickbooks', 'customer_portal', 'online_booking',
  'inventory', 'purchase_orders', 'reports', 'bid_management',
]

export async function syncFeatures() {
  const pkg = process.env.FEATURE_PACKAGE
  if (!pkg) return

  const features = pkg === 'enterprise' ? ALL_FEATURES : []
  if (features.length === 0) return

  try {
    const [comp] = await db.select().from(company).limit(1)
    if (!comp) return

    const current = new Set((comp.enabledFeatures || []) as string[])
    const desired = [...new Set(features)]
    const alreadySet = desired.every(f => current.has(f))

    if (alreadySet) {
      console.log(`[featureSync] ${pkg} features already set — skipping`)
      return
    }

    await db.update(company).set({ enabledFeatures: desired }).where(eq(company.id, comp.id))
    console.log(`[featureSync] Enabled ${desired.length} features for ${pkg} package`)
  } catch (err: any) {
    console.error('[featureSync] Failed to sync features:', err.message)
  }
}

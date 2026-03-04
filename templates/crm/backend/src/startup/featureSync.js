/**
 * Feature Sync - runs once on startup
 * If FEATURE_PACKAGE=enterprise, enables ALL features on the company record.
 */

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
];

export async function syncFeatures(prisma) {
  const pkg = process.env.FEATURE_PACKAGE;
  if (!pkg) return;

  const features = pkg === 'enterprise' ? ALL_FEATURES : [];
  if (features.length === 0) return;

  try {
    const company = await prisma.company.findFirst();
    if (!company) return;

    const current = new Set(company.enabledFeatures || []);
    const desired = [...new Set(features)];
    const alreadySet = desired.every(f => current.has(f));

    if (alreadySet) {
      console.log(`[featureSync] ${pkg} features already set — skipping`);
      return;
    }

    await prisma.company.update({
      where: { id: company.id },
      data: { enabledFeatures: desired },
    });

    console.log(`[featureSync] Enabled ${desired.length} features for ${pkg} package`);
  } catch (err) {
    console.error('[featureSync] Failed to sync features:', err.message);
  }
}

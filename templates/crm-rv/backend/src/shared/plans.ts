// Feature sets for each plan tier
export const PLAN_FEATURES: Record<string, string[]> = {
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
  enterprise: ['all'],
}

// Plan limits
export const PLAN_LIMITS: Record<string, { users: number | null; contacts: number | null; jobs: number | null; storage: number | null }> = {
  starter: { users: 2, contacts: 500, jobs: 100, storage: 5 },
  pro: { users: 5, contacts: 2500, jobs: 500, storage: 25 },
  business: { users: 15, contacts: 10000, jobs: 2000, storage: 100 },
  construction: { users: 20, contacts: 25000, jobs: 5000, storage: 250 },
  enterprise: { users: null, contacts: null, jobs: null, storage: null },
}

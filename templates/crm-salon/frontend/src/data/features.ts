// Complete {{COMPANY_NAME}} Feature Definitions
// All 85+ features from the comparison document

// Feature catalog for the self-serve Settings -> Features page.
//
// Deliberately lists ONLY the ids that (a) the factory can actually grant a
// crm-salon tenant and (b) something in THIS app gates. The inherited
// contractor catalog listed 85 ids — BIM viewer, RFIs, takeoffs, lien waivers —
// none of which a salon can be granted and none of which are wired to anything
// here, so every one of them was a toggle that did nothing.
//
// Toggling is non-destructive to ids not listed here: FeaturesSettingsPage
// seeds its selection from the company's real enabledFeatures and saves that
// set back, so an unlisted id is preserved rather than switched off.
//
// When a new hasFeature() gate is added to the app, add its id here too.
export const FEATURE_CATEGORIES = [
  {
    id: 'salon',
    name: 'Salon Operations',
    icon: 'Scissors',
    description: 'The chair, the chart, and getting clients back in',
    features: [
      { id: 'client_profiles', name: 'Client Profiles', description: 'Hair type, allergies and patch-test dates, preferences, regular stylist, lifetime value' },
      { id: 'service_menu', name: 'Service Menu', description: 'Priced menu with durations and per-service rebook intervals' },
      { id: 'salon_booking', name: 'The Book', description: 'Chair and stylist scheduling with check-in and double-book protection' },
      { id: 'rebooking_reminders', name: 'Rebooking & Recall', description: 'Who is due back, who has lapsed, whose birthday is coming — with bulk texting' },
      { id: 'salon_memberships', name: 'Memberships & Packages', description: 'Recurring memberships and prepaid visit packages' },
    ]
  },
  {
    id: 'money',
    name: 'Money & Records',
    icon: 'CreditCard',
    description: 'Billing and the paperwork behind it',
    features: [
      { id: 'invoices', name: 'Invoices', description: 'Bill clients and take card payments online' },
      { id: 'documents', name: 'Documents', description: 'Store consent forms, waivers and client files' },
      { id: 'reports', name: 'Reports', description: 'Revenue, retention and chair-productivity reporting' },
    ]
  },
  {
    id: 'growth',
    name: 'Marketing & Communication',
    icon: 'Megaphone',
    description: 'Filling the book and staying in touch',
    features: [
      { id: 'two_way_texting', name: 'Two-Way Texting', description: 'Text clients from the CRM and see replies in one thread' },
      { id: 'branded_email', name: 'Branded Email', description: 'support@yourdomain addresses — forward anywhere or receive replies in the CRM email inbox' },
      { id: 'lead_inbox', name: 'Lead Inbox', description: 'New enquiries from your website land in one place' },
      { id: 'google_business', name: 'Google Reviews', description: 'Connect your Google Business Profile — see your rating and reply to reviews from the CRM' },
      { id: 'google_reviews', name: 'Review Requests', description: 'Ask happy clients for a review automatically after their visit' },
    ]
  },
];

// Preset packages
export const PRESET_PACKAGES = [
  {
    id: 'service_starter',
    name: 'Service Starter',
    description: 'For home service businesses - HVAC, plumbing, electrical',
    price: '$3,500 one-time or $99/mo',
    features: [
      'contact_database', 'client_history', 'communication_history', 'lead_management',
      'professional_quotes', 'quote_templates', 'online_approval', 'deposit_collection',
      'drag_drop_calendar', 'online_booking', 'service_dispatch', 'route_optimization',
      'map_view', 'recurring_jobs', 'visit_reminders',
      'work_orders', 'job_forms', 'on_my_way', 'time_tracking', 'gps_tracking', 'photo_capture',
      'invoice_generation', 'invoice_reminders', 'online_payments',
      'job_costing', 'quickbooks',
      'email_integration', 'two_way_texting', 'push_notifications',
      'user_permissions', 'timesheet_management',
      'mobile_app', 'unlimited_users',
    ]
  },
  {
    id: 'project_pro',
    name: 'Project Pro',
    description: 'For general contractors and remodelers',
    price: '$5,500 one-time or $199/mo',
    features: [
      // All Service Starter features plus:
      'contact_database', 'client_history', 'communication_history', 'lead_management', 'client_portal', 'subcontractor_portal',
      'professional_quotes', 'quote_templates', 'optional_addons', 'cost_markups', 'online_approval', 'quote_followups', 'deposit_collection',
      'drag_drop_calendar', 'online_booking', 'service_dispatch', 'route_optimization', 'map_view', 'recurring_jobs', 'team_notifications', 'visit_reminders', 'gantt_schedules',
      'work_orders', 'job_forms', 'on_my_way', 'time_tracking', 'gps_tracking', 'photo_capture', 'daily_logs', 'job_followups',
      'rfis', 'submittals', 'punch_lists', 'change_orders', 'drawings',
      'observations', 'inspections', 'custom_forms_builder',
      'invoice_generation', 'batch_invoicing', 'invoice_reminders', 'online_payments', 'tm_tickets',
      'job_costing', 'profit_bar', 'material_costs', 'labor_costs', 'expense_tracking', 'budget_tracking', 'financial_reports', 'quickbooks',
      'email_integration', 'two_way_texting', 'team_messaging', 'automated_followups', 'activity_feed', 'push_notifications',
      'user_permissions', 'gps_waypoints', 'timesheet_management',
      'mobile_app', 'unlimited_users', 'unlimited_storage', 'api_access',
    ]
  },
  {
    id: 'contractor_suite',
    name: 'Contractor Suite',
    description: 'Full-featured for commercial contractors',
    price: '$7,500 one-time or $349/mo',
    features: [
      // All Project Pro features plus full construction PM
      'contact_database', 'client_history', 'communication_history', 'lead_management', 'client_portal', 'subcontractor_portal',
      'google_reviews', 'email_marketing', 'referral_program',
      'professional_quotes', 'quote_templates', 'optional_addons', 'cost_markups', 'online_approval', 'quote_followups', 'deposit_collection',
      'drag_drop_calendar', 'online_booking', 'service_dispatch', 'route_optimization', 'map_view', 'recurring_jobs', 'team_notifications', 'visit_reminders', 'gantt_schedules',
      'work_orders', 'job_forms', 'on_my_way', 'time_tracking', 'gps_tracking', 'photo_capture', 'daily_logs', 'job_followups',
      'rfis', 'submittals', 'punch_lists', 'change_orders', 'drawings', 'specifications', 'meetings', 'action_plans', 'transmittals', 'correspondence',
      'observations', 'inspections', 'custom_forms_builder', 'incidents', 'safety_checklists',
      'bid_management', 'bidder_prequalification', 'bid_leveling', 'takeoff_tools',
      'invoice_generation', 'batch_invoicing', 'invoice_reminders', 'online_payments', 'auto_charge', 'tap_to_pay', 'instant_payouts', 'tips', 'tm_tickets',
      'job_costing', 'profit_bar', 'material_costs', 'labor_costs', 'expense_tracking', 'budget_tracking', 'financial_reports', 'quickbooks',
      'bim_viewer', 'coordination_issues', 'ai_assistant', 'custom_dashboards', 'portfolio_analytics', 'training_lms',
      'email_integration', 'two_way_texting', 'team_messaging', 'automated_followups', 'activity_feed', 'push_notifications',
      'user_permissions', 'gps_waypoints', 'timesheet_management', 'job_checklists_training',
      'mobile_app', 'unlimited_users', 'unlimited_storage', 'api_access', 'zapier',
    ]
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Everything + white label + source code',
    price: '$12,000 one-time',
    features: 'all', // Special flag to include all features
  },
];

// Get all feature IDs
export const getAllFeatureIds = (): string[] => {
  const ids: string[] = [];
  FEATURE_CATEGORIES.forEach((cat: { id: string; features: { id: string }[] }) => {
    cat.features.forEach((f: { id: string }) => ids.push(f.id));
  });
  return ids;
};

// Get feature by ID
export const getFeatureById = (id: string): { id: string; name: string; description: string; category: string; categoryName: string } | null => {
  for (const cat of FEATURE_CATEGORIES) {
    const feature = cat.features.find((f: { id: string }) => f.id === id);
    if (feature) return { ...feature, category: cat.id, categoryName: cat.name };
  }
  return null;
};

// Get category by ID
export const getCategoryById = (id: string) => {
  return FEATURE_CATEGORIES.find((c: { id: string }) => c.id === id);
};

// Count features
export const getTotalFeatureCount = (): number => {
  return FEATURE_CATEGORIES.reduce((sum: number, cat: { features: unknown[] }) => sum + cat.features.length, 0);
};

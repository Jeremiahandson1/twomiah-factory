// Complete {{COMPANY_NAME}} Feature Definitions
// All 85+ features from the comparison document

export const FEATURE_CATEGORIES = [
  {
    id: 'marketing',
    name: 'Marketing & Customer Acquisition',
    icon: 'Megaphone',
    description: 'Tools to attract and convert new customers',
    features: [
      { id: 'google_reviews', name: 'Google Reviews Automation', description: 'Automatically request and manage Google reviews from customers' },
      { id: 'email_marketing', name: 'Email Marketing Campaigns', description: 'Create and send targeted email campaigns to leads and customers' },
      { id: 'referral_program', name: 'Referral Program', description: 'Track and reward customer referrals with automated workflows' },
      { id: 'paid_ads', name: 'Paid Ads', description: 'Run and track paid advertising campaigns' },
      { id: 'website_builder', name: 'Website Builder', description: 'Build and host a professional website for your business' },
      { id: 'seo_tools', name: 'SEO Tools', description: 'Optimize your website for search engines to get more leads' },
    ]
  },
  {
    id: 'quoting',
    name: 'Quoting & Estimating',
    icon: 'Calculator',
    description: 'Create and manage professional quotes',
    features: [
      { id: 'professional_quotes', name: 'Professional Quotes', description: 'Create branded, professional quotes with line items and totals' },
      { id: 'quote_templates', name: 'Quote Templates', description: 'Save and reuse quote templates for common job types' },
      { id: 'optional_addons', name: 'Optional Add-ons / Upsells', description: 'Include optional items customers can add to their quote' },
      { id: 'cost_markups', name: 'Cost Markups', description: 'Apply markup percentages to materials and labor costs' },
      { id: 'online_approval', name: 'Online Quote Approval', description: 'Let customers approve quotes with digital signatures' },
      { id: 'quote_followups', name: 'Automated Quote Follow-ups', description: 'Automatically follow up on pending quotes via email/text' },
      { id: 'deposit_collection', name: 'Deposit Collection', description: 'Collect deposits when quotes are approved' },
    ]
  },
  {
    id: 'scheduling',
    name: 'Service Scheduling',
    icon: 'Calendar',
    description: 'Schedule service appointments',
    features: [
      { id: 'drag_drop_calendar', name: 'Drag & Drop Calendar', description: 'Visual calendar for scheduling service appointments' },
      { id: 'online_booking', name: 'Online Booking by Customers', description: 'Let customers book service appointments directly from your website' },
      { id: 'visit_reminders', name: 'Automated Appointment Reminders', description: 'Send automatic reminders to customers before scheduled appointments' },
    ]
  },
  {
    id: 'crm',
    name: 'CRM & Customer Management',
    icon: 'Users',
    description: 'Manage contacts and customer relationships',
    features: [
      { id: 'contact_database', name: 'Contact/Customer Database', description: 'Centralized database of all contacts and customers' },
      { id: 'client_history', name: 'Customer History', description: 'View complete purchase and service history for each customer' },
      { id: 'communication_history', name: 'Communication History', description: 'Track all communications with customers' },
      { id: 'lead_management', name: 'Lead Management / Tagging', description: 'Track leads through your sales pipeline' },
      { id: 'client_portal', name: 'Customer Portal (Self-Service)', description: 'Give customers a portal to view deals and pay invoices' },
    ]
  },
  {
    id: 'communication',
    name: 'Communication',
    icon: 'MessageSquare',
    description: 'Team and client communication tools',
    features: [
      { id: 'email_integration', name: 'Email Integration', description: 'Connect your email for logging and sending' },
      { id: 'two_way_texting', name: 'Two-Way Text Messaging', description: 'Send and receive SMS with clients and team' },
      { id: 'team_messaging', name: 'Team Messaging / Conversations', description: 'Internal team chat and conversations' },
      { id: 'automated_followups', name: 'Automated Follow-up Emails/Texts', description: 'Automated communication sequences' },
      { id: 'activity_feed', name: 'Real-Time Activity Feed', description: 'Live feed of all activity across jobs and projects' },
      { id: 'push_notifications', name: 'Mobile Push Notifications', description: 'Push notifications to mobile apps' },
    ]
  },
  {
    id: 'invoicing',
    name: 'Invoicing & Payments',
    icon: 'CreditCard',
    description: 'Invoice and collect payments',
    features: [
      { id: 'invoice_generation', name: 'Invoice Generation', description: 'Create professional invoices from jobs or quotes' },
      { id: 'batch_invoicing', name: 'Batch Invoicing', description: 'Generate multiple invoices at once' },
      { id: 'invoice_reminders', name: 'Automated Invoice Reminders', description: 'Automatically remind customers of unpaid invoices' },
      { id: 'online_payments', name: 'Online Credit Card Payments', description: 'Accept credit card payments online' },
      { id: 'auto_charge', name: 'Auto-Charge Cards on File', description: 'Automatically charge saved payment methods' },
      { id: 'tap_to_pay', name: 'Tap to Pay (Mobile)', description: 'Accept in-person payments via mobile device' },
      { id: 'instant_payouts', name: 'Instant Payouts', description: 'Get paid instantly instead of waiting for transfers' },
      { id: 'tips', name: 'Tips on Invoices', description: 'Allow customers to add tips when paying' },
    ]
  },
  {
    id: 'financial',
    name: 'Financial Management',
    icon: 'PieChart',
    description: 'Accounting and financial tracking',
    features: [
      { id: 'financial_reports', name: 'Financial Reports', description: 'Generate profit/loss and financial reports' },
      { id: 'quickbooks', name: 'QuickBooks Integration', description: 'Two-way sync with QuickBooks Online' },
    ]
  },
  {
    id: 'dealership',
    name: 'Dealership (RV & Powersports)',
    icon: 'Caravan',
    description: 'Inventory, sales pipeline, and service for RV & powersports dealers',
    features: [
      { id: 'unit_inventory', name: 'Unit Inventory', description: 'Manage RV, motorhome, towable, and powersports units with category-specific specs' },
      { id: 'deal_pipeline', name: 'Sales Pipeline', description: 'Kanban deal pipeline from first contact through delivery, with ADF lead import' },
      { id: 'service_dept', name: 'Service Department', description: 'Repair orders, advisors, and shop status with service-to-sales alerts' },
      { id: 'deal_desk', name: 'Deal Desk', description: 'Payment calculator with trade allowance, tax, financing, and estimated monthly payment for any deal' },
      { id: 'trade_in', name: 'Trade-In Appraisal', description: 'Capture trade allowance and payoff on a deal for an accurate amount financed' },
      { id: 'recall_lookup', name: 'Recall Lookup', description: 'Check open NHTSA safety recalls for any inventory unit' },
      { id: 'inventory_syndication', name: 'Inventory Syndication', description: 'Export your inventory feed to RV Trader, Cycle Trader, and other marketplaces' },
      { id: 'service_status_texts', name: 'Service Status Texts', description: 'Automatically text customers as their repair order moves through the shop' },
      { id: 'follow_up_sequences', name: 'Automated Follow-Up Sequences', description: 'Drip email/text sequences to keep leads warm from first contact to delivery' },
    ]
  },
  {
    id: 'advanced',
    name: 'Advanced Features & AI',
    icon: 'Sparkles',
    description: 'Advanced tools and AI capabilities',
    features: [
      { id: 'ai_assistant', name: 'AI Assistant / Copilot', description: 'AI-powered assistance for common tasks' },
      { id: 'custom_dashboards', name: 'Custom Dashboards', description: 'Build custom dashboards with widgets' },
      { id: 'portfolio_analytics', name: 'Portfolio Analytics', description: 'Analytics across all deals and units' },
      { id: 'training_lms', name: 'Training Center / LMS', description: 'Learning management for team training' },
    ]
  },
  {
    id: 'team',
    name: 'Team Management',
    icon: 'UserCog',
    description: 'Manage your team and permissions',
    features: [
      { id: 'user_permissions', name: 'User Permissions / Roles', description: 'Role-based access control for team members' },
      { id: 'timesheet_management', name: 'Timesheet Management', description: 'Review and approve team timesheets' },
    ]
  },
  {
    id: 'platform',
    name: 'Platform & Deployment',
    icon: 'Server',
    description: 'Platform features and deployment options',
    features: [
      { id: 'mobile_app', name: 'Mobile App (iOS & Android)', description: 'Native mobile apps for field workers' },
      { id: 'unlimited_users', name: 'Unlimited Users', description: 'No per-user fees or limits' },
      { id: 'unlimited_storage', name: 'Unlimited Storage', description: 'No storage limits for files and photos' },
      { id: 'api_access', name: 'API Access', description: 'REST API for custom integrations' },
      { id: 'zapier', name: 'Zapier Integration', description: 'Connect to 5000+ apps via Zapier' },
      { id: 'self_hosted', name: 'Self-Hosted Option', description: 'Deploy on your own servers' },
      { id: 'one_time_purchase', name: 'One-Time Purchase Option', description: 'Buy outright instead of subscription' },
      { id: 'white_label', name: 'White Label / Custom Branding', description: 'Rebrand as your own product' },
      { id: 'source_code', name: 'Source Code Access', description: 'Full access to source code for customization' },
    ]
  },
];

// Preset packages
export const PRESET_PACKAGES = [
  {
    id: 'dealer_starter',
    name: 'Dealer Starter',
    description: 'For single-location RV & powersports dealers',
    price: '$3,500 one-time or $99/mo',
    features: [
      'contact_database', 'client_history', 'communication_history', 'lead_management',
      'unit_inventory', 'deal_pipeline', 'service_dept', 'trade_in',
      'professional_quotes', 'quote_templates', 'online_approval',
      'drag_drop_calendar', 'online_booking', 'visit_reminders',
      'invoice_generation', 'invoice_reminders', 'online_payments',
      'quickbooks',
      'email_integration', 'two_way_texting',
      'user_permissions',
      'mobile_app', 'unlimited_users',
    ]
  },
  {
    id: 'dealer_pro',
    name: 'Dealer Pro',
    description: 'For growing RV, powersports & marine dealerships',
    price: '$5,500 one-time or $199/mo',
    features: [
      'contact_database', 'client_history', 'communication_history', 'lead_management', 'client_portal',
      'google_reviews', 'email_marketing', 'referral_program', 'paid_ads',
      'unit_inventory', 'deal_pipeline', 'service_dept', 'deal_desk', 'trade_in',
      'recall_lookup', 'inventory_syndication', 'service_status_texts', 'follow_up_sequences',
      'consumer_financing', 'trade_valuation',
      'professional_quotes', 'quote_templates', 'optional_addons', 'online_approval', 'quote_followups', 'deposit_collection',
      'drag_drop_calendar', 'online_booking', 'visit_reminders',
      'invoice_generation', 'batch_invoicing', 'invoice_reminders', 'online_payments',
      'financial_reports', 'quickbooks',
      'email_integration', 'two_way_texting', 'team_messaging', 'automated_followups', 'activity_feed', 'push_notifications',
      'user_permissions', 'timesheet_management',
      'mobile_app', 'unlimited_users', 'unlimited_storage', 'api_access',
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

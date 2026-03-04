// Complete Twomiah Build Feature Definitions
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
      { id: 'website_builder', name: 'Website Builder', description: 'Build and host a professional website for your business' },
      { id: 'seo_tools', name: 'SEO Tools', description: 'Optimize your website for search engines to get more leads' },
      { id: 'ai_receptionist', name: 'AI Receptionist / Auto-Answering', description: 'Automatically answer calls and texts with AI' },
      { id: 'consumer_financing', name: 'Consumer Financing (Wisetack)', description: 'Offer customers financing options at checkout' },
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
    name: 'Scheduling & Dispatch',
    icon: 'Calendar',
    description: 'Schedule jobs and dispatch field teams',
    features: [
      { id: 'drag_drop_calendar', name: 'Drag & Drop Calendar', description: 'Visual calendar for scheduling jobs and appointments' },
      { id: 'online_booking', name: 'Online Booking by Customers', description: 'Let customers book appointments directly from your website' },
      { id: 'service_dispatch', name: 'Service Dispatching', description: 'Dispatch jobs to field workers with all job details' },
      { id: 'route_optimization', name: 'Route Optimization', description: 'Optimize routes for multiple job visits to save time and fuel' },
      { id: 'map_view', name: 'Map View of Jobs', description: 'View all scheduled jobs on a map interface' },
      { id: 'recurring_jobs', name: 'Recurring Jobs', description: 'Set up repeating jobs on daily, weekly, or monthly schedules' },
      { id: 'team_notifications', name: 'Team Push Notifications', description: 'Send instant notifications to team members about job updates' },
      { id: 'visit_reminders', name: 'Automated Visit Reminders', description: 'Send automatic reminders to customers before scheduled visits' },
      { id: 'gantt_schedules', name: 'Project Schedules (Gantt)', description: 'Create Gantt chart schedules for complex projects' },
    ]
  },
  {
    id: 'job_execution',
    name: 'Job Execution & Field Work',
    icon: 'Wrench',
    description: 'Tools for executing work in the field',
    features: [
      { id: 'work_orders', name: 'Work Orders', description: 'Create and manage detailed work orders for jobs' },
      { id: 'job_forms', name: 'Job Forms & Checklists', description: 'Custom forms and checklists for job completion' },
      { id: 'on_my_way', name: 'On-My-Way Texts', description: 'Automatically text customers when technicians are en route' },
      { id: 'time_tracking', name: 'Time Tracking', description: 'Track time spent on each job for billing and payroll' },
      { id: 'gps_tracking', name: 'GPS Location Tracking', description: 'Track field worker locations in real-time' },
      { id: 'location_auto_time', name: 'Location-Based Auto Time Tracking', description: 'Automatically clock in/out when arriving at or leaving job sites' },
      { id: 'photo_capture', name: 'Photo & Video Capture', description: 'Capture before/after photos and videos on job sites' },
      { id: 'daily_logs', name: 'Daily Logs', description: 'Record daily job progress, weather, and activities' },
      { id: 'job_followups', name: 'Automated Job Follow-ups', description: 'Follow up with customers after job completion' },
    ]
  },
  {
    id: 'construction_pm',
    name: 'Construction Project Management',
    icon: 'Building2',
    description: 'Professional construction project tools',
    features: [
      { id: 'rfis', name: 'RFIs (Request for Information)', description: 'Submit and track requests for information from stakeholders' },
      { id: 'submittals', name: 'Submittals', description: 'Manage product submittals and approval workflows' },
      { id: 'punch_lists', name: 'Punch Lists', description: 'Track completion items and deficiencies' },
      { id: 'change_orders', name: 'Change Orders', description: 'Document and track project change orders' },
      { id: 'drawings', name: 'Drawings Management', description: 'Upload, version, and share project drawings' },
      { id: 'specifications', name: 'Specifications', description: 'Manage project specifications and spec sections' },
      { id: 'meetings', name: 'Meetings & Minutes', description: 'Schedule meetings and record meeting minutes' },
      { id: 'action_plans', name: 'Action Plans', description: 'Create action items with owners and due dates' },
      { id: 'transmittals', name: 'Transmittals', description: 'Track document transmittals between parties' },
      { id: 'correspondence', name: 'Correspondence Tracking', description: 'Log and track all project correspondence' },
    ]
  },
  {
    id: 'quality_safety',
    name: 'Quality & Safety',
    icon: 'ShieldCheck',
    description: 'Quality control and safety management',
    features: [
      { id: 'observations', name: 'Observations', description: 'Record field observations with photos and notes' },
      { id: 'inspections', name: 'Inspections', description: 'Schedule and complete quality inspections' },
      { id: 'custom_forms_builder', name: 'Custom Forms Builder', description: 'Build custom inspection and quality forms' },
      { id: 'incidents', name: 'Incidents Tracking', description: 'Document and investigate safety incidents' },
      { id: 'safety_checklists', name: 'Safety Checklists', description: 'Pre-built and custom safety checklists' },
    ]
  },
  {
    id: 'bidding',
    name: 'Bidding & Preconstruction',
    icon: 'Gavel',
    description: 'Bid management and preconstruction tools',
    features: [
      { id: 'bid_management', name: 'Bid Management', description: 'Manage bid packages and invitations' },
      { id: 'bidder_prequalification', name: 'Bidder Prequalification', description: 'Prequalify subcontractors before bidding' },
      { id: 'bid_leveling', name: 'Bid Leveling / Comparison', description: 'Compare and level bids side-by-side' },
      { id: 'takeoff_tools', name: 'Takeoff Tools', description: 'Measure quantities from drawings for estimates' },
    ]
  },
  {
    id: 'crm',
    name: 'CRM & Client Management',
    icon: 'Users',
    description: 'Manage contacts and client relationships',
    features: [
      { id: 'contact_database', name: 'Contact/Client Database', description: 'Centralized database of all contacts and clients' },
      { id: 'client_history', name: 'Client Job History', description: 'View complete job history for each client' },
      { id: 'communication_history', name: 'Communication History', description: 'Track all communications with clients' },
      { id: 'lead_management', name: 'Lead Management / Tagging', description: 'Track leads through your sales pipeline' },
      { id: 'client_portal', name: 'Client Portal (Self-Service)', description: 'Give clients a portal to view jobs and pay invoices' },
      { id: 'subcontractor_portal', name: 'Subcontractor Portal', description: 'Portal for subcontractors to view assignments' },
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
      { id: 'tm_tickets', name: 'T&M Tickets (Time & Material)', description: 'Generate time and material tickets for billing' },
    ]
  },
  {
    id: 'financial',
    name: 'Financial Management',
    icon: 'PieChart',
    description: 'Job costing and financial tracking',
    features: [
      { id: 'job_costing', name: 'Job Costing', description: 'Track all costs against jobs for profitability' },
      { id: 'profit_bar', name: 'Job Profit Bar / Margin View', description: 'Visual profit margin display on each job' },
      { id: 'material_costs', name: 'Material Cost Tracking', description: 'Track material costs per job' },
      { id: 'labor_costs', name: 'Labor Cost Tracking', description: 'Track labor costs per job from time entries' },
      { id: 'expense_tracking', name: 'Expense Tracking w/ Receipts', description: 'Log expenses and attach receipt photos' },
      { id: 'budget_tracking', name: 'Budget Tracking', description: 'Set and track budgets on projects' },
      { id: 'financial_reports', name: 'Financial Reports', description: 'Generate profit/loss and financial reports' },
      { id: 'quickbooks', name: 'QuickBooks Integration', description: 'Two-way sync with QuickBooks Online' },
    ]
  },
  {
    id: 'advanced',
    name: 'Advanced Features & AI',
    icon: 'Sparkles',
    description: 'Advanced tools and AI capabilities',
    features: [
      { id: 'bim_viewer', name: 'BIM Model Viewer', description: 'View 3D BIM models in the browser' },
      { id: 'coordination_issues', name: 'Coordination Issues', description: 'Track BIM/VDC coordination issues' },
      { id: 'ai_assistant', name: 'AI Assistant / Copilot', description: 'AI-powered assistance for common tasks' },
      { id: 'custom_dashboards', name: 'Custom Dashboards', description: 'Build custom dashboards with widgets' },
      { id: 'portfolio_analytics', name: 'Portfolio Analytics', description: 'Analytics across all projects/jobs' },
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
      { id: 'gps_waypoints', name: 'GPS Waypoints / Team Location', description: 'View team member locations on map' },
      { id: 'timesheet_management', name: 'Timesheet Management', description: 'Review and approve team timesheets' },
      { id: 'job_checklists_training', name: 'Job Checklists for Training', description: 'Training checklists for new team members' },
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
export const getAllFeatureIds = () => {
  const ids = [];
  FEATURE_CATEGORIES.forEach(cat => {
    cat.features.forEach(f => ids.push(f.id));
  });
  return ids;
};

// Get feature by ID
export const getFeatureById = (id) => {
  for (const cat of FEATURE_CATEGORIES) {
    const feature = cat.features.find(f => f.id === id);
    if (feature) return { ...feature, category: cat.id, categoryName: cat.name };
  }
  return null;
};

// Get category by ID
export const getCategoryById = (id) => {
  return FEATURE_CATEGORIES.find(c => c.id === id);
};

// Count features
export const getTotalFeatureCount = () => {
  return FEATURE_CATEGORIES.reduce((sum, cat) => sum + cat.features.length, 0);
};

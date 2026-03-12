// Central feature registry for Twomiah Factory
// Shared across signup wizard, feature management, and plan gating

export type FeatureDef = {
  id: string
  name: string
  description: string
  category: string
  core: boolean
  templates: string[] // which CRM templates support this feature: 'crm', 'crm-fieldservice', 'crm-homecare', 'crm-automotive'
}

export const FEATURE_REGISTRY: FeatureDef[] = [
  // Core
  { id: 'contacts', name: 'Contacts', description: 'Client, lead, vendor management', category: 'Core', core: true, templates: ['crm', 'crm-fieldservice', 'crm-homecare', 'crm-automotive', 'crm-roof'] },
  { id: 'jobs', name: 'Jobs', description: 'Job tracking and management', category: 'Core', core: true, templates: ['crm', 'crm-fieldservice', 'crm-automotive', 'crm-roof'] },
  { id: 'quotes', name: 'Quotes', description: 'Professional estimates and quotes', category: 'Core', core: true, templates: ['crm', 'crm-fieldservice', 'crm-automotive', 'crm-roof'] },
  { id: 'invoices', name: 'Invoices', description: 'Invoice generation and tracking', category: 'Core', core: true, templates: ['crm', 'crm-fieldservice', 'crm-homecare', 'crm-automotive', 'crm-roof'] },
  { id: 'scheduling', name: 'Scheduling', description: 'Calendar and job scheduling', category: 'Core', core: true, templates: ['crm', 'crm-fieldservice', 'crm-homecare', 'crm-roof'] },
  { id: 'team', name: 'Team', description: 'Team member management', category: 'Core', core: true, templates: ['crm', 'crm-fieldservice', 'crm-homecare'] },
  { id: 'dashboard', name: 'Dashboard', description: 'Overview dashboard', category: 'Core', core: true, templates: ['crm', 'crm-fieldservice', 'crm-homecare', 'crm-automotive', 'crm-roof'] },

  // Construction
  { id: 'projects', name: 'Projects', description: 'Multi-phase project management', category: 'Construction', core: false, templates: ['crm'] },
  { id: 'rfis', name: 'RFIs', description: 'Request for information tracking', category: 'Construction', core: false, templates: ['crm'] },
  { id: 'change_orders', name: 'Change Orders', description: 'Change order management', category: 'Construction', core: false, templates: ['crm'] },
  { id: 'punch_lists', name: 'Punch Lists', description: 'Punch list tracking', category: 'Construction', core: false, templates: ['crm'] },
  { id: 'daily_logs', name: 'Daily Logs', description: 'Field daily log reports', category: 'Construction', core: false, templates: ['crm'] },
  { id: 'inspections', name: 'Inspections', description: 'Quality inspections', category: 'Construction', core: false, templates: ['crm'] },
  { id: 'bid_management', name: 'Bid Management', description: 'Bid tracking and submission', category: 'Construction', core: false, templates: ['crm'] },
  { id: 'takeoff_tools', name: 'Takeoff Tools', description: 'Material takeoff calculations', category: 'Construction', core: false, templates: ['crm'] },
  { id: 'selections', name: 'Selections', description: 'Client material selections portal', category: 'Construction', core: false, templates: ['crm'] },

  // Service Trade
  { id: 'drag_drop_calendar', name: 'Drag & Drop Calendar', description: 'Visual job scheduling', category: 'Service Trade', core: false, templates: ['crm', 'crm-fieldservice'] },
  { id: 'recurring_jobs', name: 'Recurring Jobs', description: 'Automated recurring job creation', category: 'Service Trade', core: false, templates: ['crm', 'crm-fieldservice'] },
  { id: 'route_optimization', name: 'Route Optimization', description: 'Optimize daily service routes', category: 'Service Trade', core: false, templates: ['crm-fieldservice'] },
  { id: 'online_booking', name: 'Online Booking', description: 'Customer self-scheduling', category: 'Service Trade', core: false, templates: ['crm', 'crm-fieldservice'] },
  { id: 'service_dispatch', name: 'Service Dispatch', description: 'Real-time dispatch board', category: 'Service Trade', core: false, templates: ['crm', 'crm-fieldservice'] },
  { id: 'service_agreements', name: 'Service Agreements', description: 'Maintenance agreement management', category: 'Service Trade', core: false, templates: ['crm-fieldservice'] },
  { id: 'warranties', name: 'Warranties', description: 'Warranty tracking', category: 'Service Trade', core: false, templates: ['crm-fieldservice'] },
  { id: 'pricebook', name: 'Pricebook', description: 'Standardized pricing catalog', category: 'Service Trade', core: false, templates: ['crm', 'crm-fieldservice'] },

  // Field Service
  { id: 'dispatch_board', name: 'Dispatch Board', description: 'Real-time tech dispatch and scheduling', category: 'Field Service', core: false, templates: ['crm-fieldservice'] },
  { id: 'maintenance_contracts', name: 'Maintenance Contracts', description: 'Recurring service agreements', category: 'Field Service', core: false, templates: ['crm-fieldservice'] },
  { id: 'flat_rate_pricebook', name: 'Flat-Rate Pricebook', description: 'Standard pricing for common services', category: 'Field Service', core: false, templates: ['crm-fieldservice'] },
  { id: 'parts_tracking', name: 'Parts & Inventory', description: 'Track parts, stock levels, and usage', category: 'Field Service', core: false, templates: ['crm-fieldservice'] },

  // Automotive
  { id: 'vehicle_inventory', name: 'Vehicle Inventory', description: 'VIN decode, stock management, pricing', category: 'Automotive', core: false, templates: ['crm-automotive'] },
  { id: 'sales_pipeline', name: 'Sales Pipeline', description: 'Kanban lead pipeline with ADF/XML import', category: 'Automotive', core: false, templates: ['crm-automotive'] },
  { id: 'service_department', name: 'Service Department', description: 'Repair orders and service check-in', category: 'Automotive', core: false, templates: ['crm-automotive'] },
  { id: 'service_to_sales', name: 'Service-to-Sales Bridge', description: 'Alert salespeople when their leads check into service', category: 'Automotive', core: false, templates: ['crm-automotive'] },

  // Field Operations
  { id: 'time_tracking', name: 'Time Tracking', description: 'Clock in/out with GPS', category: 'Field Operations', core: false, templates: ['crm', 'crm-fieldservice', 'crm-homecare'] },
  { id: 'gps_tracking', name: 'GPS Tracking', description: 'Real-time crew location', category: 'Field Operations', core: false, templates: ['crm', 'crm-fieldservice', 'crm-homecare'] },
  { id: 'photo_capture', name: 'Photo Capture', description: 'Job site photo documentation', category: 'Field Operations', core: false, templates: ['crm', 'crm-fieldservice', 'crm-roof'] },
  { id: 'equipment_tracking', name: 'Equipment', description: 'Equipment and tool tracking', category: 'Field Operations', core: false, templates: ['crm', 'crm-fieldservice'] },
  { id: 'fleet', name: 'Fleet Management', description: 'Vehicle fleet tracking', category: 'Field Operations', core: false, templates: ['crm', 'crm-fieldservice'] },

  // Finance
  { id: 'online_payments', name: 'Online Payments', description: 'Stripe payment processing', category: 'Finance', core: false, templates: ['crm', 'crm-fieldservice', 'crm-homecare'] },
  { id: 'expense_tracking', name: 'Expense Tracking', description: 'Expense logging and receipts', category: 'Finance', core: false, templates: ['crm', 'crm-fieldservice'] },
  { id: 'job_costing', name: 'Job Costing', description: 'Detailed job cost analysis', category: 'Finance', core: false, templates: ['crm', 'crm-fieldservice'] },
  { id: 'consumer_financing', name: 'Consumer Financing', description: 'Wisetack financing integration', category: 'Finance', core: false, templates: ['crm'] },
  { id: 'quickbooks', name: 'QuickBooks', description: 'QuickBooks sync', category: 'Finance', core: false, templates: ['crm', 'crm-fieldservice', 'crm-homecare', 'crm-roof'] },

  // Communication
  { id: 'two_way_texting', name: 'Two-Way Texting', description: 'SMS communication with clients', category: 'Communication', core: false, templates: ['crm', 'crm-fieldservice', 'crm-homecare', 'crm-roof'] },
  { id: 'call_tracking', name: 'Call Tracking', description: 'Inbound call tracking and recording', category: 'Communication', core: false, templates: ['crm', 'crm-fieldservice', 'crm-homecare', 'crm-automotive', 'crm-roof'] },
  { id: 'client_portal', name: 'Client Portal', description: 'Customer-facing project portal', category: 'Communication', core: false, templates: ['crm', 'crm-fieldservice', 'crm-roof'] },
  { id: 'lead_inbox', name: 'Lead Inbox', description: 'Unified lead feed from Angi, Thumbtack, HomeAdvisor, Google LSA', category: 'Communication', core: false, templates: ['crm', 'crm-fieldservice', 'crm-homecare', 'crm-automotive', 'crm-roof'] },

  // Marketing
  { id: 'paid_ads', name: 'Paid Ads Hub (Google + Meta)', description: 'Google & Meta campaign management', category: 'Marketing', core: false, templates: ['crm', 'crm-fieldservice'] },
  { id: 'google_reviews', name: 'Google Reviews', description: 'Review request automation', category: 'Marketing', core: false, templates: ['crm', 'crm-fieldservice'] },
  { id: 'email_marketing', name: 'Email Marketing', description: 'Drip campaigns and newsletters', category: 'Marketing', core: false, templates: ['crm', 'crm-fieldservice'] },
  { id: 'referral_program', name: 'Referral Program', description: 'Customer referral tracking', category: 'Marketing', core: false, templates: ['crm', 'crm-fieldservice'] },

  // Advanced
  { id: 'inventory', name: 'Inventory', description: 'Warehouse and material inventory', category: 'Advanced', core: false, templates: ['crm', 'crm-fieldservice'] },
  { id: 'documents', name: 'Documents', description: 'Document management and storage', category: 'Advanced', core: false, templates: ['crm', 'crm-fieldservice', 'crm-homecare'] },
  { id: 'reports', name: 'Reports', description: 'Custom reporting dashboard', category: 'Advanced', core: false, templates: ['crm', 'crm-fieldservice', 'crm-homecare', 'crm-roof'] },
  { id: 'custom_dashboards', name: 'Custom Dashboards', description: 'Drag-and-drop widget dashboards', category: 'Advanced', core: false, templates: ['crm'] },
  { id: 'ai_receptionist', name: 'AI Receptionist', description: 'AI-powered call handling', category: 'Advanced', core: false, templates: ['crm', 'crm-fieldservice', 'crm-homecare', 'crm-automotive', 'crm-roof'] },
  { id: 'map_view', name: 'Map View', description: 'Map-based job visualization', category: 'Advanced', core: false, templates: ['crm', 'crm-fieldservice'] },

  // Roofing
  { id: 'measurement_reports', name: 'Measurement Reports', description: 'Satellite roof measurement ordering', category: 'Roofing', core: false, templates: ['crm-roof'] },
  { id: 'insurance_workflow', name: 'Insurance Workflow', description: 'Insurance claim tracking with adjuster info', category: 'Roofing', core: false, templates: ['crm-roof'] },
  { id: 'pipeline_board', name: 'Pipeline Board', description: 'Visual Kanban pipeline for roofing jobs', category: 'Roofing', core: false, templates: ['crm-roof'] },
  { id: 'crews', name: 'Crews', description: 'Crew management and assignment', category: 'Roofing', core: false, templates: ['crm-roof'] },
  { id: 'materials', name: 'Materials', description: 'Material ordering and tracking', category: 'Roofing', core: false, templates: ['crm-roof'] },
  { id: 'canvassing_tool', name: 'Canvassing Tool', description: 'Door-to-door canvassing management', category: 'Roofing', core: false, templates: ['crm-roof'] },
  { id: 'storm_lead_gen', name: 'Storm Lead Gen', description: 'Storm damage lead generation', category: 'Roofing', core: false, templates: ['crm-roof'] },

  // Add-on Products
  { id: 'visualizer', name: 'Room Visualizer', description: 'AI-powered room visualization for flooring, paint, cabinets', category: 'Add-on Products', core: false, templates: ['crm', 'crm-fieldservice', 'crm-homecare', 'crm-automotive', 'crm-roof'] },
]

export const FEATURE_MAP = Object.fromEntries(FEATURE_REGISTRY.map(f => [f.id, f]))

export function getCategories(): string[] {
  const seen = new Set<string>()
  return FEATURE_REGISTRY.filter(f => { if (seen.has(f.category)) return false; seen.add(f.category); return true }).map(f => f.category)
}

export function getFeaturesForTemplate(template: string): FeatureDef[] {
  return FEATURE_REGISTRY.filter(f => f.templates.includes(template))
}

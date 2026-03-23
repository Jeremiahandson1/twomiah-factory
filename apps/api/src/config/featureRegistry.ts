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
  { id: 'contacts', name: 'Contacts', description: 'Client, lead, vendor management', category: 'Core', core: true, templates: ['crm', 'crm-fieldservice', 'crm-homecare', 'crm-automotive', 'crm-roof', 'crm-dispensary'] },
  { id: 'jobs', name: 'Jobs', description: 'Job tracking and management', category: 'Core', core: true, templates: ['crm', 'crm-fieldservice', 'crm-automotive', 'crm-roof'] },
  { id: 'quotes', name: 'Quotes', description: 'Professional estimates and quotes', category: 'Core', core: true, templates: ['crm', 'crm-fieldservice', 'crm-automotive', 'crm-roof'] },
  { id: 'invoices', name: 'Invoices', description: 'Invoice generation and tracking', category: 'Core', core: true, templates: ['crm', 'crm-fieldservice', 'crm-homecare', 'crm-automotive', 'crm-roof'] },
  { id: 'scheduling', name: 'Scheduling', description: 'Calendar and job scheduling', category: 'Core', core: true, templates: ['crm', 'crm-fieldservice', 'crm-homecare', 'crm-roof'] },
  { id: 'team', name: 'Team', description: 'Team member management', category: 'Core', core: true, templates: ['crm', 'crm-fieldservice', 'crm-homecare', 'crm-dispensary'] },
  { id: 'dashboard', name: 'Dashboard', description: 'Overview dashboard', category: 'Core', core: true, templates: ['crm', 'crm-fieldservice', 'crm-homecare', 'crm-automotive', 'crm-roof', 'crm-dispensary'] },

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
  { id: 'pricebook', name: 'Pricebook', description: 'Standardized pricing catalog', category: 'Service Trade', core: false, templates: ['crm', 'crm-fieldservice', 'crm-homecare', 'crm-roof'] },

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
  { id: 'two_way_texting', name: 'Two-Way Texting', description: 'SMS communication with clients', category: 'Communication', core: false, templates: ['crm', 'crm-fieldservice', 'crm-homecare', 'crm-roof', 'crm-dispensary'] },
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

  // Dispensary — POS & Sales
  { id: 'pos', name: 'Point of Sale', description: 'POS terminal for walk-in and pickup orders', category: 'POS & Sales', core: true, templates: ['crm-dispensary'] },
  { id: 'products', name: 'Product Catalog', description: 'Product management with strain data, THC/CBD, pricing', category: 'POS & Sales', core: true, templates: ['crm-dispensary'] },
  { id: 'orders', name: 'Orders', description: 'Order management and history', category: 'POS & Sales', core: true, templates: ['crm-dispensary'] },
  { id: 'cash_management', name: 'Cash Management', description: 'Cash drawer sessions and end-of-day reconciliation', category: 'POS & Sales', core: false, templates: ['crm-dispensary'] },

  // Dispensary — Inventory & Compliance
  { id: 'dispensary_inventory', name: 'Inventory Tracking', description: 'Stock levels, adjustments, low-stock alerts', category: 'Inventory & Compliance', core: true, templates: ['crm-dispensary'] },
  { id: 'purchase_limits', name: 'Purchase Limits', description: 'Michigan 2.5oz per transaction enforcement', category: 'Inventory & Compliance', core: true, templates: ['crm-dispensary'] },
  { id: 'audit_log', name: 'Audit Log', description: 'Immutable audit trail for all sensitive actions', category: 'Inventory & Compliance', core: true, templates: ['crm-dispensary'] },
  { id: 'id_verification', name: 'ID Verification', description: 'Customer ID verification tracking at pickup/delivery', category: 'Inventory & Compliance', core: true, templates: ['crm-dispensary'] },

  // Dispensary — Loyalty & Marketing
  { id: 'loyalty_rewards', name: 'Loyalty Program', description: 'Points, tiers, rewards, and referral tracking', category: 'Loyalty & Marketing', core: false, templates: ['crm-dispensary'] },
  { id: 'sms_marketing', name: 'SMS Marketing', description: 'Text message campaigns and opt-in management', category: 'Loyalty & Marketing', core: false, templates: ['crm-dispensary'] },
  { id: 'email_campaigns', name: 'Email Campaigns', description: 'Email marketing and deal notifications', category: 'Loyalty & Marketing', core: false, templates: ['crm-dispensary'] },

  // Dispensary — Delivery & Online
  { id: 'delivery', name: 'Delivery', description: 'Delivery zones, driver management, and tracking', category: 'Delivery & Online', core: false, templates: ['crm-dispensary'] },
  { id: 'order_ahead', name: 'Order Ahead', description: 'Online ordering for pickup and delivery', category: 'Delivery & Online', core: false, templates: ['crm-dispensary'] },
  { id: 'public_menu', name: 'Public Menu', description: 'Public-facing product menu with strain info', category: 'Delivery & Online', core: true, templates: ['crm-dispensary'] },

  // Dispensary — Analytics & Merch
  { id: 'dispensary_analytics', name: 'Analytics', description: 'Sales reports, product performance, peak hours', category: 'Analytics', core: false, templates: ['crm-dispensary'] },
  { id: 'merch_store', name: 'Merch Store', description: 'Non-cannabis merchandise with Stripe checkout', category: 'Analytics', core: false, templates: ['crm-dispensary'] },

  // Dispensary — NEW: Compliance & Tracking
  { id: 'metrc', name: 'Metrc Integration', description: 'Direct Metrc API integration for state compliance sync', category: 'Compliance', core: false, templates: ['crm-dispensary'] },
  { id: 'compliance', name: 'Compliance Reporting', description: 'State-format compliance reports, license management, waste tracking', category: 'Compliance', core: false, templates: ['crm-dispensary'] },
  { id: 'labels', name: 'Label Printing', description: 'Compliant cannabis labels with QR codes, barcodes, custom design', category: 'Compliance', core: false, templates: ['crm-dispensary'] },

  // Dispensary — NEW: Inventory & RFID
  { id: 'multi_location', name: 'Multi-Location Inventory', description: 'Track inventory across locations with inter-store transfers', category: 'Inventory & Compliance', core: false, templates: ['crm-dispensary'] },
  { id: 'batches', name: 'Batch/Lot Tracking', description: 'Full batch lifecycle from receipt to depletion', category: 'Inventory & Compliance', core: false, templates: ['crm-dispensary'] },
  { id: 'rfid', name: 'RFID Scanning', description: 'RFID tag management, scanning, and bulk inventory counts', category: 'Inventory & Compliance', core: false, templates: ['crm-dispensary'] },

  // Dispensary — NEW: Delivery & Tracking
  { id: 'delivery_tracking', name: 'Delivery Tracking', description: 'Real-time GPS tracking, route optimization, customer tracking', category: 'Delivery & Online', core: false, templates: ['crm-dispensary'] },

  // Dispensary — NEW: POS Enhancements
  { id: 'kiosk', name: 'Self-Service Kiosk', description: 'Customer-facing kiosk for self-service ordering', category: 'POS & Sales', core: false, templates: ['crm-dispensary'] },
  { id: 'ai_recommendations', name: 'AI Recommendations', description: 'Personalized product suggestions based on purchase history', category: 'POS & Sales', core: false, templates: ['crm-dispensary'] },
  { id: 'pin_login', name: 'PIN Login', description: 'Quick PIN-based login for budtenders at POS', category: 'POS & Sales', core: false, templates: ['crm-dispensary'] },
  { id: 'tip_management', name: 'Tip Management', description: 'Collect and distribute tips across budtenders', category: 'POS & Sales', core: false, templates: ['crm-dispensary'] },

  // Dispensary — NEW: Marketing
  { id: 'referrals', name: 'Referral Program', description: 'Customer referral tracking with automatic rewards', category: 'Loyalty & Marketing', core: false, templates: ['crm-dispensary'] },

  // Dispensary — NEW: Analytics & BI
  { id: 'custom_reports', name: 'Custom Reports & BI', description: 'Report builder, BI widgets, budtender performance', category: 'Analytics', core: false, templates: ['crm-dispensary'] },
  { id: 'bi_dashboard', name: 'BI Dashboard', description: 'Drag-and-drop business intelligence dashboard', category: 'Analytics', core: false, templates: ['crm-dispensary'] },
  { id: 'budtender_performance', name: 'Budtender Performance', description: 'Per-budtender sales attribution and metrics', category: 'Analytics', core: false, templates: ['crm-dispensary'] },
  { id: 'website_analytics', name: 'Website & SEO Analytics', description: 'Page views, traffic sources, UTM campaigns, real-time visitors', category: 'Analytics', core: false, templates: ['crm-dispensary'] },

  // Dispensary — NEW: Supply Chain
  { id: 'cultivation', name: 'Cultivation / Grow Tracking', description: 'Plant tracking from seed to harvest with grow room management', category: 'Supply Chain', core: false, templates: ['crm-dispensary'] },
  { id: 'manufacturing', name: 'Manufacturing / Processing', description: 'Extraction, infusion, and processing job management', category: 'Supply Chain', core: false, templates: ['crm-dispensary'] },
  { id: 'wholesale', name: 'Distribution / Wholesale', description: 'B2B customers, wholesale orders, manifests, lab testing/CoA', category: 'Supply Chain', core: false, templates: ['crm-dispensary'] },
  { id: 'lab_testing', name: 'Lab Testing (CoA)', description: 'Lab test tracking with Certificate of Analysis import', category: 'Supply Chain', core: false, templates: ['crm-dispensary'] },

  // Dispensary — NEW: Enterprise
  { id: 'multi_store', name: 'Multi-Store / Chain', description: 'Cross-location dashboard and reporting', category: 'Enterprise', core: false, templates: ['crm-dispensary'] },
  { id: 'franchise', name: 'Franchise Management', description: 'Manage franchise locations with shared settings', category: 'Enterprise', core: false, templates: ['crm-dispensary'] },
  { id: 'open_api', name: 'Open API', description: 'Published OpenAPI spec for third-party integrations', category: 'Enterprise', core: false, templates: ['crm-dispensary'] },
  { id: 'ach_payments', name: 'ACH/Bank Transfers', description: 'Accept ACH bank transfer payments', category: 'Enterprise', core: false, templates: ['crm-dispensary'] },

  // Add-on Products
  { id: 'visualizer', name: 'Exterior Visualizer', description: 'AI-powered exterior visualization for siding, roofing, paint colors', category: 'Add-on Products', core: false, templates: ['crm', 'crm-fieldservice', 'crm-homecare', 'crm-automotive', 'crm-roof'] },
  { id: 'instant_estimator', name: 'Instant Roof Estimator', description: 'Google Solar-powered instant roof estimates with embeddable widget and lead capture', category: 'Add-on Products', core: false, templates: ['crm', 'crm-roof'] },
]

export const FEATURE_MAP = Object.fromEntries(FEATURE_REGISTRY.map(f => [f.id, f]))

export function getCategories(): string[] {
  const seen = new Set<string>()
  return FEATURE_REGISTRY.filter(f => { if (seen.has(f.category)) return false; seen.add(f.category); return true }).map(f => f.category)
}

export function getFeaturesForTemplate(template: string): FeatureDef[] {
  return FEATURE_REGISTRY.filter(f => f.templates.includes(template))
}

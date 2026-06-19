// {{COMPANY_NAME}} Feature Definitions — RV + Powersports Dealership CRM
//
// Frontend source of truth for feature keys used by hasFeature() gating.
// Feature IDs here MUST match backend src/config/featureRegistry.ts exactly.
//
// Scope: a CRM layer (sales, service comms, lead management) that sits on top
// of whatever DMS/accounting the dealer already runs — NOT a full DMS.

export const FEATURE_CATEGORIES = [
  {
    id: 'core',
    name: 'Core',
    icon: 'Users',
    description: 'Essential CRM functionality — always included',
    features: [
      { id: 'contacts', name: 'Customers & Leads', description: 'Customer and lead management with full history' },
      { id: 'dashboard', name: 'Dashboard', description: 'Store overview, sales & service KPIs' },
      { id: 'team', name: 'Team Management', description: 'User accounts, roles and permissions' },
    ]
  },
  {
    id: 'inventory',
    name: 'Inventory',
    icon: 'Caravan',
    description: 'RV & powersports unit inventory',
    features: [
      { id: 'unit_inventory', name: 'Unit Inventory', description: 'New/used/consignment units with VIN decode, floorplans, photos and spec sheets' },
      { id: 'inventory_syndication', name: 'Marketplace Syndication', description: 'Push inventory feeds to RV Trader, RVUSA, RVT, Cycle Trader & ATV Trader' },
      { id: 'recall_lookup', name: 'Recall Lookup', description: 'One-click NHTSA/OEM open-recall check by VIN at sale and service intake' },
    ]
  },
  {
    id: 'sales',
    name: 'Sales',
    icon: 'Kanban',
    description: 'Sales pipeline, deals and trade-ins',
    features: [
      { id: 'deal_pipeline', name: 'Sales Pipeline', description: 'Kanban pipeline linking each lead to a unit of interest, by stage and salesperson' },
      { id: 'lead_inbox', name: 'Lead Inbox', description: 'Unified inbox for marketplace & ADF/XML leads with auto-match to inventory' },
      { id: 'deal_desk', name: 'Deal Desk', description: 'Structure deals with payment calculator, fees, tax and trade allowance' },
      { id: 'trade_in', name: 'Trade-In Management', description: 'Appraise trades, attach to a deal, recondition and roll back into used inventory' },
      { id: 'esign', name: 'eSignature', description: 'Send deal paperwork for remote signing to close without a return visit' },
    ]
  },
  {
    id: 'service',
    name: 'Service & Parts',
    icon: 'Wrench',
    description: 'Service department and parts counter',
    features: [
      { id: 'service_dept', name: 'Service Department', description: 'Repair orders, bay/tech scheduling and service-to-sales alerts' },
      { id: 'service_status_texts', name: 'Service Status Updates', description: 'Automated "your unit is ready" texts plus tech photos/video to drive upsell approvals' },
      { id: 'parts_counter', name: 'Parts Counter', description: 'RV/powersports parts lookup, special orders and parts-to-RO attachment' },
      { id: 'warranty_claims', name: 'Warranty Claims', description: 'Track OEM warranty and extended-service-contract claims through approval' },
    ]
  },
  {
    id: 'communication',
    name: 'Communication',
    icon: 'MessageSquare',
    description: 'Customer communication tools',
    features: [
      { id: 'two_way_texting', name: 'Two-Way Texting', description: 'Unified text inbox — every customer conversation logged and attributed to the dealership' },
      { id: 'follow_up_sequences', name: 'Automated Follow-Up', description: 'Multi-touch SMS/email cadences that work long RV/powersports research cycles' },
      { id: 'google_reviews', name: 'Review Requests', description: 'Automated Google review requests after a sale or service visit' },
    ]
  },
  {
    id: 'finance',
    name: 'Payments & Finance',
    icon: 'CreditCard',
    description: 'F&I tools, payments and accounting sync',
    features: [
      { id: 'consumer_financing', name: 'F&I / Financing', description: 'Lender pre-qualification links and finance offers attached to the deal' },
      { id: 'online_payments', name: 'Payment Processing', description: 'Take deposits and payments by card or ACH' },
      { id: 'quickbooks', name: 'QuickBooks Sync', description: 'Push deals/invoices to QuickBooks — we integrate accounting, we do not replace it' },
    ]
  },
  {
    id: 'reporting',
    name: 'Reporting',
    icon: 'BarChart',
    description: 'Analytics and reports',
    features: [
      { id: 'reports', name: 'Reports', description: 'Drill-down sales & service reporting — leads by source, close rate, gross per deal' },
      { id: 'seasonal_trends', name: 'Seasonal Trends', description: 'Year-over-year, same-period comparisons for a seasonal RV/powersports business' },
    ]
  },
];

// Core features are always enabled and cannot be disabled.
export const CORE_FEATURE_IDS = ['contacts', 'dashboard', 'team'];

// Preset packages (mirror backend FEATURE_PACKAGES)
export const PRESET_PACKAGES = [
  {
    id: 'starter',
    name: 'Sales Starter',
    description: 'Get the sales floor off spreadsheets and personal phones',
    price: '$1,500',
    features: [
      'contacts', 'dashboard', 'team',
      'unit_inventory',
      'deal_pipeline',
      'lead_inbox',
      'two_way_texting',
      'follow_up_sequences',
      'google_reviews',
      'online_payments',
    ]
  },
  {
    id: 'sales_pro',
    name: 'Sales Pro',
    description: 'Full sales + F&I workflow with syndication',
    price: '$2,500',
    features: [
      'contacts', 'dashboard', 'team',
      'unit_inventory',
      'inventory_syndication',
      'recall_lookup',
      'deal_pipeline',
      'lead_inbox',
      'deal_desk',
      'trade_in',
      'esign',
      'two_way_texting',
      'follow_up_sequences',
      'google_reviews',
      'consumer_financing',
      'online_payments',
      'quickbooks',
      'reports',
    ]
  },
  {
    id: 'full',
    name: 'Full Platform',
    description: 'Every feature enabled — sales, service, parts and F&I',
    price: '$5,000',
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

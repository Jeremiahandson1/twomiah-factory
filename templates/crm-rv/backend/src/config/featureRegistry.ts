/**
 * Feature Registry
 *
 * Master list of ALL available features in {{COMPANY_NAME}}.
 * This is the single source of truth for what can be enabled/disabled.
 *
 * Scope: RV + Powersports DEALERSHIP CRM. Positioned as a CRM layer (sales,
 * service comms, lead management) that sits on top of whatever DMS/accounting
 * the dealer already runs — NOT a full DMS. We deliberately do not build
 * accounting/GL, payroll, newsletter builders, or social scheduling.
 */

export const FEATURE_REGISTRY = {
  // ============================================
  // CORE - Always included, cannot be disabled
  // ============================================
  core: {
    name: 'Core',
    description: 'Essential CRM functionality',
    alwaysEnabled: true,
    features: {
      contacts: {
        id: 'contacts',
        name: 'Customers & Leads',
        description: 'Customer and lead management with full history',
        icon: 'users',
        routes: ['/contacts', '/api/contacts'],
      },
      dashboard: {
        id: 'dashboard',
        name: 'Dashboard',
        description: 'Store overview, sales & service KPIs',
        icon: 'layout-dashboard',
        routes: ['/dashboard', '/api/dashboard'],
      },
      team: {
        id: 'team',
        name: 'Team Management',
        description: 'User accounts, roles and permissions',
        icon: 'users',
        routes: ['/team', '/api/team'],
      },
    },
  },

  // ============================================
  // INVENTORY (RV / POWERSPORTS UNITS)
  // ============================================
  inventory: {
    name: 'Inventory',
    description: 'RV & powersports unit inventory',
    features: {
      unit_inventory: {
        id: 'unit_inventory',
        name: 'Unit Inventory',
        description: 'New/used/consignment units with VIN decode, floorplans, photos and spec sheets',
        icon: 'caravan',
        routes: ['/inventory', '/api/units'],
      },
      inventory_syndication: {
        id: 'inventory_syndication',
        name: 'Marketplace Syndication',
        description: 'Push inventory feeds to RV Trader, RVUSA, RVT, Cycle Trader & ATV Trader',
        icon: 'share-2',
        routes: ['/api/syndication'],
      },
      recall_lookup: {
        id: 'recall_lookup',
        name: 'Recall Lookup',
        description: 'One-click NHTSA/OEM open-recall check by VIN at sale and service intake',
        icon: 'alert-triangle',
        routes: ['/api/recalls'],
      },
    },
  },

  // ============================================
  // SALES
  // ============================================
  sales: {
    name: 'Sales',
    description: 'Sales pipeline, deals and trade-ins',
    features: {
      deal_pipeline: {
        id: 'deal_pipeline',
        name: 'Sales Pipeline',
        description: 'Kanban pipeline linking each lead to a unit of interest, by stage and salesperson',
        icon: 'kanban',
        routes: ['/pipeline', '/api/sales-leads'],
      },
      lead_inbox: {
        id: 'lead_inbox',
        name: 'Lead Inbox',
        description: 'Unified inbox for marketplace & ADF/XML leads with auto-match to inventory',
        icon: 'inbox',
        routes: ['/leads', '/api/leads', '/api/lead-sources'],
      },
      deal_desk: {
        id: 'deal_desk',
        name: 'Deal Desk',
        description: 'Structure deals with payment calculator, fees, tax and trade allowance',
        icon: 'calculator',
        routes: ['/deals', '/api/deals'],
      },
      trade_in: {
        id: 'trade_in',
        name: 'Trade-In Management',
        description: 'Appraise trades, attach to a deal, recondition and roll back into used inventory',
        icon: 'repeat',
        routes: ['/trade-ins', '/api/trade-ins'],
      },
      esign: {
        id: 'esign',
        name: 'eSignature',
        description: 'Send deal paperwork for remote signing to close without a return visit',
        icon: 'file-signature',
        routes: ['/api/esign'],
      },
    },
  },

  // ============================================
  // SERVICE & PARTS
  // ============================================
  service: {
    name: 'Service & Parts',
    description: 'Service department and parts counter',
    features: {
      service_dept: {
        id: 'service_dept',
        name: 'Service Department',
        description: 'Repair orders, bay/tech scheduling and service-to-sales alerts',
        icon: 'wrench',
        routes: ['/service', '/api/repair-orders', '/api/alerts'],
      },
      service_status_texts: {
        id: 'service_status_texts',
        name: 'Service Status Updates',
        description: 'Automated "your unit is ready" texts plus tech photos/video to drive upsell approvals',
        icon: 'message-circle',
        routes: ['/api/service-updates'],
      },
      parts_counter: {
        id: 'parts_counter',
        name: 'Parts Counter',
        description: 'RV/powersports parts lookup, special orders and parts-to-RO attachment',
        icon: 'package',
        routes: ['/parts', '/api/parts'],
      },
      warranty_claims: {
        id: 'warranty_claims',
        name: 'Warranty Claims',
        description: 'Track OEM warranty and extended-service-contract claims through approval',
        icon: 'shield',
        routes: ['/warranty', '/api/warranty-claims'],
      },
    },
  },

  // ============================================
  // COMMUNICATION
  // ============================================
  communication: {
    name: 'Communication',
    description: 'Customer communication tools',
    features: {
      two_way_texting: {
        id: 'two_way_texting',
        name: 'Two-Way Texting',
        description: 'Unified text inbox — every customer conversation logged and attributed to the dealership',
        icon: 'message-square',
        routes: ['/messages', '/api/sms'],
      },
      follow_up_sequences: {
        id: 'follow_up_sequences',
        name: 'Automated Follow-Up',
        description: 'Multi-touch SMS/email cadences that work long RV/powersports research cycles',
        icon: 'send',
        routes: ['/sequences', '/api/sequences'],
      },
      google_reviews: {
        id: 'google_reviews',
        name: 'Review Requests',
        description: 'Automated Google review requests after a sale or service visit',
        icon: 'star',
        routes: ['/reviews', '/api/reviews'],
      },
    },
  },

  // ============================================
  // PAYMENTS & FINANCE  (CRM layer only — no built-in accounting/GL)
  // ============================================
  finance: {
    name: 'Payments & Finance',
    description: 'F&I tools, payments and accounting sync',
    features: {
      consumer_financing: {
        id: 'consumer_financing',
        name: 'F&I / Financing',
        description: 'Lender pre-qualification links and finance offers attached to the deal',
        icon: 'banknote',
        routes: ['/api/financing'],
      },
      online_payments: {
        id: 'online_payments',
        name: 'Payment Processing',
        description: 'Take deposits and payments by card or ACH',
        icon: 'credit-card',
        routes: ['/api/stripe', '/api/payments'],
      },
      quickbooks: {
        id: 'quickbooks',
        name: 'QuickBooks Sync',
        description: 'Push deals/invoices to QuickBooks — we integrate accounting, we do not replace it',
        icon: 'refresh-cw',
        routes: ['/api/quickbooks'],
      },
    },
  },

  // ============================================
  // REPORTING
  // ============================================
  reporting: {
    name: 'Reporting',
    description: 'Analytics and reports',
    features: {
      reports: {
        id: 'reports',
        name: 'Reports',
        description: 'Drill-down sales & service reporting — leads by source, close rate, gross per deal',
        icon: 'bar-chart',
        routes: ['/reports', '/api/reporting'],
      },
      seasonal_trends: {
        id: 'seasonal_trends',
        name: 'Seasonal Trends',
        description: 'Year-over-year, same-period comparisons for a seasonal RV/powersports business',
        icon: 'trending-up',
        routes: ['/api/reporting/seasonal'],
      },
    },
  },
};

// ============================================
// FEATURE PACKAGES (Presets)
// ============================================

export const FEATURE_PACKAGES = {
  starter: {
    id: 'starter',
    name: 'Sales Starter',
    description: 'Get the sales floor off spreadsheets and personal phones',
    price: '$1,500',
    features: [
      // Core always included
      'unit_inventory',
      'deal_pipeline',
      'lead_inbox',
      'two_way_texting',
      'follow_up_sequences',
      'google_reviews',
      'online_payments',
    ],
  },
  sales_pro: {
    id: 'sales_pro',
    name: 'Sales Pro',
    description: 'Full sales + F&I workflow with syndication',
    price: '$2,500',
    features: [
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
    ],
  },
  full: {
    id: 'full',
    name: 'Full Platform',
    description: 'Every feature enabled — sales, service, parts and F&I',
    price: '$5,000',
    features: 'all',
  },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get flat list of all feature IDs
 */
export function getAllFeatureIds() {
  const ids = [];
  for (const category of Object.values(FEATURE_REGISTRY)) {
    for (const feature of Object.values(category.features)) {
      ids.push(feature.id);
    }
  }
  return ids;
}

/**
 * Get core features (always enabled)
 */
export function getCoreFeatureIds() {
  return Object.values(FEATURE_REGISTRY.core.features).map(f => f.id);
}

/**
 * Get feature by ID
 */
export function getFeatureById(featureId) {
  for (const category of Object.values(FEATURE_REGISTRY)) {
    if (category.features[featureId]) {
      return category.features[featureId];
    }
  }
  return null;
}

/**
 * Get features for a package
 */
export function getPackageFeatures(packageId) {
  const pkg = FEATURE_PACKAGES[packageId];
  if (!pkg) return getCoreFeatureIds();

  if (pkg.features === 'all') {
    return getAllFeatureIds();
  }

  return [...getCoreFeatureIds(), ...pkg.features];
}

/**
 * Check if a route is allowed for given features
 */
export function isRouteAllowed(route, enabledFeatures) {
  // Core features always allowed
  const coreIds = getCoreFeatureIds();
  const allEnabled = [...coreIds, ...enabledFeatures];

  for (const category of Object.values(FEATURE_REGISTRY)) {
    for (const feature of Object.values(category.features)) {
      if (feature.routes.some(r => route.startsWith(r))) {
        if (category.alwaysEnabled) return true;
        return allEnabled.includes(feature.id);
      }
    }
  }

  // If route not in registry, allow it (might be a system route)
  return true;
}

export default {
  FEATURE_REGISTRY,
  FEATURE_PACKAGES,
  getAllFeatureIds,
  getCoreFeatureIds,
  getFeatureById,
  getPackageFeatures,
  isRouteAllowed,
};

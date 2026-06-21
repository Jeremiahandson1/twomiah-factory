/**
 * Feature Registry
 * 
 * Master list of ALL available features in {{COMPANY_NAME}}.
 * This is the single source of truth for what can be enabled/disabled.
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
        name: 'Contacts',
        description: 'Customer and lead management',
        icon: 'users',
        routes: ['/contacts', '/api/contacts'],
      },
      jobs: {
        id: 'jobs',
        name: 'Jobs',
        description: 'Work order management',
        icon: 'briefcase',
        routes: ['/jobs', '/api/jobs'],
      },
      quotes: {
        id: 'quotes',
        name: 'Quotes & Estimates',
        description: 'Create and send quotes',
        icon: 'file-text',
        routes: ['/quotes', '/api/quotes'],
      },
      invoices: {
        id: 'invoices',
        name: 'Invoicing',
        description: 'Invoice and payment tracking',
        icon: 'dollar-sign',
        routes: ['/invoices', '/api/invoices'],
      },
      scheduling: {
        id: 'scheduling',
        name: 'Scheduling',
        description: 'Calendar and job scheduling',
        icon: 'calendar',
        routes: ['/schedule', '/api/schedule'],
      },
      team: {
        id: 'team',
        name: 'Team Management',
        description: 'User accounts and permissions',
        icon: 'users',
        routes: ['/team', '/api/team'],
      },
      dashboard: {
        id: 'dashboard',
        name: 'Dashboard',
        description: 'Overview and analytics',
        icon: 'layout-dashboard',
        routes: ['/dashboard', '/api/dashboard'],
      },
    },
  },

  // ============================================
  // WARRANTIES
  // ============================================
  warranty: {
    name: 'Warranties',
    description: 'Warranty and service claim tracking',
    features: {
      warranties: {
        id: 'warranties',
        name: 'Warranty Management',
        description: 'Track warranties and service claims',
        icon: 'shield',
        routes: ['/warranties', '/api/warranties'],
      },
    },
  },

  // ============================================
  // INVENTORY & PARTS
  // ============================================
  inventory: {
    name: 'Inventory',
    description: 'Parts and materials tracking',
    features: {
      inventory: {
        id: 'inventory',
        name: 'Inventory Management',
        description: 'Track parts across locations and trucks',
        icon: 'package',
        routes: ['/inventory', '/api/inventory'],
      },
      purchase_orders: {
        id: 'purchase_orders',
        name: 'Purchase Orders',
        description: 'Order parts from vendors',
        icon: 'shopping-cart',
        routes: ['/purchase-orders', '/api/inventory/purchase-orders'],
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
      sms: {
        id: 'sms',
        name: 'Two-Way SMS',
        description: 'Text messaging with customers',
        icon: 'message-square',
        routes: ['/messages', '/api/sms'],
      },
      email_campaigns: {
        id: 'email_campaigns',
        name: 'Email Campaigns',
        description: 'Marketing emails and drip sequences',
        icon: 'mail',
        routes: ['/marketing', '/api/marketing'],
      },
      reviews: {
        id: 'reviews',
        name: 'Review Requests',
        description: 'Automated Google review requests',
        icon: 'star',
        routes: ['/reviews', '/api/reviews'],
      },
      call_tracking: {
        id: 'call_tracking',
        name: 'Call Tracking',
        description: 'Track calls by marketing source',
        icon: 'phone',
        routes: ['/calls', '/api/calltracking'],
      },
    },
  },

  // ============================================
  // PAYMENTS & FINANCE
  // ============================================
  finance: {
    name: 'Payments & Finance',
    description: 'Payment processing and financing',
    features: {
      payments: {
        id: 'payments',
        name: 'Payment Processing',
        description: 'Accept credit cards and ACH',
        icon: 'credit-card',
        routes: ['/api/stripe', '/api/payments'],
      },
      consumer_financing: {
        id: 'consumer_financing',
        name: 'Dealer Financing',
        description: 'RV/powersports/marine financing — Octane, Sheffield, Synchrony, RouteOne',
        icon: 'banknote',
        routes: ['/api/financing', '/api/wisetack'],
      },
      trade_valuation: {
        id: 'trade_valuation',
        name: 'Trade-In Valuation',
        description: 'Book values for trade-ins — J.D. Power (NADA Guides) / Black Book',
        icon: 'calculator',
        routes: ['/api/valuation'],
      },
      quickbooks: {
        id: 'quickbooks',
        name: 'QuickBooks Sync',
        description: 'Two-way QuickBooks integration',
        icon: 'refresh-cw',
        routes: ['/api/quickbooks'],
      },
    },
  },

  // ============================================
  // CUSTOMER PORTAL
  // ============================================
  portal: {
    name: 'Customer Portal',
    description: 'Client-facing features',
    features: {
      customer_portal: {
        id: 'customer_portal',
        name: 'Customer Portal',
        description: 'Clients view quotes, invoices, project status',
        icon: 'external-link',
        routes: ['/portal', '/api/portal'],
      },
      online_booking: {
        id: 'online_booking',
        name: 'Online Booking',
        description: 'Website widget for appointment booking',
        icon: 'calendar-plus',
        routes: ['/api/booking'],
      },
    },
  },

  // ============================================
  // DOCUMENTS
  // ============================================
  documents: {
    name: 'Documents',
    description: 'Document management',
    features: {
      documents: {
        id: 'documents',
        name: 'Document Management',
        description: 'File storage and versioning',
        icon: 'folder',
        routes: ['/documents', '/api/documents'],
      },
      photos: {
        id: 'photos',
        name: 'Photo Management',
        description: 'Job site photos organized by location',
        icon: 'camera',
        routes: ['/api/photos'],
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
        description: 'Financial and operational reports',
        icon: 'bar-chart',
        routes: ['/reports', '/api/reporting'],
      },
      job_costing: {
        id: 'job_costing',
        name: 'Job Costing',
        description: 'Estimate vs actual cost analysis',
        icon: 'trending-up',
        routes: ['/api/reporting/job-costing'],
      },
    },
  },
};

// ============================================
// FEATURE PACKAGES (Presets)
// ============================================

export const FEATURE_PACKAGES = {
  dealer_basic: {
    id: 'dealer_basic',
    name: 'Dealer Basic',
    description: 'Essential features for small RV & powersports dealers',
    price: '$1,500',
    features: [
      // Core always included
      'warranties',
      'inventory',
      'sms',
      'reviews',
      'payments',
      'customer_portal',
    ],
  },
  dealer_pro: {
    id: 'dealer_pro',
    name: 'Dealer Pro',
    description: 'Full RV, powersports & marine dealership feature set',
    price: '$2,500',
    features: [
      // Core always included
      'warranties',
      'inventory',
      'purchase_orders',
      'sms',
      'email_campaigns',
      'reviews',
      'call_tracking',
      'payments',
      'consumer_financing',
      'trade_valuation',
      'quickbooks',
      'customer_portal',
      'documents',
      'reports',
    ],
  },
  full: {
    id: 'full',
    name: 'Full Platform',
    description: 'Every feature enabled',
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
export function getFeatureById(featureId: string) {
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
export function getPackageFeatures(packageId: string) {
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
export function isRouteAllowed(route: string, enabledFeatures: string[]) {
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

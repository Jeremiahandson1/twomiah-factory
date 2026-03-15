/**
 * Feature Registry — Cannabis Dispensary
 *
 * Master list of ALL available features.
 * Single source of truth for what can be enabled/disabled.
 */

export const FEATURE_REGISTRY = {
  // ============================================
  // CORE - Always included, cannot be disabled
  // ============================================
  core: {
    name: 'Core',
    description: 'Essential dispensary CRM functionality',
    alwaysEnabled: true,
    features: {
      customers: {
        id: 'customers',
        name: 'Customers',
        description: 'Customer management',
        icon: 'users',
        routes: ['/contacts', '/api/contacts'],
      },
      products: {
        id: 'products',
        name: 'Products',
        description: 'Product catalog and inventory',
        icon: 'package',
        routes: ['/products', '/api/products'],
      },
      orders: {
        id: 'orders',
        name: 'Orders & POS',
        description: 'Point-of-sale and order management',
        icon: 'shopping-cart',
        routes: ['/orders', '/api/orders'],
      },
      pos: {
        id: 'pos',
        name: 'POS Terminal',
        description: 'In-store point of sale',
        icon: 'monitor',
        routes: ['/pos'],
      },
      inventory: {
        id: 'inventory',
        name: 'Inventory',
        description: 'Stock tracking and adjustments',
        icon: 'package',
        routes: ['/api/products'],
      },
      cash_management: {
        id: 'cash_management',
        name: 'Cash Management',
        description: 'Cash drawer sessions and reconciliation',
        icon: 'banknote',
        routes: ['/cash', '/api/cash'],
      },
      team: {
        id: 'team',
        name: 'Team Management',
        description: 'User accounts and roles',
        icon: 'users',
        routes: ['/team', '/api/team'],
      },
      dashboard: {
        id: 'dashboard',
        name: 'Dashboard',
        description: 'Overview and daily snapshot',
        icon: 'layout-dashboard',
        routes: ['/dashboard', '/api/dashboard'],
      },
      compliance: {
        id: 'compliance',
        name: 'Compliance',
        description: 'Purchase limits, ID verification, audit trail',
        icon: 'shield',
        routes: ['/audit', '/api/audit'],
      },
    },
  },

  // ============================================
  // LOYALTY & ENGAGEMENT
  // ============================================
  loyalty: {
    name: 'Loyalty & Engagement',
    description: 'Customer loyalty and marketing',
    features: {
      loyalty: {
        id: 'loyalty',
        name: 'Loyalty Program',
        description: 'Points, tiers, and rewards',
        icon: 'star',
        routes: ['/loyalty', '/api/loyalty'],
      },
      sms: {
        id: 'sms',
        name: 'SMS Messaging',
        description: 'Text messaging with customers',
        icon: 'message-square',
        routes: ['/messages', '/api/sms'],
      },
      email_marketing: {
        id: 'email_marketing',
        name: 'Email Marketing',
        description: 'Email campaigns and promotions',
        icon: 'mail',
        routes: ['/marketing', '/api/marketing'],
      },
    },
  },

  // ============================================
  // DELIVERY & ONLINE
  // ============================================
  delivery: {
    name: 'Delivery & Online',
    description: 'Delivery and online ordering',
    features: {
      delivery: {
        id: 'delivery',
        name: 'Delivery',
        description: 'Delivery zones, drivers, and tracking',
        icon: 'truck',
        routes: ['/delivery', '/api/delivery'],
      },
      customer_portal: {
        id: 'customer_portal',
        name: 'Customer Portal',
        description: 'Online menu and ordering for customers',
        icon: 'external-link',
        routes: ['/portal'],
      },
      order_ahead: {
        id: 'order_ahead',
        name: 'Order Ahead',
        description: 'Pickup scheduling from website',
        icon: 'clock',
        routes: ['/order'],
      },
    },
  },

  // ============================================
  // MERCH & EXTRAS
  // ============================================
  extras: {
    name: 'Merch & Extras',
    description: 'Non-cannabis products and extras',
    features: {
      merch_store: {
        id: 'merch_store',
        name: 'Merch Store',
        description: 'Branded merchandise with Stripe checkout',
        icon: 'shopping-bag',
        routes: ['/merch'],
      },
    },
  },

  // ============================================
  // ANALYTICS & REPORTING
  // ============================================
  reporting: {
    name: 'Analytics & Reporting',
    description: 'Business intelligence and reports',
    features: {
      analytics: {
        id: 'analytics',
        name: 'Analytics',
        description: 'Sales, product, and customer analytics',
        icon: 'bar-chart',
        routes: ['/analytics', '/api/analytics'],
      },
      reports: {
        id: 'reports',
        name: 'Advanced Reports',
        description: 'Custom reports and exports',
        icon: 'trending-up',
        routes: ['/api/export'],
      },
    },
  },

  // ============================================
  // DOCUMENTS
  // ============================================
  documents: {
    name: 'Documents',
    description: 'Document and photo management',
    features: {
      documents: {
        id: 'documents',
        name: 'Documents',
        description: 'File storage and management',
        icon: 'folder',
        routes: ['/documents', '/api/documents'],
      },
    },
  },
}

// ============================================
// HELPER FUNCTIONS
// ============================================

export function getAllFeatureIds() {
  const ids: string[] = []
  for (const category of Object.values(FEATURE_REGISTRY)) {
    for (const feature of Object.values(category.features)) {
      ids.push(feature.id)
    }
  }
  return ids
}

export function getCoreFeatureIds() {
  return Object.values(FEATURE_REGISTRY.core.features).map(f => f.id)
}

export function getFeatureById(featureId: string) {
  for (const category of Object.values(FEATURE_REGISTRY)) {
    if ((category.features as any)[featureId]) {
      return (category.features as any)[featureId]
    }
  }
  return null
}

export function isRouteAllowed(route: string, enabledFeatures: string[]) {
  const coreIds = getCoreFeatureIds()
  const allEnabled = [...coreIds, ...enabledFeatures]

  for (const category of Object.values(FEATURE_REGISTRY)) {
    for (const feature of Object.values(category.features)) {
      if (feature.routes.some((r: string) => route.startsWith(r))) {
        if ((category as any).alwaysEnabled) return true
        return allEnabled.includes(feature.id)
      }
    }
  }

  return true
}

export default {
  FEATURE_REGISTRY,
  getAllFeatureIds,
  getCoreFeatureIds,
  getFeatureById,
  isRouteAllowed,
}

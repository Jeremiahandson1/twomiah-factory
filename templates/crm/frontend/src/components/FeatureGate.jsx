import { createContext, useContext, useMemo } from 'react';
import { Lock } from 'lucide-react';

/**
 * Feature Context
 * 
 * Provides enabled features throughout the app.
 * Populated from the auth response.
 */
const FeatureContext = createContext({
  enabledFeatures: [],
  isFeatureEnabled: () => false,
});

/**
 * Feature Provider
 * 
 * Wrap your app with this to provide feature context.
 * 
 * Usage:
 *   <FeatureProvider features={user.company.enabledFeatures}>
 *     <App />
 *   </FeatureProvider>
 */
export function FeatureProvider({ features = [], children }) {
  const value = useMemo(() => ({
    enabledFeatures: features,
    isFeatureEnabled: (featureId) => features.includes(featureId),
  }), [features]);

  return (
    <FeatureContext.Provider value={value}>
      {children}
    </FeatureContext.Provider>
  );
}

/**
 * Hook to access feature context
 */
export function useFeatures() {
  return useContext(FeatureContext);
}

/**
 * Hook to check if a specific feature is enabled
 */
export function useFeature(featureId) {
  const { isFeatureEnabled } = useFeatures();
  return isFeatureEnabled(featureId);
}

/**
 * Feature Gate Component
 * 
 * Conditionally renders children based on feature availability.
 * 
 * Usage:
 *   <FeatureGate feature="inventory">
 *     <InventoryPage />
 *   </FeatureGate>
 * 
 * With fallback:
 *   <FeatureGate feature="fleet" fallback={<UpgradePrompt />}>
 *     <FleetPage />
 *   </FeatureGate>
 * 
 * Multiple features (any):
 *   <FeatureGate features={['sms', 'email_campaigns']} mode="any">
 *     <MessagingTab />
 *   </FeatureGate>
 * 
 * Multiple features (all required):
 *   <FeatureGate features={['inventory', 'purchase_orders']} mode="all">
 *     <PurchaseOrdersPage />
 *   </FeatureGate>
 */
export function FeatureGate({ 
  feature,
  features,
  mode = 'any', // 'any' or 'all'
  children, 
  fallback = null,
  showLocked = false, // Show a locked state instead of hiding
}) {
  const { isFeatureEnabled } = useFeatures();

  // Determine which features to check
  const featuresToCheck = features || (feature ? [feature] : []);
  
  // Check if enabled
  let enabled;
  if (mode === 'all') {
    enabled = featuresToCheck.every(f => isFeatureEnabled(f));
  } else {
    enabled = featuresToCheck.some(f => isFeatureEnabled(f));
  }

  if (enabled) {
    return children;
  }

  if (showLocked) {
    return (
      <LockedFeature 
        featureName={featuresToCheck[0]} 
      />
    );
  }

  return fallback;
}

/**
 * Locked Feature Placeholder
 * 
 * Shows a nice UI when a feature isn't available.
 */
function LockedFeature({ featureName }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
        <Lock className="w-8 h-8 text-gray-400" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">
        Feature Not Available
      </h3>
      <p className="text-gray-500 max-w-md">
        The <strong>{featureName}</strong> feature is not enabled for your account.
        Contact your administrator to enable this feature.
      </p>
    </div>
  );
}

/**
 * Feature Nav Item
 * 
 * Use for navigation items that should only show if feature is enabled.
 * 
 * Usage:
 *   <FeatureNavItem feature="inventory">
 *     <NavLink to="/inventory">Inventory</NavLink>
 *   </FeatureNavItem>
 */
export function FeatureNavItem({ feature, features, mode, children }) {
  return (
    <FeatureGate feature={feature} features={features} mode={mode}>
      {children}
    </FeatureGate>
  );
}

/**
 * withFeature HOC
 * 
 * Wrap a component to require a feature.
 * 
 * Usage:
 *   export default withFeature('inventory')(InventoryPage);
 */
export function withFeature(featureId, FallbackComponent = null) {
  return function(WrappedComponent) {
    return function FeatureWrappedComponent(props) {
      const enabled = useFeature(featureId);

      if (!enabled) {
        if (FallbackComponent) {
          return <FallbackComponent {...props} />;
        }
        return <LockedFeature featureName={featureId} />;
      }

      return <WrappedComponent {...props} />;
    };
  };
}

/**
 * Feature-aware link
 * 
 * Only renders the link if feature is enabled, otherwise shows nothing or fallback.
 */
export function FeatureLink({ feature, to, children, className, fallback = null }) {
  const enabled = useFeature(feature);
  
  if (!enabled) return fallback;
  
  return (
    <a href={to} className={className}>
      {children}
    </a>
  );
}

/**
 * Generate sidebar navigation based on enabled features
 */
export function useFeatureNavigation(navConfig) {
  const { enabledFeatures } = useFeatures();
  
  return useMemo(() => {
    return navConfig.filter(item => {
      // No feature requirement = always show
      if (!item.feature) return true;
      
      // Check if feature is enabled
      return enabledFeatures.includes(item.feature);
    });
  }, [navConfig, enabledFeatures]);
}

// Core features that are always available
export const CORE_FEATURES = [
  'contacts',
  'jobs',
  'quotes',
  'invoices',
  'scheduling',
  'team',
  'dashboard',
];

export default {
  FeatureProvider,
  FeatureGate,
  FeatureNavItem,
  useFeatures,
  useFeature,
  useFeatureNavigation,
  withFeature,
  FeatureLink,
  CORE_FEATURES,
};

/**
 * Which tabs a business gets. The server names its industry (company.vertical — the unified app sends its vertical id on
 * sign-in and /api/auth/me), and that is the answer: an industry the phone app has screens for gets them; any other
 * (bar, salon, vet, restaurant, store, or one it does not know) is `unavailable`. Guessing from enabled features ran when
 * no vertical was sent, and made salons and bars a dispensary (loyalty_rewards) — so it runs only when the server sends
 * none at all.
 */

import { Vertical, PHONE_VERTICALS } from './verticals'

const FEATURE_SIGNALS: [string[], Vertical][] = [
  // Order matters: more specific matches first
  [['unit_inventory', 'deal_desk', 'deal_pipeline', 'trade_in'], 'rv'],
  [['evv', 'caregivers', 'care_plans'], 'homecare'],
  [['canvassing', 'insurance_claims', 'storm_leads'], 'roofing'],
  [['recurring_jobs', 'route_optimization', 'service_agreements'], 'landscaping'],
  [['service_dispatch', 'flat_rate_pricebook', 'maintenance_contracts'], 'fieldservice'],
]

export function detectVertical(
  explicitVertical?: string,
  enabledFeatures: string[] = [],
): Vertical {
  // 1. The server named it.
  if (explicitVertical) {
    return PHONE_VERTICALS.includes(explicitVertical as Vertical) ? (explicitVertical as Vertical) : 'unavailable'
  }

  // 2. Nothing named: infer from enabled features
  const featureSet = new Set(enabledFeatures.map(f => f.toLowerCase()))
  for (const [signals, vertical] of FEATURE_SIGNALS) {
    if (signals.some(s => featureSet.has(s))) {
      return vertical
    }
  }

  // 3. Default
  return 'contractor'
}

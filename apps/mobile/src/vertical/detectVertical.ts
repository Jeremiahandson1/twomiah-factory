/**
 * Fallback vertical detection — infers vertical from enabledFeatures when
 * company.vertical is not set (older CRM deployments).
 */

import { Vertical } from './verticals'

const FEATURE_SIGNALS: [string[], Vertical][] = [
  // Order matters: more specific matches first
  [['evv', 'caregivers', 'care_plans'], 'homecare'],
  [['pos', 'loyalty_rewards', 'menu'], 'dispensary'],
  [['canvassing', 'insurance_claims', 'storm_leads'], 'roofing'],
  [['service_dispatch', 'flat_rate_pricebook', 'maintenance_contracts'], 'fieldservice'],
]

export function detectVertical(
  explicitVertical?: string,
  enabledFeatures: string[] = [],
): Vertical {
  // 1. Use explicit vertical if provided and valid
  if (explicitVertical) {
    const valid: Vertical[] = ['contractor', 'fieldservice', 'homecare', 'roofing', 'dispensary']
    if (valid.includes(explicitVertical as Vertical)) {
      return explicitVertical as Vertical
    }
  }

  // 2. Infer from enabled features
  const featureSet = new Set(enabledFeatures.map(f => f.toLowerCase()))
  for (const [signals, vertical] of FEATURE_SIGNALS) {
    if (signals.some(s => featureSet.has(s))) {
      return vertical
    }
  }

  // 3. Default
  return 'contractor'
}

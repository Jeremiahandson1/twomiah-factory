/**
 * Fallback vertical detection — infers vertical from enabledFeatures when
 * company.vertical is not set (older CRM deployments).
 */

import { Vertical } from './verticals'

const FEATURE_SIGNALS: [string[], Vertical][] = [
  // Order matters: more specific matches first
  // Feature ids only crm-rv has (featureRegistry.ts) — a dealership. /api/auth/me sends no `vertical`,
  // so without a signal here an RV dealer fell through to 'contractor'. (T59)
  [['unit_inventory', 'deal_desk', 'deal_pipeline', 'trade_in'], 'rv'],
  [['evv', 'caregivers', 'care_plans'], 'homecare'],
  [['pos', 'loyalty_rewards', 'menu'], 'dispensary'],
  [['canvassing', 'insurance_claims', 'storm_leads'], 'roofing'],
  [['recurring_jobs', 'route_optimization', 'service_agreements'], 'landscaping'],
  [['service_dispatch', 'flat_rate_pricebook', 'maintenance_contracts'], 'fieldservice'],
]

export function detectVertical(
  explicitVertical?: string,
  enabledFeatures: string[] = [],
): Vertical {
  // 1. Use explicit vertical if provided and valid
  if (explicitVertical) {
    const valid: Vertical[] = ['contractor', 'fieldservice', 'homecare', 'roofing', 'landscaping', 'dispensary', 'rv']
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

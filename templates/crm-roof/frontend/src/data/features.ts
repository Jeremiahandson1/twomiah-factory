export const FEATURES = {
  measurement_reports: 'measurement_reports',
  insurance_workflow: 'insurance_workflow',
  customer_portal: 'customer_portal',
  quickbooks_sync: 'quickbooks_sync',
  two_way_texting: 'two_way_texting',
  canvassing_tool: 'canvassing_tool',
  storm_lead_gen: 'storm_lead_gen',
} as const

export function useFeature(featureId: string): boolean {
  // This would check company.enabledFeatures from AuthContext
  // For now, return true - feature gating integrated in components
  return true
}

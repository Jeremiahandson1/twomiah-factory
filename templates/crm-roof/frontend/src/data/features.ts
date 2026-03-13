import { useAuth } from '../contexts/AuthContext'

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
  const { company } = useAuth()
  return company?.enabledFeatures?.includes(featureId) ?? true
}

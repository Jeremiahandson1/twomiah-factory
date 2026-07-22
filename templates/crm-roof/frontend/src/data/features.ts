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

// Category-grouped catalog for the Settings → Features page. Covers EVERY id
// gated anywhere in this app (AppLayout, AdsPage, CustomerPortal, EstimatorPage,
// SettingsPage) — with useFeature's fallback-ON semantics, an id missing from
// this list would be silently disabled the first time an admin saves.
export const FEATURE_CATEGORIES = [
  {
    id: 'sales_field',
    name: 'Sales & Field',
    description: 'Lead generation and door-to-door tools',
    features: [
      { id: 'canvassing_tool', name: 'Canvassing / Door-Knocking', description: 'Territory maps and door-knock tracking for field reps' },
      { id: 'storm_lead_gen', name: 'Storm Leads', description: 'Storm radar and storm-hit address lead lists' },
      { id: 'paid_ads', name: 'Paid Ads Dashboard', description: 'Track ad spend and the leads your campaigns bring in' },
    ],
  },
  {
    id: 'roofing_ops',
    name: 'Roofing Operations',
    description: 'Measurements, claims, and job workflow',
    features: [
      { id: 'measurement_reports', name: 'Measurement Reports', description: 'Aerial roof measurement reports on jobs' },
      { id: 'insurance_workflow', name: 'Insurance Workflow', description: 'Claims, adjusters, and supplement tracking' },
    ],
  },
  {
    id: 'selling_tools',
    name: 'Customer & Selling Tools',
    description: 'What your customers see and use',
    features: [
      { id: 'customer_portal', name: 'Customer Portal', description: 'Give customers a login to see their jobs, quotes, and invoices' },
      { id: 'instant_estimator', name: 'Instant Estimator', description: 'Let homeowners get a ballpark roof estimate online' },
      { id: 'pricebook', name: 'Price Book', description: 'Standardized pricing for materials and labor' },
      { id: 'visualizer', name: 'Home Visualizer', description: 'Show customers their home with new roofing/siding colors' },
    ],
  },
  {
    id: 'office',
    name: 'Office & Integrations',
    description: 'Back-office and accounting connections',
    features: [
      { id: 'two_way_texting', name: 'Two-Way Texting', description: 'Text customers from the CRM and see replies in one thread' },
      { id: 'quickbooks_sync', name: 'QuickBooks Sync', description: 'Sync invoices and payments to QuickBooks' },
    ],
  },
]

// Premium-website industry coverage. MUST stay in sync with the backend's
// PREMIUM_*_INDUSTRIES sets in apps/api/src/services/generator.ts and
// apps/api/src/services/premiumSiteRenderer.ts — those decide which template
// dir gets copied; this file just lets the wizard surface the same coverage
// rules to the operator BEFORE they commit, instead of failing late in the
// deploy.
//
// When you add a new premium template, add its industries here too AND in
// both backend files.

export type PremiumTrack =
  | 'roofing'
  | 'homecare'
  | 'dispensary'
  | 'landscaping'
  | 'showcase'
  | 'fieldservice'
  | 'contractor'

const PREMIUM_ROOFING_INDUSTRIES = new Set([
  'roofing', 'roof', 'storm_restoration', 'siding_roofing',
])
const PREMIUM_HOMECARE_INDUSTRIES = new Set([
  'home_care', 'homecare', 'in_home_care', 'senior_care',
  'caregiving', 'companion_care',
])
const PREMIUM_DISPENSARY_INDUSTRIES = new Set([
  'dispensary', 'cannabis', 'cannabis_retail',
])
const PREMIUM_LANDSCAPING_INDUSTRIES = new Set([
  'landscaping', 'lawn_care', 'lawncare', 'landscape_design',
  'snow_removal', 'tree_service',
])
const PREMIUM_SHOWCASE_INDUSTRIES = new Set([
  'food', 'restaurant', 'hospitality', 'hotel', 'cafe',
  'fitness', 'gym', 'yoga', 'beauty', 'salon', 'spa',
  'events', 'wedding', 'catering',
])
const PREMIUM_CONTRACTOR_INDUSTRIES = new Set([
  'contractor', 'general_contractor', 'construction', 'remodeling',
  'siding', 'home_improvement',
])
const PREMIUM_FIELDSERVICE_INDUSTRIES = new Set([
  'field_service', 'hvac', 'plumbing', 'electrical', 'appliance_repair',
  'cleaning', 'pest_control', 'locksmith', 'garage_door',
])

const TRACK_LABEL: Record<PremiumTrack, string> = {
  roofing: 'Premium Roofing',
  homecare: 'Premium Home Care',
  dispensary: 'Premium Dispensary',
  landscaping: 'Premium Landscaping',
  showcase: 'Premium Showcase (food, hospitality, fitness, beauty, events)',
  fieldservice: 'Premium Field Service',
  contractor: 'Premium Contractor',
}

// Resolve an industry to the premium track that will render it, or null when
// no premium template supports it yet. Mirrors the routing block in
// generator.ts — keep the order of checks identical.
export function pickPremiumTrack(industry: string | undefined | null): PremiumTrack | null {
  const i = (industry || '').toLowerCase()
  if (PREMIUM_ROOFING_INDUSTRIES.has(i)) return 'roofing'
  if (PREMIUM_HOMECARE_INDUSTRIES.has(i)) return 'homecare'
  if (PREMIUM_DISPENSARY_INDUSTRIES.has(i)) return 'dispensary'
  if (PREMIUM_LANDSCAPING_INDUSTRIES.has(i)) return 'landscaping'
  if (PREMIUM_SHOWCASE_INDUSTRIES.has(i)) return 'showcase'
  if (PREMIUM_FIELDSERVICE_INDUSTRIES.has(i)) return 'fieldservice'
  if (PREMIUM_CONTRACTOR_INDUSTRIES.has(i) || !i || i === 'other') return 'contractor'
  return null
}

export function premiumTrackLabel(track: PremiumTrack): string {
  return TRACK_LABEL[track]
}

export function allSupportedPremiumIndustries(): string[] {
  return [
    ...Array.from(PREMIUM_ROOFING_INDUSTRIES),
    ...Array.from(PREMIUM_HOMECARE_INDUSTRIES),
    ...Array.from(PREMIUM_DISPENSARY_INDUSTRIES),
    ...Array.from(PREMIUM_LANDSCAPING_INDUSTRIES),
    ...Array.from(PREMIUM_SHOWCASE_INDUSTRIES),
    ...Array.from(PREMIUM_CONTRACTOR_INDUSTRIES),
    ...Array.from(PREMIUM_FIELDSERVICE_INDUSTRIES),
  ]
}

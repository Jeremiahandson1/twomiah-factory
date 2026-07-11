/**
 * Curated fallback "fill library" for service-card + hero images.
 *
 * The AI composer (contentGenerator.generateWebsiteContent) leaves image fields
 * empty. This library is the no-API baseline so cards and heroes are NEVER
 * blank — real, on-brand stock per vertical, verified by eye.
 *
 * SELF-HOSTED: the actual files live in templates/_shared/service-images/ and are
 * copied into every generated site's build/images/services/ at generation (see
 * fillWebsiteImages in generator.ts). Each site therefore serves its own images
 * from its own domain — no external Unsplash/CDN dependency, and the customer
 * truly owns their site. These paths must match the filenames in that folder.
 */
const p = (name: string) => '/images/services/' + name

export const SERVICE_IMAGE_LIBRARY: Record<string, string[]> = {
  roofing: [p('roofing-0.jpg'), p('roofing-1.jpg'), p('roofing-2.jpg'), p('roofing-3.jpg')],
  contractor: [p('contractor-0.jpg'), p('contractor-1.jpg'), p('contractor-2.jpg')],
  fieldservice: [p('fieldservice-0.jpg'), p('fieldservice-1.jpg'), p('fieldservice-2.jpg')],
  homecare: [p('homecare-0.jpg'), p('homecare-1.jpg'), p('homecare-2.jpg')],
  landscaping: [p('landscaping-0.jpg'), p('landscaping-1.jpg'), p('landscaping-2.jpg')],
  dispensary: [p('dispensary-0.jpg'), p('dispensary-1.jpg'), p('dispensary-2.jpg')],
  veterinary: [p('veterinary-0.jpg'), p('veterinary-1.jpg')],
  foodtruck: [p('foodtruck-0.jpg'), p('foodtruck-1.jpg'), p('foodtruck-2.jpg')],
  rv: [p('rv-0.jpg'), p('rv-1.jpg'), p('rv-2.jpg')],
  // GENERIC professional-service fallback (used for any unmapped industry).
  GENERIC: [p('GENERIC-0.jpg'), p('GENERIC-1.jpg'), p('GENERIC-2.jpg')],
}

// Map any intake industry value → a canonical library key above. Keeps the
// dropdown's many trade values pointed at the right photo set instead of GENERIC.
const INDUSTRY_ALIAS: Record<string, string> = {
  general_contractor: 'contractor', remodeler: 'contractor', painter: 'contractor',
  concrete: 'contractor', flooring: 'contractor', construction: 'contractor', builder: 'contractor',
  hvac: 'fieldservice', plumbing: 'fieldservice', plumber: 'fieldservice',
  electrical: 'fieldservice', electrician: 'fieldservice', field_service: 'fieldservice', appliance_repair: 'fieldservice',
  home_care: 'homecare', healthcare: 'homecare', senior_care: 'homecare',
  lawn_care: 'landscaping', lawncare: 'landscaping', landscape_design: 'landscaping', snow_removal: 'landscaping',
  cannabis: 'dispensary', cannabis_retail: 'dispensary',
  vet: 'veterinary', veterinarian: 'veterinary', vet_clinic: 'veterinary', animal_hospital: 'veterinary',
  food: 'foodtruck', food_truck: 'foodtruck', restaurant: 'foodtruck', cafe: 'foodtruck',
  rv_dealer: 'rv', powersports: 'rv', marine: 'rv',
}

/** Returns a fallback image URL for a service/hero by industry + index, or '' if none. */
export function getServiceImage(industry: string, i: number): string {
  const raw = (industry || '').toLowerCase().replace(/[\s-]+/g, '_')
  const key = SERVICE_IMAGE_LIBRARY[raw] ? raw : (INDUSTRY_ALIAS[raw] || raw)
  const set = (SERVICE_IMAGE_LIBRARY[key]?.length ? SERVICE_IMAGE_LIBRARY[key] : SERVICE_IMAGE_LIBRARY.GENERIC) || []
  return set.length ? set[i % set.length] : ''
}

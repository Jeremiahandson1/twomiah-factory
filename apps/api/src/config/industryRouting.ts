/**
 * Industry → Template routing (single source of truth).
 *
 * Every signup specifies an industry. This file maps that industry
 * string to:
 *   1. The CRM template the tenant gets (templates/crm-...)
 *   2. The premium-website template the tenant gets (templates/website-premium-...)
 *   3. The legacy non-premium website template (templates/website-...)
 *
 * Until this file existed, the CRM and premium-website mappings drifted —
 * e.g. `cleaning` correctly routed to website-premium-fieldservice, but
 * the CRM picker had a narrower `FIELD_SERVICE_INDUSTRIES` set that
 * didn't include cleaning, so a cleaning business got the wrong
 * (contractor) CRM. Routing decisions now live here and only here.
 *
 * Adding a new industry: add it to the right vertical's set (or coin a
 * new vertical if it warrants its own template). The fallback is the
 * `crm` / `website-premium-contractor` pair — vague enough to read
 * okay for unmatched industries, but you should explicitly map common
 * cases here so customers get the closest-fit experience.
 */

export type CrmTemplate =
  | 'crm'
  | 'crm-fieldservice'
  | 'crm-homecare'
  | 'crm-roof'
  | 'crm-landscaping'
  | 'crm-dispensary'
  | 'crm-rv'
  | 'crm-vet'
  | 'crm-store'

export type PremiumWebsiteTemplate =
  | 'website-premium-contractor'
  | 'website-premium-fieldservice'
  | 'website-premium-homecare'
  | 'website-premium-roofing'
  | 'website-premium-landscaping'
  | 'website-premium-dispensary'
  | 'website-premium-showcase'
  | 'website-premium-foodtruck'
  | 'website-premium-vet'
  | 'website-premium-rv'

export type LegacyWebsiteTemplate =
  | 'website-general'
  | 'website-contractor'
  | 'website-fieldservice'
  | 'website-homecare'
  | 'website-roofing'
  | 'website-landscaping'
  | 'website-dispensary'
  | 'website-showcase'
  | 'website-store'

export type Vertical =
  | 'contractor'
  | 'fieldservice'
  | 'homecare'
  | 'roofing'
  | 'landscaping'
  | 'dispensary'
  | 'showcase'
  | 'foodtruck'
  | 'rv'
  | 'veterinary'
  | 'store'

// ─── Industry sets per vertical ─────────────────────────────────────
// These are the strings the intake form / wizard / API may receive.
// Keep lowercase + snake_case. Any string not in any set falls back
// to the contractor vertical.

export const ROOFING_INDUSTRIES = new Set([
  'roofing', 'roof', 'roofer', 'roof_repair',
  'storm_restoration', 'siding_roofing',
])

export const HOMECARE_INDUSTRIES = new Set([
  'home_care', 'homecare', 'in_home_care', 'senior_care',
  'caregiving', 'companion_care', 'home_health',
])

export const DISPENSARY_INDUSTRIES = new Set([
  'dispensary', 'cannabis', 'cannabis_retail',
])

export const LANDSCAPING_INDUSTRIES = new Set([
  'landscaping', 'lawn_care', 'lawncare', 'landscape_design',
  'snow_removal', 'tree_service', 'arborist', 'hardscape',
])

export const FIELDSERVICE_INDUSTRIES = new Set([
  'field_service', 'hvac', 'plumbing', 'electrical', 'appliance_repair',
  // Cleaning businesses: the data model fits — recurring jobs,
  // mobile crews, route/schedule, customer history. UI vocab is
  // "tech" but customers map it to "cleaner" without friction.
  'cleaning', 'house_cleaning', 'maid_service', 'janitorial',
  'commercial_cleaning', 'carpet_cleaning', 'window_cleaning',
  'pressure_washing', 'gutter_cleaning',
  // Other recurring/mobile services that fit the same template:
  'pest_control', 'exterminator', 'locksmith', 'garage_door',
  'septic', 'pool_service', 'irrigation', 'handyman',
  'painting',  // painters use jobs + crews like field service
  'mobile_detailing', 'mobile_mechanic', 'pet_grooming', 'dog_walking',
])

export const SHOWCASE_INDUSTRIES = new Set([
  'restaurant', 'hospitality', 'hotel', 'cafe',
  'fitness', 'gym', 'yoga', 'beauty', 'salon', 'spa',
  'events', 'wedding', 'catering', 'photography',
])

export const FOODTRUCK_INDUSTRIES = new Set([
  'food_truck', 'foodtruck', 'food', 'mobile_food',
  'food_cart', 'mobile_kitchen', 'pop_up_kitchen',
])

// RV + Powersports DEALERSHIPS. One combined vertical/template (crm-rv) —
// the unit model handles both via a category discriminator. Sales-floor
// dealership CRM (inventory, leads, deals, trade-ins, service), NOT the
// recurring-job model the other verticals use.
export const RV_INDUSTRIES = new Set([
  'rv', 'rv_dealer', 'rv_dealership', 'rv_sales', 'recreational_vehicle',
  'motorhome', 'camper', 'travel_trailer', 'trailer_dealer', 'trailer_dealership',
  // Powersports dealers share the same sales/service dealership model:
  'powersports', 'powersport', 'motorsports',
  'motorcycle_dealer', 'motorcycle_dealership', 'atv_dealer', 'utv_dealer',
  'marine_dealer', 'boat_dealer', 'boat_dealership',
  // Auto dealers: same sales-floor archetype (inventory, leads, deals,
  // trade-ins, service). crm-automotive is PARKED and cannot boot — auto
  // dealers get the maintained dealership CRM (crm-rv) instead of falling
  // through to the contractor vertical with contractor website content.
  'automotive', 'auto_dealer', 'auto_dealership', 'car_dealer',
  'car_dealership', 'used_cars', 'used_car_dealer', 'auto_sales',
])

// Veterinary practices. A client-relationship + preventive-care record
// (patients/pets, appointments, visits, vaccinations, reminders, wellness
// plans) — the retention archetype, NOT the recurring-job model. Deep clinical
// record; controlled-substance dispensing is deliberately out of scope.
export const VET_INDUSTRIES = new Set([
  'veterinary', 'veterinarian', 'vet', 'vet_clinic', 'vet_hospital',
  'veterinary_clinic', 'veterinary_hospital', 'veterinary_practice',
  'animal_hospital', 'animal_clinic', 'pet_clinic', 'pet_hospital',
  'mobile_vet', 'equine_vet', 'exotic_vet', 'small_animal_vet',
])

// E-commerce / online retail. A product catalog + orders storefront
// (website-store) backed by a store back-office (crm-store) — NOT the
// recurring-job or dealership model. Merchant brings their own payment
// account (Stripe now; Square/PayPal later) and sells physical goods with
// hosted checkout.
export const STORE_INDUSTRIES = new Set([
  'store', 'ecommerce', 'e_commerce', 'online_store', 'online_shop',
  'retail', 'shop', 'boutique', 'storefront',
  'clothing', 'apparel', 'fashion', 'merch', 'merchandise',
  'goods', 'products', 'print_on_demand', 'dropshipping', 'dropship',
  'handmade', 'crafts', 'jewelry', 'accessories', 'cosmetics_retail',
])

export const CONTRACTOR_INDUSTRIES = new Set([
  'contractor', 'general_contractor', 'construction', 'remodeling',
  'siding', 'home_improvement',
  // Kitchen + bath remodelers (e.g. "The Kitchen Technique"):
  'kitchen', 'kitchen_remodeling', 'kitchen_design', 'kitchen_installation',
  'bath_remodeling', 'bathroom_remodeling',
  // Other build-style trades:
  'deck_builder', 'fence_installation', 'drywall', 'flooring',
  'framing', 'concrete', 'masonry', 'tile', 'cabinet_maker',
])

// ─── Resolvers ──────────────────────────────────────────────────────

/**
 * Normalize variants the intake form sometimes sends (spaces, hyphens,
 * "general contracting" → "general_contractor", etc.) before we look
 * up. Anything that doesn't normalize cleanly falls through unchanged
 * and gets the contractor fallback.
 */
export function normalizeIndustry(input: string | undefined | null): string {
  if (!input) return ''
  let s = String(input).toLowerCase().trim()
  s = s.replace(/[\s\-]+/g, '_')
  // Common phrasings the intake form might capture:
  s = s.replace(/^general_contracting$/, 'general_contractor')
  s = s.replace(/^lawn_and_landscape$/, 'landscaping')
  s = s.replace(/^home_care_nonmedical$/, 'home_care')
  s = s.replace(/^cleaning_service$/, 'cleaning')
  s = s.replace(/^cleaning_services$/, 'cleaning')
  s = s.replace(/^house_keeping$/, 'cleaning')
  s = s.replace(/^housekeeping$/, 'cleaning')
  // Food truck variants: people type "mobile food", "food truck",
  // "foodtruck", "food cart", "mobile kitchen" — all should route to
  // the dedicated food truck template, not the generic showcase.
  s = s.replace(/^food_truck_business$/, 'food_truck')
  s = s.replace(/^mobile_food_truck$/, 'food_truck')
  s = s.replace(/^food_trucks$/, 'food_truck')
  return s
}

export function verticalFor(industry: string | undefined | null): Vertical {
  const i = normalizeIndustry(industry)
  // Food truck must check BEFORE showcase — 'food' used to fall through
  // to showcase (restaurant template); now it goes to the dedicated
  // food truck template which is purpose-built for mobile food.
  if (FOODTRUCK_INDUSTRIES.has(i)) return 'foodtruck'
  if (ROOFING_INDUSTRIES.has(i)) return 'roofing'
  if (HOMECARE_INDUSTRIES.has(i)) return 'homecare'
  if (DISPENSARY_INDUSTRIES.has(i)) return 'dispensary'
  if (LANDSCAPING_INDUSTRIES.has(i)) return 'landscaping'
  if (FIELDSERVICE_INDUSTRIES.has(i)) return 'fieldservice'
  if (RV_INDUSTRIES.has(i)) return 'rv'
  if (VET_INDUSTRIES.has(i)) return 'veterinary'
  if (STORE_INDUSTRIES.has(i)) return 'store'
  if (SHOWCASE_INDUSTRIES.has(i)) return 'showcase'
  // Explicit contractor list + the empty/other fallback both land here.
  // Showcase doesn't get the fallback — it's the most specialized vertical
  // and would feel weird as a default for, say, a generic "services" intake.
  return 'contractor'
}

export function crmTemplateFor(industry: string | undefined | null): CrmTemplate {
  const v = verticalFor(industry)
  switch (v) {
    case 'homecare':     return 'crm-homecare'
    case 'fieldservice': return 'crm-fieldservice'
    case 'roofing':      return 'crm-roof'
    case 'landscaping':  return 'crm-landscaping'
    case 'dispensary':   return 'crm-dispensary'
    case 'rv':           return 'crm-rv'
    case 'veterinary':   return 'crm-vet'
    case 'store':        return 'crm-store'
    // Showcase verticals (restaurants, salons, etc.) don't have a
    // dedicated CRM template yet — most don't need full job/quote
    // workflows. Default to the contractor base, which is the most
    // general-purpose CRM we have (contacts, jobs, invoices).
    case 'showcase':     return 'crm'
    // Food trucks share the showcase CRM model — contacts (catering
    // leads), jobs (events), invoices. No specialized truck-CRM
    // template yet; the contractor base is the right fit.
    case 'foodtruck':    return 'crm'
    case 'contractor':   return 'crm'
  }
}

export function premiumWebsiteTemplateFor(industry: string | undefined | null): PremiumWebsiteTemplate {
  const v = verticalFor(industry)
  // Both verticals used to fall back to the contractor site, so a vet clinic
  // buying a premium website got a general-contractor site. They have their own
  // templates now.
  if (v === 'rv') return 'website-premium-rv'
  if (v === 'veterinary') return 'website-premium-vet'
  // Store uses the dedicated website-store storefront (not a premium marketing
  // site) — this fallback only guards against a nonexistent template dir.
  if (v === 'store') return 'website-premium-contractor'
  return ('website-premium-' + v) as PremiumWebsiteTemplate
}

export function legacyWebsiteTemplateFor(industry: string | undefined | null): LegacyWebsiteTemplate {
  const v = verticalFor(industry)
  // The legacy website-* family doesn't have every vertical the premium
  // family does — fall back to 'website-general' for cases without a
  // matching template.
  const map: Record<Vertical, LegacyWebsiteTemplate> = {
    contractor:   'website-contractor',
    fieldservice: 'website-fieldservice',
    homecare:     'website-homecare',
    roofing:      'website-roofing',
    landscaping:  'website-landscaping',
    dispensary:   'website-dispensary',
    showcase:     'website-showcase',
    // No legacy food truck template — falls back to website-general.
    // Premium customers always get the dedicated foodtruck template.
    foodtruck:    'website-general' as LegacyWebsiteTemplate,
    // No RV website template (CRM-only vertical) — falls back to general.
    rv:           'website-general' as LegacyWebsiteTemplate,
    // No vet website template (CRM-only vertical) — falls back to general.
    veterinary:   'website-general' as LegacyWebsiteTemplate,
    // E-commerce storefront (Next.js). The generator ladder routes here.
    store:        'website-store',
  }
  return map[v] || 'website-general'
}

/**
 * URL slug used in CRM service naming. Mirrors the existing per-industry
 * suffix scheme: most verticals have a per-vertical word (e.g. -wrench-api,
 * -care-api), contractor + showcase fall back to a plain {slug}-api with
 * no infix word. Returns the full base name like 'wrench' or empty
 * string for the no-infix case.
 *
 *   buildCrmApiHost('acme', 'cleaning')  → 'acme-wrench-api.onrender.com'
 *   buildCrmApiHost('acme', 'remodeling')→ 'acme-api.onrender.com'
 */
export function crmServiceSuffixFor(industry: string | undefined | null): string {
  const v = verticalFor(industry)
  switch (v) {
    case 'homecare':     return 'care'
    case 'fieldservice': return 'wrench'
    case 'roofing':      return 'roof'
    case 'landscaping':  return 'landscape'
    case 'dispensary':   return 'leaf'
    case 'rv':           return 'rv'   // {slug}-rv-api.onrender.com
    case 'veterinary':   return 'vet'  // {slug}-vet-api.onrender.com
    case 'store':        return 'shop' // {slug}-shop-api.onrender.com
    case 'showcase':     return ''     // shares the contractor base CRM
    case 'foodtruck':    return ''     // shares the contractor base CRM
    case 'contractor':   return ''
  }
}

export function buildCrmApiHost(slug: string, industry: string | undefined | null): string {
  const suffix = crmServiceSuffixFor(industry)
  return suffix
    ? `${slug}-${suffix}-api.onrender.com`
    : `${slug}-api.onrender.com`
}

// ─── Site layout mode per vertical ───────────────────────────────────────
// Some verticals naturally want a one-page scroll (food truck: location +
// menu + schedule + catering all flow on one phone screen, IG-bio-link
// optimized). Others need deep multi-page sites (dispensary with a 30+
// strain catalog and education hub; hotel with multiple rooms +
// editorial + local map). The composer produces the same content shape
// either way; the RENDERER decides whether to stitch them into one
// scroll or serve them as separate routes.
export type LayoutMode = 'single-page' | 'multi-page'

const LAYOUT_MODE_BY_VERTICAL: Record<Vertical, LayoutMode> = {
  foodtruck: 'single-page',
  // Everything else is multi-page until we add intake-driven detection
  // for "solo-stylist salon", "neighborhood cafe", "personal trainer",
  // etc. that would benefit from single-page too.
  contractor: 'multi-page',
  fieldservice: 'multi-page',
  homecare: 'multi-page',
  roofing: 'multi-page',
  landscaping: 'multi-page',
  dispensary: 'multi-page',
  showcase: 'multi-page',
  rv: 'multi-page',
  veterinary: 'multi-page',
  store: 'multi-page',
}

export function layoutModeFor(industry: string | undefined | null): LayoutMode {
  return LAYOUT_MODE_BY_VERTICAL[verticalFor(industry)]
}

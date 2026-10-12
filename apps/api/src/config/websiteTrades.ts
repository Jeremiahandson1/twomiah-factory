/**
 * Which STANDARD website a signup trade gets, and how the site names that trade.
 *
 * Keyed by the raw value the twomiah.com signup pages send (`industry`), before
 * generate() folds hvac/plumbing/electrical into 'field_service'. Website only —
 * the CRM picker (industryRouting.verticalFor) is untouched.
 *
 * A trade only goes to a trade-specific template when that template was written
 * for it: website-contractor is a roofing/exterior site (roofing posts, siding
 * service areas) and website-fieldservice an HVAC/plumbing site (furnace posts).
 * Every other trade gets website-general, which ships no sample posts, reviews
 * or services, named for the trade and filled with the owner's own services.
 * Medical and residential care (hospice, skilled home health, senior living,
 * pediatric) is NOT put on the non-medical home-care site.
 *
 * Signup values not listed here keep the generator's existing routing.
 */
export interface WebsiteTrade {
  template: 'website-contractor' | 'website-fieldservice' | 'website-landscaping' | 'website-homecare' | 'website-vet' | 'website-rv' | 'website-general'
  /** How the site names the trade: "Painting in Eau Claire, WI". */
  label: string
  /** The one service card a site gets when the owner lists none. */
  service: string
  /** serviceImageLibrary set for the hero/cards ('GENERIC' when none fits). */
  photos: string
}

const T = (template: WebsiteTrade['template'], label: string, service: string, photos: string): WebsiteTrade =>
  ({ template, label, service, photos })

export const WEBSITE_TRADES: Record<string, WebsiteTrade> = {
  // Templates written for the trade
  roofing:              T('website-contractor',   'Roofing',             'Roofing',             'roofing'),
  hvac:                 T('website-fieldservice', 'Heating & Cooling',   'Heating & Cooling',   'fieldservice'),
  plumbing:             T('website-fieldservice', 'Plumbing',            'Plumbing',            'fieldservice'),
  plumber:              T('website-fieldservice', 'Plumbing',            'Plumbing',            'fieldservice'),
  field_service:        T('website-fieldservice', 'Heating, Cooling & Plumbing', 'Heating, Cooling & Plumbing', 'fieldservice'),
  landscaping:          T('website-landscaping',  'Landscaping',         'Landscaping',         'landscaping'),
  landscaper:           T('website-landscaping',  'Landscaping',         'Landscaping',         'landscaping'),
  veterinary:           T('website-vet',          'Veterinary Care',     'Veterinary Care',     'veterinary'),
  rv:                   T('website-rv',           'RV & Powersports Dealership', 'RV & Powersports Sales', 'rv'),
  automotive:           T('website-rv',           'RV & Powersports Dealership', 'RV & Powersports Sales', 'rv'), // briefBuilder's name for an RV dealer
  // Non-medical in-home care
  home_care:            T('website-homecare',     'In-Home Care',        'In-Home Care',        'homecare'),
  home_care_nonmedical: T('website-homecare',     'In-Home Care',        'In-Home Care',        'homecare'),
  personal_care:        T('website-homecare',     'Personal Care',       'Personal Care',       'homecare'),
  companion_care:       T('website-homecare',     'Companion Care',      'Companion Care',      'homecare'),
  respite_care:         T('website-homecare',     'Respite Care',        'Respite Care',        'homecare'),
  // Building trades — no template of their own
  general_contractor:   T('website-general',      'General Contracting', 'General Contracting', 'contractor'),
  remodeler:            T('website-general',      'Remodeling',          'Remodeling',          'contractor'),
  painter:              T('website-general',      'Painting',            'Painting',            'contractor'),
  concrete:             T('website-general',      'Concrete & Masonry',  'Concrete & Masonry',  'contractor'),
  flooring:             T('website-general',      'Flooring',            'Flooring',            'contractor'),
  general_handyman:     T('website-general',      'Handyman Services',   'Handyman Services',   'contractor'),
  // Service trades — no template of their own
  electrical:           T('website-general',      'Electrical',          'Electrical',          'fieldservice'),
  electrician:          T('website-general',      'Electrical',          'Electrical',          'fieldservice'),
  appliance_repair:     T('website-general',      'Appliance Repair',    'Appliance Repair',    'GENERIC'),
  garage_door:          T('website-general',      'Garage Doors',        'Garage Doors',        'GENERIC'),
  locksmith:            T('website-general',      'Locksmith',           'Locksmith Services',  'GENERIC'),
  pest_control:         T('website-general',      'Pest Control',        'Pest Control',        'GENERIC'),
  pool_spa:             T('website-general',      'Pool & Spa Service',  'Pool & Spa Service',  'GENERIC'),
  chimney_fireplace:    T('website-general',      'Chimney & Fireplace', 'Chimney & Fireplace', 'GENERIC'),
  // Medical / residential care and other care — not the non-medical home-care site
  hospice:              T('website-general',      'Hospice Care',        'Hospice Care',        'homecare'),
  home_health_skilled:  T('website-general',      'Home Health Care',    'Home Health Care',    'homecare'),
  senior_living:        T('website-general',      'Senior Living',       'Senior Living',       'homecare'),
  pediatric_home_care:  T('website-general',      'Pediatric Home Care', 'Pediatric Home Care', 'GENERIC'),
  disability_services:  T('website-general',      'Disability Services', 'Disability Services', 'GENERIC'),
}

export function websiteTradeFor(industry: string | undefined | null): WebsiteTrade | undefined {
  const key = String(industry || '').toLowerCase().trim().replace(/[\s-]+/g, '_')
  return Object.prototype.hasOwnProperty.call(WEBSITE_TRADES, key) ? WEBSITE_TRADES[key] : undefined
}

// Which business draws which trade's sections — the "Add a section" picker's one rule per vertical (site/admin.ts
// offersSection). Store live test, 2026-10-26: the picker offered an online store Age gate, Strains, Care finder,
// Caregivers, Storm alert, Urgent care, Inventory units and Quote by property size, and no section of its products.
//
// The list is the composer's: each section type below is used by the page plans (apps/api/src/services/sectionComposer.ts
// pageRecipesFor, read by the AI and the template composer alike) of the business types that run as these verticals —
// restaurant also runs food trucks and event venues, basic the showcase trades (cafés, gyms, hotels). The bar keeps every
// section the live bar's own editor drew (tests/site-section-fields.test.ts parity). A type not named here is the shared
// library's (hero, about, services, gallery, faq, testimonials, team, stats, contact, cta), offered to every business.
// tests/unified/factory/site-trade-sections.test.ts holds this list to the recipes, so the two cannot drift.
// Unified vertical ids (server/core/vertical.ts loadVertical): 'roofing' is the roofer's.
export const TRADE_SECTION_VERTICALS: Readonly<Record<string, readonly string[]>> = {
  // A cannabis dispensary's — no unified vertical runs one yet.
  age: [], strain: [],
  banner: ['roofing'],
  before_after: ['roofing', 'fieldservice', 'landscaping', 'salon', 'bar'],
  care: ['homecare'], caregivers: ['homecare'], coverage: ['homecare'],
  catering: ['restaurant', 'bar'],
  deals: ['restaurant', 'basic'],
  emergency: ['fieldservice'],
  events: ['bar'], hours: ['bar'], parties: ['bar'], regulars: ['bar'], speakeasy: ['bar'], taps: ['bar'], timeline: ['bar'], tonight: ['bar'], visit: ['bar'],
  inventory: ['rv'],
  location: ['restaurant', 'bar'],
  menu: ['restaurant', 'bar', 'basic'],
  packages: ['landscaping'],
  pricing: ['fieldservice', 'restaurant', 'basic'],
  quote: ['roofing', 'landscaping'],
  reservation: ['contractor', 'roofing', 'fieldservice', 'landscaping', 'homecare', 'vet', 'rv', 'salon', 'restaurant', 'basic'],
  schedule: ['restaurant', 'basic', 'bar'],
  service_area: ['fieldservice'],
  // A store's products, live from its catalogue (sections/shop/grid; the server fills them).
  shop: ['store'],
  social: ['restaurant', 'bar'],
  trust: ['roofing', 'fieldservice', 'homecare', 'vet', 'rv', 'bar'],
  urgent: ['vet'],
}

/** Whether a business of this vertical draws sections of this type. */
export function tradeDrawsSection(type: string, verticalId: string): boolean {
  const who = TRADE_SECTION_VERTICALS[type]
  return !who || who.includes(verticalId)
}

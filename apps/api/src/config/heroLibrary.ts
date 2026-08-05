// Curated, self-hosted hero/support imagery per vertical — the composer's
// tier-3 photo source (customer uploads and licensed stock still win).
//
// Files live in apps/api/assets/hero-library/<group>/ and are served by the
// factory at /hero-library/<group>/<file> (immutable). Every image in this
// manifest was downloaded from a free-commercial-license source (no
// attribution required) and VERIFIED BY EYE before being committed — that
// human check is the whole point: no hallucinated photo IDs, no theater
// audiences on home-care sites, no external CDN dependency.
//
// Populate via the curation harness (scratchpad/curate-heroes.ts): it
// searches the stock API, downloads candidates for visual review, then
// copies keepers here and regenerates this manifest.

export interface HeroImage {
  file: string // filename under assets/hero-library/<group>/
  tag: string  // what the shot shows — the composer matches this to sections
}

// Groups mirror the composer's recipe verticals (sectionComposer.ts recipe
// selection). Keep the two in sync when adding verticals.
export const HERO_LIBRARY: Record<string, HeroImage[]> = {
  contractor: [],
  roofing: [],
  homecare: [],
  fieldservice: [],
  landscaping: [],
  dispensary: [],
  restaurant: [],
  cafe: [],
  salon: [],
  fitness: [],
  hotel: [],
  events: [],
  foodtruck: [],
  generic: [],
}

// Same businessType → group logic as the composer's recipe chain (kept in
// sync manually, like the two recipe-selection chains already are).
export function pickHeroGroup(businessType: string): string {
  const t = (businessType || '').toLowerCase()
  const rx = (parts: string[]) => parts.some(p => t.includes(p))
  if (rx(['food truck', 'foodtruck', 'food cart', 'mobile food', 'mobile kitchen'])) return 'foodtruck'
  if (rx(['roof', 'gutter', 'siding'])) return 'roofing'
  if (rx(['home care', 'homecare', 'senior', 'caregiv', 'in-home', 'assisted'])) return 'homecare'
  if (rx(['dispensary', 'cannabis', 'cbd', 'weed'])) return 'dispensary'
  if (rx(['landscap', 'lawn', 'tree service', 'hardscap', 'snow'])) return 'landscaping'
  if (rx(['hvac', 'plumb', 'electric', 'heating', 'cooling', 'appliance'])) return 'fieldservice'
  if (rx(['cafe', 'coffee', 'bakery', 'espresso'])) return 'cafe'
  if (rx(['restaurant', 'bbq', 'pizza', 'taco', 'diner', 'grill', 'eatery', 'bistro'])) return 'restaurant'
  if (rx(['salon', 'spa', 'barber', 'beauty', 'nails', 'lash', 'tattoo'])) return 'salon'
  if (rx(['gym', 'fitness', 'yoga', 'pilates', 'crossfit', 'martial'])) return 'fitness'
  if (rx(['hotel', 'inn', 'lodge', 'resort', 'bnb', 'bed and breakfast'])) return 'hotel'
  if (rx(['event', 'wedding', 'dj', 'photograph', 'florist', 'planner'])) return 'events'
  if (rx(['contractor', 'construction', 'remodel', 'renovat', 'builder', 'handyman', 'concrete', 'paint', 'deck', 'fenc', 'flooring', 'drywall', 'mason'])) return 'contractor'
  return 'generic'
}

/** Absolute URLs + tags for the composer prompt. Empty when the group has no
 *  curated images yet — callers must treat that as "tier absent". */
export function getHeroLibrary(businessType: string): Array<{ url: string; tag: string }> {
  const base = (process.env.TWOMIAH_FACTORY_URL || process.env.FACTORY_PUBLIC_URL || '').replace(/\/$/, '')
  if (!base) return []
  const group = pickHeroGroup(businessType)
  const entries = [
    ...(HERO_LIBRARY[group] || []).map(i => ({ ...i, group })),
    ...(group !== 'generic' ? (HERO_LIBRARY.generic || []).map(i => ({ ...i, group: 'generic' })) : []),
  ]
  return entries.map(i => ({ url: `${base}/hero-library/${i.group}/${i.file}`, tag: i.tag }))
}

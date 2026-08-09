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

  // ─── Attribution ───────────────────────────────────────────────────
  // The Pexels API Guidelines require crediting the photographer and
  // linking back to Pexels wherever an API-sourced photo is shown — a
  // stricter obligation than the Pexels License itself, and the one we
  // committed to when applying for the key. The curation harness fills
  // these from the API response; nothing here is typed by hand.
  source?: 'pexels' | 'unsplash' | 'other'
  photographer?: string      // e.g. "Ryan Stephens"
  photographerUrl?: string   // their profile page on the source site
  sourceUrl?: string         // the photo's page on the source site
  sourceId?: string          // the source's own id, for re-checking later
  license?: string           // e.g. "Pexels License"
}

/** What a site renders in its footer for one photo. */
export interface PhotoCredit {
  photographer: string
  photographerUrl?: string
  sourceUrl?: string
  source: string
}

// Groups mirror the composer's recipe verticals (sectionComposer.ts recipe
// selection). Keep the two in sync when adding verticals.
export const HERO_LIBRARY: Record<string, HeroImage[]> = {
  contractor: [],
  roofing: [
    { file: "roofing-01.jpg", tag: "hero", source: 'pexels', photographer: "Ryan Stephens", photographerUrl: "https://www.pexels.com/@rstephens", sourceUrl: "https://www.pexels.com/photo/professional-roofer-installing-shingles-on-new-roof-33404248/", sourceId: "33404248", license: 'Pexels License' },
    { file: "roofing-02.jpg", tag: "services", source: 'pexels', photographer: "Ryan Stephens", photographerUrl: "https://www.pexels.com/@rstephens", sourceUrl: "https://www.pexels.com/photo/professional-roofing-installation-in-allen-texas-37677394/", sourceId: "37677394", license: 'Pexels License' },
    { file: "roofing-03.jpg", tag: "crew", source: 'pexels', photographer: "Ryan Stephens", photographerUrl: "https://www.pexels.com/@rstephens", sourceUrl: "https://www.pexels.com/photo/roof-installation-on-brick-house-in-fort-worth-33404080/", sourceId: "33404080", license: 'Pexels License' },
    { file: "roofing-04.jpg", tag: "projects", source: 'pexels', photographer: "Ryan Stephens", photographerUrl: "https://www.pexels.com/@rstephens", sourceUrl: "https://www.pexels.com/photo/roof-repair-and-construction-in-fort-worth-33404981/", sourceId: "33404981", license: 'Pexels License' },
    { file: "roofing-05.jpg", tag: "projects", source: 'pexels', photographer: "Ryan Stephens", photographerUrl: "https://www.pexels.com/@rstephens", sourceUrl: "https://www.pexels.com/photo/new-roof-installation-on-brick-house-in-texas-34304714/", sourceId: "34304714", license: 'Pexels License' },
    { file: "roofing-06.jpg", tag: "safety", source: 'pexels', photographer: "Daniel & Hannah Snipes", photographerUrl: "https://www.pexels.com/@prolificpeople", sourceUrl: "https://www.pexels.com/photo/roofer-at-work-with-safety-gear-in-north-carolina-38346822/", sourceId: "38346822", license: 'Pexels License' },
  ],
  homecare: [
    { file: "homecare-01.jpg", tag: "hero", source: 'pexels', photographer: "Yaroslav Shuraev", photographerUrl: "https://www.pexels.com/@yaroslav-shuraev", sourceUrl: "https://www.pexels.com/photo/elderly-woman-showing-her-earring-to-her-friend-8087554/", sourceId: "8087554", license: 'Pexels License' },
    { file: "homecare-02.jpg", tag: "services", source: 'pexels', photographer: "Los Muertos Crew", photographerUrl: "https://www.pexels.com/@cristian-rojas", sourceUrl: "https://www.pexels.com/photo/woman-and-man-wearing-aprons-preparing-food-in-a-kitchen-8064899/", sourceId: "8064899", license: 'Pexels License' },
    { file: "homecare-03.jpg", tag: "housekeeping", source: 'pexels', photographer: "cottonbro studio", photographerUrl: "https://www.pexels.com/@cottonbro", sourceUrl: "https://www.pexels.com/photo/elderly-women-holding-a-white-cloth-6942735/", sourceId: "6942735", license: 'Pexels License' },
    { file: "homecare-04.jpg", tag: "companionship", source: 'pexels', photographer: "Kampus Production", photographerUrl: "https://www.pexels.com/@kampus", sourceUrl: "https://www.pexels.com/photo/man-in-pink-polo-shirt-sitting-beside-a-woman-in-white-t-shirt-8871440/", sourceId: "8871440", license: 'Pexels License' },
  ],
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


/** Map a served hero-library URL back to its manifest entry.
 *  Returns null for anything that is not ours (customer uploads, stock). */
export function heroImageForUrl(url: string): { group: string; image: HeroImage } | null {
  const m = /\/hero-library\/([^/]+)\/([^/?#]+)/.exec(url || '')
  if (!m) return null
  const [, group, file] = m
  const image = (HERO_LIBRARY[group] || []).find(i => i.file === file)
  return image ? { group, image } : null
}

/** Credits for the images a composed site actually uses.
 *
 *  Deliberately driven by the URLs that ended up in the content rather than
 *  by the whole library: a site credits the photos on it, not the ones it
 *  could have used. De-duplicated by photographer + photo, because the same
 *  image can appear in several sections.
 */
export function heroCreditsForUrls(urls: Array<string | null | undefined>): PhotoCredit[] {
  const seen = new Set<string>()
  const credits: PhotoCredit[] = []
  for (const url of urls) {
    const hit = heroImageForUrl(url || '')
    if (!hit) continue
    const { image } = hit
    // An image with no photographer recorded is not creditable — skip it
    // rather than render an empty credit line.
    if (!image.photographer) continue
    const key = image.photographer + '|' + (image.sourceUrl || image.file)
    if (seen.has(key)) continue
    seen.add(key)
    credits.push({
      photographer: image.photographer,
      photographerUrl: image.photographerUrl,
      sourceUrl: image.sourceUrl,
      source: image.source === 'pexels' ? 'Pexels'
        : image.source === 'unsplash' ? 'Unsplash'
        : (image.source || 'stock'),
    })
  }
  return credits
}

/** Every image URL inside an arbitrary composed-content object. */
export function collectImageUrls(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') {
    if (/^https?:\/\//.test(value) && /\/hero-library\//.test(value)) found.push(value)
    return found
  }
  if (Array.isArray(value)) {
    for (const v of value) collectImageUrls(v, found)
    return found
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectImageUrls(v, found)
  }
  return found
}

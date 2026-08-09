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
  contractor: [
    { file: "contractor-01.jpg", tag: "hero", source: 'pexels', photographer: "Mikael Blomkvist", photographerUrl: "https://www.pexels.com/@mikael-blomkvist", sourceUrl: "https://www.pexels.com/photo/man-in-black-shirt-holding-black-power-tool-8961401/", sourceId: "8961401", license: 'Pexels License' },
    { file: "contractor-02.jpg", tag: "consultation", source: 'pexels', photographer: "Mikael Blomkvist", photographerUrl: "https://www.pexels.com/@mikael-blomkvist", sourceUrl: "https://www.pexels.com/photo/man-in-blue-denim-jeans-standing-beside-woman-in-black-and-white-checkered-shirt-8961343/", sourceId: "8961343", license: 'Pexels License' },
    { file: "contractor-03.jpg", tag: "services", source: 'pexels', photographer: "https://kaboompics.com/", photographerUrl: "https://www.pexels.com/@karola-g", sourceUrl: "https://www.pexels.com/photo/person-hammering-a-nail-into-the-wood-7285984/", sourceId: "7285984", license: 'Pexels License' },
    { file: "contractor-04.jpg", tag: "craft", source: 'pexels', photographer: "Los Muertos Crew", photographerUrl: "https://www.pexels.com/@cristian-rojas", sourceUrl: "https://www.pexels.com/photo/close-up-shot-of-a-carpenter-measuring-a-wood-plank-8447774/", sourceId: "8447774", license: 'Pexels License' },
    { file: "contractor-05.jpg", tag: "projects", source: 'pexels', photographer: "Curtis Adams", photographerUrl: "https://www.pexels.com/@curtis-adams-1694007", sourceUrl: "https://www.pexels.com/photo/modern-neutral-kitchen-with-granite-countertops-36777548/", sourceId: "36777548", license: 'Pexels License' },
  ],
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
  fieldservice: [
    { file: "fieldservice-01.jpg", tag: "hero", source: 'pexels', photographer: "Anastasia Shuraeva", photographerUrl: "https://www.pexels.com/@anastasia-shuraeva", sourceUrl: "https://www.pexels.com/photo/a-man-in-white-button-up-shirt-smiling-7647233/", sourceId: "7647233", license: 'Pexels License' },
    { file: "fieldservice-02.jpg", tag: "plumbing", source: 'pexels', photographer: "Sergei Starostin", photographerUrl: "https://www.pexels.com/@sejio402", sourceUrl: "https://www.pexels.com/photo/professional-plumber-installing-a-radiator-pipe-29226620/", sourceId: "29226620", license: 'Pexels License' },
    { file: "fieldservice-03.jpg", tag: "electrical", source: 'pexels', photographer: "Mikael Blomkvist", photographerUrl: "https://www.pexels.com/@mikael-blomkvist", sourceUrl: "https://www.pexels.com/photo/a-man-and-a-woman-wearing-goggles-holding-red-pipes-8961701/", sourceId: "8961701", license: 'Pexels License' },
    { file: "fieldservice-04.jpg", tag: "tools", source: 'pexels', photographer: "AS Photography", photographerUrl: "https://www.pexels.com/@asphotography", sourceUrl: "https://www.pexels.com/photo/wrench-and-pipes-on-sketch-14953886/", sourceId: "14953886", license: 'Pexels License' },
  ],
  landscaping: [
    { file: "landscaping-01.jpg", tag: "hero", source: 'pexels', photographer: "Max Vakhtbovych", photographerUrl: "https://www.pexels.com/@artbovich", sourceUrl: "https://www.pexels.com/photo/house-backyard-with-lawn-green-grass-7546775/", sourceId: "7546775", license: 'Pexels License' },
    { file: "landscaping-02.jpg", tag: "services", source: 'pexels', photographer: "Anna Shvets", photographerUrl: "https://www.pexels.com/@shvetsa", sourceUrl: "https://www.pexels.com/photo/man-trimming-the-leaves-5027602/", sourceId: "5027602", license: 'Pexels License' },
    { file: "landscaping-03.jpg", tag: "projects", source: 'pexels', photographer: "Max Vakhtbovych", photographerUrl: "https://www.pexels.com/@artbovich", sourceUrl: "https://www.pexels.com/photo/clouds-around-house-8092385/", sourceId: "8092385", license: 'Pexels License' },
  ],
  dispensary: [],
  restaurant: [
    { file: "restaurant-01.jpg", tag: "hero", source: 'pexels', photographer: "Quang Nguyen Vinh", photographerUrl: "https://www.pexels.com/@quang-nguyen-vinh-222549", sourceUrl: "https://www.pexels.com/photo/interior-of-the-melia-vinpearl-thanh-hoa-luxury-hotel-in-thanh-hoa-city-vietnam-26729395/", sourceId: "26729395", license: 'Pexels License' },
    { file: "restaurant-02.jpg", tag: "ambiance", source: 'pexels', photographer: "Alexandra Kollstrem", photographerUrl: "https://www.pexels.com/@alexandra-kollstrem-77751824", sourceUrl: "https://www.pexels.com/photo/wine-glasses-on-bar-counter-8856561/", sourceId: "8856561", license: 'Pexels License' },
  ],
  cafe: [
    { file: "cafe-01.jpg", tag: "hero", source: 'pexels', photographer: "Jack Atkinson", photographerUrl: "https://www.pexels.com/@jack-atkinson-1289771108", sourceUrl: "https://www.pexels.com/photo/man-preparing-coffee-at-cafe-24613535/", sourceId: "24613535", license: 'Pexels License' },
    { file: "cafe-02.jpg", tag: "services", source: 'pexels', photographer: "Ubeydulah Beşir KÖROĞLU", photographerUrl: "https://www.pexels.com/@ubeydulah-besir-koroglu-2155166096", sourceUrl: "https://www.pexels.com/photo/barista-pouring-fresh-coffee-in-cafe-35819418/", sourceId: "35819418", license: 'Pexels License' },
  ],
  salon: [
    { file: "salon-01.jpg", tag: "hero", source: 'pexels', photographer: "Nataliya Vaitkevich", photographerUrl: "https://www.pexels.com/@n-voitkevich", sourceUrl: "https://www.pexels.com/photo/woman-in-white-shirt-and-blue-denim-jeans-getting-a-haircut-8467964/", sourceId: "8467964", license: 'Pexels License' },
    { file: "salon-02.jpg", tag: "styling", source: 'pexels', photographer: "Ron Lach", photographerUrl: "https://www.pexels.com/@ron-lach", sourceUrl: "https://www.pexels.com/photo/hairdresser-using-curling-iron-on-customers-hair-10318038/", sourceId: "10318038", license: 'Pexels License' },
  ],
  fitness: [
    { file: "fitness-01.jpg", tag: "hero", source: 'pexels', photographer: "ShotPot", photographerUrl: "https://www.pexels.com/@shotpot", sourceUrl: "https://www.pexels.com/photo/photo-of-guy-lifting-weights-4047159/", sourceId: "4047159", license: 'Pexels License' },
    { file: "fitness-02.jpg", tag: "classes", source: 'pexels', photographer: "Andrea Piacquadio", photographerUrl: "https://www.pexels.com/@olly", sourceUrl: "https://www.pexels.com/photo/women-in-sports-bra-and-black-leggings-while-doing-exercise-3776144/", sourceId: "3776144", license: 'Pexels License' },
  ],
  hotel: [
    { file: "hotel-01.jpg", tag: "hero", source: 'pexels', photographer: "Ramaz Bluashvili", photographerUrl: "https://www.pexels.com/@ramazphotos", sourceUrl: "https://www.pexels.com/photo/luxurious-cozy-bedroom-in-tbilisi-hotel-32418082/", sourceId: "32418082", license: 'Pexels License' },
    { file: "hotel-02.jpg", tag: "rooms", source: 'pexels', photographer: "cottonbro studio", photographerUrl: "https://www.pexels.com/@cottonbro", sourceUrl: "https://www.pexels.com/photo/elegant-wooden-sleeping-bed-6466236/", sourceId: "6466236", license: 'Pexels License' },
  ],
  events: [
    { file: "events-01.jpg", tag: "hero", source: 'pexels', photographer: "NUDE Nahum", photographerUrl: "https://www.pexels.com/@nudethephotographer", sourceUrl: "https://www.pexels.com/photo/elegant-outdoor-wedding-table-setting-with-floral-centerpiece-37190239/", sourceId: "37190239", license: 'Pexels License' },
    { file: "events-02.jpg", tag: "styling", source: 'pexels', photographer: "Mizzu Cho", photographerUrl: "https://www.pexels.com/@nicetomizzu", sourceUrl: "https://www.pexels.com/photo/a-flower-vase-and-glassware-on-a-table-6910896/", sourceId: "6910896", license: 'Pexels License' },
  ],
  foodtruck: [
    { file: "foodtruck-01.jpg", tag: "hero", source: 'pexels', photographer: "Robert So", photographerUrl: "https://www.pexels.com/@robertkso", sourceUrl: "https://www.pexels.com/photo/women-buying-coffee-at-a-mobile-food-truck-16782204/", sourceId: "16782204", license: 'Pexels License' },
  ],
  generic: [
    { file: "generic-01.jpg", tag: "team", source: 'pexels', photographer: "Kampus Production", photographerUrl: "https://www.pexels.com/@kampus", sourceUrl: "https://www.pexels.com/photo/men-wearing-apron-smiling-together-8475204/", sourceId: "8475204", license: 'Pexels License' },
    { file: "generic-02.jpg", tag: "hero", source: 'pexels', photographer: "Amina Filkins", photographerUrl: "https://www.pexels.com/@amina-filkins", sourceUrl: "https://www.pexels.com/photo/calm-woman-standing-in-doorway-of-store-5413720/", sourceId: "5413720", license: 'Pexels License' },
  ],
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
/** Some Pexels contributors set their display name to a bare URL
 *  ("https://kaboompics.com/"), which renders as a URL in a footer credit.
 *  Show the readable brand instead — same person, same profile link, just not
 *  a raw URL in the middle of a sentence. The manifest keeps the name exactly
 *  as the API returned it; this is display only. */
function displayName(name: string): string {
  const m = /^https?:\/\/(?:www\.)?([^/]+)/i.exec(name.trim())
  if (!m) return name
  const host = m[1].replace(/\.(com|net|org|io|co|photography)$/i, '')
  return host.charAt(0).toUpperCase() + host.slice(1)
}

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
      photographer: displayName(image.photographer),
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

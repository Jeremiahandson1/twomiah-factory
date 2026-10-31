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

/** One line in a site's footer credit. Grouped per photographer rather than
 *  per photo — four photos by the same person read as one credit, not four. */
export interface PhotoCredit {
  photographer: string
  photographerUrl?: string
  /** The photo's own page. Present only when this photographer contributed a
   *  single image; one link cannot point at four pages. */
  sourceUrl?: string
  source: string
  /** How many of this photographer's photos the site uses. */
  count: number
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
    { file: "contractor-06.jpg", tag: "consultation", source: 'pexels', photographer: "Mikael Blomkvist", photographerUrl: "https://www.pexels.com/@mikael-blomkvist", sourceUrl: "https://www.pexels.com/photo/a-man-and-a-woman-holding-a-paper-while-standing-on-the-tiled-wall-8961296/", sourceId: "8961296", license: 'Pexels License' },
    { file: "contractor-07.jpg", tag: "projects", source: 'pexels', photographer: "Curtis Adams", photographerUrl: "https://www.pexels.com/@curtis-adams-1694007", sourceUrl: "https://www.pexels.com/photo/white-marble-tiled-shower-cabin-5502225/", sourceId: "5502225", license: 'Pexels License' },
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
    { file: "homecare-05.jpg", tag: "companionship", source: 'pexels', photographer: "cottonbro studio", photographerUrl: "https://www.pexels.com/@cottonbro", sourceUrl: "https://www.pexels.com/photo/elderly-woman-in-blue-shirt-beside-a-woman-in-white-7232031/", sourceId: "7232031", license: 'Pexels License' },
    { file: "homecare-06.jpg", tag: "companionship", source: 'pexels', photographer: "SHVETS production", photographerUrl: "https://www.pexels.com/@shvets-production", sourceUrl: "https://www.pexels.com/photo/an-elderly-couple-having-a-conversation-8972500/", sourceId: "8972500", license: 'Pexels License' },
  ],
  fieldservice: [
    { file: "fieldservice-01.jpg", tag: "hero", source: 'pexels', photographer: "Anastasia Shuraeva", photographerUrl: "https://www.pexels.com/@anastasia-shuraeva", sourceUrl: "https://www.pexels.com/photo/a-man-in-white-button-up-shirt-smiling-7647233/", sourceId: "7647233", license: 'Pexels License' },
    { file: "fieldservice-02.jpg", tag: "plumbing", source: 'pexels', photographer: "Sergei Starostin", photographerUrl: "https://www.pexels.com/@sejio402", sourceUrl: "https://www.pexels.com/photo/professional-plumber-installing-a-radiator-pipe-29226620/", sourceId: "29226620", license: 'Pexels License' },
    { file: "fieldservice-03.jpg", tag: "electrical", source: 'pexels', photographer: "Mikael Blomkvist", photographerUrl: "https://www.pexels.com/@mikael-blomkvist", sourceUrl: "https://www.pexels.com/photo/a-man-and-a-woman-wearing-goggles-holding-red-pipes-8961701/", sourceId: "8961701", license: 'Pexels License' },
    { file: "fieldservice-04.jpg", tag: "tools", source: 'pexels', photographer: "AS Photography", photographerUrl: "https://www.pexels.com/@asphotography", sourceUrl: "https://www.pexels.com/photo/wrench-and-pipes-on-sketch-14953886/", sourceId: "14953886", license: 'Pexels License' },
    { file: "fieldservice-05.jpg", tag: "hvac", source: 'pexels', photographer: "Israel Markle", photographerUrl: "https://www.pexels.com/@israelmarkle", sourceUrl: "https://www.pexels.com/photo/industrial-air-conditioning-units-in-florence-40476251/", sourceId: "40476251", license: 'Pexels License' },
    { file: "fieldservice-06.jpg", tag: "electrical", source: 'pexels', photographer: "mickael ange konan", photographerUrl: "https://www.pexels.com/@mickael-ange-konan-2156070331", sourceUrl: "https://www.pexels.com/photo/female-technician-working-on-electrical-control-panel-34526423/", sourceId: "34526423", license: 'Pexels License' },
  ],
  landscaping: [
    { file: "landscaping-01.jpg", tag: "hero", source: 'pexels', photographer: "Max Vakhtbovych", photographerUrl: "https://www.pexels.com/@artbovich", sourceUrl: "https://www.pexels.com/photo/house-backyard-with-lawn-green-grass-7546775/", sourceId: "7546775", license: 'Pexels License' },
    { file: "landscaping-02.jpg", tag: "services", source: 'pexels', photographer: "Anna Shvets", photographerUrl: "https://www.pexels.com/@shvetsa", sourceUrl: "https://www.pexels.com/photo/man-trimming-the-leaves-5027602/", sourceId: "5027602", license: 'Pexels License' },
    { file: "landscaping-03.jpg", tag: "projects", source: 'pexels', photographer: "Max Vakhtbovych", photographerUrl: "https://www.pexels.com/@artbovich", sourceUrl: "https://www.pexels.com/photo/clouds-around-house-8092385/", sourceId: "8092385", license: 'Pexels License' },
    { file: "landscaping-04.jpg", tag: "services", source: 'pexels', photographer: "Vaan Photography", photographerUrl: "https://www.pexels.com/@vaan-photos", sourceUrl: "https://www.pexels.com/photo/a-man-mowing-the-green-lawn-12087398/", sourceId: "12087398", license: 'Pexels License' },
    { file: "landscaping-05.jpg", tag: "projects", source: 'pexels', photographer: "Jan Wright", photographerUrl: "https://www.pexels.com/@jan-wright-2156785233", sourceUrl: "https://www.pexels.com/photo/vibrant-flower-beds-in-congleton-park-40382453/", sourceId: "40382453", license: 'Pexels License' },
    { file: "landscaping-06.jpg", tag: "projects", source: 'pexels', photographer: "Brett A", photographerUrl: "https://www.pexels.com/@brett-a-2161021813", sourceUrl: "https://www.pexels.com/photo/tranquil-stone-patio-in-new-york-garden-37785078/", sourceId: "37785078", license: 'Pexels License' },
  ],
  dispensary: [],
  restaurant: [
    { file: "restaurant-01.jpg", tag: "hero", source: 'pexels', photographer: "Quang Nguyen Vinh", photographerUrl: "https://www.pexels.com/@quang-nguyen-vinh-222549", sourceUrl: "https://www.pexels.com/photo/interior-of-the-melia-vinpearl-thanh-hoa-luxury-hotel-in-thanh-hoa-city-vietnam-26729395/", sourceId: "26729395", license: 'Pexels License' },
    { file: "restaurant-02.jpg", tag: "ambiance", source: 'pexels', photographer: "Alexandra Kollstrem", photographerUrl: "https://www.pexels.com/@alexandra-kollstrem-77751824", sourceUrl: "https://www.pexels.com/photo/wine-glasses-on-bar-counter-8856561/", sourceId: "8856561", license: 'Pexels License' },
    { file: "restaurant-03.jpg", tag: "hero", source: 'pexels', photographer: "Magda Ehlers", photographerUrl: "https://www.pexels.com/@magda-ehlers-pexels", sourceUrl: "https://www.pexels.com/photo/elegant-restaurant-with-extensive-wine-collection-35636873/", sourceId: "35636873", license: 'Pexels License' },
    { file: "restaurant-04.jpg", tag: "services", source: 'pexels', photographer: "Willians Huerta", photographerUrl: "https://www.pexels.com/@willians-huerta-2157111846", sourceUrl: "https://www.pexels.com/photo/chef-adding-finishing-touches-to-gourmet-dish-36430088/", sourceId: "36430088", license: 'Pexels License' },
    { file: "restaurant-05.jpg", tag: "services", source: 'pexels', photographer: "Diana ✨", photographerUrl: "https://www.pexels.com/@didsss", sourceUrl: "https://www.pexels.com/photo/casual-dining-with-beers-and-platters-33312298/", sourceId: "33312298", license: 'Pexels License' },
    { file: "restaurant-06.jpg", tag: "guests", source: 'pexels', photographer: "Adrienn", photographerUrl: "https://www.pexels.com/@adrienn-638530", sourceUrl: "https://www.pexels.com/photo/woman-eating-bruschetta-1537635/", sourceId: "1537635", license: 'Pexels License' },
    { file: "restaurant-07.jpg", tag: "space", source: 'pexels', photographer: "Antoni Shkraba", photographerUrl: "https://www.pexels.com/@shkrabaanthony", sourceUrl: "https://www.pexels.com/photo/a-bartender-making-a-cocktail-4485382/", sourceId: "4485382", license: 'Pexels License' },
  ],
  cafe: [
    { file: "cafe-01.jpg", tag: "hero", source: 'pexels', photographer: "Jack Atkinson", photographerUrl: "https://www.pexels.com/@jack-atkinson-1289771108", sourceUrl: "https://www.pexels.com/photo/man-preparing-coffee-at-cafe-24613535/", sourceId: "24613535", license: 'Pexels License' },
    { file: "cafe-02.jpg", tag: "services", source: 'pexels', photographer: "Ubeydulah Beşir KÖROĞLU", photographerUrl: "https://www.pexels.com/@ubeydulah-besir-koroglu-2155166096", sourceUrl: "https://www.pexels.com/photo/barista-pouring-fresh-coffee-in-cafe-35819418/", sourceId: "35819418", license: 'Pexels License' },
    { file: "cafe-03.jpg", tag: "hero", source: 'pexels', photographer: "Andrea Piacquadio", photographerUrl: "https://www.pexels.com/@olly", sourceUrl: "https://www.pexels.com/photo/woman-holding-stainless-cup-and-ceramic-cup-3914062/", sourceId: "3914062", license: 'Pexels License' },
    { file: "cafe-04.jpg", tag: "space", source: 'pexels', photographer: "Arda Kaykısız", photographerUrl: "https://www.pexels.com/@arda-kaykisiz-672105204", sourceUrl: "https://www.pexels.com/photo/plants-in-a-restaurant-18721993/", sourceId: "18721993", license: 'Pexels License' },
    { file: "cafe-05.jpg", tag: "services", source: 'pexels', photographer: "Chevanon Photography", photographerUrl: "https://www.pexels.com/@chevanon", sourceUrl: "https://www.pexels.com/photo/close-up-of-hand-holding-cappuccino-302901/", sourceId: "302901", license: 'Pexels License' },
    { file: "cafe-06.jpg", tag: "services", source: 'pexels', photographer: "Faheem Ahamad", photographerUrl: "https://www.pexels.com/@faheem-ahamad-422934800", sourceUrl: "https://www.pexels.com/photo/assorted-baked-goods-on-display-in-bakery-40408087/", sourceId: "40408087", license: 'Pexels License' },
  ],
  salon: [
    { file: "salon-01.jpg", tag: "hero", source: 'pexels', photographer: "Nataliya Vaitkevich", photographerUrl: "https://www.pexels.com/@n-voitkevich", sourceUrl: "https://www.pexels.com/photo/woman-in-white-shirt-and-blue-denim-jeans-getting-a-haircut-8467964/", sourceId: "8467964", license: 'Pexels License' },
    { file: "salon-02.jpg", tag: "styling", source: 'pexels', photographer: "Ron Lach", photographerUrl: "https://www.pexels.com/@ron-lach", sourceUrl: "https://www.pexels.com/photo/hairdresser-using-curling-iron-on-customers-hair-10318038/", sourceId: "10318038", license: 'Pexels License' },
    { file: "salon-03.jpg", tag: "hero", source: 'pexels', photographer: "Kampus Production", photographerUrl: "https://www.pexels.com/@kampus", sourceUrl: "https://www.pexels.com/photo/woman-in-black-long-sleeves-cutting-the-hair-of-customer-8834092/", sourceId: "8834092", license: 'Pexels License' },
    { file: "salon-04.jpg", tag: "services", source: 'pexels', photographer: "Marvin Sacdalan", photographerUrl: "https://www.pexels.com/@marvin-sacdalan-276316567", sourceUrl: "https://www.pexels.com/photo/barber-cutting-client-hair-in-saloon-13138585/", sourceId: "13138585", license: 'Pexels License' },
    { file: "salon-05.jpg", tag: "services", source: 'pexels', photographer: "RDNE Stock project", photographerUrl: "https://www.pexels.com/@rdne", sourceUrl: "https://www.pexels.com/photo/a-woman-using-a-nail-file-while-polishing-nails-of-her-client-7755218/", sourceId: "7755218", license: 'Pexels License' },
    { file: "salon-06.jpg", tag: "space", source: 'pexels', photographer: "Max Vakhtbovych", photographerUrl: "https://www.pexels.com/@artbovich", sourceUrl: "https://www.pexels.com/photo/backwash-chairs-near-cosmetology-supplies-7195811/", sourceId: "7195811", license: 'Pexels License' },
    { file: "salon-07.jpg", tag: "space", source: 'pexels', photographer: "Max Vakhtbovych", photographerUrl: "https://www.pexels.com/@artbovich", sourceUrl: "https://www.pexels.com/photo/leather-chairs-in-front-of-round-mirrors-7750124/", sourceId: "7750124", license: 'Pexels License' },
  ],
  fitness: [
    { file: "fitness-01.jpg", tag: "hero", source: 'pexels', photographer: "ShotPot", photographerUrl: "https://www.pexels.com/@shotpot", sourceUrl: "https://www.pexels.com/photo/photo-of-guy-lifting-weights-4047159/", sourceId: "4047159", license: 'Pexels License' },
    { file: "fitness-02.jpg", tag: "classes", source: 'pexels', photographer: "Andrea Piacquadio", photographerUrl: "https://www.pexels.com/@olly", sourceUrl: "https://www.pexels.com/photo/women-in-sports-bra-and-black-leggings-while-doing-exercise-3776144/", sourceId: "3776144", license: 'Pexels License' },
    { file: "fitness-03.jpg", tag: "hero", source: 'pexels', photographer: "Victor Freitas", photographerUrl: "https://www.pexels.com/@victorfreitas", sourceUrl: "https://www.pexels.com/photo/man-about-to-lift-barbell-2261477/", sourceId: "2261477", license: 'Pexels License' },
    { file: "fitness-04.jpg", tag: "services", source: 'pexels', photographer: "Yan Krukau", photographerUrl: "https://www.pexels.com/@yankrukov", sourceUrl: "https://www.pexels.com/photo/photo-of-people-doing-yoga-8436626/", sourceId: "8436626", license: 'Pexels License' },
    { file: "fitness-05.jpg", tag: "services", source: 'pexels', photographer: "Julia Larson", photographerUrl: "https://www.pexels.com/@julia-larson", sourceUrl: "https://www.pexels.com/photo/multiethnic-man-and-woman-training-together-in-gym-6455903/", sourceId: "6455903", license: 'Pexels License' },
    { file: "fitness-06.jpg", tag: "services", source: 'pexels', photographer: "Andrea Piacquadio", photographerUrl: "https://www.pexels.com/@olly", sourceUrl: "https://www.pexels.com/photo/group-of-women-doing-exercise-inside-the-building-3775566/", sourceId: "3775566", license: 'Pexels License' },
  ],
  hotel: [
    { file: "hotel-01.jpg", tag: "hero", source: 'pexels', photographer: "Ramaz Bluashvili", photographerUrl: "https://www.pexels.com/@ramazphotos", sourceUrl: "https://www.pexels.com/photo/luxurious-cozy-bedroom-in-tbilisi-hotel-32418082/", sourceId: "32418082", license: 'Pexels License' },
    { file: "hotel-02.jpg", tag: "rooms", source: 'pexels', photographer: "cottonbro studio", photographerUrl: "https://www.pexels.com/@cottonbro", sourceUrl: "https://www.pexels.com/photo/elegant-wooden-sleeping-bed-6466236/", sourceId: "6466236", license: 'Pexels License' },
    { file: "hotel-03.jpg", tag: "hero", source: 'pexels', photographer: "Pixabay", photographerUrl: "https://www.pexels.com/@pixabay", sourceUrl: "https://www.pexels.com/photo/black-and-grey-bedspread-on-bed-and-pillow-164595/", sourceId: "164595", license: 'Pexels License' },
    { file: "hotel-04.jpg", tag: "space", source: 'pexels', photographer: "Quang Nguyen Vinh", photographerUrl: "https://www.pexels.com/@quang-nguyen-vinh-222549", sourceUrl: "https://www.pexels.com/photo/the-reception-area-of-a-hotel-14036253/", sourceId: "14036253", license: 'Pexels License' },
    { file: "hotel-05.jpg", tag: "space", source: 'pexels', photographer: "Olga Udovychenko", photographerUrl: "https://www.pexels.com/@ladyhelga", sourceUrl: "https://www.pexels.com/photo/flowers-in-vase-on-tray-23731964/", sourceId: "23731964", license: 'Pexels License' },
    { file: "hotel-06.jpg", tag: "services", source: 'pexels', photographer: "Andrea Piacquadio", photographerUrl: "https://www.pexels.com/@olly", sourceUrl: "https://www.pexels.com/photo/selective-focus-photo-of-reception-signage-3768095/", sourceId: "3768095", license: 'Pexels License' },
  ],
  events: [
    { file: "events-01.jpg", tag: "hero", source: 'pexels', photographer: "NUDE Nahum", photographerUrl: "https://www.pexels.com/@nudethephotographer", sourceUrl: "https://www.pexels.com/photo/elegant-outdoor-wedding-table-setting-with-floral-centerpiece-37190239/", sourceId: "37190239", license: 'Pexels License' },
    { file: "events-02.jpg", tag: "styling", source: 'pexels', photographer: "Mizzu Cho", photographerUrl: "https://www.pexels.com/@nicetomizzu", sourceUrl: "https://www.pexels.com/photo/a-flower-vase-and-glassware-on-a-table-6910896/", sourceId: "6910896", license: 'Pexels License' },
    { file: "events-03.jpg", tag: "hero", source: 'pexels', photographer: "Engin Akyurt", photographerUrl: "https://www.pexels.com/@enginakyurt", sourceUrl: "https://www.pexels.com/photo/tables-with-flowers-9644360/", sourceId: "9644360", license: 'Pexels License' },
    { file: "events-04.jpg", tag: "space", source: 'pexels', photographer: "Matheus Bertelli", photographerUrl: "https://www.pexels.com/@bertellifotografia", sourceUrl: "https://www.pexels.com/photo/a-table-decoration-for-a-wedding-17001792/", sourceId: "17001792", license: 'Pexels License' },
    { file: "events-05.jpg", tag: "services", source: 'pexels', photographer: "Amina Filkins", photographerUrl: "https://www.pexels.com/@amina-filkins", sourceUrl: "https://www.pexels.com/photo/smiling-florist-making-composition-of-flowers-in-floristry-shop-5414019/", sourceId: "5414019", license: 'Pexels License' },
    { file: "events-06.jpg", tag: "services", source: 'pexels', photographer: "Yan Krukau", photographerUrl: "https://www.pexels.com/@yankrukov", sourceUrl: "https://www.pexels.com/photo/man-using-audio-mixer-9005458/", sourceId: "9005458", license: 'Pexels License' },
  ],
  foodtruck: [
    { file: "foodtruck-01.jpg", tag: "hero", source: 'pexels', photographer: "Robert So", photographerUrl: "https://www.pexels.com/@robertkso", sourceUrl: "https://www.pexels.com/photo/women-buying-coffee-at-a-mobile-food-truck-16782204/", sourceId: "16782204", license: 'Pexels License' },
    { file: "foodtruck-02.jpg", tag: "hero", source: 'pexels', photographer: "Peter Lopez", photographerUrl: "https://www.pexels.com/@peter-lopez-3895759", sourceUrl: "https://www.pexels.com/photo/people-sitting-on-chairs-near-the-food-truck-during-night-11655727/", sourceId: "11655727", license: 'Pexels License' },
    { file: "foodtruck-03.jpg", tag: "hero", source: 'pexels', photographer: "Medina Edelbi", photographerUrl: "https://www.pexels.com/@medina-edelbi-153182799", sourceUrl: "https://www.pexels.com/photo/red-cafe-truck-20218397/", sourceId: "20218397", license: 'Pexels License' },
    { file: "foodtruck-04.jpg", tag: "services", source: 'pexels', photographer: "Mâide Arslan", photographerUrl: "https://www.pexels.com/@maide-arslan-128712163", sourceUrl: "https://www.pexels.com/photo/people-near-foodtruck-during-christmas-fair-19652493/", sourceId: "19652493", license: 'Pexels License' },
    { file: "foodtruck-05.jpg", tag: "services", source: 'pexels', photographer: "RDNE Stock project", photographerUrl: "https://www.pexels.com/@rdne", sourceUrl: "https://www.pexels.com/photo/man-receiving-orders-from-a-vendor-on-a-food-truck-5779533/", sourceId: "5779533", license: 'Pexels License' },
    { file: "foodtruck-06.jpg", tag: "services", source: 'pexels', photographer: "DΛVΞ GΛRCIΛ", photographerUrl: "https://www.pexels.com/@davegarcia", sourceUrl: "https://www.pexels.com/photo/delicious-tacos-with-fresh-guacamole-and-cilantro-36498698/", sourceId: "36498698", license: 'Pexels License' },
  ],
  generic: [
    { file: "generic-01.jpg", tag: "team", source: 'pexels', photographer: "Kampus Production", photographerUrl: "https://www.pexels.com/@kampus", sourceUrl: "https://www.pexels.com/photo/men-wearing-apron-smiling-together-8475204/", sourceId: "8475204", license: 'Pexels License' },
    { file: "generic-02.jpg", tag: "hero", source: 'pexels', photographer: "Amina Filkins", photographerUrl: "https://www.pexels.com/@amina-filkins", sourceUrl: "https://www.pexels.com/photo/calm-woman-standing-in-doorway-of-store-5413720/", sourceId: "5413720", license: 'Pexels License' },
    { file: "generic-03.jpg", tag: "hero", source: 'pexels', photographer: "Demetra Ioannidou", photographerUrl: "https://www.pexels.com/@demetra-ioannidou-420891723", sourceUrl: "https://www.pexels.com/photo/smiling-shopkeeper-with-homemade-preserves-34674788/", sourceId: "34674788", license: 'Pexels License' },
    { file: "generic-04.jpg", tag: "services", source: 'pexels', photographer: "Gustavo Fring", photographerUrl: "https://www.pexels.com/@gustavo-fring", sourceUrl: "https://www.pexels.com/photo/female-customers-getting-paper-bags-at-counter-desk-3865901/", sourceId: "3865901", license: 'Pexels License' },
    { file: "generic-05.jpg", tag: "services", source: 'pexels', photographer: "https://kaboompics.com/", photographerUrl: "https://www.pexels.com/@karola-g", sourceUrl: "https://www.pexels.com/photo/anonymous-man-preparing-package-for-shipment-4464482/", sourceId: "4464482", license: 'Pexels License' },
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
  // Bars / taverns / pubs share the restaurant hero set until a bar set exists.
  // Word-bounded so 'barber' / 'nail bar' / 'juice bar' don't land here.
  if (/\b(tavern|pub|taproom|brewpub|brewery|saloon|speakeasy|bar)\b/.test(t) && !/\b(nail|lash|brow|juice|smoothie|espresso|coffee|sushi|salad|oxygen)\b/.test(t)) return 'restaurant'
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


// ─── When live stock photos are used ─────────────────────────────────────────
// A trade whose checked library is thin — fewer than LIVE_STOCK_BELOW photos — gets live Pexels photos BESIDE its own,
// so two businesses are not the same few pictures. A trade with a full library keeps only its checked photos (10/31 every
// trade's library was grown to six or more; only an empty group like dispensary is thin now). Stores and other businesses
// with no trade ('generic') always take live photos too: what fits is what they sell, which no library can know. Home
// care is checked photos only, whatever its count: a live search for "home care" returns hospital beds, drips and
// scrubs, and the owner's rule is daily living, no medical imagery.
export const LIVE_STOCK_BELOW = 6
export const CURATED_ONLY_GROUPS: ReadonlySet<string> = new Set(['homecare'])

/** May this business's site use live stock photos (as well as the checked library)? */
export function liveStockFor(businessType: string): boolean {
  const group = pickHeroGroup(businessType)
  if (CURATED_ONLY_GROUPS.has(group)) return false
  if (group === 'generic') return true
  return (HERO_LIBRARY[group]?.length || 0) < LIVE_STOCK_BELOW
}

// ─── Live stock registry (tier 2) ───────────────────────────────────────────
// Images fetched live from a stock API (Pexels) during a compose are not in the
// static manifest, but the Pexels Guidelines still require crediting the
// photographer + linking back. The fetcher registers each photo's attribution
// here keyed by its (query-stripped) URL, and the same URL-driven credit path
// that serves the curated library then covers live photos too. Process-lifetime
// cache of PUBLIC attribution only — no tenant data — so cross-request reuse is
// fine and the same URL always maps to the same photographer.
const liveImageRegistry = new Map<string, HeroImage>()

function cleanUrl(url: string): string { return (url || '').split(/[?#]/)[0] }

/** Record a live-sourced photo's attribution so credits + collection see it. */
export function registerLiveImage(url: string, image: HeroImage): void {
  const clean = cleanUrl(url)
  if (!clean || liveImageRegistry.has(clean)) return
  if (liveImageRegistry.size >= 10_000) liveImageRegistry.clear() // simple bound
  liveImageRegistry.set(clean, image)
}

/** Map a served URL back to its manifest entry OR a registered live photo.
 *  Returns null for anything that is not ours (customer uploads, unknown). */
export function heroImageForUrl(url: string): { group: string; image: HeroImage } | null {
  const live = liveImageRegistry.get(cleanUrl(url))
  if (live) return { group: live.source || 'live', image: live }
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
  const seenImage = new Set<string>()
  const byPhotographer = new Map<string, PhotoCredit>()

  for (const url of urls) {
    const hit = heroImageForUrl(url || '')
    if (!hit) continue
    const { image } = hit
    // An image with no photographer recorded is not creditable — skip it
    // rather than render an empty credit line.
    if (!image.photographer) continue

    // Count each distinct photo once, however many sections reuse it.
    const imageKey = image.photographer + '|' + (image.sourceUrl || image.file)
    if (seenImage.has(imageKey)) continue
    seenImage.add(imageKey)

    const source = image.source === 'pexels' ? 'Pexels'
      : image.source === 'unsplash' ? 'Unsplash'
      : (image.source || 'stock')

    const key = displayName(image.photographer) + '|' + source
    const existing = byPhotographer.get(key)
    if (existing) {
      existing.count++
      // Two photos, so the single-photo deep link no longer applies.
      existing.sourceUrl = undefined
    } else {
      byPhotographer.set(key, {
        photographer: displayName(image.photographer),
        photographerUrl: image.photographerUrl,
        sourceUrl: image.sourceUrl,
        source,
        count: 1,
      })
    }
  }

  return [...byPhotographer.values()]
}

/** Every creditable image URL inside an arbitrary composed-content object —
 *  curated library photos AND live-registered stock photos (Pexels). */
export function collectImageUrls(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') {
    if (/^https?:\/\//.test(value) && (/\/hero-library\//.test(value) || liveImageRegistry.has(cleanUrl(value)))) found.push(value)
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

/** Two credit lists as one: one line per photographer and source, counts added. A site's credits are the ones saved
 *  when it was composed (the live registry was warm then) together with the ones its pages work out now. */
export function mergeCredits(...lists: Array<PhotoCredit[] | null | undefined>): PhotoCredit[] {
  const out = new Map<string, PhotoCredit>()
  for (const list of lists) for (const c of Array.isArray(list) ? list : []) {
    if (!c?.photographer) continue
    const key = c.photographer + '|' + (c.source || '')
    const had = out.get(key)
    if (!had) { out.set(key, { ...c }); continue }
    // The same line from both lists is one credit, not two.
    if (had.sourceUrl && had.sourceUrl === c.sourceUrl) continue
    had.count = Math.max(had.count, 0) + Math.max(c.count || 1, 1)
    had.sourceUrl = undefined
  }
  return [...out.values()]
}

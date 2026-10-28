/**
 * SAMPLE content for the free preview on twomiah.com — and nowhere else.
 *
 * A preview built from a name, a trade and a town has a hero, one stand-in "What we do" card and a call to action: a
 * real site states only what the owner gave (FACTS_POLICY, services/sectionComposer.ts), so that is all it can honestly
 * say. The owner wants the preview to look like a FULL site, so the preview — and only the preview — is filled with
 * clearly marked sample sections: services with photos, a gallery, a review or two, an about block, an FAQ, and (for a
 * shop) sample products.
 *
 * Rules this file holds:
 *   • Imported only by unified/preview.ts. provisionSite, the composers and signupSite never see it, so a real site cannot
 *     carry any of it (tests/unified/factory/preview-samples.test.ts proves it, by content and by import).
 *   • Every sample section carries `sample: true` (SAMPLE_MARK): the preview's marker, and what the test looks for.
 *   • Nothing here claims a fact about a business: no names, years, prices a customer could rely on, licences, counts.
 *     A review is attributed "Sample review", never a made-up person; a price says "Sample price"; a project says
 *     "Sample project".
 *   • Photos are real: the Factory's own self-hosted stock (config/heroLibrary.ts, credited through heroCreditsForUrls)
 *     or images.unsplash.com photos each checked to load and to show what the card says. With no library address
 *     configured (TWOMIAH_FACTORY_URL) a section that needs photos is left out rather than drawn with broken boxes.
 */

/** The marker on every sample section. */
export const SAMPLE_MARK = 'sample' as const

/** The banner across the top of a preview that carries samples. */
export const SAMPLE_BANNER = 'Example content — your real site uses your own services, photos and reviews.'

export const isSampleSection = (s: unknown): boolean => !!s && typeof s === 'object' && (s as any)[SAMPLE_MARK] === true

type Section = { type: string; variant: string; data: Record<string, unknown>; sample?: true }
const mark = (s: Section): Section => ({ ...s, [SAMPLE_MARK]: true })

const un = (id: string) => `https://images.unsplash.com/photo-${id}?w=900&q=75`

type Img = (group: string, file: string) => string | null
const libraryImg = (base: string): Img => (group, file) => (base ? `${base}/hero-library/${group}/${file}` : null)

/** One trade's samples: card photos [group, file] or an unsplash id, and the words. */
interface TradeSample {
  services: Array<{ title: string; description: string; photo?: [string, string] | string }>
  gallery?: Array<{ photo: [string, string] | string; alt: string; caption: string }>
  galleryHeading?: string
  about: string[]
  aboutEyebrow?: string
  faq: Array<{ question: string; answer: string }>
  pricing?: Array<{ service: string; priceLabel: string; includes?: string[] }>
}

const REVIEWS = [
  { quote: 'This is where a happy customer’s own words go — what they hired you for, and how it turned out.', author: 'Sample review', role: 'Example only' },
  { quote: 'Your real site shows the reviews you choose to publish, so this space reads as proof, not as filler.', author: 'Sample review', role: 'Example only' },
]

const SAMPLES: Record<string, TradeSample> = {
  contractor: {
    services: [
      { title: 'Kitchen & bath remodels', description: 'Sample card: a service with a photo, a short plain description and room for the details you’d add.', photo: ['contractor', 'contractor-05.jpg'] },
      { title: 'Framing & carpentry', description: 'Sample card: your own services replace these, each with a photo of your own work.', photo: ['contractor', 'contractor-01.jpg'] },
      { title: 'Additions & renovations', description: 'Sample card: say what you build, who it’s for and how a job starts.', photo: ['contractor', 'contractor-02.jpg'] },
    ],
    gallery: [
      { photo: ['contractor', 'contractor-05.jpg'], alt: 'A finished kitchen', caption: 'Sample project — kitchen' },
      { photo: ['contractor', 'contractor-01.jpg'], alt: 'A carpenter working on a frame', caption: 'Sample project — framing' },
      { photo: ['contractor', 'contractor-03.jpg'], alt: 'Hammering a nail into timber', caption: 'Sample project — carpentry' },
      { photo: ['contractor', 'contractor-02.jpg'], alt: 'A builder and a client reviewing a plan on site', caption: 'Sample project — site walk-through' },
      { photo: ['contractor', 'contractor-04.jpg'], alt: 'Measuring a board', caption: 'Sample project — finish work' },
      { photo: '1503387762-592deb58ef4e', alt: 'A builder drawing up plans', caption: 'Sample project — planning' },
    ],
    galleryHeading: 'Recent projects (sample)',
    about: ['Sample about block: this is where you tell people who you are, how long you’ve been building and what you care about.', 'Your real site writes it from what you tell us — nothing here is about your business.'],
    faq: [
      { question: 'Sample question: how does a project start?', answer: 'Sample answer. Your real site answers in your own words: how people reach you, what you need to know and what happens next.' },
      { question: 'Sample question: do you give written quotes?', answer: 'Sample answer. You decide what you promise; your site only says what you tell it.' },
      { question: 'Sample question: what areas do you cover?', answer: 'Sample answer. Your real site lists the towns you serve.' },
      { question: 'Sample question: how long does a job take?', answer: 'Sample answer. Timelines are yours to state.' },
    ],
  },
  roofing: {
    services: [
      { title: 'Roof replacement', description: 'Sample card: a full replacement, shown with a photo of the work.', photo: ['roofing', 'roofing-02.jpg'] },
      { title: 'Repairs', description: 'Sample card: leaks, flashing and storm patches, in your words.', photo: ['roofing', 'roofing-03.jpg'] },
      { title: 'Storm damage', description: 'Sample card: what you do after a storm and how people reach you.', photo: ['roofing', 'roofing-04.jpg'] },
    ],
    gallery: [
      { photo: ['roofing', 'roofing-01.jpg'], alt: 'A roofer laying shingles', caption: 'Sample project — new shingles' },
      { photo: ['roofing', 'roofing-05.jpg'], alt: 'A stone house mid re-roof', caption: 'Sample project — full re-roof' },
      { photo: ['roofing', 'roofing-04.jpg'], alt: 'A crew on a brick house roof', caption: 'Sample project — storm repair' },
      { photo: ['roofing', 'roofing-02.jpg'], alt: 'A roofer fitting shingles', caption: 'Sample project — installation' },
      { photo: ['roofing', 'roofing-03.jpg'], alt: 'A crew laying underlayment', caption: 'Sample project — underlayment' },
      { photo: ['roofing', 'roofing-06.jpg'], alt: 'A roofer with safety gear', caption: 'Sample project — safety' },
    ],
    galleryHeading: 'Recent roofs (sample)',
    about: ['Sample about block: who you are, how you work and what a homeowner can expect.', 'Your real site writes it from what you tell us — nothing here is about your business.'],
    faq: [
      { question: 'Sample question: how do I get an estimate?', answer: 'Sample answer. Your real site says how to reach you and what you need to know.' },
      { question: 'Sample question: can you work with my insurance?', answer: 'Sample answer. What you offer is yours to state.' },
      { question: 'Sample question: what do you cover?', answer: 'Sample answer. Your real site lists your services and your areas.' },
      { question: 'Sample question: how long does a roof take?', answer: 'Sample answer. Timelines are yours to state.' },
    ],
  },
  homecare: {
    services: [
      { title: 'Companionship', description: 'Sample card: time, conversation and company at home.', photo: ['homecare', 'homecare-04.jpg'] },
      { title: 'Meal preparation', description: 'Sample card: help in the kitchen, in your words.', photo: ['homecare', 'homecare-02.jpg'] },
      { title: 'Light housekeeping', description: 'Sample card: your own services replace these, each with your own photo.', photo: ['homecare', 'homecare-03.jpg'] },
    ],
    gallery: [
      { photo: ['homecare', 'homecare-01.jpg'], alt: 'Two friends laughing on a sofa', caption: 'Sample moment — company' },
      { photo: ['homecare', 'homecare-02.jpg'], alt: 'Cooking together in a kitchen', caption: 'Sample moment — in the kitchen' },
      { photo: ['homecare', 'homecare-03.jpg'], alt: 'Changing the sheets together', caption: 'Sample moment — around the house' },
    ],
    galleryHeading: 'Care at home (sample)',
    about: ['Sample about block: who your caregivers are, how you match them and what families can expect.', 'Your real site writes it from what you tell us — nothing here is about your business.'],
    faq: [
      { question: 'Sample question: how do we get started?', answer: 'Sample answer. Your real site explains how a family reaches you and what happens first.' },
      { question: 'Sample question: can you help a few hours a week?', answer: 'Sample answer. Your schedule options are yours to state.' },
      { question: 'Sample question: how do you match a caregiver?', answer: 'Sample answer. Your real site describes your own process.' },
      { question: 'Sample question: what do you not provide?', answer: 'Sample answer. Your real site states your own limits.' },
    ],
  },
  fieldservice: {
    services: [
      { title: 'Repairs', description: 'Sample card: a service with a photo and a short plain description.', photo: ['fieldservice', 'fieldservice-02.jpg'] },
      { title: 'Installations', description: 'Sample card: your own services replace these, each with your own photo.', photo: ['fieldservice', 'fieldservice-03.jpg'] },
      { title: 'Maintenance', description: 'Sample card: what you do and when people call.', photo: ['fieldservice', 'fieldservice-01.jpg'] },
    ],
    gallery: [
      { photo: ['fieldservice', 'fieldservice-02.jpg'], alt: 'A plumber fitting a pipe', caption: 'Sample project — plumbing' },
      { photo: ['fieldservice', 'fieldservice-03.jpg'], alt: 'Two techs working on pipework', caption: 'Sample project — installation' },
      { photo: ['fieldservice', 'fieldservice-04.jpg'], alt: 'Fittings and a wrench on a plan', caption: 'Sample project — fittings' },
    ],
    galleryHeading: 'Recent jobs (sample)',
    about: ['Sample about block: who you are and how you work.', 'Your real site writes it from what you tell us — nothing here is about your business.'],
    faq: [
      { question: 'Sample question: how do I book a visit?', answer: 'Sample answer. Your real site says how people reach you.' },
      { question: 'Sample question: do you work evenings?', answer: 'Sample answer. Your hours are yours to state.' },
      { question: 'Sample question: what areas do you cover?', answer: 'Sample answer. Your real site lists the towns you serve.' },
    ],
  },
  landscaping: {
    services: [
      { title: 'Lawn care', description: 'Sample card: a service with a photo and a short plain description.', photo: ['landscaping', 'landscaping-01.jpg'] },
      { title: 'Trimming & pruning', description: 'Sample card: your own services replace these, each with your own photo.', photo: ['landscaping', 'landscaping-02.jpg'] },
      { title: 'Garden design', description: 'Sample card: what you build and how a project starts.', photo: ['landscaping', 'landscaping-03.jpg'] },
    ],
    gallery: [
      { photo: ['landscaping', 'landscaping-01.jpg'], alt: 'A mown lawn behind a house', caption: 'Sample project — lawn' },
      { photo: ['landscaping', 'landscaping-02.jpg'], alt: 'Trimming a hedge', caption: 'Sample project — hedge' },
      { photo: ['landscaping', 'landscaping-03.jpg'], alt: 'A landscaped garden around a house', caption: 'Sample project — garden' },
    ],
    galleryHeading: 'Recent yards (sample)',
    about: ['Sample about block: who you are and how you work.', 'Your real site writes it from what you tell us — nothing here is about your business.'],
    faq: [
      { question: 'Sample question: how do I get a quote?', answer: 'Sample answer. Your real site says how people reach you.' },
      { question: 'Sample question: do you do one-time jobs?', answer: 'Sample answer. What you offer is yours to state.' },
    ],
  },
  salon: {
    services: [
      { title: 'Cut & style', description: 'Sample card: a service with a photo and a short plain description.', photo: ['salon', 'salon-01.jpg'] },
      { title: 'Colour & finish', description: 'Sample card: your own services and your own photos replace these.', photo: ['salon', 'salon-02.jpg'] },
    ],
    about: ['Sample about block: who is behind the chair, what you’re known for and how people book.', 'Your real site writes it from what you tell us — nothing here is about your business.'],
    faq: [
      { question: 'Sample question: how do I book?', answer: 'Sample answer. Your real site says how people book with you.' },
      { question: 'Sample question: how often should I come in?', answer: 'Sample answer. Your advice is yours to give.' },
      { question: 'Sample question: what if I need to cancel?', answer: 'Sample answer. Your policy is yours to state.' },
    ],
    pricing: [
      { service: 'Cut & style', priceLabel: 'Sample price', includes: ['Sample: what the price includes'] },
      { service: 'Colour', priceLabel: 'Sample price', includes: ['Sample: what the price includes'] },
      { service: 'Finish', priceLabel: 'Sample price', includes: ['Sample: what the price includes'] },
    ],
  },
  restaurant: {
    services: [
      { title: 'Private dining', description: 'Sample card: a service with a photo and a short plain description.', photo: ['restaurant', 'restaurant-01.jpg'] },
      { title: 'Celebrations', description: 'Sample card: weddings, birthdays and dinners, in your words.', photo: ['events', 'events-01.jpg'] },
      { title: 'Tasting menus', description: 'Sample card: your own services and photos replace these.', photo: '1414235077428-338989a2e8c0' },
    ],
    gallery: [
      { photo: ['events', 'events-01.jpg'], alt: 'A table set with flowers and glasses', caption: 'Sample event — table setting' },
      { photo: ['restaurant', 'restaurant-01.jpg'], alt: 'A long dining table in a restaurant', caption: 'Sample event — the room' },
      { photo: '1467003909585-2f8a72700288', alt: 'A plated fish dish', caption: 'Sample event — the plate' },
      { photo: ['restaurant', 'restaurant-02.jpg'], alt: 'A wine glass at the bar', caption: 'Sample event — the bar' },
      { photo: ['events', 'events-02.jpg'], alt: 'Dried flowers and glassware on a table', caption: 'Sample event — florals' },
      { photo: '1551024506-0bccd828d307', alt: 'A dessert with caramel', caption: 'Sample event — dessert' },
    ],
    galleryHeading: 'Past events (sample)',
    about: ['Sample about block: the people, the room and what a private event with you is like.', 'Your real site writes it from what you tell us — nothing here is about your business.'],
    faq: [
      { question: 'Sample question: how do I book an event?', answer: 'Sample answer. Your real site says how people reach you.' },
      { question: 'Sample question: how many guests can you seat?', answer: 'Sample answer. Capacity is yours to state.' },
      { question: 'Sample question: is a deposit needed?', answer: 'Sample answer. Your terms are yours to state.' },
    ],
  },
  basic: {
    services: [
      { title: 'Service one', description: 'Sample card: a service with a photo and a short plain description.', photo: ['generic', 'generic-01.jpg'] },
      { title: 'Service two', description: 'Sample card: your own services and your own photos replace these.', photo: ['generic', 'generic-02.jpg'] },
      { title: 'Service three', description: 'Sample card: say what you do, in your words.' },
    ],
    about: ['Sample about block: who you are, what you do and what customers can expect.', 'Your real site writes it from what you tell us — nothing here is about your business.'],
    faq: [
      { question: 'Sample question: how do I get in touch?', answer: 'Sample answer. Your real site says how people reach you.' },
      { question: 'Sample question: where are you based?', answer: 'Sample answer. Your real site states your own address and areas.' },
      { question: 'Sample question: what do you charge?', answer: 'Sample answer. Your prices are yours to state.' },
    ],
  },
}

/** A trade the unified app names the same as a sample set (bar and a food truck take the restaurant's). */
const SET_OF: Record<string, string> = { bar: 'restaurant', rv: 'basic', vet: 'basic', store: 'store' }

const STORE_PRODUCTS: Array<{ slug: string; name: string; id: string; cents: number; was?: number; featured?: boolean }> = [
  { slug: 'mug', name: 'Stoneware mug', id: '1514228742587-6b1558fcca3d', cents: 2400, featured: true },
  { slug: 'watch', name: 'Field watch', id: '1523275335684-37898b6baf30', cents: 12800, was: 14500, featured: true },
  { slug: 'tee', name: 'Cotton tee', id: '1523381210434-271e8be1f52b', cents: 3200 },
  { slug: 'tote', name: 'Canvas tote', id: '1544816155-12df9643f363', cents: 3800 },
  { slug: 'pack', name: 'Daypack', id: '1553062407-98eeb64c6a62', cents: 8900 },
  { slug: 'shoe', name: 'Suede brogue', id: '1560343090-f0409e92791a', cents: 14900 },
  { slug: 'chair', name: 'Oak chair', id: '1598300042247-d088f8ab3a91', cents: 21900, was: 24900 },
  { slug: 'phones', name: 'Studio headphones', id: '1484704849700-f032a568e944', cents: 9900 },
]

const storeProducts = () => STORE_PRODUCTS.map((p) => ({
  slug: p.slug, name: p.name, tagline: 'Sample product — not for sale', featured: !!p.featured,
  images: [{ url: un(p.id), alt: p.name, isPrimary: true, position: 0 }],
  variants: [{ sku: 'SAMPLE-' + p.slug.toUpperCase(), name: 'Default', priceCents: p.cents, compareAtPriceCents: p.was ?? null, inventoryQty: 10 }],
}))

export interface PreviewSamples {
  /** The home page's sections with the samples in. */
  sections: any[]
  /** Every image URL a sample uses (for the credits the self-hosted stock requires). */
  imageUrls: string[]
}

/**
 * The preview's home sections with the samples in. The real hero and call to action stay as the composer made them; a
 * "What we do" holding only the stand-in card is replaced by the sample services (a real service list is never
 * replaced); the gallery, a review, an about block and an FAQ go in before the call to action.
 */
export function withPreviewSamples(real: any[], vertical: string, factoryBase = (process.env.TWOMIAH_FACTORY_URL || process.env.FACTORY_PUBLIC_URL || '').replace(/\/$/, '')): PreviewSamples {
  const lib = libraryImg(factoryBase)
  const urls: string[] = []
  const pic = (p: [string, string] | string | undefined): string | null => {
    if (!p) return null
    const u = typeof p === 'string' ? un(p) : lib(p[0], p[1])
    if (u) urls.push(u)
    return u
  }

  const set = SET_OF[vertical] ?? vertical
  if (set === 'store') {
    const out = real.map((s) => (s?.type === 'shop'
      ? mark({ type: 'shop', variant: s.variant || 'grid', data: { ...(s.data || {}), heading: 'Shop (sample products)', intro: 'Sample products — your real shop sells your own, with your own photos and prices.', products: storeProducts() } })
      : s))
    storeProducts().forEach((p) => urls.push(p.images[0].url))
    return { sections: out, imageUrls: urls }
  }

  const t = SAMPLES[set] ?? SAMPLES.basic
  const services = t.services.map((s) => { const image = pic(s.photo); return { title: s.title, description: s.description, ...(image ? { image } : {}) } })
  const servicesSection = mark({ type: 'services', variant: 'cards-grid', data: { heading: 'What we do (sample services)', intro: 'Sample services — yours appear here with your own photos.', items: services } })

  const gallery = (t.gallery ?? []).map((g) => ({ url: pic(g.photo), alt: g.alt, caption: g.caption })).filter((g) => g.url)
  const extras: Section[] = []
  if (gallery.length >= 3) extras.push(mark({ type: 'gallery', variant: 'grid', data: { heading: t.galleryHeading || 'Recent work (sample)', intro: 'Sample photos — your real site shows your own work.', photos: gallery } }))
  extras.push(mark({ type: 'about', variant: 'story', data: { eyebrow: 'Sample · About us', title: 'About us (sample)', paragraphs: t.about } }))
  extras.push(mark({ type: 'testimonials', variant: 'quotes', data: { heading: 'What customers say (sample reviews)', items: REVIEWS } }))
  if (t.pricing) extras.push(mark({ type: 'pricing', variant: 'flat-rate-menu', data: { heading: 'Price list (sample)', intro: 'Sample prices — your real site shows the prices you set.', items: t.pricing, disclaimer: 'Sample only: these are not prices.' } }))
  extras.push(mark({ type: 'faq', variant: 'accordion', data: { heading: 'Questions (sample)', items: t.faq } }))

  const standIn = (s: any) => s?.type === 'services' && Array.isArray(s.data?.items) && s.data.items.length > 0 && s.data.items.every((i: any) => i?.standIn)
  let placed = false
  const out: any[] = []
  for (const s of real) {
    if (!placed && s?.type === 'cta') { out.push(...extras); placed = true }
    out.push(standIn(s) ? servicesSection : s)
  }
  if (!placed) out.push(...extras)
  return { sections: out, imageUrls: urls }
}

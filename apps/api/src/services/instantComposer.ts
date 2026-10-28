/**
 * The site's TEMPLATE composer: a whole per-trade site from the owner's own facts — no model call, deterministic.
 *
 * composeSite() has Claude write the pages (minutes, real cost) and is what a signup's site is built from
 * (services/signupSite.ts). This is what the site is when that compose fails or runs out of time, and what the
 * twomiah.com instant preview shows: the same per-trade page plan (sectionComposer.ts pageRecipesFor — a roofer gets
 * storm, estimator and projects pages, a home-care agency find-care, caregivers and coverage), laid out the way the
 * standard templates laid that trade out (templates/website-<trade>/views: home, services with a page per service,
 * about, gallery, contact). It used to be one thin skeleton for every trade — hero, "What we do", About, Contact —
 * which the facts policy then cut to a home page with an empty menu (live signups, 2026-10-25).
 *
 * What fills it: the owner's name, trade and town, their services (each with its own page), description, contact
 * details and the optional facts (credentials, reviews, hours, prices in their words, photos) — and copy that makes no
 * claim about the business: how a first conversation goes, and FAQ answers that are general knowledge of the trade
 * stated as general ("many remodels need a permit; your building department can tell you"), never this business's
 * policy, price, timing or promise. Everything then goes through enforceIntakeFacts, the same gate the AI's output
 * passes (composerFacts.ts), so a page with nothing real on it is held and nothing the owner did not give is stated.
 *
 * Returns composeSite()'s SiteResult shape (pages as section arrays; toComposition() wraps them the way
 * tenants.preview_premium_pages keeps them), so the preview renderer, site-bootstrap and the unified build take either.
 */
import { enforceIntakeFacts, wantsBookings, ownerParagraphs as paragraphsOf } from './composerFacts'
import { SECTION_SCHEMA, pageRecipesFor, tradeKindFor, type ComposerInput, type Section, type TradeKind } from './sectionComposer'
import { getHeroLibrary } from '../config/heroLibrary'
import { websiteTradeFor } from '../config/websiteTrades'

type SiteResult = {
  pages: Record<string, Section[]>
  heldPages: string[]
  contentGaps: ReturnType<typeof enforceIntakeFacts>['contentGaps']
  removedClaims: string[]
  rationale?: string
  /** A page's title where its slug would not say it (a service's own page: "kitchen-remodels" → "Kitchen remodels"). */
  titles?: Record<string, string>
}

const requiredOf = (type: string, variant: string) =>
  (((SECTION_SCHEMA as any)[type]?.[variant]?.required) || []) as readonly string[]

const titleCase = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase())

/** "Roofing", "Heating & Cooling", "Dog Grooming" — how the site names the trade. */
export function tradeLabelFor(businessType: string): string {
  // "Other" (the signup's catch-all) or nothing: no trade to name — never "Other · Eau Claire".
  if (/^\s*(other|business|local business|general)?\s*$/i.test(businessType || '')) return ''
  return websiteTradeFor(businessType.toLowerCase().replace(/\s+/g, '_'))?.label || titleCase(businessType)
}


function firstSentence(text?: string): string {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  const m = t.match(/^[^.!?]{12,200}[.!?]/)
  return m ? m[0] : t.slice(0, 160)
}

// The library photo for the trade's hero. Where websiteTrades hand-picked shots (plumbing and HVAC:
// the library's first field-service photo is an electrician; salons and gyms had office stock), the
// premium site uses the same pick the standard site does.
function libraryHeroFor(businessType: string): string {
  const lib = getHeroLibrary(businessType)
  const pick = websiteTradeFor(businessType.toLowerCase().replace(/\s+/g, '_'))?.heroPhotos
  if (pick) {
    const want = (pick.files || []).map((f) => '/hero-library/' + pick.group + '/' + f)
    const hit = lib.find((x) => want.some((w) => x.url.endsWith(w))) || lib.find((x) => x.url.includes('/hero-library/' + pick.group + '/'))
    if (hit) return hit.url
  }
  return lib[0]?.url || ''
}

// ─── Claim-free copy ─────────────────────────────────────────────────────────
//
// Every line below is either the way a first conversation with ANY business of the trade goes, or general knowledge
// of the trade stated as general. None names a price, a time, a count, a credential, a guarantee or a policy of this
// business — enforceIntakeFacts would take out a number, but it cannot see an invented promise with no number in it,
// so these are written not to make one. (scripts/check-composer-facts.ts and tests/unified/factory/signup-site.test.ts
// hold them to it.)

type Step = { title: string; description: string }
type Faq = { question: string; answer: string }

const STEPS: Record<'generic' | 'fieldservice' | 'homecare' | 'salon' | 'vet', Step[]> = {
  generic: [
    { title: 'Tell us what you need', description: 'Call, email or send the form with a few details about the job.' },
    { title: 'We talk it through', description: 'We go over what you have in mind and answer your questions.' },
    { title: 'We get started', description: 'When you are ready to go ahead, we agree on the details and a time to start.' },
  ],
  fieldservice: [
    { title: 'Tell us what is going on', description: 'Describe the problem, where it is and when it started.' },
    { title: 'We set up a visit', description: 'We find a time that works for you.' },
    { title: 'We take care of it', description: 'We go over what we find and what it will take before the work begins.' },
  ],
  homecare: [
    { title: 'Tell us about your loved one', description: 'Call or send the form with a little about who needs care and what is hard right now.' },
    { title: 'Talk it through', description: 'We talk about daily routines, needs and what would help most.' },
    { title: 'Plan care together', description: 'Together we put together care that fits the person and the family.' },
  ],
  salon: [
    { title: 'Choose your service', description: 'Pick what you would like done, or tell us what you have in mind.' },
    { title: 'Find a time', description: 'Get in touch and we will find a time that suits you.' },
    { title: 'Come in', description: 'Bring any photos of looks you like and we will take it from there.' },
  ],
  vet: [
    { title: 'Get in touch', description: 'Call or send the form to ask for an appointment.' },
    { title: 'Tell us about your pet', description: 'Let us know what is going on and anything about their history.' },
    { title: 'Come in for a visit', description: 'We find a time for your pet to be seen.' },
  ],
}

const ASK: Faq = { question: 'What details help when I get in touch?', answer: 'A short description of what you need, where, and the best way to reach you. Photos help too.' }

const FAQS: Partial<Record<TradeKind, Faq[]>> & { generic: Faq[] } = {
  generic: [ASK],
  contractor: [
    { question: 'Do I need a permit for my project?', answer: 'Many projects do: structural changes, additions, and new electrical or plumbing work usually need one from your city or county. Your local building department can tell you what applies to your home.' },
    { question: 'What should I have ready before we talk?', answer: 'A rough idea of what you want, photos of the space, and any measurements or inspiration pictures you have. It all helps the first conversation go further.' },
    { question: 'Can I stay in my home during the work?', answer: 'Often, yes, depending on the project. Kitchens and bathrooms are the hardest rooms to live without, so it helps to plan for that ahead of time.' },
  ],
  roofing: [
    { question: 'How do I know if my roof needs attention?', answer: 'Common signs are missing, cracked or curling shingles, granules collecting in the gutters, water stains on ceilings and damp spots in the attic. An inspection is the surest way to know.' },
    { question: 'What should I do after a storm?', answer: 'Photograph any damage you can see safely from the ground, and contact your insurance company to start a claim. Have the roof inspected before agreeing to repairs.' },
    { question: 'Will insurance pay for my roof?', answer: 'Homeowner policies commonly cover sudden damage from storms, hail or wind, but not ordinary wear. Your policy and your adjuster decide what is covered.' },
  ],
  fieldservice: [
    ASK,
    { question: 'Is there anything I should do before help arrives?', answer: 'If water is leaking, turn off the supply valve if you can. If you smell gas or burning, leave the building and call your utility or emergency services first.' },
    { question: 'How can I avoid problems in the first place?', answer: 'Regular upkeep, like changing filters and keeping drains and vents clear, helps catch small problems before they become big ones.' },
  ],
  landscaping: [
    { question: 'When should I start planning yard work?', answer: 'Spring and fall are the busiest seasons for planting, seeding and cleanups, so it helps to get in touch before the season starts.' },
    { question: 'How short should I keep my lawn?', answer: 'Most lawns do best when only the top of the grass blade is trimmed at each mowing; cutting too short stresses the grass.' },
    ASK,
  ],
  homecare: [
    { question: 'What is non-medical home care?', answer: 'Help with everyday living at home, such as bathing, dressing, meals, light housekeeping, errands and companionship. It is different from skilled home health care, which a doctor orders.' },
    { question: 'How do we know when it is time for help at home?', answer: 'Common signs include missed meals or medications, trouble getting around the house, falls, and a home that is harder to keep up. A conversation about daily routines is a good place to start.' },
    { question: 'Does Medicare pay for in-home care?', answer: 'Medicare can cover part-time skilled home health care ordered by a doctor, but it generally does not pay for ongoing help with daily living. Medicaid, veterans benefits and long-term care insurance may help.' },
  ],
  salon: [
    { question: 'How should I prepare for my appointment?', answer: 'Bring photos of looks you like, and mention any recent color, treatments or sensitivities.' },
    ASK,
  ],
  vet: [
    { question: 'What should I bring to my pet\'s first visit?', answer: 'Any previous medical and vaccination records, a list of medications and food, and your pet on a leash or in a carrier.' },
    { question: 'What should I do in an emergency?', answer: 'Call right away. If your pet is having trouble breathing, has collapsed or may have eaten something toxic, go to the nearest emergency animal hospital.' },
  ],
  rv: [
    { question: 'What should I bring for a trade-in?', answer: 'The title or loan information, the keys, and any service records you have.' },
    { question: 'What details help when I ask about service?', answer: 'The make and model of the unit, and a short description of the problem.' },
  ],
  restaurant: [{ question: 'What details help with an event enquiry?', answer: 'The date, roughly how many guests, the occasion, and any dietary needs in your group.' }],
  events: [{ question: 'What details help with an event enquiry?', answer: 'The date, roughly how many guests, the occasion, and any dietary needs in your group.' }],
  foodtruck: [{ question: 'What details help with a catering enquiry?', answer: 'The date, where the event is, roughly how many guests, and any dietary needs in your group.' }],
}

/** The general ways families pay for in-home care — what each source is, never what this agency accepts. */
const COVERAGE = [
  { source: 'Medicare', eligibility: 'People who are homebound and under a doctor\'s plan of care.', whatItCovers: 'Part-time skilled home health care. It generally does not pay for ongoing help with daily living.', howToApply: 'Ask the doctor whether home health care is right, and check with Medicare.' },
  { source: 'Medicaid', eligibility: 'People who meet their state\'s income and care-need rules.', whatItCovers: 'Many state programs, including home and community-based waivers, help pay for personal care at home. What is covered varies by state.', howToApply: 'Contact your state Medicaid office or local Area Agency on Aging.' },
  { source: 'Veterans benefits', eligibility: 'Veterans and surviving spouses who qualify.', whatItCovers: 'Pension benefits such as Aid and Attendance can help pay for care at home.', howToApply: 'Contact the VA or a veterans service officer.' },
  { source: 'Long-term care insurance', eligibility: 'People with a long-term care policy.', whatItCovers: 'Many policies pay for in-home care once their benefit conditions are met.', howToApply: 'Call the insurer and ask how to start a claim.' },
  { source: 'Private pay', eligibility: 'Anyone.', whatItCovers: 'Care paid for directly, with the most flexibility in schedule and services.', howToApply: 'Get in touch to talk through what is needed.' },
]

/** What a storm-damage visitor should do first: general advice, nothing this business promises. */
const STORM_STEPS: Step[] = [
  { title: 'Stay safe', description: 'Stay off the roof and away from any downed lines.' },
  { title: 'Document the damage', description: 'Take photos of what you can see from the ground and inside, such as leaks and stains.' },
  { title: 'Call your insurer', description: 'Start a claim and keep the claim number handy.' },
  { title: 'Get an inspection', description: 'Have the roof looked at before agreeing to any repairs.' },
]

// ─── The pages ─────────────────────────────────────────────────────────────

/** A service page's address: its name as a slug, never one the site or this site's plan already uses. */
/** The booking button a trade's plan asks for (the reservation/cta labels in its recipes). */
function bookingCta(kind: TradeKind, free: boolean): { heading: string; buttonLabel: string } | null {
  switch (kind) {
    case 'contractor': return { heading: 'Ready to talk about your project?', buttonLabel: free ? 'Schedule a free estimate' : 'Schedule an estimate' }
    case 'fieldservice': return { heading: 'Book a service call', buttonLabel: 'Schedule a service call' }
    case 'landscaping': return { heading: 'Prefer to talk it through?', buttonLabel: 'Schedule an estimate visit' }
    case 'roofing': return { heading: 'Want eyes on it?', buttonLabel: free ? 'Schedule a free inspection' : 'Schedule an inspection' }
    case 'homecare': return { heading: 'Or book a call', buttonLabel: free ? 'Schedule a free consultation' : 'Schedule a consultation' }
    case 'vet': return { heading: 'Book an appointment', buttonLabel: 'Request a time' }
    case 'rv': return { heading: 'Come see us', buttonLabel: 'Schedule a walkthrough' }
    case 'salon': return { heading: 'Book your appointment', buttonLabel: 'Book an appointment' }
    default: return null
  }
}

export function composeInstant(input: ComposerInput): SiteResult {
  const name = input.businessName.trim()
  const type = input.businessType || ''
  const label = tradeLabelFor(type)
  const kind = tradeKindFor(type)
  const place = [input.city, input.state].filter(Boolean).join(', ')
  const services = (input.services || []).map((s) => String(s).trim()).filter(Boolean)
  // Their services, else one card for the trade (as the standard site does) — marked stand-in at the build
  // (unified/factory.ts markStandInServices), so the live site shows the business's own list there or nothing.
  const serviceNames = services.length ? services : label ? [websiteTradeFor(type.toLowerCase().replace(/\s+/g, '_'))?.service || label] : []
  const own = (input.customerPhotos || []).filter((p) => p?.url && p.tag !== 'misc' && !/\blogo\b/i.test(p.alt || ''))
  // The owner's picture for the top of the site (the signup's photo is tagged 'hero'), else their first photo, else the
  // trade's library photo. A hero photo may be of the team or the place, so it never stands in a gallery of "our work".
  const heroImage = own.find((p) => p.tag === 'hero')?.url || own[0]?.url || libraryHeroFor(type)
  const ownPhotos = own.filter((p) => p.tag !== 'hero').map((p) => p.url)
  const contactCta = { label: 'Get in touch', href: 'contact' }
  const f = input.facts || {}
  const booking = wantsBookings(input) ? bookingCta(kind, f.freeEstimates === true) : null
  const recipe = pageRecipesFor(type)
  const homeSeq = recipe.home?.required_sequence || ''

  const talkTo = (): Section => ({ type: 'cta', variant: 'banner', data: { heading: 'Talk to ' + name, ...(place ? { subtitle: 'Serving ' + place + '.' } : {}), primaryCta: contactCta } })
  const pageHero = (eyebrow: string, title: string, subtitle?: string): Section =>
    ({ type: 'hero', variant: 'centered-stats', data: { eyebrow, title, ...(subtitle ? { subtitle } : {}) } })

  // A bar's home is the live Tonight board — it replaces the hero — and its menu, taps, events and
  // hours come live from the bar's CRM, so these pages are framing only and state no fact. Without
  // this branch a bar got the hero + "What we do" home and none of these pages (Test Bar Run 1).
  if (/\btonight\/board\b/.test(homeSeq)) {
    const toVisit = (): Section => ({ type: 'cta', variant: 'banner', data: { heading: 'Visit ' + name, subtitle: place ? 'Serving ' + place + '.' : '', primaryCta: { label: 'Find us', href: 'visit' } } })
    const pages: Record<string, Section[]> = {
      home: [
        { type: 'tonight', variant: 'board', data: { title: name } },
        ...(input.description ? [{ type: 'about', variant: 'story', data: { title: 'About ' + name, paragraphs: paragraphsOf(input.description) } }] : []),
        ...(ownPhotos.length >= 3 ? [{ type: 'gallery', variant: 'grid', data: { photos: ownPhotos.slice(0, 9).map((url) => ({ url })) } }] : []),
        toVisit(),
      ],
      menu: [{ type: 'menu', variant: 'sections', data: { asHeading: true } }, toVisit()],
      taps: [{ type: 'taps', variant: 'wall', data: { asHeading: true } }, toVisit()],
      events: [{ type: 'events', variant: 'list', data: { asHeading: true } }, toVisit()],
      // The partial's own default heading ("Book the back booths") names a room this bar may not have.
      parties: [{ type: 'parties', variant: 'inquiry-form', data: { heading: 'Private parties', asHeading: true } }],
      visit: [
        { type: 'visit', variant: 'details', data: { heading: 'Find us', asHeading: true } },
        { type: 'hours', variant: 'table', data: {} },
        { type: 'cta', variant: 'banner', data: { heading: 'Talk to ' + name, primaryCta: contactCta } },
      ],
      about: input.description
        ? [{ type: 'about', variant: 'story', data: { title: 'About ' + name, paragraphs: paragraphsOf(input.description), ...(input.ownerName ? { signature: input.ownerName } : {}) } }, talkTo()]
        : [pageHero('About', 'About ' + name)],
      contact: [{ type: 'contact', variant: 'form-info', data: contactData() }],
    }
    for (const slug of Object.keys(pages)) if (slug !== 'home' && slug !== 'contact' && !(slug in recipe)) delete pages[slug]
    return finish(pages, {})
  }

  function contactData(): Record<string, unknown> {
    return { heading: 'Get in touch', ...(input.phone ? { phone: input.phone } : {}), ...(input.email ? { email: input.email } : {}), ...(place ? { address: place } : {}) }
  }

  // ── The pieces every plan is built from ──
  // The plan's pages, plus a services page where the trade's standard site had one and its plan has none
  // (website-landscaping's services index; website-homecare's and the roofing site's service pages).
  const planSlugs = Object.keys(recipe)
  const servicesHome = ['services', 'service', 'classes', 'rooms'].find((s) => planSlugs.includes(s))
    || ((kind === 'landscaping' || kind === 'homecare' || kind === 'roofing') ? 'services' : undefined)
  // Each service the owner named gets its own page — /services/<slug> — built by the site itself from the card
  // (apps/unified site/servicePages.ts), so the composer writes no page per service and no link to one.
  const titles: Record<string, string> = {}
  // "What we do": the owner's services, or the one stand-in card for the trade, which the build marks standIn so the
  // live site shows the business's own list there (price book, a salon's service menu, a venue's spaces and packages)
  // or nothing — never the trade as a service (apps/unified/server/site/menu.ts; site-menu-1022.test.ts). The card is
  // a title only, and only the Services page's cards link to each service's own page.
  const serviceCards = (heading: string): Section | null => serviceNames.length
    ? { type: 'services', variant: 'cards-grid', data: { heading, items: serviceNames.map((title) => ({ title })) } }
    : null
  // What the owner said they do, in their own words: a page that implies an offering (storm-damage help, catering) is
  // written only when these words name it — otherwise it would be a promise the owner never made.
  const ownWords = [input.description || '', ...services].join(' ').toLowerCase()
  // `kind: 'steps'` marks a list of steps, which is not the business's services (no page per step: servicePages.ts).
  const steps = (which: keyof typeof STEPS, heading = 'How it works'): Section => ({ type: 'services', variant: 'cards-grid', data: { heading, kind: 'steps', items: STEPS[which] } })
  const stepKind: keyof typeof STEPS = kind === 'fieldservice' ? 'fieldservice' : kind === 'homecare' ? 'homecare' : kind === 'salon' ? 'salon' : kind === 'vet' ? 'vet' : 'generic'
  const faqItems = (FAQS[kind] || FAQS.generic)
  const faq = (heading = 'Common questions', items: Faq[] = faqItems): Section => ({ type: 'faq', variant: 'accordion', data: { heading, items } })
  const trust = (): Section | null => f.credentials?.length ? { type: 'trust', variant: 'badges', data: { heading: 'Credentials', items: f.credentials.map((n) => ({ name: n })) } } : null
  const reviews = (): Section | null => f.testimonials?.length
    ? { type: 'testimonials', variant: 'quotes', data: { heading: 'What customers say', items: f.testimonials.map((t) => ({ quote: t.quote, author: t.author || '' })) } }
    : null
  const gallery = (min: number, heading = 'Our work'): Section | null => ownPhotos.length >= min
    ? { type: 'gallery', variant: 'grid', data: { heading, photos: ownPhotos.slice(0, 24).map((url) => ({ url })) } }
    : null
  const founded = (): Section | null => f.yearFounded
    ? { type: 'stats', variant: 'bar', data: { items: [{ value: String(f.yearFounded), label: 'Founded' }] } }
    : null
  const bookingSection = (): Section | null => booking ? { type: 'reservation', variant: 'cta', data: booking } : null
  // The owner's prices, in their own words — the one pricing fact a signup or intake gives.
  const priceFaq = (): Section | null => f.pricing ? faq('Pricing', [{ question: 'How is pricing set?', answer: f.pricing }]) : null
  // The About story is the owner's own: their description. With none (the signup asks for none), there is no story —
  // a "Welcome to …" written for them is a hollow page, and the About page starts held until they tell it
  // (site-menu-1022.test.ts: "About starts hidden"). Their credentials join a story they told, where the plan has no badges.
  const story = (): Section | null => input.description
    ? { type: 'about', variant: 'story', data: {
        title: 'About ' + name,
        paragraphs: [
          ...paragraphsOf(input.description),
          ...(f.credentials?.length && !recipe.about?.allowed_types.includes('trust') ? ['Credentials: ' + f.credentials.join('; ') + '.'] : []),
        ],
        ...(input.ownerName ? { signature: input.ownerName } : {}),
      } }
    : null

  // ── Each page of the plan ──
  const home = (): Array<Section | null> => [
    // A photo hero when there's a photo; with none, the centered hero (no empty image box).
    { type: 'hero', variant: heroImage ? 'full-bleed' : 'centered-stats', data: {
      ...(heroImage ? { image: heroImage } : {}), eyebrow: [label, place].filter(Boolean).join(' · '), title: name,
      subtitle: firstSentence(input.description) || (place ? (label ? label + ' in ' + place : 'Serving ' + place) + '.' : ''),
      // A store's front door sends shoppers to its products; everyone else's to a conversation.
      primaryCta: kind === 'store' ? { label: 'Shop now', href: 'shop' } : contactCta,
    } },
    kind === 'homecare' ? { type: 'care', variant: 'finder', data: careFinder() } : null,
    // A store's home is its products, live from its catalogue (the site fills shop/grid; store live test, 2026-10-26).
    kind === 'store' ? { type: 'shop', variant: 'grid', data: {} } : null,
    bookingSection(),
    kind === 'store' ? null : serviceCards('What we do'),
    trust(),
    founded(),
    reviews(),
    gallery(3),
    // The business's own latest posts, once it has any (the site fills them in; with none the section shows nothing).
    kind === 'store' ? null : { type: 'blog_preview', variant: 'latest', data: { heading: 'From the blog' } },
    talkTo(),
  ]
  function careFinder(): Record<string, unknown> {
    // The kinds of care the owner named, when they named any; else the partial's own neutral choices.
    return { heading: 'Find the right care', ...(services.length ? { careTypes: [...services.slice(0, 6), 'Not sure yet'] } : {}) }
  }
  // The Services page lists what the business does. Until it has something to list (the owner's services, or on the
  // live site the business's own list in place of the stand-in), it has nothing of its own and stays out of the menu —
  // "how it works" and a general FAQ do not make a page of services (the live tests' "Services" link to nothing).
  const servicesPage = (eyebrow = 'Services'): Array<Section | null> => [
    pageHero(eyebrow, label ? (place ? label + ' in ' + place : label) : 'What we do'),
    serviceCards('What we do'),
    services.length ? steps(stepKind) : null,
    // A home-care site answers its questions on its coverage page.
    services.length && kind !== 'homecare' ? faq() : null,
    bookingSection(),
    talkTo(),
  ]
  const aboutPage = (): Array<Section | null> => [story() || pageHero('About', 'About ' + name), founded(), trust(), reviews(), gallery(1, 'Our work'), talkTo()]
  const contactPage = (): Array<Section | null> => [
    pageHero('Contact', 'Get in touch with ' + name),
    { type: 'contact', variant: 'form-info', data: contactData() },
    bookingSection(),
  ]
  const enquiryPage = (eyebrow: string, heading: string): Array<Section | null> => [
    pageHero(eyebrow, heading),
    { type: 'catering', variant: 'inquiry-form', data: { heading } },
    faq(),
    gallery(1, 'Past events'),
    talkTo(),
  ]
  // A page whose substance is facts the signup does not carry (units, a menu, prices, a team): framing only, so the
  // facts check holds it — seeded unpublished for the owner to fill in, as the AI's own version of it would be.
  const framed = (eyebrow: string, title: string, ...body: Array<Section | null>): Array<Section | null> => [pageHero(eyebrow, title), ...body, talkTo()]

  const builders: Record<string, () => Array<Section | null>> = {
    home,
    about: aboutPage,
    contact: contactPage,
    services: () => servicesPage(),
    service: () => servicesPage('Service'),
    classes: () => servicesPage('Classes'),
    rooms: () => servicesPage('Rooms'),
    projects: () => framed('Projects', 'Our work', gallery(1, 'Our work'), reviews()),
    gallery: () => framed('Gallery', 'Our work', gallery(1, 'Our work'), reviews()),
    storm: () => /\b(storm|hail|wind|insurance|claims?|restoration)\b/.test(ownWords)
      ? [pageHero('Storm damage', 'Storm damage?', 'What to do first after a storm.'), { type: 'services', variant: 'cards-grid', data: { heading: 'After a storm', items: STORM_STEPS } }, { ...faq(), data: { heading: 'Storm questions', items: FAQS.roofing!.slice(1) } }, bookingSection(), talkTo()]
      : framed('Storm damage', 'Storm damage?'),
    quote: () => framed('Estimator', 'Get a ballpark'),
    emergency: () => framed('Emergency', 'Emergency service'),
    pricing: () => framed('Pricing', 'Pricing', priceFaq()),
    packages: () => framed('Packages', 'Packages', services.length ? { type: 'packages', variant: 'seasonal', data: { heading: 'Packages', items: services.map((title) => ({ title })) } } : null),
    'find-care': () => [pageHero('Find care', 'Find the right care'), { type: 'care', variant: 'finder', data: careFinder() }, bookingSection(), talkTo()],
    caregivers: () => framed('Our caregivers', 'Our caregivers'),
    coverage: () => [pageHero('Coverage + payment', 'Paying for care at home'), { type: 'coverage', variant: 'insurance-guide', data: { heading: 'How families pay for in-home care', items: COVERAGE } }, faq(), talkTo()],
    'private-dining': () => enquiryPage('Private events', 'Plan a private event'),
    // A restaurant here is the private-events business (the product's scope); a food truck caters only if it says so.
    catering: () => /\b(cater\w*|events?|private|parties|party|weddings?)\b/.test(ownWords) ? enquiryPage('Catering', 'Book us for your event') : framed('Catering', 'Catering'),
    venue: () => framed('The venue', 'The venue', gallery(1, 'The space'), serviceCards('What we host')),
    visit: () => [pageHero('Visit', 'Visit ' + name), { type: 'contact', variant: 'form-info', data: contactData() }, talkTo()],
    menu: () => framed('Menu', 'Menu'),
    reservations: () => framed('Reserve', 'Reserve a table'),
    stylists: () => framed('Our team', 'Our team'),
    trainers: () => framed('Our team', 'Our team'),
    team: () => framed('Meet the team', 'Meet the team'),
    inventory: () => framed('Inventory', 'Inventory'),
  }

  const pages: Record<string, Section[]> = {}
  // Home always keeps its "What we do", whatever the plan lists: on the live site it is where the business's own
  // services, service menu or event spaces appear (a restaurant's plan has no services section; its spaces go there).
  // A store's are its products (shop/grid), so its home has no "What we do".
  const allowedOn = (slug: string) => new Set<string>([...(recipe[slug]?.allowed_types || ['hero', 'services', 'faq', 'reservation', 'cta']), ...(slug === 'home' && kind !== 'store' ? ['services'] : [])])
  const build = (slug: string, sections: Array<Section | null>) => {
    const allowed = allowedOn(slug)
    // Only the section types this page's plan allows — the same catalogue the AI composes the page from.
    pages[slug] = sections.filter((s): s is Section => !!s && allowed.has(s.type))
  }
  // The plan's pages in its order; an added services page goes straight after home, where the standard sites had it.
  const order = servicesHome && !planSlugs.includes(servicesHome)
    ? [planSlugs[0], servicesHome, ...planSlugs.slice(1)]
    : planSlugs
  for (const slug of order) build(slug, (builders[slug] || (() => framed(titleCase(slug), titleCase(slug))))())
  // Sections a trade's site opens with: the age gate (dispensary), the urgent-care or emergency call
  // bar (vet, field service). The facts gate drops a bar the owner gave no facts for.
  if (/\bage\/modal\b/.test(homeSeq)) pages.home.unshift({ type: 'age', variant: 'modal', data: { gateAge: 21 } })
  if (/\burgent\/bar\b/.test(homeSeq) && input.phone) pages.home.unshift({ type: 'urgent', variant: 'bar', data: { heading: 'Sick or injured pet?', phone: input.phone || '' } })
  if (/\bemergency\/bar\b/.test(homeSeq) && input.phone) {
    pages.home.unshift({ type: 'emergency', variant: 'bar', data: { phone: input.phone || '' } })
    if (pages.emergency) pages.emergency.splice(1, 0, { type: 'emergency', variant: 'bar', data: { phone: input.phone || '' } })
  }
  return finish(pages, titles)

  function finish(p: Record<string, Section[]>, t: Record<string, string>): SiteResult {
    const allowedTypes = new Set(Object.values(recipe).flatMap((r) => [...r.allowed_types]))
    const enforced = enforceIntakeFacts(p, input, { requiredOf, allowedTypes })
    return {
      pages: enforced.pages,
      heldPages: enforced.heldPages,
      contentGaps: enforced.contentGaps,
      removedClaims: enforced.removedClaims.slice(0, 60),
      rationale: 'Template composition from the owner\'s facts and the trade\'s page plan (no model call).',
      ...(Object.keys(t).length ? { titles: t } : {}),
    }
  }
}

const stem = (w: string) => w.replace(/(?:ing|es|s)$/, '')
const wordsOf = (s: string) => new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3).map(stem))

/**
 * The AI's site held to the same two rules the template composer keeps (site-menu-1022.test.ts, the live tests of
 * 2026-10-22), before it is stored as the signup's site:
 *   · "What we do" (home's, and the Services page's) lists what the owner gave: a card the AI wrote for a service the
 *     owner never named is taken out, and a list left empty becomes the one stand-in card for the trade — which the
 *     build marks standIn, so the live site shows the business's own services there, or nothing.
 *   · The About story is the owner's own: with no description from them, a story the AI wrote is taken out, and the
 *     page is held until they tell it.
 * Then the facts gate runs again, so a page left with nothing is held and links to it go (composerFacts.ts).
 */
export function heldToOwnerFacts(site: { pages: Record<string, { sections: Section[] }>; [k: string]: any }, input: ComposerInput): { pages: Record<string, { sections: Section[] }>; heldPages: string[]; contentGaps: any[]; removedClaims: string[] } & Record<string, any> {
  const type = input.businessType || ''
  const label = tradeLabelFor(type)
  const standIn = label ? websiteTradeFor(type.toLowerCase().replace(/\s+/g, '_'))?.service || label : ''
  const owned = (input.services || []).map(wordsOf)
  const isOwners = (title: unknown) => { const w = wordsOf(String(title || '')); return owned.some((o) => [...o].some((x) => w.has(x))) }
  const removed: string[] = []
  const pages: Record<string, Section[]> = {}
  for (const [slug, page] of Object.entries(site.pages || {})) {
    const out: Section[] = []
    for (const s of page?.sections || []) {
      if (s?.type === 'about' && s.variant === 'story' && !input.description) { removed.push(slug + ': about/story with no story from the owner'); continue }
      if (s?.type === 'services' && (slug === 'home' || slug === 'services' || slug === 'service') && Array.isArray(s.data?.items)) {
        const items = s.data.items.filter((i: any) => isOwners(i?.title))
        if (items.length < s.data.items.length) removed.push(slug + ': ' + (s.data.items.length - items.length) + ' service card(s) the owner did not name')
        if (items.length) out.push({ ...s, data: { ...s.data, items } })
        else if (standIn && !out.some((x) => x.type === 'services')) out.push({ type: 'services', variant: 'cards-grid', data: { heading: s.data.heading || 'What we do', items: [{ title: standIn }] } })
        continue
      }
      out.push(s)
    }
    pages[slug] = out
  }
  const recipe = pageRecipesFor(type)
  const enforced = enforceIntakeFacts(pages, input, { requiredOf, allowedTypes: new Set(Object.values(recipe).flatMap((r) => [...r.allowed_types])) })
  return {
    ...site,
    pages: Object.fromEntries(Object.entries(enforced.pages).map(([slug, sections]) => [slug, { ...(site.pages[slug] || {}), sections }])),
    heldPages: enforced.heldPages,
    contentGaps: enforced.contentGaps,
    removedClaims: [...removed, ...(site.removedClaims || []), ...enforced.removedClaims].slice(0, 60),
  }
}

/** A SiteResult as tenants.preview_premium_pages keeps it: { pages: { slug: { sections, title? } }, heldPages, contentGaps }. */
export function toComposition(site: SiteResult): { pages: Record<string, { sections: Section[]; title?: string }>; heldPages: string[]; contentGaps: any[] } {
  return {
    pages: Object.fromEntries(Object.entries(site.pages).map(([slug, sections]) => [slug, { sections, ...(site.titles?.[slug] ? { title: site.titles[slug] } : {}) }])),
    heldPages: site.heldPages,
    contentGaps: site.contentGaps as any[],
  }
}

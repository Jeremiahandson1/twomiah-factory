/**
 * Section composer — the AI half of the premium-website pitch.
 *
 * Takes an intake (the structured brief from /public/intake), asks Claude to
 * propose a homepage as a sections[] array, validates the output against
 * the section schema the template actually supports, and returns the
 * sanitized result for the renderer.
 *
 * Distinct from contentGenerator (which fills text into fixed template slots).
 * This composer decides STRUCTURE — which sections, in what order, with
 * what variants — which is what makes a premium site look different per build
 * instead of just better-worded.
 */
import path from 'path'
import { getHeroLibrary } from '../config/heroLibrary.ts'

export interface ComposerInput {
  businessName: string
  businessType: string
  city?: string
  state?: string
  description?: string
  services?: string[]
  goals?: string[]
  competitors?: string[]
  ownerName?: string
  phone?: string
  email?: string
  nearbyCities?: string[]
  primaryColor?: string
  /**
   * Customer-supplied photos from the intake form, ranked by relevance
   * if known. Composer prefers these over stock URLs when present.
   * Tag is a free-form hint (e.g. 'hero', 'team', 'projects') if the
   * intake collected it; otherwise undefined and the composer chooses.
   */
  customerPhotos?: Array<{ url: string; tag?: string; alt?: string }>

  /**
   * Licensed stock photos (Unsplash+ etc.) fetched relevant to this
   * business. Composer treats these as second-tier: customerPhotos
   * first, then stockPhotos, then fall back to the prompt's hardcoded
   * Unsplash placeholder URLs. Tag mirrors customerPhotos so the
   * composer can match slot to context.
   */
  stockPhotos?: Array<{ url: string; tag?: string; alt?: string }>

  /**
   * Customer feedback on a prior preview. When present, the composer
   * gets the feedback verbatim and is instructed to act on it: change
   * specific section copy, swap variants, drop sections, etc. The
   * recompose path calls composeSite with feedbackHistory populated
   * from intake_feedback rows in chronological order.
   */
  feedbackHistory?: string[]
}

export interface Section {
  type: string
  variant: string
  data: Record<string, any>
}

export interface ComposerResult {
  sections: Section[]
  rationale?: string
}

/**
 * Schema of what sections + variants the template can render. Keep this
 * in sync with the partials under
 * templates/website-premium-contractor/views/sections/*.
 *
 * The composer is hard-gated to these. Anything Claude proposes that
 * isn't here gets dropped before the render — the template won't crash
 * on a missing variant, but we'd rather not even attempt one.
 */
export const SECTION_SCHEMA = {
  hero: {
    'full-bleed': {
      required: ['image', 'title'],
      optional: ['eyebrow', 'subtitle', 'primaryCta', 'secondaryCta'],
      use_when: 'one strong hero photo earns the lead — recent project, founder portrait, characteristic environment',
    },
    split: {
      required: ['title', 'image'],
      optional: ['eyebrow', 'subtitle', 'primaryCta', 'secondaryCta', 'stats', 'flip'],
      use_when: 'message and photo carry equal weight; good as a second hero block for an about/process moment',
    },
    'centered-stats': {
      required: ['title'],
      optional: ['eyebrow', 'subtitle', 'primaryCta', 'stats'],
      use_when: 'lead with credibility metrics — years in business, projects shipped, ratings; no single photo dominant',
    },
  },
  services: {
    'cards-grid': {
      required: ['items'],
      optional: ['heading', 'intro'],
      use_when: 'many similar services worth equal weight; reads as a menu',
    },
    alternating: {
      required: ['items'],
      optional: ['heading', 'intro'],
      use_when: 'few services that each deserve their own moment with distinct photography',
    },
  },
  cta: {
    banner: {
      required: ['heading'],
      optional: ['subtitle', 'primaryCta'],
      use_when: 'section punctuation between content blocks; short and direct',
    },
    split: {
      required: ['heading', 'image'],
      optional: ['subtitle', 'bullets', 'primaryCta', 'phone'],
      use_when: 'closing argument; image + bullets + action; leaves prospect with a face or job site',
    },
  },
  about: {
    story: {
      required: ['title', 'portrait', 'paragraphs'],
      optional: ['eyebrow', 'signature', 'stats'],
      use_when: 'lead an about page — portrait + 2-4 narrative paragraphs in the founder/principal voice',
    },
  },
  team: {
    grid: {
      required: ['members'],
      optional: ['heading', 'intro'],
      use_when: 'show the actual people doing the work — 3-8 members with portraits, names, roles, optional one-line bios',
    },
  },
  contact: {
    'form-info': {
      required: [],
      optional: ['heading', 'intro', 'phone', 'email', 'address', 'hours', 'responsePromise'],
      use_when: 'main contact page body — form on one side, business details + hours + response promise on the other',
    },
  },
  gallery: {
    grid: {
      required: ['photos'],
      optional: ['heading', 'intro'],
      use_when: 'showcase 6-12 photos of recent work, projects, dishes, builds, or before/after — best for visual businesses with portfolio-quality shots',
    },
  },
  testimonials: {
    quotes: {
      required: ['items'],
      optional: ['heading', 'intro'],
      use_when: 'show 1-3 short customer testimonials. Only use when the intake actually provided quotes or named customers — never fabricate testimonials.',
    },
  },
  stats: {
    bar: {
      required: ['items'],
      optional: ['heading'],
      use_when: 'standalone credibility band between sections — 3-4 anchor metrics in a horizontal strip with brand-color background. Only use real numbers from the intake; never fabricate.',
    },
  },
  faq: {
    accordion: {
      required: ['items'],
      optional: ['heading', 'intro'],
      use_when: 'pre-empt the 5-8 most common buyer questions for this business — pricing, process, lead time, coverage area, what is included, what to expect, scheduling, payment, warranty/guarantee. Strong SEO win. PROACTIVELY GENERATE these questions from the business description even when the intake didn\'t explicitly ask for an FAQ — the questions and answers should be plausibly true given what the business said about itself.',
    },
  },
  // ─── Food truck-specific section types ─────────────────────────────────
  // Available to food_truck industry. Showcase / restaurant / cafe verticals
  // can use them too where appropriate (e.g. a restaurant with a true daily
  // menu benefits from menu/cards, a beach-pop-up cafe might use
  // location/live-map).
  menu: {
    cards: {
      required: ['items'],
      optional: ['heading', 'intro', 'dietary_legend'],
      use_when: 'food businesses with a real menu — food truck, restaurant, cafe, bakery. Each item has name, price, description, dietary tags (GF/V/DF/contains nut), optional image. Filter chips above the grid. Better than services/cards-grid for food because it surfaces price and dietary at-a-glance.',
    },
  },
  location: {
    'live-map': {
      required: ['heading'],
      optional: ['intro', 'currentAddress', 'currentUntil', 'recentLocations', 'mapCenter', 'mapZoom', 'smsOptIn'],
      use_when: 'food trucks and other mobile businesses — embeds a Mapbox map showing the truck right now. "Open until 8pm" status badge, last 3-5 recent stops as a small list under the map. Optional SMS opt-in ("Text me when you\'re within 5 miles") wired to the tenant\'s Twilio.',
    },
  },
  schedule: {
    'week-strip': {
      required: ['days'],
      optional: ['heading', 'intro'],
      use_when: 'food truck or pop-up business — horizontal scroll of the next 7 days with location + hours per day. Tagged "Market" / "Private Event" / "Catering" / "Closed" per day. Beats a buried calendar — gives a one-glance answer to "where will you be this week".',
    },
  },
  catering: {
    'inquiry-form': {
      required: ['heading'],
      optional: ['intro', 'minHeadcount', 'leadTimeWeeks', 'venueTypes', 'responsePromise'],
      use_when: 'food businesses with catering revenue — food truck, restaurant, cafe doing private events. Different from a generic contact form: collects event date, headcount, venue type (wedding/birthday/corporate/community), and special dietary needs. Highest-margin lead type for food trucks.',
    },
  },
  social: {
    feed: {
      required: ['handle'],
      optional: ['heading', 'intro', 'platform', 'limit'],
      use_when: 'businesses where social IS the marketing — food trucks (Instagram is lifeblood), salons (stylist work), gyms (transformations). Embeds the 6-9 most recent posts in a responsive grid with hover-to-see-caption.',
    },
  },
  // ─── Dispensary-specific section types ─────────────────────────────────
  age: {
    modal: {
      required: ['gateAge'],
      optional: ['heading', 'message', 'stateSelector', 'exitUrl'],
      use_when: 'cannabis dispensaries (legally required in most states), bars/breweries, vape shops, sometimes alcohol delivery. Full-screen modal on first visit, localStorage-persisted so it never appears again. Includes DOB or 21+/18+ confirmation, optional state selector for compliance routing.',
    },
  },
  strain: {
    grid: {
      required: ['items'],
      optional: ['heading', 'intro', 'filters'],
      use_when: 'cannabis dispensaries — filterable card grid of strains/products with THC%, CBD%, indica/sativa/hybrid type, terpene profile, effects (relaxed/focused/sleepy/euphoric), price per gram/eighth. Filter chips (NOT dropdowns) above the grid. Cards link to detail pages when present, otherwise just informational.',
    },
  },
  deals: {
    strip: {
      required: ['items'],
      optional: ['heading', 'intro', 'expiresLabel'],
      use_when: 'dispensaries / cafes / any business with daily/weekly specials. Horizontal scroll strip of current deals (e.g. "Wax Wednesday: 30% off concentrates", "Senior Sundays: 10% off everything"). Each card has the deal name, brief description, valid-through date.',
    },
  },
  // ─── Roofing-specific section types (some reusable across other trades) ──
  quote: {
    'instant-address': {
      required: ['heading'],
      optional: ['intro', 'pricePerSqFt', 'minSqFt', 'maxSqFt', 'mapCenter', 'mapZoom', 'callToAction', 'showFinancing'],
      use_when: 'roofers + landscapers + any home-services business that can give a ballpark estimate from address + size. Mapbox satellite map with address-search, customer enters approximate sq ft, JS calculates a range from pricePerSqFt config. Single biggest conversion lever in roofing — crushes "fill out a form and we\'ll call you".',
    },
  },
  banner: {
    'storm-alert': {
      required: ['heading'],
      optional: ['subtitle', 'cta', 'startDate', 'endDate', 'dismissable'],
      use_when: 'roofers, restoration contractors. Server-rendered geo+date awareness with a dismissable promo bar — "Storm passed through Eau Claire 2026-05-12. Free inspection if you suspect damage." Only renders when current date is between startDate/endDate. Strong post-event conversion.',
    },
  },
  before_after: {
    slider: {
      required: ['items'],
      optional: ['heading', 'intro', 'filters'],
      use_when: 'roofing, contractor, landscaping, salon, painting — any vertical where the visual transformation is the proof. Side-by-side image slider with drag-to-reveal handle. Filterable by material, city, year. Each item: { beforeImage, afterImage, caption, location, year, material }.',
    },
  },
  financing: {
    calculator: {
      required: ['heading'],
      optional: ['intro', 'fromMonthly', 'maxTermMonths', 'apr', 'minLoanAmount', 'maxLoanAmount', 'ctaLabel'],
      use_when: 'roofing / contractor / HVAC / landscaping — any vertical where the average ticket is $5k+. Shows "starting at $99/mo" with a slider that lets the customer adjust loan amount + term. Pure marketing widget — NOT a real lending API. Routes to a contact form with budget context pre-filled.',
    },
  },
  trust: {
    badges: {
      required: ['items'],
      optional: ['heading', 'intro'],
      use_when: 'roofing (GAF Master Elite, Owens Corning Preferred, CertainTeed SELECT), contractor (BBB A+, Houzz Pro, Angi badges), home care (state licensure, bonded/insured, BBB), any vertical where third-party credentials = currency. Grid of badge items: { name, image, url? }. NEVER fabricate credentials — only include badges the customer actually has.',
    },
  },
  // ─── Restaurant section types ──────────────────────────────────────────
  reservation: {
    widget: {
      required: ['heading'],
      optional: ['intro', 'partySizes', 'maxLeadDays', 'note', 'bookingPath', 'partyLabel', 'guestNoun', 'guestNounPlural', 'submitLabel', 'times', 'defaultTime'],
      use_when: 'sit-down restaurants, boutique hotels, salons that want a party-size + date + time picker that deep-links into Twomiah Bookings. Customer fills party-size/date/time on the home page, click → Bookings page with values pre-filled. Better than a generic "book a table" button — sets the right expectation that booking is the next step. DEFAULTS ARE RESTAURANT-FLAVORED ("Party", "guests", "Find a table", 5-8:30 PM dinner slots) — any non-restaurant use MUST override: submitLabel (e.g. "Book my appointment"), times as 24h "HH:MM" strings spanning the business\'s real hours, and partySizes/guestNoun where "guests" reads wrong.',
    },
    cta: {
      required: ['heading', 'buttonLabel'],
      optional: ['intro', 'bookingPath', 'note'],
      use_when: 'service businesses (contractor, HVAC/plumbing/electrical, landscaping, roofing, home care) where the conversion is "schedule an estimate" or "book service" — not a party-size dinner reservation. Renders as a headline + intro + single CTA button that deep-links to Twomiah Bookings, where the customer picks from real availability. Use this anywhere the customer needs to book an appointment with a person but the inline party/date picker doesn\'t fit. Labels: "Schedule a free estimate" (contractor/landscaping/roofing), "Book service" (HVAC/plumbing/cleaning), "Schedule a consultation" (home care).',
    },
  },
  // ─── Field service section types (HVAC / plumbing / electrical) ───────
  emergency: {
    bar: {
      required: ['phone'],
      optional: ['heading', 'subtext', 'businessHours', 'afterHoursLabel', 'normalHoursLabel'],
      use_when: 'HVAC, plumbing, electrical — anything where same-day emergency calls are the highest-margin work. Sticky mobile-bottom tap-to-call bar. Server-rendered after-hours state pulses red when current local time is outside businessHours, signaling "we will pick up at 2am even though no one else will." Single biggest mobile conversion lever in this vertical.',
    },
  },
  service_area: {
    'zip-check': {
      required: ['serviceZips'],
      optional: ['heading', 'intro', 'yesLabel', 'noLabel', 'yesHref', 'noEmail'],
      use_when: 'service businesses with a defined coverage area. Customer types ZIP, gets instant yes/no, on yes routes to booking/contact. Eliminates the "do you even come to my town" friction. Better than listing service-area cities in body text — instant answer.',
    },
  },
  pricing: {
    'flat-rate-menu': {
      required: ['items'],
      optional: ['heading', 'intro', 'disclaimer'],
      use_when: 'HVAC / plumbing / electrical / handyman. Transparent flat-rate pricing for common jobs (drain clear $X, water-heater install starting $Y, panel upgrade $Z, ductless mini-split $W). Yelp showed price transparency lifts conversion ~25%. Each item: { service, priceLabel, includes[], note? }. Use realistic 2026 regional pricing — DO NOT fabricate numbers if intake does not provide them; instead pick from common-industry ranges and disclose "starting at" or "typical range".',
    },
  },
  // ─── Home care section types ───────────────────────────────────────────
  care: {
    finder: {
      required: ['heading'],
      optional: ['intro', 'relationships', 'careTypes', 'hoursOptions', 'ctaLabel', 'responsePromise'],
      use_when: 'home-care agencies, in-home senior care. Multi-step wizard: who needs care → what kind → hours per week → ZIP → schedule no-cost in-home assessment. Routes to /api/leads with full context pre-filled. Converts 3-4x over a generic contact form for this audience (adult children 45-70 researching care for a parent).',
    },
  },
  caregivers: {
    grid: {
      required: ['items'],
      optional: ['heading', 'intro', 'filters'],
      use_when: 'home-care agencies. Anonymized caregiver profile cards: { name (first-only OR alias), yearsExperience, certifications (CNA/HHA/RN), specialties (dementia/hospice/recovery/companion), languages, photo, blurb }. Filterable by specialty. Humanizes the brand massively — adult children hire a person, not an agency.',
    },
  },
  coverage: {
    'insurance-guide': {
      required: ['items'],
      optional: ['heading', 'intro'],
      use_when: 'home-care agencies, medical practices. Stack of coverage-source explainers (Medicare, Medicaid, VA Aid & Attendance, LTC insurance, private pay). Each card: { source, eligibility, whatItCovers, howToApply, ourRole }. Top-funnel SEO play — adult children search "does medicare cover home care" at the start of their journey.',
    },
  },
  // ─── Landscaping / recurring-service section type ──────────────────────
  packages: {
    seasonal: {
      required: ['items'],
      optional: ['heading', 'intro', 'currentSeason'],
      use_when: 'landscaping, lawn care, snow removal, pool service, pest control — any vertical that sells recurring service packages OR seasonal contracts. Stack of package cards with the current-season-relevant one highlighted. Items: { title, tier (basic/standard/premium), pricePerMonth, includes[], seasonOnly?, badge? }. The renderer auto-detects current month and badges the seasonally relevant tier.',
    },
  },
} as const

type SectionType = keyof typeof SECTION_SCHEMA

/**
 * Sanitize the AI's output: drop unknown types/variants, coerce data
 * shapes, cap counts so the renderer doesn't choke on absurd input.
 */
function sanitizeSections(raw: any): Section[] {
  if (!Array.isArray(raw)) return []
  const out: Section[] = []
  for (const s of raw.slice(0, 12)) {
    if (!s || typeof s !== 'object') continue
    const type = String(s.type || '').toLowerCase()
    const variant = String(s.variant || '').toLowerCase()
    if (!(type in SECTION_SCHEMA)) continue
    const variants = SECTION_SCHEMA[type as SectionType] as Record<string, unknown>
    if (!(variant in variants)) continue
    const data = (s.data && typeof s.data === 'object') ? s.data : {}
    // Cap services lists at 8 — past that the renderer becomes a slog.
    if (Array.isArray(data.items)) data.items = data.items.slice(0, 8)
    if (Array.isArray(data.stats)) data.stats = data.stats.slice(0, 6)
    if (Array.isArray(data.bullets)) data.bullets = data.bullets.slice(0, 6)
    out.push({ type, variant, data })
  }
  return out
}

function buildPrompt(input: ComposerInput): string {
  const schemaSummary = Object.entries(SECTION_SCHEMA).map(([type, variants]) =>
    `  ${type}: ${Object.keys(variants).join(', ')}`
  ).join('\n')

  // Customer feedback from prior previews. When present, must take priority
  // over the original intake — the customer has already SEEN the first
  // attempt and is asking for specific changes. Treat as MUST-DO not as
  // suggestions.
  const feedbackBlock = (input.feedbackHistory && input.feedbackHistory.length > 0)
    ? `\n\n# Prior customer feedback — ACT ON ALL OF IT\n` +
      `The customer has already reviewed previous draft(s) and asked for these changes. ` +
      `Treat each as a hard requirement, not a suggestion. If two pieces of feedback conflict, ` +
      `take the most recent.\n\n` +
      input.feedbackHistory.map((m, i) => `[${i + 1}] ${m}`).join('\n\n') +
      `\n\n`
    : ''

  return `You are composing a homepage for ${input.businessName} — a ${input.businessType} in ${[input.city, input.state].filter(Boolean).join(', ') || 'the region they serve'}.
${feedbackBlock}
About the business
${input.description ? '"' + input.description + '"' : '(no description provided — work from the business type and services)'}

Services they offer
${(input.services || []).map(s => '- ' + s).join('\n') || '(none specified — infer reasonable services for a ' + input.businessType + ')'}

Their goals
${(input.goals || []).map(g => '- ' + g).join('\n') || '(none specified — assume generic lead generation)'}

Sites they pointed at as inspiration
${(input.competitors || []).map(c => '- ' + c).join('\n') || '(none)'}

# Your job
Propose a homepage as an ordered list of sections. Each section has a type, a variant, and a data object. Output JSON only — no prose, no markdown, no explanation.

# Available section types and variants

${schemaSummary}

# When to use each variant
${Object.entries(SECTION_SCHEMA).map(([type, variants]) =>
  Object.entries(variants).map(([variant, spec]) =>
    `- ${type}/${variant}: ${(spec as any).use_when}`
  ).join('\n')
).join('\n')}

# Rules
1. Start with exactly ONE hero section.
2. After the hero, you may add 0–1 additional hero blocks (e.g. an about-us moment using hero/split with flip:true).
3. Include exactly ONE services section showing their offerings.
4. End with exactly ONE cta section.
5. Choose variants that fit the business — read the "use_when" guidance.
6. For services, write copy that actually reflects what's described in the intake — NOT generic boilerplate.
7. For hero stats, use realistic numbers based on the intake. If the intake doesn't support specific numbers, omit stats entirely — don't fabricate.
8. For photos, use Unsplash URLs in the format https://images.unsplash.com/photo-<id>?w=1400&q=80. Choose photos that match the business type. If you don't know a specific photo id, use https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=1400&q=80 as a placeholder.
9. CTA must include a primaryCta with a real action label ("Schedule a consultation", "Get a quote") — not "Click here".
10. All copy must read like a human wrote it for this specific business, not a template.

# Voice — the part most AI fails at

This is the bar. Headlines must be SPECIFIC, CONFIDENT, and NON-GENERIC.
A reader should be able to tell ONE business apart from another competitor
in the same industry just by reading the hero.

BANNED phrases — never use these or anything that smells like them:
- "Trusted [X] experts/professionals/leader"
- "Premier / leading / number-one [X]"
- "Compassionate care" (homecare)
- "Complete [X] solutions" / "Full-service [X] solutions"
- "Quality [X] for your [Y]" / "Quality you can trust"
- "Your [adjective] partner for [X]"
- "Where [vague noun] meets [vague noun]"
- "From [X] to [Y]" used as a complete headline
- Any title that could substitute the business name and still apply to a
  competitor down the street.

WRITE LIKE A HUMAN:
- Use a fact from the intake in the headline if you can (city, year founded,
  signature dish/service, owner name, what they do that competitors don't).
- Take a position. The dispensary headline "Curated Quality, Not Volume
  Pricing" is good because it picks a side. "Premium Cannabis Selection"
  is bad because anybody could say it.
- The hero subtitle should be ONE concrete claim — a price, a count, a
  specific service window, a thing only they do — not a list of buzzwords.
- It's better to be slightly weird and specific than smooth and generic.

Examples — the SAME business done well vs poorly:

Landscaping done BADLY (don't do this):
  eyebrow: "Madison's Trusted Landscaping Experts"
  title:   "Complete Landscape Solutions from Design to Maintenance"
  subtitle:"Full-service landscape design-build and maintenance."

Landscaping done WELL:
  eyebrow: "Madison · since 2011"
  title:   "Nine trucks, weekly cycles, one foreman per job"
  subtitle:"Design-build crews who also handle your spring cleanups,
            paver patios, and snow. Started by a guy who spent 12 years on
            someone else's truck before starting his own."

Homecare done BADLY (don't do this):
  title:   "Compassionate care for your loved ones at home"

Homecare done WELL:
  eyebrow: "Eau Claire · founded by two RNs"
  title:   "Care designed by nurses, not consultants"
  subtitle:"Twenty-two caregivers, all background-checked, all paid above
            market. Specialists in dementia and end-of-life support."

If your headline could plausibly run on a competitor's site five miles
away, rewrite it.

# Output schema (strict)
{
  "rationale": "1-2 sentences on why this composition fits this business",
  "sections": [
    {
      "type": "hero" | "services" | "cta",
      "variant": "<one of the allowed variants for that type>",
      "data": { ... }
    }
  ]
}

# Section data shapes

hero/full-bleed:
{ "image": "<url>", "eyebrow": "<short tagline>", "title": "<headline>", "subtitle": "<1-2 sentence support>", "primaryCta": { "label": "...", "href": "#contact" }, "secondaryCta": { "label": "...", "href": "#services" } }

hero/split:
{ "flip": <bool>, "image": "<url>", "eyebrow": "<short tagline>", "title": "<headline>", "subtitle": "<1-2 sentence support>", "primaryCta": { "label": "...", "href": "..." }, "stats": [{ "value": "...", "label": "..." }] }

hero/centered-stats:
{ "eyebrow": "<short tagline>", "title": "<big headline>", "subtitle": "<support>", "primaryCta": { "label": "...", "href": "#contact" }, "stats": [{ "value": "...", "label": "..." }] }

services/cards-grid:
{ "heading": "...", "intro": "...", "items": [{ "title": "...", "description": "...", "image": "<url>", "href": "#contact" }] }

services/alternating:
{ "heading": "...", "intro": "...", "items": [{ "title": "...", "description": "...", "image": "<url>", "bullets": ["..."], "href": "#contact" }] }

cta/banner:
{ "heading": "...", "subtitle": "...", "primaryCta": { "label": "...", "href": "#contact" } }

cta/split:
{ "heading": "...", "subtitle": "...", "image": "<url>", "bullets": ["..."], "primaryCta": { "label": "...", "href": "#contact" }, "phone": "${input.phone || ''}" }

Output the JSON now — nothing else.`
}

/**
 * Calls Claude to compose a homepage. Returns sanitized sections plus
 * (optionally) the model's rationale string. Throws if no API key or
 * the model returns un-parseable output after a retry.
 */
export async function composeHomepageSections(input: ComposerInput): Promise<ComposerResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }

  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  // Homepage compose (4K tokens) — fail fast rather than hold the SDK's 10-min default
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 180_000, maxRetries: 2 })

  const prompt = buildPrompt(input)

  const callOnce = async (extraSystem?: string) => {
    return anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: 'You compose homepage section schemas. Output strict JSON only. No prose, no markdown fences.' + (extraSystem ? ' ' + extraSystem : ''),
      messages: [{ role: 'user', content: prompt }],
    })
  }

  const tryParse = (text: string): { sections: any[]; rationale?: string } | null => {
    // Strip code fences if the model added them despite the system message.
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    try {
      const parsed = JSON.parse(cleaned)
      if (parsed && Array.isArray(parsed.sections)) return parsed
      return null
    } catch { return null }
  }

  const res1 = await callOnce()
  const text1 = res1.content[0]?.type === 'text' ? res1.content[0].text : ''
  let parsed = tryParse(text1)

  if (!parsed) {
    // One retry with a stricter system message — usually a markdown wrap issue.
    const res2 = await callOnce('Your previous output was not valid JSON. Output ONLY the raw JSON object, starting with { and ending with }.')
    const text2 = res2.content[0]?.type === 'text' ? res2.content[0].text : ''
    parsed = tryParse(text2)
  }

  if (!parsed) {
    throw new Error('Composer returned un-parseable output after retry')
  }

  return {
    sections: sanitizeSections(parsed.sections),
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale : undefined,
  }
}

// ─── Multi-page composer ─────────────────────────────────────────────────

export interface SiteResult {
  // Page set varies by industry — generic verticals get home/about/services/contact,
  // food trucks get home/menu/about/schedule/catering/contact, future verticals
  // will define their own recipe sets. Keys are always strings, values always
  // have a `sections` array; downstream renderers iterate over whatever keys
  // are present.
  pages: Record<string, ComposerResult>
  rationale?: string
}

/**
 * Schema describing how a multi-page site composition should be shaped.
 * Each page allows a curated subset of section types — the about page
 * leads with about/story; the contact page is just contact/form-info
 * possibly wrapped by an intro hero. Keeps Claude from putting a 5-stat
 * hero on the contact page, etc.
 */
const PAGE_RECIPES = {
  home: {
    purpose: 'Front door. Build trust fast, show what they do, close with a CTA.',
    allowed_types: ['hero', 'services', 'gallery', 'testimonials', 'faq', 'cta'],
    required_sequence: '1 hero, then 1 services, then ADD 1 faq (proactively — generate plausible questions from the description), optionally 1 gallery (if visual business with Tier 1 customer photos available) or 1 testimonials (ONLY if real quotes are in the intake — never fabricate), close with 1 cta',
  },
  about: {
    purpose: 'Tell who they are. The voice page — read by qualified leads doing due diligence.',
    allowed_types: ['about', 'team', 'testimonials', 'cta'],
    required_sequence: '1 about/story, optional 1 team/grid, optional 1 testimonials block (only with real quotes), close with 1 cta',
  },
  services: {
    purpose: 'Full menu of what they do. Read by people who already know they want to hire and are scoping fit.',
    allowed_types: ['hero', 'services', 'gallery', 'faq', 'cta'],
    required_sequence: 'optional 1 hero (lighter), 1 services (use the more-detailed variant), optional 1 of {gallery, faq}, close with 1 cta',
  },
  contact: {
    purpose: 'Conversion page. Form + business details + response promise.',
    allowed_types: ['hero', 'contact', 'faq'],
    required_sequence: 'optional 1 hero (short, copy-only), 1 contact/form-info, optional 1 faq if it answers common pre-contact questions',
  },
} as const

// Contractor (general, remodeling, kitchen, bath, deck, fence, concrete,
// masonry, tile, flooring, framing, drywall, cabinet). Portfolio is the
// conversion engine — "look at this kitchen we did" beats any copy. Trust
// signals (license, insured, BBB, years) matter more than for showcase
// businesses. Pricing is project-by-project so no flat-rate menu —
// instead, give realistic ranges in the about/voice + faq.
const CONTRACTOR_PAGE_RECIPES = {
  home: {
    purpose: 'Front door for a contractor. Hero takes a position about their specialty. Portfolio preview → services → about. SEO targets: "[city] kitchen remodel", "[city] general contractor", "[city] deck builder".',
    allowed_types: ['hero', 'services', 'reservation', 'gallery', 'stats', 'testimonials', 'about', 'cta'],
    required_sequence: '1 hero/full-bleed (a finished project at golden hour, an in-progress build, or owner-on-jobsite — NOT generic stock tools), 1 services/cards-grid (3-6 specialties), 1 reservation/cta with heading "Ready to talk about your project?" and buttonLabel "Schedule a free estimate" (Twomiah Bookings — this is the primary conversion for contractors; homeowners want to book a walkthrough, not call), 1 gallery/grid (8-12 finished-project shots from real jobs — portfolio is the conversion driver), optional 1 stats/bar (years, jobs completed, licenses held — real anchored numbers), optional 1 testimonials block (real homeowner quotes only), optional 1 about/story snippet, close with 1 cta',
  },
  services: {
    purpose: 'The full services menu — what they build, install, remodel. Each service with description + scope.',
    allowed_types: ['hero', 'services', 'gallery', 'faq', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Services"), 1 services/alternating (each specialty: description, typical scope, what\'s included, photo from a finished project), optional 1 gallery, 1 faq (free estimates, lead time, permits, financing), close with 1 cta',
  },
  projects: {
    purpose: 'Portfolio of finished work — kitchens, baths, decks, additions, full builds. The "can they actually do this" page.',
    allowed_types: ['hero', 'gallery', 'services', 'testimonials', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Projects"), 1 gallery/grid (20-40 photos organized by project type — each project caption gives location-only, scope, materials), optional 1 services/alternating retitled as "Recent builds" if intake has detailed project descriptions, optional 1 testimonials, close with 1 cta',
  },
  about: {
    purpose: 'Owner + crew + credentials + history. Where homeowners decide whether to hand you the keys to their house.',
    allowed_types: ['about', 'team', 'stats', 'testimonials', 'cta'],
    required_sequence: '1 about/story (owner portrait + WHY this contracting business — apprenticeship, family trade, specialty), optional 1 stats/bar (years, jobs completed, licenses, insurance carried — concrete anchored numbers), optional 1 team/grid (lead carpenter, project manager, key subs), optional 1 testimonials, close with 1 cta',
  },
  contact: {
    purpose: 'Conversion page for estimate requests + general contact.',
    allowed_types: ['hero', 'contact', 'reservation', 'faq', 'cta'],
    required_sequence: 'optional 1 hero (short, set expectation: "free estimates, typically [X] day response"), 1 contact/form-info, 1 reservation/cta with heading "Or grab a time on the calendar" and buttonLabel "Schedule a free estimate" (Twomiah Bookings — for homeowners who would rather book directly than wait for a callback), 1 faq (estimate process, lead time, financing, permits, project minimum), close with 1 cta',
  },
} as const

// Restaurant (sit-down, dinner-focused, brunch spots, neighborhood
// gastropubs). Reservation widget above-the-fold drives more bookings
// than a "book a table" link. Menu prominent, chef story matters,
// tonight's specials gives the site a heartbeat that staff can update
// daily without touching the layout.
const RESTAURANT_PAGE_RECIPES = {
  home: {
    purpose: 'Front door for a sit-down restaurant. Reserve a table is the conversion engine. Menu second. Chef + provenance differentiates from chain dining.',
    allowed_types: ['hero', 'reservation', 'deals', 'menu', 'about', 'gallery', 'testimonials', 'cta'],
    required_sequence: '1 hero/full-bleed (dining-room-at-golden-hour photography, signature dish, OR chef portrait — NOT generic stock plates), 1 reservation/widget (above-the-fold conversion driver), optional 1 deals/strip retitled as "Tonight" or "This week" for specials, 1 menu/cards (4-8 signature items with prices + dietary chips — not the FULL menu, that lives on /menu), optional 1 about/story snippet (chef-driven, NOT "our journey"), optional 1 gallery/grid, optional 1 testimonials block, close with 1 cta',
  },
  menu: {
    purpose: 'The full menu. Filterable by dietary, course, time of day. SEO target: "[restaurant name] menu" + "[cuisine type] [city]".',
    allowed_types: ['hero', 'menu', 'faq', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Menu"), 1 menu/cards with the full lineup, 1 faq about allergens / substitutions / large parties / kids menu / corkage, close with 1 cta',
  },
  reservations: {
    purpose: 'Standalone reservations page — for diners who clicked from social or a "book now" search.',
    allowed_types: ['hero', 'reservation', 'faq', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Reserve"), 1 reservation/widget, 1 faq (no-show policy, large-party threshold, walk-ins, dietary heads-up), close with 1 cta',
  },
  about: {
    purpose: 'Chef + house + provenance + history. The trust + voice page.',
    allowed_types: ['about', 'team', 'stats', 'gallery', 'testimonials', 'cta'],
    required_sequence: '1 about/story (chef portrait + the WHY of the menu / restaurant), optional 1 stats/bar with real anchored numbers (seats, years, chef tenure — not vanity), optional 1 team/grid (chef + sous + manager), optional 1 gallery (the room, the kitchen, the producers), optional 1 testimonials, close with 1 cta',
  },
  'private-dining': {
    purpose: 'Private dining + buyouts + catering. Highest-margin revenue for most restaurants.',
    allowed_types: ['hero', 'catering', 'gallery', 'faq', 'cta'],
    required_sequence: '1 hero/full-bleed (private-event photography), 1 catering/inquiry-form (event date + headcount + venue type + dietary), optional 1 gallery/grid of past events, 1 faq (capacities, minimums, what is included, deposit, lead time), close with 1 cta',
  },
  contact: {
    purpose: 'Conversion page for non-reservation contact (press, vendor, hires).',
    allowed_types: ['hero', 'contact', 'reservation', 'faq'],
    required_sequence: 'optional 1 hero (short), 1 contact/form-info, optional 1 reservation/widget for "or reserve a table instead", optional 1 faq',
  },
} as const

// Cafe (coffee shop, tea room, neighborhood café, bakery-café). Walk-in
// only — no reservation widget. Daily-changing specials matter more than
// menu (regulars come for the new seasonal latte). Cozy atmosphere is
// the differentiator vs Starbucks. Founder/roaster story is the trust
// signal — "we roast on a 5kg Diedrich" beats "premium coffee".
const CAFE_PAGE_RECIPES = {
  home: {
    purpose: 'Front door for a neighborhood café. Hero + today\'s feature drink + signature menu items + atmosphere. Walk-in only — no reservation widget. SEO targets: "[city] coffee shop", "best latte [city]".',
    allowed_types: ['hero', 'deals', 'menu', 'about', 'gallery', 'testimonials', 'cta'],
    required_sequence: '1 hero/full-bleed (latte-art close-up, the interior at golden hour, or the espresso machine in action — NOT generic coffee-cup-on-saucer stock), optional 1 deals/strip retitled "Today" for daily-changing drink/pastry special, 1 menu/cards (4-8 signature drinks + 2-3 pastries with prices — not the FULL menu), optional 1 about/story snippet (roaster/baker/founder), optional 1 gallery/grid (interior + people + drinks), optional 1 testimonials, close with 1 cta',
  },
  menu: {
    purpose: 'The full café menu — drinks, food, retail beans. SEO target: "[café name] menu".',
    allowed_types: ['hero', 'menu', 'faq', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Menu"), 1 menu/cards with the full lineup organized by category (espresso, drip, tea, food, retail), 1 faq (milk alternatives, decaf, allergens, dietary, beans-to-go), close with 1 cta',
  },
  about: {
    purpose: 'Founder + roastery/bakery + sourcing. The trust + voice page.',
    allowed_types: ['about', 'team', 'stats', 'gallery', 'testimonials', 'cta'],
    required_sequence: '1 about/story (founder portrait + WHY this café — roastery, baking, neighborhood), optional 1 stats/bar (years, drinks/day, farms sourced from, baristas trained — real anchored numbers), optional 1 team/grid (baristas + roaster + baker), optional 1 gallery (the bar, the roastery, the producers), optional 1 testimonials, close with 1 cta',
  },
  visit: {
    purpose: 'Hours, address, parking, wifi, dog-friendly, accessibility. The "are you open + can I work from there" page.',
    allowed_types: ['hero', 'contact', 'faq', 'gallery', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Visit"), 1 contact/form-info (address + hours prominent), 1 faq (wifi, outlets, laptop policy, dog-friendly, parking, accessible entry, kid-friendly), optional 1 gallery of the space, close with 1 cta',
  },
} as const

// Salon (hair, nails, spa, barber, esthetician). Bookings-first —
// every CTA goes to the Twomiah Bookings widget. Services menu is the
// second engine. Stylist profiles humanize. Gallery shows actual work
// (cuts, colors, nail sets). Trust signals: licenses, years, brands
// carried. Pricing transparent.
const SALON_PAGE_RECIPES = {
  home: {
    purpose: 'Front door for a salon/spa/barbershop. Bookings widget above-fold + services + stylist profiles + gallery. SEO targets: "[city] hair salon", "[city] barber", "best [service] [city]".',
    allowed_types: ['hero', 'reservation', 'services', 'team', 'gallery', 'about', 'testimonials', 'cta'],
    required_sequence: '1 hero/full-bleed (real-client-portrait, the chair at golden hour, a signature color/cut — NOT generic stock model), 1 reservation/widget above-the-fold (Twomiah Bookings — this is the conversion engine), 1 services/cards-grid (signature services with prices), optional 1 team/grid (stylists with specialties + booking links per-stylist), optional 1 gallery/grid of actual work (NOT stock), optional 1 about/story snippet, optional 1 testimonials, close with 1 cta',
  },
  services: {
    purpose: 'Full services menu with transparent pricing. SEO targets: "[city] balayage cost", "men\'s cut [city]".',
    allowed_types: ['hero', 'services', 'reservation', 'faq', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Services"), 1 services/alternating (each service with description + price range + duration), 1 reservation/widget, 1 faq (cancellation policy, retouching, color consultations, hair history disclosure, deposits), close with 1 cta',
  },
  stylists: {
    purpose: 'Stylist/barber/esthetician profiles. Each profile drives per-stylist bookings.',
    allowed_types: ['hero', 'team', 'gallery', 'testimonials', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Our team"), 1 team/grid (3-12 profiles — name + specialty + years + book link to that stylist), optional 1 gallery/grid mixing each stylist\'s work, optional 1 testimonials per-stylist, close with 1 cta',
  },
  gallery: {
    purpose: 'Portfolio of actual work — before/after, finished cuts, color transformations, nail sets. The "can they do what I want" page.',
    allowed_types: ['hero', 'gallery', 'before_after', 'testimonials', 'reservation', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Gallery"), 1 gallery/grid (12-30 real-work shots, organized by category — color, cuts, nails, brows), optional 1 before_after/slider for transformation pieces, optional 1 testimonials, 1 reservation/widget, close with 1 cta',
  },
  about: {
    purpose: 'Owner + house + brands carried + history. Trust + voice.',
    allowed_types: ['about', 'team', 'stats', 'gallery', 'testimonials', 'cta'],
    required_sequence: '1 about/story (owner portrait + the WHY of the salon — what they specialize in, what brands they carry, what kind of clients fit), optional 1 stats/bar (years, stylists, brands carried, color education hours), optional 1 team/grid, optional 1 gallery (the room, the bar, the products), optional 1 testimonials, close with 1 cta',
  },
  contact: {
    purpose: 'Conversion page for non-booking contact (press, vendor, employment).',
    allowed_types: ['hero', 'contact', 'reservation', 'faq'],
    required_sequence: 'optional 1 hero (short), 1 contact/form-info, optional 1 reservation/widget for "or book instead", optional 1 faq',
  },
} as const

// Fitness (gym, yoga studio, pilates, CrossFit, boxing, personal training).
// Class schedule + intro offer + trainer profiles + transformation gallery.
// Twomiah Bookings powers class signups + PT booking.
const FITNESS_PAGE_RECIPES = {
  home: {
    purpose: 'Front door for a gym/studio. Intro offer + class schedule + trainer profiles + transformation gallery. SEO: "[city] yoga studio", "CrossFit [city]", "personal trainer [city]".',
    allowed_types: ['hero', 'deals', 'schedule', 'services', 'team', 'gallery', 'testimonials', 'cta'],
    required_sequence: '1 hero/full-bleed (real-member-mid-workout, the studio space, NOT generic-model-stock), optional 1 deals/strip retitled "Intro offer" with the actual first-week/first-month deal, 1 schedule/week-strip showing this week\'s classes (or 1 services/cards-grid for personal training), optional 1 team/grid (3-8 trainers/instructors with specialties), optional 1 gallery showing the space + actual members, optional 1 testimonials (real member quotes with results), close with 1 cta',
  },
  schedule: {
    purpose: 'Full class schedule — by day, by class type, by instructor. SEO: "yoga schedule [city]", "morning CrossFit [city]".',
    allowed_types: ['hero', 'schedule', 'reservation', 'faq', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Schedule"), 1 schedule/week-strip (full week, filterable), 1 reservation/widget (Twomiah Bookings for class signup), 1 faq (drop-in policy, late arrival, levels, what to bring, childcare), close with 1 cta',
  },
  classes: {
    purpose: 'Class type descriptions — what each class actually is, who it\'s for, what level. SEO: "[class type] for beginners [city]".',
    allowed_types: ['hero', 'services', 'team', 'gallery', 'testimonials', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Classes"), 1 services/alternating (each class type with description + level + duration + format), optional 1 team/grid showing which instructor teaches what, optional 1 gallery of classes in progress, optional 1 testimonials, close with 1 cta',
  },
  trainers: {
    purpose: 'Trainer/instructor profiles. Each drives per-trainer PT bookings.',
    allowed_types: ['hero', 'team', 'gallery', 'testimonials', 'reservation', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Our team"), 1 team/grid (3-12 profiles — name + specialty + certifications + book link), optional 1 gallery, optional 1 testimonials, 1 reservation/widget, close with 1 cta',
  },
  pricing: {
    purpose: 'Memberships, drop-ins, packages — transparent pricing.',
    allowed_types: ['hero', 'pricing', 'deals', 'faq', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Pricing"), 1 pricing/flat-rate-menu (memberships + drop-in + class packs + PT packages), optional 1 deals/strip for intro offers, 1 faq (cancellation, freezing membership, family plans, refund), close with 1 cta',
  },
  about: {
    purpose: 'Owner + studio philosophy + history + community.',
    allowed_types: ['about', 'team', 'stats', 'gallery', 'testimonials', 'cta'],
    required_sequence: '1 about/story (owner/coach portrait + the WHY of the studio — philosophy, who you serve), optional 1 stats/bar (members, years, classes taught, certifications), optional 1 team/grid, optional 1 gallery, optional 1 testimonials, close with 1 cta',
  },
  contact: {
    purpose: 'Conversion page for non-class contact (corporate wellness, press, hires).',
    allowed_types: ['hero', 'contact', 'reservation', 'faq'],
    required_sequence: 'optional 1 hero (short), 1 contact/form-info, optional 1 reservation/widget for "or just sign up for a class", optional 1 faq',
  },
} as const

// Hotel / B&B / boutique inn / vacation rental. Rooms catalog + reservation
// engine + amenities + local map + editorial. Decision-maker is usually
// pricing-sensitive but trust-led — reviews + real-room photography
// + transparent pricing matter more than aspirational copy.
const HOTEL_PAGE_RECIPES = {
  home: {
    purpose: 'Front door for a hotel/B&B/inn. Reservation widget + rooms preview + amenities + location. SEO: "[city] hotel", "boutique hotel [city]", "B&B [city]".',
    allowed_types: ['hero', 'reservation', 'services', 'gallery', 'about', 'testimonials', 'cta'],
    required_sequence: '1 hero/full-bleed (the actual property exterior or the most photogenic real room — NOT generic luxury-hotel stock), 1 reservation/widget above-fold (Twomiah Bookings or booking engine — primary conversion), 1 services/cards-grid showing 3-5 room types with starting rates, optional 1 about/story snippet (innkeeper-driven), optional 1 gallery of real rooms + common areas, optional 1 testimonials (real guest quotes), close with 1 cta',
  },
  rooms: {
    purpose: 'Full rooms catalog. Each room with photography + amenities + occupancy + starting rate. SEO: "[hotel name] rooms", "[room type] [city]".',
    allowed_types: ['hero', 'services', 'reservation', 'faq', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Rooms"), 1 services/alternating (each room: name + photos + sleeps + amenities + rate "from $X"), 1 reservation/widget, 1 faq (check-in/out times, dog policy, parking, breakfast, kid policy, accessibility), close with 1 cta',
  },
  amenities: {
    purpose: 'Property amenities — pool, restaurant, spa, gym, breakfast, parking, wifi.',
    allowed_types: ['hero', 'services', 'gallery', 'faq', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Amenities"), 1 services/cards-grid (each amenity with photo + description), optional 1 gallery, 1 faq (hours, fees, reservations needed, guest-only), close with 1 cta',
  },
  local: {
    purpose: 'Local area guide — what to do, where to eat, distances to landmarks. SEO: "things to do near [hotel name]".',
    allowed_types: ['hero', 'services', 'gallery', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="The area"), 1 services/alternating (3-8 local highlights — restaurants, attractions, day trips — each with photo + distance + why-go), optional 1 gallery, close with 1 cta',
  },
  about: {
    purpose: 'Owner + history + house philosophy. The trust + voice page.',
    allowed_types: ['about', 'team', 'stats', 'gallery', 'testimonials', 'cta'],
    required_sequence: '1 about/story (innkeeper portrait + history of the property + what makes the house different), optional 1 stats/bar (rooms, years, repeat-guest %, awards — real anchored numbers), optional 1 team/grid, optional 1 gallery, optional 1 testimonials, close with 1 cta',
  },
  contact: {
    purpose: 'Conversion page for non-booking contact (events, press, group inquiries).',
    allowed_types: ['hero', 'contact', 'reservation', 'faq'],
    required_sequence: 'optional 1 hero (short), 1 contact/form-info, optional 1 reservation/widget, optional 1 faq',
  },
} as const

// Events venue / wedding venue / banquet hall. Venue gallery + packages
// + capacity + booking inquiry form. Bookings happen via inquiry (deposit
// + custom date), not real-time widget — most venues require consultation.
const EVENTS_PAGE_RECIPES = {
  home: {
    purpose: 'Front door for an events venue. Venue photography + packages + capacity + inquiry form. SEO: "[city] wedding venue", "[city] event space", "rustic barn wedding [city]".',
    allowed_types: ['hero', 'gallery', 'services', 'catering', 'testimonials', 'about', 'cta'],
    required_sequence: '1 hero/full-bleed (the actual venue in event mode — set up for a real wedding/event, NOT empty room or stock), 1 gallery/grid of the space across configurations, 1 services/cards-grid (3-5 package tiers with starting prices + included amenities + capacity), 1 catering/inquiry-form (event date + headcount + event type + budget range), optional 1 testimonials (real couples + planners), optional 1 about/story snippet, close with 1 cta',
  },
  venue: {
    purpose: 'Full venue details — every space, capacity, layouts. SEO: "[venue name] capacity", "[venue type] [city]".',
    allowed_types: ['hero', 'gallery', 'services', 'faq', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="The venue"), 1 gallery/grid (every space — ceremony, reception, prep rooms, exterior), 1 services/alternating (each space: dimensions + capacity seated/cocktail + included equipment + photos), 1 faq (rentals, vendor restrictions, sound limits, alcohol, accessibility, parking), close with 1 cta',
  },
  packages: {
    purpose: 'Package tiers — what\'s included at each price point. SEO: "[venue name] pricing", "wedding venue cost [city]".',
    allowed_types: ['hero', 'services', 'pricing', 'faq', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Packages"), 1 services/alternating OR 1 pricing/flat-rate-menu (3-5 tiers with starting prices, included hours, capacity, included amenities), 1 faq (what\'s NOT included, vendor list, payment schedule, cancellation, weather, off-season pricing), close with 1 cta',
  },
  vendors: {
    purpose: 'Preferred vendor list — caterers, florists, photographers, planners, DJs. Adds value + earns referral fees.',
    allowed_types: ['hero', 'services', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Vendors we love"), 1 services/cards-grid (8-20 vendors categorized — each with name, category, contact, why-we-recommend), close with 1 cta',
  },
  gallery: {
    purpose: 'Real events portfolio — actual weddings, corporate events, parties. The "can I see myself here" page.',
    allowed_types: ['hero', 'gallery', 'testimonials', 'catering', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Real events"), 1 gallery/grid (30-50 shots from real events — weddings, corporate, parties), optional 1 testimonials (real couples + planners), 1 catering/inquiry-form, close with 1 cta',
  },
  about: {
    purpose: 'Owner/family + property history + philosophy.',
    allowed_types: ['about', 'stats', 'gallery', 'testimonials', 'cta'],
    required_sequence: '1 about/story (owner/family portrait + the WHY of the venue — restoration, family farm, historical building), optional 1 stats/bar (events/year, years operating, capacity), optional 1 gallery, optional 1 testimonials, close with 1 cta',
  },
  contact: {
    purpose: 'Conversion page — for tours, vendor inquiries, press.',
    allowed_types: ['hero', 'contact', 'catering', 'faq'],
    required_sequence: 'optional 1 hero (short), 1 contact/form-info, 1 catering/inquiry-form (for date inquiries), optional 1 faq',
  },
} as const

// Field service (HVAC / plumbing / electrical / cleaning) — the work
// model varies meaningfully across these (emergency-first HVAC vs
// recurring cleaning contracts) but the page set is consistent. The
// composer guidance below differentiates voice + which sections to
// emphasize per the actual business.
const FIELDSERVICE_PAGE_RECIPES = {
  home: {
    purpose: 'Front door for HVAC / plumbing / electrical / cleaning. Emergency-first if applicable, then prove you actually answer the phone, then transparent pricing, then book.',
    allowed_types: ['emergency', 'hero', 'service_area', 'trust', 'services', 'pricing', 'reservation', 'before_after', 'stats', 'cta'],
    required_sequence: 'For HVAC/plumbing/electrical: optional 1 emergency/bar at the very top if 24/7 service, 1 hero/full-bleed (specific specialty headline — NOT "premier HVAC service"), 1 service_area/zip-check, optional 1 trust/badges (licenses, master plumber, BBB), 1 services/cards-grid, 1 pricing/flat-rate-menu (the conversion lever), 1 reservation/cta with heading "Book the next available tech" and buttonLabel "Schedule a service call" (Twomiah Bookings — non-emergency customers want to pick a slot, not wait on hold), close with 1 cta/split. For cleaning: skip emergency/bar, lead with packages-style recurring contracts using services/alternating instead of pricing/flat-rate-menu, and use reservation/cta with buttonLabel "Schedule your first clean".',
  },
  emergency: {
    purpose: 'Dedicated emergency landing — for after-hours / weekend / holiday calls. SEO-targeted to "emergency plumber near me" / "AC repair tonight".',
    allowed_types: ['emergency', 'hero', 'service_area', 'services', 'faq', 'cta'],
    required_sequence: '1 emergency/bar at the very top, 1 hero/centered-stats (eyebrow="24/7", title takes the position that you DO actually answer at 2am), 1 service_area/zip-check, 1 services/cards-grid (emergency-only services), 1 faq/accordion (after-hours fee, response time, what counts as an emergency), close with 1 cta',
  },
  services: {
    purpose: 'The full service menu — what they fix, install, replace.',
    allowed_types: ['hero', 'services', 'pricing', 'before_after', 'faq', 'cta'],
    required_sequence: '1 hero/centered-stats, 1 services/alternating (more space per item than cards-grid), optional 1 pricing/flat-rate-menu (subset of common jobs), optional 1 before_after/slider (installation transformations), optional 1 faq, close with 1 cta',
  },
  pricing: {
    purpose: 'Transparent pricing page. Customers searching for "drain clear cost" / "water heater install cost" land here.',
    allowed_types: ['hero', 'pricing', 'financing', 'faq', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Pricing", title that takes the transparency-position), 1 pricing/flat-rate-menu (the full menu), optional 1 financing/calculator for $5k+ jobs, 1 faq (diagnostic fee, why prices are firm, what changes the price), close with 1 cta',
  },
  about: {
    purpose: 'Owner + crew + credentials + history. Where adult homeowners decide whether to trust you with their utility lines.',
    allowed_types: ['about', 'team', 'stats', 'trust', 'testimonials', 'cta'],
    required_sequence: '1 about/story (owner portrait + why), optional 1 stats/bar (years, master licenses held, jobs done), optional 1 team/grid, optional 1 trust/badges (Master licenses, BBB, manufacturer certifications), optional 1 testimonials, close with 1 cta',
  },
  contact: {
    purpose: 'Conversion page for non-emergency contact.',
    allowed_types: ['hero', 'contact', 'reservation', 'service_area', 'faq', 'emergency'],
    required_sequence: 'optional 1 emergency/bar (if emergency-first vertical), 1 hero (short), 1 contact/form-info, optional 1 reservation/cta with heading "Or grab a slot directly" and buttonLabel "Schedule a service call" (Twomiah Bookings), optional 1 service_area/zip-check, optional 1 faq',
  },
} as const

// Home care is the audience-distinct vertical — decision-makers are
// adult children 45-70 years old researching care for a parent. Page
// recipe leads with trust + a guided care-finder wizard (3-4x better
// conversion than a generic contact form), then humanizes through
// caregiver profiles, then top-funnels SEO via insurance coverage
// explainers.
const VET_PAGE_RECIPES = {
  home: {
    purpose: 'Front door for a veterinary clinic. Answer "can you see my animal, and can I trust you with it" in that order — urgency first, then the people.',
    allowed_types: ['urgent', 'hero', 'trust', 'services', 'team', 'reservation', 'testimonials', 'stats', 'cta'],
    required_sequence: '1 urgent/bar first (open-now state + phone — the highest-intent visitor has a sick animal RIGHT NOW and will not scroll), 1 hero/split or hero/full-bleed (real clinic or staff-with-animal photography, never stock of a stranger hugging a dog), 1 trust/badges (AAHA accreditation, Fear Free certification, state license, years serving the area — only badges the clinic actually holds), 1 services/grid (wellness, dental, surgery, diagnostics, urgent care — by SERVICE not by species unless the clinic is species-specific), 1 reservation/cta with heading "Book an appointment" and buttonLabel "Request a time" (Twomiah Bookings), optional 1 team/grid (owners choose a vet, not a building — faces matter more here than in most verticals), optional 1 testimonials, close with 1 cta',
  },
  services: {
    purpose: 'What the clinic treats and how care actually works. Reassurance plus practical detail.',
    allowed_types: ['hero', 'services', 'faq', 'trust', 'reservation', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Our services"), 1 services/grid or services/list with plain-English descriptions (an owner does not know what "dental prophylaxis" means — say "cleaning under anesthesia, with x-rays"), optional 1 trust/badges, 1 faq covering anesthesia safety, what a visit costs, and payment plans, optional 1 reservation/cta, close with 1 cta',
  },
  team: {
    purpose: 'The veterinarians and technicians. In this vertical the relationship is with a person.',
    allowed_types: ['hero', 'team', 'testimonials', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Meet the team"), 1 team/grid with credentials (DVM, VMD, RVT) and one human detail each — never a wall of identical white coats, optional 1 testimonials, close with 1 cta',
  },
  about: {
    purpose: 'Clinic story, philosophy, facility. The deep-trust page.',
    allowed_types: ['about', 'stats', 'trust', 'gallery', 'testimonials', 'cta'],
    required_sequence: '1 about/story (why the practice exists, in the owner-vet voice), optional 1 stats/bar with real numbers only, optional 1 trust/badges, optional 1 gallery of the actual facility (owners want to see where their animal stays), optional 1 testimonials, close with 1 cta',
  },
  contact: {
    purpose: 'Get seen. Hours, location, urgent-care routing.',
    allowed_types: ['urgent', 'hero', 'contact', 'reservation', 'faq'],
    required_sequence: 'optional 1 urgent/bar, optional 1 hero (short), 1 contact/form-info with hours and parking/entrance detail, optional 1 reservation/cta with buttonLabel "Request an appointment" (Twomiah Bookings), optional 1 faq about after-hours emergencies and which ER hospital the clinic refers to',
  },
} as const

const RV_PAGE_RECIPES = {
  home: {
    purpose: 'Front door for an RV / marine / powersports dealership. Units sell units — lead with inventory, then the reasons to buy here instead of the dealer two hours away.',
    allowed_types: ['hero', 'inventory', 'trust', 'services', 'stats', 'testimonials', 'reservation', 'cta'],
    required_sequence: '1 hero/full-bleed (real lot or a delivered customer, not a catalogue render), 1 inventory/showcase with featured units (this is the page — buyers browse units, not copy), 1 trust/badges (manufacturer certifications, dealer awards, financing partners, years in business — real ones only), optional 1 services/grid covering service, parts and consignment (service revenue is why a dealership survives), optional 1 stats/bar, optional 1 testimonials from delivered buyers, optional 1 reservation/cta with buttonLabel "Schedule a walkthrough" (Twomiah Bookings), close with 1 cta',
  },
  inventory: {
    purpose: 'The full featured-unit page. Browsing surface for buyers who are already shopping.',
    allowed_types: ['hero', 'inventory', 'faq', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Inventory"), 1 inventory/showcase with as many units as supplied, 1 faq covering trade-ins, financing terms, delivery radius and what "as-is" means on a used unit, close with 1 cta. NEVER imply the list is a live feed of everything on the lot — it is a featured selection and the disclaimer says so',
  },
  service: {
    purpose: 'Service and parts department. Recurring revenue, and the reason a buyer comes back.',
    allowed_types: ['hero', 'services', 'trust', 'reservation', 'faq', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Service + parts"), 1 services/grid (winterizing, roof reseal, appliance repair, warranty work, storage), optional 1 trust/badges for factory-certified techs, 1 reservation/cta with buttonLabel "Book service" (Twomiah Bookings), optional 1 faq on turnaround time and whether they service units bought elsewhere, close with 1 cta',
  },
  about: {
    purpose: 'Who the dealership is. Family-owned beats corporate in this vertical, when true.',
    allowed_types: ['about', 'stats', 'team', 'trust', 'testimonials', 'cta'],
    required_sequence: '1 about/story, optional 1 stats/bar (years, units delivered, service bays — real numbers), optional 1 team/grid, optional 1 trust/badges, optional 1 testimonials, close with 1 cta',
  },
  contact: {
    purpose: 'Get them to the lot or on the phone.',
    allowed_types: ['hero', 'contact', 'reservation', 'faq'],
    required_sequence: 'optional 1 hero (short), 1 contact/form-info with lot hours and directions, optional 1 reservation/cta with buttonLabel "Schedule a walkthrough" (Twomiah Bookings), optional 1 faq about trade appraisals and financing pre-approval',
  },
} as const

const HOMECARE_PAGE_RECIPES = {
  home: {
    purpose: 'Front door for a home-care agency. Empathetic but concrete trust signals, then a guided care-finder wizard, then humanize with caregivers.',
    allowed_types: ['hero', 'trust', 'stats', 'care', 'reservation', 'caregivers', 'testimonials', 'cta'],
    required_sequence: '1 hero/full-bleed or hero/split (owner-or-caregiver-with-client portrait, NOT generic hands-on-shoulder stock), 1 trust/badges (state license #, bonded/insured, BBB, years in business — concrete signals only), optional 1 stats/bar anchored in real numbers, 1 care/finder (this is the conversion engine), 1 reservation/cta with heading "Or skip the form and book a call" and buttonLabel "Schedule a free consultation" (Twomiah Bookings — adult children who already know what they need want to grab a slot, not fill out another form), optional 1 caregivers/grid showing 3-4 sample profiles, optional 1 testimonials block (real adult-child quotes only), close with 1 cta',
  },
  'find-care': {
    purpose: 'The standalone care-finder wizard page. Quiet, focused, no distraction. Where qualified leads convert.',
    allowed_types: ['hero', 'care', 'faq', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Find care", title sets expectation), 1 care/finder with full wizard, 1 faq about what happens after the form (call timing, in-home assessment, cost transparency), close with 1 cta',
  },
  caregivers: {
    purpose: 'The full caregiver roster. Adult children hire a person, not an agency — the more they can see and learn about the people, the higher the trust.',
    allowed_types: ['hero', 'caregivers', 'faq', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Our caregivers"), 1 caregivers/grid with 6-12 profiles, optional 1 faq about caregiver matching + background checks, close with 1 cta',
  },
  coverage: {
    purpose: 'Insurance + payment coverage explainer. Top-funnel SEO — adult children search "does medicare cover home care" early in research.',
    allowed_types: ['hero', 'coverage', 'faq', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Coverage + payment"), 1 coverage/insurance-guide covering Medicare, Medicaid, VA, LTC insurance, private pay, 1 faq about cost transparency and what families typically end up paying, close with 1 cta',
  },
  about: {
    purpose: 'Owner story + team + credentials. The deep-trust page.',
    allowed_types: ['about', 'team', 'stats', 'trust', 'testimonials', 'cta'],
    required_sequence: '1 about/story (owner portrait + the "why this agency" — almost always personal/family), optional 1 team/grid (leadership not caregivers — that lives on /caregivers), optional 1 stats/bar (real numbers only), optional 1 trust/badges, optional 1 testimonials block, close with 1 cta',
  },
  contact: {
    purpose: 'Conversion page. Quiet, direct, response promise.',
    allowed_types: ['hero', 'contact', 'reservation', 'faq'],
    required_sequence: 'optional 1 hero (short, empathetic), 1 contact/form-info with response-time promise, optional 1 reservation/cta with heading "Or schedule a call directly" and buttonLabel "Schedule a free consultation" (Twomiah Bookings), optional 1 faq',
  },
} as const

// Landscaping is recurring-service-first (weekly mow, monthly maintenance,
// seasonal contracts) — generic services/cards-grid doesn't surface the
// SUBSCRIPTION nature of how this business actually makes money.
// Reuses quote/instant-address from roofing for property-size quotes.
const LANDSCAPING_PAGE_RECIPES = {
  home: {
    purpose: 'Front door for a landscaping / lawn-care business. Lead with the seasonally-relevant package, then property quote, then proof.',
    allowed_types: ['hero', 'packages', 'quote', 'reservation', 'services', 'before_after', 'testimonials', 'cta'],
    required_sequence: '1 hero/full-bleed (the work itself in golden-hour photography, NOT a generic "trusted landscapers" stock), 1 packages/seasonal (current-season-tier highlighted), 1 quote/instant-address (property-size based estimate, pricePerSqFt 0.04-0.10 for mow contracts), 1 reservation/cta with heading "Prefer to talk it through?" and buttonLabel "Schedule an estimate visit" (Twomiah Bookings deep-link — gives customers who don\'t want an instant quote a path to a real conversation), optional 1 services/cards-grid for one-off jobs, 1 before_after/slider (3-4 transformations), close with 1 cta/split',
  },
  packages: {
    purpose: 'The recurring-service catalog. Compare tiers, see what is in each. This is the page that closes the subscription sale.',
    allowed_types: ['hero', 'packages', 'faq', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Packages"), 1 packages/seasonal showing all tiers in detail, 1 faq about cancellation, pause-for-vacation, billing cadence, weather guarantees, close with 1 cta',
  },
  quote: {
    purpose: 'Standalone property-size estimator. SEO-targeted to "lawn care cost" / "landscaping quote" searches.',
    allowed_types: ['hero', 'quote', 'packages', 'faq', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Estimator"), 1 quote/instant-address, 1 packages/seasonal (lighter, just the tiers without full lists), 1 faq, close with 1 cta',
  },
  projects: {
    purpose: 'Portfolio — design-builds, transformations, recurring-customer yards.',
    allowed_types: ['hero', 'before_after', 'gallery', 'testimonials', 'cta'],
    required_sequence: '1 hero/centered-stats, 1 before_after/slider (6-8 items, filterable by service type), optional 1 gallery/grid for design-build projects, optional 1 testimonials, close with 1 cta',
  },
  about: {
    purpose: 'Owner story + crew + equipment. The trust page.',
    allowed_types: ['about', 'team', 'stats', 'gallery', 'cta'],
    required_sequence: '1 about/story (owner portrait + what got them into landscaping), optional 1 stats/bar (years, properties maintained, crew size, trucks), optional 1 team/grid, optional 1 gallery/grid (the trucks, the equipment, the shop), close with 1 cta',
  },
  contact: {
    purpose: 'Conversion page for one-off jobs and questions.',
    allowed_types: ['hero', 'contact', 'reservation', 'faq'],
    required_sequence: 'optional 1 hero (short), 1 contact/form-info, optional 1 reservation/cta with heading "Or just book a time" and buttonLabel "Schedule an estimate visit" (Twomiah Bookings), optional 1 faq',
  },
} as const

// Roofing is a multi-page vertical because the conversion journey
// branches: "I had a storm" → /storm; "I want a ballpark" → /quote;
// "show me your work" → /projects. Generic 4-page doesn't fit.
const ROOFING_PAGE_RECIPES = {
  home: {
    purpose: 'Front door for a roofer. Insurance-claim positioning first, instant-quote second, trust badges third, work proof fourth.',
    allowed_types: ['hero', 'banner', 'quote', 'reservation', 'trust', 'services', 'before_after', 'stats', 'cta'],
    required_sequence: 'optional 1 banner/storm-alert at the very top if a recent storm in the service area is referenced in the intake, then 1 hero/full-bleed or hero/split (insurance-claim voice, owner-on-every-roof signal), 1 quote/instant-address (the single biggest conversion lever), 1 reservation/cta with heading "Want eyes on it?" and buttonLabel "Schedule a free inspection" (Twomiah Bookings — pairs with the instant quote for customers who want a person on the roof not a calculator), 1 trust/badges if intake supports them, 1 services/cards-grid, 1 before_after/slider (3-4 items), close with 1 cta/split',
  },
  quote: {
    purpose: 'Standalone estimator page. SEO-targeted to "roof replacement cost" / "ballpark roof estimate" searches.',
    allowed_types: ['hero', 'quote', 'financing', 'faq', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Estimator"), 1 quote/instant-address, 1 financing/calculator, 1 faq/accordion (sq-ft estimation, what the range includes, insurance overlap), close with 1 cta',
  },
  storm: {
    purpose: 'Storm-damage / insurance-claim landing page. This is where high-ticket post-event jobs come from. SEO-targeted to "hail damage roof inspection" / "storm damage insurance claim" searches.',
    allowed_types: ['hero', 'banner', 'services', 'faq', 'before_after', 'cta'],
    required_sequence: 'optional 1 banner/storm-alert (if intake supplies dates), 1 hero/full-bleed (storm-imagery hero with claim-help framing), 1 services (insurance-claim walkthrough), 1 faq about claim process (does inspection cost anything, what if my deductible is high, do you meet my adjuster on the roof), optional 1 before_after slider showing post-storm work, close with 1 cta',
  },
  about: {
    purpose: 'Owner story + team + credentials. The trust page for prospects doing due diligence.',
    allowed_types: ['about', 'team', 'stats', 'trust', 'testimonials', 'cta'],
    required_sequence: '1 about/story (owner portrait + the "why" of starting), optional 1 stats/bar (years, roofs done, crew size, owner-on-every-roof), optional 1 team/grid (the crew), optional 1 trust/badges, optional 1 testimonials block (real quotes only), close with 1 cta',
  },
  projects: {
    purpose: 'Portfolio. Before/after gallery filterable by material + city + year.',
    allowed_types: ['hero', 'before_after', 'gallery', 'testimonials', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Recent work"), 1 before_after/slider (6-10 items), optional 1 gallery/grid for project photos that aren\'t before/after, optional 1 testimonials block, close with 1 cta',
  },
  contact: {
    purpose: 'Conversion page. Form + business details + response promise.',
    allowed_types: ['hero', 'contact', 'reservation', 'faq', 'banner'],
    required_sequence: 'optional 1 banner/storm-alert if active, 1 hero (short), 1 contact/form-info, optional 1 reservation/cta with heading "Or grab a slot directly" and buttonLabel "Schedule a free inspection" (Twomiah Bookings), optional 1 faq covering pre-call questions',
  },
} as const

// Cannabis dispensaries have legal + product-discovery constraints the
// generic 4-page model can't serve. Age-gate is required on first visit
// in most states. The strain catalog IS the product — page recipe leads
// with it. Education is a strong top-funnel SEO play. Deals drive
// repeat traffic.
const DISPENSARY_PAGE_RECIPES = {
  home: {
    purpose: 'Front door for a cannabis dispensary. Age-gate first, then the strain catalog, deals, and brand. The visitor is either a regular checking deals or a new customer scoping fit.',
    allowed_types: ['age', 'hero', 'deals', 'strain', 'stats', 'cta'],
    required_sequence: '1 age/modal (legally required, first), 1 hero/full-bleed or hero/centered-stats with brand-forward copy (no "compassionate care" language — banned phrase list applies double here), 1 deals/strip (drives repeat visits), 1 strain/grid (3-6 featured items, NOT the full menu — that lives on /strains), 1 stats/bar for credibility (years in business, awards, growers partnered with), close with 1 cta',
  },
  strains: {
    purpose: 'The full filterable strain catalog. SEO gold — every strain that gets indexed is organic traffic for that strain name.',
    allowed_types: ['hero', 'strain', 'faq', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Strains"), 1 strain/grid with the full catalog, optional 1 faq about strain-type questions ("what\'s the difference between indica and sativa"), close with 1 cta',
  },
  deals: {
    purpose: 'Current promotions + loyalty signup. Highest-converting page for repeat customers.',
    allowed_types: ['hero', 'deals', 'cta'],
    required_sequence: '1 hero/centered-stats (eyebrow="Deals"), 1 deals/strip with current specials, close with 1 cta directing to loyalty signup',
  },
  about: {
    purpose: 'The brand story — founder, sourcing, what makes this dispensary different from the corporate chains down the street.',
    allowed_types: ['about', 'stats', 'gallery', 'testimonials', 'cta'],
    required_sequence: '1 about/story (founder portrait + 2-4 paragraphs about why this dispensary), optional 1 stats/bar with anchored numbers, optional 1 gallery/grid (storefront, growers visited, team), optional 1 testimonials block, close with 1 cta',
  },
  visit: {
    purpose: 'How to physically visit — address, hours, what to expect, ID requirements, parking.',
    allowed_types: ['hero', 'contact', 'faq', 'cta'],
    required_sequence: '1 hero (short, location-focused), 1 contact/form-info with address + hours + parking notes, 1 faq covering "what ID do I need", "first-time customer", "delivery options", close with 1 cta',
  },
  contact: {
    purpose: 'Catch-all contact for press, vendor offers, partnerships.',
    allowed_types: ['hero', 'contact', 'faq'],
    required_sequence: 'optional 1 hero (short), 1 contact/form-info, optional 1 faq',
  },
} as const

// Food trucks are a fundamentally different business model from generic
// services — location matters more than "services", menu is the second
// most important thing after location, social-following IS the marketing.
// Override the recipes accordingly. Selected by buildSitePrompt when
// input.businessType maps to the foodtruck vertical.
const FOODTRUCK_PAGE_RECIPES = {
  home: {
    purpose: 'Front door for a mobile food business. Answer "where are you right now" and "what do you serve" in the first three seconds.',
    allowed_types: ['hero', 'location', 'menu', 'social', 'gallery', 'cta'],
    required_sequence: '1 hero/full-bleed (truck/owner/signature dish, NOT a stock food photo), then 1 location/live-map (current address + open until + recent stops), then 1 menu/cards (3-6 signature items with price + dietary), optionally 1 social/feed or 1 gallery/grid, close with 1 cta/banner directing to catering or schedule',
  },
  menu: {
    purpose: 'The menu page. Full menu — every item, price, dietary, description. The page people land on from a "what do you serve" Google search.',
    allowed_types: ['hero', 'menu', 'gallery', 'cta'],
    required_sequence: 'optional 1 hero/centered-stats with menu-board feel (eyebrow="The menu"), 1 menu/cards with the full lineup, optional 1 gallery/grid if customer has food photos, close with 1 cta directing to catering or schedule',
  },
  about: {
    purpose: 'The owner-story page. Food truck customers want to know WHO is cooking — chef-owner background, what made them quit their day job, why this food.',
    allowed_types: ['about', 'gallery', 'testimonials', 'cta'],
    required_sequence: '1 about/story (portrait of the owner + 2-4 paragraphs of voice-of-the-chef), optional 1 gallery (in-the-kitchen / behind-the-truck shots) or 1 testimonials block, close with 1 cta',
  },
  schedule: {
    purpose: 'Where to find the truck this week + how to book private events.',
    allowed_types: ['hero', 'schedule', 'location', 'cta'],
    required_sequence: 'optional short 1 hero (eyebrow="This week"), 1 schedule/week-strip with day-by-day breakdown, optional 1 location/live-map showing current spot, close with 1 cta',
  },
  catering: {
    purpose: 'Convert private-event leads — weddings, corporate parties, birthdays. Highest-margin revenue source for most trucks.',
    allowed_types: ['hero', 'catering', 'gallery', 'faq', 'cta'],
    required_sequence: '1 hero/full-bleed (wedding or event photo), 1 catering/inquiry-form (with event date, headcount, venue type), optional 1 gallery/grid showing past events, 1 faq/accordion (lead time, headcount range, deposit), close with 1 cta',
  },
  contact: {
    purpose: 'Conversion page for the rest — questions, press, vendor offers.',
    allowed_types: ['hero', 'contact', 'social', 'faq'],
    required_sequence: 'optional 1 hero (short), 1 contact/form-info, optional 1 social/feed under the form (food truck visitors want to follow on IG), optional 1 faq',
  },
} as const

function buildSitePrompt(input: ComposerInput): string {
  const schemaSummary = Object.entries(SECTION_SCHEMA).map(([type, variants]) =>
    `  ${type}: ${Object.keys(variants).join(', ')}`
  ).join('\n')

  // Industry-specific recipe overrides. Each vertical that needs a
  // fundamentally different page model gets its own recipe set; the
  // generic 4-page PAGE_RECIPES is the fallback.
  //
  // Matching uses word boundaries (\b) so customer-typed strings like
  // "Italian restaurant" or "neighborhood cafe" still route correctly,
  // not just exact tokens like "restaurant". Ordering of the ternary
  // chain matters when a businessType contains multiple matching words:
  // the first match in the chain below wins. Place more specific verticals
  // (food truck, dispensary, vertical specialties) BEFORE more generic
  // ones (restaurant, contractor) so a "food truck catering" routes to
  // foodtruck not events.
  const businessType = input.businessType || ''
  const ft = /\b(food[_\s\-]?truck|mobile[_\s\-]?food|food[_\s\-]?cart|mobile[_\s\-]?kitchen|pop[_\s\-]?up[_\s\-]?kitchen)\b/i.test(businessType)
  const dispensary = /\b(dispensary|cannabis|cannabis[_\s\-]?retail)\b/i.test(businessType)
  const vet = /\b(vet|vets|veterinary|veterinarian|animal[_\s\-]?hospital|animal[_\s\-]?clinic|pet[_\s\-]?hospital|pet[_\s\-]?clinic|equine[_\s\-]?vet)\b/i.test(businessType)
  const rv = /\b(rv|rvs|motorhome|motor[_\s\-]?home|travel[_\s\-]?trailer|fifth[_\s\-]?wheel|camper|powersports|power[_\s\-]?sports|atv|utv|snowmobile|marine[_\s\-]?dealer|boat[_\s\-]?dealer|dealership)\b/i.test(businessType)
  const roofing = /\b(roofing|roof|roofer|storm[_\s\-]?restoration|siding[_\s\-]?roofing)\b/i.test(businessType)
  const landscaping = /\b(landscaping|lawn[_\s\-]?care|lawncare|landscape[_\s\-]?design|snow[_\s\-]?removal|tree[_\s\-]?service|arborist|hardscape)\b/i.test(businessType)
  const homecare = /\b(home[_\s\-]?care|homecare|in[_\s\-]?home[_\s\-]?care|senior[_\s\-]?care|caregiving|companion[_\s\-]?care|home[_\s\-]?health)\b/i.test(businessType)
  const fieldservice = /\b(field[_\s\-]?service|hvac|plumbing|plumber|electrical|electrician|appliance[_\s\-]?repair|cleaning|house[_\s\-]?cleaning|maid[_\s\-]?service|janitorial|commercial[_\s\-]?cleaning|pest[_\s\-]?control|exterminator|locksmith|garage[_\s\-]?door|septic|pool[_\s\-]?service|irrigation|handyman|painting|mobile[_\s\-]?detailing|mobile[_\s\-]?mechanic|pet[_\s\-]?grooming|dog[_\s\-]?walking)\b/i.test(businessType)
  const cafe = /\b(cafe|caf[eé]|coffee[_\s\-]?shop|coffeeshop|coffee[_\s\-]?house|tea[_\s\-]?room|tearoom|espresso[_\s\-]?bar|bakery[_\s\-]?caf[eé]?)\b/i.test(businessType)
  const restaurant = /\b(restaurant|bistro|gastropub|eatery|diner|pizzeria|trattoria|brasserie|taqueria|ramen[_\s\-]?shop|sushi[_\s\-]?bar)\b/i.test(businessType)
  const salon = /\b(salon|hair[_\s\-]?salon|hairdresser|barber|barbershop|nail[_\s\-]?salon|nail[_\s\-]?bar|spa|day[_\s\-]?spa|esthetician|esthetics|beauty[_\s\-]?salon|lash[_\s\-]?bar|brow[_\s\-]?bar|medspa|med[_\s\-]?spa|waxing)\b/i.test(businessType)
  const fitness = /\b(gym|fitness|fitness[_\s\-]?studio|yoga|yoga[_\s\-]?studio|pilates|pilates[_\s\-]?studio|crossfit|cross[_\s\-]?fit|boxing|boxing[_\s\-]?gym|martial[_\s\-]?arts|mma|personal[_\s\-]?training|personal[_\s\-]?trainer|spin[_\s\-]?studio|cycling[_\s\-]?studio|barre|dance[_\s\-]?studio)\b/i.test(businessType)
  const hotel = /\b(hotel|boutique[_\s\-]?hotel|b[_\s\-]?and[_\s\-]?b|b&b|bandb|bnb|bed[_\s\-]?and[_\s\-]?breakfast|inn|lodge|motel|vacation[_\s\-]?rental|short[_\s\-]?term[_\s\-]?rental|airbnb|guest[_\s\-]?house|cabin[_\s\-]?rental)\b/i.test(businessType)
  const events = /\b(event[_\s\-]?venue|wedding[_\s\-]?venue|banquet[_\s\-]?hall|banquet|venue|party[_\s\-]?venue|corporate[_\s\-]?venue|reception[_\s\-]?hall|barn[_\s\-]?venue|events)\b/i.test(businessType)
  // Contractor catches general contracting + the specific build-trade verticals.
  // Falls AFTER the others so a "kitchen" intake routes here, but a businessType
  // with the word "kitchen" in a cafe context ("kitchen cafe") routes to cafe.
  const contractor = /\b(contractor|general[_\s\-]?contractor|construction|remodeling|remodeler|siding|home[_\s\-]?improvement|kitchen|kitchen[_\s\-]?remodeling|kitchen[_\s\-]?design|kitchen[_\s\-]?installation|bath[_\s\-]?remodeling|bathroom[_\s\-]?remodeling|deck[_\s\-]?builder|fence[_\s\-]?installation|drywall|flooring|framing|concrete|masonry|tile[_\s\-]?installer|cabinet[_\s\-]?maker)\b/i.test(businessType)
  const recipes: Record<string, { purpose: string; allowed_types: readonly string[]; required_sequence: string }> = ft
    ? FOODTRUCK_PAGE_RECIPES
    : vet
      ? VET_PAGE_RECIPES
      : rv
        ? RV_PAGE_RECIPES
        : dispensary
      ? DISPENSARY_PAGE_RECIPES
      : roofing
        ? ROOFING_PAGE_RECIPES
        : landscaping
          ? LANDSCAPING_PAGE_RECIPES
          : homecare
            ? HOMECARE_PAGE_RECIPES
            : fieldservice
              ? FIELDSERVICE_PAGE_RECIPES
              : cafe
                ? CAFE_PAGE_RECIPES
                : restaurant
                  ? RESTAURANT_PAGE_RECIPES
                  : salon
                    ? SALON_PAGE_RECIPES
                    : fitness
                      ? FITNESS_PAGE_RECIPES
                      : hotel
                        ? HOTEL_PAGE_RECIPES
                        : events
                          ? EVENTS_PAGE_RECIPES
                          : contractor
                            ? CONTRACTOR_PAGE_RECIPES
                            : PAGE_RECIPES

  const recipesSummary = Object.entries(recipes).map(([page, recipe]) =>
    `- ${page}: ${recipe.purpose}\n    allowed types: ${recipe.allowed_types.join(', ')}\n    sequence: ${recipe.required_sequence}`
  ).join('\n')

  const feedbackBlock = (input.feedbackHistory && input.feedbackHistory.length > 0)
    ? `\n# Prior customer feedback — ACT ON ALL OF IT\n` +
      `The customer has already reviewed previous draft(s) and asked for these changes. ` +
      `Treat each as a hard requirement. If two pieces of feedback conflict, take the most recent.\n\n` +
      input.feedbackHistory.map((m, i) => `[${i + 1}] ${m}`).join('\n\n') +
      `\n`
    : ''

  // Three-tier photo preference: customer-supplied (authentic to THIS
  // business) → licensed stock (Unsplash+ for this business type) →
  // generic Unsplash placeholders from the prompt's example URLs.
  const customerList = (input.customerPhotos || []).slice(0, 30)
  const stockList = (input.stockPhotos || []).slice(0, 30)

  let photosSection = ''
  if (customerList.length > 0) {
    photosSection += `\n# Tier 1 — Customer-supplied photos (USE THESE FIRST — authentic to this business)\n` +
      customerList.map((p, i) =>
        `C${i + 1}. ${p.url}${p.tag ? '  [tag: ' + p.tag + ']' : ''}${p.alt ? '  [alt: ' + p.alt + ']' : ''}`
      ).join('\n') + '\n'
  }
  if (stockList.length > 0) {
    photosSection += `\n# Tier 2 — Licensed stock photos (use when no Tier 1 photo fits)\n` +
      stockList.map((p, i) =>
        `S${i + 1}. ${p.url}${p.tag ? '  [tag: ' + p.tag + ']' : ''}${p.alt ? '  [alt: ' + p.alt + ']' : ''}`
      ).join('\n') + '\n'
  }
  // Tier 3 — curated self-hosted library (verified by eye; heroLibrary.ts).
  const libraryList = getHeroLibrary(input.businessType).slice(0, 30)
  if (libraryList.length > 0) {
    photosSection += `\n# Tier 3 — Curated library (pre-vetted for this trade; always safe)\n` +
      libraryList.map((p, i) => `L${i + 1}. ${p.url}  [tag: ${p.tag}]`).join('\n') + '\n'
  }
  if (photosSection) {
    photosSection += `\nRules for the photo tiers:\n` +
      `- Tier 1 (customer photos) ALWAYS beats Tier 2 (stock) when one fits the slot.\n` +
      `- Tier 2 (stock) ALWAYS beats the hardcoded Unsplash example URLs below.\n` +
      `- Match tags to section context: 'hero' tag for hero sections, 'team' for team/grid members, 'services' for service item images.\n` +
      `- Never reuse the same photo across two sections on the same page unless unavoidable.\n` +
      (libraryList.length > 0
        ? `- Use ONLY photo URLs from the tiers above. NEVER invent, modify, or recall image URLs from memory.\n`
        : `- Only fall back to the example URLs in rule 4 below if the photo tiers are exhausted.\n`)
  }

  return `You are composing a multi-page website for ${input.businessName} — a ${input.businessType} in ${[input.city, input.state].filter(Boolean).join(', ') || 'the region they serve'}.
${feedbackBlock}
About the business
${input.description ? '"' + input.description + '"' : '(no description provided)'}

Services they offer
${(input.services || []).map(s => '- ' + s).join('\n') || '(none specified)'}

Their goals
${(input.goals || []).map(g => '- ' + g).join('\n') || '(none specified)'}

Owner / principal
${input.ownerName || '(not specified)'}

Phone: ${input.phone || ''}
Email: ${input.email || ''}
Service area: ${[input.city, ...(input.nearbyCities || [])].filter(Boolean).join(', ')}
${photosSection}
${restaurant ? `
# Industry note — RESTAURANT (sit-down, dinner-focused)
This is a sit-down restaurant. Guidance:

1. Reservation widget is the conversion engine — reservation/widget
   above-the-fold on home page is mandatory unless the intake says
   they're walk-in-only.
2. Hero takes a position about THIS restaurant. Anchor in a real fact
   from the intake: seat count, chef name + background, signature dish,
   sourcing, year founded, neighborhood. Pattern reference:
   "Five courses. One chef. The whole room hears the kitchen." (28-seat
   tasting-menu spot)
   "Wood-fired Neapolitan and three natural wines on tap." (pizzeria)
   "Chef Anika cooks for 28 people a night. Reservations open four
   weeks ahead." (small fine-dining)
3. Banned phrases (in addition to the global list, this vertical gets
   the harshest treatment): "farm-to-table experience", "culinary
   journey", "elevated dining", "celebrating local ingredients",
   "passionate about food", "your destination for fine dining",
   "tastebuds will dance", "where flavor meets tradition", "premier
   dining destination", "exceptional dining experience". These read
   as small-business marketing-speak. Better: name the producer,
   describe ONE specific dish, take a position about how dinner
   actually works ("five courses, one seating, no menu — chef cooks
   what's good that day").
4. menu/cards on home shows 4-8 SIGNATURE items, not the full menu
   (that lives on /menu). Each item has the actual name, the actual
   price, a one-sentence description with sensory detail, and dietary
   tags. Realistic 2026 dinner pricing: small plates $12-22, mains
   $24-48, tasting menu $85-150.
5. Tonight's specials uses deals/strip retitled — "Tonight" or "This
   week" — for daily-changing items. Only include if the intake
   suggests they do specials.
6. Chef-driven about/story matters more here than almost anywhere
   else. The "why this restaurant" is almost always the chef's
   biography. Pull from intake fields ownerName + description.
7. Photography: hero should be either a signature dish, the dining
   room at golden hour, or the chef in motion. NOT a generic plate
   of pasta. If customerPhotos has dishes, use those over Unsplash.
8. Private dining is a high-margin page when the intake mentions
   buyouts, private events, holiday parties — use the
   /private-dining page recipe.
` : ''}${cafe ? `
# Industry note — CAFE (coffee shop, tea room, neighborhood café)
This is a walk-in café. Guidance:

1. NO reservation widget. Cafes are walk-in. The conversion goal is
   "come visit + try our [feature drink]" — not a booking.
2. Hero takes a position about THIS café. Anchor in a real fact from
   the intake: roaster, baker, neighborhood, signature drink, year
   founded, atmosphere. Patterns:
   "We roast 5 kg every Tuesday on a Diedrich. The Ethiopian Yirgacheffe
   sells out by Saturday." (in-house roaster)
   "Twelve seats, one espresso machine, every drink poured by the
   owner." (owner-operator espresso bar)
   "Sourdough morning bun. Cardamom roll. Hand-rolled at 4am, gone
   by 11." (bakery-café)
3. Banned phrases (in addition to the global list): "your neighborhood
   coffee experience", "premium coffee", "artisan blend", "passion for
   coffee", "perfectly crafted", "exceptional brew", "your daily ritual",
   "third place", "café experience", "where coffee lovers gather". This
   vocabulary signals corporate-clone. Replace with the actual roaster
   name, the actual bean origin, the actual baker's name, the specific
   pastry that sells out first.
4. menu/cards on home shows 4-8 SIGNATURE items, not the full menu (that
   lives on /menu). Each item: actual name (Cortado, Iced Honey Latte,
   Cardamom Bun), actual price, one-sentence description with sensory
   detail. Realistic 2026 café pricing: espresso $3.50-4, cortado
   $4.50-5, latte $5.50-6.50, drip $3.50-4.50, pour-over $5-7,
   pastries $4-6, breakfast sandwich $9-13, bowls $13-17.
5. "Today" specials uses deals/strip retitled — daily-rotating items.
   Only include if the intake suggests they rotate (seasonal lattes,
   daily pastry, soup of the day).
6. Founder/roaster/baker about/story matters. The "why this café" is
   usually the founder's biography or the bean-sourcing story. Pull
   from intake fields ownerName + description.
7. Photography: hero should be latte art close-up, the interior at
   golden hour, the espresso machine in action, or pastries cooling.
   NOT a generic coffee-cup-on-saucer. If customerPhotos has drinks
   or interior shots, use those over Unsplash.
8. Visit page is the conversion page — not "contact". Lead with
   hours and address. faq covers wifi, outlets, laptop policy,
   dog-friendly, parking, accessibility, kid-friendly. These are
   the actual questions customers ask before deciding to drive over.
` : ''}${salon ? `
# Industry note — SALON / SPA / BARBER / NAILS / ESTHETICIAN
This is a salon, spa, barbershop, nail salon, or beauty service business.
The conversion engine is online booking.

1. reservation/widget (Twomiah Bookings) above-the-fold on home page is
   mandatory. Salons live or die on online booking — every minute the
   chair is empty is unrecoverable. Lead with booking, services second.
   The widget's DEFAULTS are restaurant vocabulary — a salon MUST override:
   submitLabel: "Book my appointment" (or "Book my cut" for barbers),
   partySizes: [1, 2, 3] with guestNoun: "person" and guestNounPlural:
   "people" (two separate PLAIN STRING props — never an object), and times as
   24h "HH:MM" strings covering the salon's actual open hours (e.g.
   ["09:00","10:00",...,"17:00"]), defaultTime mid-morning. NEVER let
   "Find a table" or dinner-hour slots render on a salon.
2. Hero takes a position about THIS salon. Anchor in a real fact:
   specialty (balayage, curl, low-maintenance color, men's grooming,
   bridal), education (Vidal Sassoon, Bumble + bumble University,
   apprenticed under [name]), brands carried, stylist count, year founded.
   Patterns:
   "Specialists in lived-in color. We don't do solid black or platinum.
   We do everything in between." (color-specialist salon)
   "Eight chairs. Bumble + bumble exclusive. Walk-ins for cuts, color
   by appointment." (specialty boutique)
   "Master barber + apprentice. Straight razor every cut. $50 includes
   the hot towel." (classic barber)
3. Banned phrases (in addition to global list): "your beauty destination",
   "where beauty meets art", "passion for beauty", "let our talented
   team", "transform your look", "indulge yourself", "premier salon",
   "we pride ourselves", "luxurious experience", "boutique experience".
   These read as small-business marketing-speak. Better: name the brand
   they carry, the technique they specialize in, the actual price.
4. services/cards-grid with REAL prices. Realistic 2026 pricing ranges:
   women's cut $55-110, men's cut $35-65, root retouch $80-130, balayage
   $180-380, full color $120-220, blowout $40-65, gel manicure $40-65,
   regular manicure $25-40, pedicure $45-75, facials $85-180, brows
   $25-50, lash extensions $150-300 (full set), waxing $20-80 per area.
   Higher in major metros. NEVER fabricate exact numbers if intake gave
   ranges; pick from the realistic range and label "starting at".
5. team/grid is conversion-critical. Each stylist should have a per-stylist
   booking link if the intake suggests they take their own clients.
   Specialties matter: "balayage + curl", "men's classic + skin fades",
   "color correction + corrective", "bridal + special occasion".
6. gallery/grid: 12-30 shots of ACTUAL work — finished color, finished
   cuts, nail sets, lash sets, finished brows. NOT stock models. If
   customerPhotos has finished-work shots, those are tier-1 always.
   This is the "can they do what I want" page.
7. Cancellation/no-show policy in services FAQ — be direct. Industry
   standard: 24-48h cancellation, 50-100% charge for no-show. State
   the actual policy from the intake or use industry-standard 48h/50%.
8. Hair-history disclosure FAQ for color clients — protect both parties.
   "Box dye, henna, or smoothing treatments in the last 18 months?
   Tell us during consultation."
` : ''}${fitness ? `
# Industry note — FITNESS (gym / studio / personal training / yoga / CrossFit)
This is a fitness facility. Class schedule, intro offer, trainer
profiles, transformation gallery. Twomiah Bookings powers class signups
and PT sessions.

1. Read the intake first to identify the modality:
   A. **Group class studio** (yoga, pilates, CrossFit, spin, boxing,
      barre) — schedule is the conversion engine. Lead with schedule
      + intro offer ($30 first week, free first class, etc.).
   B. **Open gym + classes** (CrossFit boxes, hybrid gyms) — emphasize
      the community + coaches + class types.
   C. **Personal training only** — lead with trainer profiles + assessment
      consult booking. Skip schedule/week-strip.
2. Hero takes a position. Patterns:
   "Five-class week, 28 minute strength sessions. We don't do 90-minute
   workouts." (Hour-conscious busy adults)
   "Vinyasa, slow flow, restorative. Hot in the back room, room temp
   in the front." (yoga studio with multiple modalities)
   "We coach lifters. Forty members. Coaches programmed your last
   meet." (powerlifting-focused gym)
3. Banned phrases (in addition to global list): "your fitness journey",
   "transform your body", "results-driven training", "premier gym",
   "unleash your potential", "no excuses", "fitness lifestyle",
   "best version of yourself", "passion for fitness", "elite training".
   This vocabulary is bootcamp-2014 cliché. Better: state who you
   coach, what programming you actually do, what makes the room
   different from a Planet Fitness.
4. Intro offer is critical — most gyms convert 60-80% of intro-week
   trials into members if the offer is real. "First week free", "30
   days for $30", "first class on us" — pull from intake or use
   industry-standard for the modality.
5. schedule/week-strip: real classes, real times, real instructors.
   Pull from intake if provided. Day labels Mon-Sun. Time + class
   name + instructor + level. Boxes that conflict (two studios) need
   room labels.
6. Pricing transparency: drop-in ($20-35), 10-pack ($150-280), monthly
   unlimited ($120-220), annual ($1100-2000), PT package (8 sessions:
   $400-800). NEVER fabricate prices the intake doesn't give.
7. Trainer/coach profiles drive trust + PT bookings. Real certs:
   NSCA, NASM, ACE, CrossFit L2, RRCA, RYT-200, RYT-500. NEVER
   fabricate certs the intake doesn't mention.
8. Transformation gallery — if intake provided member success stories
   or photos, use them (with permission noted in intake). Otherwise
   skip — stock-model transformation photos hurt trust.
` : ''}${hotel ? `
# Industry note — HOTEL / B&B / INN / VACATION RENTAL
This is a lodging business. Booking engine + rooms catalog + amenities
+ local area. Decision-makers are usually skimming 4-6 options on a
travel site — concrete signals beat aspirational copy.

1. reservation/widget above-the-fold on home page is the primary
   conversion. If the intake says they use a specific booking engine
   (Cloudbeds, Mews, Hostfully, Airbnb), use Twomiah Bookings as a
   pre-screening inquiry that hands off, OR direct-deep-link to the
   booking engine. NEVER replace a working booking engine.
2. Hero takes a position. Patterns:
   "Six rooms. Built 1898. Kitchen-table breakfast at 8am sharp."
   (small B&B, historical)
   "Sleeps fourteen, lake-facing, four kayaks at the dock."
   (vacation rental cabin)
   "Twelve rooms, four blocks from downtown, all on the ground floor.
   Continental breakfast included, parking included, no resort fees."
   (boutique downtown hotel)
3. Banned phrases (in addition to global list): "your home away from
   home", "unforgettable experience", "luxury accommodations", "perfect
   getaway", "where memories are made", "exceptional stay", "your
   destination for", "indulge in", "warm hospitality", "boutique
   experience". Replace with: actual rooms count, actual rate range,
   actual amenities the property offers, actual distance to the
   landmark guests are coming for.
4. services/cards-grid for rooms — each room: name, photos (real, not
   stock), bed configuration, sleeps, room size, amenities (private
   bath, fireplace, view, kitchenette), rate "from $X" or "from $X/night".
   Realistic 2026 pricing: economy hotel $90-150, mid-tier $130-220,
   boutique $180-380, B&B $130-250, luxury inn $280-600, vacation
   rental varies wildly by location.
5. Amenities page: be specific. NOT "all the comforts of home". Yes:
   "Heated saltwater pool, May-October, 7am-10pm. Towels at the front
   desk." Photo of the actual pool. If intake doesn't mention an
   amenity, don't list it.
6. Local area page is undervalued — it's a major differentiator for
   small properties. Distance to landmarks (the lake, the town,
   the trailhead, the venue), 3-8 restaurant recommendations the
   innkeeper actually eats at, day-trip options. SEO bonus.
7. faq/accordion on rooms page: check-in/out times, dog policy
   (specific: "two dogs under 40lb, $30/night/dog"), parking
   (free/paid/street), breakfast (included/extra/none), kid policy,
   accessibility (specific: "elevator to floors 2-3, all rooms on 1
   have step-in showers").
8. Testimonials only from real guests. Pull recent ones from the
   intake. NEVER fabricate. "Recent guest, Eau Claire, MN — May 2026."
` : ''}${events ? `
# Industry note — EVENTS / WEDDING VENUE / BANQUET HALL
This is an events venue. Bookings happen via inquiry + consultation,
not real-time widget. Most weddings + corporate events require a
walk-through. Use catering/inquiry-form as the conversion engine.

1. catering/inquiry-form on home + packages + gallery pages is
   mandatory. Fields: event date (date picker, or "still flexible"),
   headcount range, event type (wedding, corporate, anniversary, etc.),
   budget range, name, email, phone. Optional: preferred contact method,
   how they heard about you.
2. Hero takes a position. Patterns:
   "Eighteenth-century barn, 200-guest capacity, on-site ceremony
   meadow. Two weddings a weekend, May through October."
   (rustic barn venue)
   "Eight thousand square feet, glass front, downtown Eau Claire.
   Corporate by day, weddings on weekends."
   (urban modern venue)
   "Six-acre garden, three ceremony sites depending on weather,
   protected pavilion for receptions to 175."
   (garden venue)
3. Banned phrases (in addition to global list): "your dream wedding",
   "the wedding of your dreams", "your perfect day", "magical
   celebration", "where dreams come true", "unforgettable memories",
   "your special day", "passionate about events", "let us help you
   create", "elegant venue". These read as wedding-vendor-2010 cliché.
   Replace with: actual capacity, actual rental cost, actual included
   amenities, actual restrictions (vendor list? alcohol? sound limits?
   ceremony rain plan?).
4. services/alternating for packages — each tier: name, included hours,
   capacity, included amenities (tables, chairs, linens, AV, kitchen
   access), what's NOT included (catering, alcohol, flowers), starting
   price. Realistic 2026 venue pricing for the Midwest: small (50-100
   guests) $2500-6000 rental, mid (100-200 guests) $5000-12000, large
   (200+ guests) $10000-25000. Major-metro venues 2-4x higher.
5. gallery/grid is critical — actual events, not styled-shoot photos.
   Real couples, real receptions, real decor. If intake has photos
   from past events (always ask), those beat stock every time. 30-50
   shots organized by space + event type.
6. vendors page is undervalued — adds value to couples + can earn
   referral fees. Categorized list (caterers, florists, photographers,
   DJs, planners, officiants, transportation) with name + contact +
   one-line why-we-recommend.
7. faq is critical at this price point. Cover: vendor restrictions
   (open list, closed list, in-house?), alcohol (BYOB? bar service
   required?), sound limits, ceremony rain plan, parking capacity,
   accessibility, getting-ready spaces, payment schedule (typical:
   25% deposit at signing, 50% 90-days-out, 25% 30-days-out),
   cancellation policy, weather policy for outdoor events.
8. Testimonials from real couples + planners. Couple names + wedding
   month. Planner names + their company. NEVER fabricate. If intake
   provided reviews, use those. If not, omit the testimonials block.
` : ''}${contractor ? `
# Industry note — CONTRACTOR (general / remodeling / kitchen / bath / build trades)
This is a contracting business. Portfolio is the conversion engine —
homeowners want to see WORK, not read about a "passion for quality."
The decision-maker is usually doing a $20k-$200k+ project and is
pattern-matching across 3-5 contractors before requesting an estimate.

1. Hero takes a position about THIS contractor. Anchor in a real fact:
   specialty (kitchens only, full builds, historic restoration,
   high-end finish carpentry, ADU specialists), trade pedigree (third-
   generation, apprenticed under [name], custom-cabinet shop in-house),
   geographic focus, year founded, license held.
   Patterns:
   "Twenty-six years of kitchens. We do six a year. Our own millwork shop."
   (high-end kitchen specialist)
   "Family-owned since 1987. Decks, additions, garages — the projects
   most contractors don't return calls for." (mid-tier generalist)
   "Master carpenter + lead PM. Two crews. We pull every permit, every
   time." (mid-size operator)
2. Banned phrases (in addition to global list): "quality craftsmanship",
   "your trusted contractor", "we take pride", "exceeding expectations",
   "from concept to completion", "your dream home", "passion for the
   craft", "your one-stop construction partner", "we treat your home
   like our own", "second to none". These signal small-business
   marketing-speak. Replace with: name the project type, name the
   neighborhood you work in, name the specific subcontractor you
   work with (cabinetmaker, electrician, etc.), state the actual
   project minimum or scope.
3. gallery/grid is the most important section on the site. 8-12 shots
   on home, 20-40 on /projects. ALWAYS prefer Tier 1 customer photos
   (real finished work). If forced to use stock, pick photos that
   genuinely look like "a contractor took this on their jobsite" not
   "Home & Garden magazine cover." Caption each project with: location
   (neighborhood-level, NOT exact address — privacy), project type,
   scope, finishes used, project length.
4. services/cards-grid: 3-6 specialties. Each item: actual name
   (Kitchen Remodels, Full-Home Additions, Custom Decks), one-sentence
   scope description, typical price range or "starting at" if intake
   gives ranges, photo of a finished project. Realistic 2026 ranges
   for the Midwest: kitchen remodel $35k-150k (full $75k-300k+),
   bath remodel $18k-60k (master $40k-120k+), deck $8k-35k, ADU/in-law
   suite $90k-250k, addition $50k-300k, full custom home $400k-2M+.
5. Trust signals matter. If intake provides license number, BBB rating,
   years in business, projects/year, list them in stats/bar or about/story.
   NEVER fabricate a license number. NEVER fabricate BBB rating.
   If the intake doesn't provide them, omit and lean on years +
   testimonials.
6. testimonials only from real homeowners. Pull from intake. Real
   names + neighborhoods + project types ("Kitchen remodel, Eau Claire
   eastside, 2024"). If intake doesn't provide any, OMIT the block —
   don't fabricate.
7. Photography: hero should be a finished project at golden hour, an
   in-progress build at scale, or owner-on-jobsite-with-clipboard.
   NOT a generic tools-on-tool-bag or hammer-on-wood. If customerPhotos
   has jobsite/finished photos, those beat Unsplash every time.
8. FAQ must cover: estimate process (free? in-home? virtual?), lead
   time (current — pull from intake if given, otherwise omit the
   specific number), permits (who pulls them — answer is "we do" for
   licensed contractors), financing (if intake mentions options),
   project minimum (a lot of contractors won't do <$15k jobs — be
   upfront if applicable).
` : ''}${fieldservice ? `
# Industry note — FIELD SERVICE (HVAC / plumbing / electrical / cleaning)
The work model varies within this template. Read the intake first:

A. **HVAC / plumbing / drain / leak / no-hot-water** — emergency-first.
   - Hero takes a position on availability: "We pick up at 2am. The
     other guys don't." or "Same-day if you call before 3, even on a
     Sunday." NOT "Premier HVAC service" (banned).
   - emergency/bar at top of home page is mandatory if intake says 24/7.
   - service_area/zip-check at hero — answer "do you even come to me"
     in one click.
   - Voice example: "Furnace out? You're talking to a Master Mechanic in
     the next 20 minutes, not a dispatcher. We have parts trucks in
     three towns." Specific. No marketing-speak.

B. **Electrical** — licensed-safety voice (vs emergency-first).
   - Hero: "Master Electrician on every job, written panel diagrams,
     all permits pulled." Trust + competence over availability.
   - Emergency bar still valuable (no-power-after-storm calls) but
     less central than for HVAC/plumbing.

C. **Cleaning (residential / commercial / janitorial)** — recurring,
   not emergency. Skip emergency/bar. Lead the home page with
   services/alternating describing the recurring service tiers (weekly,
   bi-weekly, monthly). Voice example: "Same two cleaners every visit.
   Your house, your products if you want, our products if you don't."

D. **Cross-vertical (pest control, locksmith, garage door, handyman,
   septic, pool, irrigation, painting, mobile detailing, etc.)** —
   if same-day matters, treat like HVAC. If recurring, treat like
   cleaning. Use the intake to decide.

Universal rules across this template:
1. Banned phrases (in addition to global list): "premier HVAC service",
   "trusted plumbers", "your trusted electrician", "complete plumbing
   solutions", "from diagnosis to installation", "quality service you
   can trust", "your one-stop shop". Generic interchangeable language.
2. pricing/flat-rate-menu: include realistic 2026 Midwest pricing.
   Drain clear main line: $250-350. Water heater install (40-gal gas):
   $1500-2200 starting. Furnace install (residential 80%): $4500-7000.
   AC install (3-ton): $4500-8000. Panel upgrade (200A): $2500-4500.
   Toilet install: $250-400 labor. NEVER fabricate exact numbers if the
   intake gives them; otherwise pick from the range and label "starting at".
3. service_area/zip-check: pull the ZIP list from the intake's
   serviceAreas + nearbyCities. If the intake gives city names but not
   ZIPs, the renderer can match on city — you just need to populate
   serviceZips with at least the city center ZIPs you know (Wisconsin
   examples: Eau Claire 54701-54703, Madison 53703-53719, Milwaukee
   53201-53259). It's fine to err on broader inclusion.
4. NEVER fabricate Master license numbers, BBB years, or certifications
   the intake doesn't mention.
5. After-hours pulse on emergency/bar is automatic — just provide
   businessHours like "7am-7pm". The renderer handles the rest.
` : ''}${homecare ? `
# Industry note — HOME CARE AGENCY
This is an in-home senior care agency. The decision-maker audience is
adult children 45-70 years old researching care for an aging parent.
Treat them as such: empathetic, but concrete and respectful — they're
exhausted, scared, and pattern-matching for whether you're trustworthy.

1. Hero copy is the most important sentence on the site. Specific
   reassurance beats emotional poetry every time. Pattern: take a
   concrete position, anchor in a fact from the intake.
   Good: "We've been the morning shift for 12 Eau Claire families
   since 2019. Same caregiver every visit."
   Bad: "Compassionate care that keeps families together" (banned).
   Bad: "Your trusted partner in caring for your loved one" (banned).
2. trust/badges with concrete signals only — state license number,
   bonded/insured statement, BBB rating, years in business, owner
   name. NEVER fabricate a license number. If the intake doesn't
   provide one, omit the badge and lean on years + bonded/insured.
3. care/finder on the home page is the conversion engine. It MUST be
   on the home page (after hero + trust). Customize the relationships,
   careTypes, and hoursOptions to match what the intake says they
   actually offer — don't list dementia care if they don't do dementia.
4. caregivers/grid: 3-4 sample profiles on home, 6-12 on /caregivers.
   First-name only OR composite/anonymized names ("Maria, an 8-year
   CNA"). Real-sounding specialties: dementia, hospice/end-of-life,
   companion, post-surgical recovery, fall-risk reduction. Languages
   if intake mentions multilingual staff. Include realistic blurbs:
   "Specializes in afternoon sundowning support and gentle redirection."
   Use stock professional headshots (warm, smiling, older-skewing).
5. coverage/insurance-guide on /coverage: Medicare (does NOT cover
   non-medical home care — critical to clarify, this is the #1
   confused-customer search), Medicaid (state-specific waiver
   programs), VA Aid & Attendance (for veterans), LTC insurance
   (private), private pay. Each card explains eligibility, what's
   actually covered, how to apply, and the agency's role.
6. Banned phrases (in addition to the global list, with extra emphasis):
   "compassionate care", "loving care", "care you can trust", "second
   family", "tender", "passionate about helping", "make a difference
   in their life". These read as marketing-speak to exhausted family
   decision-makers. Use specific: "Same two caregivers rotate the
   morning shift for your parent — no surprise faces", "8-hour minimum
   visit so we can actually finish what we start".
7. Tone is empathetic but ADULT. Not maudlin. Not over-friendly.
   Like an experienced nurse who's been doing this for 20 years and
   has seen everything.
8. NO autoplay video. NO bright accent colors. NO motion that goes
   faster than 280ms per transition. The renderer will enforce
   prefers-reduced-motion + AAA contrast — the content should match.
` : ''}${landscaping ? `
# Industry note — LANDSCAPING / LAWN CARE / SNOW
This is a landscaping / lawn-care / snow-removal business. Guidance:

1. Recurring service is the business model. The site should sell the
   SUBSCRIPTION (weekly mow contract, monthly maintenance, seasonal
   plow contract), NOT one-off jobs. packages/seasonal is on the home
   page after the hero. Each tier has a price-per-month, what's included,
   and a season tag (spring-fall / winter / year-round).
2. Realistic 2026 pricing for the Midwest: weekly mow + trim $35-60
   per visit for a quarter-acre lot ($140-240/mo), full maintenance
   (mow + bed weeding + bush trim + spring/fall cleanup) $80-150/visit.
   Snow contracts $250-450/mo for residential, depending on push trigger
   depth. Annual landscape design $3k-15k.
3. Property-quote uses square FOOT of lawn (not roof). pricePerSqFt
   for mow contracts: $0.04-0.10 / sq ft of turf. The customer types
   their lot size or address, gets a per-visit + monthly range.
4. Banned phrases: "your trusted landscaping partner", "premier lawn
   care", "complete lawn solutions", "quality lawn care you can trust".
   Use specifics: "Same crew every week — you'll know their names by
   July", "Weekly mow starts $145/mo on quarter-acre lots", "Snow
   contracts include 1 truck + 1 walker + salt walkways".
5. Seasonal awareness: if intake mentions snow removal, the home page
   should default the seasonal-packages highlight to winter from
   October through March. If the intake is mow + maintenance only,
   default to weekly tier from April through September. The renderer
   handles this automatically — composer just needs to make sure the
   intake's services are reflected in tiers.
6. Before/after: lawn-care doesn't have dramatic transformations in the
   weekly-mow business, BUT spring cleanup and design-build projects
   do. Use before/after items for cleanup/design pages, not for routine
   maintenance.
` : ''}${roofing ? `
# Industry note — ROOFING CONTRACTOR
This is a residential roofing business. Industry-specific guidance:

1. Insurance-claim posture is the dominant frame. Most high-ticket roofing
   work is post-event hail/wind damage paid by the homeowner's insurance.
   The headline should reflect this. Best-pattern reference:
   "After the hail, you call your insurer. Then you call <Owner>." NOT
   "Trusted roofing experts" or "Complete roofing solutions."
2. quote/instant-address goes on the home page above-the-fold (after the
   hero). It is the SINGLE biggest conversion lever in this vertical.
   Set pricePerSqFt to a realistic regional number ($4.50-7.50/sq ft is
   typical for asphalt shingle in 2026; metal $9-14; tile $15-25).
3. Lead with owner-on-every-roof as a trust signal if the intake supports
   it. Most independent roofers compete with bigger franchises by being
   the one who actually shows up.
4. Banned phrases for this vertical (in addition to the global list):
   "premier roofing experts", "trusted roofing professionals", "complete
   roofing solutions", "your trusted roofing partner", "from inspection
   to installation", "quality you can trust". Use specific language
   instead: "GAF Master Elite installer since 2014", "owner walks every
   roof with your adjuster", "we work to the insurance company's spec,
   not above and not below."
5. Storm landing page (/storm) is SEO gold — geotargeted to recent
   hail/wind events in the service area. If the intake mentions specific
   storm dates or recent events, include a banner/storm-alert on the
   home page and /storm pages with the date and inspection offer.
6. Financing: include financing/calculator only if the intake indicates
   they actually offer financing. Don't fabricate a financing program
   that doesn't exist. The widget is a marketing tool — the actual
   financing is a side deal the customer arranges with their lender.
7. before_after/slider: include 3-6 items on /projects, 3-4 on home.
   Use realistic Wisconsin/Midwest cities, GAF Timberline HDZ as a
   common shingle product if material isn't specified, real years in
   the 2022-2025 range.
8. trust/badges: ONLY include badges the intake actually mentions
   (GAF Master Elite, Owens Corning Preferred Contractor, CertainTeed
   SELECT ShingleMaster, BBB rating). Never fabricate credentials.
` : ''}${dispensary ? `
# Industry note — CANNABIS DISPENSARY
This is a cannabis dispensary. Industry-specific guidance:

1. Age-gate the home page. Include an age/modal section as the FIRST section
   of the home page. gateAge is 21 in adult-use states, 18 in some medical-only
   states. Don't editorialize the gate copy — keep it short and legally clean.
2. The strain catalog IS the product. Lead the home page with a featured
   strain/grid (3-6 items), then push customers to /strains for the full
   filterable catalog. Each strain has a real name (Blue Dream, Wedding Cake,
   GG4, etc.), realistic THC% (typically 16-28% for flower), CBD% if relevant,
   indica/sativa/hybrid, top 2-3 effects, top 2 terpenes (myrcene, limonene,
   pinene, caryophyllene, linalool, terpinolene), and a believable price
   (eighth: $25-65 depending on tier).
3. NEVER fabricate exact potency numbers. Use realistic ranges and round to
   whole percents. If the intake doesn't supply specific products, generate
   plausible strain names + realistic numbers but make clear via copy these
   are sample strains.
4. Voice — banned phrases for this vertical (in addition to the global ones):
   "elevated cannabis experience", "compassionate care" (used by many but
   reads like home-health language), "premier dispensary", "top-shelf",
   "curated for connoisseurs", "ultra-premium". Use specific language:
   "Michigan-grown indoor flower from 4 farms within 60 miles", "small-batch
   live rosin pressed in-house", "no-pesticide flower certified by third-party lab."
5. Deals strip on home page is mandatory if dispensary mentions any daily/
   weekly specials. Pattern: "Wax Wednesday", "Senior Sundays", "Industry
   Mondays", "First-time customer 20% off". The strip is high-frequency
   change content — it's what brings regulars back.
6. Stats/bar should anchor real numbers if the intake supports them: years
   in business, awards, partner growers, lab-test pass rate. Don't fabricate.
7. SEO play: include 2-3 strain-education FAQ items even if not requested
   ("what's the difference between indica and sativa", "how is THC different
   from CBD", "how do terpenes affect the experience"). These bring top-
   funnel organic search.
` : ''}${ft ? `
# Industry note — FOOD TRUCK
This is a food truck (mobile food business). The customer journey is different
from a generic service business:

1. The single biggest question a visitor has is "where can I find you?". Answer
   that first. The home page leads with location, not "services."
2. The second biggest question is "what do you serve?". Menu is prominent —
   not buried inside a "services" section. Use the menu/cards section type,
   not services/cards-grid. Items have NAMES, PRICES, DESCRIPTIONS, DIETARY
   TAGS (GF / V / DF / contains nut / spicy) — show all of them.
3. Catering / private events / weddings are typically the highest-margin
   revenue. Surface a catering page with its own inquiry form (catering/inquiry-form,
   NOT contact/form-info — they collect different fields). Mention typical
   lead time, headcount range, deposit posture.
4. Social media — especially Instagram — IS the marketing for most trucks.
   If the intake mentions IG or describes regular posting, include a social/feed
   section. Use the handle the intake gives you (otherwise omit).
5. The truck's voice is the chef-owner's voice. Specific, sensory, no
   marketing-speak. "Five dollar tacos. Three kinds. Tuesdays at the brewery."
   NOT "Premier mobile dining experience." Stats anchored in real facts from
   the intake (years on the road, items on the menu, days/week active).
6. If the intake hints at a wedding focus (mentions weddings, catering,
   private events as primary revenue), the catering page is the most important
   page after home. Lead with availability + date + headcount form.
7. If the intake hints at a market focus (farmers markets, brewery residencies,
   regular spots), the schedule page is most important after home. Lead with
   this-week schedule.
` : ''}

# Your job
Compose ${Object.keys(recipes).length} pages: ${Object.keys(recipes).join(', ')}. Each page is its own ordered list of sections.

# Available section types and variants

${schemaSummary}

# Page recipes (what each page is for, what it should contain)

${recipesSummary}

# Hard rules
1. Use only the section types listed in each page's allowed_types.
2. Write copy that reflects THIS specific business — pull details from the description, services, goals. No generic boilerplate.
3. The pages should feel like one coherent site — same voice, same level of formality, narrative continuity across every page.
4. Photos: if a PHOTOS section is provided above, use ONLY those URLs. Otherwise use https://images.unsplash.com/photo-<id>?w=1400&q=80 URLs matching the business type; if unsure, use https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=1400&q=80.
5. about/story portrait should be a person headshot, not a building or job site.
6. team/grid members should reflect the actual scale of the business — for a 6-active-project firm, 4-6 members; for a solo operator, 1.
7. Realistic numbers only. If the intake doesn't give specific stats, omit them. Never fabricate ratings, project counts, or years.
8. Contact page hours: use ["Monday – Friday: 8am – 5pm", "Weekends: by appointment"] or a similarly realistic shape unless the intake says otherwise.
9. Response promise on contact: something honest like "We reply to project inquiries within one business day."

# Section data shapes (same as single-page composer)

hero/full-bleed: { "image": "<url>", "eyebrow": "<short>", "title": "<headline>", "subtitle": "<1-2 sentences>", "primaryCta": { "label": "...", "href": "contact" }, "secondaryCta": { "label": "...", "href": "services" } }
hero/split: { "flip": <bool>, "image": "<url>", "eyebrow": "<short>", "title": "<headline>", "subtitle": "<1-2 sentences>", "primaryCta": { "label": "...", "href": "..." }, "stats": [{ "value": "...", "label": "..." }] }
hero/centered-stats: { "eyebrow": "<short>", "title": "<big headline>", "subtitle": "<support>", "primaryCta": { "label": "...", "href": "contact" }, "stats": [{ "value": "...", "label": "..." }] }
services/cards-grid: { "heading": "...", "intro": "...", "items": [{ "title": "...", "description": "...", "image": "<url>", "href": "contact" }] }
services/alternating: { "heading": "...", "intro": "...", "items": [{ "title": "...", "description": "...", "image": "<url>", "bullets": ["..."], "href": "contact" }] }
cta/banner: { "heading": "...", "subtitle": "...", "primaryCta": { "label": "...", "href": "contact" } }
cta/split: { "heading": "...", "subtitle": "...", "image": "<url>", "bullets": ["..."], "primaryCta": { "label": "...", "href": "contact" }, "phone": "${input.phone || ''}" }
about/story: { "eyebrow": "...", "title": "Our story", "portrait": "<headshot url>", "paragraphs": ["...", "..."], "signature": "<name>, <role>", "stats": [{ "value": "...", "label": "..." }] }
team/grid: { "heading": "...", "intro": "...", "members": [{ "name": "...", "role": "...", "bio": "...", "portrait": "<url>" }] }
contact/form-info: { "heading": "...", "intro": "...", "phone": "${input.phone || ''}", "email": "${input.email || ''}", "address": "...", "hours": ["..."], "responsePromise": "..." }
gallery/grid: { "heading": "...", "intro": "...", "photos": [{ "url": "<url>", "alt": "...", "caption": "..." }] }
testimonials/quotes: { "heading": "...", "intro": "...", "items": [{ "quote": "<customer quote>", "author": "...", "role": "...", "photo": "<headshot url>" }] }
stats/bar: { "heading": "...", "items": [{ "value": "...", "label": "..." }] }
faq/accordion: { "heading": "...", "intro": "...", "items": [{ "question": "...", "answer": "..." }] }
menu/cards: { "heading": "...", "intro": "...", "items": [{ "name": "...", "description": "...", "price": "$X", "dietary": ["GF", "V", "DF"], "image": "<url>" }] }
location/live-map: { "heading": "...", "intro": "...", "currentAddress": "...", "currentUntil": "...", "recentLocations": [{ "label": "...", "when": "..." }], "smsOptIn": <bool> }
schedule/week-strip: { "heading": "...", "intro": "...", "days": [{ "dayLabel": "Tue", "location": "Dane County Farmers Market", "hours": "9am – 1pm", "tag": "Market" }] }
catering/inquiry-form: { "heading": "...", "intro": "...", "minHeadcount": <number>, "leadTimeWeeks": <number>, "venueTypes": ["Wedding", "Birthday", "Corporate"], "responsePromise": "..." }
social/feed: { "heading": "...", "intro": "...", "handle": "@username", "platform": "instagram", "limit": 9 }
age/modal: { "gateAge": 21, "heading": "Are you 21 or older?", "message": "<short legal copy>", "stateSelector": <bool>, "exitUrl": "https://google.com" }
strain/grid: { "heading": "...", "intro": "...", "filters": ["indica", "sativa", "hybrid"], "items": [{ "name": "Blue Dream", "type": "Hybrid", "thc": "21%", "cbd": "0.5%", "effects": ["relaxed", "creative"], "terpenes": ["myrcene", "pinene"], "price": "$45/eighth", "image": "<url>" }] }
deals/strip: { "heading": "Today's specials", "intro": "...", "expiresLabel": "Today only", "items": [{ "title": "Wax Wednesday", "description": "30% off concentrates", "validThrough": "..." }] }
quote/instant-address: { "heading": "Get a ballpark estimate", "intro": "...", "pricePerSqFt": 5.50, "minSqFt": 800, "maxSqFt": 4000, "callToAction": "See my range" }
banner/storm-alert: { "heading": "Hail storm in Eau Claire on May 12", "subtitle": "Free post-storm roof inspection — claim help included.", "cta": { "label": "Schedule inspection", "href": "/contact" }, "startDate": "2026-05-12", "endDate": "2026-08-12", "dismissable": true }
before_after/slider: { "heading": "Before & after", "intro": "...", "filters": ["material", "year"], "items": [{ "beforeImage": "<url>", "afterImage": "<url>", "caption": "Re-roof after July 2024 hail", "location": "Eau Claire, WI", "year": 2024, "material": "GAF Timberline HDZ" }] }
financing/calculator: { "heading": "Roof financing from $99/mo", "intro": "...", "fromMonthly": 99, "maxTermMonths": 84, "apr": 7.99, "minLoanAmount": 3000, "maxLoanAmount": 35000, "ctaLabel": "Get my estimate" }
trust/badges: { "heading": "Credentials", "intro": "...", "items": [{ "name": "GAF Master Elite", "image": "<url>", "url": "..." }, { "name": "BBB A+", "image": "<url>" }] }
packages/seasonal: { "heading": "Packages", "intro": "...", "items": [{ "title": "Weekly mow", "tier": "standard", "pricePerMonth": 180, "includes": ["Mow + trim", "Edge driveways", "Blow off hardscape"], "seasonOnly": "spring-fall" }, { "title": "Snow contract", "tier": "premium", "pricePerMonth": 320, "includes": ["Push at 2 inches", "Salt walkways", "Tracker app access"], "seasonOnly": "winter" }] }
care/finder: { "heading": "Find the right care for your loved one", "intro": "...", "relationships": ["My parent", "My spouse", "Myself", "Another family member"], "careTypes": ["Companion care", "Personal care", "Skilled nursing", "Dementia / Alzheimer's", "Hospice / end-of-life"], "hoursOptions": ["A few hours a week", "10–25 hours", "25–40 hours", "40+ hours", "24/7 live-in"], "ctaLabel": "Schedule a free assessment", "responsePromise": "We respond within one business day. No phone trees, no sales pressure." }
caregivers/grid: { "heading": "Meet some of our caregivers", "intro": "...", "filters": ["specialty", "languages"], "items": [{ "name": "Maria", "yearsExperience": 8, "certifications": ["CNA"], "specialties": ["Dementia", "Companion care"], "languages": ["English", "Spanish"], "photo": "<url>", "blurb": "Former hospital aide. Specializes in afternoon sundowning support and gentle redirection." }] }
coverage/insurance-guide: { "heading": "Coverage", "intro": "...", "items": [{ "source": "Medicare", "eligibility": "Age 65+ or qualifying disability", "whatItCovers": "Home health (skilled, time-limited, doctor-ordered). Does NOT cover non-medical in-home care.", "howToApply": "Through your doctor + Medicare-certified agency", "ourRole": "We can refer to a Medicare-certified home health partner when skilled care is what you need" }] }
emergency/bar: { "heading": "Furnace out? Pipe leaking? Power out?", "phone": "555-123-4567", "subtext": "We pick up. Even at 2am.", "businessHours": "7am-7pm", "afterHoursLabel": "After-hours call", "normalHoursLabel": "Open now — call now" }
service_area/zip-check: { "heading": "Do we come to you?", "intro": "...", "serviceZips": ["54701", "54702", "54703", "54720", "54729"], "yesLabel": "Yes, we serve <ZIP>", "noLabel": "Not yet in <ZIP> — leave your info and we'll let you know when we expand", "yesHref": "#contact", "noEmail": true }
pricing/flat-rate-menu: { "heading": "Flat-rate menu", "intro": "...", "disclaimer": "All prices include parts unless noted. Final quote written before any work starts.", "items": [{ "service": "Drain clear (main line)", "priceLabel": "$285", "includes": ["Camera inspection", "Snake to 100ft", "Recommendations if root intrusion found"] }, { "service": "Water heater install (40-gal gas)", "priceLabel": "from $1,850", "includes": ["GE / Rheem / Bradford White", "Tank pull + haul", "Permits + inspection", "6yr labor warranty"], "note": "Add $150 for hard-to-reach attic install" }] }
reservation/widget: { "heading": "Reserve a table", "intro": "...", "partySizes": [1, 2, 3, 4, 5, 6, 7, 8], "maxLeadDays": 60, "note": "Parties of 8+ contact us directly.", "bookingPath": "/book" }

# Output schema (strict)
{
  "rationale": "1-2 sentences on the overall site narrative and what holds it together",
  "pages": {
    "home":     { "sections": [ ... ] },
    "about":    { "sections": [ ... ] },
    "services": { "sections": [ ... ] },
    "contact":  { "sections": [ ... ] }
  }
}

# Few-shot examples — match this tier of voice and specificity

## GOOD example: a Driftless-region restaurant
Hero (full-bleed):
  eyebrow:  "Mineral Point · 28 seats · Tuesday–Saturday"
  title:    "Five courses. One chef. The whole room hears the kitchen."
  subtitle: "Anika cooks for 28 people a night from three farms inside a 30-mile circle. Reservations open four weeks ahead."
  primaryCta: { label: "Reserve a table", href: "contact" }

Why this works: every word is specific to THIS restaurant. "The whole room
hears the kitchen" is a real fact about the 28-seat layout that becomes
a vivid promise. No 'farm-to-table experience' or 'culinary journey'.

## GOOD example: a roofing company
Hero (split, flip:false):
  eyebrow:  "Madison + Dane County · since 2014"
  title:    "We answer the phone. We show up when we say."
  subtitle: "Storm-damage insurance work is most of what we do. Re-roofs and gutters fill in the slow weeks. Owner-on-the-roof on every job."
  stats: [
    { value: "1,200+", label: "Roofs since 2014" },
    { value: "Owner", label: "On every job site" },
  ]

Why this works: takes a position other contractors won't ("we answer the
phone"). The stats are anchored to specific facts, not vanity numbers.

## BAD example — do NOT do this
Hero:
  eyebrow:  "Trusted Roofing Experts"
  title:    "Complete Roofing Solutions From Inspection To Installation"
  subtitle: "Quality work you can trust, with experience you can rely on."

Why this is bad: every word could substitute on a competitor's site. The
copy is interchangeable. The title is just a list of nouns. The subtitle
uses "trust" twice and says nothing concrete. NEVER ship copy like this.

Output the JSON now — nothing else.`
}

/**
 * Compose a full four-page website in one Claude call. Each page's
 * sections are sanitized independently.
 */
export async function composeSite(input: ComposerInput): Promise<SiteResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }

  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  // Full-site compose streams 32K tokens — generous ceiling, but still bounded
  // so a wedged connection can't pin the worker indefinitely
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 900_000, maxRetries: 1 })

  const prompt = buildSitePrompt(input)

  // Every vertical now ships a 4-7 page recipe with rich per-section data
  // (menu items, strain catalogs, room cards, gallery items, etc.). 8K
  // tokens truncates mid-JSON the moment a recipe has 5+ pages — and the
  // truncation is silent: tryParse just returns null, autoCompose's
  // setTimeout catch swallows the error, and the tenant row stays at
  // ready:false forever. Previously this 32K budget was gated on a
  // hardcoded list of the original 7 verticals; cafe (4-page) snuck
  // through at 8K, but salon/contractor/fitness/hotel/events all died
  // silently because they weren't in the list.
  //
  // 32K is a ceiling, not actual usage — a 4-page recipe still generates
  // ~6-8K. Opus's 200K context handles this trivially. The reliability
  // win is enormous: every recipe past or future just works.
  const maxTokens = 32000

  // Use streaming — required by the Anthropic SDK for requests where
  // (max_tokens × estimated-per-token) might exceed 10 minutes. With 32K
  // max_tokens on Opus, the SDK refuses non-streaming requests with:
  // "Streaming is strongly recommended for operations that may take
  // longer than 10 minutes." Streaming aggregates internally; finalMessage()
  // returns the same shape as create() would.
  const callOnce = async (extraSystem?: string) => {
    const stream = anthropic.messages.stream({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system: 'You compose multi-page website schemas. Output strict JSON only. No prose, no markdown fences.' + (extraSystem ? ' ' + extraSystem : ''),
      messages: [{ role: 'user', content: prompt }],
    })
    return stream.finalMessage()
  }

  const tryParse = (text: string): { pages: any; rationale?: string } | null => {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    try {
      const parsed = JSON.parse(cleaned)
      if (parsed && parsed.pages && typeof parsed.pages === 'object') return parsed
      return null
    } catch { return null }
  }

  // Quality check: Claude occasionally returns valid JSON with empty
  // hero title (~1 in 4 calls on the longest-guidance verticals — salon,
  // hotel). The structure parses cleanly but content is a husk: empty
  // hero, generic "What we do" / "The team" headings, no images. This
  // looks fine to tryParse but produces an unusable preview for the
  // customer. Catch it explicitly and retry with a sharper system prompt.
  const isHusk = (p: any): boolean => {
    const home = p?.pages?.home?.sections
    if (!Array.isArray(home) || home.length === 0) return true
    const hero = home.find((s: any) => s?.type === 'hero')
    if (!hero) return false
    const heroTitle = (hero.data?.title || hero.data?.headline || '').trim()
    return heroTitle.length === 0
  }

  const res1 = await callOnce()
  const text1 = res1.content[0]?.type === 'text' ? res1.content[0].text : ''
  let parsed = tryParse(text1)
  let rawText = text1

  if (!parsed) {
    const res2 = await callOnce('Your previous output was not valid JSON. Output ONLY the raw JSON object.')
    const text2 = res2.content[0]?.type === 'text' ? res2.content[0].text : ''
    parsed = tryParse(text2)
    rawText = text2
  } else if (isHusk(parsed)) {
    // Got JSON but the home page is a husk — same retry pattern but
    // with a quality-focused nudge instead of a JSON-shape nudge.
    //
    // CRITICAL: this retry MUST be wrapped in try/catch. If callOnce
    // throws (Anthropic 5xx, network blip, streaming disconnect), the
    // exception propagates out of composeSite, autoComposeForNewIntake
    // swallows it, and the tenant row stays at ready:false forever.
    // Observed in production 2026-06-08: hotel intake silently died for
    // 64 min after a husky first call when the retry threw uncaught.
    // With try/catch we ship the husk; customer recovers via the
    // "Request changes" widget.
    try {
      const res2 = await callOnce(
        'Your previous output had an empty hero title and generic placeholders. EVERY section must have substantive content drawn from this specific business — actual names, prices, facts, voice from the intake. The hero/full-bleed section MUST have a non-empty `title` field with a concrete, intake-anchored headline. Output ONLY the raw JSON object.'
      )
      const text2 = res2.content[0]?.type === 'text' ? res2.content[0].text : ''
      const parsed2 = tryParse(text2)
      if (parsed2 && !isHusk(parsed2)) {
        parsed = parsed2
        rawText = text2
      }
      // If the retry is still a husk, fall through with parsed1.
    } catch (e: any) {
      console.warn('[Composer] husk-retry threw, shipping the husk:', e?.message || e)
    }
  }

  if (!parsed) throw new Error('Site composer returned un-parseable output after retry')
  void rawText  // suppress unused-var lint; the variable is read for logging in COMPOSER_DEBUG below

  if (process.env.COMPOSER_DEBUG) {
    console.log('[Composer] raw response head:', text1.slice(0, 300))
    console.log('[Composer] parsed.pages keys:', Object.keys(parsed.pages || {}))
    console.log('[Composer] home sections length:', parsed.pages?.home?.sections?.length)
  }

  // Page set is determined by industry — different verticals get different
  // page recipes. Generic fallback is the 4-page model.
  const businessTypeIn = input.businessType || ''
  // Match definitions MUST mirror the ternary in buildSitePrompt above —
  // any change there must be reflected here. Both use word-boundary
  // matching for resilience against multi-word customer inputs.
  const isFoodTruck = /\b(food[_\s\-]?truck|mobile[_\s\-]?food|food[_\s\-]?cart|mobile[_\s\-]?kitchen|pop[_\s\-]?up[_\s\-]?kitchen)\b/i.test(businessTypeIn)
  const isDispensary = /\b(dispensary|cannabis|cannabis[_\s\-]?retail)\b/i.test(businessTypeIn)
  const isRoofing = /\b(roofing|roof|roofer|storm[_\s\-]?restoration|siding[_\s\-]?roofing)\b/i.test(businessTypeIn)
  const isLandscaping = /\b(landscaping|lawn[_\s\-]?care|lawncare|landscape[_\s\-]?design|snow[_\s\-]?removal|tree[_\s\-]?service|arborist|hardscape)\b/i.test(businessTypeIn)
  const isHomecare = /\b(home[_\s\-]?care|homecare|in[_\s\-]?home[_\s\-]?care|senior[_\s\-]?care|caregiving|companion[_\s\-]?care|home[_\s\-]?health)\b/i.test(businessTypeIn)
  const isFieldservice = /\b(field[_\s\-]?service|hvac|plumbing|plumber|electrical|electrician|appliance[_\s\-]?repair|cleaning|house[_\s\-]?cleaning|maid[_\s\-]?service|janitorial|commercial[_\s\-]?cleaning|pest[_\s\-]?control|exterminator|locksmith|garage[_\s\-]?door|septic|pool[_\s\-]?service|irrigation|handyman|painting|mobile[_\s\-]?detailing|mobile[_\s\-]?mechanic|pet[_\s\-]?grooming|dog[_\s\-]?walking)\b/i.test(businessTypeIn)
  const isCafe = /\b(cafe|caf[eé]|coffee[_\s\-]?shop|coffeeshop|coffee[_\s\-]?house|tea[_\s\-]?room|tearoom|espresso[_\s\-]?bar|bakery[_\s\-]?caf[eé]?)\b/i.test(businessTypeIn)
  const isRestaurant = /\b(restaurant|bistro|gastropub|eatery|diner|pizzeria|trattoria|brasserie|taqueria|ramen[_\s\-]?shop|sushi[_\s\-]?bar)\b/i.test(businessTypeIn)
  const isSalon = /\b(salon|hair[_\s\-]?salon|hairdresser|barber|barbershop|nail[_\s\-]?salon|nail[_\s\-]?bar|spa|day[_\s\-]?spa|esthetician|esthetics|beauty[_\s\-]?salon|lash[_\s\-]?bar|brow[_\s\-]?bar|medspa|med[_\s\-]?spa|waxing)\b/i.test(businessTypeIn)
  const isFitness = /\b(gym|fitness|fitness[_\s\-]?studio|yoga|yoga[_\s\-]?studio|pilates|pilates[_\s\-]?studio|crossfit|cross[_\s\-]?fit|boxing|boxing[_\s\-]?gym|martial[_\s\-]?arts|mma|personal[_\s\-]?training|personal[_\s\-]?trainer|spin[_\s\-]?studio|cycling[_\s\-]?studio|barre|dance[_\s\-]?studio)\b/i.test(businessTypeIn)
  const isHotel = /\b(hotel|boutique[_\s\-]?hotel|b[_\s\-]?and[_\s\-]?b|b&b|bandb|bnb|bed[_\s\-]?and[_\s\-]?breakfast|inn|lodge|motel|vacation[_\s\-]?rental|short[_\s\-]?term[_\s\-]?rental|airbnb|guest[_\s\-]?house|cabin[_\s\-]?rental)\b/i.test(businessTypeIn)
  const isEvents = /\b(event[_\s\-]?venue|wedding[_\s\-]?venue|banquet[_\s\-]?hall|banquet|venue|party[_\s\-]?venue|corporate[_\s\-]?venue|reception[_\s\-]?hall|barn[_\s\-]?venue|events)\b/i.test(businessTypeIn)
  const isContractor = /\b(contractor|general[_\s\-]?contractor|construction|remodeling|remodeler|siding|home[_\s\-]?improvement|kitchen|kitchen[_\s\-]?remodeling|kitchen[_\s\-]?design|kitchen[_\s\-]?installation|bath[_\s\-]?remodeling|bathroom[_\s\-]?remodeling|deck[_\s\-]?builder|fence[_\s\-]?installation|drywall|flooring|framing|concrete|masonry|tile[_\s\-]?installer|cabinet[_\s\-]?maker)\b/i.test(businessTypeIn)
  const expectedPages: string[] = isFoodTruck
    ? Object.keys(FOODTRUCK_PAGE_RECIPES)
    : isDispensary
      ? Object.keys(DISPENSARY_PAGE_RECIPES)
      : isRoofing
        ? Object.keys(ROOFING_PAGE_RECIPES)
        : isLandscaping
          ? Object.keys(LANDSCAPING_PAGE_RECIPES)
          : isHomecare
            ? Object.keys(HOMECARE_PAGE_RECIPES)
            : isFieldservice
              ? Object.keys(FIELDSERVICE_PAGE_RECIPES)
              : isCafe
                ? Object.keys(CAFE_PAGE_RECIPES)
                : isRestaurant
                  ? Object.keys(RESTAURANT_PAGE_RECIPES)
                  : isSalon
                    ? Object.keys(SALON_PAGE_RECIPES)
                    : isFitness
                      ? Object.keys(FITNESS_PAGE_RECIPES)
                      : isHotel
                        ? Object.keys(HOTEL_PAGE_RECIPES)
                        : isEvents
                          ? Object.keys(EVENTS_PAGE_RECIPES)
                          : isContractor
                            ? Object.keys(CONTRACTOR_PAGE_RECIPES)
                            : Object.keys(PAGE_RECIPES)

  let pages = parsed.pages || {}
  const sanitizeAll = (src: any): Record<string, Section[]> => {
    const out: Record<string, Section[]> = {}
    for (const page of expectedPages) {
      out[page] = sanitizeSections(src[page]?.sections)
    }
    return out
  }
  let sanitized = sanitizeAll(pages)

  // Claude occasionally returns a parseable JSON shell where one or more
  // pages have empty sections arrays. When that happens, retry once with
  // explicit instruction to fill every page. If the retry also returns
  // empty pages, surface a clear error instead of silently shipping a
  // blank site.
  const findEmpty = (s: Record<string, Section[]>) =>
    Object.entries(s).filter(([, sections]) => sections.length === 0).map(([name]) => name)

  const emptyPages = findEmpty(sanitized)
  if (emptyPages.length > 0) {
    if (process.env.COMPOSER_DEBUG) console.log('[Composer] Retrying — empty pages:', emptyPages.join(', '))
    const res3 = await callOnce(
      `Your previous output had pages with no sections. Every page (${expectedPages.join(', ')}) MUST have at least 2 sections. ` +
      'Empty sections arrays are not acceptable. Compose again, in full.'
    )
    const text3 = res3.content[0]?.type === 'text' ? res3.content[0].text : ''
    const reparsed = tryParse(text3)
    if (reparsed) {
      pages = reparsed.pages || {}
      sanitized = sanitizeAll(pages)
      if (typeof reparsed.rationale === 'string') parsed.rationale = reparsed.rationale
    }

    const stillEmpty = findEmpty(sanitized)
    if (stillEmpty.length > 0) {
      throw new Error('Site composer returned empty sections for: ' + stillEmpty.join(', ') + ' (even after retry)')
    }
  }

  // Wrap the section arrays back into { sections } shape per page.
  const finalPages: Record<string, { sections: Section[] }> = {}
  for (const page of expectedPages) {
    finalPages[page] = { sections: sanitized[page] }
  }

  return {
    pages: finalPages,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale : undefined,
  }
}

// Re-export ROOT for tooling
export const PREMIUM_TEMPLATE_DIR = path.resolve(
  __dirname,
  '../../../../templates/website-premium-contractor'
)

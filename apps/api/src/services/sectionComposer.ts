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
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const prompt = buildPrompt(input)

  const callOnce = async (extraSystem?: string) => {
    return anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
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
  const businessType = input.businessType || ''
  const ft = /^food[_-]?truck|^mobile[_-]?food|^food[_-]?cart$/i.test(businessType)
  const dispensary = /^dispensary|^cannabis|^cannabis[_-]?retail/i.test(businessType)
  const recipes: Record<string, { purpose: string; allowed_types: readonly string[]; required_sequence: string }> = ft
    ? FOODTRUCK_PAGE_RECIPES
    : dispensary
      ? DISPENSARY_PAGE_RECIPES
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
  if (photosSection) {
    photosSection += `\nRules for the photo tiers:\n` +
      `- Tier 1 (customer photos) ALWAYS beats Tier 2 (stock) when one fits the slot.\n` +
      `- Tier 2 (stock) ALWAYS beats the hardcoded Unsplash example URLs below.\n` +
      `- Match tags to section context: 'hero' tag for hero sections, 'team' for team/grid members, 'services' for service item images.\n` +
      `- Never reuse the same photo across two sections on the same page unless unavoidable.\n` +
      `- Only fall back to the example URLs in rule 4 below if BOTH tiers are exhausted.\n`
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
${dispensary ? `
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
Compose ${ft ? 'SIX' : 'FOUR'} pages: ${Object.keys(recipes).join(', ')}. Each page is its own ordered list of sections.

# Available section types and variants

${schemaSummary}

# Page recipes (what each page is for, what it should contain)

${recipesSummary}

# Hard rules
1. Use only the section types listed in each page's allowed_types.
2. Write copy that reflects THIS specific business — pull details from the description, services, goals. No generic boilerplate.
3. The four pages should feel like one coherent site — same voice, same level of formality, narrative continuity from home → about → services → contact.
4. For photos, use https://images.unsplash.com/photo-<id>?w=1400&q=80 URLs. Choose ones that match the business type. If unsure, use https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=1400&q=80.
5. about/story portrait should be a person headshot, not a building or job site.
6. team/grid members should reflect the actual scale of the business — for a 6-active-project firm, 4-6 members; for a solo operator, 1.
7. Realistic numbers only. If the intake doesn't give specific stats, omit them. Never fabricate ratings, project counts, or years.
8. Contact page hours: use ["Monday – Friday: 8am – 5pm", "Weekends: by appointment"] or a similarly realistic shape unless the intake says otherwise.
9. Response promise on contact: something honest like "We reply to project inquiries within one business day."

# Section data shapes (same as single-page composer)

hero/full-bleed: { "image": "<url>", "eyebrow": "<short>", "title": "<headline>", "subtitle": "<1-2 sentences>", "primaryCta": { "label": "...", "href": "contact.html" }, "secondaryCta": { "label": "...", "href": "services.html" } }
hero/split: { "flip": <bool>, "image": "<url>", "eyebrow": "<short>", "title": "<headline>", "subtitle": "<1-2 sentences>", "primaryCta": { "label": "...", "href": "..." }, "stats": [{ "value": "...", "label": "..." }] }
hero/centered-stats: { "eyebrow": "<short>", "title": "<big headline>", "subtitle": "<support>", "primaryCta": { "label": "...", "href": "contact.html" }, "stats": [{ "value": "...", "label": "..." }] }
services/cards-grid: { "heading": "...", "intro": "...", "items": [{ "title": "...", "description": "...", "image": "<url>", "href": "contact.html" }] }
services/alternating: { "heading": "...", "intro": "...", "items": [{ "title": "...", "description": "...", "image": "<url>", "bullets": ["..."], "href": "contact.html" }] }
cta/banner: { "heading": "...", "subtitle": "...", "primaryCta": { "label": "...", "href": "contact.html" } }
cta/split: { "heading": "...", "subtitle": "...", "image": "<url>", "bullets": ["..."], "primaryCta": { "label": "...", "href": "contact.html" }, "phone": "${input.phone || ''}" }
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
  primaryCta: { label: "Reserve a table", href: "contact.html" }

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
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const prompt = buildSitePrompt(input)

  // Vertical-specific recipes (food truck, dispensary, future ones)
  // produce 6 pages with rich data per section — strain catalog cards
  // alone can run 200+ tokens each × 8-12 strains. Plain 4-page model
  // fits comfortably in 8K; 6-page verticals need more room or the
  // response truncates mid-JSON and tryParse silently fails.
  const _btForTokens = input.businessType || ''
  const _isExtended =
    /^food[_-]?truck|^mobile[_-]?food|^food[_-]?cart$/i.test(_btForTokens) ||
    /^dispensary|^cannabis|^cannabis[_-]?retail/i.test(_btForTokens)
  const maxTokens = _isExtended ? 16000 : 8000

  const callOnce = async (extraSystem?: string) => {
    return anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system: 'You compose multi-page website schemas. Output strict JSON only. No prose, no markdown fences.' + (extraSystem ? ' ' + extraSystem : ''),
      messages: [{ role: 'user', content: prompt }],
    })
  }

  const tryParse = (text: string): { pages: any; rationale?: string } | null => {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    try {
      const parsed = JSON.parse(cleaned)
      if (parsed && parsed.pages && typeof parsed.pages === 'object') return parsed
      return null
    } catch { return null }
  }

  const res1 = await callOnce()
  const text1 = res1.content[0]?.type === 'text' ? res1.content[0].text : ''
  let parsed = tryParse(text1)

  if (!parsed) {
    const res2 = await callOnce('Your previous output was not valid JSON. Output ONLY the raw JSON object.')
    const text2 = res2.content[0]?.type === 'text' ? res2.content[0].text : ''
    parsed = tryParse(text2)
  }

  if (!parsed) throw new Error('Site composer returned un-parseable output after retry')

  if (process.env.COMPOSER_DEBUG) {
    console.log('[Composer] raw response head:', text1.slice(0, 300))
    console.log('[Composer] parsed.pages keys:', Object.keys(parsed.pages || {}))
    console.log('[Composer] home sections length:', parsed.pages?.home?.sections?.length)
  }

  // Page set is determined by industry — different verticals get different
  // page recipes. Generic fallback is the 4-page model.
  const businessTypeIn = input.businessType || ''
  const isFoodTruck = /^food[_-]?truck|^mobile[_-]?food|^food[_-]?cart$/i.test(businessTypeIn)
  const isDispensary = /^dispensary|^cannabis|^cannabis[_-]?retail/i.test(businessTypeIn)
  const expectedPages: string[] = isFoodTruck
    ? Object.keys(FOODTRUCK_PAGE_RECIPES)
    : isDispensary
      ? Object.keys(DISPENSARY_PAGE_RECIPES)
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

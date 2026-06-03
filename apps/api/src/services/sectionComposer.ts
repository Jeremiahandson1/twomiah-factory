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

  return `You are composing a homepage for ${input.businessName} — a ${input.businessType} in ${[input.city, input.state].filter(Boolean).join(', ') || 'the region they serve'}.

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
  pages: {
    home: ComposerResult
    about: ComposerResult
    services: ComposerResult
    contact: ComposerResult
  }
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
    allowed_types: ['hero', 'services', 'cta'],
    required_sequence: '1 hero, optional 1 second hero (e.g. hero/split flip for an about-style block), 1 services section, 1 cta',
  },
  about: {
    purpose: 'Tell who they are. The voice page — read by qualified leads doing due diligence.',
    allowed_types: ['about', 'team', 'cta'],
    required_sequence: '1 about/story section, optional 1 team/grid, optional 1 cta to drive to contact',
  },
  services: {
    purpose: 'Full menu of what they do. Read by people who already know they want to hire and are scoping fit.',
    allowed_types: ['hero', 'services', 'cta'],
    required_sequence: 'optional 1 hero (lighter than homepage hero), 1 services section (use the more-detailed variant), 1 cta',
  },
  contact: {
    purpose: 'Conversion page. Form + business details + response promise.',
    allowed_types: ['hero', 'contact'],
    required_sequence: 'optional 1 hero (short, copy-only), 1 contact/form-info section',
  },
} as const

function buildSitePrompt(input: ComposerInput): string {
  const schemaSummary = Object.entries(SECTION_SCHEMA).map(([type, variants]) =>
    `  ${type}: ${Object.keys(variants).join(', ')}`
  ).join('\n')

  const recipesSummary = Object.entries(PAGE_RECIPES).map(([page, recipe]) =>
    `- ${page}: ${recipe.purpose}\n    allowed types: ${recipe.allowed_types.join(', ')}\n    sequence: ${recipe.required_sequence}`
  ).join('\n')

  // Customer-supplied photos take precedence over stock URLs. We list them
  // with their tag (if any) so Claude can pick the right photo for the
  // right slot — a 'hero'-tagged shot for hero sections, 'team' for
  // team/grid members, etc. If no tag, it's eligible anywhere.
  const photoList = (input.customerPhotos || []).slice(0, 30)
  const photosSection = photoList.length > 0
    ? `\n# Customer-supplied photos (USE THESE FIRST — they're authentic to this business)\n` +
      photoList.map((p, i) =>
        `${i + 1}. ${p.url}${p.tag ? '  [tag: ' + p.tag + ']' : ''}${p.alt ? '  [alt: ' + p.alt + ']' : ''}`
      ).join('\n') +
      `\n\nRules for these photos:\n` +
      `- Always prefer a customer photo over an Unsplash URL when one fits the slot.\n` +
      `- Match tags to section context (a 'hero'-tagged photo for hero sections, 'team' for team/grid members, 'services' for service item images).\n` +
      `- Don't reuse the same customer photo across two sections on the same page unless absolutely necessary.\n` +
      `- If no customer photo fits, fall back to an Unsplash URL as described above.\n`
    : ''

  return `You are composing a multi-page website for ${input.businessName} — a ${input.businessType} in ${[input.city, input.state].filter(Boolean).join(', ') || 'the region they serve'}.

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

# Your job
Compose FOUR pages: home, about, services, contact. Each page is its own ordered list of sections.

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

  const callOnce = async (extraSystem?: string) => {
    return anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 8000,
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

  let pages = parsed.pages || {}
  let sanitized = {
    home:     sanitizeSections(pages.home?.sections),
    about:    sanitizeSections(pages.about?.sections),
    services: sanitizeSections(pages.services?.sections),
    contact:  sanitizeSections(pages.contact?.sections),
  }

  // Claude occasionally returns a parseable JSON shell where one or more
  // pages have empty sections arrays — verified during post-fix testing.
  // When that happens, retry once with explicit instruction to fill every
  // page. If the retry also returns empty pages, surface a clear error
  // instead of silently shipping a blank site.
  const emptyPages = (Object.entries(sanitized) as Array<[string, Section[]]>)
    .filter(([, sections]) => sections.length === 0)
    .map(([name]) => name)

  if (emptyPages.length > 0) {
    if (process.env.COMPOSER_DEBUG) console.log('[Composer] Retrying — empty pages:', emptyPages.join(', '))
    const res3 = await callOnce(
      'Your previous output had pages with no sections. Every page (home, about, services, contact) MUST have at least 2 sections. ' +
      'Empty sections arrays are not acceptable. Compose again, in full.'
    )
    const text3 = res3.content[0]?.type === 'text' ? res3.content[0].text : ''
    const reparsed = tryParse(text3)
    if (reparsed) {
      pages = reparsed.pages || {}
      sanitized = {
        home:     sanitizeSections(pages.home?.sections),
        about:    sanitizeSections(pages.about?.sections),
        services: sanitizeSections(pages.services?.sections),
        contact:  sanitizeSections(pages.contact?.sections),
      }
      if (typeof reparsed.rationale === 'string') parsed.rationale = reparsed.rationale
    }

    const stillEmpty = (Object.entries(sanitized) as Array<[string, Section[]]>)
      .filter(([, sections]) => sections.length === 0)
      .map(([name]) => name)
    if (stillEmpty.length > 0) {
      throw new Error('Site composer returned empty sections for: ' + stillEmpty.join(', ') + ' (even after retry)')
    }
  }

  return {
    pages: {
      home:     { sections: sanitized.home },
      about:    { sections: sanitized.about },
      services: { sections: sanitized.services },
      contact:  { sections: sanitized.contact },
    },
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale : undefined,
  }
}

// Re-export ROOT for tooling
export const PREMIUM_TEMPLATE_DIR = path.resolve(
  __dirname,
  '../../../../templates/website-premium-contractor'
)

/**
 * AI Website Content Generator
 *
 * Generates all JSON data files for a website deployment using Claude AI.
 * Produces: homepage, services, settings (partial), posts, pages content.
 */

export interface ContentGenerationInput {
  businessName: string
  businessType: string
  location: { city: string; state: string; stateFull?: string }
  services: string[]
  description: string
  colorPalette?: { primary: string; secondary: string }
  serviceRegion?: string
  nearbyCities?: string[]
  phone?: string
  email?: string
  ownerName?: string
  domain?: string
}

export interface GeneratedHomepage {
  hero: {
    tagline: string
    title: string
    subtitle: string
    description: string
    image: string
    animation: string
    primaryButtonText: string
    primaryButtonLink: string
    secondaryButtonText: string
    secondaryButtonLink: string
  }
  trustBadges: Array<{
    id: string
    type: string
    label: string
    sublabel?: string
    icon: string
    enabled: boolean
  }>
  ctaSection: {
    title: string
    description: string
    primaryButtonText: string
    primaryButtonLink: string
    secondaryButtonText: string
    secondaryButtonLink: string
    backgroundImage: string
    headline: string
    subtext: string
  }
  serviceAreas: string[]
  businessHours: Record<string, { open: string; close: string; closed: boolean }>
  aboutSection: {
    title: string
    text: string
    image: string
  }
}

export interface GeneratedService {
  id: string
  name: string
  title: string
  slug: string
  shortDescription: string
  description: string
  icon: string
  image: string
  features: string[]
  links: Array<{ label: string; href: string }>
  seoTitle: string
  seoDescription: string
  visible: boolean
  order: number
}

export interface GeneratedPost {
  id: string
  title: string
  slug: string
  excerpt: string
  content: string
  featuredImage: string
  published: boolean
  category: string
  tags: string[]
  seoTitle: string
  seoDescription: string
  author: string
  createdAt: string
  updatedAt: string
}

export interface GeneratedPage {
  id: string
  title: string
  slug: string
  content: string
  description: string
  heroImage: string
  heroAnimation: string
  seoTitle: string
  seoDescription: string
  published: boolean
  createdAt: string
  updatedAt: string
}

export interface GeneratedContent {
  homepage: GeneratedHomepage
  services: GeneratedService[]
  settings: {
    defaultMetaTitle: string
    defaultMetaDescription: string
  }
  posts: GeneratedPost[]
  pages: Record<string, GeneratedPage>
  testimonials: []
  gallery: []
}

const ICON_OPTIONS = [
  'home', 'star', 'shield', 'check', 'heart', 'zap', 'sun', 'droplets',
  'thermometer', 'hammer', 'wrench', 'search', 'layers', 'grid', 'building',
  'truck', 'clock', 'phone', 'mail', 'map-pin', 'award', 'tool', 'settings',
  'scissors', 'camera', 'music', 'book', 'coffee', 'gift', 'briefcase',
  'users', 'target', 'trending-up', 'globe', 'leaf', 'flower', 'palette'
]

// ─── Content Pack Loader ──────────────────────────────────────────────────────

function loadContentPack(industry: string): any | null {
  const fs = require('fs')
  const path = require('path')
  const TEMPLATES_ROOT = process.env.FACTORY_TEMPLATES_DIR || path.resolve(process.cwd(), '..', '..', 'templates')

  // Map industry to template + pack file
  const packPaths: Record<string, string> = {
    general_contractor: path.join(TEMPLATES_ROOT, 'website-contractor', 'content-pack.json'),
    roofing: path.join(TEMPLATES_ROOT, 'website-contractor', 'content-pack-roofing.json'),
    field_service: path.join(TEMPLATES_ROOT, 'website-fieldservice', 'content-pack.json'),
    hvac: path.join(TEMPLATES_ROOT, 'website-fieldservice', 'content-pack.json'),
    plumbing: path.join(TEMPLATES_ROOT, 'website-fieldservice', 'content-pack.json'),
    electrical: path.join(TEMPLATES_ROOT, 'website-fieldservice', 'content-pack.json'),
    home_care: path.join(TEMPLATES_ROOT, 'website-homecare', 'content-pack.json'),
    dispensary: path.join(TEMPLATES_ROOT, 'website-dispensary', 'content-pack.json'),
    food: path.join(TEMPLATES_ROOT, 'website-showcase', 'content-pack.json'),
    hospitality: path.join(TEMPLATES_ROOT, 'website-showcase', 'content-pack.json'),
    fitness: path.join(TEMPLATES_ROOT, 'website-showcase', 'content-pack.json'),
    beauty: path.join(TEMPLATES_ROOT, 'website-showcase', 'content-pack.json'),
    events: path.join(TEMPLATES_ROOT, 'website-showcase', 'content-pack.json'),
    rv: path.join(TEMPLATES_ROOT, 'website-rv', 'content-pack.json'),
    powersports: path.join(TEMPLATES_ROOT, 'website-rv', 'content-pack.json'),
    marine: path.join(TEMPLATES_ROOT, 'website-rv', 'content-pack.json'),
    landscaping: path.join(TEMPLATES_ROOT, 'website-landscaping', 'content-pack.json'),
    veterinary: path.join(TEMPLATES_ROOT, 'website-vet', 'content-pack.json'),
    vet: path.join(TEMPLATES_ROOT, 'website-vet', 'content-pack.json'),
  }

  const packPath = packPaths[industry] || packPaths['general_contractor']
  try {
    if (fs.existsSync(packPath)) {
      return JSON.parse(fs.readFileSync(packPath, 'utf8'))
    }
  } catch (e: any) {
    console.warn('[ContentGenerator] Failed to load content pack:', e.message)
  }
  return null
}

export async function generateWebsiteContent(input: ContentGenerationInput): Promise<GeneratedContent> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  // 32K-token ceiling — the full payload (homepage + product categories + posts
  // + privacy/terms HTML) truncated at 12K and failed JSON.parse ("unterminated
  // string"); matches the premium composer's budget. Still under the SDK's 10-min
  // default so a degraded call fails fast enough to retry.
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 300_000, maxRetries: 2 })

  const location = [input.location.city, input.location.state].filter(Boolean).join(', ') || 'your area'
  const region = input.serviceRegion || input.location.city || 'the area'
  const servicesList = input.services.length > 0 ? input.services.join(', ') : 'general services'
  const nearbyCities = (input.nearbyCities || []).filter(Boolean)
  const serviceAreas = [input.location.city, ...nearbyCities].filter(Boolean)
  const now = new Date().toISOString()

  // Store / e-commerce sites are not service businesses — the whole content
  // model changes (products not services, shop CTAs not quote requests, national
  // shipping not local service area). Detect early so we skip the service
  // content packs and steer the prompt.
  const { verticalFor } = await import('../config/industryRouting')
  const isStore = verticalFor(input.businessType) === 'store'

  // Load industry content pack — but NOT for a store: the packs are all
  // service-business content (contractor is the fallback), and injecting
  // contractor services/FAQ fights the store guidance below.
  const pack = isStore ? null : loadContentPack(input.businessType)
  if (pack) {
    console.log('[ContentGenerator] Using content pack for:', pack.vertical || input.businessType)
  } else if (isStore) {
    console.log('[ContentGenerator] Store vertical — skipping service content pack')
  }

  // Build the prompt — use content pack if available, otherwise generate from scratch
  const packContext = pack ? `
You have a pre-written content pack for this industry. Use it as the foundation — customize it for this specific business. DO NOT rewrite from scratch. Adapt the existing content by:
- Replacing generic references with "${input.businessName}" and "${region}"
- Adjusting the tone to match a ${input.description || 'local business'} in ${location}
- Using the service descriptions from the pack but localizing them
- Writing blog posts based on the pack's topic outlines

CONTENT PACK TONE: ${pack.tone?.summary || pack.tone || 'Professional and trustworthy'}

TRUST BADGES FROM PACK:
${JSON.stringify(pack.trustBadges || [], null, 2)}

SERVICES FROM PACK (customize these, don't invent new ones):
${JSON.stringify((pack.services || []).map((s: any) => ({ name: s.name, shortDescription: s.shortDescription, description: s.description, features: s.features || s.keyPoints?.map((k: any) => k.point) || [] })), null, 2)}

BLOG TOPICS FROM PACK (write full articles based on these outlines):
${JSON.stringify((pack.blogTopics || []).slice(0, 3).map((b: any) => ({ title: b.title, slug: b.slug, outline: b.outline, targetWords: b.targetWords })), null, 2)}

FAQ FROM PACK (use these as-is, just customize company name/location):
${JSON.stringify((pack.faq || []).slice(0, 6), null, 2)}
` : ''

  const storeGuidance = isStore ? `
THIS IS AN ONLINE STORE (e-commerce), NOT a service business. Adapt everything:
- Hero: a real point of view about WHO this store is for and why it's different — not "quality products, delivered". primaryButtonText "Shop Now", primaryButtonLink "/shop"; secondaryButtonText "Our Story", secondaryButtonLink "/about". Never "Get a quote" or "#contact".
- "services" are PRODUCT CATEGORIES the store sells (derive from the product list) — named as things a shopper browses ("Feeders", "Hummingbird feeders", "Life-list journals"), each with a shopper-facing description of what's in it and who it's for. They are NOT services performed.
- trustBadges: fast shipping, easy 30-day returns, secure checkout, curated selection — never "licensed & insured" or "free estimates".
- ctaSection: drive to the shop ("Start your collection", "Shop the starter kit"), primaryButtonLink "/shop".
- aboutSection: the brand story — why this store exists and who it serves.
- Blog posts: buying guides / how-tos for the niche (e.g. "Your first 10 backyard birds", "Seed vs suet").
- Do NOT use local-service framing ("serving [city]", "your area") — an online store ships nationally.
` : ''

  const prompt = `You are customizing website content for a specific business.${pack ? ' You have industry-specific content to work from — adapt it, don\'t start from scratch.' : ' Generate unique, professional, SEO-optimized content.'}${storeGuidance}

BUSINESS DETAILS:
- Name: ${input.businessName}
- Type/Industry: ${input.businessType}
- Location: ${location}
- Service Region: ${region}
- Services: ${servicesList}
- Description: ${input.description || 'No description provided'}
${input.ownerName ? '- Owner: ' + input.ownerName : ''}
${input.phone ? '- Phone: ' + input.phone : ''}
${input.email ? '- Email: ' + input.email : ''}
${packContext}
RULES:
- Write compelling, natural copy — not generic filler
- Include "${input.location.city}" and "${region}" naturally for local SEO
- Use "${input.businessName}" where appropriate
- Blog posts must be 400-800 words, genuinely useful, with markdown headings (##) and bullet points
- Icon values must be one of: ${ICON_OPTIONS.join(', ')}
${pack ? '- Stay true to the content pack\'s tone and technical accuracy' : '- Each service must have unique, detailed content'}

Return ONLY valid JSON with this structure:
{
  "homepage": {
    "hero": { "tagline": "3-6 WORD BADGE", "title": "HEADLINE with city", "subtitle": "TAGLINE", "description": "2-3 sentences", "primaryButtonText": "CTA", "primaryButtonLink": "#contact", "secondaryButtonText": "SECONDARY", "secondaryButtonLink": "/services" },
    "trustBadges": [{ "id": "id", "type": "custom", "label": "LABEL", "sublabel": "SUBLABEL", "icon": "ICON", "enabled": true }],
    "ctaSection": { "title": "CTA TITLE", "description": "CTA DESC", "primaryButtonText": "CTA", "primaryButtonLink": "#contact", "headline": "ONE LINE", "subtext": "WITH PHONE" },
    "aboutSection": { "title": "ABOUT TITLE", "text": "2-3 PARAGRAPHS about this specific business" }
  },
  "services": [{ "id": "slug", "name": "Name", "title": "Title", "slug": "slug", "shortDescription": "One sentence", "description": "2-3 sentences with ${input.businessName} and ${region}", "icon": "ICON", "features": ["f1","f2","f3","f4","f5"], "links": [], "seoTitle": "Service | ${input.businessName}", "seoDescription": "SEO desc", "visible": true, "order": 1 }],
  "settings": { "defaultMetaTitle": "${input.businessName} - ${input.location.city} ${input.businessType}", "defaultMetaDescription": "150 char SEO desc" },
  "posts": [{ "id": "blog1", "title": "TITLE", "slug": "slug", "excerpt": "2 sentences", "content": "FULL 400-800 WORD ARTICLE with ## headings", "published": true, "category": "CAT", "tags": ["t1","t2"], "seoTitle": "Title | ${input.businessName}", "seoDescription": "SEO desc", "author": "${input.ownerName || input.businessName}" }],
  "pages": {
    "privacy-policy": { "id": "privacy-policy", "title": "Privacy Policy", "slug": "privacy-policy", "content": "FULL PRIVACY POLICY HTML for ${input.businessName} in ${location}", "seoTitle": "Privacy Policy | ${input.businessName}", "published": true },
    "terms-of-service": { "id": "terms-of-service", "title": "Terms of Service", "slug": "terms-of-service", "content": "FULL TERMS HTML for ${input.businessName} in ${location}, governed by ${input.location.stateFull || input.location.state} law", "seoTitle": "Terms | ${input.businessName}", "published": true }
  }
}`

  const message = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    max_tokens: 32000,
    messages: [{ role: 'user', content: prompt }],
  })

  const textBlock = message.content.find((b: any) => b.type === 'text')
  if (!textBlock) throw new Error('AI returned no text content')

  const raw = (textBlock as any).text.trim()
  const cleaned = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()

  let parsed: any
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    // Retry once on parse failure
    console.warn('[ContentGenerator] First parse failed, retrying...')
    const retry = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 32000,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: raw },
        { role: 'user', content: 'Your previous response was not valid JSON. Please return ONLY valid JSON with no markdown wrapping, no trailing commas, and no comments.' },
      ],
    })
    const retryBlock = retry.content.find((b: any) => b.type === 'text')
    if (!retryBlock) throw new Error('AI retry returned no text content')
    const retryRaw = (retryBlock as any).text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
    parsed = JSON.parse(retryRaw)
  }

  // Fill in defaults and normalize the response
  const result = normalizeContent(parsed, input, serviceAreas, now)

  // Fill empty service-card images so cards are never blank. Prefer the live
  // Unsplash+ pool (relevant, only when an Unsplash key is configured), else our
  // curated fallback library. The composer itself leaves service.image = ''.
  try {
    let pool: string[] = []
    try {
      const { searchStockPhotosForBusiness } = await import('./unsplashPlus')
      // Pass the full product/description context (not just services[0]) so the
      // Pexels query derivation returns on-theme, per-category imagery.
      const photos = await searchStockPhotosForBusiness(input.businessType, input.services, input.location?.city, input.description, input.businessName)
      pool = (photos || []).map((p: any) => p.url).filter(Boolean)
    } catch { /* unsplash not configured / failed — fall back to the library */ }
    const { getServiceImage } = await import('../config/serviceImageLibrary')
    result.services.forEach((s: any, i: number) => {
      if (s.image) return
      s.image = (pool.length ? pool[i % pool.length] : '') || getServiceImage(input.businessType, i)
    })
    // Fill the HERO + CTA background too — previously these were left '' (see
    // normalizeContent), so a deployed site showed the raw "replace your photo"
    // placeholder. Use the same source the service cards do.
    if (!result.homepage.hero.image) {
      result.homepage.hero.image = pool[0] || getServiceImage(input.businessType, 0)
    }
    if (!result.homepage.ctaSection.backgroundImage) {
      result.homepage.ctaSection.backgroundImage = pool[1] || pool[0] || getServiceImage(input.businessType, 1)
    }
  } catch { /* never block content generation on image fill */ }

  // Quality gate — a broken auto-build must never reach a customer. Hard-fails
  // (throws) only on unshippable output: unresolved {{tokens}}, lorem-ipsum
  // filler, or a missing services section. Thinner issues (empty hero/about,
  // short posts, missing local-SEO signals, no phone in the CTA) are logged
  // for review but do not block the deploy.
  const quality = validateGeneratedContent(result, input)
  if (quality.warnings.length) {
    console.warn('[ContentGenerator] Quality warnings for "' + input.businessName + '":\n  - ' + quality.warnings.join('\n  - '))
  }
  if (quality.errors.length) {
    console.error('[ContentGenerator] Quality gate FAILED for "' + input.businessName + '":\n  - ' + quality.errors.join('\n  - '))
    throw new ContentQualityError(quality.errors, quality.warnings)
  }

  return result
}

function normalizeContent(
  parsed: any,
  input: ContentGenerationInput,
  serviceAreas: string[],
  now: string
): GeneratedContent {
  const homepage = parsed.homepage || {}
  const hero = homepage.hero || {}
  const phone = input.phone || ''
  const phoneRaw = phone.replace(/\D/g, '')

  return {
    homepage: {
      hero: {
        tagline: hero.tagline || input.businessType + ' Services',
        title: hero.title || input.businessName,
        subtitle: hero.subtitle || 'Serving ' + (input.serviceRegion || input.location.city),
        description: hero.description || '',
        image: '',
        animation: 'ken-burns',
        primaryButtonText: hero.primaryButtonText || 'Get in Touch',
        primaryButtonLink: hero.primaryButtonLink || '#contact',
        secondaryButtonText: hero.secondaryButtonText || 'Our Services',
        secondaryButtonLink: hero.secondaryButtonLink || '/services',
      },
      trustBadges: (homepage.trustBadges || []).map((b: any) => ({
        id: b.id || crypto.randomUUID(),
        type: b.type || 'custom',
        label: b.label || '',
        sublabel: b.sublabel || '',
        icon: b.icon || 'star',
        enabled: b.enabled !== false,
      })),
      ctaSection: {
        title: homepage.ctaSection?.title || 'Ready to get started?',
        description: homepage.ctaSection?.description || 'Contact us today.',
        primaryButtonText: homepage.ctaSection?.primaryButtonText || 'Contact Us',
        primaryButtonLink: homepage.ctaSection?.primaryButtonLink || '#contact',
        secondaryButtonText: phone ? 'Call ' + phone : 'Learn More',
        secondaryButtonLink: phone ? 'tel:' + phoneRaw : '/services',
        backgroundImage: '',
        headline: homepage.ctaSection?.headline || '',
        subtext: homepage.ctaSection?.subtext || '',
      },
      serviceAreas,
      businessHours: homepage.businessHours || {
        monday: { open: '9:00 AM', close: '5:00 PM', closed: false },
        tuesday: { open: '9:00 AM', close: '5:00 PM', closed: false },
        wednesday: { open: '9:00 AM', close: '5:00 PM', closed: false },
        thursday: { open: '9:00 AM', close: '5:00 PM', closed: false },
        friday: { open: '9:00 AM', close: '5:00 PM', closed: false },
        saturday: { open: 'Closed', close: 'Closed', closed: true },
        sunday: { open: 'Closed', close: 'Closed', closed: true },
      },
      aboutSection: {
        title: homepage.aboutSection?.title || 'Why Choose ' + input.businessName,
        text: homepage.aboutSection?.text || '',
        image: '',
      },
    },
    services: (parsed.services || []).map((s: any, i: number) => ({
      id: s.id || 'service-' + (i + 1),
      name: s.name || 'Service ' + (i + 1),
      title: s.title || s.name || '',
      slug: s.slug || s.id || 'service-' + (i + 1),
      shortDescription: s.shortDescription || '',
      description: s.description || '',
      icon: s.icon || 'star',
      image: '',
      features: s.features || [],
      links: (s.links || []).map((l: any) => ({ label: l.label || '', href: l.href || '' })),
      seoTitle: s.seoTitle || '',
      seoDescription: s.seoDescription || '',
      visible: true,
      order: i + 1,
    })),
    settings: {
      defaultMetaTitle: parsed.settings?.defaultMetaTitle || input.businessName + ' - ' + input.location.city + ' ' + input.businessType,
      defaultMetaDescription: parsed.settings?.defaultMetaDescription || '',
    },
    posts: (parsed.posts || []).map((p: any, i: number) => ({
      id: p.id || 'blog' + (i + 1),
      title: p.title || '',
      slug: p.slug || 'post-' + (i + 1),
      excerpt: p.excerpt || '',
      content: p.content || '',
      featuredImage: '',
      published: true,
      category: p.category || 'General',
      tags: p.tags || [],
      seoTitle: p.seoTitle || '',
      seoDescription: p.seoDescription || '',
      author: p.author || input.ownerName || input.businessName,
      createdAt: now,
      updatedAt: now,
    })),
    pages: normalizePages(parsed.pages || {}, input, now),
    testimonials: [],
    gallery: [],
  }
}

function normalizePages(
  pages: any,
  input: ContentGenerationInput,
  now: string
): Record<string, GeneratedPage> {
  const result: Record<string, GeneratedPage> = {}
  for (const [slug, page] of Object.entries(pages as Record<string, any>)) {
    result[slug] = {
      id: page.id || slug,
      title: page.title || slug.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
      slug,
      content: page.content || '',
      description: page.description || '',
      heroImage: '',
      heroAnimation: '',
      seoTitle: page.seoTitle || '',
      seoDescription: page.seoDescription || '',
      published: true,
      createdAt: now,
      updatedAt: now,
    }
  }
  return result
}

// ─── Content quality gate ────────────────────────────────────────────────────
// Phase 4 of docs/content-quality-plan.md. Runs on the finished content right
// before it's seeded into a tenant, so a bad AI build never ships silently.
// HARD failures throw (unresolved {{tokens}}, lorem-ipsum, no services);
// everything else is a warning that's logged but not blocked.

export class ContentQualityError extends Error {
  errors: string[]
  warnings: string[]
  constructor(errors: string[], warnings: string[]) {
    super('Content quality gate failed:\n  - ' + errors.join('\n  - '))
    this.name = 'ContentQualityError'
    this.errors = errors
    this.warnings = warnings
  }
}

function qgWordCount(s: any): number {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')      // strip HTML tags
    .replace(/[#>*_`|-]+/g, ' ')   // strip markdown punctuation
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
}

// Collect every customer-visible text field as { label, text } pairs.
function qgCollectStrings(c: any): Array<{ label: string; text: string }> {
  const out: Array<{ label: string; text: string }> = []
  const add = (label: string, text: any) => {
    if (typeof text === 'string' && text.trim()) out.push({ label, text })
  }
  const h = c.homepage || {}
  add('hero.tagline', h.hero?.tagline); add('hero.title', h.hero?.title)
  add('hero.subtitle', h.hero?.subtitle); add('hero.description', h.hero?.description)
  add('about.title', h.aboutSection?.title); add('about.text', h.aboutSection?.text)
  add('cta.title', h.ctaSection?.title); add('cta.description', h.ctaSection?.description)
  add('cta.headline', h.ctaSection?.headline); add('cta.subtext', h.ctaSection?.subtext)
  ;(h.trustBadges || []).forEach((b: any, i: number) => {
    add('trustBadge[' + i + '].label', b.label); add('trustBadge[' + i + '].sublabel', b.sublabel)
  })
  ;(c.services || []).forEach((s: any, i: number) => {
    add('service[' + i + '].name', s.name)
    add('service[' + i + '].shortDescription', s.shortDescription)
    add('service[' + i + '].description', s.description)
    add('service[' + i + '].seoTitle', s.seoTitle)
    add('service[' + i + '].seoDescription', s.seoDescription)
  })
  ;(c.posts || []).forEach((p: any, i: number) => {
    add('post[' + i + '].title', p.title); add('post[' + i + '].excerpt', p.excerpt); add('post[' + i + '].content', p.content)
  })
  Object.keys(c.pages || {}).forEach((slug) => {
    add('page[' + slug + '].title', c.pages[slug]?.title)
    add('page[' + slug + '].content', c.pages[slug]?.content)
  })
  add('meta.title', c.settings?.defaultMetaTitle)
  add('meta.description', c.settings?.defaultMetaDescription)
  return out
}

export function validateGeneratedContent(
  content: GeneratedContent,
  input: ContentGenerationInput
): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const c: any = content
  const strings = qgCollectStrings(c)
  const city = (input.location?.city || '').trim()

  // ── HARD failures — unshippable, throw ──
  for (const { label, text } of strings) {
    const tok = text.match(/\{\{[^}]+\}\}/)
    if (tok) errors.push('Unresolved placeholder "' + tok[0] + '" in ' + label)
    if (/lorem\s+ipsum/i.test(text)) errors.push('Lorem-ipsum filler in ' + label)
  }
  if (!(c.services || []).length) errors.push('No services were generated')

  // ── SOFT — logged for review, not blocked ──
  if (!String(c.homepage?.hero?.description || '').trim()) warnings.push('Hero description is empty')
  if (!String(c.homepage?.aboutSection?.text || '').trim()) warnings.push('About section is empty')
  if (!String(c.settings?.defaultMetaDescription || '').trim()) warnings.push('Meta description is empty (SEO)')

  ;(c.services || []).forEach((s: any, i: number) => {
    const w = qgWordCount(s.description)
    if (w === 0) warnings.push('service[' + i + '] "' + (s.name || '?') + '" has no description')
    else if (w < 15) warnings.push('service[' + i + '] "' + (s.name || '?') + '" description is thin (' + w + ' words)')
  })
  ;(c.posts || []).forEach((p: any) => {
    const w = qgWordCount(p.content)
    if (w < 300) warnings.push('post "' + (p.title || 'untitled') + '" is short (' + w + ' words; target 400-800)')
  })

  if (city) {
    const mt = String(c.settings?.defaultMetaTitle || '').toLowerCase()
    const md = String(c.settings?.defaultMetaDescription || '').toLowerCase()
    if (mt && !mt.includes(city.toLowerCase())) warnings.push('Meta title missing city "' + city + '" (local SEO)')
    if (md && !md.includes(city.toLowerCase())) warnings.push('Meta description missing city "' + city + '" (local SEO)')
  }

  if (input.phone) {
    const digits = input.phone.replace(/\D/g, '')
    const cta = c.homepage?.ctaSection || {}
    const blob = [cta.subtext, cta.secondaryButtonText, cta.secondaryButtonLink].join(' ').replace(/\D/g, '')
    if (digits && !blob.includes(digits)) warnings.push('Phone number not surfaced in the CTA section')
  }

  return { errors, warnings }
}

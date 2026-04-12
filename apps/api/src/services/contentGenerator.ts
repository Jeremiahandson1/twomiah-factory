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
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const location = [input.location.city, input.location.state].filter(Boolean).join(', ') || 'your area'
  const region = input.serviceRegion || input.location.city || 'the area'
  const servicesList = input.services.length > 0 ? input.services.join(', ') : 'general services'
  const nearbyCities = (input.nearbyCities || []).filter(Boolean)
  const serviceAreas = [input.location.city, ...nearbyCities].filter(Boolean)
  const now = new Date().toISOString()

  // Load industry content pack
  const pack = loadContentPack(input.businessType)
  if (pack) {
    console.log('[ContentGenerator] Using content pack for:', pack.vertical || input.businessType)
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

  const prompt = `You are customizing website content for a specific business.${pack ? ' You have industry-specific content to work from — adapt it, don\'t start from scratch.' : ' Generate unique, professional, SEO-optimized content.'}

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
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 12000,
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
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 12000,
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

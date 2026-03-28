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

export async function generateWebsiteContent(input: ContentGenerationInput): Promise<GeneratedContent> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const location = [input.location.city, input.location.state].filter(Boolean).join(', ') || 'your area'
  const region = input.serviceRegion || input.location.city || 'the area'
  const servicesList = input.services.length > 0 ? input.services.join(', ') : 'general services'
  const nearbyCities = (input.nearbyCities || []).filter(Boolean)
  const serviceAreas = [input.location.city, ...nearbyCities].filter(Boolean)
  const now = new Date().toISOString()

  const prompt = `You are generating complete website content for a business. Generate unique, professional, SEO-optimized content tailored to this specific business.

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

Generate a JSON object with these exact keys. All content should be specific to this business type and location.

IMPORTANT RULES:
- Write compelling, natural copy — not generic filler
- Include the city/region name naturally in content for local SEO
- Use the company name where appropriate
- Each service must have unique, detailed content
- Blog posts should be genuinely useful to the target audience
- Privacy policy and terms should reference the actual company name and location
- Icon values must be one of: ${ICON_OPTIONS.join(', ')}

Return ONLY valid JSON (no markdown, no explanation) with this structure:

{
  "homepage": {
    "hero": {
      "tagline": "SHORT 3-6 WORD BADGE (e.g. 'Award-Winning Dental Care')",
      "title": "COMPELLING HEADLINE (use city name)",
      "subtitle": "SUPPORTING TAGLINE",
      "description": "2-3 SENTENCE DESCRIPTION of the business",
      "primaryButtonText": "CTA BUTTON TEXT",
      "primaryButtonLink": "#contact",
      "secondaryButtonText": "SECONDARY BUTTON",
      "secondaryButtonLink": "/services"
    },
    "trustBadges": [
      { "id": "badge1", "type": "custom", "label": "BADGE LABEL", "sublabel": "SUPPORTING TEXT", "icon": "ICON_NAME", "enabled": true },
      { "id": "badge2", "type": "custom", "label": "BADGE LABEL", "sublabel": "SUPPORTING TEXT", "icon": "ICON_NAME", "enabled": true },
      { "id": "badge3", "type": "custom", "label": "BADGE LABEL", "sublabel": "SUPPORTING TEXT", "icon": "ICON_NAME", "enabled": true }
    ],
    "ctaSection": {
      "title": "CTA SECTION TITLE (can use newlines)",
      "description": "CTA DESCRIPTION",
      "primaryButtonText": "CTA BUTTON",
      "primaryButtonLink": "#contact",
      "headline": "ONE SENTENCE CALL TO ACTION",
      "subtext": "SUPPORTING LINE with phone number if available"
    },
    "aboutSection": {
      "title": "WHY CHOOSE [COMPANY] TITLE",
      "text": "2-3 PARAGRAPH ABOUT TEXT - compelling and specific to this business"
    }
  },
  "services": [
    FOR EACH SERVICE, generate:
    {
      "id": "kebab-case-id",
      "name": "Service Name",
      "title": "Service Title",
      "slug": "kebab-case-slug",
      "shortDescription": "One sentence summary",
      "description": "2-3 sentence detailed description mentioning ${input.businessName} and ${region}",
      "icon": "ICON_FROM_LIST",
      "features": ["Feature 1", "Feature 2", "Feature 3", "Feature 4", "Feature 5"],
      "links": [{"label": "Sub-topic", "href": "/services/SLUG"}],
      "seoTitle": "Service Name in ${input.location.city}, ${input.location.state} | ${input.businessName}",
      "seoDescription": "SEO description mentioning location and company",
      "visible": true,
      "order": NUMBER
    }
  ],
  "settings": {
    "defaultMetaTitle": "${input.businessName} - ${input.location.city} ${input.businessType}",
    "defaultMetaDescription": "150-160 char SEO description for the whole site"
  },
  "posts": [
    Generate exactly 3 SEO-optimized blog posts relevant to this business type and location:
    {
      "id": "blog1",
      "title": "ARTICLE TITLE",
      "slug": "kebab-case-slug",
      "excerpt": "2 sentence summary",
      "content": "FULL ARTICLE with markdown headings (##), bold text, and bullet points. 400-600 words. Educational and useful.",
      "published": true,
      "category": "RELEVANT CATEGORY",
      "tags": ["tag1", "tag2", "tag3"],
      "seoTitle": "SEO TITLE | ${input.businessName}",
      "seoDescription": "SEO description for this post",
      "author": "${input.ownerName || input.businessName}"
    }
  ],
  "pages": {
    "privacy-policy": {
      "id": "privacy-policy",
      "title": "Privacy Policy",
      "slug": "privacy-policy",
      "content": "FULL PRIVACY POLICY in HTML. Reference ${input.businessName}, ${location}. Cover: data collection, cookies, third parties, contact info, CCPA/GDPR basics. Use <h2>, <p>, <ul> tags.",
      "description": "Privacy policy for ${input.businessName}",
      "seoTitle": "Privacy Policy | ${input.businessName}",
      "seoDescription": "Privacy policy for ${input.businessName} in ${location}.",
      "published": true
    },
    "terms-of-service": {
      "id": "terms-of-service",
      "title": "Terms of Service",
      "slug": "terms-of-service",
      "content": "FULL TERMS OF SERVICE in HTML. Reference ${input.businessName}, ${location}. Cover: service terms, liability, payments, cancellation, governing law (${input.location.stateFull || input.location.state}). Use <h2>, <p>, <ul> tags.",
      "description": "Terms of service for ${input.businessName}",
      "seoTitle": "Terms of Service | ${input.businessName}",
      "seoDescription": "Terms of service for ${input.businessName} in ${location}.",
      "published": true
    }
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

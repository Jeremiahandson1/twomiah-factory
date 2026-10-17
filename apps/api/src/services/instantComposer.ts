/**
 * The premium site, composed instantly from the owner's own facts — no model call.
 *
 * composeSite() has Claude write the pages (minutes, real cost). This builds the same shape from
 * what the owner told us, the way the standard templates fill their tokens: their name, their trade
 * and town, their services (or one card for the trade when they listed none — the standard sites
 * do the same), their description, contact details and the optional facts (credentials, reviews,
 * hours, photos). Everything then goes through enforceIntakeFacts, the same gate the AI's output
 * passes, so it can only state what the owner supplied. AI copy stays an optional upgrade on top.
 *
 * Returns composeSite()'s SiteResult, so the preview renderer, site-bootstrap and deploy take either.
 */
import { enforceIntakeFacts } from './composerFacts'
import { SECTION_SCHEMA, pageRecipesFor, type ComposerInput, type Section } from './sectionComposer'
import { getHeroLibrary } from '../config/heroLibrary'
import { websiteTradeFor } from '../config/websiteTrades'

type SiteResult = {
  pages: Record<string, Section[]>
  heldPages: string[]
  contentGaps: ReturnType<typeof enforceIntakeFacts>['contentGaps']
  removedClaims: string[]
  rationale?: string
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

/** The owner's description, split into short paragraphs for about/story. */
function paragraphsOf(text: string): string[] {
  const parts = text.split(/\n\s*\n+/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (parts.length > 1) return parts.slice(0, 4)
  // One block: break it into paragraphs of about three sentences.
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || []
  const out: string[] = []
  for (let i = 0; i < sentences.length; i += 3) out.push(sentences.slice(i, i + 3).join('').trim())
  return out.filter(Boolean).slice(0, 4)
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

export function composeInstant(input: ComposerInput): SiteResult {
  const name = input.businessName.trim()
  const label = tradeLabelFor(input.businessType || '')
  const place = [input.city, input.state].filter(Boolean).join(', ')
  const services = (input.services || []).map((s) => String(s).trim()).filter(Boolean)
  // Their services, else one card for the trade (as the standard site does), else none.
  const serviceNames = services.length ? services : label ? [websiteTradeFor(input.businessType?.toLowerCase().replace(/\s+/g, '_'))?.service || label] : []
  const ownPhotos = (input.customerPhotos || []).map((p) => p.url).filter(Boolean)
  const heroImage = ownPhotos[0] || libraryHeroFor(input.businessType || '')
  const contactCta = { label: 'Get in touch', href: 'contact' }
  const f = input.facts || {}

  const home: Section[] = [
    // A photo hero when there's a photo; with none, the centered hero (no empty image box).
    { type: 'hero', variant: heroImage ? 'full-bleed' : 'centered-stats', data: {
      ...(heroImage ? { image: heroImage } : {}), eyebrow: [label, place].filter(Boolean).join(' · '), title: name,
      subtitle: firstSentence(input.description) || (place ? (label ? label + ' in ' + place : 'Serving ' + place) + '.' : ''),
      primaryCta: contactCta,
    } },
  ]
  if (serviceNames.length) home.push({ type: 'services', variant: 'cards-grid', data: { heading: 'What we do', items: serviceNames.map((title) => ({ title })) } })
  if (f.credentials?.length) home.push({ type: 'trust', variant: 'badges', data: { heading: 'Credentials', items: f.credentials.map((n) => ({ name: n })) } })
  if (f.testimonials?.length) home.push({ type: 'testimonials', variant: 'quotes', data: { heading: 'What customers say', items: f.testimonials.map((t) => ({ quote: t.quote, author: t.author || '' })) } })
  if (ownPhotos.length >= 3) home.push({ type: 'gallery', variant: 'grid', data: { heading: 'Our work', photos: ownPhotos.slice(0, 9).map((url) => ({ url })) } })
  home.push({ type: 'cta', variant: 'banner', data: { heading: 'Talk to ' + name, subtitle: place ? 'Serving ' + place + '.' : '', primaryCta: contactCta } })

  // Sections a trade's site opens with: the age gate (dispensary), the urgent-care or emergency call
  // bar (vet, field service). The facts gate below drops a bar the owner gave no facts for.
  const homeSeq = pageRecipesFor(input.businessType || '').home?.required_sequence || ''
  if (/\bage\/modal\b/.test(homeSeq)) home.unshift({ type: 'age', variant: 'modal', data: { gateAge: 21 } })
  if (/\burgent\/bar\b/.test(homeSeq)) home.unshift({ type: 'urgent', variant: 'bar', data: { heading: 'Sick or injured pet?', phone: input.phone || '' } })
  if (/\bemergency\/bar\b/.test(homeSeq)) home.unshift({ type: 'emergency', variant: 'bar', data: { phone: input.phone || '' } })

  const pages: Record<string, Section[]> = { home }
  // A bar's home is the live Tonight board — it replaces the hero — and its menu, taps, events and
  // hours come live from the bar's CRM, so these pages are framing only and state no fact. Without
  // this branch a bar got the hero + "What we do" home and none of these pages (Test Bar Run 1).
  const isBar = /\btonight\/board\b/.test(homeSeq)
  if (isBar) {
    const toVisit = (): Section => ({ type: 'cta', variant: 'banner', data: { heading: 'Visit ' + name, subtitle: place ? 'Serving ' + place + '.' : '', primaryCta: { label: 'Find us', href: 'visit' } } })
    pages.home = [
      { type: 'tonight', variant: 'board', data: { title: name } },
      ...(input.description ? [{ type: 'about', variant: 'story', data: { title: 'About ' + name, paragraphs: paragraphsOf(input.description) } }] : []),
      ...(ownPhotos.length >= 3 ? [{ type: 'gallery', variant: 'grid', data: { photos: ownPhotos.slice(0, 9).map((url) => ({ url })) } }] : []),
      toVisit(),
    ]
    pages.menu = [{ type: 'menu', variant: 'sections', data: { asHeading: true } }, toVisit()]
    pages.taps = [{ type: 'taps', variant: 'wall', data: { asHeading: true } }, toVisit()]
    pages.events = [{ type: 'events', variant: 'list', data: { asHeading: true } }, toVisit()]
    // The partial's own default heading ("Book the back booths") names a room this bar may not have.
    pages.parties = [{ type: 'parties', variant: 'inquiry-form', data: { heading: 'Private parties', asHeading: true } }]
    pages.visit = [
      { type: 'visit', variant: 'details', data: { heading: 'Find us', asHeading: true } },
      { type: 'hours', variant: 'table', data: {} },
      { type: 'cta', variant: 'banner', data: { heading: 'Talk to ' + name, primaryCta: contactCta } },
    ]
  }
  if (serviceNames.length && !isBar) pages.services = [
    { type: 'hero', variant: 'centered-stats', data: { eyebrow: 'Services', title: label ? (place ? label + ' in ' + place : label) : 'What we do' } },
    { type: 'services', variant: 'cards-grid', data: { heading: 'What we do', items: serviceNames.map((title) => ({ title })) } },
    { type: 'cta', variant: 'banner', data: { heading: 'Ask us about your project', primaryCta: contactCta } },
  ]
  pages.about = input.description
    ? [{ type: 'about', variant: 'story', data: { title: 'About ' + name, paragraphs: paragraphsOf(input.description), ...(input.ownerName ? { signature: input.ownerName } : {}) } },
       { type: 'cta', variant: 'banner', data: { heading: 'Talk to ' + name, primaryCta: contactCta } }]
    : [{ type: 'hero', variant: 'centered-stats', data: { eyebrow: 'About', title: 'About ' + name } }]
  pages.contact = [{ type: 'contact', variant: 'form-info', data: {
    heading: 'Get in touch', ...(input.phone ? { phone: input.phone } : {}), ...(input.email ? { email: input.email } : {}),
    ...(place ? { address: place } : {}),
  } }]

  // Only pages this trade's site has (a food truck has no "services" page, a vet no "projects").
  const recipe = pageRecipesFor(input.businessType || '')
  for (const slug of Object.keys(pages)) if (slug !== 'home' && slug !== 'contact' && !(slug in recipe)) delete pages[slug]
  const allowedTypes = new Set(Object.values(recipe).flatMap((r) => [...r.allowed_types]))

  const enforced = enforceIntakeFacts(pages, input, { requiredOf, allowedTypes })
  return {
    pages: enforced.pages,
    heldPages: enforced.heldPages,
    contentGaps: enforced.contentGaps,
    removedClaims: enforced.removedClaims.slice(0, 60),
    rationale: 'Instant composition from the owner\'s facts (no model call).',
  }
}

// Structured data for the public site: schema.org JSON-LD, built from what the owner gave and nothing else.
//
// What this is for: a machine-readable statement of the facts the page already shows — the business, its services, its
// hours, where it is, the questions it answers, where this page sits in the site. It is for accuracy. A valid type does
// not earn a Google rich result, and nothing here is built to, or claims to; Google decides what to show, from its own
// rules, and those change. Nothing is invented to fill a field: with no hours there is no openingHoursSpecification, with
// no social links no sameAs, and there are no ratings or reviews at all — the site does not collect them as data, and a
// star count the owner did not earn would be exactly the kind of claim the rest of the site refuses to make.
//
// One @graph per page: the business (every page), the service (a /services/<slug> page), the page's questions (a page with
// an FAQ section) and its breadcrumb trail (every page but the home page). Pure — tests/site-structured-data.test.ts renders
// real pages and checks this against schema.org's own vocabulary.
import { WEEK_DAYS, type BusinessHours } from '@twomiah/tenant-backend'
import type { SiteContext } from './context.ts'

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/**
 * The most specific schema.org type for the business's trade, from its vertical and the trade its home page names — and
 * LocalBusiness whenever that is not certain. Only types that exist in schema.org are used (a type that does not, such as
 * "HomeHealthCareService", would make the whole block meaningless to a validator); a vet is a MedicalOrganization there, not
 * a LocalBusiness, so it carries both types and with them the address, hours and area properties a LocalBusiness has.
 */
export function schemaTypeFor(vertical: string, trade: string): string | string[] {
  const t = trade.toLowerCase()
  const has = (re: RegExp) => re.test(t)
  switch (vertical) {
    case 'roofing': return 'RoofingContractor'
    case 'contractor': return 'GeneralContractor'
    case 'vet': return ['LocalBusiness', 'VeterinaryCare']
    case 'store': return 'Store'
    case 'bar': return 'BarOrPub'
    case 'rv': return 'AutomotiveBusiness'
    case 'restaurant': return has(/cater/) ? 'FoodEstablishment' : has(/caf[eé]|coffee/) ? 'CafeOrCoffeeShop' : 'Restaurant'
    case 'salon':
      return has(/nail/) ? 'NailSalon' : has(/\bspa\b|massage/) ? 'DaySpa' : has(/hair|barber|salon/) ? 'HairSalon' : has(/lash|brow|beauty|esthetic|wax/) ? 'BeautySalon' : 'HealthAndBeautyBusiness'
    case 'fieldservice':
    case 'basic':
      return has(/hvac|heating|cooling|air condition|furnace/) ? 'HVACBusiness'
        : has(/plumb|drain|sewer/) ? 'Plumber'
        : has(/electric/) ? 'Electrician'
        : has(/paint/) ? 'HousePainter'
        : has(/locksmith/) ? 'Locksmith'
        : 'LocalBusiness'
    // Landscaping and home care have no schema.org type of their own that is certain: LocalBusiness.
    default: return 'LocalBusiness'
  }
}

const DAY_URL: Record<string, string> = {
  monday: 'https://schema.org/Monday', tuesday: 'https://schema.org/Tuesday', wednesday: 'https://schema.org/Wednesday',
  thursday: 'https://schema.org/Thursday', friday: 'https://schema.org/Friday', saturday: 'https://schema.org/Saturday', sunday: 'https://schema.org/Sunday',
}

/**
 * The business's own saved week (Settings › Company) as openingHoursSpecification: days with the same hours share one entry.
 * A closed day, or a day never said, has no entry; with no hours saved the result is empty, and nothing is published.
 */
export function openingHoursSpecification(hours: BusinessHours | null | undefined) {
  if (!hours) return []
  const groups = new Map<string, { days: string[]; opens: string; closes: string }>()
  for (const day of WEEK_DAYS) {
    const h = hours[day]
    if (!h || h.closed || !h.open || !h.close) continue
    const key = h.open + '-' + h.close
    const g = groups.get(key) ?? { days: [], opens: h.open, closes: h.close }
    g.days.push(DAY_URL[day])
    groups.set(key, g)
  }
  return [...groups.values()].map((g) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: g.days, opens: g.opens, closes: g.closes }))
}

const SOCIAL_URL: Record<string, (h: string) => string> = {
  instagram: (h) => 'https://instagram.com/' + h,
  tiktok: (h) => 'https://tiktok.com/@' + h,
}

/** The profiles the owner linked from a "Follow us" section on any of their pages — the only social links the site holds. */
export function socialLinksOf(pages: Array<{ sections: unknown; isPublished?: boolean }>): string[] {
  const out: string[] = []
  for (const p of pages) {
    if (p.isPublished === false) continue
    for (const s of Array.isArray(p.sections) ? p.sections : []) {
      if (!s || s.type !== 'social') continue
      const handle = str(s.data?.handle).replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '')
      const url = handle ? SOCIAL_URL[str(s.data?.platform).toLowerCase() || 'instagram']?.(handle) : ''
      if (url && !out.includes(url)) out.push(url)
    }
  }
  return out
}

export interface LdPage {
  /** The site's origin ("https://example.com"); with none there is no markup (the editor's preview, signup preview). */
  origin: string
  /** The page's path ("/", "/services/roof-repair"). */
  path: string
  /** The page's own title: the last step of its breadcrumb. */
  title: string
  /** The sections the page shows. */
  sections: any[]
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

/** The JSON-LD for a page, as a string safe to print inside a script tag; '' when there is nothing to say. */
export function structuredDataFor(ctx: SiteContext, settings: Record<string, any>, page: LdPage): string {
  const origin = page.origin.replace(/\/+$/, '')
  const name = str(settings.companyName)
  if (!origin || !name) return ''
  const abs = (u: string) => (u.charAt(0) === '/' && u.charAt(1) !== '/' ? origin + u : u)
  const url = origin + (page.path === '/' ? '/' : page.path.replace(/\/+$/, ''))
  const businessId = origin + '/#business'

  // ── the business ──────────────────────────────────────────────────────
  // Only the facts in the owner's settings, and nothing is filled in when a field is empty. The AREA only (city, state): the
  // street in settings.address is often the owner's home, and the site itself never shows it, so the markup must not
  // publish it either. The synthesized /images/logo.svg is a placeholder, never the business's logo.
  const biz: Record<string, any> = { '@type': schemaTypeFor(ctx.vertical || '', ctx.trade || ''), '@id': businessId, name, url: origin + '/' }
  if (settings.phone) biz.telephone = settings.phone
  if (settings.email) biz.email = settings.email
  const areas = (Array.isArray(settings.serviceAreas) ? settings.serviceAreas : []).map((a: any) => str(a && typeof a === 'object' ? a.name : a)).filter(Boolean)
  if (areas.length) biz.areaServed = areas.map((n: string) => ({ '@type': 'Place', name: n }))
  const line = str(settings.address).split(',').map((s) => s.trim()).filter(Boolean)
  if (settings.addressLocality && settings.addressRegion) biz.address = { '@type': 'PostalAddress', addressLocality: settings.addressLocality, addressRegion: settings.addressRegion }
  else if (line.length >= 2) biz.address = { '@type': 'PostalAddress', addressLocality: line[line.length - 2], addressRegion: line[line.length - 1] }
  const logo = settings.logoUrl && settings.logoUrl !== '/images/logo.svg' ? abs(String(settings.logoUrl)) : ''
  if (logo) { biz.logo = logo; biz.image = logo }
  const hours = openingHoursSpecification(settings.businessHours)
  if (hours.length) biz.openingHoursSpecification = hours
  const sameAs = (Array.isArray(settings.sameAs) && settings.sameAs.length ? settings.sameAs : settings.socialLinks) as unknown
  if (Array.isArray(sameAs) && sameAs.length) biz.sameAs = sameAs.map(str).filter(Boolean)

  // The services the site lists: a page of their own where they have one, else just the name and what the owner said.
  const byTitle = new Map<string, { name: string; description: string; url?: string }>()
  for (const p of ctx.servicePages ?? []) byTitle.set(p.title.toLowerCase(), { name: p.title, description: clip(str(p.description.split(/\n{2,}/)[0]), 300), url: origin + '/services/' + p.slug })
  for (const s of ctx.services ?? []) if (str(s.title) && !byTitle.has(str(s.title).toLowerCase())) byTitle.set(str(s.title).toLowerCase(), { name: str(s.title), description: clip(str(s.description), 300) })
  const offered = [...byTitle.values()].slice(0, 30)
  if (offered.length) {
    biz.hasOfferCatalog = {
      '@type': 'OfferCatalog', name: 'Services',
      itemListElement: offered.map((s) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: s.name, ...(s.description ? { description: s.description } : {}), ...(s.url ? { url: s.url } : {}) } })),
    }
  }
  const graph: Array<Record<string, any>> = [biz]

  // ── a service's own page ──────────────────────────────────────────────
  const svc = (ctx.servicePages ?? []).find((p) => '/services/' + p.slug === page.path)
  if (svc) {
    const node: Record<string, any> = { '@type': 'Service', '@id': url + '#service', name: svc.title, url, provider: { '@id': businessId } }
    const text = svc.description.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).join(' ')
    if (text) node.description = clip(text, 1000)
    if (svc.image) node.image = abs(svc.image)
    const served = areas.length ? areas : (settings.addressLocality && settings.addressRegion ? [settings.addressLocality + ', ' + settings.addressRegion] : [])
    if (served.length) node.areaServed = served.map((n: string) => ({ '@type': 'Place', name: n }))
    if (svc.subServices.length) {
      node.hasOfferCatalog = {
        '@type': 'OfferCatalog', name: svc.title,
        itemListElement: svc.subServices.map((s) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: s.title, ...(s.description ? { description: s.description } : {}), url: url + '#' + s.slug } })),
      }
    }
    graph.push(node)
  }

  // ── the page's questions ──────────────────────────────────────────────
  // FAQPage, and only for questions and answers the page actually shows (the same filter the FAQ section's view applies).
  // Google limits FAQ rich results mainly to well-known government and health sites, so this is here because it is an
  // accurate description of the page — not because it is expected to change how the page looks in search.
  const qa = page.sections.filter((s) => s && s.type === 'faq').flatMap((s) => (Array.isArray(s.data?.items) ? s.data.items : []))
    .filter((it: any) => it && str(it.question) && str(it.answer))
  if (qa.length) {
    graph.push({
      '@type': 'FAQPage', '@id': url + '#faq', url, name: page.title || name,
      mainEntity: qa.map((it: any) => ({ '@type': 'Question', name: str(it.question), acceptedAnswer: { '@type': 'Answer', text: str(it.answer) } })),
    })
  }

  // ── where the page sits ───────────────────────────────────────────────
  // Home › (the section's own page, where it has one) › this page; the home page has no trail. Each step's item is a WebPage:
  // schema.org's ListItem.item holds a Thing, so a bare URL string would not be the vocabulary's own form.
  if (page.path !== '/') {
    const segs = page.path.split('/').filter(Boolean)
    const trail: Array<{ name: string; item: string }> = [{ name: 'Home', item: origin + '/' }]
    if (segs.length > 1) {
      const parent = segs[0]
      const parentName = parent === 'blog' ? 'Blog' : (ctx.publishedSlugs?.has(parent) ? ctx.pageTitles?.[parent] : '') || ''
      if (parentName) trail.push({ name: parentName, item: origin + '/' + parent })
    }
    trail.push({ name: page.title || segs[segs.length - 1], item: url })
    graph.push({ '@type': 'BreadcrumbList', '@id': url + '#breadcrumb', itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: { '@type': 'WebPage', '@id': t.item, name: t.name } })) })
  }

  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')
}

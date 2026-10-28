// A page for each of the business's own services (/services/<slug>): what the business lists under "What we do", one page
// each — its hero, what is included, a quote form that posts to the enquiry endpoint, and links to the other services.
//
// Only the business's REAL services get one: the items of its own "What we do" (the owner's cards, else its price book,
// service menu or event spaces — site/menu.ts withBusinessServices), never the composer's one-card stand-in for the trade
// and never a "How it works" list of steps. A page states only what the owner gave: the description, the "what's
// included" list and the sub-services of that card; a part the owner gave nothing for is left off the page.
//
// Decided at render time from the stored pages, so a site made before service pages existed has them too.
import { linkSlug, withBusinessServices, type SiteService } from './menu.ts'

export interface SubService { title: string; description: string; slug: string }
export interface ServicePage {
  slug: string
  title: string
  description: string
  image: string
  /** What is included, as the owner listed it. */
  bullets: string[]
  /** The smaller services this one covers, each anchored on the service's page. */
  subServices: SubService[]
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** "Kitchen & Bath remodels" → "kitchen-and-bath-remodels". */
export function slugOf(title: string): string {
  return title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56).replace(/-+$/, '')
}

/** The pages whose services sections are the business's "What we do" (not a trade's own process or find-care pages). */
const SERVICE_LISTS = new Set(['home', 'services', 'service'])
/** A services section that lists steps or a process, not services (the template composer's "How it works"). */
const STEPS_HEADING = /\b(how (it|we) works?|our process|the process|our approach|next steps?|what to expect|steps?)\b/i
export const isStepsList = (data: any) => data?.kind === 'steps' || STEPS_HEADING.test(str(data?.heading))

/** Where a card already goes somewhere better than a generic page: a page of the owner's about this one service. */
function hasOwnPage(href: unknown, published: ReadonlySet<string>): boolean {
  const slug = linkSlug(href)
  return !!slug && slug !== 'home' && slug !== 'contact' && !slug.includes('/') && published.has(slug)
}
/** A card's own link, kept: off the site, or to a published page of the owner's. "contact", "#contact" and a dead link are replaced. */
const keepsLink = (href: unknown, published: ReadonlySet<string>) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(str(href)) || hasOwnPage(href, published)

const list = (v: unknown, max: number): string[] => (Array.isArray(v) ? v : []).map((b) => str(typeof b === 'string' ? b : (b as any)?.title ?? (b as any)?.text)).filter(Boolean).slice(0, max)

function subServicesOf(raw: unknown): Array<{ title: string; description: string }> {
  const out: Array<{ title: string; description: string }> = []
  for (const s of Array.isArray(raw) ? raw : []) {
    const title = str(typeof s === 'string' ? s : (s as any)?.title)
    if (title) out.push({ title, description: typeof s === 'string' ? '' : str((s as any)?.description) })
  }
  return out.slice(0, 12)
}

/**
 * The service pages for a business, in the order its "What we do" lists them. `pages` are its stored pages;
 * `services` and `trade` are what site/menu.ts resolves "What we do" from.
 */
export function servicePagesOf(pages: Array<{ slug: string; sections: unknown; isPublished?: boolean }>, services: SiteService[], trade: string): ServicePage[] {
  const live = pages.filter((p) => p && p.isPublished !== false)
  const published = new Set(live.map((p) => p.slug))
  const ordered = [...live].sort((a, b) => (a.slug === 'home' ? -1 : b.slug === 'home' ? 1 : 0))
  const out = new Map<string, ServicePage>()
  const taken = new Set<string>()
  const byTitle = new Map<string, string>()
  for (const p of ordered) {
    if (!SERVICE_LISTS.has(p.slug)) continue
    for (const section of withBusinessServices(Array.isArray(p.sections) ? p.sections : [], services, trade)) {
      if (!section || section.type !== 'services' || isStepsList(section.data)) continue
      for (const item of Array.isArray(section.data?.items) ? section.data.items : []) {
        const title = str(item?.title)
        if (!title) continue
        const key = title.toLowerCase()
        const have = byTitle.get(key) ? out.get(byTitle.get(key)!) : undefined
        if (have) {
          // the same service listed on two pages: the fuller card wins, field by field
          have.description ||= str(item.description); have.image ||= str(item.image)
          if (!have.bullets.length) have.bullets = list(item.bullets, 12)
          if (!have.subServices.length) have.subServices = withSlugs(subServicesOf(item.subServices))
          continue
        }
        if (hasOwnPage(item.href, published)) continue
        let slug = slugOf(title)
        if (!slug) continue
        if (taken.has(slug)) { let i = 2; while (taken.has(slug + '-' + i)) i++; slug = slug + '-' + i }
        taken.add(slug)
        byTitle.set(key, slug)
        out.set(slug, {
          slug, title, description: str(item.description), image: str(item.image),
          bullets: list(item.bullets, 12), subServices: withSlugs(subServicesOf(item.subServices)),
        })
      }
    }
  }
  return [...out.values()]
}

function withSlugs(subs: Array<{ title: string; description: string }>): SubService[] {
  const seen = new Set<string>()
  return subs.map((s) => {
    let slug = slugOf(s.title) || 'part'
    for (let i = 2; seen.has(slug); i++) slug = slugOf(s.title) + '-' + i
    seen.add(slug)
    return { ...s, slug }
  })
}

/**
 * A page's sections with each "What we do" card linked to its service page: `servicePage` is set on a card that has one, and a
 * card that already links to a page of the owner's keeps that link. The views read `item.href || item.servicePage`.
 */
export function linkServiceCards(sections: any[], pages: ServicePage[], published: ReadonlySet<string>): any[] {
  if (!pages.length) return sections
  const byTitle = new Map(pages.map((p) => [p.title.toLowerCase(), p]))
  return sections.map((s) => {
    if (!s || s.type !== 'services' || isStepsList(s.data) || !Array.isArray(s.data?.items)) return s
    return {
      ...s, data: {
        ...s.data, items: s.data.items.map((it: any) => {
          const page = byTitle.get(str(it?.title).toLowerCase())
          if (!page || keepsLink(it?.href, published)) return it
          const base = '/services/' + page.slug
          // each part the owner named links to its spot on the page
          return { ...it, href: '', servicePage: base, subLinks: page.subServices.map((p) => ({ title: p.title, href: base + '#' + p.slug })) }
        }),
      },
    }
  })
}

// What a public page shows of the site as a whole: its menu, its "What we do" list and its browser-tab title. Decided
// here, at render time, from what the business has right now — so a site made before these rules shows them too,
// without its stored rows being rewritten. (Live tests 2026-10-22, contractor and roofing: a menu of "Services" alone
// though the blog had posts, a "What we do" of one card naming the trade, every tab titled just the business's name.)
//
// The rules:
//   • The menu is the owner's own list (Website › Settings), less any link to a page visitors can't see — one hidden,
//     deleted, or left with nothing of its own — plus the site's collections when they have something in them: the
//     Blog (published posts), Projects (published work) and Service areas. A page the owner publishes joins the menu
//     when it is published (admin.ts); a published page they keep out of the menu (a landing page) stays out.
//   • "What we do" lists what the owner gave: the services they typed. Where the site was given only the one card
//     that repeats its trade (the composer's stand-in when the signup listed none — the home hero's eyebrow already
//     says "Roofing · Eau Claire, WI"), the business's own list is shown instead: the price book's services marked to
//     show customers, else a salon's service menu. With neither, the section isn't shown: the site states only what the
//     owner supplied, and a lone "Roofing" card under "What we do" said nothing they did.
//   • A page's tab reads "Page — Business, City, ST"; the home page "Business, City, ST", or the owner's own default
//     title (Website › Settings) when it says more than the name. A page's own SEO title always wins.
import { and, asc, eq } from 'drizzle-orm'
import { pricebookItem, serviceMenu } from '../db/schema/index.ts'

export interface SiteService { title: string; description: string }

/** Sections that frame a page rather than say something of the business's (the composer's FRAMING_TYPES). */
const FRAMING = new Set(['hero', 'cta', 'reservation'])

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** The trade the home page's hero names in its eyebrow ("Roofing · Eau Claire, WI" → "roofing"), or ''. */
export function tradeOf(homeSections: unknown): string {
  const hero = (Array.isArray(homeSections) ? homeSections : []).find((s: any) => s && s.type === 'hero')
  return str(hero?.data?.eyebrow).split(' · ')[0].trim().toLowerCase()
}

/** A trade's name without the noun some trades carry ("RV & Powersports Sales" / "… Dealership", "Locksmith Services"). */
const bareTrade = (s: string) => s.toLowerCase().replace(/\s+(services?|sales|dealership)$/, '').trim()

/**
 * The composer's stand-in: one card, a title only, naming the trade the hero already names — marked `standIn` by the
 * Factory's build (apps/api/src/unified/factory.ts) since 2026-10-23, recognised by its words on a site built before.
 */
export function isTradeCard(items: unknown, trade: string): boolean {
  if (!Array.isArray(items) || items.length !== 1) return false
  const it = items[0]
  if (!it || typeof it !== 'object') return false
  if ((it as any).standIn === true) return true
  const extra = Object.entries(it as Record<string, unknown>).some(([k, v]) => k !== 'title' && str(v))
  return !!trade && !extra && bareTrade(str((it as any).title)) === bareTrade(trade)
}

/** The business's own services for the site: the price book's (active, shown to customers), else a salon's menu. */
export async function businessServices(db: any, companyId: string): Promise<SiteService[]> {
  const book = await db.select({ name: pricebookItem.name, customer: pricebookItem.customerDescription })
    .from(pricebookItem)
    .where(and(eq(pricebookItem.companyId, companyId), eq(pricebookItem.active, true), eq(pricebookItem.showToCustomer, true), eq(pricebookItem.type, 'service')))
    .orderBy(asc(pricebookItem.name)).limit(24)
  const list = book.length ? book.map((r: any) => ({ title: str(r.name), description: str(r.customer) }))
    : (await db.select({ name: serviceMenu.name, description: serviceMenu.description }).from(serviceMenu)
        .where(and(eq(serviceMenu.companyId, companyId), eq(serviceMenu.active, true))).orderBy(asc(serviceMenu.name)).limit(24))
        .map((r: any) => ({ title: str(r.name), description: str(r.description) }))
  const seen = new Set<string>()
  return list.filter((s: SiteService) => s.title && !seen.has(s.title.toLowerCase()) && seen.add(s.title.toLowerCase()))
}

/**
 * A page's sections with "What we do" decided: the owner's own cards kept; the trade stand-in (or an empty list)
 * replaced by the business's services, or left out when it has none.
 */
export function withBusinessServices(sections: unknown, services: SiteService[], trade: string): any[] {
  const out: any[] = []
  for (const s of Array.isArray(sections) ? sections : []) {
    if (!s || s.type !== 'services') { out.push(s); continue }
    const items = Array.isArray(s.data?.items) ? s.data.items.filter((i: any) => i && str(i.title)) : []
    if (items.length && !isTradeCard(items, trade)) { out.push(s); continue }
    if (services.length) out.push({ ...s, data: { ...s.data, items: services } })
  }
  return out
}

/**
 * Has the page anything on it, once the rules above have run? A page with no sections has nothing (a page just made in
 * the admin); one made only of framing (a hero, a button) is the owner's to judge; one whose every section of substance
 * the rules removed (a "What we do" with nothing to list) has nothing.
 */
export function keepsContent(stored: unknown, resolved: unknown[]): boolean {
  const all = (Array.isArray(stored) ? stored : []).filter(Boolean)
  const own = (xs: unknown[]) => xs.filter((s: any) => s && !FRAMING.has(s.type)).length
  return all.length > 0 && (own(resolved) > 0 || own(all) === 0)
}

/** The page slug a menu link points at, or null when it leaves the site or stays on this page. */
export function linkSlug(href: unknown): string | null {
  const h = str(href)
  if (!h || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i.test(h)) return null
  const path = h.replace(/^\/+/, '').replace(/[?#].*$/, '').replace(/\.html$/i, '').replace(/\/+$/, '').toLowerCase()
  return path || 'home'
}

export interface MenuFacts {
  /** Each page by slug: is it published, and does it keep something of its own. */
  pages: Map<string, { live: boolean }>
  posts: boolean
  portfolio: boolean
  areas: boolean
}

/** Pages the site answers itself, whatever the owner's pages are (routes.ts, booking/pages.ts). */
const SITE_ROUTES = new Set(['shop', 'cart', 'inventory', 'visualize', 'book', 'privacy', 'terms', 'estimator.js'])

/** The site's own collections, each with its label, and whether it has anything to show. */
const COLLECTIONS: Array<{ slug: string; label: string; has: (f: MenuFacts) => boolean }> = [
  { slug: 'projects', label: 'Projects', has: (f) => f.portfolio || !!f.pages.get('projects')?.live },
  { slug: 'service-areas', label: 'Service areas', has: (f) => f.areas },
  { slug: 'blog', label: 'Blog', has: (f) => f.posts },
]

/** The menu as visitors see it (the rules at the top). */
export function siteMenu(nav: unknown, f: MenuFacts): Array<{ label: string; href: string }> {
  const out: Array<{ label: string; href: string }> = []
  const linked = new Set<string>()
  for (const n of Array.isArray(nav) ? nav : []) {
    const label = str(n?.label), href = str(n?.href)
    if (!label || !href) continue
    const slug = linkSlug(href)
    if (slug !== null && slug !== 'home' && !slug.includes('/')) {
      const coll = COLLECTIONS.find((x) => x.slug === slug)
      const page = f.pages.get(slug)
      // A page of the owner's: shown while visitors can see it. A collection: while it has something. A page the site
      // itself answers (the shop, the inventory, booking): the owner's to list. Anything else is a page that isn't there.
      if (coll ? !coll.has(f) : page ? !page.live : !SITE_ROUTES.has(slug)) continue
    }
    if (slug) linked.add(slug)
    out.push({ label, href })
  }
  for (const c of COLLECTIONS) if (c.has(f) && !linked.has(c.slug)) out.push({ label: c.label, href: '/' + c.slug })
  return out
}

/** "Business, City, ST" — the name and where it is, as the tab and search results show it. */
export function siteName(settings: Record<string, any>): string {
  const place = [str(settings.addressLocality), str(settings.addressRegion)].filter(Boolean).join(', ')
  return [str(settings.companyName), place].filter(Boolean).join(', ')
}

/**
 * The tab title. `own`: the page's own SEO title (always wins). Home: the owner's default title when it says more
 * than the bare name (the build sets it to the name), else "Business, City, ST". Any other page: "Title — Business, City, ST".
 */
export function pageTitle(settings: Record<string, any>, p: { title?: string | null; own?: string | null; home?: boolean }): string {
  if (str(p.own)) return str(p.own)
  const name = siteName(settings) || 'Website'
  if (p.home) {
    const chosen = str(settings.seoTitle)
    return chosen && chosen.toLowerCase() !== str(settings.companyName).toLowerCase() ? chosen : name
  }
  const t = str(p.title)
  return t ? t + ' — ' + name : name
}

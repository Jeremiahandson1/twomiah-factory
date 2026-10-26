/**
 * A premium site's starting pages and navigation, from the composer's output (tenants.preview_premium_pages). Moved
 * out of routes/factory/intake.ts (the previews and site-bootstrap) so the unified build (apps/api/src/unified/factory.ts)
 * seeds a unified tenant's site from the same code, not a copy.
 */
import { verticalFor } from '../config/industryRouting'

// Nav labels per page slug. 'home' is omitted (it's the brand logo).
// 'contact' is omitted because the header CTA points to /contact already
// — including it in nav doubles up. Vertical-specific slugs get the
// human-readable label for the food truck / dispensary / etc.
export const PREMIUM_PAGE_NAV_LABEL: Record<string, string> = {
  // RV dealer + vet pages: in their recipes, but with no label they never reached the nav.
  inventory: 'Inventory',
  service: 'Service',
  team: 'Our team',
  menu: 'Menu',
  // Bar pages: in BAR_PAGE_RECIPES, but with no label they never reached the nav.
  taps: 'On tap',
  events: 'Events',
  parties: 'Private parties',
  story: 'Our story',
  shop: 'Shop',
  guides: 'Guides',
  services: 'Services',
  schedule: 'Find us',
  catering: 'Catering',
  strains: 'Strains',
  deals: 'Deals',
  visit: 'Visit',
  quote: 'Estimator',
  storm: 'Storm damage',
  projects: 'Projects',
  packages: 'Packages',
  'find-care': 'Find care',
  caregivers: 'Caregivers',
  coverage: 'Coverage',
  emergency: 'Emergency',
  pricing: 'Pricing',
  reservations: 'Reservations',
  'private-dining': 'Private dining',
  // Salon / spa
  stylists: 'Our team',
  gallery: 'Gallery',
  // Fitness
  classes: 'Classes',
  trainers: 'Trainers',
  // Hotel
  rooms: 'Rooms',
  amenities: 'Amenities',
  local: 'The area',
  // Events / venue
  venue: 'The venue',
  vendors: 'Vendors',
  'service-areas': 'Service areas',
  about: 'About',
}

export function buildPremiumNav(
  pageSlugs: string[],
  layoutMode: 'single-page' | 'multi-page' = 'multi-page',
): Array<{ label: string; href: string }> {
  // Stable per-vertical order: the thing they sell first (menu/services/
  // strains), then secondary funnels (find us/catering/deals/visit), then
  // about.
  const order = ['emergency', 'inventory', 'menu', 'taps', 'events', 'parties', 'shop', 'guides', 'services', 'service', 'rooms', 'venue', 'find-care', 'classes', 'packages', 'quote', 'pricing', 'reservations', 'private-dining', 'strains', 'caregivers', 'coverage', 'projects', 'storm', 'schedule', 'amenities', 'local', 'vendors', 'stylists', 'team', 'trainers', 'catering', 'deals', 'gallery', 'visit', 'service-areas', 'story', 'about']
  const present = new Set(pageSlugs)
  const out: Array<{ label: string; href: string }> = []
  for (const slug of order) {
    if (present.has(slug) && PREMIUM_PAGE_NAV_LABEL[slug]) {
      // Single-page verticals use anchor hrefs (#menu) so the renderer's
      // path-prefix logic emits them as in-page links. Multi-page stays
      // with route hrefs which get prefixed with the preview base path.
      const href = layoutMode === 'single-page' ? '#' + slug : slug
      out.push({ label: PREMIUM_PAGE_NAV_LABEL[slug], href })
    }
  }
  // Single-page sites benefit from a "Contact" anchor link in nav since
  // there's no separate /contact page to navigate to via the header CTA.
  if (layoutMode === 'single-page' && present.has('contact')) {
    out.push({ label: 'Contact', href: '#contact' })
  }
  return out
}

/** A composition as the composer stores it (tenants.preview_premium_pages). */
export type PremiumComposition = {
  /** A page's `title`, when the composer gave one (a service's own page: "Kitchen remodels"), names it on the site. */
  pages?: Record<string, { sections: any[]; title?: string }>
  heldPages?: string[]
  contentGaps?: any[]
}

export type PremiumSitePage = { slug: string; title: string; sections: any[]; navOrder: number; isPublished: boolean }

/**
 * The pages a new premium site starts with: whatever the composer actually produced, in its order. Generic verticals
 * get home/about/services/contact; food trucks get home/menu/about/schedule/catering/contact; future verticals will
 * define their own. Falls back to the generic 4-page set when no composition exists yet (e.g. first boot before AI
 * compose completes). Pages the facts check left with nothing real on them (no photos of the owner's work for
 * /projects, …) are seeded so the owner can fill them in the admin, but unpublished and out of the nav until they do.
 * One list for both builds: the premium template's site-bootstrap and the unified provision body.
 */
export function premiumSitePages(composed: PremiumComposition | null | undefined): PremiumSitePage[] {
  const composedPages = composed?.pages || {}
  const heldPages = new Set(Array.isArray(composed?.heldPages) ? composed!.heldPages : [])
  const PAGE_TITLE_BY_SLUG: Record<string, string> = {
    home: 'Home', about: 'About', services: 'Services', contact: 'Contact',
    menu: 'Menu', schedule: 'Find us', catering: 'Catering',
  }
  const FALLBACK_SLUGS = ['home', 'about', 'services', 'contact']
  const composedSlugs = Object.keys(composedPages)
  const slugs = composedSlugs.length > 0 ? composedSlugs : FALLBACK_SLUGS
  return slugs.map((slug, i) => ({
    slug,
    title: (typeof composedPages[slug]?.title === 'string' && composedPages[slug]!.title!.trim()) || PAGE_TITLE_BY_SLUG[slug] || slug.charAt(0).toUpperCase() + slug.slice(1),
    sections: composedPages[slug]?.sections || [],
    navOrder: i,
    isPublished: !heldPages.has(slug),
  }))
}

/**
 * Places the owner serves — their town + the intake's "areas you serve" — for the site's /service-areas pages. Only
 * trades that go to the customer, and only when the owner named more than their own town (one area is just the home
 * page again). Owner-supplied names only.
 */
export function premiumServiceAreas(tenant: { industry?: string | null; city?: string | null; state?: string | null; intake_data?: any }): string[] {
  const SERVICE_AREA_VERTICALS = new Set(['contractor', 'roofing', 'landscaping', 'fieldservice', 'homecare', 'basic'])
  const intakeIn = ((tenant as any).intake_data?.intake || {}) as { nearbyCities?: unknown }
  const nearby = (Array.isArray(intakeIn.nearbyCities) ? intakeIn.nearbyCities : []).map((v) => String(v || '').trim()).filter(Boolean)
  const homeArea = [tenant.city, tenant.state].filter(Boolean).join(', ')
  return SERVICE_AREA_VERTICALS.has(verticalFor(tenant.industry)) && nearby.length
    ? [...new Set([homeArea, ...nearby].filter(Boolean))].slice(0, 24)
    : []
}

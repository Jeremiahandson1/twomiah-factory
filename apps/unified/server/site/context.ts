// What a public page knows about the business: the `settings` object the site views read (settings.companyName,
// settings.logoUrl, …), built from the app's company and site rows. The views moved across unchanged; this is the one
// place that knows the premium site kept these in its own settings table.
import { and, asc, eq } from 'drizzle-orm'
import { businessHoursLines, businessHoursOf } from '@twomiah/tenant-backend'
import { company, website, page, post, portfolioItem } from '../db/schema/index.ts'
import { sectionsShown } from './render.ts'
import { businessServices, keepsContent, siteMenu, tradeOf, withBusinessServices, type SiteService } from './menu.ts'
import type { VerticalSettings, SiteDesign } from '../core/vertical.ts'
import { SITE_DESIGNS, COVER_DESIGNS } from '../core/vertical.ts'
import { previewing } from './drafts.ts'

export interface SiteContext {
  companyId: string
  /** The company's slug: its id in the Factory and in the Visualizer. */
  slug: string
  /** The object the views read as `settings`. */
  settings: Record<string, any>
  design: SiteDesign
  words: VerticalSettings['site']['words']
  /**
   * textSizeToggle: the reader's text-size buttons (home care). shop: a store's cart in the header, its script and its pages.
   * cover: the design is a whole look of its own, framed as the bar's leather book (COVER_DESIGNS; base.ejs). ctaHref: where
   * the header's button goes (SiteSettings.ctaHref).
   */
  options: { textSizeToggle: boolean; shop: boolean; cover: boolean; ctaHref: string }
  colours: { primary: string; accent: string | null; secondary: string | null }
  /** The business's own services for "What we do", and the trade its home hero names (site/menu.ts). */
  services?: SiteService[]
  trade?: string
  /** The company's switched-on features: a section that IS a feature (the financing calculator) renders only with it on. */
  features: string[]
}

/**
 * The site's one-line address as a US address is written: "street, city, ST 12345" — the ZIP with the state when the
 * business has one (the old sites printed the owner's own line, ZIP included). The parts go to the views too
 * (streetAddress, addressLocality, addressRegion, postalCode): base.ejs's business markup and the visit section read
 * those, not a split of this line.
 */
function addressLine(c: { address: string | null; city: string | null; state: string | null; zip: string | null }): string {
  const t = (v: string | null) => (v ? String(v).trim() : '')
  const region = [t(c.state), t(c.zip)].filter(Boolean).join(' ')
  return [t(c.address), t(c.city), region].filter(Boolean).join(', ')
}

export async function loadSiteContext(db: any, vertical: VerticalSettings): Promise<SiteContext | null> {
  const [co] = await db.select().from(company).orderBy(asc(company.createdAt)).limit(1)
  if (!co) return null
  const [row] = await db.select().from(website).where(eq(website.companyId, co.id)).limit(1)
  // The live settings — or, in the editor's preview (site/drafts.ts), the draft ones over them, with no tracking: the
  // owner looking at their own changes is not a visit to report to Google, Facebook or Clarity.
  const preview = previewing()
  const s = preview ? {
    ...row, ...(preview.settings ?? {}),
    googleTagManagerId: null, googleAnalyticsId: null, googleAdsId: null, facebookPixelId: null, microsoftClarityId: null,
  } : row
  // The company's opening hours (Settings › Company; company.settings.businessHours), read by the one rule online booking
  // reads them by too (booking/engine.ts weekOf): JSON text on a moved agency is read, a bad value is no hours.
  const businessHours = businessHoursOf(co.settings)
  const design = (SITE_DESIGNS as readonly string[]).includes(s?.design) ? (s.design as SiteDesign) : vertical.site.design
  // The menu and "What we do" as visitors see them (site/menu.ts): from the pages, posts, work and services as they are now.
  const [pages, [aPost], [aWork], services] = await Promise.all([
    db.select({ slug: page.slug, sections: page.sections, isPublished: page.isPublished }).from(page).where(eq(page.companyId, co.id)),
    db.select({ id: post.id }).from(post).where(and(eq(post.companyId, co.id), eq(post.status, 'published'))).limit(1),
    db.select({ id: portfolioItem.id }).from(portfolioItem).where(and(eq(portfolioItem.companyId, co.id), eq(portfolioItem.status, 'published'))).limit(1),
    businessServices(db, co.id),
  ])
  const trade = tradeOf(pages.find((p: any) => p.slug === 'home')?.sections)
  const features: string[] = Array.isArray(co.enabledFeatures) ? co.enabledFeatures : []
  const serviceAreas = Array.isArray(s?.serviceAreas) ? s.serviceAreas : []
  const nav = siteMenu(Array.isArray(s?.nav) ? s.nav : [], {
    // What the page shows is its sections less any that is a switched-off feature (render.ts sectionsShown), then "What
    // we do" filled in — a page left with nothing of its own by either rule is not linked.
    pages: new Map(pages.map((p: any) => [p.slug, { live: !!p.isPublished && keepsContent(p.sections, withBusinessServices(sectionsShown({ features }, Array.isArray(p.sections) ? p.sections : []), services, trade)) }])),
    posts: !!aPost, portfolio: !!aWork,
    areas: serviceAreas.some((a: any) => String((a && typeof a === 'object' ? a.name : a) || '').trim()),
  })
  return {
    companyId: co.id,
    slug: co.slug,
    design,
    words: vertical.site.words,
    options: { textSizeToggle: !!vertical.site.textSizeToggle, shop: !!vertical.crm?.store, cover: COVER_DESIGNS.has(design), ctaHref: vertical.site.ctaHref || '/contact' },
    colours: { primary: co.primaryColor, accent: s?.accentColor ?? null, secondary: co.secondaryColor ?? null },
    services, trade,
    features,
    settings: {
      companyName: co.name,
      phone: co.phone || '',
      email: co.email || '',
      address: addressLine(co),
      streetAddress: co.address || '',
      addressLocality: co.city || '',
      addressRegion: co.state || '',
      postalCode: co.zip || '',
      logoUrl: co.logo || '',
      // The urgent-care bar reads the week (open now / closed now); the contact section prints the lines when its own
      // Hours are left empty.
      businessHours,
      businessHoursLines: businessHoursLines(businessHours),
      primaryColor: co.primaryColor,
      secondaryColor: co.secondaryColor,
      tagline: s?.tagline || '',
      seoTitle: s?.seoTitle || '',
      seoDescription: s?.seoDescription || '',
      nav,
      photoCredits: Array.isArray(s?.photoCredits) ? s.photoCredits : [],
      contentGaps: Array.isArray(s?.contentGaps) ? s.contentGaps : [],
      serviceAreas,
      inventoryFeedUrl: s?.inventoryFeedUrl || '',
      contactCtaLabel: s?.contactCtaLabel || 'Get in touch',
      accentColor: s?.accentColor || '',
      faviconUrl: s?.faviconUrl || '',
      googleTagManagerId: s?.googleTagManagerId || '',
      googleAnalyticsId: s?.googleAnalyticsId || '',
      googleAdsId: s?.googleAdsId || '',
      facebookPixelId: s?.facebookPixelId || '',
      microsoftClarityId: s?.microsoftClarityId || '',
    },
  }
}

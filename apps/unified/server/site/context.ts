// What a public page knows about the business: the `settings` object the site views read (settings.companyName,
// settings.logoUrl, …), built from the app's company and site rows. The views moved across unchanged; this is the one
// place that knows the premium site kept these in its own settings table.
import { asc, eq } from 'drizzle-orm'
import { company, website } from '../db/schema/index.ts'
import type { VerticalSettings, SiteDesign } from '../core/vertical.ts'
import { SITE_DESIGNS, COVER_DESIGNS } from '../core/vertical.ts'

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
}

/**
 * The site's one-line address, exactly as the Factory has always seeded it (routes/factory/intake.ts site-bootstrap:
 * "street, city, state", no ZIP). base.ejs reads the last two parts as the city and state for Google's business
 * markup, so a ZIP on the end would land in the state.
 */
function addressLine(c: { address: string | null; city: string | null; state: string | null }): string {
  return [c.address, c.city, c.state].filter((p) => p && String(p).trim()).join(', ')
}

export async function loadSiteContext(db: any, vertical: VerticalSettings): Promise<SiteContext | null> {
  const [co] = await db.select().from(company).orderBy(asc(company.createdAt)).limit(1)
  if (!co) return null
  const [s] = await db.select().from(website).where(eq(website.companyId, co.id)).limit(1)
  const design = (SITE_DESIGNS as readonly string[]).includes(s?.design) ? (s.design as SiteDesign) : vertical.site.design
  return {
    companyId: co.id,
    slug: co.slug,
    design,
    words: vertical.site.words,
    options: { textSizeToggle: !!vertical.site.textSizeToggle, shop: !!vertical.crm?.store, cover: COVER_DESIGNS.has(design), ctaHref: vertical.site.ctaHref || '/contact' },
    colours: { primary: co.primaryColor, accent: s?.accentColor ?? null, secondary: co.secondaryColor ?? null },
    settings: {
      companyName: co.name,
      phone: co.phone || '',
      email: co.email || '',
      address: addressLine(co),
      logoUrl: co.logo || '',
      primaryColor: co.primaryColor,
      secondaryColor: co.secondaryColor,
      tagline: s?.tagline || '',
      seoTitle: s?.seoTitle || '',
      seoDescription: s?.seoDescription || '',
      nav: Array.isArray(s?.nav) ? s.nav : [],
      photoCredits: Array.isArray(s?.photoCredits) ? s.photoCredits : [],
      contentGaps: Array.isArray(s?.contentGaps) ? s.contentGaps : [],
      serviceAreas: Array.isArray(s?.serviceAreas) ? s.serviceAreas : [],
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

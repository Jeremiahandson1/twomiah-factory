// What a public page knows about the business: the `settings` object the site views read (settings.companyName,
// settings.logoUrl, …), built from the app's company and site rows. The views moved across unchanged; this is the one
// place that knows the premium site kept these in its own settings table.
import { asc, eq } from 'drizzle-orm'
import { businessHoursLines, checkBusinessHours } from '@twomiah/tenant-backend'
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
  const [s] = await db.select().from(website).where(eq(website.companyId, co.id)).limit(1)
  // The company's opening hours (Settings › Company; company.settings.businessHours). The blob may be stored as JSON
  // text on a moved agency (enabledFeature.ts readSettingsBlob), so it is read either way; a bad value is no hours.
  let blob: any = co.settings
  if (typeof blob === 'string') { try { blob = JSON.parse(blob) } catch { blob = null } }
  const businessHours = blob?.businessHours && !checkBusinessHours(blob.businessHours) ? blob.businessHours : null
  const design = (SITE_DESIGNS as readonly string[]).includes(s?.design) ? (s.design as SiteDesign) : vertical.site.design
  return {
    companyId: co.id,
    slug: co.slug,
    design,
    words: vertical.site.words,
    options: { textSizeToggle: !!vertical.site.textSizeToggle, shop: !!vertical.crm?.store, cover: COVER_DESIGNS.has(design), ctaHref: vertical.site.ctaHref || '/contact' },
    colours: { primary: co.primaryColor, accent: s?.accentColor ?? null, secondary: co.secondaryColor ?? null },
    features: Array.isArray(co.enabledFeatures) ? co.enabledFeatures : [],
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

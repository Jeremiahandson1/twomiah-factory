// The free preview on twomiah.com (not the website editor's live preview: that is site/preview.ts), drawn by the same
// renderer a signup's site is: one page, with no database behind it.
// The Factory (apps/api/src/unified/preview.ts) composes the page the way the signup's build does and hands the sections
// here; this builds the SiteContext a request would have loaded (context.ts loadSiteContext) from what the preview knows,
// then renders it through renderSections and fills the design's stylesheet in. Nothing here is a second renderer: a
// change to a section, a design or the page frame shows in the preview because it is the same code.
import { businessHoursLines, businessHoursOf } from '@twomiah/tenant-backend'
import { loadVertical, SITE_DESIGNS, SITE_DESIGN_SPECS, type SiteDesign } from '../core/vertical.ts'
import { renderSections, assetVersion } from './render.ts'
import { siteStylesheet } from './routes.ts'
import { tradeOf } from './menu.ts'
import type { SiteContext } from './context.ts'
import { siteColours, cleanPalette } from './palette.ts'
import { cleanStyle, fontsUrl } from './feel.ts'

export interface SitePreviewInput {
  /** The unified vertical's id (core/vertical.ts loadVertical): what the business runs as. */
  vertical: string
  /** The look to draw it in; none or an unknown one: the vertical's own default. */
  design?: string | null
  company: { name: string; primaryColor: string; secondaryColor?: string | null }
  /** The site's settings as a build writes them (premium-site provisioning: nav, photo credits, content gaps, areas…). */
  settings: { nav?: any[]; photoCredits?: any[]; contentGaps?: any[]; serviceAreas?: any[]; contactCtaLabel?: string; accentColor?: string }
  /** The home page's sections. */
  sections: any[]
  /** The features the business starts with: a section that IS a feature draws only while it is on. */
  features: string[]
  title?: string
  /** The site's own colours (website.palette): { brand, band, page }. None: the design's. */
  palette?: unknown
  style?: unknown
  /** A notice drawn across the top of the page (the free preview's "example content" line). Plain text. */
  banner?: string
  /**
   * Settings a real site carries and a preview leaves empty (phone, email, address, hours, social links, noHeaderCta…),
   * laid over the preview's. Only the one-page static site (onePage.ts) sets it; the free preview never does.
   */
  settingsExtra?: Record<string, any>
}

/** Every key of the settings object a real request builds (context.ts), empty: the views read them all. */
function previewSettings(i: SitePreviewInput): Record<string, any> {
  const hours = businessHoursOf(null)
  return {
    companyName: i.company.name, phone: '', email: '', address: '', streetAddress: '', addressLocality: '', addressRegion: '', postalCode: '',
    logoUrl: '', businessHours: hours, businessHoursLines: businessHoursLines(hours),
    primaryColor: i.company.primaryColor, secondaryColor: i.company.secondaryColor ?? null,
    tagline: '', seoTitle: '', seoDescription: '',
    nav: i.settings.nav ?? [], photoCredits: i.settings.photoCredits ?? [], contentGaps: i.settings.contentGaps ?? [],
    serviceAreas: i.settings.serviceAreas ?? [], socialLinks: [], inventoryFeedUrl: '', contactCtaLabel: i.settings.contactCtaLabel || 'Get in touch',
    accentColor: i.settings.accentColor || '', faviconUrl: '',
    // The site's own colours and type/feel, as a real request's settings carry them (site/context.ts).
    palette: cleanPalette(i.palette), style: cleanStyle(i.style),
    googleTagManagerId: '', googleAnalyticsId: '', googleAdsId: '', facebookPixelId: '', microsoftClarityId: '',
    ...(i.settingsExtra ?? {}),
  }
}

/** The keys a preview's settings carry (a guard compares them with a real request's: tests/site-signup-preview.test.ts). */
export const PREVIEW_SETTINGS_KEYS = Object.keys(previewSettings({ vertical: '', company: { name: '', primaryColor: '' }, settings: {}, sections: [], features: [] }))

/**
 * The notice as a bar at the top of the page. Its own colours, pinned with !important, so no look (and no dark mode) can
 * make it unreadable: white on #1f2937 is 14:1 in any scheme.
 */
function bannerHtml(text: string): string {
  const safe = text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
  return '<style>#twomiah-sample-banner{display:block!important;box-sizing:border-box!important;width:100%!important;margin:0!important;padding:10px 16px!important;background:#1f2937!important;color:#ffffff!important;font:600 14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif!important;text-align:center!important;letter-spacing:0!important;text-transform:none!important}</style>' +
    '<div id="twomiah-sample-banner" role="note">' + safe + '</div>'
}

/**
 * The page as one self-contained document for an iframe's srcdoc: the stylesheet inline (the visitor's browser has no
 * /styles/main.css on twomiah.com) and every internal link and form pointing nowhere ('#'), as the premium preview did.
 */
/** The SiteContext a request would have loaded, from what a preview (or the one-page static site) knows: the one builder both draw through. */
export async function previewContext(i: SitePreviewInput): Promise<SiteContext> {
  const vertical = await loadVertical(i.vertical)
  const design: SiteDesign = (SITE_DESIGNS as readonly string[]).includes(i.design ?? '') ? (i.design as SiteDesign) : vertical.site.design
  const spec = SITE_DESIGN_SPECS[design]
  return {
    companyId: 'preview', slug: 'preview', design, words: vertical.site.words,
    options: { textSizeToggle: !!vertical.site.textSizeToggle, shop: !!vertical.crm?.store, cover: spec.frame === 'book', fonts: fontsUrl(cleanStyle(i.style), spec), schemes: !!spec.schemes, ctaHref: vertical.site.ctaHref || '/contact' },
    style: cleanStyle(i.style),
    colours: siteColours({ primaryColor: i.company.primaryColor, secondaryColor: i.company.secondaryColor }, i.settings.accentColor, i.palette),
    services: [], trade: tradeOf(i.sections), features: i.features, settings: previewSettings(i),
  }
}

export async function renderSitePreview(i: SitePreviewInput): Promise<string> {
  const ctx = await previewContext(i)
  let html = await renderSections(ctx, i.sections, { title: i.title || i.company.name }, { currentPath: '/', origin: '', sectionErrors: [] })
  const css = siteStylesheet(ctx)
  const link = '<link rel="stylesheet" href="/styles/main.css?v=' + assetVersion(ctx) + '">'
  // A function as the replacement: the stylesheet holds `$` sequences that a string replacement would read as groups.
  html = html.replace(link, () => '<style>' + css + '</style>')
  html = html.replace(/<a\s[^>]*>/g, (tag) => tag.replace(/\shref="(?!#)[^"]*"/, ' href="#"'))
  if (i.banner) html = html.replace(/<body[^>]*>/, (open) => open + bannerHtml(i.banner as string))
  html = html.replace(/<form\s[^>]*>/g, (tag) => tag.replace(/\saction="[^"]*"/, ' action="#"'))
  return html
}

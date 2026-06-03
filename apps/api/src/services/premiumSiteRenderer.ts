/**
 * premiumSiteRenderer — renders a single page of the multi-page premium
 * preview from pre-composed sections + settings.
 *
 * Distinct from previewRenderer (which runs the full generate() pipeline
 * to produce a standard-template preview). The premium preview's
 * sections are already composed by composeSite() and persisted on the
 * tenant — this renderer just turns them into HTML at request time.
 *
 * Returns a self-contained HTML page (CSS inlined) so the preview link
 * works without backend asset requests other than the page itself.
 */
import fs from 'fs'
import path from 'path'
import ejs from 'ejs'
import type { Section } from './sectionComposer'

const TEMPLATE_DIR = path.resolve(
  __dirname,
  '../../../../templates/website-premium-contractor'
)

export interface RenderedPage {
  html: string
  bytes: number
}

export interface PreviewSettings {
  companyName: string
  tagline?: string
  phone?: string
  email?: string
  seoTitle?: string
  seoDescription?: string
  contactCtaLabel?: string
  nav?: Array<{ label: string; href: string }>
}

export interface PageInput {
  slug: string  // 'home' | 'about' | 'services' | 'contact' | custom
  title?: string
  sections: Section[]
  metaTitle?: string
  metaDescription?: string
}

const DEFAULT_NAV: Array<{ label: string; href: string }> = [
  { label: 'Services', href: 'services' },
  { label: 'About', href: 'about' },
  { label: 'Contact', href: 'contact' },
]

/**
 * Render one page. previewBasePath is what the renderer prefixes nav
 * hrefs with — for the public preview we use the route stem so nav
 * links navigate within the preview (e.g.
 * /api/v1/factory/public/intake/:id/preview-premium/about).
 */
export async function renderPremiumPage(
  page: PageInput,
  settings: PreviewSettings,
  previewBasePath: string
): Promise<RenderedPage> {
  const viewsDir = path.join(TEMPLATE_DIR, 'views')
  const buildDir = path.join(TEMPLATE_DIR, 'build')

  // Settings get a runtime-resolved nav + brand link aimed at this preview.
  const nav = (settings.nav && settings.nav.length ? settings.nav : DEFAULT_NAV).map(item => ({
    label: item.label,
    href: previewBasePath + (item.href.startsWith('/') ? item.href : '/' + item.href),
  }))
  const homeHref = previewBasePath
  const contactHref = previewBasePath + '/contact'

  const effectiveSettings = {
    ...settings,
    homeHref,
    contactHref,
    contactCtaLabel: settings.contactCtaLabel || 'Get in touch',
    seoTitle: page.metaTitle || settings.seoTitle || page.title || settings.companyName,
    seoDescription: page.metaDescription || settings.seoDescription || '',
    nav,
  }

  const homepage = { sections: page.sections }
  const currentPath = previewBasePath + (page.slug === 'home' ? '' : '/' + page.slug)

  const body = await ejs.renderFile(path.join(viewsDir, 'home.ejs'), { homepage, settings: effectiveSettings }) as string
  const html = await ejs.renderFile(path.join(viewsDir, 'base.ejs'), { body, settings: effectiveSettings, currentPath }) as string

  // Inline /styles/main.css so the preview is self-contained.
  const inlined = html.replace(/<link\s+rel=["']stylesheet["']\s+href=["']\/styles\/([^"']+)["']\s*\/?>/i, (_m, p) => {
    const cssPath = path.join(buildDir, 'styles', p)
    try { return '<style>\n' + fs.readFileSync(cssPath, 'utf8') + '\n</style>' }
    catch { return _m }
  })

  return { html: inlined, bytes: inlined.length }
}

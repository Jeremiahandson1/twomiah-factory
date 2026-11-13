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
import type { ContentGap } from './composerFacts'

const TEMPLATES_ROOT = path.resolve(__dirname, '../../../../templates')
const DEFAULT_TEMPLATE = 'website-premium-contractor'

// Resolve the right premium template dir for a tenant based on its
// Picks the template dir for a given industry. Delegates to the central
// industryRouting helper so this file stays in sync — earlier versions
// duplicated the industry sets here and silently drifted (e.g. food_truck
// wasn't in this file's roster and was rendering through the contractor
// template, silently dropping every food-truck-specific section partial).
import { premiumWebsiteTemplateFor } from '../config/industryRouting'
export function pickPremiumTemplateDir(industry?: string | null): string {
  return path.join(TEMPLATES_ROOT, premiumWebsiteTemplateFor(industry || undefined))
}

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
  primaryColor?: string
  accentColor?: string
  /**
   * What the composer left out for want of the owner's facts. When present the
   * preview shows a "make it yours" panel listing them, so a short site reads
   * as honest-and-unfinished rather than thin.
   */
  contentGaps?: ContentGap[]
}

// The template CSS ships literal {{PRIMARY_COLOR}}/{{ACCENT_COLOR}} tokens
// that generate() substitutes at build time. The preview inlines that CSS
// straight from the template source, so the tokens must be substituted here
// too. Fallbacks must stay in sync with what the deployed build gets:
// checkout-premium's branding fallback (intake.ts) and buildTokenMap's
// accent fallback (generator.ts) — preview and deployed site must agree.
const DEFAULT_BRAND = '#1a2e22'
const DEFAULT_ACCENT = '#f59e0b'

// Intake branding values arrive from a public POST — only a hex color may
// enter the inlined <style> block. Exported so checkout-premium applies the
// SAME validation to the deployed build's branding: preview and deploy must
// resolve any non-hex input (the intake form has a free-text color field)
// to the same fallback, never to different colors.
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
export function safeColor(value: string | undefined, fallback: string): string {
  const v = (value || '').trim()
  return HEX_COLOR_RE.test(v) ? v : fallback
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
 *
 * templateDir defaults to contractor for back-compat with callers that
 * pre-date the multi-industry split. New callers should pass the result
 * of pickPremiumTemplateDir(industry).
 */
export async function renderPremiumPage(
  page: PageInput,
  settings: PreviewSettings,
  previewBasePath: string,
  templateDir?: string,
): Promise<RenderedPage> {
  const resolvedDir = templateDir || path.join(TEMPLATES_ROOT, DEFAULT_TEMPLATE)
  const viewsDir = path.join(resolvedDir, 'views')
  const buildDir = path.join(resolvedDir, 'build')

  // Settings get a runtime-resolved nav + brand link aimed at this preview.
  // Anchor hrefs (`#menu`, `#schedule`) for single-page verticals are
  // passed through unprefixed; route hrefs get the preview base path.
  const nav = (settings.nav && settings.nav.length ? settings.nav : DEFAULT_NAV).map(item => ({
    label: item.label,
    href: item.href.startsWith('#')
      ? item.href
      : previewBasePath + (item.href.startsWith('/') ? item.href : '/' + item.href),
  }))
  const isOnePage = (settings as any).layoutMode === 'single-page'
  const homeHref = previewBasePath
  // The header "Get in touch" CTA used to hardcode /contact, which 404s
  // for verticals whose recipe doesn't produce a contact page (cafes use
  // /visit, restaurants use /reservations, etc.). Pick from the nav the
  // composer actually emitted, in priority order.
  const contactHref = isOnePage
    ? '#contact'
    : pickContactHref(nav, previewBasePath)

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

  // Inline /styles/main.css so the preview is self-contained, resolving the
  // build-time brand-color tokens the template source still carries.
  const brand = safeColor(settings.primaryColor, DEFAULT_BRAND)
  const accent = safeColor(settings.accentColor, DEFAULT_ACCENT)
  let inlined = html.replace(/<link\s+rel=["']stylesheet["']\s+href=["']\/styles\/([^"'?]+)(?:\?[^"']*)?["']\s*\/?>/i, (_m, p) => {
    const cssPath = path.join(buildDir, 'styles', p)
    try {
      const css = fs.readFileSync(cssPath, 'utf8')
        .replace(/\{\{PRIMARY_COLOR\}\}/g, brand)
        .replace(/\{\{ACCENT_COLOR\}\}/g, accent)
      return '<style>\n' + css + '\n</style>'
    }
    catch { return _m }
  })

  // Composer-generated CTA hrefs come in as bare slugs ("contact") or
  // legacy ".html" suffixes ("menu.html") — neither resolves under the
  // preview routes (/api/v1/factory/public/intake/<id>/preview-premium/<slug>).
  // The nav was already path-prefixed above; this rewrites in-content
  // <a href> attributes too so cards, CTA buttons, and hero-CTAs all
  // route correctly. Leaves external (https://, mailto:, tel:, #anchor)
  // and already-prefixed (/api/v1/...) hrefs untouched.
  inlined = rewriteInternalHrefs(inlined, previewBasePath, isOnePage)

  // (The "Approve & buy", "Something's off" and "Make it yours" widgets went with the offer they belonged to — the
  // emailed preview of the closed website offer, routes/factory/closedIntake.ts. This renders the homepage preview only.)
  return { html: inlined, bytes: inlined.length }
}

// Priority order for the "Get in touch" CTA in the header — whichever
// of these the composer actually emitted gets used. Falls back to home
// if none are present (very edge — every recipe ships at least one of
// these).
const CONTACT_HREF_PRIORITY = ['contact', 'visit', 'reservations', 'find-care', 'quote', 'packages', 'menu']

function pickContactHref(
  nav: Array<{ label: string; href: string }>,
  homeHref: string,
): string {
  for (const slug of CONTACT_HREF_PRIORITY) {
    const suffix = '/' + slug
    const found = nav.find(item => item.href.endsWith(suffix))
    if (found) return found.href
  }
  return homeHref
}

// Known internal page slugs we rewrite to preview routes. Anything not
// in this list (e.g. "/blog", an external URL, an anchor like "#menu",
// or a tel:/mailto:) passes through untouched so we don't accidentally
// break a real external link.
const INTERNAL_SLUGS = new Set([
  'home', 'about', 'services', 'contact', 'menu', 'visit',
  'schedule', 'catering', 'deals', 'reservations', 'private-dining',
  'strains', 'find-care', 'caregivers', 'coverage',
  'emergency', 'pricing', 'quote', 'storm', 'projects', 'packages',
  'stylists', 'gallery', 'classes', 'trainers',
  'rooms', 'amenities', 'local', 'venue', 'vendors',
])

function rewriteInternalHrefs(html: string, previewBasePath: string, isOnePage: boolean): string {
  return html.replace(/href="([^"]+)"/g, (match, raw) => {
    // Skip anything that's already absolute, anchor, or non-http scheme.
    if (/^(?:https?:|mailto:|tel:|javascript:|data:|#)/i.test(raw)) return match
    if (raw.startsWith('/api/v1/')) return match  // already prefixed by nav

    // Normalize: strip leading slash + .html suffix.
    let slug = raw.replace(/^\//, '').replace(/\.html$/i, '')
    // Strip query/hash so "contact?x=1" still matches the "contact" slug.
    const queryIdx = slug.search(/[?#]/)
    const tail = queryIdx >= 0 ? slug.slice(queryIdx) : ''
    if (queryIdx >= 0) slug = slug.slice(0, queryIdx)

    // Empty or just "/" → home.
    if (slug === '' || slug === 'index') {
      return 'href="' + previewBasePath + tail + '"'
    }
    if (!INTERNAL_SLUGS.has(slug)) return match  // leave it alone

    // Single-page sites: every internal link becomes an anchor scroll.
    if (isOnePage) {
      return 'href="#' + slug + tail + '"'
    }
    return 'href="' + previewBasePath + '/' + slug + tail + '"'
  })
}

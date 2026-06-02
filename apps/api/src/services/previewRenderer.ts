/**
 * Preview renderer — the "show-first" draft.
 *
 * Turns a GenerateConfig into a single self-contained HTML file (the homepage)
 * the customer can look at and react to. This is DELIBERATELY separate from the
 * factory deploy pipeline: it does NOT create a GitHub repo, a Render service,
 * or a database. It reuses only the fast, local generate() step (which performs
 * all token substitution + AI content), then renders the template's own EJS
 * views offline and inlines the CSS/JS so the result opens anywhere.
 *
 * If the customer approves and buys, THAT is when the real factory pipeline
 * (deployCustomer) runs to give them their actual owned site. Never deploy here.
 */
import fs from 'fs'
import path from 'path'
import ejs from 'ejs'
import AdmZip from 'adm-zip'
import { generate, type GenerateConfig } from './generator'

export interface PreviewResult {
  html: string
  slug: string
  buildId: string
}

/**
 * Render the homepage of a draft site to self-contained HTML.
 * Always website-only — a preview never provisions CRM/pricing/vision.
 */
export async function renderHomepagePreview(config: GenerateConfig): Promise<PreviewResult> {
  const websiteConfig: GenerateConfig = { ...config, products: ['website'] }

  const result = await generate(websiteConfig)
  const extractDir = path.join(path.dirname(result.zipPath), result.buildId + '-preview')

  try {
    new AdmZip(result.zipPath).extractAllTo(extractDir, /* overwrite */ true)
    const websiteDir = path.join(extractDir, 'website')
    if (!fs.existsSync(websiteDir)) {
      throw new Error('Generated output has no website/ directory — cannot render preview')
    }
    const html = await renderWebsiteDir(websiteDir)
    // When the lead gave no real service areas, the site shows "Nearby City N"
    // placeholders — flag that in the preview so it reads as intentional.
    const hasRealCities = !!(config.company?.nearbyCities && config.company.nearbyCities.length)
    const finalHtml = hasRealCities ? html : injectPlaceholderDisclaimer(html)
    return { html: finalHtml, slug: result.slug, buildId: result.buildId }
  } finally {
    // Disposable by design — preview artifacts must never accumulate.
    fs.rmSync(extractDir, { recursive: true, force: true })
    fs.rmSync(result.zipPath, { force: true })
  }
}

/**
 * Mirrors server-static.ts renderPage() for the `/` route: render home.ejs,
 * wrap it in base.ejs with the same locals, then inline assets.
 */
async function renderWebsiteDir(websiteDir: string): Promise<string> {
  const dataDir = path.join(websiteDir, 'data')
  const viewsDir = path.join(websiteDir, 'views')

  const loadJSON = (file: string, fallback: any) => {
    try { return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')) }
    catch { return fallback }
  }

  const settings = loadJSON('settings.json', {})
  const navConfig = loadJSON('nav-config.json', {})
  const menuItems = Array.isArray(navConfig.items) ? navConfig.items
    : Array.isArray(navConfig) ? navConfig : []

  // JSON-LD defensive escapers — mirror the template's server-static.ts so
  // structured-data blocks render the same way offline as they do live.
  const _jsonStr = (v: any) => JSON.stringify(v == null ? '' : String(v))
  const _plainDesc = (html: any, max = 300) => String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&(#x27|#39|apos);/gi, "'")
    .replace(/&(quot|#34);/gi, '"')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim().slice(0, max)

  // CSS-background helper used by service.ejs/home.ejs hero (Claflin 3.9).
  // Previews don't carry image-meta.json so no WebP companion exists; always
  // returns the plain url() form, matching the no-WebP branch of the real
  // bgWithWebp in each template's server-static.ts.
  const bgWithWebp = (imgUrl: string) => (imgUrl && typeof imgUrl === 'string') ? `url('${imgUrl}')` : ''

  const shared: Record<string, any> = {
    settings,
    menuItems,
    BASE_URL: '',
    hasVisualizer: false,
    hasEstimator: false,
    _jsonStr,
    _plainDesc,
    bgWithWebp,
    homepage: loadJSON('homepage.json', {}),
    services: loadJSON('services.json', []),
    testimonials: loadJSON('testimonials.json', []),
    title: settings.seoTitle || settings.companyName || settings.title || 'Website Preview',
    description: settings.seoDescription || 'Professional services',
    canonicalUrl: '',
  }

  const body = await ejs.renderFile(path.join(viewsDir, 'home.ejs'), shared) as string
  const html = await ejs.renderFile(path.join(viewsDir, 'base.ejs'), { ...shared, body }) as string

  // Scroll-reveal sections start at opacity:0 and only appear once JS fires on
  // scroll. In a static preview that can make sections (e.g. Services) look
  // empty, so force all reveal content visible.
  const safety = '<style>.animate-on-scroll{opacity:1 !important;transform:none !important}</style>'
  const withSafety = html.includes('</head>') ? html.replace('</head>', safety + '</head>') : safety + html

  return inlineAssets(withSafety, websiteDir)
}

/**
 * Inline local stylesheets and scripts (served at /styles/* and /scripts/* from
 * the template's build/ dir) so the HTML is one portable file. External URLs
 * (the Google Fonts CDN) are left untouched.
 */
function inlineAssets(html: string, websiteDir: string): string {
  const buildDir = path.join(websiteDir, 'build')

  const readBuildFile = (urlPath: string): string | null => {
    const clean = urlPath.split('?')[0].split('#')[0].replace(/^\//, '')
    const filePath = path.resolve(buildDir, clean)
    if (!filePath.startsWith(buildDir)) return null // guard against path traversal
    try { return fs.readFileSync(filePath, 'utf8') } catch { return null }
  }

  // <link rel="stylesheet" href="/styles/x.css"> → <style>…</style>
  html = html.replace(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi, (tag) => {
    const m = tag.match(/href=["']([^"']+)["']/i)
    if (!m || !m[1].startsWith('/')) return tag
    const css = readBuildFile(m[1])
    return css != null ? `<style>\n${css}\n</style>` : tag
  })

  // <script src="/scripts/main.js"></script> → <script>…</script>
  html = html.replace(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi, (tag, src) => {
    if (typeof src !== 'string' || !src.startsWith('/')) return tag
    const js = readBuildFile(src)
    return js != null ? `<script>\n${js}\n</script>` : tag
  })

  return html
}

/**
 * Prepend a banner to <body> noting the service-area cities are placeholders.
 * Only used when the lead supplied no real "areas you serve" list.
 */
function injectPlaceholderDisclaimer(html: string): string {
  const banner =
    '<div data-preview-disclaimer style="background:#fef3c7;color:#92400e;' +
    'font:600 13px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:10px 16px;' +
    'text-align:center;border-bottom:1px solid #f59e0b">' +
    'Preview note: the service-area cities below (&ldquo;Nearby City 1&rdquo;, etc.) are ' +
    'placeholders &mdash; your real local cities will appear here once added.' +
    '</div>'
  const m = html.match(/<body\b[^>]*>/i)
  if (!m) return banner + html
  return html.replace(m[0], m[0] + '\n' + banner)
}

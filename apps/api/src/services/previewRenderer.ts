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
    // No placeholder banner: an empty nearby-city slot resolves to the lead's own
    // city (generator.ts buildTokenMap) and the templates list each city once, so
    // there are no "Nearby City N" placeholders left to explain.
    const html = await renderWebsiteDir(websiteDir)
    return { html, slug: result.slug, buildId: result.buildId }
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
    // Same order as the templates' server-static.ts home route — the generator
    // writes defaultMetaTitle/defaultMetaDescription, never seoTitle/seoDescription.
    title: settings.seoTitle || settings.defaultMetaTitle || settings.companyName || settings.title || 'Website Preview',
    description: settings.seoDescription || settings.defaultMetaDescription || 'Professional services',
    canonicalUrl: '',
  }

  const body = await ejs.renderFile(path.join(viewsDir, 'home.ejs'), shared) as string
  const html = await ejs.renderFile(path.join(viewsDir, 'base.ejs'), { ...shared, body }) as string

  // Scroll-reveal sections start at opacity:0 and only appear once JS fires on
  // scroll. In a static preview that can make sections (e.g. Services) look
  // empty, so force all reveal content visible.
  const safety = '<style>.animate-on-scroll{opacity:1 !important;transform:none !important}</style>'
  const withSafety = html.includes('</head>') ? html.replace('</head>', safety + '</head>') : safety + html

  return inlineImages(inlineAssets(withSafety, websiteDir), websiteDir)
}

/**
 * Embed the build's own images (/images/*, /uploads/*) as data: URIs. The
 * preview is shown in an iframe srcdoc on twomiah.com and as a stored page on
 * the API host — neither serves this build's files, so root-relative image
 * paths 404 there and the preview shows no hero, photos or logo. Rasters are
 * downscaled to roughly their displayed size (CSS url() backgrounds are heroes,
 * <img> are cards) so the page stays small enough to cache and store. Anything
 * that can't be read or decoded keeps its original path.
 */
async function inlineImages(html: string, websiteDir: string): Promise<string> {
  const roots = [path.join(websiteDir, 'build'), path.join(websiteDir, 'public')]
  const RE = /(src=["']|url\(\s*['"]?)(\/(?:images|uploads)\/[^"')\s?#]+)/g
  const widthFor = (prefix: string) => (prefix.startsWith('url') ? 1280 : 640)

  const done = new Map<string, string | null>()
  for (const m of html.matchAll(RE)) {
    const key = widthFor(m[1]) + m[2]
    if (!done.has(key)) done.set(key, await imageDataUri(m[2], widthFor(m[1]), roots))
  }
  return html.replace(RE, (all, prefix: string, urlPath: string) => {
    const uri = done.get(widthFor(prefix) + urlPath)
    return uri ? prefix + uri : all
  })
}

async function imageDataUri(urlPath: string, width: number, roots: string[]): Promise<string | null> {
  let rel: string
  try { rel = decodeURIComponent(urlPath).replace(/^\//, '') } catch { return null }
  for (const root of roots) {
    const file = path.resolve(root, rel)
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) continue // path-traversal guard
    const ext = path.extname(file).toLowerCase()
    try {
      if (ext === '.svg') return 'data:image/svg+xml;base64,' + fs.readFileSync(file).toString('base64')
      if (!/^\.(jpe?g|png|webp|gif|avif)$/.test(ext)) return null
      const sharp = (await import('sharp')).default
      const buf = await sharp(file).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 68 }).toBuffer()
      return 'data:image/webp;base64,' + buf.toString('base64')
    } catch {
      return null
    }
  }
  return null
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

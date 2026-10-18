// Rendering a public page: a section list through views/home.ejs into views/base.ejs, from the premium site's
// server-static.ts (renderSections, absolutizeHrefs, markdownToHtml). The views are the site templates' own.
import ejs from 'ejs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { Context } from 'hono'
import type { SiteContext } from './context.ts'

export const VIEWS = path.join(import.meta.dir, '..', '..', 'site', 'views')

/** The site's public address: SITE_URL (the Factory sets it to the customer's domain), else the request's host. */
export function siteOrigin(c: Context): string {
  const explicit = process.env.SITE_URL
  if (explicit) return explicit.replace(/\/+$/, '')
  const host = c.req.header('Host') || 'localhost'
  const proto = c.req.header('X-Forwarded-Proto') || (host.startsWith('localhost') ? 'http' : 'https')
  return proto + '://' + host
}

/**
 * The stylesheet's cache key: the deploy and the colours it was filled with, so browsers keep it for a year yet
 * never show an old colour after the owner changes one.
 */
export function assetVersion(ctx: SiteContext): string {
  const commit = (process.env.RENDER_GIT_COMMIT || '').slice(0, 8) || 'dev'
  return commit + '-' + crypto.createHash('sha1').update([ctx.design, ctx.colours.primary, ctx.colours.accent].join('|')).digest('hex').slice(0, 8)
}

export interface PageMeta { title?: string | null; metaTitle?: string | null; metaDescription?: string | null }

export interface RenderOptions {
  currentPath: string
  origin: string
  /** Nav items this page adds when the owner's nav lacks them (Inventory, Visualizer). */
  extraNav?: Array<{ label: string; href: string }>
  /** Collects sections that failed to render (tests read it; the page itself still renders). */
  sectionErrors?: Array<{ section: string; error: string }>
}

/** Any section list through home.ejs + base.ejs: a stored page, or one the server builds (service areas, a project). */
export async function renderSections(ctx: SiteContext, sections: any[], meta: PageMeta, o: RenderOptions): Promise<string> {
  const { currentPath, origin, extraNav = [] } = o
  const settings = ctx.settings
  let nav: any[] = Array.isArray(settings.nav) ? settings.nav : []
  for (const item of extraNav) {
    if (!nav.some((n: any) => '/' + String(n?.href || '').replace(/^\//, '') === item.href)) nav = [...nav, item]
  }
  const effective = {
    ...settings,
    nav,
    siteOrigin: origin,
    seoTitle: meta.metaTitle || settings.seoTitle || meta.title,
    seoDescription: meta.metaDescription || settings.seoDescription || '',
  }
  // The first hero's image is almost always the mobile Largest Contentful Paint: preloading it lets the browser
  // fetch it while parsing instead of waiting for the section to render.
  const firstHero = sections.find((s) => s && s.type === 'hero')
  const lcpImage = typeof firstHero?.data?.image === 'string' ? firstHero.data.image : ''
  const homepage = { sections }
  const body = await ejs.renderFile(path.join(VIEWS, 'home.ejs'), { homepage, settings: effective, words: ctx.words, sectionErrors: o.sectionErrors ?? [] }) as string
  return wrap(ctx, body, effective, currentPath, lcpImage)
}

/** A body already built (the blog) inside the site's layout. */
export async function renderBody(ctx: SiteContext, body: string, settingsOverrides: Record<string, any>, currentPath: string): Promise<string> {
  return wrap(ctx, body, { ...ctx.settings, ...settingsOverrides }, currentPath, '')
}

async function wrap(ctx: SiteContext, body: string, settings: Record<string, any>, currentPath: string, lcpImage: string): Promise<string> {
  const html = await ejs.renderFile(path.join(VIEWS, 'base.ejs'), {
    body, settings, currentPath, lcpImage,
    assetV: assetVersion(ctx),
    siteOptions: ctx.options,
    // A/B experiments (scripts/ab.js) are a CRM ads feature; they return with the ads module (CUTOVER_LEDGER).
    crmApiUrl: '',
  }) as string
  return absolutizeHrefs(html)
}

/**
 * Composed pages link with bare slugs (href="contact"). Relative, those resolve under the visitor's path — a 404
 * from /blog/a-post. Every bare internal href becomes absolute.
 */
export function absolutizeHrefs(html: string): string {
  return html.replace(/href="([^"]*)"/g, (m: string, raw: string) => {
    if (!raw || /^(?:[a-z][a-z0-9+.-]*:|\/|#|\?|\.)/i.test(raw)) return m
    return 'href="/' + raw.replace(/\.html(?=$|[?#])/i, '') + '"'
  })
}

/** Shown while the site has no home page yet: the site is up, and the owner is pointed at the admin. */
export function homePlaceholder(siteName: string): string {
  const safe = escHtml(siteName)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${safe}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#fafaf7;color:#1a1a1a}main{max-width:680px;margin:10vh auto;padding:48px 32px;text-align:center}h1{font-size:2.5rem;margin:0 0 16px;letter-spacing:-.02em}p{color:#666;font-size:1.05rem;line-height:1.6;margin:0 0 32px}a.cta{display:inline-block;padding:14px 32px;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:6px;font-weight:500}.tag{display:inline-block;font-size:.75rem;letter-spacing:.1em;text-transform:uppercase;color:#999;margin-bottom:24px}</style></head><body><main><span class="tag">Coming Soon</span><h1>${safe}</h1><p>Your website is being prepared. Sign in to the admin to add your home page content, or wait for our composition team to send your preview.</p><a class="cta" href="/admin">Open Admin</a></main></body></html>`
}

export function escHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[ch])
}

export function escXml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' } as Record<string, string>)[ch])
}

// ── Markdown (blog posts, portfolio write-ups) ────────────────────────────────
// A small converter for the 90% case — headings, paragraphs, lists, links, bold/italic, code, quotes, images —
// rather than a dependency. Text is HTML-escaped first; link and image URLs are scheme-checked as well.

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])

export function isSafeUrl(href: string): boolean {
  if (!href) return false
  const trimmed = href.trim()
  if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('?')) return true
  try {
    return SAFE_SCHEMES.has(new URL(trimmed).protocol)
  } catch {
    return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  }
}

function inlineMd(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, href) => {
      const safe = isSafeUrl(href) ? href : '#'
      const attrs = /^https?:/i.test(safe) ? ' rel="noopener noreferrer" target="_blank"' : ''
      return '<a href="' + safe + '"' + attrs + '>' + text + '</a>'
    })
}

export function markdownToHtml(md: string): string {
  if (!md) return ''
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const out: string[] = []
  let inList = false, listTag: 'ul' | 'ol' = 'ul'
  let inBlockquote = false
  let inCode = false
  for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
    const fence = line.match(/^```(\w*)\s*$/)
    if (fence) {
      if (inCode) { out.push('</code></pre>'); inCode = false } else { out.push('<pre><code' + (fence[1] ? ' class="lang-' + fence[1] + '"' : '') + '>'); inCode = true }
      continue
    }
    if (inCode) { out.push(escape(line)); continue }
    const h = line.match(/^(#{1,6})\s+(.+)$/)
    if (h) {
      if (inList) { out.push('</' + listTag + '>'); inList = false }
      if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false }
      out.push('<h' + h[1].length + '>' + inlineMd(escape(h[2])) + '</h' + h[1].length + '>')
      continue
    }
    const ul = line.match(/^\s*[-*]\s+(.+)$/)
    const ol = line.match(/^\s*\d+\.\s+(.+)$/)
    if (ul || ol) {
      const tag: 'ul' | 'ol' = ul ? 'ul' : 'ol'
      if (!inList || listTag !== tag) { if (inList) out.push('</' + listTag + '>'); listTag = tag; out.push('<' + tag + '>'); inList = true }
      out.push('<li>' + inlineMd(escape((ul || ol)![1])) + '</li>')
      continue
    } else if (inList) { out.push('</' + listTag + '>'); inList = false }
    const bq = line.match(/^>\s?(.*)$/)
    if (bq) {
      if (!inBlockquote) { out.push('<blockquote>'); inBlockquote = true }
      out.push('<p>' + inlineMd(escape(bq[1])) + '</p>')
      continue
    } else if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false }
    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/)
    if (img) {
      if (isSafeUrl(img[2]) && /^(https?:|\/)/i.test(img[2])) out.push('<p><img src="' + escape(img[2]) + '" alt="' + escape(img[1]) + '" loading="lazy"></p>')
      continue
    }
    if (line.trim() === '') continue
    out.push('<p>' + inlineMd(escape(line)) + '</p>')
  }
  if (inList) out.push('</' + listTag + '>')
  if (inBlockquote) out.push('</blockquote>')
  if (inCode) out.push('</code></pre>')
  return out.join('\n')
}

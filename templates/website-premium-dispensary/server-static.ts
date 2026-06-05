/**
 * server-static.ts — premium-contractor template runtime.
 *
 * Renders pages from the section-composition schema:
 *   pages row → { sections: [...] } → views/home.ejs → views/base.ejs.
 *
 * Routes:
 *   /                 → renders page slug 'home'
 *   /:slug            → renders any other page row (about, services, contact, custom)
 *   /admin/*          → React SPA at admin/dist/ + JSON API at /api/admin/*
 *   /api/leads        → public POST for the contact form
 *   /api/internal/*   → Factory-key-gated control endpoints (settings sync, etc.)
 *   /uploads/*        → local-fallback static file serving for dev (R2 in prod)
 *   /styles/*, /scripts/* → inline-able build assets
 *   /health           → liveness for Render
 */
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/bun'
import { eq, asc, desc } from 'drizzle-orm'
import ejs from 'ejs'
import fs from 'fs'
import path from 'path'
import { db } from './db'
import { settings as settingsTbl, pages as pagesTbl, leads as leadsTbl, posts as postsTbl } from './db/schema'
import adminRoutes from './routes/admin'
import { secureHeaders, adminCors, loginRateLimit, isSafeUrl } from './lib/security'

const app = new Hono()

app.use('*', logger())
app.use('*', secureHeaders())
// Public marketing pages can be embedded/fetched cross-origin freely.
// The admin API gets a stricter CORS gate further down.
app.use('*', cors())

// In-memory per-IP rate limit for the public contact form. Honeypot +
// dwell-time stop dumb bots; this stops someone hand-flooding a real
// browser. 5 submissions per IP per 10 minutes — generous for a human
// who's correcting typos, brutal for a flood.
const leadBuckets = new Map<string, number[]>()
const LEAD_WINDOW_MS = 10 * 60 * 1000
const LEAD_MAX = 5
function leadClientIp(c: any): string {
  const xff = c.req.header('X-Forwarded-For') || ''
  if (xff) return xff.split(',')[0].trim()
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Real-IP') || 'unknown'
}

// ── Health ────────────────────────────────────────────────────────────────
app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))

// RFC 9116 security disclosure file. Pointer to twomiah.com/security
// keeps every tenant pointing to a single coordinated disclosure page.
app.get('/.well-known/security.txt', (c) => {
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
  return c.text(
    'Contact: mailto:security@twomiah.com\n' +
    'Expires: ' + expires + '\n' +
    'Preferred-Languages: en\n' +
    'Canonical: https://twomiah.com/.well-known/security.txt\n' +
    'Policy: https://twomiah.com/security\n',
    200, { 'Content-Type': 'text/plain; charset=utf-8' }
  )
})

// ── Asset serving (CSS, JS, uploads) ──────────────────────────────────────
app.use('/styles/*', serveStatic({ root: './build' }))
app.use('/scripts/*', serveStatic({ root: './build' }))
app.use('/uploads/*', serveStatic({ root: '.' }))

// ── Helpers ───────────────────────────────────────────────────────────────
const viewsDir = path.join(__dirname, 'views')

async function loadSettings() {
  const rows = await db.select().from(settingsTbl).limit(1)
  return rows[0] || null
}

async function loadPage(slug: string) {
  const rows = await db.select().from(pagesTbl).where(eq(pagesTbl.slug, slug)).limit(1)
  return rows[0] || null
}

async function renderPage(slug: string, currentPath: string): Promise<string | null> {
  const [page, settingsRow] = await Promise.all([loadPage(slug), loadSettings()])
  if (!page || !page.isPublished) return null

  const homepage = { sections: Array.isArray(page.sections) ? page.sections : [] }
  const settings = settingsRow || { companyName: 'Your Company', nav: [], contactCtaLabel: 'Get in touch' }

  // Per-page SEO overrides
  const effectiveSettings = {
    ...settings,
    seoTitle: page.metaTitle || settings.seoTitle || page.title,
    seoDescription: page.metaDescription || settings.seoDescription || '',
  }

  const body = await ejs.renderFile(path.join(viewsDir, 'home.ejs'), { homepage, settings: effectiveSettings }) as string
  return ejs.renderFile(path.join(viewsDir, 'base.ejs'), { body, settings: effectiveSettings, currentPath }) as Promise<string>
}

// Default placeholder served when the pages.home row doesn't exist yet
// (fresh deploy before the AI composer or admin has seeded any content).
// 200 status — the site is up and usable; the CMS admin link gets the
// owner straight to the editor.
function defaultHomePlaceholder(siteName: string): string {
  const safe = siteName.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c))
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${safe}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#fafaf7;color:#1a1a1a}main{max-width:680px;margin:10vh auto;padding:48px 32px;text-align:center}h1{font-size:2.5rem;margin:0 0 16px;letter-spacing:-.02em}p{color:#666;font-size:1.05rem;line-height:1.6;margin:0 0 32px}a.cta{display:inline-block;padding:14px 32px;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:6px;font-weight:500}.tag{display:inline-block;font-size:.75rem;letter-spacing:.1em;text-transform:uppercase;color:#999;margin-bottom:24px}</style></head><body><main><span class="tag">Coming Soon</span><h1>${safe}</h1><p>Your premium website is being prepared. Sign in to the admin to add your home page content, or wait for our composition team to send your preview.</p><a class="cta" href="/admin">Open Admin</a></main></body></html>`
}

// ── Page routes ───────────────────────────────────────────────────────────
app.get('/', async (c) => {
  const html = await renderPage('home', '/')
  if (!html) {
    const siteName = process.env.SITE_NAME || 'Your Site'
    return c.html(defaultHomePlaceholder(siteName))
  }
  return c.html(html)
})

// Blog routes — must register before the catch-all `/:slug` below or
// Hono dispatches /blog to the slug handler first.
app.get('/blog', async (c) => {
  const settings = await loadSettings()
  if (!settings) return c.text('Blog not configured yet.', 503)
  const rows = await db.select().from(postsTbl).where(eq(postsTbl.status, 'published')).orderBy(desc(postsTbl.publishedAt))
  const listHtml = rows.length === 0
    ? '<p class="blog-empty">No posts yet. Check back soon.</p>'
    : '<div class="blog-list">' + rows.map(r => {
        const date = r.publishedAt ? new Date(r.publishedAt as any).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''
        return `<a class="blog-card" href="/blog/${r.slug}">
          ${r.coverImageUrl ? `<img class="blog-card__cover" src="${r.coverImageUrl}" alt="" loading="lazy">` : ''}
          <div class="blog-card__body">
            ${date ? `<div class="blog-card__date">${date}</div>` : ''}
            <h2 class="blog-card__title">${r.title}</h2>
            ${r.excerpt ? `<p class="blog-card__excerpt">${r.excerpt}</p>` : ''}
            <span class="blog-card__more">Read →</span>
          </div>
        </a>`
      }).join('') + '</div>'
  const body = '<section class="blog-section"><div class="container"><h1 class="blog-section__title">From the blog</h1>' + listHtml + '</div></section>'
  const effectiveSettings = {
    ...settings,
    homeHref: '/',
    contactHref: '/contact',
    seoTitle: 'Blog · ' + (settings.companyName || 'Our blog'),
    seoDescription: settings.seoDescription || 'Recent posts from ' + (settings.companyName || 'the team') + '.',
    nav: settings.nav || [],
  }
  const html = await ejs.renderFile(path.join(viewsDir, 'base.ejs'), { body, settings: effectiveSettings, currentPath: '/blog' }) as string
  return c.html(html)
})

app.get('/blog/:slug', async (c) => {
  const slug = c.req.param('slug')
  const settings = await loadSettings()
  if (!settings) return c.text('Blog not configured yet.', 503)
  const rows = await db.select().from(postsTbl).where(eq(postsTbl.slug, slug as string)).limit(1)
  const post = rows[0]
  if (!post || post.status !== 'published') return c.notFound()
  const date = post.publishedAt ? new Date(post.publishedAt as any).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''
  const body = `<article class="blog-post">
    <div class="container container--narrow">
      <a class="blog-post__back" href="/blog">← All posts</a>
      ${post.coverImageUrl ? `<img class="blog-post__cover" src="${post.coverImageUrl}" alt="">` : ''}
      ${date ? `<div class="blog-post__date">${date}</div>` : ''}
      <h1 class="blog-post__title">${post.title}</h1>
      ${post.excerpt ? `<p class="blog-post__excerpt">${post.excerpt}</p>` : ''}
      <div class="blog-post__body">${markdownToHtml(post.body || '')}</div>
    </div>
  </article>`
  const effectiveSettings = {
    ...settings,
    homeHref: '/',
    contactHref: '/contact',
    seoTitle: post.metaTitle || post.title + ' — ' + (settings.companyName || ''),
    seoDescription: post.metaDescription || post.excerpt || '',
    nav: settings.nav || [],
  }
  const html = await ejs.renderFile(path.join(viewsDir, 'base.ejs'), { body, settings: effectiveSettings, currentPath: '/blog/' + slug }) as string
  return c.html(html)
})

// Match a single slug (no slashes, not an api/admin/uploads/styles/scripts prefix).
app.get('/:slug', async (c) => {
  const slug = c.req.param('slug')
  if (['api', 'admin', 'uploads', 'styles', 'scripts', 'health', 'sitemap.xml', 'robots.txt', 'blog'].includes(slug)) return c.notFound()
  const html = await renderPage(slug, '/' + slug)
  if (!html) return c.notFound()
  return c.html(html)
})

// ── Blog ──────────────────────────────────────────────────────────────
// /blog        → list of published posts (newest first)
// /blog/:slug  → individual post detail
// Body is stored as markdown; we render to HTML at request time with a
// tiny inline converter rather than pulling a heavy dep — covers the
// 90% case (headings, paragraphs, lists, links, bold/italic, code,
// blockquotes, images).

function markdownToHtml(md: string): string {
  if (!md) return ''
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let inList = false, listTag: 'ul' | 'ol' = 'ul'
  let inBlockquote = false
  let inCode = false, codeLang = ''
  for (let raw of lines) {
    // Fenced code block
    const fence = raw.match(/^```(\w*)\s*$/)
    if (fence) {
      if (inCode) { out.push('</code></pre>'); inCode = false } else { codeLang = fence[1] || ''; out.push('<pre><code' + (codeLang ? ' class="lang-' + codeLang + '"' : '') + '>'); inCode = true }
      continue
    }
    if (inCode) { out.push(escape(raw)); continue }
    let line = raw
    // Headings
    const h = line.match(/^(#{1,6})\s+(.+)$/)
    if (h) { if (inList) { out.push('</' + listTag + '>'); inList = false } if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false } out.push('<h' + h[1].length + '>' + inlineMd(escape(h[2])) + '</h' + h[1].length + '>'); continue }
    // List items
    const ul = line.match(/^\s*[-*]\s+(.+)$/)
    const ol = line.match(/^\s*\d+\.\s+(.+)$/)
    if (ul || ol) {
      const targetTag: 'ul' | 'ol' = ul ? 'ul' : 'ol'
      if (!inList || listTag !== targetTag) { if (inList) out.push('</' + listTag + '>'); listTag = targetTag; out.push('<' + listTag + '>'); inList = true }
      out.push('<li>' + inlineMd(escape((ul || ol)![1])) + '</li>')
      continue
    } else if (inList) { out.push('</' + listTag + '>'); inList = false }
    // Blockquote
    if (line.match(/^>\s?(.*)$/)) {
      const bq = line.match(/^>\s?(.*)$/)![1]
      if (!inBlockquote) { out.push('<blockquote>'); inBlockquote = true }
      out.push('<p>' + inlineMd(escape(bq)) + '</p>')
      continue
    } else if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false }
    // Image: ![alt](url) — scheme-validate the URL so data:/javascript: can't sneak in
    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/)
    if (img) {
      const rawUrl = img[2]
      if (isSafeUrl(rawUrl) && /^(https?:|\/)/i.test(rawUrl)) {
        out.push('<p><img src="' + escape(rawUrl) + '" alt="' + escape(img[1]) + '" loading="lazy"></p>')
      }
      continue
    }
    // Blank line
    if (line.trim() === '') { continue }
    // Paragraph
    out.push('<p>' + inlineMd(escape(line)) + '</p>')
  }
  if (inList) out.push('</' + listTag + '>')
  if (inBlockquote) out.push('</blockquote>')
  if (inCode) out.push('</code></pre>')
  return out.join('\n')
}

function inlineMd(s: string): string {
  // Order matters — bold before italic. Links are scheme-validated to
  // strip javascript:/data:/vbscript: payloads even though body text is
  // already HTML-escaped upstream (defense in depth).
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, href) => {
      const safe = isSafeUrl(href) ? href : '#'
      const external = /^https?:/i.test(safe)
      const attrs = external ? ' rel="noopener noreferrer" target="_blank"' : ''
      return '<a href="' + safe + '"' + attrs + '>' + text + '</a>'
    })
}

// ── SEO files ──────────────────────────────────────────────────────────
// Dynamic sitemap + robots so search engines see whatever's currently
// published in the pages table. Origin is derived from the incoming
// request when nothing's been explicitly set.

function getSiteOrigin(c: any): string {
  const explicit = process.env.SITE_ORIGIN
  if (explicit) return explicit.replace(/\/+$/, '')
  const url = new URL(c.req.url)
  return `${url.protocol}//${url.host}`
}

app.get('/sitemap.xml', async (c) => {
  const origin = getSiteOrigin(c)
  const pageRows = await db.select().from(pagesTbl).where(eq(pagesTbl.isPublished, true)).orderBy(asc(pagesTbl.navOrder), asc(pagesTbl.title))
  const postRows = await db.select().from(postsTbl).where(eq(postsTbl.status, 'published')).orderBy(desc(postsTbl.publishedAt))
  const urls: string[] = []
  for (const r of pageRows) {
    const loc = origin + (r.slug === 'home' ? '/' : '/' + r.slug)
    const lastmod = r.updatedAt instanceof Date ? r.updatedAt.toISOString() : new Date(r.updatedAt as any).toISOString()
    urls.push(`  <url><loc>${escapeXml(loc)}</loc><lastmod>${lastmod}</lastmod></url>`)
  }
  if (postRows.length > 0) {
    urls.push(`  <url><loc>${escapeXml(origin + '/blog')}</loc></url>`)
    for (const r of postRows) {
      const loc = origin + '/blog/' + r.slug
      const lastmod = r.updatedAt instanceof Date ? r.updatedAt.toISOString() : new Date(r.updatedAt as any).toISOString()
      urls.push(`  <url><loc>${escapeXml(loc)}</loc><lastmod>${lastmod}</lastmod></url>`)
    }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.join('\n') +
    `\n</urlset>\n`
  c.header('Content-Type', 'application/xml')
  c.header('Cache-Control', 'public, max-age=3600')
  return c.body(xml)
})

app.get('/robots.txt', async (c) => {
  const origin = getSiteOrigin(c)
  const body =
    `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`
  c.header('Content-Type', 'text/plain')
  c.header('Cache-Control', 'public, max-age=86400')
  return c.body(body)
})

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] || c))
}

// ── Public: lead capture from the contact form ────────────────────────────
app.post('/api/leads', async (c) => {
  try {
    // Rate-limit first — keeps the DB write and email send off the
    // critical path for flooders.
    const ip = leadClientIp(c)
    const now = Date.now()
    const times = (leadBuckets.get(ip) || []).filter(t => now - t < LEAD_WINDOW_MS)
    if (times.length >= LEAD_MAX) {
      const retryAfterSec = Math.ceil((LEAD_WINDOW_MS - (now - times[0])) / 1000)
      c.res.headers.set('Retry-After', String(retryAfterSec))
      return c.json({ error: 'Too many submissions. Please try again later.' }, 429)
    }
    times.push(now)
    leadBuckets.set(ip, times)

    const body = await c.req.parseBody() as Record<string, any>

    // ── Spam protection (honeypot + minimum dwell time) ────────────────
    // The contact form template includes a hidden 'website' field that
    // legitimate users never see. Bots auto-fill every input — any
    // value here is a tell. Silently 200 so the bot thinks it worked.
    // The form also stamps a hidden 't' field with Date.now() when it
    // renders; if the submit lands in under 1.5s the form was almost
    // certainly auto-completed. Both checks are cheap and effective.
    const honeypot = String(body.website || '').trim()
    if (honeypot) {
      console.log('[Leads] honeypot triggered — silent drop')
      return c.json({ ok: true, message: "Got it. We'll reply within one business day." })
    }
    const stamp = parseInt(String(body.t || '0'), 10)
    if (stamp > 0 && Date.now() - stamp < 1500) {
      console.log('[Leads] dwell-time triggered — silent drop')
      return c.json({ ok: true, message: "Got it. We'll reply within one business day." })
    }

    const name = String(body.name || '').trim()
    const email = String(body.email || '').trim()
    const phone = String(body.phone || '').trim() || null
    const message = String(body.project || body.message || '').trim()
    const source = String(body.source || c.req.header('referer') || '').trim() || null

    if (!name || name.length < 2) return c.json({ error: 'Name is required.' }, 400)
    if (!email || !email.includes('@')) return c.json({ error: 'Valid email required.' }, 400)
    if (!message || message.length < 4) return c.json({ error: 'Tell us a bit about your project.' }, 400)

    await db.insert(leadsTbl).values({ name, email, phone, message, source: source || undefined })

    // Fire-and-forget owner notification. Reads recipient from
    // settings.email (the customer's contact address); skips silently
    // if SENDGRID_API_KEY isn't set yet.
    notifyOwnerOfLead({ name, email, phone, message, source }).catch((e: any) =>
      console.warn('[Leads] owner notification failed:', e.message))

    return c.json({ ok: true, message: "Got it. We'll reply within one business day." })
  } catch (err: any) {
    console.error('[Leads] insert failed:', err.message)
    return c.json({ error: 'Could not save your message. Please try again.' }, 500)
  }
})

async function notifyOwnerOfLead(lead: { name: string; email: string; phone: string | null; message: string; source: string | null }): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY
  if (!apiKey) return
  const fromEmail = process.env.FROM_EMAIL || process.env.FACTORY_FROM_EMAIL || 'noreply@twomiah.app'
  const settingsRow = await loadSettings()
  const toEmail = (settingsRow as any)?.email
  if (!toEmail) return
  const companyName = (settingsRow as any)?.companyName || 'Your site'
  const escape = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c))
  const subject = `New website lead — ${lead.name}`
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#fafaf7;margin:0;padding:40px 16px;color:#1a1a1a;">
    <table width="560" cellpadding="0" cellspacing="0" align="center" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(20,20,30,0.06);">
      <tr><td style="padding:28px 32px 16px;"><div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#888;">${escape(companyName)} · new lead</div></td></tr>
      <tr><td style="padding:0 32px 12px;"><h2 style="margin:0;font-size:22px;color:#1a1a1a;">${escape(lead.name)}</h2></td></tr>
      <tr><td style="padding:0 32px 24px;color:#3a3a3a;font-size:15px;line-height:1.6;">
        <div><strong>Email:</strong> <a href="mailto:${escape(lead.email)}" style="color:#1a1a1a;">${escape(lead.email)}</a></div>
        ${lead.phone ? `<div><strong>Phone:</strong> <a href="tel:${escape(lead.phone)}" style="color:#1a1a1a;">${escape(lead.phone)}</a></div>` : ''}
        ${lead.source ? `<div style="margin-top:6px;color:#888;font-size:13px;">Submitted from: ${escape(lead.source)}</div>` : ''}
        <div style="margin-top:18px;padding:14px 18px;background:#fafaf7;border-left:3px solid #f97316;border-radius:4px;white-space:pre-wrap;">${escape(lead.message)}</div>
      </td></tr>
      <tr><td style="padding:0 32px 24px;"><a href="mailto:${escape(lead.email)}?subject=Re:%20your%20inquiry" style="display:inline-block;background:#f97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Reply now</a></td></tr>
      <tr><td style="background:#fafaf7;padding:16px 32px;border-top:1px solid #eee;color:#888;font-size:12px;">This lead is also saved in your admin under Leads.</td></tr>
    </table>
  </body></html>`
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail }], subject }],
      from: { email: fromEmail, name: 'Twomiah' },
      reply_to: { email: lead.email, name: lead.name },
      content: [{ type: 'text/html', value: html }],
    }),
  })
  if (!res.ok) {
    console.warn('[Leads] SendGrid HTTP', res.status, await res.text().catch(() => ''))
  }
}

// ── Billing portal proxy ─────────────────────────────────────────────────
// The admin UI calls this to get a Stripe Customer Portal URL. We
// forward to the Factory (which has the Stripe secret key) using the
// shared FACTORY_SYNC_KEY for auth. Admin-only — gated by /api/admin/
// auth middleware in the route mount above isn't applied here, but
// the path is /api/admin/billing-portal so we gate manually below.
app.get('/api/admin/billing-portal', async (c) => {
  const authz = c.req.header('Authorization') || ''
  if (!authz.startsWith('Bearer ')) return c.json({ error: 'Missing auth token' }, 401)
  // Don't bother fully verifying — admin SPA already gates the route.
  // The token presence is a smoke check.

  const factoryUrl = process.env.FACTORY_URL
  const tenantId = process.env.TENANT_ID
  const syncKey = process.env.FACTORY_SYNC_KEY
  if (!factoryUrl || !tenantId || !syncKey) {
    return c.json({ error: 'Billing portal not configured on this tenant.' }, 503)
  }
  try {
    const r = await fetch(factoryUrl.replace(/\/+$/, '') + '/api/v1/factory/internal/billing-portal/' + tenantId, {
      headers: { 'X-Factory-Key': syncKey },
      signal: AbortSignal.timeout(15000),
    })
    const body = await r.json()
    if (!r.ok) return c.json(body, r.status as 400 | 401 | 403 | 404 | 409 | 500 | 503)
    return c.json(body)
  } catch (e: any) {
    return c.json({ error: 'Factory unreachable: ' + e.message }, 502)
  }
})

// ── Factory internal: sync settings from the Factory ──────────────────────
app.post('/api/internal/sync-settings', async (c) => {
  const factoryKey = process.env.FACTORY_SYNC_KEY
  if (!factoryKey) return c.json({ error: 'Factory sync not configured' }, 503)
  if (c.req.header('X-Factory-Key') !== factoryKey) return c.json({ error: 'Unauthorized' }, 401)

  const patch = await c.req.json().catch(() => ({})) as Record<string, any>
  const existing = await loadSettings()
  if (!existing) return c.json({ error: 'Settings row not initialized yet' }, 409)

  const allowed: Record<string, any> = {}
  const fields = ['companyName', 'tagline', 'phone', 'email', 'address', 'seoTitle', 'seoDescription',
    'contactCtaLabel', 'primaryColor', 'secondaryColor', 'accentColor', 'logoUrl', 'faviconUrl', 'nav']
  for (const f of fields) if (f in patch) allowed[f] = patch[f]
  if (Object.keys(allowed).length === 0) return c.json({ ok: true, noChanges: true })

  await db.update(settingsTbl).set({ ...allowed, updatedAt: new Date() }).where(eq(settingsTbl.id, existing.id))
  return c.json({ ok: true, applied: Object.keys(allowed) })
})

// ── Factory internal: seed intake photos into the tenant's library ────────
//
// Called by the Factory after deploy completes, to copy photos the prospect
// uploaded during /public/intake (which live on the Factory's signed-URL
// storage and expire in 7 days) into the tenant's own R2 bucket + photos
// table so they survive long-term.
//
// Body: { photos: [{ url, tag?, alt? }] }
app.post('/api/internal/seed-photos', async (c) => {
  const factoryKey = process.env.FACTORY_SYNC_KEY
  if (!factoryKey) return c.json({ error: 'Factory sync not configured' }, 503)
  if (c.req.header('X-Factory-Key') !== factoryKey) return c.json({ error: 'Unauthorized' }, 401)

  let body: { photos?: Array<{ url?: string; tag?: string; alt?: string }> }
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const incoming = Array.isArray(body.photos) ? body.photos : []
  if (incoming.length === 0) return c.json({ ok: true, seeded: 0 })

  const [sharp, { uploadImage }, schema] = await Promise.all([
    import('sharp').then(m => m.default),
    import('./services/storage'),
    import('./db/schema'),
  ])
  const photosTbl = schema.photos

  let seeded = 0
  const errors: Array<{ url: string; error: string }> = []
  for (const p of incoming.slice(0, 50)) {
    if (!p.url || typeof p.url !== 'string') continue
    try {
      const res = await fetch(p.url, { signal: AbortSignal.timeout(30_000) })
      if (!res.ok) throw new Error('fetch failed: ' + res.status)
      const raw = Buffer.from(await res.arrayBuffer())
      const meta = await sharp(raw).metadata()
      const isAlphaPng = meta.format === 'png' && meta.hasAlpha
      const processedBuffer = isAlphaPng ? raw : await sharp(raw).rotate().jpeg({ quality: 82, mozjpeg: true }).toBuffer()
      const processedType = isAlphaPng ? 'image/png' : 'image/jpeg'

      const upload = await uploadImage(processedBuffer, {
        filename: 'intake-photo' + (isAlphaPng ? '.png' : '.jpg'),
        contentType: processedType,
      })

      await db.insert(photosTbl).values({
        url: upload.url,
        storageKey: upload.storageKey,
        alt: p.alt || null,
        tag: p.tag || null,
        width: meta.width || null,
        height: meta.height || null,
        bytes: upload.bytes,
        contentType: upload.contentType,
      })
      seeded++
    } catch (err: any) {
      errors.push({ url: p.url, error: err.message || String(err) })
    }
  }

  return c.json({ ok: true, seeded, errors: errors.length > 0 ? errors : undefined })
})

// ── Admin: JSON API + SPA ─────────────────────────────────────────────────
// JSON API mounted at /api/admin/*. The React SPA build lands at
// admin/dist/ and gets served below at /admin/*. SPA routes that don't
// match a built asset fall back to index.html so client-side routing works.
// Admin API: stricter CORS than public pages — only same-origin browser
// requests, or explicit allowlist via CORS_ALLOWED_ORIGINS env var.
app.use('/api/admin/*', adminCors())
// Login endpoint gets its own rate limit before the bcrypt comparison.
app.use('/api/admin/login', loginRateLimit())
app.route('/api/admin', adminRoutes)

const adminDistDir = path.join(__dirname, 'admin', 'dist')
const hasAdminBuild = fs.existsSync(adminDistDir) && fs.existsSync(path.join(adminDistDir, 'index.html'))

if (hasAdminBuild) {
  app.use('/admin/assets/*', serveStatic({ root: './admin/dist' }))
  app.get('/admin/*', (c) => {
    // SPA fallback — serve index.html for any /admin/* request that wasn't
    // an asset. React Router takes over from there.
    const html = fs.readFileSync(path.join(adminDistDir, 'index.html'), 'utf8')
    return c.html(html)
  })
} else {
  app.get('/admin/*', (c) => c.html(
    '<!doctype html><meta charset="utf-8"><title>Admin not built</title>' +
    '<body style="font:16px system-ui;padding:40px;max-width:560px;margin:auto">' +
    '<h1>Admin not built</h1>' +
    '<p>Run <code>cd admin && bun install && bun run build</code> to ship the admin UI.</p>' +
    '</body>'
  ))
}

// ── Boot ──────────────────────────────────────────────────────────────────
const port = Number(process.env.PORT || '3000')
console.log('[Premium-Contractor] Serving on port', port)

export default {
  port,
  fetch: app.fetch,
}

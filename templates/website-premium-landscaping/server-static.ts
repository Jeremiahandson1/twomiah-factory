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
import { eq, asc } from 'drizzle-orm'
import ejs from 'ejs'
import fs from 'fs'
import path from 'path'
import { db } from './db'
import { settings as settingsTbl, pages as pagesTbl, leads as leadsTbl } from './db/schema'
import adminRoutes from './routes/admin'

const app = new Hono()

app.use('*', logger())
app.use('*', cors())

// ── Health ────────────────────────────────────────────────────────────────
app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))

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

// Match a single slug (no slashes, not an api/admin/uploads/styles/scripts prefix).
app.get('/:slug', async (c) => {
  const slug = c.req.param('slug')
  if (['api', 'admin', 'uploads', 'styles', 'scripts', 'health', 'sitemap.xml', 'robots.txt'].includes(slug)) return c.notFound()
  const html = await renderPage(slug, '/' + slug)
  if (!html) return c.notFound()
  return c.html(html)
})

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
  const rows = await db.select().from(pagesTbl).where(eq(pagesTbl.isPublished, true)).orderBy(asc(pagesTbl.navOrder), asc(pagesTbl.title))
  const urls = rows.map(r => {
    const loc = origin + (r.slug === 'home' ? '/' : '/' + r.slug)
    const lastmod = r.updatedAt instanceof Date ? r.updatedAt.toISOString() : new Date(r.updatedAt as any).toISOString()
    return `  <url><loc>${escapeXml(loc)}</loc><lastmod>${lastmod}</lastmod></url>`
  })
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
    const body = await c.req.parseBody() as Record<string, any>
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

// The website editor's live preview: the owner's UNSAVED edits drawn by the site's own routes and renderer, without
// saving anything (site/drafts.ts has the draft-and-live model this serves).
//
//   POST /api/site/preview/:kind/:slug { data }  holds the editor's current state for this person and this record
//   GET  /api/site/preview/:kind/:slug           the page, rendered with it — what the editor's frame loads
//        ?settings=draft                         …under the saved draft settings as well (the whole site as it will be)
//
// kind is page, post, portfolio or settings (slug "site": the home page under the draft settings). With nothing held, the
// GET draws the saved draft, so a person who may only read the site sees what is waiting to be published.
//
// Why it is built this way:
//   • Exact. The render is a request through the app itself (fetchApp) to the page's own public address — the same
//     route, the same renderSections, the same views, stylesheet, fonts and photos — with the record read from the held
//     state instead of the database (drafts.ts previewScope). Draft settings change the stylesheet (a design, an accent
//     colour), which the page links at /styles/main.css: a preview with draft settings carries that sheet inline instead.
//   • Same origin, by address. The frame loads /api/... on whatever name the admin is on: the domain, the Render address
//     or app.<domain>, where /api/ is shared (http/adminHost.ts). It is NOT shown through srcdoc: a srcdoc frame takes the
//     admin's policy, which refuses every inline script the site is built on (its menu, sliders and forms — guards.ts),
//     so it would not look or behave like the live page. This answer carries the site's own policy.
//   • Signed in. The admin's session is its cookies (web/src/api.ts), which a same-origin frame sends; the routes check
//     site:read like every other read here. Posted state is drawn only for someone who may write that record.
//   • Not a visit, not tracked, not indexed. The site's visit counter skips any render in the preview scope, the draft
//     settings drop the tracking ids (context.ts), and the answer says noindex and no-store.
//   • Nothing leaves the frame. Links and forms in the preview do nothing: a click would load the live site in the
//     editor's pane, and a sent form would be a real enquiry.
//   • Held state is per person and per record, replaced on every redraw, dropped after 30 minutes unused; one server per
//     business (SPEC §2) holds it in memory.
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { page, post, portfolioItem, website } from '../db/schema/index.ts'
import type { VerticalSettings } from '../core/vertical.ts'
import { fail, one } from '../http/reply.ts'
import { SITE_CSP } from '../http/guards.ts'
import { loadSiteContext, type SiteContext } from './context.ts'
import { PAGE_DRAFT, POST_DRAFT, PORTFOLIO_DRAFT, SETTINGS_DRAFT, previewScope, workingOf, draftOf, type DraftFields, type PreviewOverlay } from './drafts.ts'

export type PreviewKind = 'page' | 'post' | 'portfolio' | 'settings'

const KINDS: Record<PreviewKind, { table: any; fields: DraftFields; write: string; path: (slug: string) => string }> = {
  page: { table: page, fields: PAGE_DRAFT, write: 'site:update', path: (s) => (s === 'home' ? '/' : '/' + s) },
  post: { table: post, fields: POST_DRAFT, write: 'site:update', path: (s) => '/blog/' + s },
  portfolio: { table: portfolioItem, fields: PORTFOLIO_DRAFT, write: 'site:update', path: (s) => '/projects/' + s },
  settings: { table: website, fields: SETTINGS_DRAFT, write: 'site:settings', path: () => '/' },
}

const HOLD_MS = 30 * 60_000
const MAX_HELD = 500

/** In the frame: links and forms stay put (see the top). In-page anchors (#reviews) still scroll. */
const FRAME_SCRIPT = `<script data-preview>(function(){document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!a)return;var h=a.getAttribute('href')||'';if(h.charAt(0)==='#')return;e.preventDefault();},true);document.addEventListener('submit',function(e){e.preventDefault();},true);})();</script>`

/** The site's stylesheet link, as views/base.ejs prints it. */
const SHEET_LINK = /<link rel="stylesheet" href="\/styles\/main\.css\?v=[^"]*">/g

export interface PreviewDeps {
  db: any
  vertical: VerticalSettings
  hasPermission: (c: any, permission: string) => Promise<boolean>
  /** The whole app, to render a page by its public address. */
  fetchApp: (req: Request) => Response | Promise<Response>
  /** The site's stylesheet for a context (routes.ts siteStylesheet). */
  stylesheet: (ctx: SiteContext) => string
  now?: () => number
}

export function addPreviewRoutes(app: Hono<any>, may: (p: string) => any, deps: PreviewDeps) {
  const now = deps.now ?? Date.now
  const held = new Map<string, { overlay: PreviewOverlay; at: number }>()
  const keyOf = (c: any, kind: string, slug: string) => c.get('user').userId + '|' + kind + '|' + slug
  const sweep = () => {
    const t = now()
    for (const [k, v] of held) if (t - v.at > HOLD_MS) held.delete(k)
    while (held.size > MAX_HELD) held.delete(held.keys().next().value as string)
  }

  /** The record's saved state (its draft, else live) as the overlay, or null when there is no such record. */
  async function savedOverlay(c: any, kind: PreviewKind, slug: string): Promise<PreviewOverlay | null> {
    const k = KINDS[kind]
    const companyId = c.get('user').companyId
    const [row] = await deps.db.select().from(k.table)
      .where(kind === 'settings' ? eq(k.table.companyId, companyId) : and(eq(k.table.companyId, companyId), eq(k.table.slug, slug))).limit(1)
    if (!row && kind !== 'settings') return null
    const data = workingOf(row ?? {}, k.fields)
    return kind === 'settings' ? { settings: data } : { [kind]: { slug, data } }
  }

  /**
   * "Change layout" thumbnails: ONE section drawn in a given layout, by the site's own renderer, under the page's own
   * design and colours. The editor posts the section (its words and photos as they are now) and a layout; the page is
   * drawn with that section alone and the site's header and footer hidden, so the frame shows the section and nothing
   * else. Held per person, page and layout, like every preview here; nothing is saved.
   */
  app.post('/preview/layout/:slug', may('site:read'), async (c) => {
    const slug = c.req.param('slug')
    const b = await c.req.json().catch(() => null) as { section?: { type?: unknown; data?: unknown }; variant?: unknown } | null
    const sec = b?.section
    if (!sec || typeof sec.type !== 'string' || typeof b?.variant !== 'string' || !/^[a-z0-9_-]+$/i.test(b.variant)) return fail(c, 400, 'Say which section and layout')
    const base = await savedOverlay(c, 'page', slug)
    if (!base) return fail(c, 404, 'Nothing to preview')
    const saved = (base as any).page.data as Record<string, unknown>
    const data = sec.data && typeof sec.data === 'object' ? sec.data : {}
    const overlay: PreviewOverlay = { page: { slug, data: { ...saved, sections: [{ type: sec.type, variant: b.variant, data }] } } } as any
    sweep()
    const key = keyOf(c, 'layout', slug + '#' + b.variant)
    held.delete(key)
    held.set(key, { overlay, at: now() })
    return one(c, { url: `/api/site/preview/layout/${encodeURIComponent(slug)}?v=${encodeURIComponent(b.variant)}` })
  })

  app.get('/preview/layout/:slug', may('site:read'), async (c) => {
    const slug = c.req.param('slug')
    const kept = held.get(keyOf(c, 'layout', slug + '#' + (c.req.query('v') || '')))
    if (!kept) return fail(c, 404, 'Nothing to preview')
    kept.at = now()
    const url = new URL(c.req.url)
    const res = await previewScope.run(kept.overlay, () => deps.fetchApp(new Request(url.origin + KINDS.page.path(slug), {
      headers: { Host: c.req.header('Host') || url.host, 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', Accept: 'text/html' },
    })))
    if (!(res.headers.get('content-type') || '').includes('text/html')) return fail(c, 404, 'This page has no preview')
    let html = await res.text()
    const bare = '<style data-layout-thumb>body>header,body>footer,.site-header,.site-footer,.mobile-nav,.skip-link,.text-size-toggle{display:none!important}html,body{min-height:0!important;margin:0}</style>'
    const end = html.lastIndexOf('</body>')
    html = (end >= 0 ? html.slice(0, end) + bare + FRAME_SCRIPT + html.slice(end) : html + bare + FRAME_SCRIPT)
    return c.html(html, 200, headers())
  })

  const kindOf = (c: any): PreviewKind | null => {
    const k = c.req.param('kind')
    return k in KINDS ? (k as PreviewKind) : null
  }

  /** The editor's current state, held for the next GET. Drawn only for someone who may write the record. */
  app.post('/preview/:kind/:slug', may('site:read'), async (c) => {
    const kind = kindOf(c)
    if (!kind) return fail(c, 404, 'Nothing to preview')
    const slug = kind === 'settings' ? 'site' : c.req.param('slug')
    const body = await c.req.json().catch(() => null) as { data?: Record<string, unknown> } | null
    const base = await savedOverlay(c, kind, slug)
    if (!base) return fail(c, 404, 'Nothing to preview')
    let overlay = base
    const data = body?.data
    if (data && typeof data === 'object' && !Array.isArray(data) && await deps.hasPermission(c, KINDS[kind].write)) {
      const fields = KINDS[kind].fields
      const saved = (kind === 'settings' ? base.settings : (base as any)[kind].data) as Record<string, unknown>
      const merged: Record<string, unknown> = { ...saved }
      for (const f of fields) if (f in data) merged[f] = data[f]
      // A page with a list that isn't one draws nothing rather than failing.
      if ('sections' in merged && !Array.isArray(merged.sections)) merged.sections = []
      if ('photos' in merged && !Array.isArray(merged.photos)) merged.photos = []
      overlay = kind === 'settings' ? { settings: merged } : { [kind]: { slug, data: merged } }
    }
    sweep()
    held.delete(keyOf(c, kind, slug))
    held.set(keyOf(c, kind, slug), { overlay, at: now() })
    return one(c, { url: `/api/site/preview/${kind}/${encodeURIComponent(slug)}` })
  })

  /** The page, drawn from the held state (else the saved draft) by the site's own route. */
  app.get('/preview/:kind/:slug', may('site:read'), async (c) => {
    const kind = kindOf(c)
    if (!kind) return fail(c, 404, 'Nothing to preview')
    const slug = kind === 'settings' ? 'site' : c.req.param('slug')
    const kept = held.get(keyOf(c, kind, slug))
    if (kept) kept.at = now()
    let overlay = kept?.overlay ?? await savedOverlay(c, kind, slug)
    if (!overlay) return fail(c, 404, 'Nothing to preview')
    // ?settings=draft: the page under the site's saved draft settings too — the whole site as it will be once everything
    // is published (the editor offers it while the settings have a draft).
    if (kind !== 'settings' && c.req.query('settings') === 'draft') {
      const [site] = await deps.db.select().from(website).where(eq(website.companyId, (c as any).get('user').companyId)).limit(1)
      if (site && draftOf(site)) overlay = { ...overlay, settings: workingOf(site, SETTINGS_DRAFT) }
    }
    const url = new URL(c.req.url)
    const pathname = KINDS[kind].path(slug)
    // Through the app, as a same-origin frame of this name would ask: on app.<domain> the website half answers such a
    // frame rather than handing it to the domain (http/adminHost.ts).
    const res = await previewScope.run(overlay, () => deps.fetchApp(new Request(url.origin + pathname, {
      headers: { Host: c.req.header('Host') || url.host, 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', Accept: 'text/html' },
    })))
    if (!(res.headers.get('content-type') || '').includes('text/html')) {
      return c.html('<!doctype html><meta charset="utf-8"><p style="font:14px system-ui;padding:24px;color:#475569">This page has no preview.</p>', 200, headers())
    }
    let html = await res.text()
    if (overlay.settings) {
      const ctx = await previewScope.run(overlay, () => loadSiteContext(deps.db, deps.vertical))
      if (ctx) { const css = deps.stylesheet(ctx).replace(/<\/style/gi, '<\\/style'); html = html.replace(SHEET_LINK, () => '<style>' + css + '</style>') }
    }
    const end = html.lastIndexOf('</body>')
    html = end >= 0 ? html.slice(0, end) + FRAME_SCRIPT + html.slice(end) : html + FRAME_SCRIPT
    return c.html(html, res.status === 404 ? 404 : 200, headers())
  })
}

const headers = () => ({ 'Content-Security-Policy': SITE_CSP, 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' })

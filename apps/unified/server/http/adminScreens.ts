// The admin screens (web/, built to web/dist): the page at the sign-in paths and everywhere under /crm, and its files
// at /crm-assets/*. The screens sign in through /api themselves, so serving them needs no session.
import { Hono } from 'hono'
import fs from 'node:fs'
import path from 'node:path'
import { escHtml } from '../core/email.ts'

/** The built app, beside the server: apps/unified/web/dist. */
export const ADMIN_DIST = path.resolve(import.meta.dir, '..', '..', 'web', 'dist')

/** The paths that open the admin's page (react-router takes it from there). */
// /portal/<token> and /vendor/<token> are a customer's and a vendor's own pages, reached by their private link; /d/<token>
// is one quote's or invoice's own page, the link in its email (packages/tenant-backend portal/documentLinks.ts); /w/<token> is a
// crew's or sub's work order, the link in the text (server/crm/roof/crewLink.ts).
export const ADMIN_PAGES = ['/login', '/forgot-password', '/reset-password', '/crm', '/crm/*', '/portal/*', '/vendor/*', '/d/*', '/w/*']

/**
 * A home-care agency's public pages, which are the app's, not the website's (templates/crm-homecare App.tsx): the client
 * portal (/portal, its sign-in and invite setup), the family portal, paying a visit invoice, a new hire's onboarding
 * packet, and the careers page. Served only for the home-care vertical; everywhere else these paths stay the website's.
 */
export const HOMECARE_PAGES = ['/portal', '/family', '/family/*', '/pay/*', '/payment-success', '/onboarding/*', '/careers', '/careers/*']

/**
 * The browser tab's words. A customer's portal (/portal/<token>) is the customer's, not the admin's: it read "Admin"
 * (roofing retest 2026-10-24) and now reads "<Business> — Customer portal". Everything else is the admin's.
 */
/**
 * Every public page the app serves is titled for its visitor (restaurant live test 2026-10-25: the emailed invoice link
 * read "<Business> · Admin"). The /d/ page names the quote or invoice itself once it has loaded (packages/tenant-ui
 * portal/PortalDocumentLink.tsx).
 */
const PUBLIC_TITLES: Array<[RegExp, string]> = [
  [/^\/portal(\/|$)/, 'Customer portal'],
  [/^\/d\//, 'Your quote or invoice'],
  [/^\/vendor\//, 'Vendor portal'],
  [/^\/w\//, 'Work order'],
  [/^\/family(\/|$)/, 'Family portal'],
  [/^\/pay\//, 'Pay your invoice'],
  [/^\/payment-success$/, 'Payment received'],
  [/^\/onboarding\//, 'New hire paperwork'],
  [/^\/careers(\/|$)/, 'Careers'],
]
export function tabTitle(pathname: string, name: string): string {
  const own = PUBLIC_TITLES.find(([re]) => re.test(pathname))?.[1]
  if (own) return name ? `${name} — ${own}` : own
  // The business's name alone: "· Admin" on every tab, a bartender's and a viewer's too (bar live test, 2026-10-25).
  return name || 'CRM'
}

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json', '.map': 'application/json',
}

const NOT_BUILT = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Admin</title></head>' +
  '<body style="font:16px system-ui,sans-serif;padding:2rem">The admin screens haven’t been built on this server (bun run build:web).</body></html>'

export function createAdminScreens(deps: {
  companyName: () => Promise<string | null>
  screens: () => Record<string, unknown> | Promise<Record<string, unknown>>
  distDir?: string
  extraPages?: readonly string[]
  /**
   * The business's colours and public email, for pages a visitor opens without signing in (no shell loads the company
   * for them): a home-care agency's portals and its invoice payment page ("Questions about this invoice? Email …").
   */
  brand?: () => Promise<{ primaryColor?: string | null; secondaryColor?: string | null; email?: string | null } | null>
}) {
  const dist = deps.distDir ?? ADMIN_DIST
  const app = new Hono()

  // The page, with the business's name in the tab and for the sign-in screen (web/src/screens.tsx reads the meta).
  // Never cached: it names the current build's files.
  const page = async (c: any) => {
    let html: string
    try { html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8') } catch { return c.html(NOT_BUILT, 503) }
    const name = (await deps.companyName()) || ''
    // The vertical's screen settings (VerticalSettings.screens) as data the page reads: not run, and < escaped so no
    // value can close the element.
    const screens = JSON.stringify(await deps.screens()).replace(/</g, '\\u003c')
    const colours = (await deps.brand?.()) ?? null
    const hex = (v?: string | null) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v : '')
    const head = `<title>${escHtml(tabTitle(c.req.path, name))}</title><meta name="company-name" content="${escHtml(name)}">` +
      `<meta name="brand-primary" content="${hex(colours?.primaryColor)}"><meta name="brand-secondary" content="${hex(colours?.secondaryColor)}">` +
      `<meta name="company-email" content="${escHtml(colours?.email ?? '')}">` +
      `<script type="application/json" id="vertical-screens">${screens}</script>`
    c.header('Cache-Control', 'no-store')
    return c.html(html.replace(/<title>[^<]*<\/title>/, head))
  }
  for (const p of [...ADMIN_PAGES, ...(deps.extraPages ?? [])]) app.get(p, page)

  // The built files. Their names carry a hash of their contents, so a browser may keep them for good.
  app.get('/crm-assets/*', async (c) => {
    const rel = decodeURIComponent(c.req.path.slice('/crm-assets/'.length))
    const file = path.resolve(dist, rel)
    if (!file.startsWith(dist + path.sep) || rel.endsWith('index.html')) return c.notFound()
    const f = Bun.file(file)
    if (!(await f.exists())) return c.notFound()
    return c.body(await f.arrayBuffer(), 200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
  })

  return app
}

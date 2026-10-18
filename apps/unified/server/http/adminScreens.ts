// The admin screens (web/, built to web/dist): the page at the sign-in paths and everywhere under /crm, and its files
// at /crm-assets/*. The screens sign in through /api themselves, so serving them needs no session.
import { Hono } from 'hono'
import fs from 'node:fs'
import path from 'node:path'
import { escHtml } from '../core/email.ts'

/** The built app, beside the server: apps/unified/web/dist. */
export const ADMIN_DIST = path.resolve(import.meta.dir, '..', '..', 'web', 'dist')

/** The paths that open the admin's page (react-router takes it from there). */
export const ADMIN_PAGES = ['/login', '/forgot-password', '/reset-password', '/crm', '/crm/*']

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json', '.map': 'application/json',
}

const NOT_BUILT = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Admin</title></head>' +
  '<body style="font:16px system-ui,sans-serif;padding:2rem">The admin screens haven’t been built on this server (bun run build:web).</body></html>'

export function createAdminScreens(deps: { companyName: () => Promise<string | null>; distDir?: string }) {
  const dist = deps.distDir ?? ADMIN_DIST
  const app = new Hono()

  // The page, with the business's name in the tab and for the sign-in screen (web/src/screens.tsx reads the meta).
  // Never cached: it names the current build's files.
  const page = async (c: any) => {
    let html: string
    try { html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8') } catch { return c.html(NOT_BUILT, 503) }
    const name = (await deps.companyName()) || ''
    const head = `<title>${escHtml(name ? name + ' · Admin' : 'Admin')}</title><meta name="company-name" content="${escHtml(name)}">`
    c.header('Cache-Control', 'no-store')
    return c.html(html.replace(/<title>[^<]*<\/title>/, head))
  }
  for (const p of ADMIN_PAGES) app.get(p, page)

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

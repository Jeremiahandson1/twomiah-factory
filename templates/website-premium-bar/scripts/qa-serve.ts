/**
 * qa-serve.ts — serve _render/ over HTTP for Lighthouse (file:// audits are
 * unreliable). `/` → home.html, `/menu` → menu.html, `/story/1920` → story__1920.html,
 * `/api/live` → the live state from content (so live.js has something to poll).
 *
 *   bun scripts/qa-serve.ts        # http://localhost:5055
 */
import fs from 'fs'
import path from 'path'
import { liveStateFromHours } from '../lib/live'
import { isHoursConfig, EMPTY_HOURS, type HoursConfig } from '../lib/hours'

const ROOT = path.resolve(import.meta.dir, '..')
const dir = path.join(ROOT, '_render')
const port = Number(process.env.PORT || 5055)
const hoursRaw = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'hours.json'), 'utf8'))
const hours: HoursConfig = isHoursConfig(hoursRaw) ? hoursRaw : EMPTY_HOURS
const extras = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'live.json'), 'utf8')); delete extras._note

function gz(req: Request, body: Uint8Array | string, headers: Record<string, string>): Response {
  const accepts = (req.headers.get('accept-encoding') || '').includes('gzip')
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
  if (!accepts) return new Response(bytes as unknown as BodyInit, { headers })
  return new Response(Bun.gzipSync(bytes as unknown as Uint8Array<ArrayBuffer>) as unknown as BodyInit, { headers: { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } })
}

Bun.serve({
  port,
  fetch(req) {
    const u = new URL(req.url)
    if (u.pathname === '/api/live') return Response.json(liveStateFromHours(hours, new Date(), extras), { headers: { 'Cache-Control': 'no-store' } })
    let p = u.pathname.replace(/^\/+|\/+$/g, '')
    if (p === '') p = 'home'
    if (p.endsWith('.html')) p = p.slice(0, -5)
    const file = path.join(dir, p.replace(/\//g, '__') + '.html')
    if (fs.existsSync(file)) return gz(req, fs.readFileSync(file), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    if (u.pathname === '/styles/main.css' && fs.existsSync(path.join(dir, 'main.css'))) return gz(req, fs.readFileSync(path.join(dir, 'main.css')), { 'Content-Type': 'text/css', 'Cache-Control': 'public, max-age=31536000, immutable' })
    if (u.pathname === '/favicon.svg') return new Response(fs.readFileSync(path.join(ROOT, 'build', 'favicon.svg')), { headers: { 'Content-Type': 'image/svg+xml' } })
    const asset = path.join(ROOT, 'build', u.pathname)
    if (u.pathname.startsWith('/styles/') || u.pathname.startsWith('/scripts/') || u.pathname.startsWith('/fonts/') || u.pathname.startsWith('/images/')) {
      if (fs.existsSync(asset)) { const h = { 'Content-Type': u.pathname.endsWith('.css') ? 'text/css' : u.pathname.endsWith('.woff2') ? 'font/woff2' : u.pathname.endsWith('.png') ? 'image/png' : u.pathname.endsWith('.jpg') ? 'image/jpeg' : u.pathname.endsWith('.svg') ? 'image/svg+xml' : 'application/javascript', 'Cache-Control': 'public, max-age=31536000, immutable' }; return /\.(woff2|png|jpg|jpeg)$/.test(u.pathname) ? new Response(fs.readFileSync(asset), { headers: h }) : gz(req, fs.readFileSync(asset), h) }
    }
    return new Response('Not found', { status: 404 })
  },
})
console.log('QA server on http://localhost:' + port)

// A static host for the demo build, with the rewrites the real host applies (demo/public/_redirects): files that exist are
// served as they are; /demo and / are the picker; every other path is the CRM's app. Used by the browser tests and by
// `bun demo/serve.ts` for looking at the demo by hand. Not part of the demo itself: the demo has no server.
import fs from 'node:fs'
import path from 'node:path'

export const DEMO_DIST = path.resolve(import.meta.dir, '../web/dist-demo')

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
}

export function serveDemo(dir = DEMO_DIST, port = 0) {
  return Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url)
      const file = path.resolve(dir, '.' + decodeURIComponent(url.pathname))
      if (file.startsWith(dir + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile() && !file.endsWith('_redirects') && !file.endsWith('_headers')) {
        return new Response(Bun.file(file), { headers: { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' } })
      }
      if (url.pathname.startsWith('/api/')) return new Response(Bun.file(path.join(dir, 'unavailable.html')), { status: 404, headers: { 'content-type': TYPES['.html'] } })
      const page = url.pathname === '/' || url.pathname === '/demo' ? 'picker.html' : 'app.html'
      return new Response(Bun.file(path.join(dir, page)), { headers: { 'content-type': TYPES['.html'] } })
    },
  })
}

if (import.meta.main) {
  const s = serveDemo(DEMO_DIST, Number(process.env.PORT) || 4173)
  console.log(`The demo: http://localhost:${s.port}/demo`)
}

// Public /media proxy — streams uploaded images out of the PRIVATE R2 bucket,
// same-origin. Registered before the static catch-all in server-static.ts.
//
// Read-only. Keys are opaque (slug/images/… or photos/uuid) — nothing to
// enumerate; traversal is rejected. Never serves non-raster content inline
// (SVG/HTML stored-XSS defense); X-Content-Type-Options: nosniff on every hit.
//
// No public bucket / R2_PUBLIC_URL required — the site's own service streams the
// bytes, so uploads work with zero extra Cloudflare/public-access config.

import type { Hono } from 'hono'
import { getObject } from './storage.ts'

const SAFE_INLINE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
])

export function registerMedia(app: Hono): void {
  app.get('/media/*', async (c) => {
    const key = decodeURIComponent(c.req.path.replace(/^\/media\//, ''))
    if (!key || key.includes('..') || key.startsWith('/')) return c.json({ error: 'Invalid media key' }, 400)

    const obj = await getObject(key)
    if (!obj) return c.json({ error: 'Not found' }, 404)

    const safe = SAFE_INLINE_TYPES.has(obj.contentType)
    c.header('Content-Type', safe ? obj.contentType : 'application/octet-stream')
    c.header('X-Content-Type-Options', 'nosniff')
    if (!safe) c.header('Content-Disposition', 'attachment')
    c.header('Cache-Control', 'public, max-age=31536000, immutable')
    return c.body(obj.body)
  })
}

// Public media proxy — streams product images out of the private R2 bucket.
//
// Mounted at `/media` (see index.ts, before the SPA catch-all). Read-only and
// unauthenticated by design: product images are public content on the storefront.
// Uploads are auth-gated in routes/products.ts. Keys are opaque UUID paths, so
// there is nothing to enumerate; we still reject traversal just in case.

import { Hono } from 'hono'
import { getObject, storageConfigured } from '../services/storage.ts'

// Only known-safe raster image types are served with their content-type; anything
// else (e.g. an SVG that could carry inline script) is forced to download.
const SAFE_INLINE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
])

const media = new Hono()

media.get('/*', async (c) => {
  if (!storageConfigured()) return c.json({ error: 'Media storage not configured' }, 503)
  // Path is the full original request path (mounted at /media); strip the prefix.
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

export default media

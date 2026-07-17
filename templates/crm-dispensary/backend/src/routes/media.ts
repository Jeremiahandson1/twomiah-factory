// Public media proxy — PRODUCT IMAGES ONLY.
//
// The tenant's R2 bucket also holds PRIVATE documents (contracts, etc.) which are
// served separately behind auth (GET /api/documents/file/*). This public route
// therefore serves ONLY keys under `products/` — any other key (e.g. a document)
// returns 404 here, so nothing private is ever publicly reachable through /media.
//
// Read-only; keys are opaque `products/<companyId>/<uuid>.<ext>`. Never serves
// non-raster content inline (SVG/HTML stored-XSS defense); nosniff always.

import { Hono } from 'hono'
import { getObject } from '../services/fileUpload.ts'

const SAFE_INLINE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
])

const media = new Hono()

media.get('/*', async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/media\//, ''))
  if (!key || key.includes('..') || key.startsWith('/')) return c.json({ error: 'Invalid media key' }, 400)
  // Only public product images are served here; documents stay private.
  if (!key.startsWith('products/')) return c.json({ error: 'Not found' }, 404)

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

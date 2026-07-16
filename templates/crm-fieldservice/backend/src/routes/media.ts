// Media proxy — streams uploaded files out of the private R2 bucket, same-origin.
//
// Read-only. Job photos appear in both the CRM admin and the customer portal
// (which may be viewed without an admin token), so this matches the previous
// public access model. Keys are opaque (companyId/jobId/cuid), nothing to
// enumerate; traversal is still rejected.
//
// Security hardening: user-uploaded content is NEVER served as inline HTML/SVG
// (stored-XSS). Only known-safe raster image types keep their content-type;
// anything else is forced to download. `nosniff` blocks MIME-sniffing.

import { Hono } from 'hono'
import { getObject, storageConfigured } from '../services/storage.ts'

const SAFE_INLINE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
])

const media = new Hono()

media.get('/*', async (c) => {
  if (!storageConfigured()) return c.json({ error: 'Media storage not configured' }, 503)
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

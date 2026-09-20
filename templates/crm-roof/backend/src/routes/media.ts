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

/**
 * Documents this server generated itself, from the tenant's own records — the Xactimate scope and its
 * CSV. They were being relabelled application/octet-stream like everything else, so the scope PDF
 * downloaded instead of previewing and the CSV arrived with no type at all.
 *
 * The relabelling is not paranoia to be removed: serving an arbitrary UPLOADED pdf inline from the
 * tenant's own origin is a real vector, because a crafted PDF can script in that origin. So the
 * distinction drawn here is provenance, not file type — these keys are written by
 * services/xactimate.ts and can hold nothing a user supplied.
 */
const GENERATED_DOCUMENT = /^insurance\/[^/]+\/[^/]+\/xactimate-(scope\.pdf|export\.csv)$/
const GENERATED_TYPES = new Set(['application/pdf', 'text/csv'])

const media = new Hono()

media.get('/*', async (c) => {
  if (!storageConfigured()) return c.json({ error: 'Media storage not configured' }, 503)
  const key = decodeURIComponent(c.req.path.replace(/^\/media\//, ''))
  if (!key || key.includes('..') || key.startsWith('/')) return c.json({ error: 'Invalid media key' }, 400)

  const obj = await getObject(key)
  if (!obj) return c.json({ error: 'Not found' }, 404)

  const isImage = SAFE_INLINE_TYPES.has(obj.contentType)
  const isGenerated = GENERATED_DOCUMENT.test(key) && GENERATED_TYPES.has(obj.contentType)
  const safe = isImage || isGenerated
  c.header('Content-Type', safe ? obj.contentType : 'application/octet-stream')
  c.header('X-Content-Type-Options', 'nosniff')
  // a CSV is still handed over as a file — nothing previews one, and inline text/csv is where
  // spreadsheet-formula injection gets interesting
  if (!safe || obj.contentType === 'text/csv') c.header('Content-Disposition', 'attachment')
  c.header('Cache-Control', 'public, max-age=31536000, immutable')
  return c.body(obj.body)
})

export default media

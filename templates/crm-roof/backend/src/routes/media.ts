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
import { authenticate } from '../middleware/auth.ts'

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

/** The key this request is asking for, or null if it is not a usable one. */
function keyFrom(c: any): string | null {
  const key = decodeURIComponent(c.req.path.replace(/^\/media\//, ''))
  if (!key || key.includes('..') || key.startsWith('/')) return null
  return key
}

/** Stream the object with the right headers. Shared by both handlers below. */
async function serve(c: any, key: string) {
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
  // PRIVATE for anything behind the sign-in: a shared cache must not keep one tenant's insurance
  // scope and hand it to the next request that asks for the same URL.
  c.header('Cache-Control', key.startsWith('insurance/') ? 'private, max-age=0, no-store' : 'public, max-age=31536000, immutable')
  return c.body(obj.body)
}

/**
 * THE INSURANCE SCOPE AND ITS CSV ARE NOT PUBLIC. (T41)
 *
 *   "Export PDF and CSV links under /media/insurance/ open without signing in (random IDs)."
 *
 * The rest of this proxy is public on purpose and the reason is written at the top of the file: job
 * photos appear in the customer portal, which is viewed without an admin token. That argument does
 * not reach these two documents. A Xactimate scope is the contractor's negotiating position with a
 * carrier — every line item, every price, the RCV and the ACV — and nothing in the portal ever
 * shows it. "Random IDs" is a capability URL: fine for a photo somebody was sent a link to, not for
 * the document a claim is argued with, which leaks whole the moment the link is forwarded, logged by
 * a proxy, or pasted into a chat.
 *
 * Declared BEFORE the catch-all so Hono matches it first, and gated by MOUNTING `authenticate` on
 * the route rather than calling it inside the handler — hand-rolling that composition is what made
 * Hono set the response twice and answer 500 with status (0).
 *
 * …and signing in is not enough on its own. The key carries the company id, so the caller's own
 * company has to match it; otherwise any signed-in user of any tenant could read any other tenant's
 * claim documents, which would be a worse hole than the one being closed.
 */
const INSURANCE_KEY = /^insurance\/([^/]+)\//

media.get('/insurance/*', authenticate, async (c) => {
  const key = keyFrom(c)
  if (!key) return c.json({ error: 'Invalid media key' }, 400)
  const owner = key.match(INSURANCE_KEY)?.[1]
  const currentUser = c.get('user') as any
  // 404 rather than 403: whether a document exists is itself something only its owner should learn.
  // Answered BEFORE the storage check, so a caller who may not have this document is told nothing
  // about the server's configuration either.
  if (!owner || owner !== currentUser?.companyId) return c.json({ error: 'Not found' }, 404)
  if (!storageConfigured()) return c.json({ error: 'Media storage not configured' }, 503)
  return serve(c, key)
})

media.get('/*', async (c) => {
  if (!storageConfigured()) return c.json({ error: 'Media storage not configured' }, 503)
  const key = keyFrom(c)
  if (!key) return c.json({ error: 'Invalid media key' }, 400)
  // Belt as well as braces: if a future route shape ever reached the catch-all carrying an insurance
  // key, it must not be served from here. The handler above is the only way to one of those.
  if (INSURANCE_KEY.test(key)) return c.json({ error: 'Not found' }, 404)
  return serve(c, key)
})

export default media

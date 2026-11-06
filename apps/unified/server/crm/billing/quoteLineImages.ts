// POST /api/quote-line-images — a picture for a quote line (feature quote_line_images, not ready). The photo goes into the
// business's own photo library like every site photo (site/admin.ts savePublicPhoto: re-encoded, turned upright, served at
// /media) and its address comes back to be put on the line; the quote route keeps it with the line, and the customer's quote
// page shows it. Whoever writes quotes may add one: quotes:create or quotes:update.
// A /media photo is public by address, like the rest of the library; the address is long and random.
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { savePublicPhoto, IMAGE_TYPES, MAX_IMAGE_BYTES } from '../../site/admin.ts'

export function createQuoteLineImageRoutes(d: CrmDeps) {
  const { db, audit } = d
  const app = new Hono<AppEnv>()

  app.post('/', d.permissions.requireAnyPermission(['quotes:create', 'quotes:update']), async (c) => {
    if (!d.store) return fail(c, 409, 'Photos cannot be stored here.')
    const body = await c.req.parseBody().catch(() => ({} as Record<string, unknown>))
    const file = (body as Record<string, unknown>).file as File | undefined
    if (!file || typeof (file as any).arrayBuffer !== 'function') return fail(c, 400, 'Choose a photo to upload.')
    if (file.size > MAX_IMAGE_BYTES) return fail(c, 400, 'That photo is too large (8 MB at most).')
    if (file.type && !IMAGE_TYPES.has(file.type)) return fail(c, 400, 'Use a JPG, PNG, WebP or GIF.')
    const user = c.get('user')
    const saved = await savePublicPhoto({ db, store: d.store }, Buffer.from(await file.arrayBuffer()), { companyId: user.companyId, userId: user.userId ?? null, originalName: file.name || null, tag: 'quote-line' })
    if (!saved) return fail(c, 400, "That file isn't an image we can read.")
    audit.log({ action: audit.ACTIONS.CREATE, entity: 'quote_line_image', entityId: saved.id, metadata: { url: saved.publicUrl }, req: c })
    return one(c, { url: saved.publicUrl }, 201)
  })

  return app
}

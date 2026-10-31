// The product writer at /api/admin/product-writer (2026-10-30, gap 5 against Shopify Magic): a draft description, search
// title and search description, and a description for each photo, in a tone the owner picks.
//
// Behind store_ai_writer (registered not ready: switched on by no plan or signup) AND products:update — whoever may edit
// a product may ask for a draft of its words. Every route DRAFTS and answers; none writes a row. The owner reads the
// draft in the editor, changes it and saves it through the ordinary product and photo routes (which carry the audit
// rows). Without an AI key on the server the answer is the owner's sentence (503 ai_not_configured), as in the RV tools.
//
//   POST /:id/describe   { tone, notes? }                → { description, seoTitle, seoDescription, tone }
//   POST /:id/alt-text   { tone?, imageIds? }            → { alts: [{ imageId, alt }], skipped: [{ imageId, reason }] }
// Both share one cap per company (AI_DRAFTS_PER_HOUR an hour; 429 ai_rate_limited past it, no model call).
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, eq } from 'drizzle-orm'
import { storeProduct, storeProductImage, storeProductVariant } from '../../../db/schema/store.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { AI_OFF, aiConfigured, draftAltText, draftListing, TONES, type Photo, type Tone } from '../../listingWriter.ts'
import { createAiUse } from '../../aiUse.ts'
import { productPhotoPrefix } from './products.ts'

/** Photos the writer reads in one go. */
export const MAX_PHOTOS = 8
/** The model reads JPEG, PNG, GIF and WebP up to 5 MB each; an AVIF or a bigger file is left for the owner to describe. */
const READABLE = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024

const toneSchema = z.enum(Object.keys(TONES) as [Tone, ...Tone[]], { message: 'Choose friendly, professional, playful, luxurious or straightforward.' })
const describeSchema = z.object({ tone: toneSchema, notes: z.string().trim().max(1500).optional().nullable() })
const altSchema = z.object({ tone: toneSchema.optional(), imageIds: z.array(z.string()).max(MAX_PHOTOS).optional() })

export function createProductWriterRoutes(d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()
  app.use('*', d.permissions.requirePermission('products:update'))

  // At most AI_DRAFTS_PER_HOUR requests an hour per company (crm/aiUse.ts). No AI key at all is answered first, with the owner's
  // sentence and no count; past the cap, a plain sentence (429 ai_rate_limited, Retry-After) and no call to the model.
  const aiUse = createAiUse(d.db)
  const WRITER = 'store_writer'
  const allowed = async (c: any, companyId: string): Promise<Response | null> => {
    if (!aiConfigured()) return fail(c, 503, AI_OFF, 'ai_not_configured')
    const got = await aiUse.claim(companyId, WRITER, 'product writer')
    if (got.ok) return null
    c.header('Retry-After', String(got.minutes * 60))
    return fail(c, 429, got.sentence, 'ai_rate_limited')
  }

  const productOf = async (companyId: string, id: string) =>
    (await db.select().from(storeProduct).where(and(eq(storeProduct.id, id), eq(storeProduct.companyId, companyId))).limit(1))[0] as typeof storeProduct.$inferSelect | undefined

  app.post('/:id/describe', async (c) => {
    const u = c.get('user')
    const parsed = describeSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const product = await productOf(u.companyId, c.req.param('id'))
    if (!product) return fail(c, 404, 'Product not found')
    const variants: Array<typeof storeProductVariant.$inferSelect> = await db.select().from(storeProductVariant).where(eq(storeProductVariant.productId, product.id)).orderBy(asc(storeProductVariant.position))
    // What the shopper chooses between — never SKUs, prices, costs or stock.
    const options = variants.map((v) => [v.name && v.name !== 'Default' ? v.name : '', ...Object.entries(v.options || {}).map(([k, val]) => `${k}: ${val}`)].filter(Boolean).join(', ')).filter(Boolean)
    const stop = await allowed(c, u.companyId)
    if (stop) return stop
    const r = await draftListing({ name: product.name, tagline: product.tagline, category: product.category, options, current: product.description, notes: parsed.data.notes }, parsed.data.tone)
    if (!r.ok) return fail(c, r.status, r.message, r.code)
    return one(c, { description: r.description, seoTitle: r.seoTitle, seoDescription: r.seoDescription, tone: parsed.data.tone })
  })

  app.post('/:id/alt-text', async (c) => {
    const u = c.get('user')
    const parsed = altSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const product = await productOf(u.companyId, c.req.param('id'))
    if (!product) return fail(c, 404, 'Product not found')
    const all: Array<typeof storeProductImage.$inferSelect> = await db.select().from(storeProductImage).where(eq(storeProductImage.productId, product.id)).orderBy(asc(storeProductImage.position))
    const wanted = parsed.data.imageIds
    const images = (wanted ? all.filter((i) => wanted.includes(i.id)) : all).slice(0, MAX_PHOTOS)
    if (!images.length) return fail(c, 400, 'This product has no photos to describe yet.', 'validation_failed')

    const photos: Photo[] = []
    const skipped: Array<{ imageId: string; reason: string }> = []
    for (const img of images) {
      const m = /^\/media\/(.+)$/.exec(img.url || '')
      if (m) {
        // Our own upload: read it from the file store — only this product's own folder.
        const key = decodeURIComponent(m[1])
        if (!key.startsWith(productPhotoPrefix(u.companyId, product.id)) || key.includes('..')) { skipped.push({ imageId: img.id, reason: 'Not one of this product’s photos' }); continue }
        const obj = await d.services.storage.getObject(key).catch(() => null)
        if (!obj) { skipped.push({ imageId: img.id, reason: 'The photo file could not be found' }); continue }
        if (!READABLE.includes(obj.contentType)) { skipped.push({ imageId: img.id, reason: 'This kind of photo can’t be read; describe it yourself' }); continue }
        if (obj.body.byteLength > MAX_BYTES) { skipped.push({ imageId: img.id, reason: 'The photo is too large to read; describe it yourself' }); continue }
        photos.push({ id: img.id, bytes: { mediaType: obj.contentType, base64: Buffer.from(obj.body).toString('base64') } })
      } else if (/^https:\/\//i.test(img.url || '')) {
        photos.push({ id: img.id, url: img.url })
      } else skipped.push({ imageId: img.id, reason: 'The photo address can’t be read' })
    }
    if (!photos.length) return one(c, { alts: [], skipped })
    const stop = await allowed(c, u.companyId)
    if (stop) return stop
    const r = await draftAltText(product.name, photos, parsed.data.tone ?? 'straightforward')
    if (!r.ok) return fail(c, r.status, r.message, r.code)
    const got = new Set(r.alts.map((a) => a.id))
    for (const p of photos) if (!got.has(p.id)) skipped.push({ imageId: p.id, reason: 'The writer had nothing to say about this one' })
    return one(c, { alts: r.alts.map((a) => ({ imageId: a.id, alt: a.alt })), skipped })
  })
  return app
}

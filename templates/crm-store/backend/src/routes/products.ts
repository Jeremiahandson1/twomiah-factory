import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { products, productImages, productVariants } from '../../db/schema.ts'
import { eq, inArray, asc, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { storageConfigured, putObject, deleteObject, keyFromMediaUrl } from '../services/storage.ts'

const admin = new Hono()
admin.use('*', authenticate)

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// ── Products ─────────────────────────────────────────────────────────────────
admin.get('/', async (c) => {
  const rows = await db.select().from(products).orderBy(asc(products.position), desc(products.createdAt))
  const ids = rows.map((r) => r.id)
  const [imgs, vars] = ids.length ? await Promise.all([
    db.select().from(productImages).where(inArray(productImages.productId, ids)).orderBy(asc(productImages.position)),
    db.select().from(productVariants).where(inArray(productVariants.productId, ids)).orderBy(asc(productVariants.position)),
  ]) : [[], []]
  return c.json({
    products: rows.map((p) => ({
      ...p,
      images: imgs.filter((i) => i.productId === p.id),
      variants: vars.filter((v) => v.productId === p.id),
    })),
  })
})

const productSchema = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  tagline: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  featured: z.boolean().optional(),
  leadTimeDays: z.number().int().nonnegative().optional().nullable(),
  seoTitle: z.string().optional().nullable(),
  seoDescription: z.string().optional().nullable(),
  position: z.number().int().optional(),
})

admin.post('/', async (c) => {
  const parsed = productSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid product', details: parsed.error.flatten() }, 400)
  const data = parsed.data
  let slug = slugify(data.slug || data.name)
  // Ensure slug uniqueness by suffixing.
  const existing = await db.select({ slug: products.slug }).from(products)
  const taken = new Set(existing.map((e) => e.slug))
  if (taken.has(slug)) { let n = 2; while (taken.has(`${slug}-${n}`)) n++; slug = `${slug}-${n}` }

  const [created] = await db.insert(products).values({ ...data, slug }).returning()
  return c.json({ product: created }, 201)
})

admin.get('/:id', async (c) => {
  const [p] = await db.select().from(products).where(eq(products.id, c.req.param('id'))).limit(1)
  if (!p) return c.json({ error: 'Not found' }, 404)
  const [imgs, vars] = await Promise.all([
    db.select().from(productImages).where(eq(productImages.productId, p.id)).orderBy(asc(productImages.position)),
    db.select().from(productVariants).where(eq(productVariants.productId, p.id)).orderBy(asc(productVariants.position)),
  ])
  return c.json({ product: { ...p, images: imgs, variants: vars } })
})

admin.patch('/:id', async (c) => {
  const parsed = productSchema.partial().safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid product' }, 400)
  const patch: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() }
  if (parsed.data.slug) patch.slug = slugify(parsed.data.slug)
  const [updated] = await db.update(products).set(patch).where(eq(products.id, c.req.param('id'))).returning()
  if (!updated) return c.json({ error: 'Not found' }, 404)
  return c.json({ product: updated })
})

admin.delete('/:id', async (c) => {
  await db.delete(products).where(eq(products.id, c.req.param('id')))
  return c.json({ ok: true })
})

// ── Variants ─────────────────────────────────────────────────────────────────
const variantSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  priceCents: z.number().int().nonnegative(),
  compareAtPriceCents: z.number().int().nonnegative().optional().nullable(),
  weightOz: z.number().int().nonnegative().optional().nullable(),
  inventoryQty: z.number().int().optional().nullable(),
  options: z.record(z.string()).optional().nullable(),
  position: z.number().int().optional(),
})

admin.post('/:id/variants', async (c) => {
  const parsed = variantSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid variant', details: parsed.error.flatten() }, 400)
  const [created] = await db.insert(productVariants)
    .values({ ...parsed.data, productId: c.req.param('id') }).returning()
  return c.json({ variant: created }, 201)
})

admin.patch('/variants/:variantId', async (c) => {
  const parsed = variantSchema.partial().safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid variant' }, 400)
  const [updated] = await db.update(productVariants)
    .set({ ...parsed.data, updatedAt: new Date() }).where(eq(productVariants.id, c.req.param('variantId'))).returning()
  if (!updated) return c.json({ error: 'Not found' }, 404)
  return c.json({ variant: updated })
})

admin.delete('/variants/:variantId', async (c) => {
  await db.delete(productVariants).where(eq(productVariants.id, c.req.param('variantId')))
  return c.json({ ok: true })
})

// ── Images (by URL — upload comes in Phase 2) ────────────────────────────────
const imageSchema = z.object({
  url: z.string().url(),
  alt: z.string().optional().nullable(),
  position: z.number().int().optional(),
  isPrimary: z.boolean().optional(),
})

admin.post('/:id/images', async (c) => {
  const parsed = imageSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid image' }, 400)
  const productId = c.req.param('id')
  // If this is the first image or marked primary, ensure single primary.
  if (parsed.data.isPrimary) {
    await db.update(productImages).set({ isPrimary: false }).where(eq(productImages.productId, productId))
  }
  const [created] = await db.insert(productImages).values({ ...parsed.data, productId }).returning()
  return c.json({ image: created }, 201)
})

// Direct file upload → private R2 → served back via GET /media/<key>. The stored
// url is absolute (BACKEND_URL) so the separate storefront origin can load it.
const UPLOAD_MAX_BYTES = 8 * 1024 * 1024 // 8 MB
const UPLOAD_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
}

admin.post('/:id/images/upload', async (c) => {
  if (!storageConfigured()) return c.json({ error: 'Image storage is not configured for this store' }, 503)
  const productId = c.req.param('id')
  const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1)
  if (!product) return c.json({ error: 'Product not found' }, 404)

  const form = await c.req.parseBody().catch(() => null)
  const file = form?.['file']
  if (!(file instanceof File)) return c.json({ error: 'No file uploaded' }, 400)
  const ext = UPLOAD_EXT[file.type]
  if (!ext) return c.json({ error: 'Unsupported image type (use JPEG, PNG, WebP, GIF, or AVIF)' }, 415)
  if (file.size > UPLOAD_MAX_BYTES) return c.json({ error: 'Image too large (max 8 MB)' }, 413)

  const buf = Buffer.from(await file.arrayBuffer())
  const key = `products/${productId}/${crypto.randomUUID()}.${ext}`
  await putObject(key, buf, file.type)

  const base = (process.env.BACKEND_URL || new URL(c.req.url).origin).replace(/\/+$/, '')
  const url = `${base}/media/${key}`

  const existing = await db.select({ id: productImages.id }).from(productImages).where(eq(productImages.productId, productId))
  const isPrimary = existing.length === 0
  const [created] = await db.insert(productImages).values({ productId, url, alt: product.name, isPrimary }).returning()
  return c.json({ image: created }, 201)
})

admin.patch('/images/:imageId', async (c) => {
  const parsed = imageSchema.partial().safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid image' }, 400)
  const [img] = await db.select().from(productImages).where(eq(productImages.id, c.req.param('imageId'))).limit(1)
  if (!img) return c.json({ error: 'Not found' }, 404)
  if (parsed.data.isPrimary) {
    await db.update(productImages).set({ isPrimary: false }).where(eq(productImages.productId, img.productId))
  }
  const [updated] = await db.update(productImages)
    .set(parsed.data).where(eq(productImages.id, img.id)).returning()
  return c.json({ image: updated })
})

admin.delete('/images/:imageId', async (c) => {
  const [img] = await db.select().from(productImages).where(eq(productImages.id, c.req.param('imageId'))).limit(1)
  await db.delete(productImages).where(eq(productImages.id, c.req.param('imageId')))
  // If it was an uploaded (proxied) image, drop the R2 object too. Best-effort.
  const key = img ? keyFromMediaUrl(img.url) : null
  if (key) void deleteObject(key)
  return c.json({ ok: true })
})

export default admin

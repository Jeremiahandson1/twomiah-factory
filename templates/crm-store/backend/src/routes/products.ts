import { Hono } from 'hono'
import { z } from 'zod'
import { cleanText } from '../utils/sanitize.ts'
import { db } from '../../db/index.ts'
import { products, productImages, productVariants } from '../../db/schema.ts'
import { eq, and, isNull, inArray, asc, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { storageConfigured, putObject, deleteObject, keyFromMediaUrl } from '../services/storage.ts'

const admin = new Hono()
// Staff add and edit products, variants, stock and images (products:create / products:update).
// Taking something off sale for good — deleting a product or a variant — is products:delete, the manager's.
admin.use('*', authenticate, requirePermission('products:read'))

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// ── Products ─────────────────────────────────────────────────────────────────
admin.get('/', async (c) => {
  // Honor ?limit / ?page when supplied — they were accepted and ignored, so the whole
  // catalog came back regardless. No params still returns everything (admin grid). (BUG-12)
  const limitRaw = c.req.query('limit')
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw) || 0, 1), 200) : undefined
  const page = Math.max(parseInt(c.req.query('page') || '1') || 1, 1)
  const base = db.select().from(products).orderBy(asc(products.position), desc(products.createdAt))
  const rows = limit !== undefined ? await base.limit(limit).offset((page - 1) * limit) : await base
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
  name: cleanText(1),
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

admin.post('/', requirePermission('products:create'), async (c) => {
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

admin.patch('/:id', requirePermission('products:update'), async (c) => {
  const parsed = productSchema.partial().safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid product' }, 400)
  const patch: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() }
  if (parsed.data.slug) patch.slug = slugify(parsed.data.slug)
  const [updated] = await db.update(products).set(patch).where(eq(products.id, c.req.param('id'))).returning()
  if (!updated) return c.json({ error: 'Not found' }, 404)
  return c.json({ product: updated })
})

admin.delete('/:id', requirePermission('products:delete'), async (c) => {
  await db.delete(products).where(eq(products.id, c.req.param('id')))
  return c.json({ ok: true })
})

// ── Variants ─────────────────────────────────────────────────────────────────
const variantSchema = z.object({
  sku: z.string().min(1),
  name: cleanText(1),
  // Cap money/int columns at Postgres int4 max — an over-max value overflowed the
  // column and surfaced as a raw 500 instead of a validation error. (BUG-01)
  priceCents: z.number().int().nonnegative().max(2147483647, 'Price is too large'),
  compareAtPriceCents: z.number().int().nonnegative().max(2147483647, 'Price is too large').optional().nullable(),
  weightOz: z.number().int().nonnegative().max(2147483647).optional().nullable(),
  // Inventory can't go negative — this was accepted and stored as -99. (BUG-03)
  inventoryQty: z.number().int().min(0, 'Inventory cannot be negative').max(2147483647).optional().nullable(),
  options: z.record(z.string()).optional().nullable(),
  position: z.number().int().optional(),
})

admin.post('/:id/variants', requirePermission('products:update'), async (c) => {
  const parsed = variantSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid variant', details: parsed.error.flatten() }, 400)
  const [created] = await db.insert(productVariants)
    .values({ ...parsed.data, productId: c.req.param('id') }).returning()
  return c.json({ variant: created }, 201)
})

/**
 * THE STOCK COUNT IS THE ONE FIELD OTHER PEOPLE CHANGE UNDER YOU. Every paid order takes units off it, and so can a
 * second member of staff counting the shelf. A count typed into a page loaded ten minutes ago is a count from ten
 * minutes ago: saving it put back every unit sold since (10 in stock, page opened, 3 sold, the price fixed → 10 again).
 * So a stock edit names the figure it was made from — `inventoryFrom`, what the screen showed — and is applied only
 * while the count still reads that. Otherwise nothing in the save is applied and the caller is told the count as it
 * stands now. A save without `inventoryFrom` sets the count outright, as before; the admin screen always sends it.
 */
const variantPatchSchema = variantSchema.partial().extend({
  inventoryFrom: z.number().int().nullable().optional(),
})

admin.patch('/variants/:variantId', requirePermission('products:update'), async (c) => {
  const parsed = variantPatchSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid variant' }, 400)
  const { inventoryFrom, ...fields } = parsed.data
  const id = c.req.param('variantId')
  const guarded = inventoryFrom !== undefined && fields.inventoryQty !== undefined
  const where = guarded
    ? and(eq(productVariants.id, id), inventoryFrom === null ? isNull(productVariants.inventoryQty) : eq(productVariants.inventoryQty, inventoryFrom))
    : eq(productVariants.id, id)
  const [updated] = await db.update(productVariants).set({ ...fields, updatedAt: new Date() }).where(where).returning()
  if (!updated) {
    const [now] = await db.select({ inventoryQty: productVariants.inventoryQty }).from(productVariants).where(eq(productVariants.id, id)).limit(1)
    if (!now) return c.json({ error: 'Not found' }, 404)
    const stands = now.inventoryQty === null ? 'untracked' : String(now.inventoryQty)
    return c.json({
      error: `The stock changed to ${stands} since this page loaded (a sale, or someone else's count), so nothing was saved. Check the count and save again.`,
      code: 'inventory_changed',
      inventoryQty: now.inventoryQty,
    }, 409)
  }
  return c.json({ variant: updated })
})

admin.delete('/variants/:variantId', requirePermission('products:delete'), async (c) => {
  await db.delete(productVariants).where(eq(productVariants.id, c.req.param('variantId')))
  return c.json({ ok: true })
})

// ── Images (by URL — upload comes in Phase 2) ────────────────────────────────
// A pasted image URL must be a public https URL — the old z.string().url() accepted
// javascript: (stored-XSS) and http://169.254.169.254/ (SSRF to cloud metadata). (BUG-05)
const safeImageUrl = z.string().url().refine((u) => {
  let parsed: URL
  try { parsed = new URL(u) } catch { return false }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return false
  // block loopback / private / link-local / metadata ranges
  if (/^(0\.|127\.|10\.|169\.254\.|192\.168\.)/.test(host)) return false
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false
  return true
}, 'Image URL must be a public https:// address')

const imageSchema = z.object({
  url: safeImageUrl,
  alt: z.string().optional().nullable(),
  position: z.number().int().optional(),
  isPrimary: z.boolean().optional(),
})

admin.post('/:id/images', requirePermission('products:update'), async (c) => {
  const parsed = imageSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid image' }, 400)
  const productId = c.req.param('id')
  const { isPrimary, ...rest } = parsed.data
  const [created] = await db.insert(productImages).values({ ...rest, isPrimary: false, productId }).returning()
  if (!isPrimary) return c.json({ image: created }, 201)
  const [primary] = await makeOnlyPrimary(productId, created.id)
  return c.json({ image: primary ?? created }, 201)
})

/**
 * ONE PRIMARY PHOTO, IN ONE STATEMENT. "Clear every primary, then set this one" was two writes: two people choosing
 * different photos at once could both clear, then both set — and the product had two primary photos, the storefront
 * showing whichever it read first. Setting every row of the product to (id = chosen) is a single UPDATE, so the last
 * choice wins whole.
 */
const makeOnlyPrimary = async (productId: string, imageId: string) => {
  const rows = await db.update(productImages).set({ isPrimary: sql`${productImages.id} = ${imageId}` })
    .where(eq(productImages.productId, productId)).returning()
  return rows.filter((r) => r.id === imageId)
}

// Direct file upload → private R2 → served back via GET /media/<key>. The stored
// url is absolute (BACKEND_URL) so the separate storefront origin can load it.
const UPLOAD_MAX_BYTES = 8 * 1024 * 1024 // 8 MB
const UPLOAD_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
}

admin.post('/:id/images/upload', requirePermission('products:update'), async (c) => {
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

admin.patch('/images/:imageId', requirePermission('products:update'), async (c) => {
  const parsed = imageSchema.partial().safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid image' }, 400)
  const [img] = await db.select().from(productImages).where(eq(productImages.id, c.req.param('imageId'))).limit(1)
  if (!img) return c.json({ error: 'Not found' }, 404)
  const { isPrimary, ...rest } = parsed.data
  let [updated] = Object.keys(rest).length || isPrimary === false
    ? await db.update(productImages).set({ ...rest, ...(isPrimary === false ? { isPrimary: false } : {}) }).where(eq(productImages.id, img.id)).returning()
    : [img]
  if (isPrimary) [updated] = await makeOnlyPrimary(img.productId, img.id)
  return c.json({ image: updated })
})

admin.delete('/images/:imageId', requirePermission('products:update'), async (c) => {
  const [img] = await db.select().from(productImages).where(eq(productImages.id, c.req.param('imageId'))).limit(1)
  await db.delete(productImages).where(eq(productImages.id, c.req.param('imageId')))
  // If it was an uploaded (proxied) image, drop the R2 object too. Best-effort.
  const key = img ? keyFromMediaUrl(img.url) : null
  if (key) void deleteObject(key)
  return c.json({ ok: true })
})

export default admin

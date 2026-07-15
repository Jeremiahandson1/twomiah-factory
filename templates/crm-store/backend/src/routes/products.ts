import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { products, productImages, productVariants } from '../../db/schema.ts'
import { eq, inArray, asc, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

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
  await db.delete(productImages).where(eq(productImages.id, c.req.param('imageId')))
  return c.json({ ok: true })
})

export default admin

// The store's catalogue at /api/admin/products: products, their variants (SKU, price, stock) and photos, by URL or
// uploaded. Moved from templates/crm-store/backend/src/routes/products.ts (and the /media proxy of routes/media.ts,
// which the website already is — see below).
//
// Kept as the template had it: every permission (products:read on all of it; adding and editing is products:create /
// products:update, staff's; deleting a product or a variant is products:delete, the manager's); ?limit / ?page honoured
// and no paging returning the whole catalogue (BUG-12); a new product's slug made unique by suffixing; money and stock
// capped at the int4 column (BUG-01) and stock never negative (BUG-03); the guarded stock count — a count typed over a
// figure that has since moved is refused whole, 409 inventory_changed (admin-concurrency); a pasted photo only a public
// https address (BUG-05); one primary photo in one statement; an upload to 8 MB of JPEG, PNG, WebP, GIF or AVIF, the
// first photo of a product its primary; the variant's own audit rows (create: price and stock in words; edit: what
// changed, a guarded count from the figure the person saw).
//
// Changes from the template:
//   · everything is the company's: a product by its company_id, a variant or photo through its product — another
//     company's is a 404 (the template had one business per database and looked rows up by id alone);
//   · replies (RULEBOOK §3): the list is { data, pagination } (was { products }); one product, variant or photo is the
//     record (was { product } / { variant } / { image }); a delete is { success: true } (was { ok: true }); a
//     validation failure names each box (was 'Invalid product' / 'Invalid variant' / 'Invalid image', with or without
//     zod's flatten() as `details`); the stale-count refusal keeps its sentence and code, its `inventoryQty` dropped
//     (the sentence says the count as it stands);
//   · deleting a product, variant or photo that is not there (or not this company's) is a 404 — the template answered
//     ok: true having deleted nothing;
//   · an uploaded photo goes to the app's file store (d.services.storage) under the website's public photo prefix and
//     is served by the website's own /media/* (server/site/routes.ts): one proxy, same origin as the storefront
//     (UNIFIED_STORE_PLAN decision 4), so the stored address is '/media/<key>' — the template stored an absolute
//     BACKEND_URL address for a storefront on another origin. Removing a photo removes the file only when it is one
//     this store uploaded (the template removed any key a '/media/' address named);
//   · every write records its own audit row (product, product_variant, product_image) — the template left the create,
//     edit and delete of a product, a variant's delete and every photo change to the write floor, which in this app
//     would file them under the field-service `product` table's name;
//   · a stock edit's guarded update and the variant's own row are reached through the product's company.
import { Hono } from 'hono'
import { z } from 'zod'
import crypto from 'node:crypto'
import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm'
import { storeProduct, storeProductImage, storeProductVariant, storeSupplier } from '../../../db/schema/store.ts'
import { makeOnlyPrimaryImage } from '../../../data/storeCatalog.ts'
import { cleanText } from '../../../core/sanitize.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, list, one } from '../../../http/reply.ts'
import { PUBLIC_PHOTO_PREFIX } from '../../../site/admin.ts'
import { canSeeWith, type CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import { formatCents } from '../lib/money.ts'
import { productSearchCondition, lowStockProductCondition } from '../tileConditions.ts'
import { changedKeys } from './audit.ts'
import { partialOf } from '@twomiah/tenant-backend'

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

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
  // A gift card is sold like any product; paid, it is emailed as a code (../giftCards.ts).
  kind: z.enum(['physical', 'gift_card']).optional(),
  // The product feeds' fields (../checkout/feeds.ts) and the upsells' fallback (category).
  brand: z.string().trim().max(120).optional().nullable(),
  condition: z.enum(['new', 'refurbished', 'used']).optional(),
  category: z.string().trim().max(120).optional().nullable(),
  // The owner's picks for "Frequently bought together" and "You may also like": this company's product ids.
  boughtTogetherIds: z.array(z.string().min(1).max(64)).max(12).optional().nullable(),
  alsoLikeIds: z.array(z.string().min(1).max(64)).max(12).optional().nullable(),
  // A consumable: the post-purchase "time to reorder" email goes out this many days after the order arrives (null = none).
  replenishAfterDays: z.number().int().min(1).max(730).optional().nullable(),
})

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
  // Low-stock level (store_low_stock): at or under it, the option is on the Low stock list and the owner's daily email. null = no level.
  lowStockAt: z.number().int().min(0, 'The low-stock level cannot be negative').max(2147483647).optional().nullable(),
  // What one unit costs the shop (margin:read's: staff neither see nor set it). Profit in the sales reports is worked out from it.
  costCents: z.number().int().min(0, 'The cost cannot be negative').max(2147483647).optional().nullable(),
  // Who the shop buys it from and how many to bring the stock back to (store_reorders: the draft reorder reads both).
  supplierId: z.string().min(1).max(64).optional().nullable(),
  reorderToQty: z.number().int().min(0, 'The order-up-to count cannot be negative').max(2147483647).optional().nullable(),
  options: z.record(z.string(), z.string()).optional().nullable(),
  position: z.number().int().optional(),
  // The feeds' identifiers: a barcode (GTIN: UPC, EAN or ISBN, 8 to 14 digits) and the maker's part number.
  gtin: z.string().trim().regex(/^(\d{8}|\d{12,14})$/, 'A GTIN is 8, 12, 13 or 14 digits').optional().nullable().or(z.literal('').transform(() => null)),
  mpn: z.string().trim().max(70).optional().nullable(),
})

/**
 * THE STOCK COUNT IS THE ONE FIELD OTHER PEOPLE CHANGE UNDER YOU. Every paid order takes units off it, and so can a
 * second member of staff counting the shelf. A count typed into a page loaded ten minutes ago is a count from ten
 * minutes ago: saving it put back every unit sold since (10 in stock, page opened, 3 sold, the price fixed → 10 again).
 * So a stock edit names the figure it was made from — `inventoryFrom`, what the screen showed — and is applied only
 * while the count still reads that. Otherwise nothing in the save is applied and the caller is told the count as it
 * stands now. A save without `inventoryFrom` sets the count outright, as before; the admin screen always sends it.
 */
const variantPatchSchema = partialOf(variantSchema).extend({
  inventoryFrom: z.number().int().nullable().optional(),
})

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

// Direct file upload → the app's private file store → served back by the website's /media/<key>.
const UPLOAD_MAX_BYTES = 8 * 1024 * 1024 // 8 MB
const UPLOAD_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
}
/** Where a product's uploads live: under the website's public prefix, so /media serves them and nothing else private. */
export const productPhotoPrefix = (companyId: string, productId: string) => `${PUBLIC_PHOTO_PREFIX}products/${companyId}/${productId}/`
/** The store key an uploaded photo's address names, or null when the address is not one of this product's uploads. */
const uploadedKey = (url: string, companyId: string, productId: string): string | null => {
  const m = /^\/media\/(.+)$/.exec(url || '')
  if (!m) return null
  const key = decodeURIComponent(m[1])
  return key.startsWith(productPhotoPrefix(companyId, productId)) && !key.includes('..') ? key : null
}

export function createProductRoutes(d: CrmDeps, core: StoreCore) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  // Staff add and edit products, variants, stock and images (products:create / products:update).
  // Taking something off sale for good — deleting a product or a variant — is products:delete, the manager's.
  app.use('*', requirePermission('products:read'))

  /** What an option costs the shop is margin:read's (the fleet's line for cost): a seat without it is neither sent nor allowed to set it. */
  const mayMargin = async (c: any) => canSeeWith(d.permissions)(c.get('user').role, 'margin:read', c.get('user').userId)
  const costRefused = (c: any) => fail(c, 403, "What a product costs you is for a manager or the owner.", 'permission_denied')
  const stripCost = <T extends { costCents?: number | null }>(rows: T[], may: boolean): T[] => (may ? rows : rows.map(({ costCents: _c, ...rest }) => rest as T))
  /** A low-stock level is the store_low_stock feature's: off, the API refuses it (the screens do not show the box). */
  /** Choosing a supplier or an order-up-to count needs store_reorders, and a supplier of THIS company. null = fine. */
  const reorderFieldsProblem = async (companyId: string, f: { supplierId?: string | null; reorderToQty?: number | null }): Promise<((c: any) => Response) | null> => {
    if (f.supplierId == null && f.reorderToQty == null) return null
    if (!(await d.features.isFeatureEnabled(companyId, 'store_reorders'))) return (c) => fail(c, 403, 'Reordering from suppliers is not switched on.', 'FEATURE_NOT_ENABLED')
    if (f.supplierId) {
      const [sup] = await db.select({ id: storeSupplier.id }).from(storeSupplier).where(and(eq(storeSupplier.id, f.supplierId), eq(storeSupplier.companyId, companyId))).limit(1)
      if (!sup) return (c) => fail(c, 400, 'That supplier is not one of yours. Choose another.', 'validation_failed', { supplierId: 'Not found' })
    }
    return null
  }
  const lowStockOff = (c: any) => fail(c, 403, 'Low-stock alerts are not switched on.', 'FEATURE_NOT_ENABLED')
  const currency = async (companyId: string) => (await core.settings(companyId)).currency || 'usd'
  /** This company's product, or nothing. */
  const productOf = async (companyId: string, id: string) =>
    (await db.select().from(storeProduct).where(and(eq(storeProduct.id, id), eq(storeProduct.companyId, companyId))).limit(1))[0] as typeof storeProduct.$inferSelect | undefined
  /** A variant, reached through its product's company. */
  const variantOf = async (companyId: string, id: string) =>
    (await db.select({ variant: storeProductVariant }).from(storeProductVariant)
      .innerJoin(storeProduct, eq(storeProduct.id, storeProductVariant.productId))
      .where(and(eq(storeProductVariant.id, id), eq(storeProduct.companyId, companyId))).limit(1))[0]?.variant as typeof storeProductVariant.$inferSelect | undefined
  /** A photo, reached through its product's company. */
  const imageOf = async (companyId: string, id: string) =>
    (await db.select({ image: storeProductImage }).from(storeProductImage)
      .innerJoin(storeProduct, eq(storeProduct.id, storeProductImage.productId))
      .where(and(eq(storeProductImage.id, id), eq(storeProduct.companyId, companyId))).limit(1))[0]?.image as typeof storeProductImage.$inferSelect | undefined

  // ── Products ─────────────────────────────────────────────────────────────────
  app.get('/', async (c) => {
    const u = c.get('user')
    // Honor ?limit / ?page when supplied — they were accepted and ignored, so the whole
    // catalog came back regardless. No params still returns everything (admin grid). (BUG-12)
    const limitRaw = c.req.query('limit')
    const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw) || 0, 1), 200) : undefined
    const page = Math.max(parseInt(c.req.query('page') || '1') || 1, 1)
    // ?q= is the stock look-up: a product's name, or a variant's name, SKU or barcode (../tileConditions.ts).
    const q = (c.req.query('q') || '').trim()
    // ?filter=low_stock: the products with an option at or under its level (the Dashboard's tile counts the same condition).
    const filter = c.req.query('filter')
    if (filter !== undefined && filter !== '' && filter !== 'low_stock') return fail(c, 400, 'Unknown filter.', 'validation_failed', { filter: 'Not low_stock' })
    if (filter === 'low_stock' && !(await d.features.isFeatureEnabled(u.companyId, 'store_low_stock'))) return lowStockOff(c)
    const byLow = filter === 'low_stock' ? [lowStockProductCondition(storeProduct, storeProductVariant)] : []
    const mine = and(eq(storeProduct.companyId, u.companyId), ...(q ? [productSearchCondition(storeProduct, storeProductVariant, q)] : []), ...byLow)!
    const base = db.select().from(storeProduct).where(mine).orderBy(asc(storeProduct.position), desc(storeProduct.createdAt))
    const rows: Array<typeof storeProduct.$inferSelect> = limit !== undefined ? await base.limit(limit).offset((page - 1) * limit) : await base
    const [{ total }] = limit !== undefined ? await db.select({ total: count() }).from(storeProduct).where(mine) : [{ total: rows.length }]
    const ids = rows.map((r) => r.id)
    const [imgs, vars]: [any[], any[]] = ids.length ? await Promise.all([
      db.select().from(storeProductImage).where(inArray(storeProductImage.productId, ids)).orderBy(asc(storeProductImage.position)),
      db.select().from(storeProductVariant).where(inArray(storeProductVariant.productId, ids)).orderBy(asc(storeProductVariant.position)),
    ]) : [[], []]
    const seesCost = await mayMargin(c)
    const data = rows.map((p) => ({
      ...p,
      images: imgs.filter((i) => i.productId === p.id),
      variants: stripCost(vars.filter((v) => v.productId === p.id), seesCost),
    }))
    return list(c, data, { page: limit !== undefined ? page : 1, limit: limit ?? Math.max(rows.length, 1), total: Number(total) })
  })

  app.post('/', requirePermission('products:create'), async (c) => {
    const u = c.get('user')
    const parsed = productSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    let slug = slugify(data.slug || data.name)
    // Ensure slug uniqueness by suffixing — within this company's catalogue (products_company_slug_unique).
    const existing: Array<{ slug: string }> = await db.select({ slug: storeProduct.slug }).from(storeProduct).where(eq(storeProduct.companyId, u.companyId))
    const taken = new Set(existing.map((e) => e.slug))
    if (taken.has(slug)) { let n = 2; while (taken.has(`${slug}-${n}`)) n++; slug = `${slug}-${n}` }

    const [created] = await db.insert(storeProduct).values({ ...data, slug, companyId: u.companyId }).returning()
    await audit.log({ action: audit.ACTIONS.CREATE, entity: 'product', entityId: created.id, entityName: created.name, metadata: { description: `Product ${created.name} added` }, req: c })
    await core.events.product(u.companyId, created.id)
    return one(c, created, 201)
  })

  app.get('/:id', async (c) => {
    const u = c.get('user')
    const p = await productOf(u.companyId, c.req.param('id'))
    if (!p) return fail(c, 404, 'Not found')
    const [imgs, vars] = await Promise.all([
      db.select().from(storeProductImage).where(eq(storeProductImage.productId, p.id)).orderBy(asc(storeProductImage.position)),
      db.select().from(storeProductVariant).where(eq(storeProductVariant.productId, p.id)).orderBy(asc(storeProductVariant.position)),
    ])
    return one(c, { ...p, images: imgs, variants: stripCost(vars, await mayMargin(c)) })
  })

  app.patch('/:id', requirePermission('products:update'), async (c) => {
    const u = c.get('user')
    const parsed = partialOf(productSchema).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const before = await productOf(u.companyId, c.req.param('id'))
    if (!before) return fail(c, 404, 'Not found')
    const patch: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() }
    if (parsed.data.slug) patch.slug = slugify(parsed.data.slug)
    const [updated] = await db.update(storeProduct).set(patch)
      .where(and(eq(storeProduct.id, before.id), eq(storeProduct.companyId, u.companyId))).returning()
    if (!updated) return fail(c, 404, 'Not found')
    await audit.log({ action: audit.ACTIONS.UPDATE, entity: 'product', entityId: updated.id, entityName: updated.name, changes: changedKeys(before, updated, Object.keys(parsed.data)), req: c })
    await core.events.product(u.companyId, updated.id)
    return one(c, updated)
  })

  app.delete('/:id', requirePermission('products:delete'), async (c) => {
    const u = c.get('user')
    const [gone] = await db.delete(storeProduct).where(and(eq(storeProduct.id, c.req.param('id')), eq(storeProduct.companyId, u.companyId))).returning()
    if (!gone) return fail(c, 404, 'Not found')
    await audit.log({ action: audit.ACTIONS.DELETE, entity: 'product', entityId: gone.id, entityName: gone.name, req: c })
    await core.events.product(u.companyId, gone.id, { deleted: true })
    return done(c)
  })

  // ── Variants ─────────────────────────────────────────────────────────────────
  app.post('/:id/variants', requirePermission('products:update'), async (c) => {
    const u = c.get('user')
    const parsed = variantSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const product = await productOf(u.companyId, c.req.param('id'))
    if (!product) return fail(c, 404, 'Product not found')
    if (parsed.data.lowStockAt != null && !(await d.features.isFeatureEnabled(u.companyId, 'store_low_stock'))) return lowStockOff(c)
    if (parsed.data.costCents !== undefined && !(await mayMargin(c))) return costRefused(c)
    const reorderProblem = await reorderFieldsProblem(u.companyId, parsed.data)
    if (reorderProblem) return reorderProblem(c)
    const [created] = await db.insert(storeProductVariant).values({ ...parsed.data, productId: product.id }).returning()
    // Its own row: the floor would file this under the product the URL names (create product TEA-1).
    await audit.log({ action: audit.ACTIONS.CREATE, entity: 'product_variant', entityId: created.id, entityName: created.sku, metadata: { description: `Variant ${created.sku} added — ${formatCents(created.priceCents, await currency(u.companyId))}, ${created.inventoryQty === null ? 'stock not tracked' : `${created.inventoryQty} in stock`}`, productId: created.productId }, req: c })
    await core.events.product(u.companyId, product.id); await core.events.stock(u.companyId, [created.id])
    return one(c, stripCost([created], await mayMargin(c))[0], 201)
  })

  app.patch('/variants/:variantId', requirePermission('products:update'), async (c) => {
    const u = c.get('user')
    const parsed = variantPatchSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const { inventoryFrom, ...fields } = parsed.data
    // Read for the audit row and the company — the write below decides nothing else from it. A guarded count's
    // starting figure is the one the person saw (inventoryFrom), which is exactly what the row should say it went from.
    const before = await variantOf(u.companyId, c.req.param('variantId'))
    if (!before) return fail(c, 404, 'Not found')
    if (fields.lowStockAt != null && !(await d.features.isFeatureEnabled(u.companyId, 'store_low_stock'))) return lowStockOff(c)
    if (fields.costCents !== undefined && !(await mayMargin(c))) return costRefused(c)
    const reorderProblem = await reorderFieldsProblem(u.companyId, fields)
    if (reorderProblem) return reorderProblem(c)
    const guarded = inventoryFrom !== undefined && fields.inventoryQty !== undefined
    const where = guarded
      ? and(eq(storeProductVariant.id, before.id), inventoryFrom === null ? isNull(storeProductVariant.inventoryQty) : eq(storeProductVariant.inventoryQty, inventoryFrom))
      : eq(storeProductVariant.id, before.id)
    const [updated] = await db.update(storeProductVariant).set({ ...fields, updatedAt: new Date() }).where(where).returning()
    if (!updated) {
      const now = await variantOf(u.companyId, before.id)
      if (!now) return fail(c, 404, 'Not found')
      const stands = now.inventoryQty === null ? 'untracked' : String(now.inventoryQty)
      // (The template also sent the count as inventoryQty; the sentence names it.)
      return fail(c, 409, `The stock changed to ${stands} since this page loaded (a sale, or someone else's count), so nothing was saved. Check the count and save again.`, 'inventory_changed')
    }
    const from = guarded ? { ...before, inventoryQty: inventoryFrom } : before
    await audit.log({ action: audit.ACTIONS.UPDATE, entity: 'product_variant', entityId: updated.id, entityName: updated.sku, changes: changedKeys(from, updated, Object.keys(fields)), req: c })
    await core.events.product(u.companyId, updated.productId); if (fields.inventoryQty !== undefined) await core.events.stock(u.companyId, [updated.id])
    return one(c, stripCost([updated], await mayMargin(c))[0])
  })

  app.delete('/variants/:variantId', requirePermission('products:delete'), async (c) => {
    const u = c.get('user')
    const variant = await variantOf(u.companyId, c.req.param('variantId'))
    if (!variant) return fail(c, 404, 'Not found')
    await db.delete(storeProductVariant).where(eq(storeProductVariant.id, variant.id))
    await audit.log({ action: audit.ACTIONS.DELETE, entity: 'product_variant', entityId: variant.id, entityName: variant.sku, req: c })
    await core.events.product(u.companyId, variant.productId)
    return done(c)
  })

  // ── Images ───────────────────────────────────────────────────────────────────
  app.post('/:id/images', requirePermission('products:update'), async (c) => {
    const u = c.get('user')
    const parsed = imageSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const product = await productOf(u.companyId, c.req.param('id'))
    if (!product) return fail(c, 404, 'Product not found')
    const { isPrimary, ...rest } = parsed.data
    const [created] = await db.insert(storeProductImage).values({ ...rest, isPrimary: false, productId: product.id }).returning()
    const image = isPrimary ? (await makeOnlyPrimaryImage(db, u.companyId, product.id, created.id)) ?? created : created
    await audit.log({ action: audit.ACTIONS.CREATE, entity: 'product_image', entityId: image.id, entityName: product.name, metadata: { description: `Photo added to ${product.name}${image.isPrimary ? ' as its main photo' : ''}`, productId: product.id }, req: c })
    await core.events.product(u.companyId, product.id)
    return one(c, image, 201)
  })

  app.post('/:id/images/upload', requirePermission('products:update'), async (c) => {
    const u = c.get('user')
    const storage = d.services.storage
    if (storage.storageConfigured && !storage.storageConfigured()) return fail(c, 503, 'Image storage is not configured for this store', 'storage_not_configured')
    const product = await productOf(u.companyId, c.req.param('id'))
    if (!product) return fail(c, 404, 'Product not found')

    const form = await c.req.parseBody().catch(() => null)
    const file = form?.['file']
    if (!(file instanceof File)) return fail(c, 400, 'No file uploaded')
    const ext = UPLOAD_EXT[file.type]
    if (!ext) return fail(c, 415, 'Unsupported image type (use JPEG, PNG, WebP, GIF, or AVIF)')
    if (file.size > UPLOAD_MAX_BYTES) return fail(c, 413, 'Image too large (max 8 MB)')

    const buf = Buffer.from(await file.arrayBuffer())
    const key = `${productPhotoPrefix(u.companyId, product.id)}${crypto.randomUUID()}.${ext}`
    await storage.put(key, buf, file.type)
    const url = `/media/${key}`

    const existing = await db.select({ id: storeProductImage.id }).from(storeProductImage).where(eq(storeProductImage.productId, product.id))
    const isPrimary = existing.length === 0
    const [created] = await db.insert(storeProductImage).values({ productId: product.id, url, alt: product.name, isPrimary }).returning()
    await audit.log({ action: audit.ACTIONS.CREATE, entity: 'product_image', entityId: created.id, entityName: product.name, metadata: { description: `Photo uploaded to ${product.name}`, productId: product.id }, req: c })
    await core.events.product(u.companyId, product.id)
    return one(c, created, 201)
  })

  app.patch('/images/:imageId', requirePermission('products:update'), async (c) => {
    const u = c.get('user')
    const parsed = partialOf(imageSchema).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const img = await imageOf(u.companyId, c.req.param('imageId'))
    if (!img) return fail(c, 404, 'Not found')
    const { isPrimary, ...rest } = parsed.data
    let [updated] = Object.keys(rest).length || isPrimary === false
      ? await db.update(storeProductImage).set({ ...rest, ...(isPrimary === false ? { isPrimary: false } : {}) }).where(eq(storeProductImage.id, img.id)).returning()
      : [img]
    if (isPrimary) updated = (await makeOnlyPrimaryImage(db, u.companyId, img.productId, img.id)) ?? updated
    await audit.log({ action: audit.ACTIONS.UPDATE, entity: 'product_image', entityId: img.id, changes: changedKeys(img, updated, Object.keys(parsed.data)), metadata: { productId: img.productId }, req: c })
    await core.events.product(u.companyId, img.productId)
    return one(c, updated)
  })

  app.delete('/images/:imageId', requirePermission('products:update'), async (c) => {
    const u = c.get('user')
    const img = await imageOf(u.companyId, c.req.param('imageId'))
    if (!img) return fail(c, 404, 'Not found')
    await db.delete(storeProductImage).where(eq(storeProductImage.id, img.id))
    // If it was a photo this store uploaded, drop the stored file too. Best-effort: the row is the source of truth.
    const key = uploadedKey(img.url, u.companyId, img.productId)
    if (key) { try { d.services.storage.deleteFile(key) } catch { /* the row is gone; the file is only a file */ } }
    await audit.log({ action: audit.ACTIONS.DELETE, entity: 'product_image', entityId: img.id, metadata: { description: 'Photo removed', productId: img.productId }, req: c })
    await core.events.product(u.companyId, img.productId)
    return done(c)
  })

  return app
}

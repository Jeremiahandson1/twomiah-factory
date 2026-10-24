// What the storefront shows: the company's ACTIVE products, each with its images and variants. Moved from
// templates/crm-store/backend/src/routes/public.ts (hydrate, GET /products, GET /products/:slug), so the API routes and
// the website's own shop pages (server/site, rendered in this app) read the same data the same way.
//
// Changes from the template:
//   · every read is the company's (products.company_id; a product's images and variants reach it through the product);
//   · the product's company_id is not sent — the template's product row had no such column, so the storefront's
//     product carries exactly the fields it did.
import { and, asc, eq, inArray } from 'drizzle-orm'
import { storeProduct, storeProductImage, storeProductVariant } from '../../../db/schema/store.ts'
import type { CrmDeps } from '../../deps.ts'

type Product = typeof storeProduct.$inferSelect
export type StorefrontProduct = Omit<Product, 'companyId'> & {
  images: Array<typeof storeProductImage.$inferSelect>
  variants: Array<typeof storeProductVariant.$inferSelect>
}

/** Images and variants for each product, in position order. */
export async function hydrateProducts(db: any, rows: Product[]): Promise<StorefrontProduct[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const [imgs, vars]: [Array<typeof storeProductImage.$inferSelect>, Array<typeof storeProductVariant.$inferSelect>] = await Promise.all([
    db.select().from(storeProductImage).where(inArray(storeProductImage.productId, ids)).orderBy(asc(storeProductImage.position)),
    db.select().from(storeProductVariant).where(inArray(storeProductVariant.productId, ids)).orderBy(asc(storeProductVariant.position)),
  ])
  return rows.map(({ companyId: _co, ...p }) => ({
    ...p,
    images: imgs.filter((i) => i.productId === p.id),
    variants: vars.filter((v) => v.productId === p.id),
  }))
}

/** The company's active product with this slug (the row), or null. */
export async function activeProductRow(db: any, companyId: string, slug: string): Promise<Product | null> {
  const [row] = await db.select().from(storeProduct)
    .where(and(eq(storeProduct.companyId, companyId), eq(storeProduct.slug, slug), eq(storeProduct.status, 'active'))).limit(1)
  return row || null
}

/** Every active product of the company, in the shop's order (position), with images and variants. */
export async function storefrontCatalogue(d: Pick<CrmDeps, 'db'>, companyId: string): Promise<StorefrontProduct[]> {
  const rows = await d.db.select().from(storeProduct)
    .where(and(eq(storeProduct.companyId, companyId), eq(storeProduct.status, 'active'))).orderBy(asc(storeProduct.position))
  return hydrateProducts(d.db, rows)
}

/** One active product by its slug, with images and variants; null when there is none (or it is not on sale). */
export async function storefrontProduct(d: Pick<CrmDeps, 'db'>, companyId: string, slug: string): Promise<StorefrontProduct | null> {
  const row = await activeProductRow(d.db, companyId, slug)
  if (!row) return null
  const [full] = await hydrateProducts(d.db, [row])
  return full
}

// ── Upsells (2026-10-24, the store upgrade) ──────────────────────────────────
/**
 * "Frequently bought together" and "You may also like" for one product: the owner's own picks (boughtTogetherIds,
 * alsoLikeIds — those still on sale, in the owner's order), else products in the same category, the shop's order. The
 * two lists never repeat a product, nor show the product itself. A gift card is never offered by category.
 */
export function pickUpsells(product: Pick<Product, 'id' | 'category' | 'boughtTogetherIds' | 'alsoLikeIds'>, onSale: Array<Pick<Product, 'id' | 'category' | 'kind'>>, max = { together: 3, alsoLike: 4 }): { together: string[]; alsoLike: string[] } {
  const live = new Map(onSale.map((p) => [p.id, p]))
  const sameCategory = product.category
    ? onSale.filter((p) => p.id !== product.id && p.kind !== 'gift_card' && p.category === product.category).map((p) => p.id)
    : []
  const owned = (ids: string[] | null | undefined) => (ids || []).filter((id) => id !== product.id && live.has(id))
  const pickedTogether = owned(product.boughtTogetherIds)
  const together = (pickedTogether.length ? pickedTogether : sameCategory).slice(0, max.together)
  const pickedAlso = owned(product.alsoLikeIds).filter((id) => !together.includes(id))
  const alsoLike = (pickedAlso.length ? pickedAlso : sameCategory.filter((id) => !together.includes(id))).slice(0, max.alsoLike)
  return { together, alsoLike }
}

/** The company's products on sale, the columns the upsells read. */
const onSaleOf = (db: any, companyId: string): Promise<Product[]> => db.select().from(storeProduct)
  .where(and(eq(storeProduct.companyId, companyId), eq(storeProduct.status, 'active'))).orderBy(asc(storeProduct.position), asc(storeProduct.createdAt))

/** One product's two upsell lists, each product with its images and variants. */
export async function productUpsells(d: Pick<CrmDeps, 'db'>, companyId: string, product: Pick<Product, 'id' | 'category' | 'boughtTogetherIds' | 'alsoLikeIds'>): Promise<{ together: StorefrontProduct[]; alsoLike: StorefrontProduct[] }> {
  const rows = await onSaleOf(d.db, companyId)
  const picked = pickUpsells(product, rows)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const full = await hydrateProducts(d.db, [...picked.together, ...picked.alsoLike].map((id) => byId.get(id)!).filter(Boolean))
  const of = (ids: string[]) => ids.map((id) => full.find((p) => p.id === id)).filter((p): p is StorefrontProduct => !!p)
  return { together: of(picked.together), alsoLike: of(picked.alsoLike) }
}

/**
 * The cart's upsell line: the first product bought together with something in the cart (by the same rule as the product
 * page) that is not in the cart already and has a variant in stock — that variant, ready to add. Null when there is none.
 */
export async function cartUpsell(d: Pick<CrmDeps, 'db'>, companyId: string, skus: string[]): Promise<{ slug: string; name: string; sku: string; variantName: string; priceCents: number; imageUrl: string | null } | null> {
  const rows = await onSaleOf(d.db, companyId)
  if (!rows.length) return null
  const inCart: Array<{ productId: string }> = await d.db.select({ productId: storeProductVariant.productId }).from(storeProductVariant)
    .innerJoin(storeProduct, eq(storeProduct.id, storeProductVariant.productId))
    .where(and(eq(storeProduct.companyId, companyId), inArray(storeProductVariant.sku, skus)))
  const held = new Set(inCart.map((r) => r.productId))
  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const pid of held) {
    const p = byId.get(pid)
    if (!p) continue
    for (const id of pickUpsells(p, rows).together) {
      if (held.has(id)) continue
      const [full] = await hydrateProducts(d.db, [byId.get(id)!])
      const v = full?.variants.find((x) => x.inventoryQty === null || x.inventoryQty > 0)
      if (!full || !v) continue
      const img = full.images.find((i) => i.isPrimary) ?? full.images[0]
      return { slug: full.slug, name: full.name, sku: v.sku, variantName: v.name, priceCents: v.priceCents, imageUrl: img?.url ?? null }
    }
  }
  return null
}

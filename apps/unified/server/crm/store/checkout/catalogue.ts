// What the storefront shows: the company's ACTIVE products, each with its images and variants. Moved from
// templates/crm-store/backend/src/routes/public.ts (hydrate, GET /products, GET /products/:slug), so the API routes and
// the website's own shop pages (server/site, rendered in this app) read the same data the same way.
//
// Changes from the template:
//   · every read is the company's (products.company_id; a product's images and variants reach it through the product);
//   · the product's company_id is not sent — the template's product row had no such column, so the storefront's
//     product carries exactly the fields it did.
import { and, asc, eq, inArray, or } from 'drizzle-orm'
import { storeProduct, storeProductImage, storeProductVariant } from '../../../db/schema/store.ts'
import type { CrmDeps } from '../../deps.ts'

type Product = typeof storeProduct.$inferSelect
export type StorefrontProduct = Omit<Product, 'companyId'> & {
  images: Array<typeof storeProductImage.$inferSelect>
  variants: Array<Omit<typeof storeProductVariant.$inferSelect, 'lowStockAt'>>
}

/** Images and variants for each product, in position order. */
export async function hydrateProducts(db: any, rows: Product[]): Promise<StorefrontProduct[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const [imgs, vars]: [Array<typeof storeProductImage.$inferSelect>, Array<typeof storeProductVariant.$inferSelect>] = await Promise.all([
    db.select().from(storeProductImage).where(inArray(storeProductImage.productId, ids)).orderBy(asc(storeProductImage.position)),
    db.select().from(storeProductVariant).where(inArray(storeProductVariant.productId, ids)).orderBy(asc(storeProductVariant.position)),
  ])
  // Grouped once by product (the load test, 2026-10-24): filtering every image and variant for every product was
  // products × (images + variants) comparisons — 50 million on a 5,000-product shop, on every catalogue read.
  const group = <T extends { productId: string }>(xs: T[]) => {
    const by = new Map<string, T[]>()
    for (const x of xs) { const list = by.get(x.productId); if (list) list.push(x); else by.set(x.productId, [x]) }
    return by
  }
  const imagesOf = group(imgs), variantsOf = group(vars)
  return rows.map(({ companyId: _co, ...p }) => ({
    ...p,
    images: imagesOf.get(p.id) ?? [],
    // The owner's low-stock level is not the shopper's to read.
    variants: (variantsOf.get(p.id) ?? []).map(({ lowStockAt: _lo, ...v }) => v),
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

/**
 * The products an upsell could be for these products: on sale, and either one of their picks or in one of their
 * categories — never the whole catalogue (the load test, 2026-10-24: every product page read all of it). In the shop's
 * order, which pickUpsells keeps.
 */
async function candidatesFor(db: any, companyId: string, sources: Array<Pick<Product, 'category' | 'boughtTogetherIds' | 'alsoLikeIds'>>): Promise<Product[]> {
  const ids = [...new Set(sources.flatMap((s) => [...(s.boughtTogetherIds || []), ...(s.alsoLikeIds || [])]))]
  const cats = [...new Set(sources.map((s) => s.category).filter((c): c is string => !!c))]
  if (!ids.length && !cats.length) return []
  const either = ids.length && cats.length ? or(inArray(storeProduct.id, ids), inArray(storeProduct.category, cats)) : ids.length ? inArray(storeProduct.id, ids) : inArray(storeProduct.category, cats)
  return db.select().from(storeProduct)
    .where(and(eq(storeProduct.companyId, companyId), eq(storeProduct.status, 'active'), either)).orderBy(asc(storeProduct.position), asc(storeProduct.createdAt))
}

/** One product's two upsell lists, each product with its images and variants. */
export async function productUpsells(d: Pick<CrmDeps, 'db'>, companyId: string, product: Pick<Product, 'id' | 'category' | 'boughtTogetherIds' | 'alsoLikeIds'>): Promise<{ together: StorefrontProduct[]; alsoLike: StorefrontProduct[] }> {
  const rows = await candidatesFor(d.db, companyId, [product])
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
  const inCart: Product[] = (await d.db.select({ p: storeProduct }).from(storeProductVariant)
    .innerJoin(storeProduct, eq(storeProduct.id, storeProductVariant.productId))
    .where(and(eq(storeProduct.companyId, companyId), eq(storeProduct.status, 'active'), inArray(storeProductVariant.sku, skus)))).map((r: any) => r.p)
  if (!inCart.length) return null
  const held = new Set(inCart.map((r) => r.id))
  const rows = await candidatesFor(d.db, companyId, inCart)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const order: string[] = []
  for (const p of [...new Map(inCart.map((x) => [x.id, x])).values()]) {
    for (const id of pickUpsells(p, rows).together) if (!held.has(id) && !order.includes(id)) order.push(id)
  }
  if (!order.length) return null
  // One read for every candidate's options and pictures, not one per candidate.
  const full = await hydrateProducts(d.db, order.map((id) => byId.get(id)!).filter(Boolean))
  for (const id of order) {
    const f = full.find((x) => x.id === id)
    const v = f?.variants.find((x) => x.inventoryQty === null || x.inventoryQty > 0)
    if (!f || !v) continue
    const img = f.images.find((i) => i.isPrimary) ?? f.images[0]
    return { slug: f.slug, name: f.name, sku: v.sku, variantName: v.name, priceCents: v.priceCents, imageUrl: img?.url ?? null }
  }
  return null
}

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

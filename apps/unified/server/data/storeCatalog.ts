// The store catalogue's raw SQL (RULEBOOK §2), for server/crm/store/catalog/: the one-statement primary photo
// (templates/crm-store/backend/src/routes/products.ts makeOnlyPrimary) and the review queue's counts
// (routes/reviews.ts GET /counts). Each takes the company it answers for; a photo is reached through its product.
import { and, eq, sql } from 'drizzle-orm'
import { productReview, storeProduct, storeProductImage } from '../db/schema/store.ts'

/**
 * ONE PRIMARY PHOTO, IN ONE STATEMENT. "Clear every primary, then set this one" was two writes: two people choosing
 * different photos at once could both clear, then both set — and the product had two primary photos, the storefront
 * showing whichever it read first. Setting every row of the product to (id = chosen) is a single UPDATE, so the last
 * choice wins whole. The product must be this company's; the chosen photo is returned (none when it is not the
 * product's).
 */
export async function makeOnlyPrimaryImage(db: any, companyId: string, productId: string, imageId: string): Promise<typeof storeProductImage.$inferSelect | null> {
  const rows: Array<typeof storeProductImage.$inferSelect> = await db.update(storeProductImage)
    .set({ isPrimary: sql`${storeProductImage.id} = ${imageId}` })
    .where(and(
      eq(storeProductImage.productId, productId),
      sql`exists (select 1 from ${storeProduct} where ${storeProduct.id} = ${productId} and ${storeProduct.companyId} = ${companyId})`,
    ))
    .returning()
  return rows.find((r) => r.id === imageId) ?? null
}

/** How many of the company's reviews wait for a decision, and how many were published or turned down. */
export async function reviewCountsByStatus(db: any, companyId: string): Promise<{ pending: number; approved: number; rejected: number }> {
  const [row] = await db.select({
    pending: sql<number>`count(*) filter (where ${productReview.status} = 'pending')::int`,
    approved: sql<number>`count(*) filter (where ${productReview.status} = 'approved')::int`,
    rejected: sql<number>`count(*) filter (where ${productReview.status} = 'rejected')::int`,
  }).from(productReview).where(eq(productReview.companyId, companyId))
  return { pending: Number(row?.pending ?? 0), approved: Number(row?.approved ?? 0), rejected: Number(row?.rejected ?? 0) }
}

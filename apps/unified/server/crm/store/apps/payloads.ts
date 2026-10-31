// What the store tells the outside world about an order, a product or a stock count — the SAME shapes in a webhook's body and in
// the public store API (store_webhooks / store_api, 2026-10-31, parity row 8). Money in integer cents, times as ISO 8601 (UTC).
// Never in these: what things cost the shop, the shop's internal notes, supplier details, label costs, recovery links, the
// payment provider's ids. Those stay behind the shop's own sign-in.
import { and, asc, eq, inArray } from 'drizzle-orm'
import { storeOrder, storeOrderItem, storeProduct, storeProductImage, storeProductVariant } from '../../../db/schema/store.ts'

const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null)

export function orderView(o: typeof storeOrder.$inferSelect, items: Array<typeof storeOrderItem.$inferSelect>) {
  return {
    id: o.id,
    number: o.orderNumber,
    status: o.status,
    source: o.source,
    fulfillment: o.fulfillment,
    currency: o.currency,
    createdAt: iso(o.createdAt),
    fulfilledAt: iso(o.fulfilledAt),
    deliveredAt: iso(o.deliveredAt),
    refundedAt: iso(o.refundedAt),
    customer: { email: o.customerEmail, name: o.customerName, phone: o.customerPhone },
    shippingAddress: o.shippingAddress ?? null,
    billingAddress: o.billingAddress ?? null,
    totals: {
      subtotalCents: o.subtotalCents, shippingCents: o.shippingCents, taxCents: o.taxCents, discountCents: o.discountCents,
      giftCardCents: o.giftCardCents, totalCents: o.totalCents, refundedCents: o.refundedCents,
    },
    discountCode: o.discountCode,
    tracking: { carrier: o.trackingCarrier, number: o.trackingNumber },
    customerNote: o.customerNote,
    items: items.map((i) => ({
      id: i.id, productId: i.productId, variantId: i.variantId, sku: i.sku, name: i.productName, variantName: i.variantName,
      quantity: i.quantity, unitPriceCents: i.unitPriceCents, lineTotalCents: i.lineTotalCents, refundedQuantity: i.refundedQuantity,
    })),
  }
}

export function variantView(v: typeof storeProductVariant.$inferSelect) {
  return {
    id: v.id, sku: v.sku, name: v.name, options: v.options ?? {}, priceCents: v.priceCents, compareAtPriceCents: v.compareAtPriceCents,
    weightOz: v.weightOz, gtin: v.gtin, mpn: v.mpn,
    /** null = the shop does not count this option's stock (it is always for sale). */
    inventoryQty: v.inventoryQty,
  }
}

export function productView(p: typeof storeProduct.$inferSelect, variants: Array<typeof storeProductVariant.$inferSelect>, images: Array<typeof storeProductImage.$inferSelect>) {
  return {
    id: p.id, slug: p.slug, name: p.name, tagline: p.tagline, description: p.description, status: p.status, kind: p.kind,
    category: p.category, brand: p.brand, featured: p.featured, createdAt: iso(p.createdAt), updatedAt: iso(p.updatedAt),
    images: images.map((i) => ({ url: i.url, alt: i.alt, primary: i.isPrimary })),
    variants: variants.map(variantView),
  }
}

export async function loadOrderView(db: any, companyId: string, orderId: string) {
  const [o] = await db.select().from(storeOrder).where(and(eq(storeOrder.id, orderId), eq(storeOrder.companyId, companyId))).limit(1)
  if (!o) return null
  const items = await db.select().from(storeOrderItem).where(eq(storeOrderItem.orderId, o.id))
  return orderView(o, items)
}

/** Products with their options and pictures, in the order given. */
export async function loadProductViews(db: any, productRows: Array<typeof storeProduct.$inferSelect>) {
  if (!productRows.length) return []
  const ids = productRows.map((p) => p.id)
  const [vs, ims] = await Promise.all([
    db.select().from(storeProductVariant).where(inArray(storeProductVariant.productId, ids)).orderBy(asc(storeProductVariant.position), asc(storeProductVariant.sku)),
    db.select().from(storeProductImage).where(inArray(storeProductImage.productId, ids)).orderBy(asc(storeProductImage.position)),
  ])
  return productRows.map((p) => productView(p, vs.filter((v: any) => v.productId === p.id), ims.filter((i: any) => i.productId === p.id)))
}

export async function loadProductView(db: any, companyId: string, productId: string) {
  const [p] = await db.select().from(storeProduct).where(and(eq(storeProduct.id, productId), eq(storeProduct.companyId, companyId))).limit(1)
  return p ? (await loadProductViews(db, [p]))[0] : null
}

/** One stock count per option: what the shelf holds now. */
export async function loadStockViews(db: any, companyId: string, variantIds: string[]) {
  if (!variantIds.length) return []
  const rows = await db.select({ v: storeProductVariant, productId: storeProduct.id, productName: storeProduct.name })
    .from(storeProductVariant).innerJoin(storeProduct, eq(storeProduct.id, storeProductVariant.productId))
    .where(and(eq(storeProduct.companyId, companyId), inArray(storeProductVariant.id, variantIds)))
  return rows.map((r: any) => ({ variantId: r.v.id, productId: r.productId, productName: r.productName, sku: r.v.sku, name: r.v.name, inventoryQty: r.v.inventoryQty as number | null }))
}

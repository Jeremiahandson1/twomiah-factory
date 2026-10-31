// The store's customer segments (store_segments, 2026-10-31), as SQL over `contact` (RULEBOOK §2). One definition becomes
// one condition: the same SQL answers a campaign's audience, a follow-up email's "only these customers", the Segments
// screen's count and the audience export, so they can never disagree about who is in a segment.
//
// "Orders" are the sales the reports count (countedOrderCondition: not unfinished, not cancelled, not an exchange); what a
// customer SPENT is what they paid less what went back. A returned item (refunded_quantity = quantity) is not "bought".
// A period is the last N days, or a stretch of the shop's own days (the company's time zone), both ends included.
import { and, eq, sql, type SQL } from 'drizzle-orm'
import { contact } from '../db/schema/index.ts'
import { storeOrder, storeOrderItem, storeProduct, type SegmentDefinition } from '../db/schema/store.ts'
import { countedOrderCondition } from '../crm/store/tileConditions.ts'

const DAY = 86_400_000
const list = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `)

/** The orders of THIS customer in the period: a SQL fragment to AND into a `from orders` query. */
function ownOrders(companyId: string, def: SegmentDefinition, timeZone: string, now: Date): SQL {
  const parts: SQL[] = [sql`${storeOrder.companyId} = ${companyId}`, sql`${storeOrder.contactId} = ${contact.id}`, countedOrderCondition(storeOrder)]
  const p = def.period as any
  if (p && typeof p.days === 'number') parts.push(sql`${storeOrder.createdAt} >= ${new Date(now.getTime() - p.days * DAY)}`)
  else if (p && typeof p.from === 'string') {
    const local = sql`((${storeOrder.createdAt} at time zone 'UTC') at time zone ${timeZone})`
    parts.push(sql`${local} >= ${p.from}::date`)
    if (p.to) parts.push(sql`${local} < (${p.to}::date + 1)`)
  }
  return sql.join(parts, sql` and `)
}

/** Bought any of these products (by id) or anything in these categories. */
function boughtAny(companyId: string, def: SegmentDefinition, which: { productIds?: string[]; categories?: string[] }, timeZone: string, now: Date): SQL {
  const picks: SQL[] = []
  if (which.productIds?.length) picks.push(sql`${storeOrderItem.productId} in (${list(which.productIds)})`)
  if (which.categories?.length) picks.push(sql`${storeProduct.category} in (${list(which.categories)})`)
  const any = picks.length ? sql`(${sql.join(picks, sql` or `)})` : sql`false`
  return sql`exists (select 1 from ${storeOrder} join ${storeOrderItem} on ${storeOrderItem.orderId} = ${storeOrder.id}
    left join ${storeProduct} on ${storeProduct.id} = ${storeOrderItem.productId}
    where ${ownOrders(companyId, def, timeZone, now)} and ${storeOrderItem.quantity} - ${storeOrderItem.refundedQuantity} > 0 and ${any})`
}

/** The condition on `contact` for a definition. A definition that asks for nothing matches NOBODY (never "everyone"). */
export function segmentCondition(companyId: string, def: SegmentDefinition, timeZone: string, now: Date = new Date()): SQL {
  const conds: SQL[] = []
  const spent = sql`(select coalesce(sum(${storeOrder.totalCents} - ${storeOrder.refundedCents}), 0) from ${storeOrder} where ${ownOrders(companyId, def, timeZone, now)})`
  const count = sql`(select count(*) from ${storeOrder} where ${ownOrders(companyId, def, timeZone, now)})`
  if (def.spend?.minCents != null) conds.push(sql`${spent} >= ${def.spend.minCents}`)
  if (def.spend?.maxCents != null) conds.push(sql`${spent} <= ${def.spend.maxCents}`)
  if (def.orders?.min != null) conds.push(sql`${count} >= ${def.orders.min}`)
  if (def.orders?.max != null) conds.push(sql`${count} <= ${def.orders.max}`)
  if (def.bought && (def.bought.productIds?.length || def.bought.categories?.length)) conds.push(boughtAny(companyId, def, def.bought, timeZone, now))
  if (def.notBought && (def.notBought.productIds?.length || def.notBought.categories?.length)) conds.push(sql`not ${boughtAny(companyId, def, def.notBought, timeZone, now)}`)
  if (!conds.length) return sql`false`
  return and(eq(contact.companyId, companyId), ...conds)!
}

export interface SegmentPerson { id: string; name: string | null; email: string | null; phone: string | null; emailOptOut: boolean }

/** Who is in the segment: everyone who matches (`emailable` = and has an address and has not unsubscribed), most recent first, up to `limit`. */
export async function segmentPeople(db: any, companyId: string, def: SegmentDefinition, timeZone: string, o: { emailable?: boolean; limit?: number; now?: Date } = {}): Promise<SegmentPerson[]> {
  const cond = segmentCondition(companyId, def, timeZone, o.now)
  const where = o.emailable ? sql`${cond} and ${contact.email} is not null and ${contact.email} <> '' and ${contact.emailOptOut} = false` : cond
  return db.select({ id: contact.id, name: contact.name, email: contact.email, phone: contact.phone, emailOptOut: contact.emailOptOut })
    .from(contact).where(where).orderBy(sql`${contact.createdAt} desc`, contact.id).limit(o.limit ?? 5000)
}

/** How many match, and how many of them can be emailed. */
export async function segmentCounts(db: any, companyId: string, def: SegmentDefinition, timeZone: string, now?: Date): Promise<{ matching: number; emailable: number }> {
  const cond = segmentCondition(companyId, def, timeZone, now)
  const [r] = await db.select({
    matching: sql<number>`count(*)`,
    emailable: sql<number>`count(*) filter (where ${contact.email} is not null and ${contact.email} <> '' and ${contact.emailOptOut} = false)`,
  }).from(contact).where(cond)
  return { matching: Number(r?.matching ?? 0), emailable: Number(r?.emailable ?? 0) }
}

/** The product categories in use and the products on sale, for the segment builder's pickers. */
export async function segmentChoices(db: any, companyId: string): Promise<{ categories: string[]; products: Array<{ id: string; name: string }> }> {
  const cats = await db.selectDistinct({ category: storeProduct.category }).from(storeProduct)
    .where(and(eq(storeProduct.companyId, companyId), sql`${storeProduct.category} is not null and ${storeProduct.category} <> ''`)).orderBy(storeProduct.category)
  const products = await db.select({ id: storeProduct.id, name: storeProduct.name }).from(storeProduct)
    .where(and(eq(storeProduct.companyId, companyId), sql`${storeProduct.status} <> 'archived'`)).orderBy(storeProduct.name).limit(500)
  return { categories: cats.map((r: any) => String(r.category)), products }
}

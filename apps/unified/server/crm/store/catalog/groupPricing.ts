// Wholesale prices (2026-10-24, the store upgrade): a customer group (e.g. "Wholesale") takes a percent off the
// catalogue, and may set its own price for any variant, which wins. A customer is in at most one group.
//
// WHERE THE PRICES APPLY. A group price is a promise to a person, so it needs proof of who is asking, and an email typed
// at checkout proves nothing: a group price charged on it alone would hand wholesale prices to anyone who knew a wholesale
// customer's address. So a group's prices apply (1) to the orders the owner makes for that customer (a draft order:
// orders/draftOrders.ts), which the customer pays from the emailed link, and (2) to a shopper SIGNED IN to their account
// (accounts/shopperAccounts.ts, when store_accounts is on): checkout reads the group from the account's own session
// cookie, never from the typed email. A guest who types a member's email pays the shop's prices.
import { and, eq, inArray } from 'drizzle-orm'
import { storeCustomerGroup, storeCustomerGroupMember, storeGroupPrice } from '../../../db/schema/store.ts'

export interface GroupPricing { groupId: string; name: string; percentOff: number; prices: Map<string, number> }

/**
 * One variant's price for a group: its own group price if it has one, else the catalogue price less the group's percent
 * (rounded to the cent), never below zero. A gift card is never discounted — it is money, not goods.
 */
export function groupPrice(baseCents: number, variantId: string, g: Pick<GroupPricing, 'percentOff' | 'prices'> | null, isGiftCard = false): number {
  if (!g || isGiftCard) return baseCents
  const own = g.prices.get(variantId)
  if (own != null) return Math.max(0, own)
  const pct = Math.max(0, Math.min(100, g.percentOff || 0))
  return Math.max(0, Math.round((baseCents * (100 - pct)) / 100))
}

/** The group this contact is in, with its prices for these variants (all of them when no list is given), or null. */
export async function pricingForContact(db: any, companyId: string, contactId: string | null | undefined, variantIds?: string[]): Promise<GroupPricing | null> {
  if (!contactId) return null
  const [m] = await db.select({ groupId: storeCustomerGroup.id, name: storeCustomerGroup.name, percentOff: storeCustomerGroup.percentOff })
    .from(storeCustomerGroupMember)
    .innerJoin(storeCustomerGroup, eq(storeCustomerGroup.id, storeCustomerGroupMember.groupId))
    .where(and(eq(storeCustomerGroupMember.contactId, contactId), eq(storeCustomerGroupMember.companyId, companyId), eq(storeCustomerGroup.companyId, companyId)))
    .limit(1)
  if (!m) return null
  const rows: Array<{ variantId: string; priceCents: number }> = variantIds && !variantIds.length ? [] : await db.select({ variantId: storeGroupPrice.variantId, priceCents: storeGroupPrice.priceCents })
    .from(storeGroupPrice)
    .where(variantIds ? and(eq(storeGroupPrice.groupId, m.groupId), inArray(storeGroupPrice.variantId, variantIds)) : eq(storeGroupPrice.groupId, m.groupId))
  return { groupId: m.groupId, name: m.name, percentOff: m.percentOff, prices: new Map(rows.map((r) => [r.variantId, r.priceCents])) }
}

// /api/admin/counter-sales — a sale at the counter (parity tier 2 #12, Shopify POS; feature store_counter, not ready).
//
//   POST /   orders:create   { items: [{ sku, quantity }], paidBy: 'cash' | 'card' | 'other', contactId?, email?, locationId?, preview? }
//   (locationId: where the counter is, with stock by location — the units come off there; one of the store's locations)
//
// The same order the store makes everywhere (../checkout/placeOrder.ts): the catalogue's prices, the store's tax, the stock taken
// off (by location where store_locations counts it), points and the receipt — paid in person, so no payment provider is involved
// and nothing is charged by us: cash, or a card on the shop's own machine. A walk-in needs no customer; with an email the receipt
// goes there (and an email that is a customer's makes the sale theirs). The order is handed over there and then (picked up). `preview` prices the sale without making it.
// Taking a card by tapping it on the phone is not here: that is the shop's own Stripe Terminal, a separate money integration.
//
// orders:create, as a hand-made order: the owner's and the manager's.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq, ilike } from 'drizzle-orm'
import { contact } from '../../../db/schema/index.ts'
import { storeOrder } from '../../../db/schema/store.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import { pricingForContact } from '../catalog/groupPricing.ts'
import { createCheckoutService, requestOrigin } from '../checkout/checkoutService.ts'
import { createOrderStarter } from '../checkout/placeOrder.ts'
import { createStoreGiftCards } from '../giftCards.ts'
import { storeLocations } from '../../../data/storeStock.ts'

const PAID_BY_WORDS = { cash: 'cash', card: 'card on the shop’s machine', other: 'other' } as const
const saleSchema = z.object({
  items: z.array(z.object({ sku: z.string().min(1), quantity: z.number().int().positive().max(9999) })).min(1, 'Add at least one item').max(100),
  paidBy: z.enum(['cash', 'card', 'other'], { error: 'Choose how they paid' }),
  contactId: z.string().min(1).optional().nullable(),
  email: z.string().trim().email('Enter a whole email address, or leave it empty').max(200).optional().nullable().or(z.literal('')),
  preview: z.boolean().optional(),
  locationId: z.string().min(1).max(40).optional().nullable(),
})

export function createCounterSaleRoutes(d: CrmDeps, core: StoreCore) {
  const { db, audit } = d
  const app = new Hono<AppEnv>()
  app.use('*', d.permissions.requirePermission('orders:create'))
  const checkout = createCheckoutService(d, core)
  const starter = createOrderStarter(d, core, checkout, createStoreGiftCards(d, core))

  app.post('/', async (c) => {
    const parsed = saleSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = c.get('user').companyId
    const { items, paidBy, preview } = parsed.data
    let who: { id: string; name: string; email: string | null } | null = null
    if (parsed.data.contactId) {
      ;[who] = await db.select({ id: contact.id, name: contact.name, email: contact.email }).from(contact)
        .where(and(eq(contact.id, parsed.data.contactId), eq(contact.companyId, companyId))).limit(1)
      if (!who) return fail(c, 404, 'That customer was not found.')
    }
    // An email typed for the receipt that is one of the store's customers': the sale is theirs (Shopify POS files it under the
    // customer — live test 11/11: it read "Walk-in" with that buyer's email, beside them on Customers). A new email stays a walk-in.
    const typed = (parsed.data.email || '').trim()
    if (!who && typed) {
      ;[who] = await db.select({ id: contact.id, name: contact.name, email: contact.email }).from(contact)
        .where(and(eq(contact.companyId, companyId), ilike(contact.email, typed.replace(/[\\%_]/g, (ch) => '\\' + ch)))).limit(1)
      who = who ?? null
    }
    const email = typed || who?.email || undefined
    const locationId = parsed.data.locationId || null
    if (locationId && !(await storeLocations(db, companyId)).some((l) => l.id === locationId)) return fail(c, 400, "That location is not one of the store's.")
    const pricing = who ? await pricingForContact(db, companyId, who.id) : null
    const r = await starter.start({
      companyId, items, customerEmail: email, delivery: 'pickup', origin: requestOrigin(c), preview: !!preview,
      // A new email becomes the store's customer, as any order with an email does (placeOrder): named by it, not "Walk-in".
      draft: { contactId: who?.id ?? null, customerName: who?.name ?? (typed || 'Walk-in'), pricing, note: 'Sold at the counter', paidInPerson: paidBy, counter: true, locationId },
    })
    if (!r.ok) return fail(c, r.status, r.error, r.code)
    if (preview) return one(c, { preview: (r as any).preview })
    // Handed over at the counter: picked up now.
    const now = new Date()
    const [order] = await db.update(storeOrder).set({ status: 'picked_up', fulfilledAt: now, deliveredAt: now, pickedUpAt: now, updatedAt: now } as any)
      .where(and(eq(storeOrder.id, r.orderId), eq(storeOrder.companyId, companyId), eq(storeOrder.status, 'paid'))).returning()
    const made = order ?? (await db.select().from(storeOrder).where(and(eq(storeOrder.id, r.orderId), eq(storeOrder.companyId, companyId))).limit(1))[0]
    await audit.log({ action: audit.ACTIONS.CREATE, entity: 'order', entityId: made.id, entityName: made.orderNumber,
      metadata: { description: `Sold at the counter${who ? ` to ${who.name}` : ''}, paid by ${PAID_BY_WORDS[paidBy]}` }, req: c })
    return one(c, { order: made, receiptTo: email ?? null }, 201)
  })

  return app
}

// Orders the owner makes for a customer, at /api/admin/draft-orders (2026-10-24, the store upgrade) — Shopify's draft
// order: pick the customer and the items, the store prices them (at the customer's group prices: a wholesale customer
// gets wholesale prices, ../catalog/groupPricing.ts), and the customer is emailed a link to pay. The link reopens a
// payment page each time it is opened (checkout's resumeCheckout), so it does not expire with one provider session; the
// order stays pending, off the abandoned-cart reminders and the stale-cart sweep, until it is paid or the owner cancels it.
//
// orders:create: the manager's and the owner's (the shared matrix's orders:*); staff pack orders, they do not price them.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { contact } from '../../../db/schema/index.ts'
import { storeOrder, storeOrderItem } from '../../../db/schema/store.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import { pricingForContact } from '../catalog/groupPricing.ts'
import { createCheckoutService, requestOrigin } from '../checkout/checkoutService.ts'
import { createOrderStarter } from '../checkout/placeOrder.ts'
import { emailItems, emailOrder } from '../emails.ts'
import { createStoreGiftCards } from '../giftCards.ts'

const draftSchema = z.object({
  contactId: z.string().min(1, 'Choose the customer'),
  items: z.array(z.object({ sku: z.string().min(1), quantity: z.number().int().positive().max(9999) })).min(1, 'Add at least one item').max(100),
  delivery: z.enum(['ship', 'pickup']).default('ship'),
  shipTo: z.object({ country: z.string().max(2), state: z.string().max(16) }).partial().optional(),
  note: z.string().trim().max(1000).optional().nullable(),
  /** Email the customer the link to pay now (default), or only make the order. */
  send: z.boolean().default(true),
})

export function createDraftOrderRoutes(d: CrmDeps, core: StoreCore) {
  const { db, audit } = d
  const app = new Hono<AppEnv>()
  app.use('*', d.permissions.requirePermission('orders:create'))
  const checkout = createCheckoutService(d, core)
  const starter = createOrderStarter(d, core, checkout, createStoreGiftCards(d, core))

  /** Email the customer their order and the link to pay it. */
  const sendInvoice = async (orderId: string, companyId: string, payUrl: string): Promise<boolean> => {
    const [o] = await db.select().from(storeOrder).where(and(eq(storeOrder.id, orderId), eq(storeOrder.companyId, companyId))).limit(1)
    if (!o) return false
    const items = await db.select().from(storeOrderItem).where(eq(storeOrderItem.orderId, o.id))
    const co = await core.shop()
    return core.mail(o.customerEmail, 'storeInvoice', { order: emailOrder(o), items: emailItems(items), supportEmail: co?.email, payUrl }, co?.email)
  }

  app.post('/', async (c) => {
    const parsed = draftSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = c.get('user').companyId
    const [who] = await db.select({ id: contact.id, name: contact.name, email: contact.email }).from(contact)
      .where(and(eq(contact.id, parsed.data.contactId), eq(contact.companyId, companyId))).limit(1)
    if (!who) return fail(c, 404, 'That customer was not found.')
    if (!who.email) return fail(c, 400, `${who.name} has no email address to send the order to. Add one on their page first.`, 'validation_failed', { contactId: 'This customer has no email' })
    const pricing = await pricingForContact(db, companyId, who.id)
    const r = await starter.start({
      companyId, items: parsed.data.items, customerEmail: who.email, delivery: parsed.data.delivery, shipTo: parsed.data.shipTo,
      origin: requestOrigin(c), draft: { contactId: who.id, customerName: who.name, pricing, note: parsed.data.note ?? null },
    })
    if (!r.ok) return fail(c, r.status, r.error, r.code)
    const [order] = await db.select().from(storeOrder).where(and(eq(storeOrder.id, r.orderId), eq(storeOrder.companyId, companyId))).limit(1)
    const sent = parsed.data.send ? await sendInvoice(order.id, companyId, r.url) : false
    await audit.log({
      action: audit.ACTIONS.CREATE, entity: 'order', entityId: order.id, entityName: order.orderNumber,
      metadata: { description: `Order made for ${who.name}${pricing ? ` at ${pricing.name} prices` : ''}${sent ? ', link to pay emailed' : ''}` }, req: c,
    })
    return one(c, { order, payUrl: r.url, sent, group: pricing ? { id: pricing.groupId, name: pricing.name } : null }, 201)
  })

  // Email the link again (the customer lost it). Only while the order is still waiting to be paid.
  app.post('/:id/send', async (c) => {
    const companyId = c.get('user').companyId
    const [o] = await db.select().from(storeOrder).where(and(eq(storeOrder.id, c.req.param('id')), eq(storeOrder.companyId, companyId))).limit(1)
    if (!o || o.source !== 'draft') return fail(c, 404, 'Not found')
    if (o.status !== 'pending' || !o.recoveryToken) return fail(c, 409, `This order is ${o.status === 'pending' ? 'missing its link' : o.status}; there is nothing to pay.`, 'not_pending')
    const payUrl = `${requestOrigin(c).replace(/\/+$/, '')}/api/public/recover/${o.recoveryToken}`
    const sent = await sendInvoice(o.id, companyId, payUrl)
    if (!sent) return fail(c, 502, 'The email could not be sent. Try again in a minute.', 'email_failed')
    await audit.log({ action: audit.ACTIONS.UPDATE, entity: 'order', entityId: o.id, entityName: o.orderNumber, metadata: { description: 'Link to pay emailed again' }, req: c })
    return one(c, { sent: true, payUrl })
  })

  return app
}

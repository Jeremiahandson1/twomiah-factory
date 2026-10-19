// ADAPTED COPY of tests/store/order-receipt.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged
// except the lines marked "unified:": the shop's name and support email are the company row's; the store's messages go
// through the app's one email service, which sends over the provider's SMTP (nodemailer), so the provider is stubbed at
// the transport instead of at Resend's HTTP address — nothing leaves either way; the order summary is the order itself
// (RULEBOOK §3, was { order }); and the shipped email and the thank-you page are read where they moved. The original
// keeps running against the template; tests/unified/harness/unified-divergences.ts names the assertions this copy
// stands in for.
//
// crm-store — the shopper's receipt and thank-you page show the discount, so the lines add up to the total. (10/15)
//
// E2E Run 2: "It lists Subtotal $37.00, Shipping $5.00, Tax $2.41, Total $40.71 with no discount line, so the lines add
// to $44.41, not $40.71." The order summary the thank-you page reads, the receipt and the shipped email all left out
// discountCents. And a refunded order's link still said "is confirmed". Email is stubbed (Resend); nothing leaves.
process.env.RESEND_API_KEY = 'test-resend'
import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import nodemailer from 'nodemailer' /* unified: the app's email service sends through a nodemailer transport (server/core/email.ts) */
import { eq } from 'drizzle-orm' /* unified: the company row is updated by id */

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}
const mails: any[] = []
;(nodemailer as any).createTransport = () => ({ sendMail: async (m: any) => { mails.push(m); return { messageId: 'm' } } }) /* unified: the provider stubbed at its transport (RESEND_API_KEY picks Resend's SMTP, smtp.resend.com), before the app is built — the message as it would leave, html and text, is kept and never sent */

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { storeSettings, orders, orderItems, company } = await import('./db/schema.ts') /* unified: company — the business */
const [co] = await db.select().from(company).limit(1) /* unified: the database's one company */
await db.update(company).set({ name: 'Receipt Shop', email: 'owner@receipt.test' } as any).where(eq(company.id, co.id)) /* unified: the shop's name and support email are company.name / company.email */
await db.insert(storeSettings).values({ currency: 'usd' } as any) /* unified: only the commerce settings stay on store_settings */
// The E2E Run 2 order: Mug $15 + Large Shirt $22, TEST10 −$3.70, shipping $5.00, tax $2.41 → $40.71.
const [o] = await db.insert(orders).values({
  orderNumber: 'ORD-RCPT1', provider: 'square', providerSessionId: 'sq_ord_1', status: 'paid', customerEmail: 'shopper@example.com',
  subtotalCents: 3700, discountCents: 370, discountCode: 'TEST10', loyaltyDiscountCents: 0, shippingCents: 500, taxCents: 241, totalCents: 4071, currency: 'usd',
} as any).returning()
await db.insert(orderItems).values([
  { orderId: o.id, productName: 'Test Mug', variantName: 'Default', sku: 'M1', unitPriceCents: 1500, quantity: 1, lineTotalCents: 1500 },
  { orderId: o.id, productName: 'Test Shirt', variantName: 'Large', sku: 'S1', unitPriceCents: 2200, quantity: 1, lineTotalCents: 2200 },
] as any)

const app = new Hono()
app.route('/api/public', (await import('./src/routes/public.ts')).default)
const summary = async () => (await (await app.request('/api/public/order-summary?ref=' + o.id)).json() as any) /* unified: one record is the reply itself (RULEBOOK §3; was { order }) */

{
  const s = await summary()
  check('the order summary carries the discount, its code and the loyalty share', s.discountCents === 370 && s.discountCode === 'TEST10' && s.loyaltyDiscountCents === 0, s)
  check('…so subtotal − discount + shipping + tax = total', s.subtotalCents - s.discountCents + s.shippingCents + s.taxCents === s.totalCents, s)
}
{
  const { discountLines, emailOrder } = await import('./src/services/storeEmails.ts') /* unified: the store's messages are server/crm/store/emails.ts (emailOrder is the order as the messages read it) */
  const { crmDeps } = await import('./src/services/crmDeps.ts') /* unified: the app's own dependencies */
  const { createStoreCore } = await import('../../server/crm/store/core.ts') /* unified: the store core's mail() sends the store's messages (the sandbox sits in apps/unified/.suite) */
  const core = createStoreCore(crmDeps) /* unified: built from the app's dependencies: the app's one email service */
  const [row] = await db.select().from(orders)
  await core.mail(row.customerEmail, 'storeOrderConfirmation', { order: emailOrder({ ...row, customerName: null, shippingAddress: null }), items: [{ productName: 'Test Mug', variantName: 'Default', quantity: 1, lineTotalCents: 1500 }], supportEmail: 'owner@receipt.test' }, 'owner@receipt.test') /* unified: the confirmation as checkout sends it (checkoutService finalizeOrder: core.mail 'storeOrderConfirmation'); the shop's name is the company's, read when the message is built */
  const html = mails.at(-1)?.html || ''
  check('the receipt shows "Discount (TEST10) −$3.70" between the subtotal and the total', /Discount \(TEST10\)/.test(html) && /−\$3\.70/.test(html) && html.indexOf('Subtotal') < html.indexOf('Discount (TEST10)') && html.indexOf('Discount (TEST10)') < html.indexOf('Total'), html.slice(0, 200))
  const both = discountLines({ discountCents: 900, loyaltyDiscountCents: 500, discountCode: 'SAVE4' })
  check('a code and a loyalty reward are two lines, adding to the whole discount', JSON.stringify(both) === JSON.stringify([{ label: 'Discount (SAVE4)', cents: 400 }, { label: 'Loyalty reward', cents: 500 }]), both)
  check('no discount → no lines', discountLines({ discountCents: 0 }).length === 0)
  // Every store email carries a plain-text part (the E2E Run 2 invites landed in spam; HTML-only scores as a blast).
  const text = mails.at(-1)?.text || ''
  check('the receipt goes out with a plain-text part that still has the money lines', /Subtotal/.test(text) && /Discount \(TEST10\)/.test(text) && /\$40\.71/.test(text) && !/<[a-z]/i.test(text), text.slice(0, 300))
  const { htmlToText } = await import('./src/services/storeEmails.ts') /* unified: the store's messages module */
  const link = htmlToText('<p>Hi</p><p><a href="https://shop.test/reset?token=invite_x&amp;invite=1">Accept invitation</a></p>')
  check('a link keeps its working address in the text part (& not &amp;)', link.includes('Accept invitation: https://shop.test/reset?token=invite_x&invite=1') && !link.includes('&amp;'), link)
  check('a loyalty share larger than the total cannot make a negative line', discountLines({ discountCents: 300, loyaltyDiscountCents: 999 }).every((l: any) => l.cents > 0))
}
{
  // The shipped email is built from the stored order, in routes/orders.ts.
  const core = readFileSync(new URL('../../server/crm/store/core.ts', import.meta.url), 'utf8') /* unified: the shipped email is the store core's notifyShipped, which hands the message emailOrder(order) */
  const mailsSrc = readFileSync(new URL('../../server/crm/store/emails.ts', import.meta.url), 'utf8') /* unified: …and emailOrder (server/crm/store/emails.ts) is the order as every store message reads it */
  check('the shipped email is given the discount too', /'storeOrderShipped', \{ order: emailOrder\(order\)/.test(core) && /discountCents: o\.discountCents, loyaltyDiscountCents: o\.loyaltyDiscountCents, discountCode: o\.discountCode/.test(mailsSrc)) /* unified: the same fields, passed through emailOrder */
}
{
  // The storefront's thank-you page (website-store/views/checkout-success.ejs) — read, since ejs is not installed here.
  // The suite runs in a sandbox copy of crm-store; the storefront is read from the repo itself.
  const ROOT = (process.env.FACTORY_ROOT || '').replace(/\\/g, '/').replace(/\/?$/, '/')
  const view = readFileSync(ROOT + 'apps/unified/site/views/sections/shop/receipt.ejs', 'utf8') /* unified: the thank-you page is the site's shop receipt section (sections/shop/receipt.ejs, from website-store's checkout-success.ejs) */
  check('the thank-you page shows a Discount line and a Loyalty reward line', /Discount<%= o\.discountCode/.test(view) && /Loyalty reward/.test(view))
  check('…and a refunded or cancelled order says so instead of "confirmed"', /This order was refunded/.test(view) && /This order was cancelled/.test(view))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)

// crm-store — the shopper's receipt and thank-you page show the discount, so the lines add up to the total. (10/15)
//
// E2E Run 2: "It lists Subtotal $37.00, Shipping $5.00, Tax $2.41, Total $40.71 with no discount line, so the lines add
// to $44.41, not $40.71." The order summary the thank-you page reads, the receipt and the shipped email all left out
// discountCents. And a refunded order's link still said "is confirmed". Email is stubbed (Resend); nothing leaves.
process.env.RESEND_API_KEY = 'test-resend'
import { Hono } from 'hono'
import { readFileSync } from 'node:fs'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}
const mails: any[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  if (String(input?.url ?? input) !== 'https://api.resend.com/emails') return realFetch(input, init)
  mails.push(JSON.parse(init.body)); return new Response('{"id":"m"}', { status: 200 })
}) as any

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { storeSettings, orders, orderItems } = await import('./db/schema.ts')
await db.insert(storeSettings).values({ companyName: 'Receipt Shop', currency: 'usd', supportEmail: 'owner@receipt.test' } as any)
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
const summary = async () => (await (await app.request('/api/public/order-summary?ref=' + o.id)).json() as any).order

{
  const s = await summary()
  check('the order summary carries the discount, its code and the loyalty share', s.discountCents === 370 && s.discountCode === 'TEST10' && s.loyaltyDiscountCents === 0, s)
  check('…so subtotal − discount + shipping + tax = total', s.subtotalCents - s.discountCents + s.shippingCents + s.taxCents === s.totalCents, s)
}
{
  const { sendOrderConfirmation, discountLines } = await import('./src/services/email.ts')
  const [row] = await db.select().from(orders)
  await sendOrderConfirmation({ order: { ...row, customerName: null, shippingAddress: null } as any, items: [{ productName: 'Test Mug', variantName: 'Default', quantity: 1, lineTotalCents: 1500 }], storeName: 'Receipt Shop' })
  const html = mails.at(-1)?.html || ''
  check('the receipt shows "Discount (TEST10) −$3.70" between the subtotal and the total', /Discount \(TEST10\)/.test(html) && /−\$3\.70/.test(html) && html.indexOf('Subtotal') < html.indexOf('Discount (TEST10)') && html.indexOf('Discount (TEST10)') < html.indexOf('Total'), html.slice(0, 200))
  const both = discountLines({ discountCents: 900, loyaltyDiscountCents: 500, discountCode: 'SAVE4' })
  check('a code and a loyalty reward are two lines, adding to the whole discount', JSON.stringify(both) === JSON.stringify([{ label: 'Discount (SAVE4)', cents: 400 }, { label: 'Loyalty reward', cents: 500 }]), both)
  check('no discount → no lines', discountLines({ discountCents: 0 }).length === 0)
  check('a loyalty share larger than the total cannot make a negative line', discountLines({ discountCents: 300, loyaltyDiscountCents: 999 }).every((l: any) => l.cents > 0))
}
{
  // The shipped email is built from the stored order, in routes/orders.ts.
  const src = readFileSync(new URL('./src/routes/orders.ts', import.meta.url), 'utf8')
  check('the shipped email is given the discount too', /discountCents: order\.discountCents, loyaltyDiscountCents: order\.loyaltyDiscountCents, discountCode: order\.discountCode/.test(src))
}
{
  // The storefront's thank-you page (website-store/views/checkout-success.ejs) — read, since ejs is not installed here.
  // The suite runs in a sandbox copy of crm-store; the storefront is read from the repo itself.
  const ROOT = (process.env.FACTORY_ROOT || '').replace(/\\/g, '/').replace(/\/?$/, '/')
  const view = readFileSync(ROOT + 'templates/website-store/views/checkout-success.ejs', 'utf8')
  check('the thank-you page shows a Discount line and a Loyalty reward line', /Discount<%= o\.discountCode/.test(view) && /Loyalty reward/.test(view))
  check('…and a refunded or cancelled order says so instead of "confirmed"', /This order was refunded/.test(view) && /This order was cancelled/.test(view))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)

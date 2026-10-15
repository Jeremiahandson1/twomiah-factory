// crm-store's Square adapter, against Square's real order shape (read back from the E2E Run 2 sandbox order, 10/15).
//   1. The discount comes off the goods only — ORDER scope spread it over tax and shipping ("Sales tax $2.21,
//      Shipping $4.58" for a store that charged $2.41 and $5.00).
//   2. The shopper's name, email, phone and address are read from the order's shipment recipient — the payment carries
//      none of them, so every Square order arrived with a blank name and "No shipping address".
// Square's API is stubbed; nothing leaves the machine.
let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const sent: any[] = []
const ORDER = {
  id: 'ord_1', reference_id: 'ref', state: 'OPEN', tenders: [{ payment_id: 'pay_1' }],
  fulfillments: [{ type: 'SHIPMENT', shipment_details: { recipient: { display_name: 'Pat Shopper', email_address: 'pat@example.com', phone_number: '+17155550100', address: { address_line_1: '1 Main St', locality: 'Eau Claire', administrative_district_level_1: 'WI', postal_code: '54701', country: 'US' } } } }],
}
const PAYMENT = { id: 'pay_1', order_id: 'ord_1', status: 'COMPLETED', amount_money: { amount: 4071, currency: 'USD' } }
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  if (!url.startsWith('https://connect.squareupsandbox.com')) return realFetch(input, init)
  if (init?.body) sent.push({ url, body: JSON.parse(init.body) })
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
  if (url.endsWith('/v2/online-checkout/payment-links')) return json({ payment_link: { url: 'https://sandbox.square.link/x', order_id: 'ord_1' } })
  if (url.includes('/v2/orders/')) return json({ order: ORDER })
  if (url.includes('/v2/payments/')) return json({ payment: PAYMENT })
  return json({})
}) as any

const { SquareProvider } = await import('./src/payments/square.ts')
const sq = new SquareProvider({ secretKey: 'sandbox-token', publishableKey: 'LOC1', webhookSecret: 'sigkey', mode: 'test' } as any)

{
  await sq.createCheckout({
    lineItems: [{ name: 'Test Mug — Default', quantity: 1, unitPriceCents: 1500 }, { name: 'Test Shirt — Large', quantity: 1, unitPriceCents: 2200 }],
    currency: 'usd', taxCents: 241, shippingCents: 500, discountCents: 370, clientReferenceId: 'ref', successUrl: 'https://s/ok', cancelUrl: 'https://s/no', collectShippingAddress: true,
  } as any)
  const order = sent.at(-1)?.body?.order
  const goods = order.line_items.filter((l: any) => !['Sales tax', 'Shipping'].includes(l.name))
  const extras = order.line_items.filter((l: any) => ['Sales tax', 'Shipping'].includes(l.name))
  check('the discount is scoped to line items, not the whole order', order.discounts?.[0]?.scope === 'LINE_ITEM' && order.discounts[0].amount_money.amount === 370, order.discounts)
  check('…applied to every product line', goods.length === 2 && goods.every((l: any) => l.applied_discounts?.[0]?.discount_uid === 'discount'), goods)
  check('…and NOT to the tax or shipping lines — Square keeps $2.41 and $5.00 as charged', extras.length === 2 && extras.every((l: any) => !l.applied_discounts), extras)
}
{
  sent.length = 0
  await sq.createCheckout({ lineItems: [{ name: 'Mug', quantity: 2, unitPriceCents: 1500 }], currency: 'usd', taxCents: 0, shippingCents: 0, discountCents: 0, clientReferenceId: 'r', successUrl: 's', cancelUrl: 'c', collectShippingAddress: false } as any)
  const order = sent.at(-1)?.body?.order
  check('no discount → no discount fields at all', !order.discounts && order.line_items.every((l: any) => !l.applied_discounts), order)
}
{
  const r: any = await sq.retrieveSession('ord_1')
  check('the success page finds who the order is for — name, email, phone from the shipment recipient', r.customerName === 'Pat Shopper' && r.customerEmail === 'pat@example.com' && r.customerPhone === '+17155550100', r)
  check('…and the shipping address', r.shippingAddress?.line1 === '1 Main St' && r.shippingAddress?.city === 'Eau Claire' && r.shippingAddress?.state === 'WI' && r.shippingAddress?.postalCode === '54701', r.shippingAddress)
}
{
  const crypto = await import('node:crypto')
  process.env.BACKEND_URL = ''
  const sqw = new SquareProvider({ secretKey: 't', publishableKey: 'LOC1', webhookSecret: 'sigkey', mode: 'test' } as any)
  const rawBody = JSON.stringify({ data: { object: { payment: PAYMENT } } })
  const signature = crypto.createHmac('sha256', 'sigkey').update('/api/public/webhooks/payment' + rawBody).digest('base64')
  const r: any = await sqw.verifyAndParseWebhook({ rawBody, signature } as any)
  check('the webhook (which carries the payment only) also looks up the order for who it is for', r.type === 'paid' && r.customerName === 'Pat Shopper' && r.shippingAddress?.line1 === '1 Main St', r)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)

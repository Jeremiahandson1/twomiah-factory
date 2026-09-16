// CI guard: a Checkout Session or Payment Link payment is recorded on its invoice. The customer's
// payment is a PaymentIntent Stripe creates for the session/link; payment_intent.succeeded delivers
// THAT object, and it only knows the invoice when payment_intent_data.metadata says so — session/link
// metadata alone left every such payment unrecorded. Every charge amount comes from the shared
// invoiceBalance (refund-aware); the routes' balance checks read a real value, not inv.balance
// (no such column). (#157)
//   bun scripts/check-checkout-recording.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const stripe = read('packages/tenant-backend/src/payments/stripe.ts')
const between = (from: string, to: string) => { const a = stripe.indexOf(from); const b = stripe.indexOf(to, a + 1); return a < 0 || b < 0 ? '' : stripe.slice(a, b) }

if (!/import \{ round2, invoiceBalance \} from '\.\.\/invoicing\/money'/.test(stripe)) fail('payments/stripe.ts must import invoiceBalance from the money model')
if (!/const invoiceOwed = \(invoiceRow: any\) => invoiceBalance\(invoiceRow\)/.test(stripe)) fail('invoiceOwed must be the shared invoiceBalance')
if (/Number\(invoiceRow\.total\) - Number\(invoiceRow\.amountPaid/.test(stripe)) fail('no charge path may compute total − amountPaid (refund-blind) any more')
if (/inv\.balance/.test(stripe)) fail('routes must not read inv.balance (not a column — the check never fired)')

const session = between('async function createCheckoutSession(', 'async function createBookingDepositIntent(')
if (!/payment_intent_data: \{\s*metadata: \{\s*invoice_id: invoiceRow\.id,/.test(session)) fail('createCheckoutSession must put invoice_id on the PaymentIntent (payment_intent_data.metadata)')
if (!/invoiceOwed\(invoiceRow\)/.test(session) || !/Invoice has no balance due/.test(session)) fail('createCheckoutSession must price the refund-aware balance and refuse $0')

const link = between('async function createPaymentLink(', 'const isStripePayment')
if (!link) fail('createPaymentLink section not found')
if (!/payment_intent_data: \{\s*metadata: \{\s*invoice_id: invoiceRow\.id,/.test(link)) fail('createPaymentLink must put invoice_id on the PaymentIntent (payment_intent_data.metadata)')
if (!/invoiceOwed\(invoiceRow\)/.test(link) || !/Invoice has no balance due/.test(link)) fail('createPaymentLink must price the refund-aware balance and refuse $0')

for (const fn of ['async function createPaymentIntent(', 'async function createPartialPaymentIntent(', 'async function chargeInvoiceOffSession(']) {
  const body = between(fn, '\n  }\n')
  if (!/invoiceOwed\(invoiceRow\)/.test(body)) fail(`${fn.trim()} must charge the refund-aware balance (invoiceOwed)`)
}

// checkout.session.completed stays informational: recording there too would double-count the intent
const hook = between('async function handleCheckoutComplete(', 'async function handleChargeRefunded(')
if (/recordInvoicePayment|db\s*\.insert/.test(hook)) fail('handleCheckoutComplete must not record money (payment_intent.succeeded does)')

for (const [route, end] of [["app.post('/checkout-session'", "app.post('/payment-link'"], ["app.post('/payment-link'", "app.post('/refund'"]]) {
  const body = between(route, end)
  if (!/if \(invoiceBalance\(inv\) <= 0\) \{/.test(body)) fail(`${route} must refuse an invoice with no balance due before asking Stripe`)
}
for (const route of ["app.post('/payment-intent'", "app.post('/portal/payment-intent'"]) {
  const body = between(route, '\n  })\n')
  if (!/amount < invoiceBalance\(inv\)/.test(body)) fail(`${route} must take the partial path against the real balance`)
}

if (failed) { console.error(`\ncheckout recording: ${failed} check(s) FAILED`); process.exit(1) }
console.log('checkout recording: Checkout + Payment Link intents carry the invoice; every charge uses the refund-aware balance; route balance checks are real')

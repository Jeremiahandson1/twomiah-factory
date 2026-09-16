// CI guard: every Stripe.js initialisation response carries the publishable key, and the portal passes
// the connected account through to loadStripe.
//  The portal invoice payment form refused to render in all 7 CRMs ("Card payments are not set up yet"):
//  it requires body.publishableKey, and the invoice payment-intent responses never included it (the
//  booking-deposit and setup-intent ones did). And a business charging on a connected account must
//  initialise Stripe.js with that account or its client secrets are rejected. (#153)
//   bun scripts/check-portal-payment-init.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const svc = read('packages/tenant-backend/src/payments/stripe.ts')
const fnBody = (name: string) => { const i = svc.indexOf(`async function ${name}(`); return i < 0 ? '' : svc.slice(i, svc.indexOf('\n  }\n', i)) }
for (const fn of ['createPaymentIntent', 'createPartialPaymentIntent', 'createSetupIntent', 'createBookingDepositIntent']) {
  const body = fnBody(fn)
  if (!body) { fail(`${fn} not found in shared payments/stripe.ts`); continue }
  if (!/publishableKey: process\.env\.STRIPE_PUBLISHABLE_KEY \|\| ''/.test(body)) fail(`${fn} must return publishableKey (what the browser initialises Stripe.js with)`)
}

const form = read('packages/tenant-ui/src/portal/PaymentForm.tsx')
if (!/export const getStripe = \(publishableKey: string, stripeAccount\?: string \| null\)/.test(form)) fail('portal getStripe must accept (publishableKey, stripeAccount?)')
if (!/loadStripe\(publishableKey, stripeAccount \? \{ stripeAccount \} : undefined\)/.test(form)) fail('portal getStripe must pass { stripeAccount } to loadStripe when a connected account is given')
if (!/getStripe\(body\.publishableKey, body\.stripeAccount\)/.test(form)) fail('PaymentForm must forward body.stripeAccount to getStripe')
const methods = read('packages/tenant-ui/src/portal/PortalPaymentMethods.tsx')
if (!/getStripe\(body\.publishableKey, body\.stripeAccount\)/.test(methods)) fail('PortalPaymentMethods must forward body.stripeAccount to getStripe')

if (failed) { console.error(`\nportal payment init: ${failed} check(s) FAILED`); process.exit(1) }
console.log('portal payment init: every Stripe.js init response carries publishableKey; portal forwards the connected account')

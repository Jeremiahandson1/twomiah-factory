// CI guard: Stripe has ONE implementation (packages/tenant-backend/src/payments/stripe.ts). Each CRM's
// services/stripe.ts and routes/stripe.ts are glue that wires tables/options in — no template may carry
// its own copy of the money logic again (7 drifted copies is how the Connect/webhook/refund bugs hid).
//   bun scripts/check-shared-stripe.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'))

// Dispensary (no Stripe — policy) and homecare (parked) keep their own files and are not vendored here.
const TEMPLATES = ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-restaurant', 'crm-rv', 'crm-salon', 'crm-vet']
const APPOINTMENT_BOOK = new Set(['crm-salon', 'crm-vet'])

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const shared = read('packages/tenant-backend/src/payments/stripe.ts')
if (!/export function createStripeService\(/.test(shared)) fail('shared payments/stripe.ts must export createStripeService')
if (!/export function createStripeRoutes\(/.test(shared)) fail('shared payments/stripe.ts must export createStripeRoutes')
if (!/bookingCalendarKind: 'job' \| 'appointment'/.test(shared)) fail("shared options must declare bookingCalendarKind: 'job' | 'appointment'")
if (!/afterInvoicePayment\?:/.test(shared)) fail('shared options must declare the optional afterInvoicePayment hook')
// One Connect onboarding: integrations.ts (Standard account in company.integrations.stripeAccountId). The
// payments module must not grow a second one (the Express-account path removed in #160).
if (/accounts\.create\(|accountLinks\.create\(|settings\.stripeAccountId|app\.(get|post)\('\/(account-status|onboarding)'/.test(shared)) fail('payments/stripe.ts must not carry its own Connect onboarding — that lives in integrations/integrations.ts')
const index = read('packages/tenant-backend/src/index.ts')
if (!/export \{ createStripeService, createStripeRoutes \} from '\.\/payments\/stripe'/.test(index)) fail('index.ts must export createStripeService + createStripeRoutes')

for (const t of TEMPLATES) {
  const svc = read(`templates/${t}/backend/src/services/stripe.ts`)
  const routes = read(`templates/${t}/backend/src/routes/stripe.ts`)
  if (!/createStripeService\(/.test(svc) || !/from '\.\.\/shared\/index\.ts'/.test(svc)) fail(`${t}/services/stripe.ts must build the service with createStripeService from ../shared`)
  if (/new Stripe\(|paymentIntents\.|webhooks\.construct|refunds\.create/.test(svc)) fail(`${t}/services/stripe.ts carries its own Stripe logic — it must be glue only`)
  const kind = APPOINTMENT_BOOK.has(t) ? 'appointment' : 'job'
  if (!new RegExp(`bookingCalendarKind: '${kind}'`).test(svc)) fail(`${t}/services/stripe.ts must pass bookingCalendarKind: '${kind}'`)
  // only the events CRM passes the hook: since #171 it books the date (bookOnDeposit), then moves the due date
  if (t === 'crm-restaurant' ? !/afterInvoicePayment: async \(invoiceId: string\) =>[\s\S]*bookOnDeposit\([\s\S]*await syncEventInvoiceDueDate\(invoiceId\)/.test(svc) : /afterInvoicePayment/.test(svc)) fail(`${t}/services/stripe.ts afterInvoicePayment wiring is wrong (only crm-restaurant passes it: bookOnDeposit, then syncEventInvoiceDueDate)`)
  // Every named export the rest of the template imports (agreements, booking) must still be there.
  for (const name of ['createBookingDepositIntent', 'listSavedPaymentMethods', 'chargeInvoiceOffSession', 'constructWebhookEvent', 'handleWebhook']) {
    if (!svc.includes(name)) fail(`${t}/services/stripe.ts must re-export ${name}`)
  }
  if (!/export default service/.test(svc)) fail(`${t}/services/stripe.ts must default-export the service`)
  if (!/createStripeRoutes\(/.test(routes) || !/from '\.\.\/shared\/index\.ts'/.test(routes)) fail(`${t}/routes/stripe.ts must build its router with createStripeRoutes from ../shared`)
  if (/app\.(get|post)\(/.test(routes)) fail(`${t}/routes/stripe.ts defines its own routes — it must be glue only`)
}

if (failed) { console.error(`\nshared stripe: ${failed} check(s) FAILED`); process.exit(1) }
console.log('shared stripe: one implementation in packages/tenant-backend; all 7 CRMs are glue with the right calendar kind')

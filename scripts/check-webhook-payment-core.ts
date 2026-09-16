// CI guard: money is recorded on an invoice ONE way — recordInvoicePayment (locked, refund-aware,
// status via recomputeStatus) — by the interactive route AND the Stripe webhook. The webhook once did
// its own math (total − paid, refund-blind, no lock, no void check) and inserted a second payment on
// every Stripe retry. (#155)
//   bun scripts/check-webhook-payment-core.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const inv = read('packages/tenant-backend/src/invoicing/invoices.ts')
if (!/export async function recordInvoicePayment\(/.test(inv)) fail('invoices.ts must export recordInvoicePayment')
const core = inv.slice(inv.indexOf('export async function recordInvoicePayment('), inv.indexOf('\nexport function createInvoiceRoutes('))
if (!/FOR UPDATE/.test(core)) fail('recordInvoicePayment must lock the invoice row (FOR UPDATE)')
if (!/invoiceBalance\(/.test(core) || !/recomputeStatus\(/.test(core)) fail('recordInvoicePayment must use invoiceBalance + recomputeStatus (the refund-aware model)')
if (!/idempotentByReference/.test(core) || !/eq\(t\.payment\.reference, input\.reference\)/.test(core)) fail('recordInvoicePayment must find an existing payment by reference when idempotentByReference is set')
if (!/allowOverpayment/.test(core)) fail('recordInvoicePayment must offer allowOverpayment for money a processor already collected')
if (!/status === 'void'/.test(core) || !/status === 'refunded'/.test(core)) fail('recordInvoicePayment must refuse void and refunded invoices')
// the route body delegates: no second copy of the locked write
const routeStart = inv.indexOf("app.post('/:id/payments'"); const routeEnd = inv.indexOf("app.post('/:id/void'")
const route = inv.slice(routeStart, routeEnd)
if (!/recordInvoicePayment\(db, t, tips, \{ invoiceId: id, companyId: currentUser\.companyId/.test(route)) fail('POST /:id/payments must call recordInvoicePayment with the company scope')
if (/tx\.insert\(t\.payment\)/.test(route) || /FOR UPDATE/.test(route)) fail('POST /:id/payments must not carry its own locked write any more')

const stripe = read('packages/tenant-backend/src/payments/stripe.ts')
const hook = stripe.slice(stripe.indexOf('async function handlePaymentSuccess('), stripe.indexOf('async function handlePaymentFailed('))
if (!/recordInvoicePayment\(db, \{ invoice, payment \}, false, \{/.test(hook)) fail('handlePaymentSuccess must record through recordInvoicePayment')
if (!/reference: paymentIntent\.id/.test(hook) || !/idempotentByReference: true/.test(hook)) fail('webhook payments must be idempotent by PaymentIntent id')
if (!/allowOverpayment: true/.test(hook)) fail('webhook payments must record what Stripe collected (allowOverpayment)')
if (!/paidAt: paymentIntent\.created \? new Date\(paymentIntent\.created \* 1000\)/.test(hook)) fail("webhook payments must be dated at Stripe's timestamp")
if (/newBalance <= 0 \? 'paid' : 'partial'/.test(hook) || /db\s*\.insert\(payment\)/.test(hook)) fail('handlePaymentSuccess must not keep its own status math or payment insert')
if (!/outcome\.duplicate/.test(hook)) fail('handlePaymentSuccess must report a retried delivery as duplicate')

if (failed) { console.error(`\nwebhook payment core: ${failed} check(s) FAILED`); process.exit(1) }
console.log('webhook payment core: route + Stripe webhook record money through one locked, refund-aware, idempotent core')

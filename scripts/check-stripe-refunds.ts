// CI guard: a refund is recorded on an invoice ONE way — recordInvoiceRefund (locked, recomputeStatus,
// idempotent by reference) — by the interactive route, the owner's Stripe refund call AND the
// charge.refunded webhook. The Stripe path once had its own status math ('refunded' when refunded ≥
// paid, closing a sale whose deposit was returned), the /refund route checked a column that does not
// exist (always 400), and dashboard refunds never reached the CRM. (#156)
//   bun scripts/check-stripe-refunds.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'))
const raw = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// ── the core ────────────────────────────────────────────────────────────────────────────────────
const inv = read('packages/tenant-backend/src/invoicing/invoices.ts')
if (!/export async function recordInvoiceRefund\(/.test(inv)) fail('invoices.ts must export recordInvoiceRefund')
const core = inv.slice(inv.indexOf('export async function recordInvoiceRefund('), inv.indexOf('\nasync function healRefundedStatus') > 0 ? inv.indexOf('\nasync function healRefundedStatus') : inv.indexOf('\nexport function createInvoiceRoutes('))
if (!/FOR UPDATE/.test(core)) fail('recordInvoiceRefund must lock the invoice row (FOR UPDATE)')
if (!/recomputeStatus\(/.test(core)) fail('recordInvoiceRefund must set the status with recomputeStatus (the refund model)')
if (!/idempotentByReference/.test(core) || !/eq\(t\.payment\.reference, input\.reference\)/.test(core)) fail('recordInvoiceRefund must find an existing refund by reference when idempotentByReference is set')
if (!/still refundable on this invoice/.test(core) || !/has no payments to refund/.test(core) || !/already been refunded/.test(core)) fail('recordInvoiceRefund must keep the three ledger refusals')
// the route delegates: no second copy of the locked write
const routeStart = inv.indexOf("app.post('/:id/refund'"); const routeEnd = inv.indexOf("app.get('/:id/pdf'")
const route = inv.slice(routeStart, routeEnd)
if (!/recordInvoiceRefund\(db, t, \{ invoiceId: id, companyId: currentUser\.companyId/.test(route)) fail('POST /:id/refund must call recordInvoiceRefund with the company scope')
if (/tx\.insert\(t\.payment\)/.test(route) || /FOR UPDATE/.test(route)) fail('POST /:id/refund must not carry its own locked write any more')

// ── the Stripe paths ────────────────────────────────────────────────────────────────────────────
const stripe = read('packages/tenant-backend/src/payments/stripe.ts')
if (!/import \{ recordInvoicePayment, recordInvoiceRefund \} from '\.\.\/invoicing\/invoices'/.test(stripe)) fail('payments/stripe.ts must import recordInvoiceRefund from the invoicing core')
const rec = stripe.slice(stripe.indexOf('async function recordStripeRefund('), stripe.indexOf('async function createRefund('))
if (!/recordInvoiceRefund\(db, \{ invoice, payment \}, \{/.test(rec)) fail('recordStripeRefund must record through recordInvoiceRefund')
if (!/reference: refund\.id/.test(rec) || !/idempotentByReference: true/.test(rec)) fail('Stripe refunds must be idempotent by refund id')
if (!/paidAt: refund\.created \? new Date\(refund\.created \* 1000\)/.test(rec)) fail("Stripe refunds must be dated at Stripe's timestamp")
if (!/method: paymentRow\.method/.test(rec)) fail('a Stripe refund goes back the way the money came in (the payment row\'s method)')

const cr = stripe.slice(stripe.indexOf('async function createRefund('), stripe.indexOf('async function constructWebhookEvent('))
if (/newRefunded >= paid/.test(cr) || /status: newRefunded/.test(cr) || /db\s*\.insert\(payment\)/.test(cr) || /db\s*\.update\(invoice\)/.test(cr)) fail('createRefund must not keep its own status math or ledger writes')
if (!/recordStripeRefund\(refund, paymentRow\)/.test(cr)) fail('createRefund must record through recordStripeRefund')
const ask = cr.indexOf('refunds.create('); const check = cr.indexOf('still refundable on this invoice')
if (ask < 0 || check < 0 || check > ask) fail('createRefund must check the ledger BEFORE asking Stripe to refund')
if (!/isStripePayment\(paymentRow\)/.test(cr)) fail('createRefund must refuse a row that is not a Stripe payment')
if (!/requestOpts\(stripeAccount\)/.test(cr)) fail('createRefund must stay scoped to the connected account')

if (!/case 'charge\.refunded':\s*return handleChargeRefunded\(/.test(stripe)) fail('handleWebhook must route charge.refunded to handleChargeRefunded')
const hook = stripe.slice(stripe.indexOf('async function handleChargeRefunded('), stripe.indexOf('async function createPaymentLink('))
if (!/refunds\.list\(\{ payment_intent: paymentIntentId, limit: 100 \}, requestOpts\(stripeAccount\)\)/.test(hook)) fail('handleChargeRefunded must list the refunds from Stripe on the event\'s account (charge.refunds is not included by default)')
if (!/recordStripeRefund\(refund, paymentRow\)/.test(hook)) fail('handleChargeRefunded must record each refund through recordStripeRefund')
if (!/refund\.status === 'failed' \|\| refund\.status === 'canceled'/.test(hook)) fail('handleChargeRefunded must skip failed / canceled refunds')
if (!/outcome\.duplicate/.test(hook)) fail('handleChargeRefunded must report an already-recorded refund as a duplicate')

const rt = stripe.slice(stripe.indexOf("app.post('/refund'"), stripe.indexOf("app.post('/portal/payment-intent'"))
if (/stripePaymentIntentId/.test(rt)) fail('POST /refund must not check pay.stripePaymentIntentId (no such column — the route was always 400)')
if (!/stripeService\.createRefund\(pay, amount\)/.test(rt) || !/if \(!result\.ok\) return c\.json\(\{ error: result\.error \}, result\.status\)/.test(rt)) fail('POST /refund must answer the service\'s refusal with its status')

// ── the webhook endpoints must be subscribed to the event ───────────────────────────────────────
for (const p of ['apps/api/src/services/deploy.ts', 'apps/api/scripts/register-connect-webhook.ts']) {
  const s = read(p)
  if (!/'payment_intent\.succeeded', 'payment_intent\.payment_failed', 'checkout\.session\.completed', 'charge\.refunded'/.test(s)) fail(`${p} must register charge.refunded alongside the other tenant events`)
}

// ── the refund modals tell the owner what is automatic ──────────────────────────────────────────
for (const p of ['packages/tenant-ui/src/invoicing/InvoicesPage.tsx', 'packages/tenant-ui/src/invoicing/InvoiceDetailPage.tsx']) {
  const s = raw(p)
  if (/issued in your payment processor/.test(s)) fail(`${p} still tells the owner card refunds are only issued in the processor`)
  if (!/Card refunds issued in Stripe are recorded here automatically/.test(s)) fail(`${p} must say Stripe refunds are recorded automatically (so they are not entered twice)`)
  // and which half of the refund model applies to THIS invoice (events T15 B2: the one-size sentence read as re-billing)
  if (!/refundEffectNote\(/.test(s)) fail(`${p} refund modal must show refundEffectNote(total, amountPaid)`)
  if (/The sale stays paid; the refund is recorded on its own line/.test(s)) fail(`${p} still carries the one-size refund sentence`)
}
const uiSrc = raw('packages/tenant-ui/src/invoicing/ui.tsx')
if (!/paid in full: the refund is recorded on its own line and never reopens a balance/.test(uiSrc) || !/part-paid: the refunded amount is owed again, so the balance due goes up by what you refund/.test(uiSrc)) fail('ui.tsx refundEffectNote must state both halves of the refund model')

if (failed) { console.error(`\nstripe refunds: ${failed} check(s) FAILED`); process.exit(1) }
console.log('stripe refunds: route, owner refund and charge.refunded record through one locked, idempotent refund core; endpoints subscribed')

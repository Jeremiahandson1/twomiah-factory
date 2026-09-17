// CI guard: crm-restaurant (events) keeps ONE ledger — an event's deposits and balance live on its invoice.
//  T14 HIGH-1 dashboard said $0 overdue while Reports said $1,140; HIGH-2 a paid $600 deposit never reached
//  Reports "collected"; MED-2 event outstanding went negative; MED-3 a space's hire fee was never charged.
//  All four came from event_payment holding money of its own. This asserts nothing slides back:
//   - event_payment is a schedule: no route writes paidAt/method/reference on it
//   - invoices are raised/re-totalled only through the shared insertInvoice/retotalInvoice (no raw insert)
//   - scheduling money needs invoices:update
//   - the events dashboard takes money from the shared reporting service (== Reports)
//   - payments/refunds/voids on the invoice move the event invoice's due date (routes + Stripe)
//   - schema + migration carry invoice.event_id (unique) and the room-hire marker
//   bun scripts/check-events-ledger.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(new URL(`../templates/crm-restaurant/backend/${p}`, import.meta.url), 'utf8'))
const events = read('src/routes/events.ts')
const ledger = read('src/services/eventLedger.ts')
const dashboard = read('src/routes/dashboard.ts')
const invoicesGlue = read('src/routes/invoices.ts')
const stripe = read('src/services/stripe.ts')
const schema = read('db/schema.ts')
const journal = readFileSync(new URL('../templates/crm-restaurant/backend/db/migrations/meta/_journal.json', import.meta.url), 'utf8')

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const handler = (src: string, verb: string, path: string) => {
  const start = src.indexOf(`app.${verb}('${path}'`)
  if (start < 0) return ''
  const next = src.slice(start + 1).search(/\napp\.(get|post|put|delete)\(/)
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next)
}

// (1) event_payment is the schedule only.
for (const [verb, path] of [['post', '/:id/payments'], ['put', '/:id/payments/:paymentId'], ['delete', '/:id/payments/:paymentId']] as const) {
  const h = handler(events, verb, path)
  if (!h) { fail(`events.ts ${verb.toUpperCase()} ${path} not found`); continue }
  if (!/requirePermission\('invoices:update'\)/.test(h)) fail(`${verb.toUpperCase()} ${path} must require invoices:update (it moves money on the invoice)`)
  if (/paidAt|\bmethod\b|\breference\b/.test(h)) fail(`${verb.toUpperCase()} ${path} must not write paidAt/method/reference — payment is recorded on the invoice`)
}
if (/insert\(eventPayment\)[\s\S]{0,400}paidAt/.test(events)) fail('events.ts must not insert event_payment rows with paidAt')

// (2) invoices raised/re-totalled through the shared code only.
if (!/insertInvoice\(/.test(ledger)) fail('eventLedger must raise invoices with the shared insertInvoice')
if (!/retotalInvoice\(/.test(ledger)) fail('eventLedger must re-total invoices with the shared retotalInvoice')
if (/\.insert\(invoice\)/.test(ledger + events)) fail('no raw insert(invoice) in events code — use insertInvoice')
if (/\.insert\(invoiceLineItem\)/.test(ledger + events)) fail('no raw insert(invoiceLineItem) in events code — use insertInvoice/replaceInvoiceLines')
if (!/FOR UPDATE/.test(ledger)) fail('eventLedger must row-lock the invoice before re-totalling (like the shared payment handler)')

// (3) the menu drives the invoice inside the same transaction; money-below-collected is refused.
for (const [verb, path] of [['post', '/:id/menu'], ['put', '/:id/menu/:lineId'], ['delete', '/:id/menu/:lineId']] as const) {
  const h = handler(events, verb, path)
  if (!/db\.transaction[\s\S]*syncEventInvoice\(tx/.test(h)) fail(`${verb.toUpperCase()} ${path} must sync the event invoice inside its transaction`)
}
const eventPut = handler(events, 'put', '/:id')
if (!/closeEventInvoice\(tx/.test(eventPut) || !/syncEventInvoice\(tx/.test(eventPut)) fail('PUT /events/:id must close (exit statuses) or sync the invoice inside its transaction')
if (!/closeEventInvoice\(tx/.test(handler(events, 'delete', '/:id'))) fail('DELETE /events/:id (cancel) must close the event invoice')

// (4) dashboard money == Reports.
if (!/createReportingService/.test(dashboard) || !/revenueOverview\(/.test(dashboard)) fail('events dashboard money must come from the shared reporting service (revenueOverview)')
if (/eventPayment\.paidAt/.test(dashboard)) fail('events dashboard must not read event_payment.paidAt — paid state comes from the invoice')

// (5) money moving on the invoice moves the event invoice's due date.
if (!/syncEventInvoiceDueDate/.test(invoicesGlue) || !/PAYMENT_RECEIVED/.test(invoicesGlue) || !/INVOICE_UPDATED/.test(invoicesGlue)) fail('routes/invoices.ts must call syncEventInvoiceDueDate on PAYMENT_RECEIVED and INVOICE_UPDATED')
if (!/numbering:\s*INVOICE_NUMBERING/.test(invoicesGlue)) fail('routes/invoices.ts must pass the same INVOICE_NUMBERING event invoices use')
// Since #151 the Stripe logic is shared: the restaurant glue passes the hook as afterInvoicePayment and the
// shared module fires it after a webhook payment AND after a Stripe refund. Since #171 the hook also books
// the date (bookOnDeposit) before moving the due date.
if (!/afterInvoicePayment: async \(invoiceId: string\) =>[\s\S]*await syncEventInvoiceDueDate\(invoiceId\)/.test(stripe)) fail('restaurant services/stripe.ts afterInvoicePayment must end by calling syncEventInvoiceDueDate(invoiceId)')
const sharedStripe = strip(readFileSync(new URL('../packages/tenant-backend/src/payments/stripe.ts', import.meta.url), 'utf8'))
if ((sharedStripe.match(/await afterInvoicePayment\(/g) || []).length < 2) fail('shared payments/stripe.ts must call afterInvoicePayment after a webhook payment AND after a Stripe refund')

// (6) schema + migration.
if (!/eventId:\s*text\('event_id'\)\.references\(\(\) => event\.id/.test(schema)) fail("schema: invoice.eventId → event.id")
if (!/uniqueIndex\('invoice_event_id_idx'\)\.on\(t\.eventId\)/.test(schema)) fail('schema: unique invoice_event_id_idx (one invoice per event)')
const menuItemTable = schema.slice(schema.indexOf('export const eventMenuItem'), schema.indexOf('export const eventTimeline'))
if (!/spaceId:\s*text\('space_id'\)\.references\(\(\) => eventSpace\.id/.test(menuItemTable)) fail('schema: event_menu_item.spaceId (room-hire line marker)')
if (!/"0023_event_invoice_ledger"/.test(journal)) fail('migration journal must include 0023_event_invoice_ledger')

// (7) the event page records money on the invoice, never on the schedule row.
const detailPage = strip(readFileSync(new URL('../templates/crm-restaurant/frontend/src/pages/events/EventDetailPage.tsx', import.meta.url), 'utf8'))
if (/paidAt/.test(detailPage)) fail('EventDetailPage must not send or read paidAt — installment paid state comes from the invoice')
if (!/api\.post\(`\/api\/invoices\/\$\{invoiceId\}\/payments`/.test(detailPage)) fail('EventDetailPage must record payments via POST /api/invoices/:id/payments')
if (!/keepDeposit/.test(detailPage)) fail('EventDetailPage must ask keep-deposit when an event with money collected is cancelled/lost')
const invoicingCfg = readFileSync(new URL('../templates/crm-restaurant/frontend/src/invoicingConfig.ts', import.meta.url), 'utf8')
if (!/extraInvoiceStatuses:\s*\['open'\]/.test(invoicingCfg)) fail("restaurant invoicingConfig must list the 'open' status event invoices use")

if (failed) { console.error(`\nevents ledger: ${failed} check(s) FAILED`); process.exit(1) }
console.log('events ledger: event money lives on the invoice — schedule only on event_payment, shared invoice writes, dashboard == Reports')

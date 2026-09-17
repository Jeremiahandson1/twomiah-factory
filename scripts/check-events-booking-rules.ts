// CI guard: the events booking rules decided after T16 (how venue systems and caterers work):
//   M8  money books the date — a deposit recorded on an enquiry confirms it and holds the room, and is
//       refused while the room is already held; one hook (InvoiceOptions.onPayment → recordInvoicePayment
//       beforeWrite) inside the payment transaction; the Stripe path confirms after the money lands.
//   M9  a package minimum is a billing floor, not an entry limit (packageFloor on add and edit).
//   H3  ONE Team list: the roster plus the login accounts not on it (flagged _source: 'user'), never an
//       either/or fallback; a coordinator must be a login user, said plainly.
//   L1/L2 a past date or an over-capacity room warns and asks, never blocks (confirmEventRisks in both forms).
//   bun scripts/check-events-booking-rules.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// M8 — the hook in the shared payment core
const inv = read('packages/tenant-backend/src/invoicing/invoices.ts')
if (!/onPayment\?: \(tx: any, invoice: any, amount: number\) => Promise<string \| null>/.test(inv)) fail('InvoiceOptions must declare onPayment')
if (!/beforeWrite\?: \(tx: any, invoice: any, amount: number\) => Promise<string \| null>/.test(inv)) fail('RecordPaymentInput must declare beforeWrite')
const core = inv.slice(inv.indexOf('export async function recordInvoicePayment('), inv.indexOf('export interface RecordRefundInput'))
const hookAt = core.indexOf('await input.beforeWrite(tx, row, amount)'), writeAt = core.indexOf('tx.insert(t.payment)')
if (hookAt < 0 || writeAt < 0 || hookAt > writeAt) fail('recordInvoicePayment must run beforeWrite inside the transaction, before the payment is written')
if (!/status: 409, error: refusal/.test(core)) fail('a beforeWrite refusal must answer 409')
if (!/beforeWrite: deps\.options\?\.onPayment/.test(inv)) fail('POST /:id/payments must pass options.onPayment as beforeWrite')

// M8 / H3 — the rules live in eventBooking.ts
const svc = read('templates/crm-restaurant/backend/src/services/eventBooking.ts')
const book = svc.slice(svc.indexOf('export async function bookOnDeposit('), svc.indexOf('export async function coordinatorRefusal('))
if (!book) fail('eventBooking.ts must define bookOnDeposit and coordinatorRefusal')
if (!/ev\.status !== 'enquiry'\) return null/.test(book)) fail('bookOnDeposit must leave anything but an enquiry alone')
if (!/await eventLock\(tx, companyId\)/.test(book) || !/findClash\(tx, companyId, ev\.spaceId, ev\.eventDate, ev\.id\)/.test(book)) fail('bookOnDeposit must take the booking lock and check the room the same way the form does')
if (!/set\(\{ status: 'confirmed'/.test(book)) fail('bookOnDeposit must confirm the enquiry')
if (!/export const bookOnDepositForInvoice/.test(svc)) fail('eventBooking.ts must export the invoice-hook form bookOnDepositForInvoice')
if (!/login users \(Settings › Users\)/.test(svc)) fail('coordinatorRefusal must say the coordinator has to be a login user')

// M8 — both money paths wired
if (!/onPayment: bookOnDepositForInvoice/.test(read('templates/crm-restaurant/backend/src/routes/invoices.ts'))) fail('crm-restaurant routes/invoices.ts must pass onPayment: bookOnDepositForInvoice')
const stripeGlue = read('templates/crm-restaurant/backend/src/services/stripe.ts')
if (!/afterInvoicePayment: async \(invoiceId: string\) =>/.test(stripeGlue) || !/bookOnDeposit\(tx, inv\.companyId, inv\.eventId\)/.test(stripeGlue) || !/await syncEventInvoiceDueDate\(invoiceId\)/.test(stripeGlue)) fail('crm-restaurant services/stripe.ts afterInvoicePayment must book on deposit, then move the due date')

// M9 + H3 — the events routes
const routes = read('templates/crm-restaurant/backend/src/routes/events.ts')
if (!/function packageFloor\(pkg: any, perPerson: boolean, quantity: any, notes: string \| null\)/.test(routes)) fail('routes/events.ts must define packageFloor')
const menuPost = routes.slice(routes.indexOf("app.post('/:id/menu'"), routes.indexOf("app.put('/:id/menu/:lineId'"))
const menuPut = routes.slice(routes.indexOf("app.put('/:id/menu/:lineId'"), routes.indexOf("app.delete('/:id/menu/:lineId'"))
if (!/packageFloor\(pkg, perPerson,/.test(menuPost)) fail('POST /:id/menu must apply the package billing floor')
if (!/packageFloor\(pkg,/.test(menuPut)) fail('PUT /:id/menu/:lineId must apply the package billing floor')
if (/minGuests[\s\S]{0,80}return c\.json\(/.test(menuPost)) fail('POST /:id/menu must not refuse a quantity below the package minimum (it is a billing floor)')
const post = routes.slice(routes.indexOf("app.post('/', requirePermission('contacts:create')"), routes.indexOf("app.put('/:id', requirePermission('contacts:update')"))
const put = routes.slice(routes.indexOf("app.put('/:id', requirePermission('contacts:update')"), routes.indexOf("app.delete('/:id', requirePermission('contacts:update')"))
if (!/coordinatorRefusal\(db, currentUser\.companyId, body\.coordinatorId\)/.test(post)) fail('POST /events must validate the coordinator with coordinatorRefusal')
if (!/coordinatorRefusal\(db, currentUser\.companyId, updates\.coordinatorId\)/.test(put)) fail('PUT /events/:id must validate the coordinator with coordinatorRefusal')

// H3 — one Team list in the shared team module
const team = read('packages/tenant-backend/src/team/team.ts')
const list = team.slice(team.indexOf("app.get('/', requirePermission('team:read')"), team.indexOf("app.get('/assignable'"))
if (/Number\(total\) === 0 &&/.test(list)) fail('GET /api/team must not fall back to login users only when the roster is empty')
if (!/rows = \[\.\.\.data, \.\.\.logins\]/.test(list) || !/_source: 'user' as const/.test(list)) fail('GET /api/team must append the login accounts not on the roster, flagged _source: user')
if (!/onRoster\.has\(String\(u\.email \|\| ''\)\.toLowerCase\(\)\)/.test(list)) fail('GET /api/team must not list a login twice when a roster row carries the same email')

// L1 / L2 — warn-and-ask in both forms
const warn = read('templates/crm-restaurant/frontend/src/lib/eventWarnings.ts')
if (!/export function confirmEventRisks\(/.test(warn) || !/is in the past/.test(warn) || !/is more than/.test(warn)) fail('lib/eventWarnings.ts must define confirmEventRisks with the past-date and capacity prompts')
if (!/if \(!confirmEventRisks\(form, spaces\)\) return/.test(read('templates/crm-restaurant/frontend/src/pages/events/EventsPage.tsx'))) fail('the New Enquiry form must ask confirmEventRisks before saving')
const detail = read('templates/crm-restaurant/frontend/src/pages/events/EventDetailPage.tsx')
if (!/if \(!confirmEventRisks\(form, spaces, ev\)\) return/.test(detail)) fail('the Edit Event form must ask confirmEventRisks (against the saved event) before saving')
if (!/the line will be billed at \{selected\.minGuests\}/.test(detail)) fail('the Add Menu Line form must say the line is billed at the package minimum')

// L1 / L2 on the API too (#172): the same two warnings in `warnings`, saved not refused; on edit only what changed
if (!/export async function eventWarnings\(/.test(svc) || !/is in the past\./.test(svc) || !/holds \(\$\{cap\} at most\)\./.test(svc)) fail('eventBooking.ts must define eventWarnings with the past-date and capacity messages')
if (!/Date\.now\(\) - 12 \* 3600_000/.test(svc)) fail('eventWarnings must call a date past only when it is past everywhere (UTC−12), not by the server\'s UTC day')
if (!/return c\.json\(\{ \.\.\.created, warnings \}, 201\)/.test(post)) fail('POST /events must return the saved event with warnings')
if (!/return c\.json\(\{ \.\.\.updated, warnings \}\)/.test(put) || !/date: changed\('eventDate'\)/.test(put)) fail('PUT /events/:id must return warnings for what the edit changed')

if (failed) { console.error(`\nevents booking rules: ${failed} check(s) FAILED`); process.exit(1) }
console.log('events booking rules: a deposit books the date (or is refused while the room is held) on both money paths; package minimums are billing floors; one Team list; coordinator = login user; past date / capacity warn and ask')

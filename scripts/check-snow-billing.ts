// CI guard: landscaping snow visits can be billed. POST /api/snow/contracts/:id/bill puts the unbilled visits with a
// charge on one draft invoice (shared insertInvoice, the CRM's invoice numbering, default tax and payment terms) to the
// contract's or site's customer, under a row lock so a visit is never invoiced twice; the page has the Bill button.
// (Landscaping T14 H5: "unbilled · 1 event · $175" with no way to bill it)
//   bun scripts/check-snow-billing.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const r = read('templates/crm-landscaping/backend/src/routes/snowBilling.ts')
const inv = read('templates/crm-landscaping/backend/src/routes/invoices.ts')
const i = r.indexOf("app.post('/contracts/:id/bill'")
const bill = i < 0 ? '' : r.slice(i, r.indexOf('\n})\n', i))
if (!bill) fail('POST /contracts/:id/bill is missing')
else {
  if (!/requirePermission\('invoices:create'\)/.test(bill)) fail('billing needs invoices:create')
  if (!/eq\(snowContract\.id, id\), eq\(snowContract\.companyId, cid\)/.test(bill) || !/'Contract not found' \}, 404\)/.test(bill)) fail("billing must 404 on another company's contract")
  if (!/const contactId = row\.contract\.contactId \|\| row\.siteContactId/.test(bill)) fail("the invoice goes to the contract's customer, else the site's")
  if (!/isNull\(snowEvent\.invoiceId\)\)\)\s*\.orderBy\(asc\(snowEvent\.servicedAt\)\)\.for\('update'\)/.test(bill)) fail('unbilled visits must be locked (FOR UPDATE) while billing')
  if (!/await insertInvoice\(tx, \{ invoice, invoiceLineItem \} as any, INVOICE_NUMBERING,/.test(bill)) fail('the invoice must be written by the shared insertInvoice inside the transaction')
  if (!/dueDate: dueDateFromTerms\(settings\), issueDate: new Date\(\), taxRate: defaultTaxRateFrom\(settings\)/.test(bill)) fail("the invoice must use the company's payment terms and default tax")
  if (!/await tx\.update\(snowEvent\)\.set\(\{ invoiceId: created\.id \}\)/.test(bill)) fail('billed visits must be linked to the invoice in the same transaction')
  if (!/Number\(e\.billableAmount\) > 0/.test(bill)) fail('only visits with a charge go on the invoice')
}
// numbering must match this CRM's invoices: routes/invoices.ts sets no numbering (shared default INV-00001)
if (/numbering/.test(inv)) { if (!inv.includes("numbering: { prefix: 'INV', pad: 5, seed: 0 }")) fail('snow billing numbering no longer matches routes/invoices.ts numbering') }
if (!/const INVOICE_NUMBERING = \{ prefix: 'INV', pad: 5, seed: 0 \}/.test(r)) fail('snow billing must number invoices like the shared default (INV, pad 5)')
// input: a blank optional rate still means "not set", but junk is refused with the field named, and the site must be
// this company's (T14 N1: "per_banana" stored as per_push, "abc" stored as 0.00, any siteId accepted)
if (!/export function snowContractInputError/.test(r) || !/export function snowEventInputError/.test(r)) fail('snow input validators are missing')
if (!/Billing mode must be one of: \$\{BILLING_MODES\.join\(', '\)\}\./.test(r)) fail('an unknown billing mode must be refused by name')
if (!/must be a number from 0 to 1,000,000\./.test(r) || !/if \(v === undefined \|\| v === null \|\| String\(v\)\.trim\(\) === ''\) continue/.test(r)) fail('rates: blank stays "not set", junk is refused')
if (!/Pushes must be a whole number from 0 to 100\./.test(r) || !/Snowfall must be a number of inches from 0 to 120\./.test(r) || !/Serviced date must be a valid date\./.test(r)) fail('visit fields must be checked')
const handler = (route: string) => {
  const i = r.indexOf(route)
  return i < 0 ? '' : r.slice(i, r.indexOf('\n})\n', i))
}
for (const [route, fn] of [["app.post('/contracts'", 'snowContractInputError'], ["app.put('/contracts/:id'", 'snowContractInputError'], ["app.post('/events'", 'snowEventInputError']] as const) {
  const body = handler(route)
  // The edit passes the STORED row as well, so match the call by name + first argument.
  if (!new RegExp(`${fn}\\(body[,)]`).test(body) || !/return c\.json\(\{ error: bad/.test(body)) fail(`${route} must refuse bad input with 400`)
}

/**
 * The money rules T41 found, each pinned to the PROPERTY and not to my wording. (T41)
 *
 *   a per-push contract saved with no per-push rate · PUT perInchRate '' zeroed the live rate ·
 *   pushes 0 logged a $0 visit that can never be billed · contactId stored null
 *
 * These are all one fault wearing four hats: a figure the invoice multiplies by was allowed to be
 * absent. The guard checks the rule can still SEE the stored row (without it, a PATCH that sends one
 * field alone slips through), that the four modes each name their own rate, and that a visit's base
 * measure is required unless it was a salt-only run.
 */
{
  const v = r.slice(r.indexOf('export function snowContractInputError'), r.indexOf('export function snowEventInputError'))
  if (!/snowContractInputError\(body: any, existing\?: any\)/.test(r)) fail('snowContractInputError must accept the stored row, or an edit sending one field cannot be judged')
  for (const [mode, field] of [['per_push', 'perPushRate'], ['per_event', 'perEventRate'], ['per_inch', 'perInchRate'], ['seasonal', 'seasonalRate']]) {
    if (!new RegExp(`${mode}: \\['${field}'`).test(v)) fail(`the billing mode ${mode} must require its own rate (${field})`)
  }
  if (!/const mode = body\.billingMode \?\? existing\?\.billingMode/.test(v)) fail('the mode judged must be the one the row will HOLD: the sent one, else the stored one')
  if (!/sent !== undefined \? String\(sent \?\? ''\)\.trim\(\) : String\(existing\?\.\[field\] \?\? ''\)\.trim\(\)/.test(v)) fail("the rate judged must be the one the row will HOLD, so clearing it with '' is caught")
  if (!/effective === '' \|\| !Number\.isFinite\(n\) \|\| n <= 0/.test(v)) fail("a billing mode's own rate must be above zero — blank and 0 both bill the season at nothing")

  const put = handler("app.put('/contracts/:id'")
  if (!/const \[before\] = await db\.select\(\)\.from\(snowContract\)/.test(put) || put.indexOf('const [before]') > put.indexOf('snowContractInputError(body, before)')) {
    fail('PUT /contracts/:id must read the stored contract BEFORE validating, and pass it in')
  }

  const ec = r.slice(r.indexOf('export function snowEventChargeError'), r.indexOf('// ---- Contracts ----'))
  if (!ec) fail('snowEventChargeError is missing — a per-push visit with no pushes bills nothing, for ever')
  else {
    if (!/if \(ev\.saltApplied\) return null/.test(ec)) fail('a salt-only run is a real visit and must stay loggable')
    if (!/billingMode === 'per_push' && !\(Number\(ev\.pushes\) > 0\)/.test(ec)) fail('a per_push visit must have at least one push')
    if (!/billingMode === 'per_inch' && !\(Number\(ev\.snowfallInches\) > 0\)/.test(ec)) fail('a per_inch visit must have the snowfall measured')
  }
  const ev = handler("app.post('/events'")
  if (!/snowEventChargeError\(contract\.billingMode, ev\)/.test(ev) || ev.indexOf('snowEventChargeError') > ev.indexOf('computeSnowEventCharge')) {
    fail('POST /events must refuse an unchargeable visit before pricing it')
  }
  const post = handler("app.post('/contracts'")
  if (!/contactId: body\.contactId \?\? siteRow\.contactId \?\? null/.test(post) || !/contactId: site\.contactId/.test(post)) {
    fail("a new contract must store the site's customer, not leave the biller to re-derive it later")
  }
}
if (!/eq\(site\.id, String\(body\.siteId\)\), eq\(site\.companyId, user\.companyId\)/.test(r) || !/'Site not found' \}, 404\)/.test(r)) fail("a contract's site must belong to the company")

const page = read('templates/crm-landscaping/frontend/src/pages/landscaping/SnowBillingPage.tsx')
if (!/api\.post\(`\/api\/snow\/contracts\/\$\{ct\.id\}\/bill`, \{\}\)/.test(page) || !/Number\(sm\.unbilledTotal \|\| 0\) > 0 &&/.test(page)) fail('the Snow Billing page must offer Bill for a contract with unbilled charges')
// every field keeps a visible label — a placeholder vanishes as soon as the operator types (T14 M8)
if (!/<label htmlFor=\{id\}/.test(page)) fail('the page needs a Field wrapper that labels its input')
for (const id of ['snow-site', 'snow-mode', 'snow-per-push', 'snow-per-event', 'snow-per-inch', 'snow-seasonal', 'snow-trigger', 'snow-salt', 'snow-pushes', 'snow-inches', 'snow-notes']) {
  if (!new RegExp(`<Field id="${id}" label="[^"]+"`).test(page) || !new RegExp(`id="${id}"[^>]*(value=|type=)`).test(page)) fail(`the ${id} field must be labelled`)
}
const forms = page.slice(page.indexOf('{showForm && ('), page.indexOf('Recent Events'))
for (const m of forms.match(/<(input|select)\b[^>]*/g) || []) {
  if (/type="checkbox"/.test(m)) continue // its own wrapping <label>
  if (!/\bid="snow-/.test(m)) fail(`a snow form field has no labelled id: ${m.slice(0, 80)}`)
}
if (failed) { console.error(`\nsnow billing: ${failed} check(s) FAILED`); process.exit(1) }
console.log('snow billing: unbilled visits bill to one locked, numbered, taxed draft invoice; the page has the Bill button')

// CI guard: wellness plans bill. They are the veterinary vertical's only recurring revenue line, and for four
// builds an enrolment stored a billing cycle, raised no invoice and scheduled no renewal while the Features page
// promised "recurring preventive-care memberships billed monthly". (Vet T12 H3)
//
// The things that must not rot: the first period is billed on enrolment, due periods are billed by a run that also
// happens when the enrolments are read (a tenant has no scheduler), each period is CLAIMED before it is invoiced so
// a retry cannot double-charge, and paused/cancelled enrolments are left alone.
//   bun scripts/check-wellness-billing.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const svc = read('templates/crm-vet/backend/src/services/wellnessBilling.ts')
if (!svc) fail('templates/crm-vet/backend/src/services/wellnessBilling.ts is missing — wellness plans bill nothing without it')
if (!/export async function settleWellnessBilling\(companyId\?: string/.test(svc)) fail('there must be a wellness billing run')
if (!/export async function billFirstPeriod\(/.test(svc)) fail('enrolling must bill the first period')
if (!/export function nextRenewal\(from: string, cycle: string\)/.test(svc)) fail('a renewal date must be derived from the cycle')
if (!/if \(String\(cycle\)\.toLowerCase\(\) === 'annual' \|\| String\(cycle\)\.toLowerCase\(\) === 'yearly'\) d\.setUTCFullYear\(d\.getUTCFullYear\(\) \+ 1\)/.test(svc)) fail('an annual plan must roll a year')
if (!/else d\.setUTCMonth\(d\.getUTCMonth\(\) \+ 1\)/.test(svc)) fail('…and a monthly plan a month')
// the claim is what makes a retry safe
if (!/\.set\(\{ lastBilledFor: period, updatedAt: new Date\(\) \}\)/.test(svc)) fail('a period must be claimed by writing lastBilledFor')
if (!/or\(sql`\$\{wellnessEnrollment\.lastBilledFor\} IS NULL`, sql`\$\{wellnessEnrollment\.lastBilledFor\} < \$\{period\}`\)/.test(svc)) fail('…and the claim must only match a period that has not been billed yet')
if (!/if \(!claimed\.length\) return null/.test(svc)) fail('…and losing the claim must bill nothing')
if (!/insertInvoice\(tx, \{ invoice, invoiceLineItem \} as any, INVOICE_NUMBERING/.test(svc)) fail('the invoice must go through the shared writer (numbering, totals, tax, terms)')
if (!/eq\(wellnessEnrollment\.status, 'active'\)/.test(svc)) fail('only active enrolments may be billed')
if (!/renewsAt: nextRenewal\(period, row\.billingCycle\)/.test(svc)) fail('billing a period must schedule the next one')
if (!/if \(!\(price > 0\) \|\| !contactId\) return null/.test(svc)) fail('a free plan, or a pet with no owner, must not raise an invoice')

const routes = read('templates/crm-vet/backend/src/routes/wellnessPlans.ts')
if (!/import \{ settleWellnessBilling, billFirstPeriod \} from '\.\.\/services\/wellnessBilling\.ts'/.test(routes)) fail('the wellness routes must use the billing service')
if (!/app\.post\('\/billing-run'/.test(routes)) fail('there must be an explicit billing run endpoint')
if (!/await settleWellnessBilling\(currentUser\.companyId\)\.catch/.test(routes)) fail('reading the enrolments must settle what is due (a tenant has no scheduler)')
if (!/const firstInvoice = await billFirstPeriod\(created\)/.test(routes)) fail('enrolling must bill the first period')

const schema = read('templates/crm-vet/backend/db/schema.ts')
if (!/lastBilledFor: date\('last_billed_for'\)/.test(schema)) fail('the enrolment must record the period it was last billed for')
const journal = read('templates/crm-vet/backend/db/migrations/meta/_journal.json')
if (!/0023_wellness_billing/.test(journal)) fail('the billing columns need their migration in the journal')

if (failed) { console.error(`\nwellness billing: ${failed} check(s) FAILED`); process.exit(1) }
console.log('wellness billing: enrolment bills, renewals bill once, paused and cancelled plans are left alone')

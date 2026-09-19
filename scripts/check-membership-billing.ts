// CI guard: a membership that is sold is a membership that is billed.
//
// Salon T20 H4 — enrolling a client in the $99/month "Blowout Club" returned 201 and set credits
// correctly, but renewsAt came back null and no invoice was ever raised. There was no billing path at
// all: /bill, /charge and /billing/run were every one of them a 404, and the only enrolment action that
// shipped was /redeem. An enrolment from nine days earlier still had a null renewsAt, so nothing was
// filling it in later either. The feature tracked entitlement perfectly and never charged for it.
//
// Same gap as wellness plans in crm-vet, and the same shape of fix: bill the first period on enrolling,
// settle the rest on read and from an explicit run, and CLAIM each period before charging it so a retry
// or a concurrent run cannot bill twice.
//   bun scripts/check-membership-billing.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const B = 'templates/crm-salon/backend/'

// the columns that make double-billing impossible
const schema = read(B + 'db/schema.ts')
if (!schema) fail('the salon schema is missing')
if (!/lastBilledFor: date\('last_billed_for'\)/.test(schema)) fail('an enrolment must record the period it has been billed for — without it nothing can stop a second charge')
if (!/lastInvoiceId: text\('last_invoice_id'\)/.test(schema)) fail('…and which invoice it raised')

const svc = read(B + 'src/services/membershipBilling.ts')
if (!svc) fail('services/membershipBilling.ts is missing — a membership plan that never bills is not a plan')
// claim-then-charge
if (!/\.set\(\{ lastBilledFor: period, updatedAt: new Date\(\) \}\)/.test(svc)) fail('a period must be CLAIMED before it is charged')
if (!/or\(sql`\$\{membershipEnrollment\.lastBilledFor\} IS NULL`, sql`\$\{membershipEnrollment\.lastBilledFor\} < \$\{period\}`\)/.test(svc)) fail('…and the claim must only match a row not already billed for it, or two runs both charge')
if (!/if \(!claimed\.length\) return null/.test(svc)) fail('…and losing the claim must charge nothing')
// the numbering must not deadlock: reaching for the pool inside a transaction waits on itself
if (!/nextInvoiceNumber\(row\.companyId, tx\)/.test(svc)) fail('the invoice number must come from the SURROUNDING transaction — the pooled db inside a transaction waits on a connection that transaction holds')
// renewal + entitlement
if (!/export function nextRenewal\(from: string, cycle: string\): string \| null/.test(svc)) fail('a renewal date must be worked out from the cycle')
if (!/if \(isOneTime\(cycle\)\) return null/.test(svc)) fail('…and a one-off package must never renew')
// BOTH branches — the billed one and the free-plan one; a period is a period either way
if ((svc.match(/creditsRemaining: credits/g) || []).length < 2) fail('a new period must refill the plan credits, on a paid AND a free plan — a monthly membership that never refills is worthless after month one')
if (!/export async function settleMembershipBilling/.test(svc)) fail('there must be a settle pass for enrolments that have come due')
if (!/export async function billFirstPeriod/.test(svc)) fail('…and enrolling must bill the first period')
if (!/if \(!fresh \|\| fresh\.renewsAt === cursor\.renewsAt\) break/.test(svc)) fail('the catch-up loop must stop when nothing moves, or a stuck enrolment spins forever')

const route = read(B + 'src/routes/memberships.ts')
if (!route) fail('the memberships routes are missing')
if (!/const firstCharge = await billFirstPeriod\(created\)/.test(route)) fail('enrolling must raise the first invoice, not just set credits')
if (!/app\.post\('\/billing\/run'/.test(route)) fail('POST /memberships/billing/run must exist — it was a 404, and a tenant has no scheduler of its own')
if (!/try \{ await settleMembershipBilling\(currentUser\.companyId\) \} catch/.test(route)) fail('reading the enrolments must settle what is due, and must not break the list if billing hiccups')

if (failed) { console.error(`\nmembership billing: ${failed} check(s) FAILED`); process.exit(1) }
console.log('membership billing: enrolling bills and schedules, due periods are caught up once each, and a one-off never renews')

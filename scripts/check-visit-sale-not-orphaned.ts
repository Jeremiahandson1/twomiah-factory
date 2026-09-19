// CI guard: deleting a visit answers for the sale it raised.
//
// Salon T20 H3 — logging a service creates an invoice. Deleting the service record returned 200 and
// removed the visit, and the invoice survived: Open, full balance, still counted in Outstanding on the
// invoice list, /api/invoices/stats, /api/dashboard/stats and the Reports dashboard. Nothing on the
// invoice connected it back to a record that no longer existed, and a visit logged without an
// appointment had no link to its invoice at all. A stylist who logged a service against the wrong
// client and deleted it had silently created a real debt against that client. The run found a second
// orphan that nobody had meant to create.
//
// An issued invoice is never deleted: it is VOIDED, which keeps the number and the audit trail and
// takes it out of outstanding — the same rule POST /invoices/:id/void already enforces. Money that was
// collected and not refunded blocks the void there, and blocks the whole deletion here.
//   bun scripts/check-visit-sale-not-orphaned.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const B = 'templates/crm-salon/backend/'

// the link that lets a deletion find the sale at all
const schema = read(B + 'db/schema.ts')
if (!schema) fail('the salon schema is missing')
if (!/invoiceId: text\('invoice_id'\),/.test(schema)) fail('a visit must record which sale it raised — without it a visit logged with no appointment has no link to its invoice')

const src = read(B + 'src/routes/serviceRecords.ts')
if (!src) fail('the salon service-record routes are missing')
if (!/await db\.update\(serviceRecord\)\.set\(\{ invoiceId, updatedAt: new Date\(\) \} as any\)/.test(src)) fail('…and must store it when the sale is raised')

// deleting answers for the sale
if (!/const \[linkedInvoice\] = \(existing as any\)\.invoiceId/.test(src)) fail('deleting a visit must look for the invoice it raised')
if (!/: existing\.appointmentId/.test(src)) fail('…falling back to the appointment for visits written before the link existed')
if (!/code: 'VISIT_HAS_PAYMENT'/.test(src)) fail('a visit that has been PAID for must not be deleted out from under the money')
if (!/if \(paid > 0\.005\)/.test(src)) fail('…measured as collected minus refunded, the same rule the invoice void uses')
if (!/status: 'void'/.test(src)) fail('the sale must be VOIDED — an issued invoice is never deleted, and voiding keeps the number and the audit trail')
if (/await db\.delete\(serviceRecord\)\.where\(eq\(serviceRecord\.id, id\)\)\n  await audit/.test(src)) fail('the delete must not stand alone — it has to void the sale in the same transaction')
if (!/await db\.transaction\(async \(tx: any\) => \{/.test(src)) fail('…so the void and the delete are one transaction, never half-done')
if (!/await tx\.delete\(serviceRecord\)\.where\(eq\(serviceRecord\.id, id\)\)/.test(src)) fail('…with the delete inside it')
// a refunded sale is terminal, exactly as the invoice void treats it
if (!/linkedInvoice\.status !== 'void' && linkedInvoice\.status !== 'refunded'/.test(src)) fail('a refunded sale must be left alone — the refund already records the reversal, and refiling it as void would corrupt the counts')
// pinned on the RESPONSE, not just the variable: the caller is what has to be told
if (!/return c\.json\(\{ success: true, voidedInvoice \}\)/.test(src)) fail('the response must say which invoice it voided, so the deletion is not silent about the money')

if (failed) { console.error(`\nvisit sale not orphaned: ${failed} check(s) FAILED`); process.exit(1) }
console.log('visit sale not orphaned: deleting a visit voids its sale, refuses when money was collected, and leaves a refunded sale alone')

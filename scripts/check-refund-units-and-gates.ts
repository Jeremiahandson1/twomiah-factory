// CI guard: what a refund gives back, what a sale records, and who a card lets you serve.
// Three Dispensary T21 mediums about the sale record itself:
//
//   * M10 — the Order Detail screen had ONE all-or-nothing button that refunded the whole order as a
//     dollar amount. A dollar refund deliberately returns money and not units, so a manager could
//     never return a single gummy, nothing ever came back to the shelf, and the line kept no trace
//     of what had been returned. The backend already took partialItems + restoreInventory; the
//     screen simply never used them.
//   * M11 — order lines recorded no weight, so the sold grams behind a sale were unrecoverable.
//   * M8 — a patient with a medical card on file was still held to 21, because the age gate only
//     looked at the card typed onto the order and never at the card on the customer record.
//   bun scripts/check-refund-units-and-gates.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const ord = read('templates/crm-dispensary/backend/src/routes/orders.ts')
if (!ord) fail('the dispensary orders routes are missing')

// M10 (backend) — units come back off the shelf and are recorded on the line they came back from
if (!/if \(data\.restoreInventory && existing\.completedAt\) \{/.test(ord)) fail('a refund must restock returned units when the sale decremented them')
if (!/stockQuantity: sql`\$\{product\.stockQuantity\} \+ \$\{r\.qty\}`/.test(ord)) fail('…by ADDING the returned quantity back to stock')
if (!/refundedQuantity: sql`COALESCE\(refunded_quantity, 0\) \+ \$\{r\.qty\}`/.test(ord)) fail('…and the line must count the units returned, cumulatively across partial refunds')

// M11 — the line records the weight that left the shelf
if (!/weightGrams: unitGramsOf\(prod\) > 0 \? String\(round2\(unitGramsOf\(prod\) \* item\.quantity\)\) : null,/.test(ord)) fail('an order line must record the grams sold (unit weight x quantity), not null')

// M8 — a card on the CUSTOMER RECORD counts, and an expired one does not
if (!/card: contact\.medicalCardNumber, expiry: contact\.medicalCardExpiry/.test(ord)) fail("the age gate must read the customer's card on file, not only the one typed onto the order")
if (!/const expired = ct\?\.expiry \? endOfExpiryDay\(ct\.expiry\) < Date\.now\(\) : false/.test(ord)) fail('…and must treat an expired card as no card')
if (!/cardOnFile = ct\?\.card && !expired \? \(ct\.card as any\) : null/.test(ord)) fail('…so only a card that is still valid lowers the age')
if (!/minimumAgeFor\(\{ isMedical: ord\.isMedical \|\| !!cardOnFile, medicalCardNumber: ord\.medicalCardNumber \|\| cardOnFile \}\)/.test(ord)) fail('…and the minimum age must be computed from that card')

// M10 (the screen) — the manager picks the lines, the units, and whether the shelf gets them back
const page = read('templates/crm-dispensary/frontend/src/pages/OrderDetailPage.tsx')
if (!page) fail('the dispensary Order Detail page is missing')
if (/message=\{`Are you sure you want to refund order/.test(page)) fail('the refund must not be a single all-or-nothing confirm — that is what made a line refund impossible')
if (!/body\.partialItems = orderItems/.test(page)) fail('the refund must send the chosen lines and quantities (partialItems)')
if (!/\.filter\(\(p\) => p\.quantity > 0\)/.test(page)) fail('…sending only the lines actually being refunded')
if (!/body\.restoreInventory = restock/.test(page)) fail('…and must say explicitly whether the units go back on the shelf')
// pinned on the CEILING, not just the input: without it a manager could refund more units than were sold
if (!/const remainingOf = \(item: any\) => Math\.max\(0, Number\(item\.quantity \|\| 0\) - Number\(item\.refundedQuantity \|\| 0\)\)/.test(page)) fail('a line may only refund what it has left after earlier partial refunds')
if (!/Math\.min\(remainingOf\(item\), Math\.floor\(Number\(e\.target\.value\) \|\| 0\)\)/.test(page)) fail('…and the quantity box must be capped at that')
if (!/aria-label=\{`Quantity to refund for \$\{item\.productName \|\| item\.name\}`\}/.test(page)) fail('…each line needs its own labelled quantity box')
if (!/disabled=\{refunding \|\| \(refundMode === 'items' && remainingUnits > 0 && selectedUnits === 0\)\}/.test(page)) fail('a refund of no units must not be submittable')
if (!/Number\(item\.refundedQuantity \|\| 0\) > 0 && \(/.test(page)) fail('the order must show what has already been returned on the line')
if (!/body\.amount = amt/.test(page)) fail('a money-only refund must still be possible')
if (!/if \(amt > remainingRefundable \+ 0\.005\)/.test(page)) fail('…bounded by what is left refundable')

if (failed) { console.error(`\nrefund units and gates: ${failed} check(s) FAILED`); process.exit(1) }
console.log('refund units and gates: a line can be refunded and restocked, the line records the units back, a sale records its grams, and a card on file lowers the age')

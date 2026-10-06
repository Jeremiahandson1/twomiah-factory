// CI guard: a figure printed behind a $ shows its cents.
//
// WHY. `Number(125.5).toLocaleString()` is "125.5", and `Number(1171.5).toLocaleString()` is
// "1,171.5". T41 found both — "$125.5" on a vet invoice line and "$1,171.5" on a roofing report —
// and they are the same defect: toLocaleString with no options has minimumFractionDigits 0, so any
// amount whose cents end in a zero loses a digit and any whole amount loses both. An invoice that
// says $1,171.5 reads as unfinished at best and as a different number at worst, and a customer
// comparing it with their bank statement sees two figures that do not match.
//
// The fleet already had the right rule — packages/tenant-ui/src/portal/common.tsx pins
// minimumFractionDigits: 2 and check-money-and-labels.ts holds it there — but only inside the
// customer portal. 175 lines across 55 files outside it never adopted it.
//
// WHAT IS CHECKED. Only a figure printed behind a literal $, which is the one unambiguous signal
// that a number is currency: `$${x.toLocaleString()}` in a template literal, or `${x.toLocaleString()}`
// behind a $ in JSX. A count or a measurement cannot be caught by that rule, and the few $-adjacent
// lines that are square feet or loyalty points are named below.
//
// Dates are exempt: `new Date(x).toLocaleString()` is a timestamp, and giving it fraction digits
// would be nonsense.
//
//   bun scripts/check-money-shows-cents.ts
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dir, '..')
// Parked templates may not be modified (CLAUDE.md: "Do NOT modify crm-automotive"; homecare is
// parked too), so a rule nobody is allowed to satisfy would fail the build for ever.
const PARKED = ['crm-automotive', 'crm-homecare']

/**
 * Not money, however close the $ sits. Each was read before being listed:
 *   areaPricing   `${areaSqft.toLocaleString()} sq ft @ $${rate}/1,000 sq ft` — the $ is the RATE's
 *   xactimate     roof area in sq ft, inside a carrier-facing export
 *   RoofReport    total area, and a measurement with its own unit
 *   POSPage       loyalty points
 */
/**
 * Keyed on WHAT THE LINE SAYS, not where it sits. (T58)
 *
 * These were `file:lineNumber`, and a line number is not a property of the thing being exempted — it
 * is a property of everything above it. The POSPage entry had already been re-pointed once ("moved
 * from :717"), and it broke again the moment a comment was added earlier in the file: a guard about
 * decimal places failed the whole build because an unrelated edit pushed a loyalty-points line down
 * seventeen rows.
 *
 * A content key survives edits above it and still goes stale the moment the line itself is changed or
 * deleted, which is the whole point of the staleness check below. Each snippet is long enough to be
 * unique in its file.
 */
const ALLOWED: { file: string; snippet: string; why: string }[] = [
  { file: 'templates/crm-landscaping/backend/src/routes/areaPricing.ts', snippet: '${areaSqft.toLocaleString()} sq ft @', why: 'square feet; the $ belongs to the RATE beside it' },
  { file: 'templates/crm-roof/backend/src/services/xactimate.ts', snippet: 'Total Roof Area: ${Number(totalArea).toLocaleString()}', why: 'roof area in sq ft, in a carrier-facing export' },
  { file: 'templates/crm-roof/backend/src/services/xactimate.ts', snippet: '${Number(seg.area).toLocaleString()} sqft', why: 'segment area in sq ft' },
  { file: 'templates/crm-roof/frontend/src/pages/roofReports/RoofReportDetail.tsx', snippet: '${Number(report.totalAreaSqft || 0).toLocaleString()} sqft', why: 'total area, a measurement with its own unit' },
  { file: 'templates/crm-roof/frontend/src/pages/roofReports/RoofReportDetail.tsx', snippet: '${Number(m.value).toLocaleString()} ${m.unit}', why: 'a measurement printing its own unit' },
  { file: 'templates/crm-dispensary/frontend/src/pages/POSPage.tsx', snippet: '${Number(customer.loyaltyPoints).toLocaleString()} pts', why: 'loyalty POINTS — a whole number, and "1,250 pts" is right' },
]
/** The line ids the walk below should skip, resolved from the snippets above. */
const allowedIds = new Set<string>()

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// Resolve each exemption to the line it currently sits on, and make it stale if it does not sit
// anywhere any more. This runs BEFORE the walk, so the walk has ids to skip — and an exemption that
// matches twice is refused, because a snippet that is not unique would silently excuse a second line
// nobody read.
for (const { file, snippet, why } of ALLOWED) {
  let lines: string[]
  try { lines = readFileSync(join(ROOT, file), 'utf8').split(/\r?\n/) } catch {
    fail(`the exemption for ${file} (${why}) names a file that no longer exists — remove it`)
    continue
  }
  const hits = lines
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => l.includes(snippet) && l.includes('.toLocaleString()'))
  if (hits.length === 0) {
    fail(`the exemption for ${file} (${why}) no longer matches any line — it was changed or removed, so delete the entry or re-point it. Looked for: ${snippet}`)
    continue
  }
  if (hits.length > 1) {
    fail(`the exemption for ${file} (${why}) matches ${hits.length} lines — make the snippet unique, or it excuses lines nobody has read. Looked for: ${snippet}`)
    continue
  }
  allowedIds.add(`${file}:${hits[0].n}`)
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === 'shared' || name === '.git') continue
    if (PARKED.includes(name)) continue
    const p = join(dir, name)
    let st: any
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

// One door per template, plus the shared packages every template vendors.
const files: string[] = []
let templatesWalked = 0
for (const t of readdirSync(join(ROOT, 'templates'))) {
  if (!/^crm(-|$)/.test(t) || PARKED.includes(t)) continue
  templatesWalked++
  walk(join(ROOT, 'templates', t), files)
}
if (templatesWalked < 10) fail(`only ${templatesWalked} CRM template(s) were walked — this guard is looking in the wrong place`)
walk(join(ROOT, 'packages'), files)

let scanned = 0
for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/')
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.includes('.toLocaleString()')) continue
    const id = `${rel}:${i + 1}`
    if (allowedIds.has(id)) continue
    // A comment that QUOTES the old code is prose, not a money figure. (This guard flagged its own
    // explanation of the crm-rv Accounting fix.)
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue
    if (/(?:new\s+Date|Date\.now|Date\))[^.]*\.toLocaleString\(\)/.test(line)) continue
    // Two ways to put a $ in front of a figure, and the first sweep only looked for one of them:
    //   `$${x.toLocaleString()}`  — interpolated, in a template literal or JSX
    //   '$' + x.toLocaleString()  — concatenated, which is how crm-rv's Accounting page wrote it
    //                               and why it kept rounding every posting to the nearest dollar
    const interpolated = /\$\$?\{(?:[^{}]|\{[^{}]*\})*\.toLocaleString\(\)/.test(line)
    const concatenated = /['"`]\s*\$\s*['"`]\s*\+[^;]*\.toLocaleString\(\)/.test(line)
    if (!interpolated && !concatenated) continue
    scanned++
    fail(`${id} prints money with a bare toLocaleString(), which drops the cents — $125.5 instead of $125.50.\n`
      + `       Pass { minimumFractionDigits: 2, maximumFractionDigits: 2 }, or use the portal's money() helper.\n`
      + `       ${line.trim().slice(0, 140)}`)
  }
}

/**
 * …and the other half of the same fault: a figure with its CENTS but no THOUSANDS separator.
 *
 * `toFixed(2)` gives "12000.00". The rule above catches a bare `toLocaleString()` dropping the
 * cents; this catches `$${x.toFixed(2)}` dropping the grouping, which is how 136 figures in 33
 * backend files reached people — 47 of them on PDFs a customer receives, 10 on HTML receipts, 7 in
 * SMS or email bodies. A five-figure sum with no grouping is the one somebody misreads by a factor
 * of ten with a client on the phone.
 *
 * The answer is `money()` from packages/tenant-backend/src/money.ts, which the generator vendors
 * into every tenant as `backend/src/shared/money.ts`. Its locale is PINNED, because these strings
 * are built server-side: a host that resolved to de-DE would mail customers "$12.000,00".
 *
 * Only the `$`-prefixed form is flagged. A bare `toFixed(2)` on a quantity, a weight, a percentage
 * or an hour count is not money and is none of this rule's business.
 */
let grouped = 0
for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/')
  // money.ts itself defines the helper; the frontend uses the viewer's own locale deliberately.
  if (/\/money\.ts$/.test(rel)) continue
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue
    if (!/\$\$\{[^}]*\.toFixed\(2\)\}/.test(line)) continue
    grouped++
    fail(`${rel}:${i + 1} prints money with toFixed(2), which has no thousands separator — "$12000.00".\n`
      + `       Use money() — import { money } from '../shared/money.ts' in a tenant backend, or './money' inside packages/tenant-backend. It carries the $ sign.\n`
      + `       ${line.trim().slice(0, 140)}`)
  }
}

// The staleness check now runs above, where the snippets are resolved: an exemption that matches
// nothing, or matches more than one line, fails there. A stale exemption is how the next one gets
// added without anybody looking, so that check is the reason this list stays honest — it just no
// longer trips over edits made somewhere else in the file.

if (failed) { console.error(`\nmoney shows cents: ${failed} problem(s)`); process.exit(1) }
console.log(`money shows cents: ${files.length} file(s) across ${templatesWalked} CRM templates and the shared packages print every $ figure to two decimals (${allowedIds.size} measured-not-money lines exempted by content)`)

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
const ALLOWED = new Set([
  'templates/crm-landscaping/backend/src/routes/areaPricing.ts:125',
  'templates/crm-roof/backend/src/services/xactimate.ts:196',
  'templates/crm-roof/backend/src/services/xactimate.ts:205',
  'templates/crm-roof/frontend/src/pages/roofReports/RoofReportDetail.tsx:118',
  'templates/crm-roof/frontend/src/pages/roofReports/RoofReportDetail.tsx:295',
  'templates/crm-dispensary/frontend/src/pages/POSPage.tsx:708',
])

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

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
    if (ALLOWED.has(id)) continue
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

// The ALLOWED list has to keep meaning something: a line that moved or was fixed makes an entry
// stale, and a stale exemption is how the next one gets added without anybody looking.
for (const id of ALLOWED) {
  const [rel, lineNo] = id.split(':')
  let line = ''
  try { line = (readFileSync(join(ROOT, rel), 'utf8').split(/\r?\n/)[Number(lineNo) - 1] || '') } catch {
    fail(`the exemption ${id} names a file that no longer exists — remove it`)
    continue
  }
  if (!line.includes('.toLocaleString()')) {
    fail(`the exemption ${id} no longer formats anything with a bare toLocaleString() — the line moved or was fixed, so remove or re-point it`)
  }
}

if (failed) { console.error(`\nmoney shows cents: ${failed} problem(s)`); process.exit(1) }
console.log(`money shows cents: ${files.length} file(s) across ${templatesWalked} CRM templates and the shared packages print every $ figure to two decimals (${ALLOWED.size} measured-not-money lines exempted by name)`)

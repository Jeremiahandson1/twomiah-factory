// A kiosk order line must say what it is, or the ID check never gets asked for.
//
// `checkAgeGate` in routes/orders.ts decides whether a sale is a cannabis sale by reading the ORDER
// LINE — `isCannabisLine(line)`, which looks at `tax_category`, and failing that `category` /
// `product_category`. If a line answers none of them, the gate concludes the order contains no
// cannabis, returns early, and never requires `idVerified`.
//
// The register has always persisted a resolved `tax_category` on every line it writes, with a comment
// saying why: "so reports, refunds and the age gate read the same answer the tax math used". The kiosk's
// INSERT INTO order_items named nine columns and set none of them. So every kiosk cannabis order had
// lines that read as nothing in particular, the gate stayed silent, and the sale could be completed with
// id_verified false — which then landed on the diversion compliance report as an unverified-ID sale.
// That is Dispensary T28 M-d. The tester read it as "the kiosk records that no ID check was done"; the
// actual fault was that the REGISTER was never made to ask for one.
//
// The fix is not to set id_verified at the kiosk — a kiosk cannot inspect a physical ID, and asserting
// that it did would be the real falsification. The fix is that the line says what it is, so the gate at
// the register fires. This guard keeps those columns on the INSERT.
//
// It also covers the weights, for the same reason the register writes them: a state report or an audit
// is rebuilt from LINES, so a line that cannot say what it weighed is a hole in the reconstruction.
//
//   bun run scripts/check-kiosk-lines-say-what-they-are.ts
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const FILE = join(ROOT, 'templates', 'crm-dispensary', 'backend', 'src', 'routes', 'kiosk.ts')

let failures = 0
const fail = (m: string) => { failures++; console.log(`FAIL ${m}`) }

if (!existsSync(FILE)) {
  // The kiosk is a dispensary-only route. If the template is gone this guard has nothing to say, but
  // silence would be indistinguishable from passing, so say so out loud.
  console.log('crm-dispensary/routes/kiosk.ts not found — nothing to check')
  process.exit(0)
}

const src = readFileSync(FILE, 'utf8')

// Find the order_items INSERT and read its column list: INSERT INTO order_items( ... )
const m = src.match(/INSERT\s+INTO\s+order_items\s*\(([^)]*)\)/i)
if (!m) {
  fail('no `INSERT INTO order_items(...)` found in kiosk.ts — the checkout no longer writes lines the way this guard understands; look at it by hand')
} else {
  const columns = m[1].split(',').map((c) => c.trim().toLowerCase()).filter(Boolean)

  // The two the age gate actually reads. tax_category is the authoritative one; category is the fallback
  // isCannabisLine uses when tax_category is absent.
  for (const col of ['tax_category', 'category']) {
    if (!columns.includes(col)) {
      fail(`kiosk order lines do not record \`${col}\` — isCannabisLine() cannot tell a cannabis line from a t-shirt, so checkAgeGate returns "no cannabis here" and a kiosk sale settles without the ID tick (T28 M-d)`)
    }
  }

  // The audit/state-report half: a line has to be able to say what it weighed.
  for (const col of ['weight_grams', 'weight', 'weight_unit']) {
    if (!columns.includes(col)) {
      fail(`kiosk order lines do not record \`${col}\` — a state report or an audit is rebuilt from LINES, and this one cannot say what it weighed (the T20 M11 gap, on the kiosk till)`)
    }
  }
}

// The kiosk must NOT start claiming the ID was inspected. This is the other way T28 M-d gets "fixed"
// wrongly: setting the flag true at a device that has no human and no ID in front of it.
if (/UPDATE\s+kiosk_sessions[\s\S]{0,400}?\bid_verified\s*=\s*true/i.test(src)) {
  fail('kiosk.ts sets kiosk_sessions.id_verified = true — a kiosk cannot inspect a physical ID. The budtender ticks it at the register; asserting it here falsifies the compliance record (T28 M-d)')
}

console.log(failures === 0
  ? 'ok — kiosk order lines carry their category and weight, and the kiosk does not claim an ID inspection'
  : `${failures} problem(s)`)
process.exit(failures ? 1 : 0)

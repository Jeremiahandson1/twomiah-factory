// Every till in the dispensary taxes a basket the same way, because there is only one place that
// knows how.
//
// The kiosk sold untaxed for as long as it existed: it wrote its subtotal into `total` and stopped, so
// a $70 basket rang up at $70 on the tablet and $84.50 over the counter. (Dispensary T29 B2.)
//
// The cause was not a missing line — it was a SECOND implementation of "complete a sale". Each money
// rule the register grew had to be written twice to hold: the rates the operator configured, excise on
// cannabis lines only, tax on the discounted price, rounding to cents. The second copy was never
// written, and nothing in the build noticed that one of the two tills charged no tax at all.
//
// So this does not check that tax is "handled". It checks that nobody has grown a second copy:
//
//   1. utils/tax.ts is the only place a tax RATE is turned into money.
//   2. every route that creates an order goes through it.
//   3. a route that writes a `total` writes a tax column too — a till that computes tax and then
//      forgets to store it is the same bug wearing a different hat.
//
//   bun run scripts/check-one-tax-definition.ts
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const DISP = join(ROOT, 'templates', 'crm-dispensary', 'backend', 'src')
const TAX_UTIL = join(DISP, 'utils', 'tax.ts')

let failures = 0
const fail = (m: string) => { failures++; console.log(`FAIL ${m}`) }

if (!existsSync(DISP)) { console.log('crm-dispensary not present — nothing to check'); process.exit(0) }

// ── 1. the one definition still exists and still exports what callers need ──────────────────────────
if (!existsSync(TAX_UTIL)) {
  fail('templates/crm-dispensary/backend/src/utils/tax.ts is gone — the tax arithmetic has nowhere to live but a route, which is how the kiosk ended up untaxed')
} else {
  const util = readFileSync(TAX_UTIL, 'utf8')
  for (const fn of ['export function taxRatesFor', 'export function assessTax', 'export function cannabisSubtotalOf']) {
    if (!util.includes(fn)) fail(`utils/tax.ts no longer has \`${fn}\` — every till reads it`)
  }
  // The discounted-price rule (F-07) and cents rounding live here and must not quietly leave.
  if (!/taxableAll\s*=\s*Math\.max\(0,\s*subtotal\s*-\s*discount\)/.test(util)) {
    fail('utils/tax.ts no longer assesses tax on the DISCOUNTED subtotal — a 100% discount charged $7 of tax on a $0 purchase before this (F-07)')
  }
  if (!/round2/.test(util)) fail('utils/tax.ts no longer rounds to cents — raw floats broke exact-match reconciliation (retest#5)')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'shared') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.ts$/.test(name)) out.push(p)
  }
  return out
}

const files = walk(DISP)

// ── 2. nobody else turns a rate into money ──────────────────────────────────────────────────────────
// A rate applied outside the helper is a second copy being born. Reading a rate to DISPLAY it, or
// storing the operator's percent, is fine — multiplying by it is not.
const APPLIES_A_RATE = /\*\s*(exciseRate|salesRate|taxRate|EXCISE_RATE|SALES_TAX_RATE|CANNABIS_TAX_RATE)\b/
for (const abs of files) {
  const rel = relative(ROOT, abs).replace(/\\/g, '/')
  if (abs === TAX_UTIL) continue
  readFileSync(abs, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
    if (APPLIES_A_RATE.test(line)) {
      fail(`${rel}:${i + 1} applies a tax rate itself instead of calling assessTax() — ${line.trim().slice(0, 90)}`)
    }
  })
}

// ── 3. every till that creates an order uses the helper, and stores what it charged ─────────────────
// `tax_amount` specifically: the orders list, order detail and every export read that column, not
// total_tax. The register shipped writing only total_tax once and tax reports read $0. (retest#5 B3)
const TILLS = [
  ['templates/crm-dispensary/backend/src/routes/orders.ts', 'the register'],
  ['templates/crm-dispensary/backend/src/routes/kiosk.ts', 'the kiosk'],
] as const
for (const [rel, what] of TILLS) {
  const abs = join(ROOT, rel)
  if (!existsSync(abs)) { fail(`${rel} is gone — ${what} has no route`); continue }
  const src = readFileSync(abs, 'utf8')
  if (!/from '\.\.\/utils\/tax\.ts'/.test(src)) {
    fail(`${rel} does not import utils/tax.ts — ${what} is taxing on its own again, which is exactly how the kiosk sold untaxed`)
  }
  if (!/assessTax\(/.test(src)) fail(`${rel} never calls assessTax() — ${what} is not using the shared arithmetic`)
  if (!/tax_amount|taxAmount/.test(src)) {
    fail(`${rel} never writes tax_amount — ${what} may compute tax and then store nothing, and every tax export reads that column`)
  }
}

console.log(failures ? `\n${failures} problem(s).` : 'dispensary: one tax definition, and every till calls it')
process.exit(failures ? 1 : 0)

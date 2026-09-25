// CI guard: a template that uses the shared invoicing must tell it what day it is.
//
// The shared invoice route has asked `deps.options.timeZoneFor` since Salon T27 H1, and for a year only
// crm-salon answered — and only for invoices. Every other vertical stamped an invoice raised after 19:00
// Central with TOMORROW's date and a due date a day late, and no vertical's quote expiry was ever right
// that evening. The customer saw the disagreement: the portal printed "Valid until 10/25" beside an
// invoice form defaulting to 10/24. (Field Service T28 M4)
//
// An optional dep is silent when it is not wired, which is what made this survive: nothing was broken,
// something was simply never asked. That is the shape this guard exists to catch.
//   bun scripts/check-business-day-wired.ts
import { existsSync, readdirSync, readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }
const read = (p: string) => { try { return readFileSync(p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const templates = readdirSync(ROOT + 'templates').filter((d) => d.startsWith('crm-') || d === 'crm')
let wired = 0, own: string[] = []

for (const tpl of templates) {
  for (const kind of ['invoices', 'quotes'] as const) {
    const path = `${ROOT}templates/${tpl}/backend/src/routes/${kind}.ts`
    if (!existsSync(path)) continue
    const src = stripComments(read(path))

    const usesShared = /create(Invoice|Quote)Routes/.test(src) && /from '\.\.\/shared\/index\.ts'/.test(src)
    if (!usesShared) {
      /**
       * A template with its OWN invoicing is still in scope for the RULE, just not for the wiring.
       *
       * crm-roof cannot use the shared routes — its line items are JSON on the invoice row and it has no
       * payment table — so it was first written off as out of contract. That let it keep
       * `Date.now() + 30 days`: an instant rather than a calendar day, thirty days regardless of what the
       * company configured, and the server's idea of today. Being differently shaped is a reason to keep
       * its own routes, not a reason to answer a different question about what day it is.
       */
      const ownDefaults = /Date\.now\(\)\s*\+\s*30\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(src)
      if (ownDefaults) {
        fail(`${tpl}/${kind}.ts has its own routes and defaults a date to Date.now() + 30 days — an instant, not a calendar day, ignoring the company's configured terms and the zone it trades in`)
        continue
      }
      if (/dueDate|expiresAt|expiryDate/.test(src) && !/businessToday|FromTerms/.test(src)) {
        fail(`${tpl}/${kind}.ts has its own routes and defaults a date without the shared helpers (businessToday / dueDateFromTerms / quoteExpiryFromTerms)`)
        continue
      }
      own.push(`${tpl}/${kind}`)
      continue
    }

    if (!/timeZoneFor\s*:/.test(src)) {
      fail(`${tpl}/${kind}.ts uses the shared route but never wires timeZoneFor — dates default to the SERVER's day, so anything raised after ~19:00 US time is stamped tomorrow`)
      continue
    }
    // and it has to resolve a real zone, not a hardcoded string someone pasted
    if (!/timeZoneFor\s*:\s*\([^)]*\)\s*=>\s*\w*[Tt]ime[Zz]one/.test(src)) {
      fail(`${tpl}/${kind}.ts wires timeZoneFor but does not resolve it from the company (expected companyTimeZone(db, companyId) or the vertical's own lookup)`)
      continue
    }
    wired++
  }
}

// The shared side must keep offering it, or the wiring above is decoration.
for (const [rel, what] of [
  ['packages/tenant-backend/src/invoicing/invoices.ts', 'invoices'],
  ['packages/tenant-backend/src/invoicing/quotes.ts', 'quotes'],
] as const) {
  const src = read(ROOT + rel)
  if (!src) { fail(`${rel} is missing`); continue }
  if (!/businessToday\(/.test(src)) fail(`shared ${what} must decide "today" with businessToday(), not the server's UTC day`)
  if (!/timeZoneFor/.test(src)) fail(`shared ${what} must accept a timeZoneFor option for the template to answer`)
}

if (failed) { console.error(`\nbusiness day wired: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`business day wired: ${wired} route(s) ask the business what day it is` + (own.length ? `; own routes, checked for the same rule: ${own.join(', ')}` : ''))

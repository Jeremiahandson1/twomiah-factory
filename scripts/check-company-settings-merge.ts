// CI guard: PUT /api/company must MERGE a partial settings object into the stored one, never replace it.
// A partial write ({ settings: { defaultTaxRate } }) used to overwrite the whole JSON blob, wiping plan,
// seat limit, payment terms and onboarding flags for the tenant. Covers the shared company route and the
// one template that keeps its own (dispensary).
//   bun scripts/check-company-settings-merge.ts
import { readFileSync } from 'node:fs'
// The ONE comment stripper (scripts/lib/stripComments.ts): string-aware, so a route pattern like
// '/file/*' or a `src/**` in a line comment cannot pair with a later `*/` and delete real code. (T57)
import { stripSource as strip } from './lib/stripComments.ts'

// company routes that persist the settings JSON blob (shared + the one template that keeps its own).
const files = [
  'packages/tenant-backend/src/company/company.ts',
  'templates/crm-dispensary/backend/src/routes/company.ts',
]

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

for (const file of files) {
  const src = strip(readFileSync(new URL('../' + file, import.meta.url), 'utf8'))
  // The settings write must READ the current settings and spread the incoming partial UNDER them, so
  // untouched keys survive. If this merge is ever removed (back to set({ ...data }) with settings), the
  // company update would overwrite the whole blob again — this check catches that.
  /**
   * The RULE, not the variable's name. (T58k)
   *
   * This pinned `cur` — the identifier the fix happened to use. The handler now reads the whole prior
   * row as `before` (the audit entry has to report what actually CHANGED, which needs something to
   * compare against), and this guard failed a change that kept the merge exactly as it was. A guard
   * that breaks on a rename is testing the spelling, not the behaviour.
   */
  const storedSettings = /(cur|before|current|existing)\??\.settings/
  const spreadUnder = /\.\.\.\s*\(\s*\(?\s*(cur|before|current|existing)\??(\.settings)?/
  if (!storedSettings.test(src) || !spreadUnder.test(src)) {
    fail(`${file}: PUT / must merge the incoming settings into the stored settings — read the stored row and spread it UNDER the incoming partial, or a caller sending one key wipes the rest of the blob`)
  }
}

if (failed) { console.error(`\ncompany settings merge: ${failed} check(s) FAILED`); process.exit(1) }
console.log('company settings merge: PUT /api/company merges partial settings instead of replacing the blob')

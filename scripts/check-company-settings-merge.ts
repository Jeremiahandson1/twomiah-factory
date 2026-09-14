// CI guard: PUT /api/company must MERGE a partial settings object into the stored one, never replace it.
// A partial write ({ settings: { defaultTaxRate } }) used to overwrite the whole JSON blob, wiping plan,
// seat limit, payment terms and onboarding flags for the tenant. Covers the shared company route and the
// one template that keeps its own (dispensary).
//   bun scripts/check-company-settings-merge.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

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
  if (!/cur\??\.settings/.test(src) || !/\.\.\.\s*\(\s*\(?\s*cur/.test(src)) fail(`${file}: PUT / must merge the incoming settings into the stored settings (read current, spread under it)`)
}

if (failed) { console.error(`\ncompany settings merge: ${failed} check(s) FAILED`); process.exit(1) }
console.log('company settings merge: PUT /api/company merges partial settings instead of replacing the blob')

// CI guard: PUT /api/company must MERGE a partial settings object into the stored one, never replace it.
// A partial write ({ settings: { defaultTaxRate } }) used to overwrite the whole JSON blob, wiping plan,
// seat limit, payment terms and onboarding flags for the tenant.
//   bun scripts/check-company-settings-merge.ts
import { readFileSync } from 'node:fs'
const src = readFileSync(new URL('../packages/tenant-backend/src/company/company.ts', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// The update must read the current settings and spread them under the incoming partial.
if (!/cur\??\.settings/.test(src) || !/\.\.\.\s*\(\s*\(?\s*cur/.test(src)) fail('company.ts PUT / must merge the incoming settings into the stored settings (read current, spread under it)')
// The old whole-object replace of the COMPANY row must be gone (the users update legitimately spreads data).
if (/update\(\s*t\.company\s*\)\s*\.set\(\s*\{\s*\.\.\.data/.test(src)) fail('company.ts PUT / still does update(t.company).set({ ...data }) — a partial `settings` replaces the whole blob')

if (failed) { console.error(`\ncompany settings merge: ${failed} check(s) FAILED`); process.exit(1) }
console.log('company settings merge: PUT /api/company merges partial settings instead of replacing the blob')

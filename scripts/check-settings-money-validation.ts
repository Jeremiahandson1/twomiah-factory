// CI guard: the shared Settings page must VALIDATE the billing defaults and refuse bad input, never
// silently clamp it to a default. saveCompany once did `Math.max(0, Number(defaultTaxRate) || 0)`, so a
// typo like -5 became 0 and saved with a success toast — quietly destroying the stored 7.5% rate / net-30
// terms (FS + RV tax-rate finding). The backend already bounds both (company.ts), but the form must stop
// the silent coercion so the user sees an error instead of losing their setting.
//   bun scripts/check-settings-money-validation.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const src = strip(readFileSync(new URL('../packages/tenant-ui/src/shell/SettingsPage.tsx', import.meta.url), 'utf8'))
const save = (src.match(/const\s+saveCompany[\s\S]*?\n  }/) || [''])[0]

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

if (!save) fail('could not locate saveCompany in SettingsPage.tsx')
// The silent-clamp anti-pattern must be gone for both money fields.
if (/Math\.max\(\s*0\s*,\s*Number\(\s*defaultTaxRate/.test(save)) {
  fail('saveCompany clamps a bad tax rate to 0 (Math.max) — it must validate and refuse so the stored value survives')
}
if (/Math\.max\(\s*0\s*,\s*Math\.floor\(\s*Number\(\s*paymentTermsDays/.test(save)) {
  fail('saveCompany clamps bad payment terms to a default — it must validate and refuse')
}
// And the explicit range checks that refuse (with an early return) must be present.
if (!/taxNum\s*<\s*0\s*\|\|\s*taxNum\s*>\s*100/.test(save)) {
  fail('saveCompany must reject a tax rate outside 0–100 (not clamp it)')
}
if (!/termsNum\s*<\s*0/.test(save)) {
  fail('saveCompany must reject negative payment terms (not clamp them)')
}

if (failed) { console.error(`\nsettings money validation: ${failed} check(s) FAILED`); process.exit(1) }
console.log('settings money validation: tax rate + payment terms are validated and refused, not silently clamped')

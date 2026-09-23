// A value with a company column must never travel inside the `settings` blob.
//
// PUT /api/company in crm-dispensary REFUSES five keys when they arrive inside `settings`, because each
// one has a real column where it is stored and validated:
//
//     const SHADOWED = ['taxRate', 'localTaxRate', 'exciseTaxRate', 'purchaseLimitOz', 'storeHours']
//     -> 400 {"code":"SETTING_HAS_A_COLUMN"}
//
// That refusal shipped (T21 L1) while the screen that writes those values did not change. Settings →
// General kept mirroring the four rates into the blob and kept store hours there — and, worse, all five
// tabs and the onboarding wizard spread the STORED blob back up on every save. Any tenant that had ever
// saved General carried the legacy copies to the server forever after, so General, Loyalty, Delivery,
// Merch, Receipts and the last click of onboarding all failed with the same 400. Live on disptest.
//
// The failure mode is two lists drifting apart: the server's SHADOWED and the client's COLUMN_BACKED.
// Add a sixth column-backed value server-side, forget the client, and every save 400s again with a
// message that reads like the caller's fault. This pins them equal, and pins the raw spread out of the
// payload builders.
//
//   bun run scripts/check-settings-blob-has-no-column-values.ts
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const BE = join(ROOT, 'templates/crm-dispensary/backend/src/routes/company.ts')
const FE = join(ROOT, 'templates/crm-dispensary/frontend/src/pages/SettingsPage.tsx')
const WIZ = join(ROOT, 'templates/crm-dispensary/frontend/src/pages/OnboardingWizard.tsx')

let failures = 0
const fail = (m: string) => { failures++; console.log(`FAIL ${m}`) }

/** Pull the string members out of a named `const NAME = [...]` array literal. */
function listOf(src: string, name: string): string[] | null {
  const m = src.match(new RegExp(`const\\s+${name}\\s*(?::[^=]+)?=\\s*\\[([^\\]]*)\\]`))
  if (!m) return null
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1])
}

for (const p of [BE, FE, WIZ]) {
  if (!existsSync(p)) { fail(`missing ${p} — this guard is pinned to crm-dispensary's settings save`); }
}

if (!failures) {
  const be = readFileSync(BE, 'utf8')
  const fe = readFileSync(FE, 'utf8')
  const wiz = readFileSync(WIZ, 'utf8')

  const shadowed = listOf(be, 'SHADOWED')
  if (!shadowed || !shadowed.length) {
    fail('company.ts no longer declares `const SHADOWED = [...]` — the server-side refusal this guard pairs with is gone or was renamed')
  }

  // Every client that builds a `settings` payload has to strip the same list.
  for (const [label, src] of [['SettingsPage.tsx', fe], ['OnboardingWizard.tsx', wiz]] as Array<[string, string]>) {
    const client = listOf(src, 'COLUMN_BACKED')
    if (!client) {
      fail(`${label} does not declare COLUMN_BACKED — it must strip the column-backed keys before sending \`settings\`, or PUT /api/company answers 400 SETTING_HAS_A_COLUMN`)
      continue
    }
    if (shadowed) {
      const missing = shadowed.filter(k => !client.includes(k))
      const extra = client.filter(k => !shadowed.includes(k))
      if (missing.length) fail(`${label}: COLUMN_BACKED is missing ${missing.join(', ')} — the server refuses ${missing.length === 1 ? 'that key' : 'those keys'} inside settings, so saving will 400`)
      if (extra.length) fail(`${label}: COLUMN_BACKED strips ${extra.join(', ')}, which the server does NOT store in a column — that silently drops the value on every save`)
    }
  }

  // The raw spread is the thing that poisoned the four innocent tabs. It must not come back.
  for (const [label, src] of [['SettingsPage.tsx', fe], ['OnboardingWizard.tsx', wiz]] as Array<[string, string]>) {
    for (const [i, line] of src.split('\n').entries()) {
      if (/\.\.\.\s*\(?\s*company[?.]*\.settings\s*(\|\|\s*\{\})?\s*\)?\s*,/.test(line)) {
        fail(`${label}:${i + 1} spreads the stored settings blob verbatim into a payload — use the stripped copy, or the legacy column-backed keys ride along and the save 400s\n      ${line.trim()}`)
      }
    }
  }

  // The server has to accept the keys it tells callers to send top-level, or they are stripped in silence.
  if (shadowed) {
    const schema = be.slice(be.indexOf('app.put('), be.indexOf('app.put(') + 4000)
    for (const k of shadowed) {
      if (!new RegExp(`\\b${k}\\s*:\\s*z\\.`).test(schema)) {
        fail(`company.ts: the PUT schema has no \`${k}\` — the refusal tells callers to send it as a top-level field, but zod strips what it does not declare, so the value never saves`)
      }
    }
  }
}

console.log(failures ? `\n${failures} failure(s)` : 'ok: column-backed values stay out of the settings blob')
process.exit(failures ? 1 : 0)

// CI guard: a commission plan card must print the WORD, and the same word its dropdown offered.
//
// T51 relabelled the dropdown on crm-basic and left the card printing the raw `appliesToRole`, so a
// plan created as "Staff" read back on its own card as "technician" and the owner re-reported it. The
// fix was one mapping read by both. Two forks of the page — crm-fieldservice and crm-landscaping — were
// never swept and were still printing snake_case ("percent of invoice · sales_rep") on the card beside
// a dropdown that said "Sales Rep".
//
// The page is now ONE shared implementation (packages/tenant-ui/src/commissions/CommissionsPage.tsx) and each
// template's pages/CommissionsPage.tsx is a wrapper that hands it that CRM's words. The rule is unchanged:
//   · the SHARED page renders the card from config.roleWords and builds the dropdown from it — one mapping,
//     read by both, and no hardcoded <option> rows beside it;
//   · every template's ROLE_WORDS is keyed on EXACTLY the stored enum (COMMISSION_ROLES in the shared route),
//     and the wrapper actually passes it.
// A label that lives in two places drifts, and a label that does not match the enum silently stops matching any plan.
//   bun scripts/check-commission-role-words.ts
import { readFileSync, existsSync, readdirSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// ── the stored vocabulary, from the one route ──
const route = read('packages/tenant-backend/src/commissions/commissions.ts')
const enumMatch = route.match(/export const COMMISSION_ROLES = \[([^\]]*)\] as const/)
if (!enumMatch) fail('could not find COMMISSION_ROLES in packages/tenant-backend/src/commissions/commissions.ts — the words cannot be checked against what is stored')
if (!/appliesToRole: z\.enum\(COMMISSION_ROLES\)/.test(route)) fail('the plan schema must validate appliesToRole against COMMISSION_ROLES — otherwise the list this guard checks is not the list the route enforces')
const stored = enumMatch ? [...enumMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : []

// ── the shared page reads one mapping for both the card and the dropdown ──
const page = read('packages/tenant-ui/src/commissions/CommissionsPage.tsx')
if (!page) fail('packages/tenant-ui/src/commissions/CommissionsPage.tsx is missing — this guard is looking in the wrong place')
else {
  if (/·\s*for\s*\{p\.appliesToRole\}|·\s*\{p\.appliesToRole\}/.test(page)) fail('the shared plan card prints the raw p.appliesToRole — it will read "sales_rep" on a plan the dropdown created as "Sales Rep"')
  if (!/config\.roleWords\[p\.appliesToRole\]/.test(page)) fail('the shared plan card must render config.roleWords[p.appliesToRole]')
  if (!/Object\.entries\(config\.roleWords\)\.map\(/.test(page)) fail('the shared role dropdown must be built from config.roleWords, not from hardcoded <option> rows')
  const hardcoded = [...page.matchAll(/<option value="(technician|sales_rep|manager|all)"/g)].map((m) => m[1])
  if (hardcoded.length) fail(`the shared page has ${hardcoded.length} hardcoded role option(s) (${hardcoded.join(', ')}) — a second list is how the card and the dropdown disagreed in the first place`)
}

// ── every template that ships the page: its words, keyed on the stored enum, passed in ──
// Found rather than listed — a new vertical that forks the page is exactly the case this guard exists for.
// (crm-automotive is parked; `pricing` is not a tenant CRM.)
const SKIP = new Set(['crm-automotive', 'pricing'])
const pages = readdirSync(ROOT + 'templates').filter((t) => !SKIP.has(t))
  .map((t) => ({ t, p: `templates/${t}/frontend/src/pages/CommissionsPage.tsx` }))
  .filter(({ p }) => existsSync(ROOT + p))
if (!pages.length) fail('no template CommissionsPage.tsx found at all — this guard is looking in the wrong place')

for (const { t, p } of pages) {
  const src = read(p)
  if (!/from '\.\.\/shared'/.test(src) || !/<CommissionsPage\b/.test(src)) {
    fail(`${t}: pages/CommissionsPage.tsx is not the shared page's wrapper — a fork of the page is how the card and dropdown drifted`)
    continue
  }
  const map = src.match(/const ROLE_WORDS: Record<string, string> = \{([\s\S]*?)\n\}/)
  if (!map) { fail(`${t}: the wrapper must carry a ROLE_WORDS mapping — the words this CRM's trade uses`); continue }
  if (!/roleWords:\s*ROLE_WORDS/.test(src)) fail(`${t}: the wrapper defines ROLE_WORDS but does not pass it as roleWords`)
  const keys = [...map[1].matchAll(/^\s*([A-Za-z_]+)\s*:/gm)].map((m) => m[1])
  const missing = stored.filter((s) => !keys.includes(s))
  const extra = keys.filter((k) => !stored.includes(k))
  if (missing.length) fail(`${t}: ROLE_WORDS has no word for ${missing.join(', ')} — a plan stored with that role would print raw on its card`)
  if (extra.length) fail(`${t}: ROLE_WORDS offers ${extra.join(', ')}, which the route's enum will refuse — the dropdown would create a plan the API rejects`)
}

if (failed) { console.error(`\ncommission role words: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`commission role words: one shared card + dropdown reading config.roleWords; ${pages.length} CRM(s) keyed on the stored enum (${stored.join(', ')})`)

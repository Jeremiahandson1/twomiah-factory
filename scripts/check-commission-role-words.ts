// CI guard: a commission plan card must print the WORD, and the same word its dropdown offered.
//
// T51 relabelled the dropdown on crm-basic and left the card printing the raw `appliesToRole`, so a
// plan created as "Staff" read back on its own card as "technician" and the owner re-reported it. The
// fix was one mapping read by both. Two forks of the page — crm-fieldservice and crm-landscaping — were
// never swept and were still printing snake_case ("percent of invoice · sales_rep") on the card beside
// a dropdown that said "Sales Rep".
//
// So the rule is not "say Staff". It is: ONE mapping per page, read by the card AND the dropdown, keyed
// on exactly what the route's enum stores. A label that lives in two places drifts, and a label that
// does not match the enum silently stops matching any plan.
//   bun scripts/check-commission-role-words.ts
import { readFileSync, existsSync, readdirSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// Every template that ships the page, found rather than listed — a new vertical that forks it is
// exactly the case this guard exists for, and a hardcoded list would not see it. (crm-automotive is
// parked; `pricing` is not a tenant CRM.)
const SKIP = new Set(['crm-automotive', 'pricing'])
const templates = readdirSync(ROOT + 'templates').filter((t) => !SKIP.has(t))
const pages = templates
  .map((t) => ({ t, p: `templates/${t}/frontend/src/pages/CommissionsPage.tsx` }))
  .filter(({ p }) => existsSync(ROOT + p))

if (!pages.length) fail('no CommissionsPage.tsx found at all — this guard is looking in the wrong place')

for (const { t, p } of pages) {
  const src = read(p)

  // 1. the one mapping exists
  const map = src.match(/const ROLE_WORDS: Record<string, string> = \{([\s\S]*?)\n\}/)
  if (!map) {
    fail(`${t}: CommissionsPage must carry a ROLE_WORDS mapping — the card and the dropdown have to read the same words from one place`)
    continue
  }
  const keys = [...map[1].matchAll(/^\s*([A-Za-z_]+)\s*:/gm)].map((m) => m[1])

  // 2. the card reads it, rather than printing the stored value
  if (/·\s*\{p\.appliesToRole\}/.test(src)) {
    fail(`${t}: the plan card prints the raw p.appliesToRole — it will read "sales_rep" on a plan the dropdown created as "Sales Rep"`)
  }
  if (!/\{ROLE_WORDS\[p\.appliesToRole\]/.test(src)) {
    fail(`${t}: the plan card must render ROLE_WORDS[p.appliesToRole]`)
  }

  // 3. the dropdown is BUILT from it, so the two cannot drift again
  if (!/Object\.entries\(ROLE_WORDS\)\.map\(/.test(src)) {
    fail(`${t}: the role dropdown must be built from ROLE_WORDS, not from hardcoded <option> rows`)
  }
  const hardcoded = [...src.matchAll(/<option value="(technician|sales_rep|manager|all)"/g)].map((m) => m[1])
  if (hardcoded.length) {
    fail(`${t}: ${hardcoded.length} hardcoded role option(s) left beside the mapping (${hardcoded.join(', ')}) — a second list is how the card and the dropdown disagreed in the first place`)
  }

  // 4. the keys are exactly what the route stores
  const route = read(`templates/${t}/backend/src/routes/commissions.ts`)
  const enumMatch = route.match(/appliesToRole: z\.enum\(\[([^\]]*)\]\)/)
  if (!enumMatch) {
    fail(`${t}: could not find the appliesToRole enum in routes/commissions.ts — the words cannot be checked against what is stored`)
    continue
  }
  const stored = [...enumMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  const missing = stored.filter((s) => !keys.includes(s))
  const extra = keys.filter((k) => !stored.includes(k))
  if (missing.length) fail(`${t}: ROLE_WORDS has no word for ${missing.join(', ')} — a plan stored with that role would print raw on its card`)
  if (extra.length) fail(`${t}: ROLE_WORDS offers ${extra.join(', ')}, which the route's enum will refuse — the dropdown would create a plan the API rejects`)
}

if (failed) { console.error(`\ncommission role words: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`commission role words: card and dropdown read one mapping, keyed on the stored enum, in ${pages.length} CRM(s)`)

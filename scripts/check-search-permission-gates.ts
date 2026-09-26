// CI guard: search returns only what this PERSON may read — not merely what the tenant has switched on.
//
// check-search-feature-gates.ts already holds search in step with the tenant's modules. It asks "is this
// module on", which is a question about the company. Nobody was asking the second question — "may this
// user read that kind of record" — so a field technician, refused 403 by /api/invoices, typed a customer
// name into the search box and got invoice rows with amounts on them. A result is a door: handing back one
// the API will refuse to open is a leak and a dead link at the same time. (Field Service T30 HIGH)
//
// The rule enforced here is deliberately NOT "gate these types". It is: whatever permission a type's own
// list route requires, search requires the same, and a type whose list route requires nothing is not
// gated in search either. That way TYPE_PERMISSIONS cannot drift from the doors it mirrors in either
// direction — someone who later puts requirePermission('projects:read') on /api/projects is told here that
// search still hands project rows to people the route would refuse.
//
//   bun scripts/check-search-permission-gates.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => { try { return strip(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')) } catch { return null } }

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const TEMPLATES = ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant']

/**
 * Where each search result type's own list route lives — the door the search result opens. `{t}` is the
 * template, for the families a vertical owns itself; everything else is the shared implementation every
 * CRM vendors in as ../shared.
 */
const DOOR: Record<string, string> = {
  contact: 'packages/tenant-backend/src/contacts/contacts.ts',
  job: 'packages/tenant-backend/src/jobs/jobs.ts',
  quote: 'packages/tenant-backend/src/invoicing/quotes.ts',
  invoice: 'packages/tenant-backend/src/invoicing/invoices.ts',
  team: 'packages/tenant-backend/src/team/team.ts',
  document: 'packages/tenant-backend/src/files/documents.ts',
  project: 'templates/{t}/backend/src/routes/projects.ts',
  rfi: 'templates/{t}/backend/src/routes/rfis.ts',
  unit: 'templates/{t}/backend/src/routes/units.ts',
  patient: 'templates/{t}/backend/src/routes/patients.ts',
  event: 'templates/{t}/backend/src/routes/events.ts',
  service: 'templates/{t}/backend/src/routes/serviceMenu.ts',
  menu: 'templates/{t}/backend/src/routes/menuPackages.ts',
  space: 'templates/{t}/backend/src/routes/eventSpaces.ts',
}

/** The permission the bare list route asks for, or null when it asks for nothing beyond a signed-in user. */
function doorPermission(src: string): string | null {
  const line = src.split('\n').find((l) => /^\s*app\.get\('\/'/.test(l))
  if (line === undefined) return null
  const m = line.match(/requirePermission\('([^']+)'\)/)
  return m ? m[1] : null
}

let checked = 0
for (const t of TEMPLATES) {
  const r = read(`templates/${t}/backend/src/routes/search.ts`)
  const svc = read(`templates/${t}/backend/src/services/search.ts`)
  if (!r || !svc) { fail(`${t}: no search route or service to check`); continue }

  if (!/import \{ hasPermission, getExtraPermissions \} from '\.\.\/middleware\/permissions\.ts'/.test(r)) {
    fail(`${t} search must read the permission matrix, not only the feature list`)
  }
  // the predicate has to be handed the user, or it can only ever answer the company's question
  if (!/async function shownTypes\(companyId: string, user\?: any\)/.test(r)) {
    fail(`${t} search: shownTypes must take the user — without it there is nothing to check a permission against`)
  }
  const calls = [...r.matchAll(/await shownTypes\(([^)]*)\)/g)].map((m) => m[1].trim())
  if (calls.length !== 3) fail(`${t} search: expected shownTypes at search, quick search and Recent — found ${calls.length}`)
  for (const args of calls) {
    if (args !== 'user.companyId, user') fail(`${t} search: a handler calls shownTypes(${args}) and so skips the permission check`)
  }
  if (!/const needs = TYPE_PERMISSIONS\[type\]/.test(r) || !/hasPermission\(user\.role, needs, extra\)/.test(r)) {
    fail(`${t} search: the predicate must consult TYPE_PERMISSIONS`)
  }

  const m = r.match(/const TYPE_PERMISSIONS: Record<string, string> = \{([\s\S]*?)\n\}/)
  if (!m) { fail(`${t} search route must declare TYPE_PERMISSIONS`); continue }
  const gates: Record<string, string> = {}
  for (const [, k, v] of m[1].matchAll(/(\w+): '([^']+)'/g)) gates[k] = v

  for (const [type, doorPath] of Object.entries(DOOR)) {
    // can this CRM's search even return the type?
    if (!new RegExp(`searchTypes\\.includes\\('${type}'\\)`).test(svc)) continue
    const door = read(doorPath.replace('{t}', t))
    if (door === null) {
      // The family is not mounted in this CRM at all — check-search-feature-gates.ts is what requires
      // TYPE_FEATURES to mark it `false`. There is no door here, so there is no permission to mirror; all
      // this guard insists on is that nobody invented one.
      if (gates[type] !== undefined) fail(`${t}: there is no ${doorPath.replace('{t}', t)} to open, so TYPE_PERMISSIONS must not carry '${type}' (found ${gates[type]}) — TYPE_FEATURES is where an unmounted family belongs`)
      continue
    }
    checked++
    const needs = doorPermission(door)
    const listed = gates[type]
    if (needs && listed !== needs) {
      fail(`${t}: opening a '${type}' requires ${needs}, so search must require the same before returning one (found ${listed === undefined ? 'no entry' : listed})`)
    } else if (!needs && listed !== undefined) {
      fail(`${t}: a '${type}' list route asks for no particular permission, so search must not invent one (found ${listed})`)
    }
  }
}

if (failed) { console.error(`\nsearch permission gates: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`search permission gates: every CRM's search, quick search and Recent require the same permission to return a row as the route that opens it (${checked} type/route pairs)`)

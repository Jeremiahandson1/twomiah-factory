// CI guard: a request-supplied row id must be tied to the caller before it is trusted.
//
// The bug class, found for real several times: reads filter on companyId, writes match on the id
// ALONE. team.ts had it in seven templates; bids/dailyLogs/inspections/punchLists/rfis/changeOrders/
// submittals/lienWaivers/aiaForms/drawSchedules had it in the base CRM; commissions and locations had
// it in three templates each; dispensary deleted USERS that way and roof approved FINANCING that way.
// Each tenant has its own database with one company, so the practical blast radius was small — but
// "we scope every row" and "we scope the rows we remembered" are different properties, and only the
// first one holds when someone adds the next route.
//
//   bun run scripts/check-companyid-scoping.ts
//
// ── how it decides ───────────────────────────────────────────────────────────────────────────────
// For each route handler, for each `const x = c.req.param(...)` used as a ROW ID, the id counts as
// PROVEN when any of these hold. Every rule is a property of the code, not an allow-list:
//
//   A same-clause    the where() that pins the id also pins companyId (or does, in raw SQL)
//   C own-key        that clause pins a narrower key the caller owns (userId, contactId, …)
//   B via helper     the id is handed to a file-local helper whose own body constrains companyId,
//                    an own-key, or narrows by a set derived from an ownership id it was given
//   E derived set    the clause narrows by a local set built from the caller's identity, e.g.
//                    `const projectIds = await contactProjectIds(contact.id)` + inArray(...)
//   D no such column the table has no companyId in that backend's schema, so there is nothing to
//                    scope by (deps-injected table aliases are resolved back to the schema export)
//
// Anything left is reported, unless it is listed in PUBLIC_BY_DESIGN below WITH A REASON.
//
// Earlier versions of this analysis were wrong in instructive ways, so do not "simplify" them back:
//  · asking "is companyId within N characters" or "anywhere in the handler" makes the guard UNSOUND —
//    a handler whose first line is `const cid = currentUser.companyId` then proves every clause below
//    it, and real defects read as safe. The question is per where-clause.
//  · a helper's body must be brace-matched. Cutting at the first inner `const` leaves only the
//    signature, and `findOwned` — the single most common proof in the shared package — never matches.
//  · dispensary is written in raw `sql` template literals; without a raw-SQL rule its where-clauses
//    are invisible and it produces ~180 false findings on its own.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import * as path from 'path'

const ROOT = path.resolve(import.meta.dir, '..')

// Handlers that legitimately trust the id itself, each with the reason it is safe.
// A public route has no authenticated caller to scope to; the unguessable id IS the credential,
// exactly like a password-reset link. Keep the reason — it is what makes this a decision.
const PUBLIC_BY_DESIGN: Record<string, string> = {
  'crm:routes/pricebookPresent.ts:GET /:itemId':
    'public, unauthenticated Good/Better/Best page shown to a homeowner on a tablet; companyId is read off the item row',
  'crm-restaurant:routes/pricebookPresent.ts:GET /:itemId': 'same public pricebook presentation page',
  'crm-rv:routes/pricebookPresent.ts:GET /:itemId': 'same public pricebook presentation page',
  'crm-salon:routes/pricebookPresent.ts:GET /:itemId': 'same public pricebook presentation page',
  'crm-vet:routes/pricebookPresent.ts:GET /:itemId': 'same public pricebook presentation page',
  'shared:integrations/reviews.ts:GET /track/:requestId/click':
    'the link in the customer\'s text/email; registered BEFORE app.use(authenticate) on purpose — putting it behind auth answered 401 for every customer who clicked',
  'crm-roof:routes/reviews.ts:GET /track/:requestId/click': 'same public click-tracking link, registered before authenticate',
  'crm-roof:routes/roofReports.ts:GET /:id/aerial.png':
    'unauthenticated asset for an already-purchased report, served via a shared link (see the requireRoofReports comment)',
  'crm-roof:routes/roofReports.ts:GET /:id/html': 'public shareable HTML view of a purchased report, no auth by design',
  'crm-dispensary:routes/signage.ts:POST /screens/:id/heartbeat':
    'unauthenticated device endpoint; the SQL also requires device_id = the device secret, so the id alone is not enough',
  'crm-dispensary:routes/marketplace.ts:POST /install/:partnerId':
    'partnerId addresses integration_partners, a GLOBAL catalog with no company_id column; the install row it writes is company-scoped',
}

const read = (p: string) => { try { return readFileSync(p, 'utf8') } catch { return '' } }
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const walk = (d: string, out: string[] = []): string[] => {
  if (!existsSync(d)) return out
  for (const e of readdirSync(d)) {
    if (e === 'node_modules' || e === 'dist' || e === 'shared') continue
    const p = `${d}/${e}`
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.ts$/.test(e)) out.push(p)
  }
  return out
}
/** text of the balanced (...) whose '(' sits at `open` */
function balanced(src: string, open: number): string {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth === 0) return src.slice(open + 1, i) }
  }
  return ''
}
function handlers(src: string) {
  const out: Array<{ verb: string; path: string; body: string; line: number }> = []
  const re = /app\.(get|post|put|patch|delete)\(\s*'([^']*)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    let depth = 0, i = re.lastIndex, started = false
    for (; i < src.length; i++) {
      const c = src[i]
      if (c === '(') { depth++; started = true }
      else if (c === ')') { depth--; if (started && depth < 0) break }
    }
    out.push({ verb: m[1], path: m[2], body: src.slice(m.index, i), line: src.slice(0, m.index).split('\n').length })
  }
  return out
}
const OWN_KEYS = /\b(userId|salespersonId|createdById|assignedToId|uploadedById|sentById|contactId|locationId)\b/

/** file-local helpers whose own body establishes ownership */
function scopingHelpers(src: string): Set<string> {
  const names = new Set<string>()
  const re = /(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const name = m[1]
    const arrow = src.indexOf('=>', re.lastIndex)
    if (arrow === -1) continue
    if (src.slice(re.lastIndex, arrow).includes(';')) continue
    let body: string
    const after = src.slice(arrow + 2)
    const firstNonSpace = after.search(/\S/)
    if (after[firstNonSpace] === '{') {
      const open = arrow + 2 + firstNonSpace
      let depth = 0, end = open
      for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++
        else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break } }
      }
      body = src.slice(open, end + 1)
    } else body = after.slice(0, 400).split('\n').slice(0, 3).join('\n')
    const params = balanced(src, re.lastIndex - 1)
    if (/eq\([^)]*company_?[Ii]d/i.test(body) || /company_?id\s*=/i.test(body)) names.add(name)
    else if (new RegExp(`eq\\([^)]*${OWN_KEYS.source}`).test(body)) names.add(name)
    else if (/inArray\s*\(/.test(body) && (OWN_KEYS.test(params) || /company_?[Ii]d/.test(params))) names.add(name)
  }
  return names
}
/** shared modules get their tables injected: `inboundMessageTable: inboundMessage` */
function depsTableAliases(): Map<string, string> {
  const out = new Map<string, string>()
  for (const t of readdirSync(`${ROOT}/templates`).filter((x) => /^crm(-|$)/.test(x))) {
    const dir = `${ROOT}/templates/${t}/backend/src/routes`
    if (!existsSync(dir)) continue
    for (const f of walk(dir)) {
      const src = strip(read(f))
      if (!/create\w+Routes\s*\(/.test(src)) continue
      for (const m of src.matchAll(/(\w*[Tt]able)\s*:\s*(\w+)/g)) out.set(m[1], m[2])
    }
  }
  return out
}
function tablesWithoutCompany(backendDir: string): Set<string> {
  const out = new Set<string>()
  const schema = strip(read(`${backendDir}/db/schema.ts`))
  const re = /export const (\w+)\s*=\s*pgTable\(/g
  const starts: Array<[string, number]> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(schema))) starts.push([m[1], m.index])
  for (let i = 0; i < starts.length; i++) {
    const [name, at] = starts[i]
    const end = i + 1 < starts.length ? starts[i + 1][1] : schema.length
    if (!/company_?[Ii]d/.test(schema.slice(at, end))) out.add(name)
  }
  return out
}

// crm-automotive and crm-homecare are parked (see CLAUDE.md) — reported as info, never failed on.
const PARKED = /^(crm-automotive|crm-homecare)$/

const ALIASES = depsTableAliases()
const failures: string[] = []
const parkedHits: string[] = []
const usedExceptions = new Set<string>()

const ROOTS: Array<[string, string, string]> = [
  ['shared', `${ROOT}/packages/tenant-backend/src`, `${ROOT}/templates/crm/backend`],
  ...readdirSync(`${ROOT}/templates`).filter((t) => /^crm(-|$)/.test(t))
    .map((t) => [t, `${ROOT}/templates/${t}/backend/src/routes`, `${ROOT}/templates/${t}/backend`] as [string, string, string]),
]

for (const [label, root, backendDir] of ROOTS) {
  const noCompany = tablesWithoutCompany(backendDir)
  for (const f of walk(root)) {
    const src = strip(read(f))
    if (!/app\.(get|post|put|patch|delete)\(/.test(src)) continue
    const helpers = scopingHelpers(src)
    const rel = (f.split('/src/').pop() || f).replace(/\\/g, '/')
    for (const h of handlers(src)) {
      const params = [...h.body.matchAll(/const\s+(\w+)\s*=\s*c\.req\.param\(/g)].map((x) => x[1])
      if (!params.length) continue

      const clauses: string[] = []
      const wre = /\bwhere\s*\(/g
      let wm: RegExpExecArray | null
      while ((wm = wre.exec(h.body))) clauses.push(balanced(h.body, wre.lastIndex - 1))
      const literals = h.body.match(/`[^`]*`/g) || []

      const derived = new Set<string>()
      for (const dm of h.body.matchAll(/const\s+(\w+)\s*=\s*await\s+\w+\(([^)]*)\)/g)) {
        if (/\bcontact\.id\b|\bcurrentUser\.|\buser\.id\b/.test(dm[2])) derived.add(dm[1])
      }

      for (const v of params) {
        const idRe = new RegExp(`eq\\(\\s*(?:t\\.)?(\\w+)\\.id,\\s*${v}\\s*\\)`)
        const using = clauses.filter((cl) => idRe.test(cl))
        const rawIdRe = new RegExp(`\\bid\\s*=\\s*\\$\\{${v}\\}`, 'i')
        const rawUsing = literals.filter((l) => rawIdRe.test(l))
        if (!using.length && !rawUsing.length) continue

        const rawTable = using.length ? idRe.exec(using[0])![1] : ''
        const table = rawTable && ALIASES.has(rawTable) ? ALIASES.get(rawTable)! : rawTable
        if (table && noCompany.has(table)) continue                                        // D
        if (using.some((cl) => /company_?[Ii]d/.test(cl))) continue                        // A
        if (rawUsing.some((l) => /company_?id/i.test(l))) continue                          // A (raw)
        if (using.some((cl) => OWN_KEYS.test(cl))) continue                                 // C
        if (rawUsing.some((l) => OWN_KEYS.test(l))) continue                                // C (raw)
        let viaHelper = false
        for (const fn of helpers) if (new RegExp(`\\b${fn}\\s*\\([^)]*\\b${v}\\b`).test(h.body)) { viaHelper = true; break }
        if (viaHelper) continue                                                             // B
        if (using.some((cl) => [...derived].some((d) => new RegExp(`\\b${d}\\b`).test(cl)))) continue  // E

        const key = `${label}:${rel}:${h.verb.toUpperCase()} ${h.path}`
        if (key in PUBLIC_BY_DESIGN) { usedExceptions.add(key); continue }
        if (PARKED.test(label)) { parkedHits.push(`${key}  (:${h.line})`); continue }
        failures.push(`${key}  (:${h.line})  uses '${v}' as a row id without tying it to the caller`)
      }
    }
  }
}

for (const p of parkedHits) console.log(`INFO  parked template, not enforced — ${p}`)
const stale = Object.keys(PUBLIC_BY_DESIGN).filter((k) => !usedExceptions.has(k))
for (const s of stale) console.log(`INFO  PUBLIC_BY_DESIGN '${s}' no longer matches any handler — consider removing it`)

if (failures.length) {
  for (const f of failures) console.error(`ERROR ${f}`)
  console.error(`\ncompanyId scoping: ${failures.length} handler(s) trust a request id without scoping it.`)
  console.error(`Scope the where-clause to the caller's company (or prove ownership first and 404), or`)
  console.error(`add it to PUBLIC_BY_DESIGN with the reason it is safe.`)
  process.exit(1)
}
console.log(`\ncompanyId scoping: OK — ${Object.keys(PUBLIC_BY_DESIGN).length} public-by-design exception(s), ${parkedHits.length} in parked templates`)

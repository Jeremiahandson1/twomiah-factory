// CI guard: a route must not select a column its table does not declare.
//
// ── why this guard exists ───────────────────────────────────────────────────────────────────────
//
// `userName: user.name` in a `db.select({...})`, where the `user` table has first_name and last_name
// and no `name` column at all. `user.name` is undefined, drizzle calls Object.entries on it while
// BUILDING the query, and the handler throws before it touches the database. Not a wrong answer — a
// 500 on every call it ever receives.
//
// It shipped in SEVEN templates and stood for months, because:
//   · no template is typechecked (reference: the system map), so `undefined` as a select value is
//     never caught at build time;
//   · nothing had a SCREEN for the pay run, so nobody ever called the route to find out;
//   · and when I finally did fix it, I fixed the FOUR templates whose tenants I happened to be
//     watching and never asked which others read the same missing column. crm-rv and
//     crm-restaurant were still broken a round later.
//
// That is three separate safety nets with the same hole in them, so the check belongs in CI where it
// looks at every template every time.
//
// ── the rule ────────────────────────────────────────────────────────────────────────────────────
//
// For every `export const X = pgTable('…', { … })` in a template's schema, the set of fields it
// declares is known. Any `X.<prop>` in that template's route/service code must name one of those
// fields, a drizzle table member, or a column helper. Anything else is `undefined` at runtime.
//
//   bun scripts/check-selected-columns-exist.ts
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

/**
 * `templates/pricing` is a RATCHET, not an exemption.
 *
 * It is a standalone product (pricing / subscription management), no tenant is built from it, and its
 * data model and its routes disagree wholesale: the `quote` table has tenantId and customerName,
 * while the routes read quote.companyId, quote.customerFirstName and quote.quoteNumber. 19 distinct
 * columns across 84 call sites — including repProfile.companyId in middleware/auth.ts, so its auth
 * throws and the backend cannot serve a request at all. That is a product decision to make, not a
 * drive-by fix, and it is NOT what this guard was written for.
 *
 * So the count is pinned here instead of the template being skipped. If it grows, the build fails and
 * names what was added; if somebody fixes some, the build fails and tells them to lower the number.
 * A silent `if (t === 'pricing') continue` is how the parked-template fork stayed broken for a round
 * (see scripts/check-row-action-show.ts).
 */
const RATCHET: Record<string, number> = { pricing: 19 }
const ratchetHits = new Map<string, Set<string>>()

/**
 * Members that exist on a drizzle table or column object regardless of the schema, plus the ones
 * a plain object/function carries. A hit on one of these is not a missing column.
 */
const TABLE_MEMBERS = new Set([
  '$inferSelect', '$inferInsert', '_', 'enableRLS', 'getSQL', 'getSelectedFields', 'as', 'alias',
  'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'length', 'prototype', 'default',
])

/** Field names declared directly on a pgTable, by walking to the first line that closes the object. */
function tableFields(lines: string[], start: number): string[] {
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    // These tables end with `}, (t) => [` or `})`, so stop at the first line starting with `}`.
    if (/^\}/.test(lines[i])) break
    const m = lines[i].match(/^\s{2}([A-Za-z_][A-Za-z0-9_]*)\s*:/)
    if (m) out.push(m[1])
  }
  return out
}

const SKIP = new Set(['node_modules', 'dist', 'build', '.git', 'migrations'])
function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (SKIP.has(e)) continue
    const p = join(dir, e)
    let st; try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (e.endsWith('.ts')) out.push(p)
  }
  return out
}
/**
 * Comments go, and so do string literals: `from './routes/company.ts'` otherwise reads as
 * `company.ts` — a column reference on the company table — and the first run of this guard reported
 * one of those in every template. Newlines are preserved so the reported line numbers stay true.
 */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) => m.replace(/[^\n]/g, ' '))

let templates = 0, tablesSeen = 0, refsChecked = 0
for (const t of readdirSync(join(ROOT, 'templates'))) {
  const schemaPath = join(ROOT, 'templates', t, 'backend/db/schema.ts')
  const srcDir = join(ROOT, 'templates', t, 'backend/src')
  if (!existsSync(schemaPath) || !existsSync(srcDir)) continue
  templates++

  // ── what each table actually declares ─────────────────────────────────────────────────────────
  const lines = readFileSync(schemaPath, 'utf8').split(/\r?\n/)
  const fields = new Map<string, Set<string>>()
  lines.forEach((l, i) => {
    const m = l.match(/^export const ([A-Za-z_][A-Za-z0-9_]*)\s*=\s*pgTable\(/)
    if (m) fields.set(m[1], new Set(tableFields(lines, i)))
  })
  tablesSeen += fields.size
  if (!fields.size) continue

  // ── every `<table>.<prop>` in the template's own server code ──────────────────────────────────
  for (const file of walk(srcDir)) {
    // The import list is read with its path strings intact; the reference scan is done on a copy
    // with strings blanked out, so an import path cannot look like a column reference.
    const raw = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    const src = strip(readFileSync(file, 'utf8'))
    // Only tables this file imports, so a local variable that shares a table's name is not mistaken
    // for the table. (`const user = c.get('user')` is extremely common and is NOT the table.)
    /**
     * local name → the table it actually refers to.
     *
     * `import { jobPurchaseOrder as purchaseOrder }` is the case that matters: the file says
     * `purchaseOrder.vendorId`, and a `purchaseOrder` table also exists in this schema WITHOUT a
     * vendorId. Resolving the alias to the local name and looking THAT up reported the whole base-CRM
     * vendor portal as broken when it is fine. The alias has to resolve to the imported name.
     */
    const importedHere = new Map<string, string>()
    for (const m of raw.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*(?:db\/schema|schema\.ts|\.\.\/\.\.\/db\/schema)[^'"]*['"]/g)) {
      for (const part of m[1].split(',')) {
        const bits = part.trim().split(/\s+as\s+/).map((s) => s.trim()).filter(Boolean)
        if (!bits.length) continue
        const imported = bits[0]
        const local = bits.length > 1 ? bits[1] : bits[0]
        if (fields.has(imported)) importedHere.set(local, imported)
      }
    }
    if (!importedHere.size) continue
    // A local declaration of the same name shadows the import for the rest of the file; skip those
    // names rather than report a false positive on them.
    for (const local of [...importedHere.keys()]) {
      if (new RegExp(`\\b(?:const|let|var|function)\\s+${local}\\b`).test(src)) importedHere.delete(local)
    }

    for (const [name, table] of importedHere) {
      // The lookbehind matters: `r.payment.eventId` is a result-alias key, not the `payment` table,
      // and `\b` happily matches between the dot and the p. That false positive was the only thing
      // this guard reported in crm-restaurant's dashboard.
      const re = new RegExp(`(?<![\\w$.])${name}\\.([A-Za-z_$][A-Za-z0-9_$]*)`, 'g')
      for (const m of src.matchAll(re)) {
        const prop = m[1]
        refsChecked++
        if (TABLE_MEMBERS.has(prop)) continue
        if (fields.get(table)!.has(prop)) continue
        if (t in RATCHET) {
          // Counted, not reported line by line — see RATCHET above.
          const set = ratchetHits.get(t) || new Set<string>()
          set.add(`${table}.${prop}`)
          ratchetHits.set(t, set)
          continue
        }
        const line = src.slice(0, m.index).split('\n').length
        const via = table === name ? '' : ` (imported as \`${table}\`)`
        fail(`${t}: ${file.slice(file.indexOf('templates'))}:${line} reads \`${name}.${prop}\`, and the ${table} table${via} declares no such column — that value is undefined at runtime (drizzle throws while building the query).`)
      }
    }
  }
}

// ── the ratchet ─────────────────────────────────────────────────────────────────────────────────
for (const [t, expected] of Object.entries(RATCHET)) {
  const found = ratchetHits.get(t)?.size ?? 0
  const list = [...(ratchetHits.get(t) || [])].sort().join(', ')
  if (found > expected) {
    fail(`${t}: ${found} missing columns, up from the pinned ${expected}. Something new was added on top of a known-broken template. All of them: ${list}`)
  } else if (found < expected) {
    fail(`${t}: ${found} missing columns, down from the pinned ${expected} — good. Lower RATCHET in this script to ${found} so the improvement is locked in.`)
  } else {
    console.log(`note: ${t} carries ${found} known missing columns and is not getting worse. It is a standalone product with no tenant, and its backend cannot serve a request (repProfile.companyId is read in middleware/auth.ts). Columns: ${list}`)
  }
}

if (templates === 0) fail('no template with both a schema and a backend/src was found — this guard has stopped looking at anything')
console.log(failed === 0
  ? `OK: ${templates} template(s), ${tablesSeen} tables, ${refsChecked} column references — every selected column exists`
  : `${failed} problem(s)`)
process.exit(failed ? 1 : 0)

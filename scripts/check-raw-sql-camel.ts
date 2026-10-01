// CI guard: a module that reads rows with raw SQL must not change the shape of its own API.
//
// Postgres answers in snake_case. Every screen in these products reads camelCase. So each module
// that reaches for `db.execute(sql`…`)` instead of Drizzle's query builder has to map its rows, and
// four of them grew a PRIVATE copy of the same four lines to do it:
//
//   tasks       a blank due date
//   takeoffs    T32 B5 (a BLOCKER): blank material names, NaN quantities, $NaN costs
//   selections  T32 L7: no due date, no chosen product, no price difference
//   recurring   T32 L7: next_run_date / auto_send / day_of_month, and a `next_run_date` key
//               returned from the same object as camelCase ones
//
// Three copies existed and the fourth module never got one, which is the whole argument for this
// guard: the fix is now ONE implementation in packages/tenant-backend/src/sqlRows.ts, and a fifth
// private copy is the thing to prevent.
//
//   bun scripts/check-raw-sql-camel.ts
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { stripSource } from './lib/stripComments.ts'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
/**
 * CODE only, comments removed.
 *
 * Every one of the defects below is DOCUMENTED in the file that used to have it, which means the
 * broken expression appears in the source as prose. The first version of this guard failed on
 * correct code because it read my own comment quoting `price_difference !== 0`. Same shape as the
 * dark-mode guard that read a comment as a className.
 */
const code = (p: string) => stripSource(read(p))
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// ── the one implementation ───────────────────────────────────────────────────────────────────────
const lib = read('packages/tenant-backend/src/sqlRows.ts')
if (!lib) fail('packages/tenant-backend/src/sqlRows.ts is missing — the shared raw-row reader')
else {
  if (!/export const rowsOf/.test(lib)) fail('sqlRows must export rowsOf (both driver shapes)')
  if (!/export function camelRow/.test(lib)) fail('sqlRows must export camelRow')
  if (!/export const camelRows/.test(lib)) fail('sqlRows must export camelRows')

  // Nesting is opt-in. A blanket recursion would rename the keys INSIDE a json column holding the
  // user's own data (`available_options` sits on the same row as `selected_option`), and there is no
  // way to tell a table row from user data by looking at the value.
  if (!/nested: readonly string\[\] = \[\]/.test(lib)) fail('camelRow must take an explicit `nested` list, never recurse blindly — a json column holds user data')

  // A `timestamp` column arrives as "2026-10-15 00:00:00" with no zone, so a browser reads it in
  // the VIEWER's zone and a date set for the 15th shows as the 14th west of the server.
  if (!/PG_TIMESTAMP/.test(lib)) fail('sqlRows must convert naive timestamp strings to instants')
  if (!/\[ T\]/.test(lib)) fail("…matching only values WITH a time part, so a `date` column's calendar day is not turned into an instant")
}

// ── and nobody keeps a private one ───────────────────────────────────────────────────────────────
const MODULES = [
  'packages/tenant-backend/src/tasks/tasks.ts',
  'packages/tenant-backend/src/recurring/recurring.ts',
  'templates/crm/backend/src/services/selections.ts',
  'templates/crm/backend/src/services/takeoffs.ts',
]
for (const p of MODULES) {
  if (!existsSync(join(ROOT, p))) { fail(`${p} is missing`); continue }
  const src = code(p)
  const name = p.split('/').pop()

  if (!/\bcamelRow\b|\bcamelRows\b/.test(src)) fail(`${name}: reads rows with raw SQL and never camelises them — the screen reads camelCase`)
  if (!/from '\.\.\/sqlRows'|from '\.\.\/shared\/index\.ts'/.test(src)) fail(`${name}: must take the row reader from the shared module, not define its own`)
  // The private copies this replaced.
  if (/function rows\(result: any\): any\[\] \{/.test(src)) fail(`${name}: still defines its own rows() — import rowsOf from the shared reader`)
  if (/const toCamel = \(row/.test(src)) fail(`${name}: still defines its own row camelisor — that is copy number five`)
}

// ── the specific symptoms the report named, at the specific places ───────────────────────────────
const sel = code('templates/crm/backend/src/services/selections.ts')
if (sel) {
  if (/sel\.selected_option\b|sel\.due_date\b/.test(sel)) fail('selections: the summary and list read the camelised row now — sel.selected_option / sel.due_date are undefined')
  // numeric(12,2) comes back as a STRING, so `!== 0` was never false and a selection landing exactly
  // on its allowance raised a $0.00 "Selection Credit" change order.
  if (/price_difference !== 0/.test(sel)) fail('selections: comparing a decimal STRING with 0 raises a $0.00 change order for a selection on its allowance')
  if (!/Math\.abs\(diff\) >= 0\.005/.test(sel)) fail('…compare it as a number, with a half-cent tolerance')
}
const tak = code('templates/crm/backend/src/services/takeoffs.ts')
if (tak) {
  // getAssembly answers camelCase; addTakeoffItem read assembly.measurement_type and got undefined,
  // which collapsed two sql placeholders into "syntax error at or near ,".
  if (/assembly\.measurement_type|assembly\.waste_factor/.test(tak)) fail('takeoffs: addTakeoffItem must read getAssembly\'s camelCase keys, or its INSERT builds broken SQL')
}
const rec = code('packages/tenant-backend/src/recurring/recurring.ts')
if (rec) {
  if (/next_run_date: nextRunDate/.test(rec)) fail('recurring: a response must not carry a snake_case key beside camelCase ones')
  // pause/resume/cancel all go through this one function; the three named ones are unused aliases.
  if (!/return camelRow\(updated\)/.test(rec)) fail('recurring: updateRecurringStatus is the real pause/resume/cancel path and must camelise what it returns')
}

if (failed) { console.error(`\nraw-sql camel: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`raw-sql camel: one shared row reader, used by ${MODULES.length} raw-SQL modules, with nesting opt-in and naive timestamps converted`)

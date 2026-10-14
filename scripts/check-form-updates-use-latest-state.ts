// CI guard: a form update is built from the LATEST form, never the one captured when the screen last drew.
//
// E2E run 1 (10/14): a field user ticked "Reimburse me" on an expense and it was not saved. The server kept the tick
// (tests/crm/expense-reimburse-tick proves it); the screen lost it. Every handler wrote setForm({ ...form, x }) — a
// copy of the form as of the last render — so two changes before a redraw and the second overwrote the first. That
// shape was in 159 places across 21 shared screens; all now write setForm((f) => ({ ...f, x })).
//
// The rule, for the shared screens every CRM ships (packages/tenant-ui): no state setter is called with an object that
// spreads the same state variable it sets — setForm({ ...form, … }), setDraft({ ...draft, … }) and the like.
//   bun scripts/check-form-updates-use-latest-state.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const walk = (d: string): string[] => readdirSync(ROOT + d).flatMap((n) => {
  const p = d + '/' + n
  return statSync(ROOT + p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : []
})
let failed = 0, files = 0
for (const f of walk('packages/tenant-ui/src')) {
  files++
  const src = readFileSync(ROOT + f, 'utf8')
  // set<Name>({ ...<name>, … }) where <name> is the setter's own state (setForm/form, setDraft/draft, …)
  for (const m of src.matchAll(/\bset([A-Z]\w*)\(\{\s*\.\.\.(\w+)\s*,/g)) {
    const state = m[1][0].toLowerCase() + m[1].slice(1)
    if (m[2] !== state) continue
    const line = src.slice(0, m.index).split('\n').length
    failed++
    console.error(`FAIL: ${f}:${line} set${m[1]}({ ...${m[2]}, … }) builds from a stale copy — write set${m[1]}((s) => ({ ...s, … }))`)
  }
}
if (failed) { console.error(`\nform updates use latest state: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`form updates use latest state: ${files} file(s) in packages/tenant-ui, no setter spreads a stale copy of its own state`)

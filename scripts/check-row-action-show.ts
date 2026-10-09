// CI guard: a row-action table must honour `show`, and closing its menu must not open the row.
//
// ── why this guard exists ───────────────────────────────────────────────────────────────────────
//
// T56 R1, a High, and both halves of it were silent failures in the same component.
//
// 1. `show` that nothing reads. The shared table in packages/tenant-ui has filtered row actions per
//    row for a long time. crm-dispensary carries its own copy of DataTable and that copy had no
//    `show` at all — so the T55 fix "hide Delete on a customer row from a budtender, who always
//    gets a 403" compiled, shipped, and did nothing for a whole round. Nobody could see it: the
//    prop was accepted by an untyped array literal, rendered, and ignored.
//
// 2. A dismissal that navigates. That same copy closed its menu with a full-screen `<div onClick>`
//    rendered INSIDE the row, and the click bubbled to the row's own onClick — so opening the ⋮ on
//    the Customers list and clicking anywhere to close it took you into the customer's page. Add a
//    dead Edit link on that page and the whole product reads as "nobody can edit a customer".
//
// ── the rule ────────────────────────────────────────────────────────────────────────────────────
//
// For every component that renders a row-action menu (it maps over `actions` and renders their
// onClick):
//   · it must filter on `show` before rendering, so a page can hide an action it cannot use;
//   · it must not dismiss that menu with an onClick backdrop rendered inside the row, unless that
//     handler stops propagation — otherwise "close the menu" means "open the record".
// And every page that passes `show:` to a table must import a table that honours it.
//
//   bun scripts/check-row-action-show.ts
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
/**
 * crm-automotive is NOT skipped here, and it is the only guard where it is not.
 *
 * It is parked, so most guards leave it alone. But it renders its own copy of this table on eight
 * pages with onRowClick set, which made the "closing the menu opens the record" fault live in a
 * product nobody is maintaining — the worst place for it, because nobody is looking. It was fixed on
 * an explicit instruction to touch this template, and once fixed it belongs inside the rule: a
 * parked template is exactly the one that will quietly drift back.
 */
const SKIP = new Set(['node_modules', 'dist', 'build', '.git'])

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (SKIP.has(e)) continue
    const p = join(dir, e)
    let st; try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (e.endsWith('.tsx') || e.endsWith('.ts')) out.push(p)
  }
  return out
}
// The ONE comment stripper (scripts/lib/stripComments.ts): string-aware, so a route pattern like
// '/file/*' or a `src/**` in a line comment cannot pair with a later `*/` and delete real code. (T57)
import { stripSource as strip } from './lib/stripComments.ts'

const files = [...walk(join(ROOT, 'templates')), ...walk(join(ROOT, 'packages'))]

// ── 1. every row-action renderer honours `show` and dismisses without bubbling ──────────────────
const tables: string[] = []
for (const f of files) {
  const src = strip(readFileSync(f, 'utf8').replace(/\r\n/g, '\n'))
  // A row-action menu: it maps over the actions it was handed and calls their onClick.
  // It is handed `actions`, walks them, and calls one when clicked. The name of the loop variable
  // differs between the forks and the shared table, so match the call rather than the name.
  const rendersActions = /\bactions\b[\s\S]{0,400}?\.(?:map|filter)\(/.test(src) && /\.onClick\(\s*\w/.test(src)
  if (!rendersActions) continue
  tables.push(f)
  const rel = relative(ROOT, f).replace(/\\/g, '/')

  if (!/\.show\b/.test(src)) {
    fail(`${rel} renders row actions but never reads \`show\` — a page hiding an action it cannot use is ignored. Filter the list per row, the way packages/tenant-ui/src/invoicing/ui.tsx does.`)
  }
  // A backdrop inside the row: `<div className="fixed inset-0 …" onClick={…}` whose handler does
  // not stop the click reaching the row underneath.
  //
  // A file that closes its menu on a document listener is not using a backdrop for that at all —
  // the `fixed inset-0` in it belongs to a modal, which is the correct use and sits outside any row.
  const closesOnDocument = /document\.addEventListener\(\s*'(?:mousedown|click)'/.test(src)
  const backdrops = closesOnDocument ? [] : (src.match(/<div[^>]*fixed inset-0[^>]*onClick=\{[^}]*\}/g) || [])
  for (const b of backdrops) {
    if (!/stopPropagation/.test(b)) {
      fail(`${rel} closes its row menu with a full-screen onClick backdrop that does not stop propagation — the click reaches the row's own onClick and opens the record. Close on a document listener instead.`)
    }
  }
}
if (tables.length === 0) fail('no row-action table found at all — this guard has stopped looking at anything')

// ── 2. a page passing `show:` must be handing it to a table that honours it ─────────────────────
const honours = new Set(tables.filter((f) => /\.show\b/.test(strip(readFileSync(f, 'utf8')))))
for (const f of files) {
  const src = strip(readFileSync(f, 'utf8').replace(/\r\n/g, '\n'))
  // `show:` inside something that also carries onClick — i.e. a row action, not a random object.
  if (!/\bshow:\s*\(/.test(src) || !/\bonClick:/.test(src)) continue
  const imp = src.match(/import\s*\{[^}]*\bDataTable\b[^}]*\}\s*from\s*'([^']+)'/)
  if (!imp) continue
  const spec = imp[1]
  if (!spec.startsWith('.')) continue // a package import — the shared table, which honours it
  const base = resolve(dirname(f), spec)
  const target = ['.tsx', '.ts', '/index.tsx', '/index.ts'].map((e) => base + e).find((p) => existsSync(p))
  if (!target) continue
  if (!honours.has(target) && /\bactions\b/.test(strip(readFileSync(target, 'utf8')))) {
    fail(`${relative(ROOT, f).replace(/\\/g, '/')} passes \`show\` to ${relative(ROOT, target).replace(/\\/g, '/')}, which ignores it — the control stays on screen and answers 403.`)
  }
}

// ── 3. the ⋮ itself follows the filter: no button on a row with nothing to offer ──────────────────
//
// T60: "Team rows show a 'Row actions' (⋮) button that opens nothing" — six tenants. The shared table
// filtered the MENU on `show` (rule 1 held) but drew the BUTTON whenever the page defined any action at
// all, so for a manager, whose every Team action is the owner's, each row opened an empty menu. The
// button must be conditional on the same per-row count the menu renders.
//
// crm-automotive is exempt from THIS rule only: it is parked (CLAUDE.md — do not modify it), and its
// copy was not changed in T60. Rules 1 and 2 still hold it.
let buttons = 0
for (const f of files) {
  const rel = relative(ROOT, f).replace(/\\/g, '/')
  if (rel.startsWith('templates/crm-automotive/')) continue
  const src = strip(readFileSync(f, 'utf8').replace(/\r\n/g, '\n'))
  let at = src.indexOf('aria-label="Row actions"')
  while (at >= 0) {
    buttons++
    // What stands immediately before this <button>: it must be a PER-ROW count — `something(row).length
    // > 0 &&` — because `actions.length > 0 &&` is the page-wide test that was the bug.
    const open = src.lastIndexOf('<button', at)
    const lead = src.slice(Math.max(0, open - 160), open)
    if (!/\(\s*row\s*\)\.length\s*>\s*0\s*&&\s*\(?\s*$/.test(lead)) {
      fail(`${rel}: a "Row actions" button is drawn without checking that this row has an action — an empty ⋮ reads as broken. Wrap it in {rowActions(row).length > 0 && …}.`)
    }
    at = src.indexOf('aria-label="Row actions"', at + 1)
  }
}
if (buttons < 4) fail(`only ${buttons} "Row actions" button(s) found — expected the shared table (twice), the crm and dispensary forks`)

console.log(failed === 0
  ? `OK: ${tables.length} row-action table(s) filter on \`show\` and dismiss without opening the row; ${buttons} ⋮ button(s) appear only when the row has an action`
  : `${failed} problem(s)`)
process.exit(failed ? 1 : 0)

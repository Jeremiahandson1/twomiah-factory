// CI guard: the expense categories a template's SCREEN falls back to must be the ones its SERVER
// accepts.
//
// ── why this guard exists ───────────────────────────────────────────────────────────────────────
//
// RR7 X1 was a High: the form offered the shared contractor categories while the salon's server
// accepted stock / retail / tools / …, so pressing Save on the form as it opened answered 400. The
// fix was to have the form ASK the server (GET /api/expenses/categories) — one list, no copies.
//
// RR8 Y2 is the hole left in that: when that one request fails — a cold start on Render is enough —
// the form falls back to whatever the template configured, and the salon configured nothing, so the
// fallback was the contractor list again and X1 came back for that visit.
//
// So the fallback now mirrors the server's list, which means the list exists twice, which is the
// thing X1 was about. The copy is only safe if it cannot drift, and that is what this checks:
//
//   · a backend passing `options.categories` → the frontend's expensesConfig must declare the SAME
//     ids, in the same order, with the same labels where the backend gives `categoryLabels`;
//   · a backend passing none (it uses the shared DEFAULT_EXPENSE_CATEGORIES) → the frontend must
//     declare none either, so its fallback is that same shared default.
//
//   bun scripts/check-expense-categories-mirror.ts
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** The ids in `options: { categories: [...] }`, or null when the route passes no options. */
function backendCategories(src: string): { ids: string[] | null; labels: Record<string, string> } {
  const cats = src.match(/categories:\s*\[([^\]]*)\]/)
  const ids = cats ? [...cats[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] || m[2]) : null
  const labels: Record<string, string> = {}
  const lab = src.match(/categoryLabels:\s*\{([\s\S]*?)\}/)
  if (lab) for (const m of lab[1].matchAll(/([A-Za-z0-9_-]+)\s*:\s*'([^']*)'/g)) labels[m[1]] = m[2]
  return { ids, labels }
}

/** The `{ value, label }` pairs in expensesConfig.categories, or null when it declares none. */
function frontendCategories(src: string): Array<{ value: string; label: string }> | null {
  const cfg = src.match(/export const expensesConfig[^=]*=\s*\{([\s\S]*?)\n\}/)
  const body = cfg ? cfg[1] : src.match(/export const expensesConfig[^=]*=\s*\{([^}]*)\}/)?.[1]
  if (!body || !/categories:/.test(body)) return null
  const list = body.match(/categories:\s*\[([\s\S]*?)\]/)
  if (!list) return null
  return [...list[1].matchAll(/\{\s*value:\s*'([^']+)'\s*,\s*label:\s*'([^']*)'\s*\}/g)]
    .map((m) => ({ value: m[1], label: m[2] }))
}

/** The server's own display rule for an id with no configured label. */
const titleCase = (v: string) => v.replace(/[_-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())

let checked = 0
for (const t of readdirSync(join(ROOT, 'templates'))) {
  if (t === 'crm-automotive') continue
  const route = join(ROOT, 'templates', t, 'backend/src/routes/expenses.ts')
  const cfgPath = join(ROOT, 'templates', t, 'frontend/src/peopleConfig.ts')
  if (!existsSync(route) || !existsSync(cfgPath)) continue
  checked++
  const { ids, labels } = backendCategories(strip(readFileSync(route, 'utf8')))
  const front = frontendCategories(strip(readFileSync(cfgPath, 'utf8')))

  if (ids === null) {
    if (front !== null) {
      fail(`${t}: the screen configures its own expense categories but the server passes none — the server would refuse them. Either give the route options.categories or drop the list from peopleConfig.ts.`)
    }
    continue
  }
  if (front === null) {
    fail(`${t}: the server accepts [${ids.join(', ')}] and peopleConfig.ts configures no categories, so a failed /api/expenses/categories leaves the form offering the shared contractor list — and every Save answers 400. (RR8 Y2)`)
    continue
  }
  const fids = front.map((c) => c.value)
  if (fids.join('|') !== ids.join('|')) {
    fail(`${t}: the screen's fallback categories do not match the server's.\n        server: ${ids.join(', ')}\n        screen: ${fids.join(', ')}`)
    continue
  }
  for (const c of front) {
    const expected = labels[c.value] || titleCase(c.value)
    if (c.label !== expected) {
      fail(`${t}: the label for "${c.value}" differs — the server would show "${expected}", the offline fallback shows "${c.label}".`)
    }
  }
}

if (checked === 0) fail('no template with both an expenses route and a peopleConfig was found — this guard has stopped looking at anything')
console.log(failed === 0
  ? `OK: ${checked} template(s) — the screen's fallback expense categories match the server's`
  : `${failed} problem(s)`)
process.exit(failed ? 1 : 0)

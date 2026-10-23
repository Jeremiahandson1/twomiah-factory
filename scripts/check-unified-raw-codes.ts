// CI guard: a stored code is never the words on a screen (roofing live test 2026-10-22: "in_production",
// "final_inspection", "Status changed: invoiced → collected"; landscaping and home care saw lowercase codes on badges and
// filters).
//
// Statuses, stages, types, kinds, priorities, sources, roles, tiers, frequencies, methods and outcomes are stored as codes
// ('in_production', 'percent_of_invoice'). What a person reads goes through the one rule, codeLabel() in
// packages/tenant-ui/src/labels/codes.ts — the vertical's own words first (screens.codeLabels), then the shared ones, then
// the code made readable. This walks every screen of the unified admin and the shared screens with the TypeScript
// parser and fails on:
//   · a code printed as it is: a JSX child that is just `{row.status}` (or `.stage`, `.type`, … — a property of that name);
//   · a list of codes printed as they are: `{LIST.map((s) => <option …>{s}</option>)}` where the list is named for
//     statuses, stages, types, kinds, priorities, roles or tiers.
// A code passed to StatusBadge (which applies the rule) or used in a key, a value or a class is not printed, and passes.
//   bun scripts/check-unified-raw-codes.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const ROOT = join(import.meta.dir, '..')
const ts = createRequire(join(ROOT, 'apps/unified/package.json'))('typescript') as typeof import('typescript')
const DIRS = ['apps/unified/web/src', 'packages/tenant-ui/src']
const CODE = /^(status|stage|type|kind|priority|source|role|tier|frequency|method|outcome|billingFrequency|planType|jobType|serviceType|eventType|visitType|careType|appliesToRole|autoEarn|sourcePlatform|recurrence)$/
const CODE_LIST = /(status|stage|type|kind|priorit|role|tier)(es|s)?$/i

let failed = 0, files = 0, checked = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }
const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((name) => {
  if (name === 'node_modules' || name === 'dist') return []
  const rel = dir + '/' + name
  return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : /\.tsx$/.test(name) && !/\.test\./.test(name) ? [rel] : []
})

const nameOf = (e: import('typescript').Expression): string | null => {
  if (ts.isPropertyAccessExpression(e)) return e.name.text
  if (ts.isElementAccessExpression(e) && ts.isStringLiteral(e.argumentExpression)) return e.argumentExpression.text
  if (ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e)) return nameOf(e.expression)
  return null
}
const listName = (e: import('typescript').Expression): string | null => {
  if (ts.isIdentifier(e)) return e.text
  if (ts.isPropertyAccessExpression(e)) return e.name.text
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) return listName(e.expression.expression) // .filter(…).map
  return null
}

for (const d of DIRS) {
  let list: string[] = []
  try { list = walk(d) } catch { fail(d + ' is missing — fix this guard\'s walk') }
  for (const rel of list) {
    files++
    const src = readFileSync(join(ROOT, rel), 'utf8')
    const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const at = (n: import('typescript').Node) => `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`
    const visit = (n: import('typescript').Node) => {
      // {row.status} as a child of an element: printed as stored.
      if (ts.isJsxExpression(n) && n.expression && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) {
        checked++
        const name = nameOf(n.expression)
        if (name && CODE.test(name)) fail(`${at(n)}: {…${name}} prints a stored code — show it through codeLabel() (labels/codes.ts)`)
      }
      // LIST.map((s) => <option …>{s}</option>): each code printed as stored.
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'map') {
        const lname = listName(n.expression.expression)
        const fn = n.arguments[0]
        if (lname && CODE_LIST.test(lname) && fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && fn.parameters[0] && ts.isIdentifier(fn.parameters[0].name)) {
          const param = fn.parameters[0].name.text
          const inner = (m: import('typescript').Node) => {
            if (ts.isJsxElement(m) && m.openingElement.tagName.getText(sf) === 'option') {
              for (const ch of m.children) if (ts.isJsxExpression(ch) && ch.expression && ts.isIdentifier(ch.expression) && ch.expression.text === param) {
                fail(`${at(ch)}: <option>{${param}}</option> over ${lname} prints each stored code — show it through codeLabel() (labels/codes.ts)`)
              }
            }
            ts.forEachChild(m, inner)
          }
          inner(fn.body)
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
}
if (files < 300) fail(`only ${files} screens under ${DIRS.join(', ')} — fix this guard's walk`)
if (checked < 3000) fail(`only ${checked} JSX children checked — fix this guard's walk`)
if (failed) { console.error(`\n${failed} code(s) printed as stored.`); process.exit(1) }
console.log(`OK — ${files} screens, ${checked} JSX children: no stored code printed as it is.`)

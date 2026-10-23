// CI guard: money's sign goes before the dollar sign — "-$200.00", never "$-200.00" (live test 2026-10-22, contractor:
// a selection credit read "$-200.00").
//
// The screens printed money by gluing a "$" to a number they had formatted themselves — `$${n.toFixed(2)}`,
// `<td>${n.toLocaleString(…)}</td>`, `'$' + n.toFixed(2)` — and every one of them printed "$-…" for a negative amount.
// They all call the one formatter now, packages/tenant-ui/src/money.ts (money / moneyCents / signedMoney). This fails on
// any "$" glued to a toFixed / toLocaleString result in the unified admin or the shared screens. Read by the TypeScript
// parser, so a template's own `${` is never taken for a dollar sign. A "$" before a raw value (a rate, a price as the
// server sent it) is not money this screen formatted and is not flagged.
//   bun scripts/check-unified-money-sign.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const ts = (await import(join(ROOT, 'apps/unified/node_modules/typescript/lib/typescript.js'))).default as typeof import('typescript')
const DIRS = ['apps/unified/web/src', 'packages/tenant-ui/src']
let failed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }

const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((name) => {
  if (name === 'node_modules' || name === 'dist') return []
  const rel = dir + '/' + name
  return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [rel] : []
})

/** n.toFixed(…) / n.toLocaleString(…), through parentheses and a trailing `|| 0`. */
const selfFormatted = (e: import('typescript').Expression): boolean => {
  while (ts.isParenthesizedExpression(e)) e = e.expression
  if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.BarBarToken || e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) return selfFormatted(e.left)
  return ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && ['toFixed', 'toLocaleString'].includes(e.expression.name.text)
}

let files: string[] = []
for (const d of DIRS) { try { files.push(...walk(d)) } catch { fail(d + ' is missing — fix this guard\'s walk') } }
if (files.length < 200) fail(`only ${files.length} files under ${DIRS.join(', ')} — fix this guard's walk`)

for (const rel of files) {
  if (rel.endsWith('/money.ts')) continue
  const text = readFileSync(join(ROOT, rel), 'utf8')
  if (!text.includes('$')) continue
  const src = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const at = (n: import('typescript').Node) => `${rel}:${src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1}`
  const say = (n: import('typescript').Node) => fail(`${at(n)} glues "$" to a number it formatted itself, so a negative amount prints "$-…": use money() from packages/tenant-ui/src/money.ts — ${n.getText(src).slice(0, 100)}`)
  const visit = (node: import('typescript').Node) => {
    if (ts.isTemplateExpression(node)) {
      let prev: { text: string } = node.head
      for (const span of node.templateSpans) { if (prev.text.endsWith('$') && selfFormatted(span.expression)) say(span.expression); prev = span.literal }
    }
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const kids = node.children
      for (let k = 0; k + 1 < kids.length; k++) {
        const a = kids[k], b = kids[k + 1]
        if (ts.isJsxText(a) && a.text.endsWith('$') && ts.isJsxExpression(b) && b.expression && selfFormatted(b.expression)) say(b.expression)
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken && (ts.isStringLiteral(node.left) || ts.isNoSubstitutionTemplateLiteral(node.left)) && node.left.text.endsWith('$') && selfFormatted(node.right)) say(node)
    ts.forEachChild(node, visit)
  }
  visit(src)
}

if (failed) { console.error(`\n${failed} problem(s).`); process.exit(1) }
console.log(`OK — ${files.length} files: no "$" glued to a self-formatted number.`)

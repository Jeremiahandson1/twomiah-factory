/**
 * GUARD: phone-only chrome (a fixed bar or drawer styled only inside a max-width query) is hidden above that width.
 *
 * Home care's caregiver screen renders its bottom nav and More drawer on every screen. Every rule that styled them sat
 * inside `@media (max-width: 768px)`, so on a laptop they printed as a block of unstyled links across the top of the
 * page — E2E Run 3 (10/16), screenshots of /crm/settings. The office screen escaped only through a one-time
 * window.innerWidth check.
 *
 * THE RULE, for every template frontend stylesheet imported by src/main.tsx: a class whose ONLY rules are inside
 * `@media (max-width: N)` blocks and which is `position: fixed` there is phone chrome. If any .tsx uses it, the
 * stylesheet must hide it (display: none) inside a `@media (min-width: M)` block with M <= N + 1. The walk finds
 * templates by their stylesheet; after it, this file mutation-tests itself.
 *
 *   bun scripts/check-phone-chrome-hidden-on-desktop.ts
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'fs'

const ROOT = (process.argv[2] || process.cwd()).replace(/\\/g, '/').replace(/\/$/, '')
const PARKED = new Set(['crm-automotive'])
const rd = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

type Rule = { selectors: string; body: string; media: string | null }

/** Flatten a stylesheet into rules, each tagged with its enclosing @media prelude (one level, as these files use). */
export function rules(css: string): Rule[] {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Rule[] = []
  let i = 0
  const block = (from: number): number => { let d = 0; for (let j = from; j < c.length; j++) { if (c[j] === '{') d++; else if (c[j] === '}' && --d === 0) return j } return c.length }
  while (i < c.length) {
    const open = c.indexOf('{', i)
    if (open < 0) break
    const prelude = c.slice(i, open).trim()
    const close = block(open)
    if (prelude.startsWith('@media')) {
      const inner = c.slice(open + 1, close)
      for (const r of rules(inner)) out.push({ ...r, media: prelude })
    } else if (!prelude.startsWith('@')) {
      out.push({ selectors: prelude, body: c.slice(open + 1, close), media: null })
    }
    i = close + 1
  }
  return out
}

const maxW = (m: string | null) => { const x = m?.match(/max-width\s*:\s*(\d+)px/); return x && !/min-width/.test(m!) ? +x[1] : null }
const minW = (m: string | null) => { const x = m?.match(/min-width\s*:\s*(\d+)px/); return x && !/max-width/.test(m!) ? +x[1] : null }
const classesOf = (sel: string) => [...sel.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1])
/** The class a selector list styles directly: the LAST compound of each selector, e.g. `.a .b:hover` → b. */
const subjects = (sel: string) => sel.split(',').map((s) => { const parts = s.trim().split(/\s+|>|\+|~/).filter(Boolean); const last = parts[parts.length - 1] || ''; return (last.match(/^\.([a-zA-Z_][\w-]*)/) || [])[1] }).filter(Boolean) as string[]

export function phoneChrome(css: string): Map<string, number> {
  const rs = rules(css)
  const outside = new Set<string>(), fixedAt = new Map<string, number>()
  for (const r of rs) {
    const w = maxW(r.media)
    for (const cl of subjects(r.selectors)) {
      if (w === null) { if (r.media === null || minW(r.media) === null) outside.add(cl) }
      else if (/position\s*:\s*fixed/.test(r.body)) fixedAt.set(cl, Math.max(fixedAt.get(cl) ?? 0, w))
    }
  }
  for (const cl of outside) fixedAt.delete(cl)
  return fixedAt
}

export function hiddenAbove(css: string, cl: string, n: number): boolean {
  return rules(css).some((r) => { const m = minW(r.media); return m !== null && m <= n + 1 && subjects(r.selectors).includes(cl) && /display\s*:\s*none/.test(r.body) })
}

export function check(css: string, tsx: string): string[] {
  const fails: string[] = []
  for (const [cl, n] of phoneChrome(css)) {
    if (!new RegExp(`["'\`\\s]${cl}(["'\`\\s$]|$)`).test(tsx)) continue
    if (!hiddenAbove(css, cl, n)) fails.push(`.${cl} is fixed phone chrome styled only under max-width ${n}px and rendered by a component, but nothing hides it at min-width ${n + 1}px`)
  }
  return fails
}

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === 'dist') continue
    const p = `${dir}/${f}`
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx|jsx)$/.test(f)) out.push(p)
  }
  return out
}

let failed = 0, templates = 0, chrome = 0
for (const t of readdirSync(`${ROOT}/templates`)) {
  if (PARKED.has(t)) continue
  const front = `${ROOT}/templates/${t}/frontend`
  const main = `${front}/src/main.tsx`
  if (!existsSync(main)) continue
  const css = [...rd(main).matchAll(/import\s+['"](\.\/[^'"]+\.css)['"]/g)].map((m) => `${front}/src/${m[1].slice(2)}`).filter(existsSync).map(rd).join('\n')
  if (!css) continue
  templates++
  const tsx = walk(`${front}/src`).map(rd).join('\n')
  chrome += phoneChrome(css).size
  for (const msg of check(css, tsx)) { failed++; console.log(`FAIL ${t}: ${msg}`) }
}

// ── mutation self-test ──
const BAR = '@media (max-width: 768px) {\n  .bottom-nav { display: flex; position: fixed; bottom: 0; }\n  .bottom-nav-item { color: red; }\n}\n'
const USE = '<nav className="bottom-nav"><button className="bottom-nav-item">'
const self: [string, string, string, boolean][] = [
  ['phone bar with no desktop hide (the Run 3 fault)', BAR, USE, true],
  ['hidden at min-width 769', BAR + '@media (min-width: 769px) { .bottom-nav { display: none; } }', USE, false],
  ['hidden only at a wider min-width leaves a gap', BAR + '@media (min-width: 1024px) { .bottom-nav { display: none; } }', USE, true],
  ['also styled outside any query: not phone-only', '.bottom-nav { display: none; }\n' + BAR, USE, false],
  ['not rendered anywhere', BAR, '<div className="other">', false],
]
for (const [name, css, tsx, shouldFail] of self) {
  if ((check(css, tsx).length > 0) !== shouldFail) { failed++; console.log(`FAIL self-test "${name}": expected ${shouldFail ? 'a failure' : 'a pass'}`) }
}

console.log(`${failed ? 'FAIL' : 'ok'} phone chrome: ${templates} template stylesheet(s), ${chrome} phone-only fixed class(es), ${self.length} self-tests`)
process.exit(failed ? 1 : 0)

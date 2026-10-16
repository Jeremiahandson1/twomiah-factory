/**
 * GUARD: a pop-up's classes exist in the stylesheet the app loads, and a `.modal` that is hidden until `.active`
 * always carries `active`.
 *
 * Home care's index.css hides `.modal` (display: none) unless it is also `.active`. Fourteen pop-ups were written in a
 * second idiom, `<div className="modal-overlay"><div className="modal">`. `.modal-overlay` was defined nowhere, and
 * the inner `.modal` was hidden. So Add Payer, Edit Payer, Add Office User, Add Family Member, ⏸ Service and the SMS,
 * alert, authorization and open-shift forms opened invisibly: state set, nothing on screen, no request. E2E Run 3
 * (10/16) found five blockers and a dead-control list behind that one cause.
 *
 * THE RULES, for every template frontend whose loaded stylesheet (the .css files imported by src/main.tsx) defines
 * `.modal`:
 *   1. every class token in a className literal that is `modal` or starts `modal-` is a selector in that
 *      stylesheet: a class with no CSS is a pop-up that renders unstyled, or not at all;
 *   2. where the stylesheet hides `.modal` until `.modal.active`, every className literal holding the `modal` token
 *      also holds `active`.
 * The walk finds templates by the stylesheet, so a second template that adopts `.modal` is held to this the day it
 * does. After the real walk this file mutation-tests itself.
 *
 *   bun scripts/check-modal-classes-defined.ts
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'fs'

const ROOT = (process.argv[2] || process.cwd()).replace(/\\/g, '/').replace(/\/$/, '')
const PARKED = new Set(['crm-automotive'])
const rd = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === 'dist') continue
    const p = `${dir}/${f}`
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx|jsx)$/.test(f)) out.push(p)
  }
  return out
}

/** Class tokens of every className="…" / '…' / `…` literal (template-literal ${…} parts removed), with its line. */
export function classLiterals(src: string): { tokens: string[]; line: number }[] {
  const out: { tokens: string[]; line: number }[] = []
  const re = /className=\{?\s*(["'`])((?:(?!\1)[\s\S])*)\1/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const body = m[2].replace(/\$\{[^}]*\}/g, ' ')
    out.push({ tokens: body.split(/\s+/).filter(Boolean), line: src.slice(0, m.index).split('\n').length })
  }
  return out
}

export function definedClasses(css: string): Set<string> {
  const s = new Set<string>()
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of noComments.matchAll(/\.([a-zA-Z_][\w-]*)/g)) s.add(m[1])
  return s
}

export function hidesModalUntilActive(css: string): boolean {
  const c = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const base = c.match(/(^|\n)\s*\.modal\s*\{([^}]*)\}/)
  return !!base && /display\s*:\s*none/.test(base[2]) && /\.modal\.active\s*\{/.test(c)
}

export function check(files: { path: string; src: string }[], css: string): string[] {
  const defined = definedClasses(css)
  const hidden = hidesModalUntilActive(css)
  const fails: string[] = []
  for (const f of files) {
    for (const lit of classLiterals(f.src)) {
      for (const t of lit.tokens) {
        if ((t === 'modal' || t.startsWith('modal-')) && !defined.has(t)) fails.push(`${f.path}:${lit.line} class "${t}" has no CSS in the loaded stylesheet`)
      }
      if (hidden && lit.tokens.includes('modal') && !lit.tokens.includes('active')) fails.push(`${f.path}:${lit.line} "modal" without "active" is display:none — the pop-up never shows`)
    }
  }
  return fails
}

function loadedCss(front: string): string | null {
  const main = `${front}/src/main.tsx`
  if (!existsSync(main)) return null
  const imports = [...rd(main).matchAll(/import\s+['"](\.\/[^'"]+\.css)['"]/g)].map((m) => `${front}/src/${m[1].slice(2)}`)
  const css = imports.filter(existsSync).map(rd).join('\n')
  return /(^|\n|\})\s*\.modal\s*[{,]/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')) ? css : null
}

let failed = 0, templates = 0, literals = 0
for (const t of readdirSync(`${ROOT}/templates`)) {
  if (PARKED.has(t)) continue
  const front = `${ROOT}/templates/${t}/frontend`
  if (!existsSync(front)) continue
  const css = loadedCss(front)
  if (!css) continue
  templates++
  const files = walk(`${front}/src`).map((p) => ({ path: p.slice(ROOT.length + 1), src: rd(p) }))
  literals += files.reduce((n, f) => n + classLiterals(f.src).filter((l) => l.tokens.some((x) => x === 'modal' || x.startsWith('modal-'))).length, 0)
  for (const msg of check(files, css)) { failed++; console.log('FAIL ' + msg) }
}
if (templates === 0) { failed++; console.log('FAIL no template defines .modal — the walk found nothing to check') }

// ── mutation self-test: each planted fault must be caught, the fixed shape must pass ──
const CSS = '.modal { display: none; position: fixed; }\n.modal.active { display: flex; }\n.modal-content { background: white; }\n.close-btn, .modal-close { border: none; }'
const plant = (jsx: string) => check([{ path: 'x.tsx', src: jsx }], CSS)
const selfTests: [string, string, boolean][] = [
  ['the Run 3 idiom (overlay > modal)', '<div className="modal-overlay"><div className="modal" onClick={s}>', true],
  ['bare modal, no overlay', '<div className="modal">', true],
  ['modal in a template literal without active', '<div className={`modal ${x}`}>', true],
  ['an undefined modal-* class', '<div className="modal active"><div className="modal-dialog">', true],
  ['the house idiom', '<div className="modal active" onClick={c}><div className="modal-content"><button className="modal-close">', false],
  ['single-quoted house idiom', "<div className='modal active'>", false],
]
for (const [name, jsx, shouldFail] of selfTests) {
  const got = plant(jsx).length > 0
  if (got !== shouldFail) { failed++; console.log(`FAIL self-test "${name}": expected ${shouldFail ? 'a failure' : 'a pass'}`) }
}
if (hidesModalUntilActive('.modal { display: flex }') ) { failed++; console.log('FAIL self-test: a visible .modal read as hidden') }

console.log(`${failed ? 'FAIL' : 'ok'} modal classes: ${templates} template(s), ${literals} pop-up class literal(s), ${selfTests.length + 1} self-tests`)
process.exit(failed ? 1 : 0)

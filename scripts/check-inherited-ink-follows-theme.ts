// Text with no colour class of its own sits at the browser default — near-black — and Tailwind's
// preflight does not change that. Light mode never notices. The moment a theme toggle flips the shell
// to slate-900, every one of those elements is black on navy and gone: roof T18 D1 counted 51 on the
// invoice table alone, 18 on a claim page, 8 on the pipeline.
//
// The fix is one base rule, and most of the fleet already runs it:
//
//     @layer base { body { @apply text-gray-900 dark:text-slate-100 } }
//
// It has two companions, and both are load-bearing:
//
//   * form controls — preflight sets `color: inherit` on input/select/textarea, so when body ink goes
//     light, typed text goes light too, inside a field that is still white. Roof had 169 controls and
//     only 4 carried a dark variant.
//
//   * surfaces that stay light — a callout painted bg-green-50 with no `dark:bg-` partner keeps its
//     light background while the ink it never set follows the body. Those must pin their own
//     `text-gray-900`, or they invert: light ink on a light ground.
//
// This guard asserts the rule, the form-control companion, and that no stay-light surface leaves a
// text child on inherited ink.
//
// It deliberately does NOT copy crm-rv's `.bg-white { @apply text-gray-900 }` shortcut. Roof writes
// `bg-white dark:bg-slate-900` 184 times; that selector would force dark ink onto every one of those
// navy cards. The unit that matters is the surface that genuinely stays light, not the class name.
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', 'templates')

// ALL=1 ignores the allowlist, to audit what is still owed rather than what CI enforces.
const AUDIT = process.env.ALL === '1'

// Known-open, deliberately visible rather than silently skipped.
//
//   crm-homecare — parked pending the re-base from the live CVHC CRM; not to be touched meanwhile.
//                  Its 864 inline-styled elements are the bigger half of the same problem; see
//                  check-inline-styles-are-theme-aware.ts. It is also the one template carrying
//                  `dark:` classes with NO `darkMode: 'class'`, so Tailwind's default puts them on
//                  prefers-color-scheme: they fire off the visitor's OS with no toggle to stop them.
//
// Everything else this guard first reported has been fixed, so the list stays this short. crm-store
// is NOT here: it has no dark mode at all (see below), which is a different thing from having one
// that is broken.
const KNOWN_OPEN = new Set(['crm-homecare'])

/**
 * Does this template actually have a theme to break?
 *
 * Only `darkMode: 'class'` gives a toggle — the shell puts `dark` on <html> and the variants respond.
 * crm-store has no darkMode setting and not one `dark:` class in its source: nothing ever flips, so
 * there is no invisible text to prevent and demanding the base rule there would be cargo cult.
 * Skipping on that fact rather than by name means a template that GAINS a toggle is picked up
 * automatically, instead of sitting silently on an allowlist.
 */
const hasThemeToggle = (t: string) => {
  const cfg = join(ROOT, t, 'frontend', 'tailwind.config.js')
  return existsSync(cfg) && /darkMode:\s*'class'/.test(readFileSync(cfg, 'utf8'))
}

const LIGHT = /(?<!:)\bbg-(?:white|(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100))\b/
const COLOUR = /(?<!:)\btext-(?:white|black|inherit|current|transparent|(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b/
const RENDERS_TEXT = /\{[^}]*\}\s*<\/|>\s*[A-Za-z0-9$][^<>]*</

let failures = 0
const fail = (m: string) => { failures++; console.log(`  FAIL ${m}`) }

const templates = readdirSync(ROOT).filter((t) =>
  t.startsWith('crm') &&
  t !== 'crm-automotive' && // parked
  existsSync(join(ROOT, t, 'frontend', 'src', 'index.css')))

const skipped: string[] = []
for (const t of templates) {
  if (!AUDIT && KNOWN_OPEN.has(t)) continue
  if (!hasThemeToggle(t)) { skipped.push(t); continue }
  const css = readFileSync(join(ROOT, t, 'frontend', 'src', 'index.css'), 'utf8')

  const body = css.match(/\bbody\s*\{[^}]*\}/s)?.[0] ?? ''
  if (!/text-gray-900|text-slate-900/.test(body)) fail(`${t}: index.css body sets no base ink — uncoloured text is left at the browser default`)
  if (!/dark:text-slate-100|dark:text-gray-100/.test(body)) fail(`${t}: index.css body has no dark ink — every uncoloured element stays black on the dark ground`)

  const controls = css.match(/(^|\n)\s*(?:input|select|textarea)[^{]*\{[^}]*\}/s)?.[0] ?? ''
  if (!/dark:text-|dark:bg-/.test(controls)) {
    fail(`${t}: index.css never re-colours input/select/textarea — preflight gives them \`color: inherit\`, so typed text follows the body into invisibility`)
  }

  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      if (e === 'node_modules' || e === 'dist') continue
      const p = join(d, e)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!p.endsWith('.tsx')) continue
      const rel = p.slice(join(ROOT, t).length + 1).replace(/\\/g, '/')
      if (/\/pages\/portal\//.test('/' + rel)) continue // permanently dark by design
      if (!AUDIT && KNOWN_OPEN.has(`${t}:${rel}`)) continue
      const lines = readFileSync(p, 'utf8').split('\n')
      lines.forEach((ln, i) => {
        const cm = ln.match(/className=\{?["'`]([^"'`]{2,400})["'`]/)
        if (!cm) return
        const cls = cm[1]
        if (!LIGHT.test(cls) || /\bdark:bg-/.test(cls) || COLOUR.test(cls)) return
        const indent = ln.search(/\S/)
        for (let j = i + 1; j < Math.min(i + 24, lines.length); j++) {
          const child = lines[j]
          if (!child.trim()) continue
          if (child.search(/\S/) <= indent) break
          const ccm = child.match(/className=\{?["'`]([^"'`]{2,400})["'`]/)
          if (ccm && (/\bbg-/.test(ccm[1]) || COLOUR.test(ccm[1]))) continue
          if (!RENDERS_TEXT.test(child)) continue
          fail(`${t}: ${rel}:${j + 1} inherits its ink inside the stay-light surface at L${i + 1} — it follows the body and vanishes on a background that never flipped`)
        }
      })
    }
  }
  walk(join(ROOT, t, 'frontend', 'src'))
}

if (skipped.length) console.log(`  (no dark mode, nothing to break: ${skipped.join(', ')})`)
console.log(failures === 0
  ? `check-inherited-ink-follows-theme: ok (${templates.length - skipped.length - KNOWN_OPEN.size} themed templates checked, ${KNOWN_OPEN.size} known-open)`
  : `check-inherited-ink-follows-theme: ${failures} failure(s)`)
process.exit(failures ? 1 : 0)

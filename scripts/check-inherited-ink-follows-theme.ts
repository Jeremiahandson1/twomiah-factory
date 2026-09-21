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

// Known-open, deliberately visible rather than silently skipped. Keyed by `template` (whole-template,
// for the ones with no base rule at all) or `template:relative/path.tsx`.
//
//   crm-homecare  — parked pending the re-base from the live CVHC CRM; not to be touched meanwhile.
//   crm-store     — no tenant provisioned yet, so a fix here cannot be verified against a running app.
//   the rest      — real, live dark-mode defects of exactly this shape, found by this guard when it
//                   was first written for roof. Same one-class fix; queued behind the roof work.
const KNOWN_OPEN = new Set([
  'crm-homecare',
  'crm-store',
  'crm:frontend/src/pages/DrawSchedulesPage.tsx',
  'crm:frontend/src/pages/takeoffs/TakeoffsPage.tsx',
  'crm-dispensary:frontend/src/pages/BatchesPage.tsx',
  'crm-dispensary:frontend/src/pages/CompliancePage.tsx',
  'crm-dispensary:frontend/src/pages/GrowInputsPage.tsx',
  'crm-dispensary:frontend/src/pages/KioskPage.tsx',
  'crm-dispensary:frontend/src/pages/OfflinePage.tsx',
  'crm-dispensary:frontend/src/pages/RFIDPage.tsx',
  'crm-fieldservice:frontend/src/pages/LocationsPage.tsx',
  'crm-landscaping:frontend/src/pages/LocationsPage.tsx',
  'crm-rv:frontend/src/pages/rv/AlertsPage.tsx',
])

const LIGHT = /(?<!:)\bbg-(?:white|(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100))\b/
const COLOUR = /(?<!:)\btext-(?:white|black|inherit|current|transparent|(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b/
const RENDERS_TEXT = /\{[^}]*\}\s*<\/|>\s*[A-Za-z0-9$][^<>]*</

let failures = 0
const fail = (m: string) => { failures++; console.log(`  FAIL ${m}`) }

const templates = readdirSync(ROOT).filter((t) =>
  t.startsWith('crm') &&
  t !== 'crm-automotive' && // parked
  existsSync(join(ROOT, t, 'frontend', 'src', 'index.css')))

for (const t of templates) {
  if (KNOWN_OPEN.has(t)) continue
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
      if (KNOWN_OPEN.has(`${t}:${rel}`)) continue
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

console.log(failures === 0
  ? `check-inherited-ink-follows-theme: ok (${templates.length} templates, ${KNOWN_OPEN.size} known-open entries)`
  : `check-inherited-ink-follows-theme: ${failures} failure(s)`)
process.exit(failures ? 1 : 0)

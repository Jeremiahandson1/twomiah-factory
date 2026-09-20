// CI guard: a muted label must be readable in BOTH themes, which means a PAIR, not a shade.
//
// Every accessibility audit in this campaign until salon T23 was run in dark mode, so the whole fleet
// carried muted labels on `text-gray-400` — 2.54:1 on white, nowhere near AA, and ~7:1 on a dark card,
// which is why nobody saw it. The obvious fix is a trap and I shipped it (fbabe328, 29 labels): an
// element with no `dark:` variant renders the SAME colour in both themes, so moving the base to
// gray-500 fixes white (4.83:1) and breaks the dark card (3.69:1). It moves the failure instead of
// removing it, and it does so on the page a tester has just certified clean.
//
// So the rule this pins is the pair:
//
//     text-gray-500            light, 4.83:1 on white
//     dark:text-slate-400      dark,  6.96:1 on slate-900, 5.71:1 on a raised slate-800 row
//
// Two things are deliberately NOT text and are left alone, because AA does not apply to them:
//   - an icon, which carries its own box (`w-4 h-4`) and has no text node;
//   - an icon BUTTON, which colours the control and lets the glyph inherit (padding + a hover colour).
// A prefixed utility is also not a light-mode label: `dark:text-gray-400` IS the dark half, and
// `disabled:text-gray-500` is an inactive control, which WCAG 1.4.3 exempts. ':' is not a word
// character, so /\btext-gray-400\b/ matches inside both — a lookbehind is what keeps them apart, and
// without it an earlier pass rewrote 87 dark values and had to be reverted wholesale.
//   bun scripts/check-muted-label-contrast.ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

/** the light-mode utility only — never `dark:`, `disabled:`, `group-hover:` … */
const BARE_400 = /(?<!:)\btext-gray-400\b/
const BARE_500 = /(?<!:)\btext-gray-500\b/
/** a glyph carries its own box; it is not text */
const ICON = /\bw-\d+(\.\d+)?\s+h-\d+(\.\d+)?\b/
/** an icon button: padding plus a hover colour, and no text of its own */
const ICON_BUTTON = /(^|\s)p[xy]?-[\d.]+(\s|$)/
const HOVER = /hover:text-/
/** 3.69:1 on a dark card — never the dark half of a pair */
const DARK_FAILING = /\bdark:text-gray-500\b/

// crm-automotive is parked and crm-homecare is being handled separately; neither is swept here.
const ROOTS = [
  'packages/tenant-ui/src',
  ...['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant', 'crm-roof', 'crm-dispensary']
    .map((t) => `templates/${t}/frontend/src`),
]

const files: string[] = []
const walk = (d: string, into: string[]) => {
  let entries: string[]
  try { entries = readdirSync(d) } catch { return }
  for (const e of entries) {
    if (e === 'node_modules' || e === 'dist') continue
    const p = join(d, e)
    if (statSync(p).isDirectory()) walk(p, into)
    else if (p.endsWith('.tsx') && !e.startsWith('__head_')) into.push(p)
  }
}
// A guard that silently scans nothing passes forever. Renaming or moving a frontend tree out from under
// this list is the realistic way that happens, so every root must still yield files.
for (const r of ROOTS) {
  const found: string[] = []
  walk(ROOT + r, found)
  if (!found.length) fail(`${r} yielded no .tsx files — this guard is not looking where it thinks it is`)
  files.push(...found)
}

const onFailingLight: string[] = []
const unpaired: string[] = []
const failingDark: string[] = []
let icons = 0, paired = 0

for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const rel = f.slice(ROOT.length).replace(/\\/g, '/')
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    // a template literal is split on its interpolations, because the halves are separate class lists
    for (const seg of (m[1] ?? m[2] ?? '').split(/\$\{[^}]*\}|'|`/)) {
      if (DARK_FAILING.test(seg)) failingDark.push(`${rel}: ${seg.trim().slice(0, 70)}`)
      const isIcon = ICON.test(seg) || (ICON_BUTTON.test(seg) && HOVER.test(seg))
      if (BARE_400.test(seg)) {
        if (isIcon) { icons++; continue }
        onFailingLight.push(`${rel}: ${seg.trim().slice(0, 70)}`)
      }
      if (BARE_500.test(seg)) {
        if (isIcon) continue
        if (/dark:text-/.test(seg)) paired++
        else unpaired.push(`${rel}: ${seg.trim().slice(0, 70)}`)
      }
    }
  }
}

const show = (xs: string[]) => xs.slice(0, 6).map((x) => `\n    ${x}`).join('') + (xs.length > 6 ? `\n    …and ${xs.length - 6} more` : '')

if (onFailingLight.length)
  fail(`${onFailingLight.length} muted TEXT label(s) still on text-gray-400 — 2.54:1 on white, which is the finding:${show(onFailingLight)}`)
if (unpaired.length)
  fail(`${unpaired.length} muted label(s) on text-gray-500 with no dark partner — that reads 3.69:1 on a dark card, so the failure was moved, not fixed:${show(unpaired)}`)
if (failingDark.length)
  fail(`${failingDark.length} dark value(s) set to gray-500 — 3.69:1 on slate-900; the dark half must be slate-400:${show(failingDark)}`)
// (The volume of the sweep is asserted by the test, which always runs against the whole worktree; this
// guard has to stay runnable over a subset so its own plants can be self-tested.)

if (failed) { console.error(`\nmuted label contrast: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`muted label contrast: ${paired} muted labels carry both halves of the pair, ${icons} icons correctly left alone — readable on white AND on a dark card`)

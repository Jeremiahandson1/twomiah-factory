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
// …but that escape is too generous on its own, and it hid seven labels from the first sweep: a button
// with padding and a hover colour is still TEXT if it sizes text. `text-xs …>Edit</button>` and
// `text-sm …>+ Add Step</button>` both slipped through until the deployed bundle was checked. A
// text-size class beside the colour is the tell — a glyph does not need one.
const TEXT_SIZE = /\btext-(xs|sm|base|lg|xl|2xl|3xl)\b/
// The one place the tell lies: the roof customer portal is a permanently dark UI (bg-gray-900 shell,
// bg-gray-800 panels — no theme toggle), where gray-400 measures 5.78:1 and 6.99:1. It is correct
// there, and "fixing" it to gray-500 would drop it to 3.04:1. That is a regression, not a fix.
const PERMANENTLY_DARK = /^templates\/crm-roof\/frontend\/src\/pages\/portal\//
/** 3.69:1 and 3.75:1 on a dark card — never the dark half of a pair */
const DARK_FAILING = /\bdark:text-(?:gray-500|slate-500)\b/
/** WCAG 1.4.3 exempts an inactive component; a disabled button's label is not held to the ratio */
const DISABLED = /\b(?:pointer-events-none|cursor-not-allowed)\b/
/**
 * A background baked into the SAME class list does not follow the theme unless it says `dark:bg-`.
 * `bg-gray-200 text-gray-500` keeps its light chip in dark mode, so the answer there is a darker light
 * token (gray-600, 6.10:1), never a dark partner — slate-400 on that chip would be 2.07:1.
 *
 * The lookbehind matters here too: `hover:bg-gray-100` is a hover state, not the resting surface, and
 * without `(?<!:)` it reads as one — which flagged fifteen correctly-paired labels.
 */
const FIXED_LIGHT_BG = /(?<!:)\bbg-(?:white|gray-(?:50|100|200|300))\b/
/**
 * The hover tier. A hover colour is the same text in another state, so AA applies to it too — and the
 * fleet pattern `text-gray-500 dark:text-slate-400 hover:text-gray-700` inverts in dark mode: gray-700
 * on slate-900 is 1.73:1, so a readable label goes nearly invisible the moment you point at it.
 *
 * Shade 500 and darker fails on a dark card for every hue here; 400 and lighter clears it. So a hover
 * colour at 500+ needs a `dark:hover:` counterpart — unless the HOVER SURFACE is itself pinned light
 * (`hover:bg-red-50` with no `dark:hover:bg-`), in which case the hover text must stay dark and a dark
 * partner would paint light-on-light.
 */
const HOVER_TEXT = /(?<!:)\bhover:text-[a-z]+-(\d{2,3})\b/
const DARK_HOVER = /\bdark:hover:text-/
const PINNED_HOVER_BG = /(?<!:)\bhover:bg-(?:white|[a-z]+-(?:50|100|200))\b/

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
const darkOnLight: string[] = []
const tooLightOnChip: string[] = []
const hoverUnpaired: string[] = []
let icons = 0, paired = 0

/**
 * Every class list an element can carry, INCLUDING the ones inside an interpolation.
 *
 * The first version of this guard read `className="…"` and the static halves of a template literal,
 * and split on `${…}` — throwing the interpolation away. That is where a conditional class lives:
 *
 *     className={`text-xs ${enabled ? 'text-green-600' : 'text-gray-400'}`}
 *
 * …so 29 muted labels and 90 unpaired ones sat in that gap, invisible to the guard and to the sweep,
 * until the deployed bundle was read back. Those strings are class lists like any other.
 */
function* classLists(src: string): Generator<{ seg: string; selfClosing: boolean; iconOnly: boolean }> {
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{)/g)) {
    if (m[1] !== undefined) { yield { seg: m[1], selfClosing: false, iconOnly: false }; continue }
    // brace-balanced expression body
    const open = m.index! + m[0].length - 1
    let depth = 0, end = open
    for (let i = open; i < src.length && i < open + 3000; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    const expr = src.slice(open, end + 1)
    // does this element hold text at all? a self-closing tag has no text node, and a control whose
    // only child is a component is holding a glyph
    const after = src.slice(end + 1, end + 600)
    const gt = after.indexOf('>')
    const selfClosing = gt > 0 && after.slice(0, gt).trimEnd().endsWith('/')
    const closeAt = after.indexOf('</')
    const kids = gt > 0 && closeAt > gt ? after.slice(gt + 1, closeAt).trim() : ''
    const iconOnly = !!kids && /^\{?\s*[\w.]*\s*\?\s*<[A-Z]|^<[A-Z]/.test(kids)
    // the static halves of a template literal, plus each quoted string inside the expression
    for (const seg of expr.split(/\$\{|\}|'|"|`/)) if (/-/.test(seg)) yield { seg, selfClosing, iconOnly }
  }
}

for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const rel = f.slice(ROOT.length).replace(/\\/g, '/')
  for (const { seg, selfClosing, iconOnly } of classLists(src)) {
    if (DARK_FAILING.test(seg)) failingDark.push(`${rel}: ${seg.trim().slice(0, 70)}`)
    // A chip paints its own dark surface too, and slate-700 is a LIGHTER dark than the slate-800/900
    // the rest of the fleet sits on — so the usual slate-400 does not reach it: 4.04:1. slate-300 is
    // 6.97:1. The tester could not see this one; it only shows in dark mode, on a badge.
    if (/\bdark:bg-slate-700\b/.test(seg) && /\bdark:text-slate-400\b/.test(seg))
      tooLightOnChip.push(`${rel} (dark half): ${seg.trim().slice(0, 62)}`)
    // a glyph, or a control that only holds one — unless it sizes text, in which case it has text
    const isIcon = selfClosing || iconOnly ||
      (!TEXT_SIZE.test(seg) && (ICON.test(seg) || (ICON_BUTTON.test(seg) && HOVER.test(seg))))
    if (BARE_400.test(seg)) {
      if (isIcon || DISABLED.test(seg) || PERMANENTLY_DARK.test(rel)) { icons++; continue }
      onFailingLight.push(`${rel}: ${seg.trim().slice(0, 70)}`)
    }
    // A surface that pins its own light background and never says dark:bg- stays light in dark mode.
    // Handing it a dark text colour is the same mistake as the original finding, pointing the other
    // way: slate-400 on gray-50 is 2.45:1. My own pair-dark pass did this to one table header.
    const pinnedLight = FIXED_LIGHT_BG.test(seg) && !/\bdark:bg-/.test(seg)
    if (pinnedLight && /\bdark:text-(?:slate|gray)-(?:300|400|500)\b/.test(seg))
      darkOnLight.push(`${rel}: ${seg.trim().slice(0, 70)}`)

    // the hover tier, held to the same ratio as the resting one
    {
      const h = seg.match(HOVER_TEXT)
      if (h && Number(h[1]) >= 500 && !isIcon && !DISABLED.test(seg) && !DARK_HOVER.test(seg)
          && !(PINNED_HOVER_BG.test(seg) && !/\bdark:hover:bg-/.test(seg)))
        hoverUnpaired.push(`${rel}: ${seg.trim().slice(0, 70)}`)
    }

    if (BARE_500.test(seg)) {
      if (isIcon || DISABLED.test(seg)) continue
      // The LIGHT half is judged against the LIGHT chip, whether or not that chip flips in dark mode.
      // gray-500 is 4.39:1 on gray-100 and 3.90:1 on gray-200 — under AA either way, and a dark
      // partner cannot rescue the light theme. Salon's "Retired" badge shipped at 4.39:1 through the
      // first version of this rule, which only looked at chips that were PINNED light.
      if (/(?<!:)\bbg-gray-(?:100|200|300)\b/.test(seg)) { tooLightOnChip.push(`${rel}: ${seg.trim().slice(0, 70)}`); continue }
      if (pinnedLight) { paired++; continue } // white 4.83 / gray-50 4.63 — fine, and correctly has no dark half
      if (/dark:text-/.test(seg)) paired++
      else unpaired.push(`${rel}: ${seg.trim().slice(0, 70)}`)
    }
  }
}

const show = (xs: string[]) => xs.slice(0, 6).map((x) => `\n    ${x}`).join('') + (xs.length > 6 ? `\n    …and ${xs.length - 6} more` : '')

if (onFailingLight.length)
  fail(`${onFailingLight.length} muted TEXT label(s) still on text-gray-400 — 2.54:1 on white, which is the finding:${show(onFailingLight)}`)
if (unpaired.length)
  fail(`${unpaired.length} muted label(s) on text-gray-500 with no dark partner — that reads 3.69:1 on a dark card, so the failure was moved, not fixed:${show(unpaired)}`)
if (failingDark.length)
  fail(`${failingDark.length} dark value(s) set to gray-500/slate-500 — 3.69:1 and 3.75:1 on slate-900; the dark half must be slate-400:${show(failingDark)}`)
if (darkOnLight.length)
  fail(`${darkOnLight.length} element(s) give a DARK text colour to a surface that pins a light background and never flips it — slate-400 on gray-50 is 2.45:1:${show(darkOnLight)}`)
if (hoverUnpaired.length)
  fail(`${hoverUnpaired.length} hover colour(s) at shade 500+ have no dark:hover: counterpart — gray-700 on slate-900 is 1.73:1, so the label goes invisible the moment you point at it:${show(hoverUnpaired)}`)
if (tooLightOnChip.length)
  fail(`${tooLightOnChip.length} label(s) use gray-500 on a fixed gray-100/200/300 chip — 4.39:1 and 3.90:1, under AA; use gray-600:${show(tooLightOnChip)}`)
// (The volume of the sweep is asserted by the test, which always runs against the whole worktree; this
// guard has to stay runnable over a subset so its own plants can be self-tested.)

if (failed) { console.error(`\nmuted label contrast: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`muted label contrast: ${paired} muted labels carry both halves of the pair, ${icons} icons correctly left alone — readable on white AND on a dark card`)

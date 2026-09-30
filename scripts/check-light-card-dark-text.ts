// CI guard: a container that stays WHITE in dark mode must not hold text that goes LIGHT.
//
// ── why this guard exists ───────────────────────────────────────────────────────────────────────
//
// T55 S5. The Enterprise store-group cards measured 1.10:1 in dark mode for both roles — white card,
// near-white heading, effectively invisible. The card said:
//
//     className={`bg-white rounded-lg shadow-sm p-4 …`}          ← no dark: partner
//     <h3 className="font-semibold text-gray-900 dark:text-slate-100">{group.name}</h3>
//
// The heading was given its dark-mode colour and the surface behind it was not. Each half is
// defensible alone; together they are unreadable.
//
// ── why a plain "bg-white needs dark:bg-" rule would be wrong ───────────────────────────────────
//
// Nineteen other pages have `bg-white` with no dark partner and the tester measured every screen in
// both themes and found only this one. Those are deliberately light surfaces — the kiosk a customer
// stands at, the public menu, the portal — or elements whose parent already paints the dark ground.
// Changing them on suspicion would break pages a human has confirmed are fine.
//
// So the rule is the PAIR, which is the thing that is actually broken: a `bg-white` with no
// `dark:bg-*`, containing an element that asks for light text in dark mode (`dark:text-slate-100`,
// `-200`, `dark:text-white`). A page that commits to being light has no `dark:text-*` in it at all
// and is left alone; a page that does both has made a mistake.
//
//   bun scripts/check-light-card-dark-text.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const SKIP = new Set(['node_modules', 'dist', 'build', '.git', 'crm-automotive'])

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (SKIP.has(e)) continue
    const p = join(dir, e)
    let st; try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (e.endsWith('.tsx')) out.push(p)
  }
  return out
}

/** Light text asked for specifically in dark mode. */
const DARK_LIGHT_TEXT = /dark:text-(?:white|slate-100|slate-200|gray-100|gray-200|zinc-100|neutral-100)\b/

const roots = readdirSync(join(ROOT, 'templates'))
  .filter((t) => !SKIP.has(t))
  .map((t) => join(ROOT, 'templates', t, 'frontend/src'))
  .concat([join(ROOT, 'packages/tenant-ui/src')])

let scanned = 0, checked = 0
for (const root of roots) {
  for (const file of walk(root)) {
    scanned++
    const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    // A page with no dark-mode text at all is a deliberately single-theme surface. Skip it.
    if (!DARK_LIGHT_TEXT.test(src)) continue
    checked++

    const lines = src.split('\n')
    lines.forEach((line, i) => {
      // A className carrying bg-white and no dark:bg-* on the same element.
      if (!/\bbg-white\b/.test(line)) return
      if (/dark:bg-/.test(line)) return
      // An element that pins its OWN dark text and gives it no dark: override has committed to
      // being light, and is correct: `bg-white text-gray-900` is the signature pad you sign in dark
      // ink on, whatever the rest of the page does. Only the element that leaves its text to the
      // theme while fixing its surface is wrong.
      if (/\btext-(?:gray|slate|zinc|neutral)-(?:800|900)\b|\btext-black\b/.test(line) && !/dark:text-/.test(line)) return
      // …and light dark-mode text inside the next few lines, which is where a card's heading sits.
      const window = lines.slice(i, i + 12).join('\n')
      if (!DARK_LIGHT_TEXT.test(window)) return
      fail(
        `${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1} a bg-white element has no dark:bg-* partner, ` +
        `and light dark-mode text sits inside it — white card, white words. Give the surface its ` +
        `dark partner, or drop the dark:text-* if the surface is meant to stay light. (T55 S5)`,
      )
    })
  }
}

console.log(failed
  ? `\n${failed} failure(s)`
  : `ok: ${checked} theme-aware page(s) of ${scanned} scanned, no light card holding light text`)
process.exit(failed ? 1 : 0)

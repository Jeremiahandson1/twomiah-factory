// CI guard: near-black ink with no dark-mode partner, on a screen that is themed.
//
// RR0929 N3 and N9. The Due Back date on the salon client chart was `text-gray-900` with no
// `dark:` partner — 1.01:1 on the dark card, so the date was simply absent — and the same shape
// turned up six more times in packages/tenant-ui, which means it shipped to all thirteen verticals:
//
//   TasksPage            an OPEN task's title. The completed branch was themed, the one every row
//                        starts in was not.
//   InventoryPage        a stock level that is not low, i.e. almost all of them.
//   WarrantiesPage       an expiry date that is not expiring soon.
//   InboundMessagesPage  the body of a customer's email, which is the whole screen.
//   GbpReviewsPage       the Google location name and its review count.
//   EquipmentPage        the selected tab of a segmented control, twice.
//
// Every one is a ternary whose EXCEPTION branch got a dark: partner and whose ordinary branch did
// not. That is why they survive review: whoever checked it was looking at the red or the orange, and
// the everyday state was the broken one.
//
// Why this rule and not a general contrast sweep: a general sweep over the same tree reports 57
// places, and most are legitimate — `bg-teal-50 text-teal-700` is a badge that is self-consistent in
// both modes, an icon at an accent shade is a judgement call, and a public landing page may commit
// to one theme. Near-black ink on a surface that turns dark is the one shape that is never a choice.
// A guard that fails on fifty judgement calls gets switched off; this one names only real defects.
//
//   bun scripts/check-unpaired-dark-ink.ts
import { readdirSync, readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

/** Ink dark enough that it is unreadable on any dark surface, at any brand hue. */
const NEAR_BLACK = /\btext-(?:black|gray-900|slate-900|zinc-900|neutral-900|gray-800|slate-800)\b/

/**
 * Screens that deliberately commit to one theme, and are not bugs.
 *
 * A signature pad is white PAPER — a customer signs on white in both modes, and its ink must stay
 * dark. The public pages are a customer-facing single-theme design.
 */
const SINGLE_THEME = /CustomerPortal|LoginPage|PaywallPage|ForgotPassword|ResetPassword|SignaturePad/

const offenders: string[] = []
const walk = (base: string, rel = '') => {
  let entries: import('node:fs').Dirent[] = []
  try { entries = readdirSync(ROOT + base + rel, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.isDirectory()) { walk(base, rel + e.name + '/'); continue }
    if (!e.name.endsWith('.tsx')) continue
    if (SINGLE_THEME.test(e.name)) continue
    const src = readFileSync(ROOT + base + rel + e.name, 'utf8').replace(/\r\n/g, '\n')
    // A page with no dark: classes at all is unthemed — a different (and larger) question than this.
    if (!/\bdark:/.test(src)) continue
    // Comments name these classes when explaining them — including this file's own — so comment
    // text is removed before scanning, and BLOCK comments span lines. Tracked as a state machine
    // rather than a regex over the whole file, so a `/*` inside a string literal cannot swallow
    // the rest of the page and turn this guard quietly green.
    let inBlock = false
    src.split('\n').forEach((line, i) => {
      let code = line
      if (inBlock) {
        const end = code.indexOf('*/')
        if (end === -1) return
        code = code.slice(end + 2)
        inBlock = false
      }
      // Opening a block that does not close on this line takes the rest of the line with it.
      for (;;) {
        const open = code.search(/\{?\/\*/)
        if (open === -1) break
        const close = code.indexOf('*/', open)
        if (close === -1) { code = code.slice(0, open); inBlock = true; break }
        code = code.slice(0, open) + ' ' + code.slice(close + 2).replace(/^\}/, '')
      }
      code = code.replace(/\/\/.*$/, '')
      for (const m of code.matchAll(/(['"`])([^'"`\n]*)\1/g)) {
        const cls = m[2]
        if (!NEAR_BLACK.test(cls)) continue
        // `dark:text-` or `dark:hover:text-` both count as having answered for dark mode.
        if (/\bdark:(?:hover:|focus:|group-hover:)?text-/.test(cls)) continue
        offenders.push(`${base + rel + e.name}:${i + 1}  ${cls.trim().slice(0, 72)}`)
      }
    })
  }
}
walk('packages/tenant-ui/src/')
walk('templates/crm-salon/frontend/src/')
/**
 * The BASE CRM's frontend, added in T32 M14.
 *
 * This guard walked tenant-ui and crm-salon and had never looked at templates/crm — which is the
 * fallback template every unmapped trade gets, and the one the T32 report was written against. It
 * found one real offender the moment it was pointed there (a hint panel in TakeoffsPage whose
 * surface and ink were both unpaired), and the tree is otherwise clean, so this stays.
 *
 * The narrow rule above is deliberately unchanged: `bg-gray-50 text-gray-700` stat tiles were also
 * wrong in dark mode and T32 M14 fixed four files' worth of them, but they are a judgement call and
 * a guard that fails on judgement calls gets switched off. Near-black ink is the shape that never is.
 */
walk('templates/crm/frontend/src/')

if (offenders.length) {
  console.error('FAIL: near-black ink with no dark-mode partner — invisible on a dark surface:')
  for (const o of offenders) console.error(`  ${o}`)
  console.error(`\nunpaired dark ink: ${offenders.length} place(s) FAILED`)
  process.exit(1)
}
console.log('unpaired dark ink: none — every near-black ink on a themed screen answers for dark mode')

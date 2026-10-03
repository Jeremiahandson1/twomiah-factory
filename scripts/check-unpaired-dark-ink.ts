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

/**
 * Ink dark enough that it is unreadable on any dark surface, at any brand hue.
 *
 * The 700s were TRIED in T41 and taken back out. text-gray-700 on a dark card really is the
 * contractor's 2.56:1 Gantt label — but the same class is also how every status badge in the fleet
 * is written (`bg-gray-100 text-gray-700`), which carries its own light ground and is correct in
 * both themes. Including it named 11 of those immediately, which is the "guard that fails on
 * judgement calls gets switched off" trap the note above describes. Those 700s were paired by hand
 * where the report measured them; the RULE stays at the shade that is never a choice.
 */
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
    const allLines = src.split('\n')
    allLines.forEach((line, i) => {
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
      /**
       * A BRANCH IS NOT THE WHOLE ELEMENT. (T41)
       *
       * This tested each string literal on its own, which is right for a ternary — the ordinary
       * branch is where these hide — and wrong when the element answers for dark mode OUTSIDE the
       * ternary:
       *
       *     className={`text-2xl ${highlight ? 'text-primary-600' : 'text-gray-900'} dark:text-slate-100`}
       *
       * `dark:text-slate-100` applies to that element in dark mode whichever branch is chosen, so
       * the element is correct — and widening this guard to the whole fleet named five of them as
       * faults. A guard that reports correct code is the one people switch off.
       *
       * So: if the STATIC text of the line (everything outside `${…}`) carries a dark: ink answer,
       * the element has answered and its branches are not judged. A dark: answer inside a SIBLING
       * branch does not count — that is the real defect this guard was written for.
       */
      /**
       * …and the element's answer may be on a LATER LINE. A multi-line className puts the ternary
       * in the middle and the shared classes after it:
       *
       *     className={`font-medium ${
       *       expired ? 'text-red-600' : 'text-gray-900'
       *     } dark:text-slate-100`}
       *
       * so the static text is gathered from a small window, not just this line.
       */
      const windowText = allLines.slice(i, i + 6).join('\n')
      const staticText = windowText.replace(/\$\{[\s\S]*?\}/g, ' ')
      const elementAnswered = /\bdark:(?:hover:|focus:|group-hover:)?text-/.test(staticText)
      for (const m of code.matchAll(/(['"`])([^'"`\n]*)\1/g)) {
        const cls = m[2]
        if (!NEAR_BLACK.test(cls)) continue
        // `dark:text-` or `dark:hover:text-` both count as having answered for dark mode.
        if (/\bdark:(?:hover:|focus:|group-hover:)?text-/.test(cls)) continue
        if (elementAnswered) continue
        offenders.push(`${base + rel + e.name}:${i + 1}  ${cls.trim().slice(0, 72)}`)
      }
    })
  }
}
walk('packages/tenant-ui/src/')
walk('templates/crm-salon/frontend/src/')

/**
 * …AND NOW THE WHOLE FLEET. (T41)
 *
 * This walked three directories. T41 measured text at 1.00–1.21:1 on nine crm-rv pages, the vet's
 * Reminders and patient chart, the landscaping snow and route cards, the events rank badges and the
 * dispensary's tone card — none of which this guard was looking at, so none of it could be caught.
 * 264 unpaired inks were paired across every live template in that round and the tree is now clean,
 * which is the only safe moment to widen a guard: it starts green and stays that way.
 *
 * crm-automotive and crm-homecare are PARKED (CLAUDE.md) and deliberately excluded — a rule nobody
 * is allowed to satisfy would fail the build for ever.
 */
const LIVE_TEMPLATES = ['crm-basic', 'crm-dispensary', 'crm-fieldservice', 'crm-landscaping', 'crm-restaurant', 'crm-roof', 'crm-rv', 'crm-store', 'crm-vet']
for (const t of LIVE_TEMPLATES) walk(`templates/${t}/frontend/src/`)
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

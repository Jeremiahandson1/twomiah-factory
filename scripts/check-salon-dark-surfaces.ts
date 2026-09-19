// CI guard: a surface that stays light while its text follows the theme is unreadable in dark mode.
//
// Salon T20 H2 — measured by compositing the full background stack:
//   Service Menu   every service card on rgb(255,255,255) with text at rgb(241,245,249) — 1.10:1. The
//                  name and the price are invisible; the whole catalogue is unusable in dark mode.
//   Memberships    the plan card the same shape: "Blowout Club" and "$99 /mo" at 1.10:1. The Members
//                  table below is correctly themed, which is why the failure was confined to the card.
//   Dashboard      the Due-to-Rebook banner keeps its light-pink background; the headline renders at
//                  1.00:1, so "2 overdue" is simply missing and the banner reads "· 0 due soon".
//
// The rule is the pairing, not the colour: if the TEXT on a surface switches in dark mode, the SURFACE
// has to switch too. Sweeping for that shape turned up a fourth on Reminders, a page the report did not
// reach — an overdue row painted bg-red-50 with cells at dark:text-slate-100.
//   bun scripts/check-salon-dark-surfaces.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const P = 'templates/crm-salon/frontend/src/pages/salon/'

const menu = read(P + 'ServiceMenuPage.tsx')
if (!menu) fail('the Service Menu page is missing')
if (!/bg-white rounded-xl border p-5 flex flex-col dark:bg-slate-900 dark:border-slate-700/.test(menu)) fail('a service card must declare a dark surface — its text is near-white in dark mode, so a white card leaves the catalogue unreadable')

const members = read(P + 'MembershipsPage.tsx')
if (!members) fail('the Memberships page is missing')
if (!/bg-white rounded-xl border p-5 flex flex-col dark:bg-slate-900 dark:border-slate-700/.test(members)) fail('a membership plan card must declare a dark surface too')

const dash = read(P + 'DashboardPage.tsx')
if (!dash) fail('the salon Dashboard is missing')
if (!/dark:bg-red-950\/40 dark:border-red-900/.test(dash)) fail('the Due-to-Rebook alert must not keep a light-pink background in dark mode — the headline sat at 1.00:1 and the count was invisible')
if (!/'bg-white dark:bg-slate-900 dark:border-slate-700'/.test(dash)) fail('…and its calm state must follow the theme as well')
if (!/bg-red-100 dark:bg-red-900\/40/.test(dash)) fail('…including the chip behind the bell')

const rem = read(P + 'RemindersPage.tsx')
if (!rem) fail('the Reminders page is missing')
if (!/'bg-red-50 dark:bg-red-950\/40'/.test(rem)) fail('an overdue reminder row must be themed — same defect as the dashboard banner, on a page the report did not reach')

// The rule itself, over the pages that hold cards and panels: nothing paints a CARD light with no dark
// counterpart. Hover tints and badges whose text is also a light-mode colour stay readable and are not
// what this pins — the failure needs a light surface under text that switches.
const offenders: string[] = []
for (const page of ['ServiceMenuPage', 'MembershipsPage', 'DashboardPage', 'RemindersPage']) {
  const src = read(P + `${page}.tsx`)
  if (!src) continue
  for (const m of src.matchAll(/(['"`])([^'"`\n]*\bbg-(?:white|red-50)\b[^'"`\n]*)\1/g)) {
    const cls = m[2]
    if (/\bdark:bg-/.test(cls)) continue
    if (/\bhover:bg-/.test(cls) && !/\brounded-xl\b/.test(cls)) continue
    offenders.push(`${page}: ${cls.trim().slice(0, 80)}`)
  }
}
if (offenders.length) fail(`a card or panel is painted light with no dark counterpart: ${offenders.join(' | ')}`)

if (failed) { console.error(`\nsalon dark surfaces: ${failed} check(s) FAILED`); process.exit(1) }
console.log('salon dark surfaces: cards, the rebook alert and the overdue row all follow the theme their text follows')

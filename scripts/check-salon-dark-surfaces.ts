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

// The other half of the same habit, measured across all seventeen pages for the first time: an ACCENT with
// no dark-mode variant. Two shapes, ten instances (FS T22's six, salon M6's four).
//
//   brand accents   text-orange-* is not orange — each template's tailwind.config overrides the palette
//                   with the tenant's own hue, so an active tab or section label lands wherever that hue
//                   falls. Shade 400 is the hue at 55% lightness and measured 3.72:1; shade 200 is at 80%
//                   and clears AA for every hue, which is why the fixes use 200 and not 400.
//   muted labels    a badge or hint that keeps its light-mode gray: slate-600 read 2.36:1, gray-500 3.69:1
//                   and slate-500 3.75:1 on the dark table.
//   destructive     red-600 / red-700 on a dark panel: 3.70:1 and 2.75:1. red-400 clears it.
{
  const U = 'packages/tenant-ui/src/'
  const S = 'templates/crm-salon/frontend/src/pages/salon/'
  const needs: Array<[string, string, string]> = [
    [U + 'marketing/MarketingPage.tsx', 'text-orange-600 dark:text-orange-200', 'the Marketing active tab was the worst of them at 2.34:1 — harder to read than the inactive tabs beside it'],
    [U + 'shell/SettingsPage.tsx', 'dark:text-orange-200', 'the Settings active section must use shade 200 — shade 400 is the brand hue at 55% lightness and measured 3.72:1'],
    [U + 'schedule/SchedulePage.tsx', 'dark:text-slate-400 text-center', 'the Schedule drop hint measured 2.36:1'],
    [U + 'people/TeamPage.tsx', 'text-gray-400 dark:text-slate-400', 'the Team login badge measured 3.75:1'],
    [U + 'booking/BookingsPage.tsx', "refunded: 'text-gray-500 dark:text-slate-400'", 'a refunded deposit badge kept its light-mode gray'],
    [U + 'booking/BookingsPage.tsx', "expired: 'text-gray-500 dark:text-slate-400'", 'an expired deposit badge measured 3.69:1'],
    [S + 'RemindersPage.tsx', 'text-red-700 dark:text-red-400 font-medium', 'the Rebooking overdue date measured 2.75:1'],
    [S + 'MembershipsPage.tsx', 'text-red-600 hover:text-red-700 dark:text-red-400', 'the Memberships Cancel link measured 3.70:1'],
    [S + 'ServiceMenuPage.tsx', 'bg-teal-700 text-white', 'white on teal-600 measured 3.74:1 — the button did not carry enough contrast for its own label'],
  ]
  for (const [file, needle, why] of needs) {
    let src = ''
    try { src = read(file) } catch { /* reported below */ }
    if (!src.includes(needle)) fail(`${file}: ${why}`)
  }
  // shade 400 must not come back as the answer for a brand accent on a dark surface
  if (/dark:text-orange-400/.test(read(U + 'shell/SettingsPage.tsx'))) fail('the Settings nav is back on shade 400, which does not clear AA at every brand hue')
}

// LIGHT mode, measured for the first time in T23: every contrast audit in this series had been dark-mode
// only, and gray-400 on white is 2.54:1 — the muted label tier failed in the theme most people use. Icons
// are not held to a text ratio and keep it; anything with a text size beside it is text. One step darker
// (gray-500, 4.83:1) clears it, which is what the tester predicted.
{
  const P = 'templates/crm-salon/frontend/src/pages/salon/'
  for (const page of ['ServiceMenuPage.tsx', 'DashboardPage.tsx', 'ClientDetailPage.tsx', 'ClientsPage.tsx', 'MembershipsPage.tsx', 'RemindersPage.tsx', 'AppointmentsPage.tsx']) {
    const src = read(P + page)
    const stillFailing = (src.match(/text-(xs|sm|base|lg) text-gray-400/g) || []).length
    if (stillFailing) fail(`${page}: ${stillFailing} muted TEXT label(s) still on gray-400 — 2.54:1 on white`)
  }
  // …and the primary button, which did not carry enough contrast for its own label
  const dir = 'templates/crm-salon/frontend/src/'
  for (const f of ['pages/salon/ServiceMenuPage.tsx', 'pages/salon/AppointmentsPage.tsx', 'pages/salon/MembershipsPage.tsx', 'components/salon/ServiceRecordEditorModal.tsx']) {
    if (/bg-teal-600 text-white/.test(read(dir + f))) fail(`${f}: a primary button is still white on teal-600 (3.74:1)`)
  }
}

// A timestamp is not a named day. dateOnly() takes the first ten characters, which is the UTC day — right
// for a due date, wrong for an upload at 20:18 that then listed as tomorrow. (Salon T23)
{
  const ui = read('packages/tenant-ui/src/invoicing/ui.tsx')
  if (!/export const instantDay = \(v: unknown\) => \(v \? new Date\(String\(v\)\)\.toLocaleDateString\(\) : '-'\)/.test(ui)) fail('there must be a formatter that reads an INSTANT on the reader\'s clock')
  if (!/export const dateOnly = /.test(ui)) fail('…and dateOnly must stay for values that genuinely name a day')
  const docs = read('packages/tenant-ui/src/files/DocumentsPage.tsx')
  if (/dateOnly\(v\)/.test(docs) || /dateOnly\(m\.updatedAt\)/.test(docs)) fail('the Documents list must not slice the UTC date off a timestamp — that is how an upload showed tomorrow')
  if (!/\{instantDay\(v\)\}/.test(docs)) fail('…the Uploaded column must use the instant formatter')
}

// A control that will not act has to say why — the register learned this in T21 M5, the portal's Send had
// the same shape: disabled on an empty message, so the click never reached the handler that would have
// explained. (Salon / field service T23)
{
  const msgs = read('packages/tenant-ui/src/portal/PortalMessages.tsx')
  // Matched on the RENDERED hint, not just the words appearing somewhere — they are also in the title
  // attribute below, which let a plant delete the visible line and still pass.
  if (!/\{!body\.trim\(\) && !sending && <p role="note"[^>]*>Type a message to send\.<\/p>\}/.test(msgs)) fail('the portal Send must SHOW why it will not act on an empty message, not only in a tooltip')
  if (!/title=\{!body\.trim\(\) \? 'Type a message to send\.' : undefined\}/.test(msgs)) fail('…and carry it on the button for anyone who hovers it')
}

if (failed) { console.error(`\nsalon dark surfaces: ${failed} check(s) FAILED`); process.exit(1) }
console.log('salon dark surfaces: cards, the rebook alert and the overdue row all follow the theme their text follows')

// Field service T22 "six more contrast items" + salon T22 M6's four remaining sub-AA accents.
//
// The tester swept all seventeen CRM pages properly for the first time and measured six failures on field
// service, and four on salon. Every one is the same two habits: an accent that uses the brand palette with
// no dark-mode variant, so the tenant's own colour lands unreadable on a dark surface; or a muted label
// that keeps its light-mode gray in dark mode.
//
// This reads the classes the source actually ships and computes the ratios, rather than trusting that a
// class name means what it used to — which is the whole reason these were missed: text-orange-600 is not
// orange on a tenant whose brand colour is blue.
import { readFileSync } from 'node:fs'

// This one runs from the assembled sandbox but reads template SOURCE, so it has to be told where the
// repository is; the runner passes FACTORY_ROOT. It refuses rather than guess -- pointed at the wrong
// tree it would read nothing, find nothing, and report success.
const W = (() => {
  const r = process.env.FACTORY_ROOT
  if (!r) throw new Error('FACTORY_ROOT is not set -- run this through tests/salon/harness/run.ts')
  return r.endsWith('/') ? r : r + '/'
})()
const read = (p: string) => readFileSync(W + p, 'utf8').replace(/\r\n/g, '\n')

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 200)) } }

// ── contrast maths ────────────────────────────────────────────────────────────────────────────────
const chan = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
const lum = (h: string) => { const c = chan(h).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
const ratio = (a: string, b: string) => { const l1 = lum(a), l2 = lum(b); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return (hi + 0.05) / (lo + 0.05) }
const AA = 4.5

// Tailwind values the templates ship
const C: Record<string, string> = {
  'slate-900': '#0f172a', 'slate-800': '#1e293b', 'slate-600': '#475569', 'slate-500': '#64748b', 'slate-400': '#94a3b8',
  'gray-500': '#6b7280', 'gray-400': '#9ca3af',
  'red-700': '#b91c1c', 'red-600': '#dc2626', 'red-400': '#f87171',
  'teal-600': '#0d9488', 'teal-700': '#0f766e', white: '#ffffff',
}
// The brand palette overrides orange-*: shade 400 is the brand hue at 55% lightness, shade 200 at 80%.
// Measured on the field service tenant (brand #1d4ed8): the 400 the Settings nav used came out
// rgb(53,100,227). Shade 200 is the one that clears AA for every hue, which is why the fixes use it.
const BRAND_400 = '#3564e3'   // rgb(53,100,227), the value the tester measured
const BRAND_600 = '#133fb9'   // rgb(19,63,185), the Marketing active tab
const BRAND_200 = '#aec2f5'   // shade 200 for the same hue — the fix

// ── the ratios the tester measured, reproduced ────────────────────────────────────────────────────
{
  // The two brand-palette items are NOT in this list. Their colour is generated per tenant from the
  // brand hex and their rendered background is a translucent tint, so reproducing the tester's exact
  // figure from source would mean inventing numbers. What is asserted about them below is what can
  // actually be established: the shipped class had no dark-mode variant, shade 400 fails AA at that
  // hue, and shade 200 clears it.
  const was: Array<[string, number, string, string]> = [
    ['Schedule "Drop a … here"', 2.36, C['slate-600'], C['slate-900']],
    ['Online Booking "expired" badge', 3.69, C['gray-500'], C['slate-900']],
    ['Messages "Unread" tab', 3.69, C['gray-500'], C['slate-900']],
    ['Team "login" badge', 3.75, C['slate-500'], C['slate-900']],
    ['Rebooking overdue date', 2.75, C['red-700'], C['slate-900']],
    ['Memberships "Cancel"', 3.70, C['red-600'], C['slate-900']],
    ['Service Menu "New Service"', 3.74, C['white'], C['teal-600']],
  ]
  for (const [name, reported, fg, bg] of was) {
    const r = ratio(fg, bg)
    check(`${name}: reproduces the reported ${reported}:1`, Math.abs(r - reported) < 0.05, { computed: Number(r.toFixed(2)), reported })
    check(`…and it genuinely failed AA`, r < AA, Number(r.toFixed(2)))
  }
}

// ── the values now shipped clear AA ───────────────────────────────────────────────────────────────
{
  const now: Array<[string, string, string]> = [
    ['brand shade 200 on slate-900 (tabs, active section)', BRAND_200, C['slate-900']],
    ['slate-400 on slate-900 (drop hint, badges)', C['slate-400'], C['slate-900']],
    ['slate-400 on slate-800 (badges on a raised row)', C['slate-400'], C['slate-800']],
    ['red-400 on slate-900 (overdue, Cancel)', C['red-400'], C['slate-900']],
    ['white on teal-700 (New Service)', C['white'], C['teal-700']],
  ]
  for (const [name, fg, bg] of now) {
    const r = ratio(fg, bg)
    check(`${name} clears AA`, r >= AA, { ratio: Number(r.toFixed(2)), need: AA })
  }
}

// ── and the source actually carries those classes ─────────────────────────────────────────────────
const U = 'packages/tenant-ui/src/'
const S = 'templates/crm-salon/frontend/src/pages/salon/'
const has = (file: string, needle: string, label: string) => check(label, read(file).includes(needle), { file, needle })

has(U + 'marketing/MarketingPage.tsx', "text-orange-600 dark:text-orange-200", 'the Marketing active tab has a dark-mode variant')
has(U + 'shell/SettingsPage.tsx', 'dark:text-orange-200', 'the Settings active section uses shade 200, not 400')
has(U + 'schedule/SchedulePage.tsx', 'dark:text-slate-400 text-center', 'the Schedule drop hint is readable')
has(U + 'people/TeamPage.tsx', 'text-gray-500 dark:text-slate-400', 'the Team login badge is readable')
has(U + 'booking/BookingsPage.tsx', "refunded: 'text-gray-500 dark:text-slate-400'", 'a refunded deposit badge has a dark variant')
has(U + 'booking/BookingsPage.tsx', "expired: 'text-gray-500 dark:text-slate-400'", 'an expired deposit badge has a dark variant')
has(U + 'marketing/MessagesPage.tsx', "'text-gray-500 dark:text-slate-400'}`}>All", 'the Messages All tab is readable when inactive')
has(U + 'marketing/MessagesPage.tsx', "'text-gray-500 dark:text-slate-400'}`}>Unread", 'the Messages Unread tab is readable when inactive')
has(S + 'RemindersPage.tsx', "text-red-700 dark:text-red-400 font-medium", 'the Rebooking overdue date is readable')
has(S + 'RemindersPage.tsx', 'text-red-600 dark:text-red-400 font-medium', '…and so is the overdue count beside it')
has(S + 'MembershipsPage.tsx', 'text-red-600 hover:text-red-700 dark:hover:text-red-300 dark:text-red-400', 'the Memberships Cancel link is readable')
has(S + 'ServiceMenuPage.tsx', 'bg-teal-700 text-white rounded-lg hover:bg-teal-800', 'the New Service button carries enough contrast for its own label')

// the brand-palette lesson, stated once so it cannot be lost again
check('shade 400 would NOT have been enough for the tabs', ratio(BRAND_400, C['slate-900']) < AA, Number(ratio(BRAND_400, C['slate-900']).toFixed(2)))
check('…which is why the fix uses shade 200', ratio(BRAND_200, C['slate-900']) >= AA, Number(ratio(BRAND_200, C['slate-900']).toFixed(2)))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)

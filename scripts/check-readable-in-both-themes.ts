// CI guard: the dispensary is readable in dark mode, and one long value cannot take the table with it.
//
// Dispensary T21 M2 — dark mode reused light-mode colours. Measured on the live page: table headings
// rgb(75,85,99) on rgb(15,23,42) = 2.36:1 across Products, Orders and Customers; the four tier tiles on
// Customers still WHITE cards in dark mode with their counts at 2.56:1, so the numbers were effectively
// unreadable; the active filter chip white on green-600 = 3.3:1. Light mode had no failures and must
// keep none.
//
// T21 M1 — one pre-existing 300-character customer name, with nothing to break on, sized its column to
// 2,437px and the table to 3,164px inside a 1,222px container, pushing Tier and every other column off
// the screen. The cell is bounded and wraps now; the record is bounded too (L8: the API accepted a
// 404-character name).
//   bun scripts/check-readable-in-both-themes.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const F = 'templates/crm-dispensary/frontend/src/'
// "must not appear" checks read CODE only — a comment naming the old colour is documentation.
const codeOnly = (src: string) => src.split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n')

// ── M2 ─────────────────────────────────────────────────────────────────────────────────────────────
const table = read(F + 'components/ui/DataTable.tsx')
if (!table) fail('the dispensary DataTable is missing')
if (!/text-gray-600 dark:text-slate-300 uppercase/.test(table)) fail('every column heading must declare a dark colour — text-gray-600 alone measured 2.36:1 on the dark table')

const customers = read(F + 'pages/CustomersPage.tsx')
if (!customers) fail('the dispensary Customers page is missing')
if (!/dark:bg-slate-900 dark:border-slate-700 dark:hover:border-slate-500/.test(customers)) fail('the tier tiles must follow the theme — they stayed white cards in dark mode, with their counts at 2.56:1')
if (!/dark:bg-green-900\/30 dark:border-green-500/.test(customers)) fail('…including the selected one')

const orders = read(F + 'pages/OrdersPage.tsx')
if (!orders) fail('the dispensary Orders page is missing')
if (/\? 'bg-green-600 text-white'/.test(codeOnly(orders))) fail('the active filter chip must not be white on green-600 — that is 3.3:1, under the 4.5:1 a 14px label needs')
if (!/\? 'bg-green-700 text-white'/.test(orders)) fail('…green-700 carries white at 5.02:1')
if (!/dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-800/.test(orders)) fail('…and the inactive chip needs a dark variant rather than staying a white chip on a dark page')

const layout = read(F + 'components/layout/AppLayout.tsx')
if (!layout) fail('the dispensary AppLayout is missing')
if (/dark:text-orange-400/.test(codeOnly(layout))) fail('the active sidebar item should use the lighter orange-300 on the tinted dark panel')

// ── M1 ─────────────────────────────────────────────────────────────────────────────────────────────
if (!/max-w-xs break-words/.test(table)) fail('a table cell must be width-bounded and wrap, or one long value sizes the whole table')
if (!/break-words" title=\{val\}/.test(customers)) fail('a customer name must wrap and keep its full value on hover')

const contacts = read('templates/crm-dispensary/backend/src/routes/contacts.ts')
if (!contacts) fail('the dispensary contacts routes are missing')
if (!/const NAME_MAX = 200/.test(contacts)) fail('a name needs a ceiling — the field had a floor and none, and a 404-character name was stored')
// Pinned to cleanName specifically. Accepting "either helper" let the field be reverted to the silent
// rewrite while the guard still passed, because cleanName remained DEFINED in the file — a guard that
// does not fail on the defect is not a guard.
if (!/name: cleanName\(NAME_MAX\)/.test(contacts)) fail('…and the name field must actually use it, through cleanName')
// A name is stored as typed or refused — never quietly rewritten. Markup being stripped from a contact
// name without the person knowing was reported five runs running; three attempts to TELL them failed
// (the server sends the warning, the bundle carries the notice, the deployed handler shows it), so the
// edit itself stops. notes and address keep strip-and-warn: a paragraph is not a label. (T37)
if (!/const cleanName = /.test(contacts)) fail('a contact NAME must go through cleanName — cleanText rewrites silently, which is the defect')
if (!/cleaned !== raw\.trim\(\)/.test(contacts)) fail('…refusing precisely when stripping would CHANGE the value, so "Tom & Jerry <3" stays legal')
if (!/max != null/.test(contacts)) fail('…with cleanText able to carry a maximum at all')

if (failed) { console.error(`\nreadable in both themes: ${failed} check(s) FAILED`); process.exit(1) }
console.log('readable in both themes: dark mode carries its own colours, and one long name cannot take the table with it')

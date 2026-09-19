// CI guard: Salon T20 M2, M4, M5, M6.
//
//   M2 — GET /api/clients returned all 74 contacts, 8 of them leads, under a page that says "Everyone
//        who sits in your chairs", and the dashboard tile read "Clients 74" while counting every
//        contact row there was. /api/contacts/stats had the split right all along, so the number the
//        owner is most likely to quote was the wrong one of the two.
//   M4 — POST /api/service-records accepted performedAt nine months out without a word, and it then
//        headed Recent Services and the portal's Recent Activity: the "most recent" panels were
//        showing the furthest-FUTURE records.
//   M5 — a half-typed date put the heading into "Chairs on Invalid Date" over the previous day's rows,
//        logging RangeError: Invalid time value each keystroke.
//   M6 — three recurring elements under 4.5:1 in dark mode. The cause is one thing: every template's
//        tailwind config overrides orange-* with the TENANT'S brand palette, so text-orange-400 is that
//        brand's hue at a fixed 55% lightness and text-orange-500 is the raw brand hex. Bright for a
//        warm hue, dark for a cool one — which is why the same class measured 6.8:1 on one tenant and
//        3.25:1 on another, and why it looked unreproducible. Shade 200 clears AA for every hue.
//   bun scripts/check-salon-mediums.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const B = 'templates/crm-salon/backend/src/'

// ── M2 ────────────────────────────────────────────────────────────────────────────────────────────
const types = read(B + 'utils/clientTypes.ts')
if (!types) fail('utils/clientTypes.ts is missing — who counts as a client needs one definition')
if (!/export const NON_CLIENT_TYPES = \['lead', 'vendor'\] as const/.test(types)) fail('…a lead has not sat in a chair, and a vendor is not a customer')
const clients = read(B + 'routes/clients.ts')
if (/ne\(contact\.type, 'vendor'\)\]/.test(clients)) fail('the Clients page must not list leads — excluding only vendors is what put 8 of them in the book')
if (!/isClient\(\)\]/.test(clients)) fail('…it must use the shared rule')
const dash = read(B + 'routes/dashboard.ts')
if (!/\.from\(contact\)\.where\(clientsOf\(companyId\)\)/.test(dash)) fail('the dashboard Clients tile must count the same people the Clients page lists, not every contact row')

// ── M4 ────────────────────────────────────────────────────────────────────────────────────────────
const recs = read(B + 'routes/serviceRecords.ts')
if (!/import \{ hasHappened \} from '\.\.\/shared\/index\.ts'/.test(recs)) fail('a visit must be held to the same date rule as expenses and time entries')
if ((recs.match(/!hasHappened\(/g) || []).length < 2) fail('…on create AND on edit — otherwise an edit is the way a future visit gets in')
if (!/code: 'FUTURE_VISIT'/.test(recs)) fail('…refused by name')
const shared = read('packages/tenant-backend/src/index.ts')
if (!/export \{ hasHappened, withinHorizon, horizonMessage, MAX_PLAN_YEARS, FUTURE_SLACK_MS \} from '\.\/dateInput'/.test(shared)) fail('the date rules must be re-exported so a template can reach them through the shared index')

// ── M5 ────────────────────────────────────────────────────────────────────────────────────────────
const book = read('templates/crm-salon/frontend/src/pages/salon/AppointmentsPage.tsx')
if (!book) fail('the salon book page is missing')
if (!/export function isDayComplete\(day: string\): boolean/.test(book)) fail('a half-typed date must be recognised before it reaches new Date()')
if (!/if \(!isDayComplete\(day\)\) return;/.test(book)) fail('…and the loader must not run on one — that is the RangeError behind the stale rows')
if (!/dayHeading\(day, todayStr\(\)\) \?\? shownHeading/.test(book)) fail('the heading must hold the day actually on screen, never render "Chairs on Invalid Date" over another day\'s rows')

// ── M6 ────────────────────────────────────────────────────────────────────────────────────────────
const shell = read('packages/tenant-ui/src/shell/AppShell.tsx')
if (/dark:text-orange-400/.test(shell)) fail('the active nav item must not use brand shade 400 in dark mode — for a cool brand hue that is 3.04:1')
if (!/dark:text-orange-200/.test(shell)) fail('…shade 200 is the shade that clears AA whatever the tenant\'s brand colour is')
const contactsPage = read('packages/tenant-ui/src/contacts/ContactsPage.tsx')
if (!/text-orange-500 dark:text-orange-200 hover:underline/.test(contactsPage)) fail('the contacts email cell must declare a dark colour — it reused the raw brand hex, 2.70:1 for a blue brand')
const leadTheme = read('packages/tenant-ui/src/leads/theme.ts')
if (!/statNew: string/.test(leadTheme)) fail('the Lead Inbox stat colours belong in the palette — what they sit on changes with the theme')
if (!/statNew: '#90caf9', statContacted: '#ffb74d', statConverted: '#81c784',/.test(leadTheme)) fail('…with dark values that clear AA on the dark card')
if (!/statNew: '#1565c0', statContacted: '#e65100', statConverted: '#2e7d32',/.test(leadTheme)) fail('…and the original hexes kept for light mode')
const inbox = read('packages/tenant-ui/src/leads/LeadInboxPage.tsx')
if (/<span style=\{\{ color: '#1565c0' \}\}>\{stats/.test(inbox)) fail('the stat labels must not be inline hexes any more')
if (!/color: c\.statNew/.test(inbox)) fail('…they must read the palette')

if (failed) { console.error(`\nsalon mediums: ${failed} check(s) FAILED`); process.exit(1) }
console.log('salon mediums: the book is clients, a visit has happened, the heading never lies about the day, and the brand palette reads in dark mode')

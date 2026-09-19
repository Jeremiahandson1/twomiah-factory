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
// The field-service report lists six failures on this page; the three above are half of them.
if (!/link: '#90caf9'/.test(leadTheme)) fail('the lead-sources link must be themed too — an inline #2563eb measured 2.83:1 on the dark card (FS T20 M4)')
if (!/faint: '#8193a6'/.test(leadTheme)) fail('…and the faint tier must clear AA: #64748b was 3.07:1 under "No leads yet" (FS T20 M4)')
if (!/statNew: '#1565c0', statContacted: '#e65100', statConverted: '#2e7d32',/.test(leadTheme)) fail('…and the original hexes kept for light mode')
const inbox = read('packages/tenant-ui/src/leads/LeadInboxPage.tsx')
if (/<span style=\{\{ color: '#1565c0' \}\}>\{stats/.test(inbox)) fail('the stat labels must not be inline hexes any more')
if (!/color: c\.statNew/.test(inbox)) fail('…they must read the palette')
if (!/color: c\.link/.test(inbox)) fail('…and so must the lead-sources link, or the palette entry is decoration (FS T20 M4)')

// H5 (open since T20) — the Service Menu must be able to SHOW every category the API accepts. It listed
// seven of twelve, and built its sections from its own list, so a service saved in barber / lashes / brows
// / makeup / the US 'color' matched no section and vanished from the page. Read both lists rather than
// pinning names, so the server can grow its vocabulary and this still holds.
{
  const api = read('templates/crm-salon/backend/src/routes/serviceMenu.ts')
  const page = read('templates/crm-salon/frontend/src/pages/salon/ServiceMenuPage.tsx')
  const listOf = (src: string, re: RegExp) => {
    const m = src.match(re)
    return m ? m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : []
  }
  const server = listOf(api, /const CATEGORIES = \[([^\]]*)\]/)
  const ui = listOf(page, /const CATEGORIES = \[([^\]]*)\]/)
  if (!server.length) fail('serviceMenu.ts must state the categories it accepts')
  if (!ui.length) fail('the Service Menu page must state the categories it shows')
  // 'color' is the same section as 'colour' — the page folds the two spellings together on purpose
  const missing = server.filter((c) => c !== 'color' && !ui.includes(c))
  if (missing.length) fail(`the Service Menu cannot display ${missing.length} categor${missing.length === 1 ? 'y' : 'ies'} the server accepts (${missing.join(', ')}) — a service saved in one of them disappears from the page`)
  if (!/const canonicalCategory = /.test(page)) fail("…and 'color' must fold into 'colour', or the US spelling gets a section of its own")
  if (!/if \(known\.has\(cat\)\) continue/.test(page)) fail('…and a category the page has NOT heard of must still be rendered — a hardcoded list can always fall behind again')
}

// H3 and M4 both fixed a write path and left the rows already written alone — "four orphan invoices worth
// $70.53 are still Open, and the old future-dated visits still head Recent Services". A rule that only
// applies to future writes leaves the screen wrong for as long as the old rows live, so both come with a
// repair. Its safety rules are the same as the rules that replaced them, and they are what is guarded:
// never touch a sale holding money, never invent a date, never take out an invoice a visit still owns.
{
  const rec = read(B + 'routes/serviceRecords.ts')
  if (!/app\.post\('\/repair-legacy'/.test(rec)) fail('the salon must be able to clear up what the old H3 / M4 write paths left behind')
  if (!/i\.notes = 'Created from the appointment book'/.test(rec)) fail('…voiding only sales a VISIT raised, never an invoice someone entered by hand')
  if (!/COALESCE\(i\.amount_paid, '0'\)::numeric - COALESCE\(i\.amount_refunded, '0'\)::numeric <= 0\.005/.test(rec)) fail('…and never one still holding money — the same rule the delete enforces')
  if (!/NOT EXISTS \(SELECT 1 FROM service_record sr WHERE sr\.invoice_id = i\.id\)/.test(rec)) fail('…only where no visit still points at it')
  if (!/SET status = 'void'/.test(rec)) fail('…voided, not deleted, so the number and the audit trail survive')
  // A visit logged before H3 has NO link to its sale — not by invoice id, not by appointment — so
  // "nothing points at this invoice" also describes every sale those older visits raised, which are
  // still owed. The price is what separates them, and without this the repair voided two real $54.25
  // sales on the live tenant whose $50 visits were sitting right there.
  if (!/AND sr3\.price_charged IS NOT NULL/.test(rec) || !/round\(sr3\.price_charged::numeric, 2\) = round\(i\.subtotal::numeric, 2\)/.test(rec)) fail('…and never a sale whose pre-fix visit is still there, matched on the price it charged')
  if (!/AND sr3\.invoice_id IS NULL/.test(rec)) fail('…considering only visits that have no sale of their own')
  // Writing to money has to be reversible, and voiding is deliberately terminal, so the editor cannot
  // put it back by hand.
  if (!/app\.post\('\/repair-legacy\/undo'/.test(rec)) fail('the repair must be reversible — it voids invoices, and a void cannot be undone through the invoice editor')
  if (!/notes LIKE '%Voided: the visit this sale came from was deleted before the sale was linked to it\.'/.test(rec)) fail('…restoring only the invoices this repair itself voided, never one a person voided')
  if (!/WHERE company_id = \$\{cid\} AND performed_at > NOW\(\)/.test(rec)) fail('…and the future-dated visits are the ones dated to a day that has not happened')
  if (!/SET performed_at = created_at/.test(rec)) fail('…moved to the day the record was actually created, which is the one date we know is true about them')
}

if (failed) { console.error(`\nsalon mediums: ${failed} check(s) FAILED`); process.exit(1) }
console.log('salon mediums: the book is clients, a visit has happened, the heading never lies about the day, and the brand palette reads in dark mode')

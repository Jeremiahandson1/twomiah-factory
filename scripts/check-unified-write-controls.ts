// CI guard: a screen that WRITES asks whether this person may — on the unified app's screens AND the shared ones, and
// for every Delete control, at the control. (Live role check, 2026-10-23.)
//
//   "Marketing's Delete buttons (campaigns, templates, sequences) show to seats without marketing:delete."
//
// Every one of those routes refused correctly (packages/tenant-backend/src/marketing/marketing.ts asks marketing:delete,
// which a manager does not hold); the screen drew the button anyway. scripts/check-write-controls-ask-permission.ts
// could not see it, for two reasons this guard closes:
//
//   1. It walks packages/tenant-ui only. The unified app's own screens (apps/unified/web/src) — where the same sweep
//      found RV's Convert/Dismiss and Submit to DMV, the salon's Delete visit, the draw schedules' and lien waivers'
//      whole action rows — were never walked. RULE 1 below is its per-file rule, on both trees.
//   2. It asks once PER FILE: one useMayWrite anywhere in the page satisfied it. A page that gates its New button and
//      draws Delete for everybody passes a per-file rule. RULE 2 asks at the CONTROL.
//
// RULE 2 guards the property — the Delete control has a permission question among its ANCESTORS — not a keyword near
// it. From the control's line it climbs the JSX by indentation (each shallower line is an enclosing element or
// expression) and asks whether any of them is a permission question: a may…/can… value, a useMay(area) verb, a
// DataTable action's `show:`, or any name this file assigns from useMayWrite / can( / useMay / usePermissions. When the
// climb reaches the top of a component (a dialog, a row), the question moves to where that component is drawn — every
// `<Component` must itself be gated, or be drawn on a state (`{edit && <ShiftDialog`) that only gated controls set — and
// to the parent that hands it a delete callback (`{onDelete && …}` is gated where `onDelete=` is passed).
//
// Exemptions are by FILE and say why — never by line number (guard keys must not be line numbers).
//
//   bun scripts/check-unified-write-controls.ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url)).replace(/\\/g, '/')
const TREES = ['apps/unified/web/src', 'packages/tenant-ui/src']

/** Not CRM seats: the caller is a customer, a family, an applicant, or someone signing in. Path prefixes. */
const EXEMPT: Record<string, string> = {
  'apps/unified/web/src/site/': "the website editor — another branch's (fix-k), with its own admin routes",
  'apps/unified/web/src/crm/portal': "the customer's portal, by their private link",
  'apps/unified/web/src/crm/documentLink': "a quote's or invoice's own page, by the link in its email",
  'apps/unified/web/src/crm/pages/homecare/portals/': "the family and client portals — the caller is a family member or client on the portal's own sign-in",
  'apps/unified/web/src/crm/pages/homecare/publicApp': "the agency's public pages (careers, onboarding packet, paying an invoice)",
  'apps/unified/web/src/crm/pages/homecare/people/public': 'the public careers and application pages',
  'apps/unified/web/src/crm/pages/homecare/people/OnboardingPacketPage': "the new hire's own onboarding packet, by its link",
  'apps/unified/web/src/crm/pages/homecare/people/ApplicationForm': 'the public job application',
  'apps/unified/web/src/crm/pages/homecare/people/CareersPage': 'the public careers page',
  'apps/unified/web/src/crm/pages/VendorPortalPage': "a vendor's portal, by their private link",
  'apps/unified/web/src/crm/pages/roof/field/CrewLinkPage': "a crew's or sub's work order, by the private link in the text (the caller has no seat)",
  'packages/tenant-ui/src/portal/': "the CUSTOMER's portal",
  'packages/tenant-ui/src/auth/': 'sign-in, password reset and two-factor enrolment',
  'packages/tenant-ui/src/account/': "the signed-in person's own profile, password and two-factor — every role's",
  'packages/tenant-ui/src/onboarding/': 'the first-run setup wizard (the owner, before anybody else has a seat)',
}

/**
 * RULE 1: screens that write and ask no permission ANYWHERE in the file, each with the reason that is not a gap a seat
 * meets. The list can only get shorter — a screen that starts asking fails until its entry goes.
 */
const NO_ASK: Record<string, string> = {
  // packages/tenant-ui — the same pages scripts/check-write-controls-ask-permission.ts names in NOT_SWEPT.
  'packages/tenant-ui/src/ads/AdsPage.tsx': "role-string gates (can.update / can.admin): NOT_SWEPT in check-write-controls-ask-permission",
  'packages/tenant-ui/src/booking/BookingSettingsTab.tsx': 'its parent passes `configures` (bookings:settings): NOT_SWEPT there',
  'packages/tenant-ui/src/marketing/MessagesPage.tsx': 'NOT_SWEPT there (sms:send is the page gate)',
  'packages/tenant-ui/src/settings/AccountOffboardPage.tsx': "admin-only by route (shell routeRoles '/crm/settings*')",
  'packages/tenant-ui/src/settings/EmailAliasesPage.tsx': 'admin-only by route (routeRoles)',
  'packages/tenant-ui/src/settings/EmailDomainPage.tsx': 'admin-only by route (routeRoles)',
  'packages/tenant-ui/src/settings/GbpReviewsPage.tsx': 'admin-only by route (routeRoles)',
  'packages/tenant-ui/src/settings/ImportPage.tsx': 'admin-only by route (routeRoles /crm/settings/import)',
  'packages/tenant-ui/src/settings/InboundMessagesPage.tsx': 'admin-only by route (routeRoles)',
  'packages/tenant-ui/src/settings/IntegrationsPage.tsx': 'admin-only by route (routeRoles)',
  'packages/tenant-ui/src/settings/MigrationPage.tsx': 'admin-only by route (routeRoles)',
  'packages/tenant-ui/src/shell/FeaturesSettingsPage.tsx': 'admin-only by route (routeRoles)',
  // apps/unified/web — every route each one calls is the signed-in person's OWN record, or the page's menu gate is the
  // permission every write on it asks.
  'apps/unified/web/src/crm/financingOffer.tsx': "the CUSTOMER's financing offer, by its link (POST /api/financing-public/d/:token/apply — no CRM seat)",
  'apps/unified/web/src/crm/pages/ContactSupportPage.tsx': 'raising a ticket with Twomiah — open to everyone who can sign in (permissions.ts: support desk note)',
  'apps/unified/web/src/crm/pages/PricebookTrialPage.tsx': 'its one write raises a ticket with Twomiah (POST /api/platform-support/tickets, open to every signed-in person)',
  'apps/unified/web/src/crm/pages/roof/reports/EstimatorTrialPage.tsx': 'its one write raises a ticket with Twomiah (POST /api/platform-support/tickets, open to every signed-in person)',
  'apps/unified/web/src/crm/pages/bar/ClockPage.tsx': "a person's OWN clock in/out (POST /api/register/clock); bar:register is the page gate (bar.tsx routePermissions)",
  'apps/unified/web/src/crm/pages/bar/CloseoutPage.tsx': "POST /api/register/closeout asks bar:register, the page gate; the server decides the night's scope (manager) or the person's own",
  'apps/unified/web/src/crm/pages/bar/CountPage.tsx': 'POST /api/stock/count/* asks the counter gate (bar:register), the page gate',
  'apps/unified/web/src/crm/pages/bar/GrillPage.tsx': 'POST /api/grill/bump and /recall ask bar:register, the page gate',
  'apps/unified/web/src/crm/pages/bar/GiftCardsPage.tsx': 'bar:manage is the page gate (bar.tsx) and its writes (void, adjust) ask bar:manage (barGiftCardRoutes.ts)',
  'apps/unified/web/src/crm/pages/bar/StockPage.tsx': "bar:update is the page gate (bar.tsx) and every write on it asks bar:update (barStockRoutes.ts 'manage')",
  'apps/unified/web/src/crm/pages/homecare/office/AuditLogs.tsx': 'its only POSTs are the export and the compliance report — reads, under the page gate care-compliance:read',
  'apps/unified/web/src/crm/pages/homecare/office/MessageBoard.tsx': "the person's own messages (care-portal:update is the page gate; the server narrows each thread to its participants)",
  'apps/unified/web/src/crm/pages/homecare/office/SandataPanel.tsx': "drawn only in IntegrationsHub's EVV tab, which shows for evv:delete — the permission the Sandata routes ask",
  'apps/unified/web/src/crm/pages/homecare/people/AddCaregiverModal.tsx': 'opened only by CaregiverManagement under mayHr.create',
  'apps/unified/web/src/crm/pages/homecare/schedule/MakeShiftAvailableModal.tsx': 'opened only by controls under may.create && may.update (care-schedule) in SchedulingHub and DragDropScheduler',
  'apps/unified/web/src/crm/pages/homecare/visits/caregiver/CaregiverMessages.tsx': "the caregiver's own app: their own messages",
  'apps/unified/web/src/crm/pages/homecare/visits/caregiver/IncidentReportForm.tsx': "the caregiver's own app: reporting an incident on their own visit",
  'apps/unified/web/src/crm/pages/homecare/visits/caregiver/PaydayVerificationModal.tsx': "the caregiver's own app: confirming their own payday (my-pay)",
  'apps/unified/web/src/crm/pages/homecare/visits/caregiver/ShiftMissReport.tsx': "the caregiver's own app: reporting their own missed shift",
  'apps/unified/web/src/crm/pages/homecare/visits/caregiver/VisitCarePanel.tsx': "the caregiver's own app: recording care on their own visit (evv:create, narrowed to clients they serve)",
  'apps/unified/web/src/crm/pages/homecare/visits/CaregiverClientModal.tsx': "the caregiver's own app: a note on a client they serve (evv:create)",
  'apps/unified/web/src/crm/pages/homecare/visits/CaregiverDashboard.tsx': "the caregiver's own app: their own clock, availability, time off and shifts",
  'apps/unified/web/src/crm/pages/homecare/visits/CareTaskChecklist.tsx': "the caregiver's own app: ticking tasks on their own visit",
  'apps/unified/web/src/crm/pages/roof/field/MaterialOrderForm.tsx': 'opened only by JobMaterials / MaterialsPage under mayAdd (inventory:create)',
  'apps/unified/web/src/crm/pages/rv/AIReportsPage.tsx': 'POST /api/ai-reports/generate asks reports:read, the page gate (rv.tsx)',
  'apps/unified/web/src/crm/pages/rv/AITradeAppraisalPage.tsx': 'POST /api/ai-trade/appraise asks contacts:update, the page gate (rv.tsx)',
  'apps/unified/web/src/crm/pages/vet/VisitEditorModal.tsx': 'opened only by PatientDetailPage controls under mayChart / mayEditChart',
}

/** RULE 2: files whose Delete controls are not a record delete behind a permission. */
const DELETE_EXEMPT: Record<string, string> = {
  'apps/unified/web/src/crm/pages/bar/ClockPage.tsx': 'the PIN pad\'s "Delete a digit" key — no record is deleted',
  'apps/unified/web/src/crm/pages/homecare/office/NotificationCenter.tsx': "a person's OWN notifications (the route narrows DELETE to the caller's own rows)",
  'packages/tenant-ui/src/settings/EmailAliasesPage.tsx': 'admin-only by route (routeRoles /crm/settings/email); the alias row is drawn on that page only',
}

const WRITES = [/\b(api|client)\.(post|put|patch|delete|upload)\s*\(/, /method:\s*['"](POST|PUT|PATCH|DELETE)['"]/]
const ASKS = [
  /useMayWrite\s*\(\s*['"]/, /\bcan\s*\(\s*['"`][a-z-]+:[a-z*]+/, /usePermissions\s*\(\s*\)/, /useKnownPermission\s*\(/,
  /\buseMay\s*\(\s*['"]/,
  // A child that writes on its parent's say-so: the parent asks and passes the answer down.
  /\b(can|may)[A-Z]\w*\??\s*:\s*boolean/,
]

/** A Delete drawn on a screen. */
const DELETE_CONTROL = [/title=["']Delete\b/, /aria-label=\{?["'`]Delete\b/, />\s*Delete\s*</, /label:\s*['"]Delete['"]/]
const BASE_GATE = String.raw`\bmay[A-Z]\w*|\bmay\w*\.(?:read|create|update|delete)\b|\bcan\s*\(|\bcan[A-Z]\w*|\bcan\.\w+|show:\s*\(`
const indentOf = (l: string) => l.length - l.trimStart().length
const COMPONENT = /^\s*(?:export\s+)?(?:default\s+)?(?:function\s+([A-Z]\w*)\s*\(|const\s+([A-Z]\w*)\s*=\s*(?:\([^)]*\)|\w+)\s*=>)/

let failed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }
const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(ROOT + dir)) {
    const rel = `${dir}/${e}`
    if (statSync(ROOT + rel).isDirectory()) walk(rel, out)
    else if (/\.tsx$/.test(e)) out.push(rel)
  }
  return out
}

/** The gate question for one file: the base tokens plus every name the file assigns from a permission answer. */
function gateFor(src: string): RegExp {
  const names = new Set<string>()
  const re = /(?:const|let)\s+(?:\{([^}]*)\}|(\w+))\s*=\s*([^\n;]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (!/useMayWrite|\buseMay\s*\(|\bcan\s*\(|usePermissions|useKnownPermission|\bmay[A-Z]\w*|\bcan[A-Z]\w*|use\w*Writes\s*\(/.test(m[3])) continue
    if (m[2]) names.add(m[2])
    if (m[1]) for (const part of m[1].split(',')) { const n = part.split(':').pop()!.trim().split(/\s|=/)[0]; if (/^\w+$/.test(n)) names.add(n) }
  }
  const extra = [...names].filter((n) => !/^(c|e|i|r|s|x|data|res|row|rows)$/.test(n)).map((n) => `\\b${n}\\b`)
  return new RegExp([BASE_GATE, ...extra].join('|'))
}

const DEBUG = !!process.env.WC_DEBUG
const why = (m: string) => { if (DEBUG) console.log('    gate: ' + m.trim().slice(0, 150)) }
function gatedAt(lines: string[], i: number, gate: RegExp, depth: number, src: string): boolean {
  if (gate.test(lines[i])) { why(lines[i]); return true }
  let indent = indentOf(lines[i])
  for (let j = i - 1; j >= 0 && j >= i - 400; j--) {
    const l = lines[j]
    if (!l.trim() || /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)) continue
    const ind = indentOf(l)
    if (ind >= indent) continue
    indent = ind
    if (gate.test(l)) { why(l); return true }
    // A delete callback handed in by the parent: gated where it is passed.
    const prop = /\{\s*(on[A-Z]\w*)\s*&&/.exec(l)
    if (prop) {
      const owner = enclosingComponent(lines, j)
      if (owner && depth < 3) return propGated(lines, owner, prop[1], gate, depth + 1, src)
    }
    const comp = COMPONENT.exec(l)
    if (comp) {
      const name = comp[1] || comp[2]
      return depth < 3 ? usagesGated(lines, name, gate, depth + 1, src) : false
    }
    if (ind === 0) break
  }
  return false
}
function enclosingComponent(lines: string[], i: number): string | null {
  for (let j = i; j >= 0; j--) { const m = COMPONENT.exec(lines[j]); if (m && indentOf(lines[j]) === 0) return m[1] || m[2] }
  return null
}
function propGated(lines: string[], component: string, prop: string, gate: RegExp, depth: number, src: string): boolean {
  const uses = lines.flatMap((l, i) => (new RegExp(`<${component}\\b`).test(l) ? [i] : []))
  if (!uses.length) return false
  return uses.every((u) => {
    for (let k = u; k < Math.min(lines.length, u + 12); k++) {
      if (new RegExp(`\\b${prop}=`).test(lines[k])) return gate.test(lines[k]) || gatedAt(lines, k, gate, depth, src)
    }
    return true // not passed at all → never drawn
  })
}
function usagesGated(lines: string[], component: string, gate: RegExp, depth: number, src: string): boolean {
  const uses = lines.flatMap((l, i) => (new RegExp(`<${component}\\b`).test(l) ? [i] : []))
  if (!uses.length) return false
  return uses.every((u) => {
    if (gatedAt(lines, u, gate, depth, src)) return true
    // Drawn on a state that only gated controls set: `{edit && <ShiftDialog` → every setEdit(<something>) is gated.
    const on = new RegExp(`\\{\\s*!*\\(?\\s*(\\w+)[^{}]*?(?:&&|\\?)\\s*\\(?\\s*<${component}\\b`).exec(lines[u])
    if (!on) return false
    const setter = 'set' + on[1][0].toUpperCase() + on[1].slice(1)
    const sets = lines.flatMap((l, i) => (new RegExp(`\\b${setter}\\(\\s*(?!null\\b|false\\b|undefined\\b|''|""|\\)|\\[\\])`).test(l) && !/useState/.test(l) ? [i] : []))
    if (!sets.length) return false
    return sets.every((s) => gatedAt(lines, s, gate, depth, src))
  })
}

let files: string[] = []
for (const t of TREES) { try { files = files.concat(walk(t)) } catch { fail(`${t} is missing — fix this guard's walk`) } }
if (files.length < 300) fail(`only ${files.length} screens walked — the walk is broken, not the code`)

let writers = 0, asked = 0, deletes = 0
for (const rel of files) {
  if (Object.keys(EXEMPT).some((p) => rel.startsWith(p))) continue
  const src = readFileSync(ROOT + rel, 'utf8')
  const lines = src.split(/\r?\n/)

  // RULE 1 — a screen that writes asks.
  if (WRITES.some((re) => re.test(src))) {
    writers++
    if (ASKS.some((re) => re.test(src))) { asked++; if (NO_ASK[rel]) fail(`${rel} now asks a permission but is still listed in NO_ASK — remove the entry`) }
    else if (!NO_ASK[rel]) fail(`${rel} writes (api.post/put/patch/delete) and never asks whether this person may. Read the permission off the route each control calls and gate the control on it (useMayWrite('x:y'), can('x:y'), useMay(area)).`)
  }

  // RULE 2 — every Delete has a permission question among its ancestors.
  if (DELETE_EXEMPT[rel]) continue
  const gate = gateFor(src)
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
    if (!DELETE_CONTROL.some((re) => re.test(line))) return
    // A confirm dialog's own title or button opens only from its trigger, which is checked where it is drawn.
    for (let j = i; j >= Math.max(0, i - 8); j--) {
      if (/<(ConfirmModal|Modal|Dialog)\b/.test(lines[j])) return
      if (j < i && /<\w/.test(lines[j]) && indentOf(lines[j]) < indentOf(line)) break
    }
    deletes++
    if (DEBUG) console.log(`${rel}:${i + 1}`)
    if (!gatedAt(lines, i, gate, 0, src)) fail(`${rel}:${i + 1} draws a Delete with no permission question among its ancestors — gate it on the permission its route asks (e.g. {mayDelete && …}). Line: ${line.trim().slice(0, 140)}`)
  })
}

for (const rel of [...Object.keys(NO_ASK), ...Object.keys(DELETE_EXEMPT)]) if (!files.includes(rel)) fail(`an exemption names ${rel}, which no longer exists — remove it`)

if (failed) { console.error(`\nunified write controls: ${failed} problem(s).`); process.exit(1) }
console.log(`unified write controls: ${asked} of ${writers} writing screens ask a permission (${Object.keys(NO_ASK).length} named exemptions); ${deletes} Delete controls, each with a permission question among its ancestors`)

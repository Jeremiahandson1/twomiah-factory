// CI guard: a shared screen that WRITES must ask whether this person may.
//
// WHY THIS EXISTS. T42, fleet-wide, on seven tenants at once:
//
//   "Buttons offered to roles that can't use them. The server refuses every write correctly, but
//    staff and viewer still see create/edit buttons on many pages (Showcase, Field service, Events,
//    Salon Front Desk, Vet viewer, Contractor viewer, Roofing claim page). Some fail silently
//    (Showcase Locations, AI Receptionist, Fleet)."
//
// The server half was right. This is the screen's half, and it was not a handful of oversights: of
// the 40 shared pages that carry a write control, THIRTY asked no permission at all. A page in
// packages/tenant-ui ships to every vertical at once, so each one of those was the same finding
// filed ten times.
//
// WHAT IT CHECKS. A page that calls `api.post` / `put` / `patch` / `delete` — or a raw `fetch` with
// one of those methods — must also ask a permission: `useMayWrite('x:y')`, `cfg.can('x:y')` or
// `usePermissions().can(...)`. Nothing here checks WHICH permission, because no static rule can know
// that; what it stops is a page that writes and never asks. The permission itself has to be read off
// the route the control calls, which is how every gate in the swept list below was chosen.
//
// `useMayWrite` ANSWERS TRUE WHERE NO PROVIDER IS MOUNTED, which is what makes adding a gate safe:
// crm-roof and crm-store fork the auth context and mount no permissions provider, so they keep every
// control rather than losing it to a `false` they never supplied. The server gates all of it anyway.
//
// THE TWO LISTS BELOW ARE THE POINT.
//   EXEMPT       pages where a CRM permission is the wrong question — the customer's own portal,
//                the sign-in screens, the first-run setup wizard.
//   NOT_SWEPT    pages that still write without asking. Each one is a known, named gap rather than a
//                silent one: the list is the work remaining, it is visible in CI, and it can only
//                get shorter — a page not on it that starts writing without asking fails the build.
//
//   bun scripts/check-write-controls-ask-permission.ts
import { readdirSync, statSync, readFileSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const UI = `${ROOT}packages/tenant-ui/src`

/** A CRM permission is the wrong question on these. */
const EXEMPT: Record<string, string> = {
  'portal/': "the CUSTOMER's portal — the caller is the customer, authenticated by their own token, and holds no CRM role",
  'auth/': 'sign-in, password reset and two-factor enrolment — the caller is proving who they are',
  // T60: the person's OWN two-factor and password, for every role. PUT /api/auth/password and the MFA
  // routes act on the session's own user and carry no role gate; a permission here would be the
  // wrong question and would put a person's own security behind the shop's door again.
  'account/': "the signed-in person's own two-factor and password — every role manages how they themselves sign in",
  'onboarding/': 'the first-run setup wizard, which the owner walks through before anybody else has a seat',
}

/**
 * Still writing without asking. Each entry says what it would take, so the next person does not have
 * to work it out again. Every permission named here was read off the route, not guessed.
 */
const NOT_SWEPT: Record<string, string> = {
  'ads/AdsPage.tsx': 'three permissions, not one — ads:update (experiments, pause, dismiss), ads:settings (connect, mode, profile) and ads:spend (launch, resume, apply a recommendation). Worth doing as one careful pass, because spending money and changing a setting are not the same control',
  'booking/BookingSettingsTab.tsx': 'PUT /api/booking/settings is gated by `configuresBooking`; the screen should ask the same permission that const resolves to',
  'files/DocumentsPage.tsx': 'documents:create (upload, markup), documents:update (restore a version), documents:delete (remove). Upload is also a drag-and-drop target, not only a button, so the gate has to cover both',
  'marketing/MarketingPage.tsx': 'fourteen controls across campaigns, sequences and templates — marketing:create, marketing:update and the send/schedule pair. The biggest single page left',
  'marketing/MessagesPage.tsx': 'sms:send for Send and Reply (the `textsACustomer` gate); Archive asks contacts:read, which anybody who can open the inbox already holds',
  'schedule/SchedulePage.tsx': 'jobs:update for dragging a job, and the schedule-events module\'s own create/update/delete for the events',
  'invoicing/QuoteDetailPage.tsx': 'its one write is a template-owned DELETE /api/quotes; the quote routes are forked per vertical, so the permission has to be read per template',
  'recurring/RecurringForm.tsx': 'invoices:create on the new form and invoices:update on the edit form — the list beside it is done',
  'settings/AccountOffboardPage.tsx': 'account closure. Admin-only by route; the page is reached from Settings, which already gates its tabs',
  'settings/BillingPage.tsx': 'the subscription. Admin-only by route; same note as above',
  'settings/EmailAliasesPage.tsx': 'admin-only by route',
  'settings/EmailDomainPage.tsx': 'admin-only by route',
  'settings/GbpReviewsPage.tsx': 'admin-only by route',
  'settings/InboundMessagesPage.tsx': 'admin-only by route',
  'settings/IntegrationsPage.tsx': 'admin-only by route — and the same page leaks the Stripe account id to a lower seat, which is a server fix first (T42)',
  'settings/MigrationPage.tsx': 'admin-only by route',
  'shell/FeaturesSettingsPage.tsx': 'settings:update — the feature switches',
  // A settings page reached by URL also shows raw "Failed to load: 403" text to a non-admin (T42,
  // Events and Contractor). That is the same cluster and wants one answer: a page that cannot be
  // used says so in words, instead of printing the status code.
}

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

function walk(dir: string, out: string[] = []) {
  for (const e of readdirSync(dir)) {
    const p = `${dir}/${e}`
    if (statSync(p).isDirectory()) walk(p, out)
    else if (e.endsWith('.tsx')) out.push(p)
  }
  return out
}

const WRITES = [
  /\bapi\.(post|put|patch|delete)\s*\(/,
  /method:\s*['"](POST|PUT|PATCH|DELETE)['"]/,
]
const ASKS = [
  /useMayWrite\s*\(\s*['"]/,
  /\bcan\s*\(\s*['"][a-z-]+:[a-z*]+['"]/,
  /usePermissions\s*\(\s*\)/,
]

const files = walk(UI)
if (files.length < 60) fail(`only ${files.length} shared pages walked — the walk is broken, not the code`)

let writers = 0, gated = 0, exempt = 0, pending = 0
const swept: string[] = []
for (const abs of files) {
  const rel = abs.slice(UI.length + 1).replace(/\\/g, '/')
  const src = readFileSync(abs, 'utf8')
  if (!WRITES.some((re) => re.test(src))) continue
  writers++

  const exemptReason = Object.entries(EXEMPT).find(([prefix]) => rel.startsWith(prefix))
  if (exemptReason) { exempt++; continue }

  const asks = ASKS.some((re) => re.test(src))
  if (asks) {
    gated++
    swept.push(rel)
    // A page that has been swept must not quietly go back on the pending list.
    if (NOT_SWEPT[rel]) fail(`${rel} now asks a permission but is still listed in NOT_SWEPT — remove the entry, the gap is closed`)
    continue
  }

  if (NOT_SWEPT[rel]) { pending++; continue }
  fail(`${rel} issues a write (api.post/put/patch/delete, or a fetch with one of those methods) and never asks whether this person may. ` +
    `Read the permission off the ROUTE the control calls and gate the control on it with useMayWrite('x:y') — ` +
    `it answers true where no permissions provider is mounted, so a vertical that forks the auth context keeps its controls. ` +
    `If a CRM permission is the wrong question here, add the page to EXEMPT with the reason; if it is a known gap, add it to NOT_SWEPT with what it needs.`)
}

// The pending list is only honest if every name on it still exists and still writes without asking.
for (const rel of Object.keys(NOT_SWEPT)) {
  if (!files.some((f) => f.slice(UI.length + 1).replace(/\\/g, '/') === rel)) {
    fail(`NOT_SWEPT names ${rel}, which no longer exists — remove it, or point it at the page that replaced it`)
  }
}

if (failed) {
  console.error(`\nwrite controls: ${failed} problem(s).`)
  process.exit(1)
}
console.log(`write controls: ${gated} of ${writers} shared pages that write ask a permission; ${pending} named as not-yet-swept, ${exempt} exempt (the customer portal, sign-in, the setup wizard)`)
console.log(`  swept: ${swept.sort().join(', ')}`)

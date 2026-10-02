// CI guard: the customer-portal panel must not be hidden by a missing field — it must say what is missing.
//
// WHY THIS EXISTS. T37 N10: "The contact's portal was disabled and I found no portal or invite button
// on the contact page to turn it on; it had to be enabled through the API."
//
// Everything was in place. `client_portal` was enabled on the tenant, `sections.portal` was true,
// GET /api/portal/contacts/:id/status answered 200, and the panel — toggle, link, copy, resend
// invite — existed in the shared ContactDetailPage. The render condition was:
//
//     {showPortal && contact.email && (() => { … })}
//
// so a contact with no email address got NO PANEL AT ALL: no toggle, no invite, and nothing saying
// why. From the outside that is indistinguishable from the feature not existing. 17 of ctrtest's 98
// contacts had no email, including every `lead`.
//
// The email is genuinely required — the invite is sent to it — so the toggle stays disabled until
// there is one. What must never come back is the panel VANISHING instead of naming the prerequisite.
// A feature with a screen that silently disappears is a feature with no screen.
//
// This is the guard form of the project's standing rule that any server feature needs a screen, and
// the sibling of #171/#172 (gate the API and the nav together): here both sides were gated correctly
// and a third, undeclared condition hid the control anyway.
//
// WHAT IT WALKS. One file. There is exactly one real implementation —
// packages/tenant-ui/src/contacts/ContactDetailPage.tsx — and every template but two is a 13-line
// wrapper that hands it an api client and config. crm-dispensary ships its own contact page with no
// portal at all (a POS has no client portal) and crm-automotive is PARKED; neither is walked, and
// the guard says so rather than silently skipping them.
//
//   bun scripts/check-portal-panel-reachable.ts
import { readFileSync, existsSync } from 'node:fs'
import { stripSource as strip } from './lib/stripComments.ts'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const PAGE = 'packages/tenant-ui/src/contacts/ContactDetailPage.tsx'

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const path = `${ROOT}${PAGE}`
if (!existsSync(path)) {
  // The page moving is not a pass. If it is renamed, this guard must be pointed at the new one.
  console.error(`FAIL: ${PAGE} does not exist — if the shared contact page moved, point this guard at it`)
  process.exit(1)
}

// Comments quote the broken condition on purpose (see the header), so they are stripped first or the
// guard fails on its own explanation — the mistake #190's family already made once.
const src = strip(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'))

// ── 1. the panel is not gated on the email ─────────────────────────────────────────────────────
//
// Pinned to the CONDITION, not to the surrounding JSX: `showPortal` followed by a `contact.email`
// test before the panel body. Written loosely enough to catch `contact?.email`, `!!contact.email`
// and a reordering, and tightly enough not to fire on the email ROW inside the panel.
const gatedOnEmail = /showPortal\s*&&\s*(?:!!\s*)?contact\??\.(?:email)\s*&&/.test(src)
if (gatedOnEmail) {
  fail(`${PAGE}: the portal panel is gated on \`contact.email\` — a contact with no email address gets no panel, no toggle and no explanation, which is what T37 N10 reported as "no portal or invite button". Render the panel on \`showPortal\` alone and disable the toggle with a line naming the missing email instead.`)
}

// …and it IS still gated on showPortal, so removing the email check did not open it everywhere.
if (!/\{\s*showPortal\s*&&/.test(src)) {
  fail(`${PAGE}: the portal panel is no longer gated on \`showPortal\` — the client_portal feature gate and sections.portal must still decide whether the panel exists at all`)
}

// ── 2. there is a no-email branch, and it tells the person what to do ─────────────────────────
if (!/noEmail/.test(src)) {
  fail(`${PAGE}: no \`noEmail\` branch — the panel must distinguish "no email yet" from "portal off" and say which`)
} else {
  /**
   * The prerequisite has to be stated in words a user READS on the page.
   *
   * This first matched a loose /[Aa]dd an email address/, and the mutation that replaced the visible
   * paragraph still passed — because `title="Add an email address first"` on the toggle satisfied it.
   * A tooltip is not an explanation: it needs a hover, so it does not exist on a phone or a tablet,
   * which is half the fleet's traffic. The assertion therefore names the paragraph's own copy.
   */
  const saysIt = /[Aa]dd an email address to this contact/.test(src)
  if (!saysIt) {
    fail(`${PAGE}: the no-email state does not tell the person, in visible copy, to add an email address to this contact — a disabled toggle with only a title= tooltip is the same dead end as a hidden panel on any device without hover`)
  }

  // ── 3. the toggle is actually disabled without one ──────────────────────────────────────────
  // Otherwise the screen offers a button the server will refuse: the "server refusal needs its
  // client" rule, from the other direction.
  if (!/disabled=\{[^}]*noEmail[^}]*\}/.test(src)) {
    fail(`${PAGE}: the portal toggle is not disabled when there is no email — enabling the portal sends an invite to that address, so the control must not be offered`)
  }

  // ── 4. and the resend-invite button is not offered either ───────────────────────────────────
  // The portal can be switched on through the API without an email, so `portalStatus.enabled`
  // alone is not enough to justify showing "Resend Portal Invite".
  if (!/portalStatus\?\.enabled\s*&&\s*!noEmail/.test(src)) {
    fail(`${PAGE}: "Resend Portal Invite" is shown on \`portalStatus.enabled\` alone — the portal can be enabled through the API with no email on the contact, so this needs \`&& !noEmail\``)
  }
}

if (failed) {
  console.error(`\nportal panel: ${failed} problem(s).`)
  process.exit(1)
}
console.log('portal panel: the contact page renders the portal panel without an email and names the prerequisite; the toggle and resend are withheld until there is one (1 shared page; crm-dispensary has no portal by design, crm-automotive is parked)')

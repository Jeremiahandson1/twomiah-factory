// CI guard: a shared route module that WRITES must authorise, not just authenticate.
//
// createJobRoutes took `authenticate` and no requirePermission at all, so every route under /api/jobs was
// open to any signed-in user of the company: Field Service T30 had a STAFF login create a service call and
// then delete it. The permission matrix already said `field` gets jobs:read and jobs:update and no more —
// nothing ever asked it.
//
// Authentication answers "who are you". Authorisation answers "may you". A module that only does the first
// looks correct in review: there IS a guard on every route, it is just the wrong guard.
//
// WHY THERE IS A BASELINE
// -----------------------
// Turning this on found eighteen modules, not one. Gating all of them in a single sweep is precisely the
// change that takes a system down — several are webhooks, and a wrong refusal in billing or integrations
// is an outage, not a hardening. So the rule is enforced in full for everything NOT listed below, and the
// list is the debt, written down with counts so it cannot quietly grow. Fixing one means deleting its
// line; nobody has to remember it exists.
//
//   bun scripts/check-write-routes-authorise.ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/**
 * Called by something that is not a signed-in user: a provider webhook, an inbound parse hook, a cron
 * trigger. These authenticate by signature or shared secret, and a permission check on a human's role
 * would refuse the caller every time.
 */
const NOT_A_USER = /webhook|inbound|factory-event|\/process|portal\//

/**
 * Public by design — the customer portal (the token IS the identity), public booking, and auth itself.
 * Named rather than pattern-matched, so adding one is a decision somebody makes on purpose.
 */
const PUBLIC_BY_DESIGN = new Set([
  'packages/tenant-backend/src/portal/portal.ts',
  'packages/tenant-backend/src/booking/routes.ts',
  'packages/tenant-backend/src/auth/auth.ts',
])

/**
 * Known debt, with the number of unauthorised write routes each module had when this guard was written.
 * The count may go DOWN (fix some) or to zero (delete the line). It may not go up.
 *
 * Every one of these is a real hole: any signed-in user of the company can currently drive them. They are
 * listed rather than fixed in one sweep because several touch billing and third-party connections, where
 * a wrong refusal is an outage. (Field Service T30)
 */
const BASELINE: Record<string, number> = {
  'packages/tenant-backend/src/account.ts': 2,
  'packages/tenant-backend/src/ads/ads.ts': 2,
  'packages/tenant-backend/src/billing.ts': 2,
  'packages/tenant-backend/src/emailAliases.ts': 3,
  'packages/tenant-backend/src/emailDomain.ts': 1,
  'packages/tenant-backend/src/files/documents.ts': 9,
  'packages/tenant-backend/src/fleet/fleet.ts': 4,
  'packages/tenant-backend/src/gbp.ts': 4,
  'packages/tenant-backend/src/inboundMessages.ts': 1,
  'packages/tenant-backend/src/integrations/quickbooks.ts': 3,
  'packages/tenant-backend/src/integrations/reviews.ts': 3,
  'packages/tenant-backend/src/integrations/sms.ts': 9,
  'packages/tenant-backend/src/onboarding.ts': 1,
  'packages/tenant-backend/src/warranties/warranties.ts': 1,
}

const files: string[] = []
const walk = (rel: string) => {
  let entries: string[]
  try { entries = readdirSync(ROOT + rel) } catch { return }
  for (const e of entries) {
    const child = `${rel}/${e}`
    if (e === 'node_modules') continue
    if (statSync(ROOT + child).isDirectory()) { walk(child); continue }
    if (e.endsWith('.ts')) files.push(child)
  }
}
walk('packages/tenant-backend/src')

let clean = 0, checked = 0, debt = 0
for (const rel of files) {
  const src = stripComments(readFileSync(ROOT + rel, 'utf8').replace(/\r\n/g, '\n'))
  if (!/export function create\w*Routes/.test(src)) continue
  if (PUBLIC_BY_DESIGN.has(rel)) continue

  const writes = [...src.matchAll(/^\s*app\.(post|put|patch|delete)\(([^\n]*)$/gm)]
    .filter((m) => !NOT_A_USER.test(m[2]))
  if (!writes.length) continue
  checked++

  const unguarded = writes.filter((m) => !/require(Permission|AnyPermission|Role|Admin|Ownership)/.test(m[2]))
  const allowed = BASELINE[rel]

  if (allowed === undefined) {
    if (unguarded.length) {
      const sample = unguarded.slice(0, 3).map((m) => m[2].trim().slice(0, 52))
      fail(`${rel}: ${unguarded.length} write route(s) authenticate but do not authorise — any signed-in user of the company can drive them. e.g. ${sample.join(' | ')}`)
    } else clean++
    continue
  }

  debt += unguarded.length
  if (unguarded.length > allowed) {
    fail(`${rel}: unauthorised write routes went from ${allowed} to ${unguarded.length} — the debt list is a ceiling, not a licence`)
  } else if (unguarded.length < allowed) {
    fail(`${rel}: down to ${unguarded.length} unauthorised write route(s) from ${allowed} — good, now lower the number in BASELINE (or delete the line at 0) so it cannot creep back`)
  }
}

if (failed) { console.error(`\nwrite routes authorise: ${failed} problem(s).`); process.exit(1) }
console.log(`write routes authorise: ${clean} of ${checked} module(s) guard every user-facing write; ${Object.keys(BASELINE).length} on the debt list carrying ${debt} unauthorised route(s)`)

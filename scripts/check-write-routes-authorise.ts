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
 *
 * An entry may name a whole file, or one factory inside it as `path#createXRoutes`. ads/ads.ts holds
 * both an authenticated router and an anonymous one: createAdsPublicRoutes is mounted at
 * /api/public/ads-experiments with open CORS and no authenticate, because POST /assign hands a
 * website visitor a sticky A/B variant and POST /convert records that they converted. There is no
 * user there to authorise, and judging it by the authenticated half put two public endpoints on the
 * debt list — where following the guard would have meant breaking A/B testing on every premium site.
 */
const PUBLIC_BY_DESIGN = new Set([
  'packages/tenant-backend/src/portal/portal.ts',
  'packages/tenant-backend/src/booking/routes.ts',
  'packages/tenant-backend/src/auth/auth.ts',
  'packages/tenant-backend/src/ads/ads.ts#createAdsPublicRoutes',
])

/**
 * Known debt: write routes any signed-in user of the company can genuinely drive, with the count each
 * module carried when it was triaged. The count may go DOWN (fix some) or to zero (delete the line). It
 * may not go up.
 *
 * Seven modules, not the fourteen this list started with. The other seven — gbp, emailAliases, billing,
 * account, onboarding, inboundMessages, emailDomain — turned out to be mounted behind requireAdmin by
 * every template that wires them, which this guard could not see because it only read the shared
 * package. mountGuard() below reads the wiring too, so those are reported as guarded rather than
 * counted as debt. (Field Service T30, triaged after)
 */
const BASELINE: Record<string, number> = {
}

/**
 * Is this shared module mounted behind a blanket guard by EVERY template that wires it?
 *
 * The factory names a module exports (createGbpAdminRoutes…) are what a template imports, so they are
 * the link between the two halves. A template that wires the factory and puts
 * `app.use('*', authenticate, requireAdmin)` above it has authorised every route under it, whatever the
 * shared module does.
 *
 * Returns null when nothing wires it (nothing to say), the guard text when all of them do, and a
 * FAILURE when only some do — a module admin-only in six verticals and open in the seventh is the worst
 * of the three outcomes and the easiest to create.
 */
const templateRoutes: { rel: string; src: string }[] = []
{
  let tpls: string[] = []
  try { tpls = readdirSync(ROOT + 'templates') } catch { tpls = [] }
  for (const tpl of tpls) {
    const dir = `templates/${tpl}/backend/src/routes`
    let entries: string[] = []
    try { entries = readdirSync(ROOT + dir) } catch { continue }
    for (const e of entries) if (e.endsWith('.ts')) {
      try { templateRoutes.push({ rel: `${dir}/${e}`, src: readFileSync(ROOT + `${dir}/${e}`, 'utf8').replace(/\r\n/g, '\n') }) } catch { /* unreadable */ }
    }
  }
}
/**
 * A blanket guard on the mount: authenticate PLUS something that authorises.
 *
 * requireOwner is in the list because it IS requireRole('owner') — the strictest guard in the
 * codebase. Leaving it out made this guard report crm-store's owner-only email aliases as an
 * unguarded mount, which is the opposite of true.
 */
const MOUNT_GUARD = /app\.use\('\*',[^)\n]*require(Admin|Owner|Role|Permission|AnyPermission)/
/**
 * Mounts that are authenticate-only ON PURPOSE, each with the argument that makes it so. Named one by
 * one, because an exemption that matches a pattern quietly grows to cover the next thing.
 *
 * The two onboarding ones are POST /complete, which clears a company-wide flag. OnboardingGate
 * redirects anyone whose flag is falsy to the wizard, so gating the route on admin makes a non-admin
 * loop for ever: wizard, POST, 403, flag still falsy, redirect. The lockout is worse than the write,
 * and the write is one boolean.
 *
 * crm-store inboundMessages is a different argument. The other ten verticals put the WHOLE module
 * behind requireAdmin — inbox and reply together — because branded email is an owner-configured
 * surface there. crm-store has two roles, owner and staff, and no admin tier at all; its staff role
 * exists to do the work, and answering the customer email that came in IS the work. The template
 * opens the inbox to staff for reading, so refusing them the reply would leave a read-only inbox for
 * the only people who use it. Gate the whole module or none of it; store chose none, on purpose.
 */
const MOUNT_EXEMPT = new Set([
  'templates/crm-roof/backend/src/routes/onboarding.ts',
  'templates/crm-store/backend/src/routes/onboarding.ts',
  'templates/crm-store/backend/src/routes/inboundMessages.ts',
])

function mountGuard(moduleSrc: string): { all: boolean; wiring: string[]; open: string[] } | null {
  const factories = [...moduleSrc.matchAll(/export function (create\w*Routes)/g)].map((m) => m[1])
  if (!factories.length) return null
  const wiring = templateRoutes.filter((f) => factories.some((fn) => new RegExp(`\\b${fn}\\b`).test(f.src)))
  if (!wiring.length) return null
  const open = wiring.filter((f) => !MOUNT_GUARD.test(f.src) && !MOUNT_EXEMPT.has(f.rel)).map((f) => f.rel)
  return { all: open.length === 0, wiring: wiring.map((f) => f.rel), open }
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

let clean = 0, checked = 0, debt = 0, mounted = 0
/**
 * One file can export several routers with opposite contracts, so each is judged on its own: the
 * block from one `export function createXRoutes` to the next.
 */
function factoryBlocks(src: string): { name: string; body: string }[] {
  const marks = [...src.matchAll(/export function (create\w*Routes)/g)]
  return marks.map((m, i) => ({
    name: m[1],
    body: src.slice(m.index!, i + 1 < marks.length ? marks[i + 1].index! : undefined),
  }))
}

for (const rel of files) {
  const whole = stripComments(readFileSync(ROOT + rel, 'utf8').replace(/\r\n/g, '\n'))
  if (!/export function create\w*Routes/.test(whole)) continue
  if (PUBLIC_BY_DESIGN.has(rel)) continue

  for (const factory of factoryBlocks(whole)) {
  if (PUBLIC_BY_DESIGN.has(`${rel}#${factory.name}`)) continue
  const src = factory.body

  const writes = [...src.matchAll(/^\s*app\.(post|put|patch|delete)\(([^\n]*)$/gm)]
    .filter((m) => !NOT_A_USER.test(m[2]))
  if (!writes.length) continue
  checked++

  /**
   * A guard given a name is still a guard. `const touchesTheBooks = requirePermission(...)` used on
   * twelve routes is better than the same string inlined twelve times — booking does it as
   * `configuresBooking` — so the reader learns the names rather than the code losing them.
   */
  const aliases = [...src.matchAll(/const (\w+) = require(?:Permission|AnyPermission|Role|Admin|Ownership)\(/g)].map((m) => m[1])
  const guarded = new RegExp(`require(Permission|AnyPermission|Role|Admin|Ownership)${aliases.length ? '|\\b(' + aliases.join('|') + ')\\b' : ''}`)

  const unguarded = writes.filter((m) => !guarded.test(m[2]))

  // Before judging the module, look at how it is mounted. A template that guards the mount has
  // authorised every route under it, and counting those as holes is how a real number becomes noise.
  const mount = unguarded.length ? mountGuard(src) : null
  if (mount && mount.all) { mounted++; continue }
  if (mount && mount.open.length && mount.open.length < mount.wiring.length) {
    fail(`${rel}: guarded at the mount in ${mount.wiring.length - mount.open.length} template(s) and NOT in ${mount.open.join(
)} — a module that is admin-only in most verticals and open in one is the hole nobody goes looking for`)
    continue
  }

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
}

if (failed) { console.error(`\nwrite routes authorise: ${failed} problem(s).`); process.exit(1) }
console.log(`write routes authorise: ${clean} of ${checked} module(s) guard every user-facing write in the module itself, ${mounted} more are admin-only at every mount that wires them, and ${Object.keys(BASELINE).length} are on the debt list carrying ${debt} route(s) any signed-in user can drive`)

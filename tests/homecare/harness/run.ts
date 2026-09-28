// The homecare behaviour suite. Same runner as salon, field service and dispensary
// (tests/harness/runSuite.ts), different template.
//
//   bun tests/homecare/harness/run.ts            # everything
//   bun tests/homecare/harness/run.ts leads      # only files whose name contains "leads"
//   KEEP=1 bun tests/homecare/harness/run.ts     # leave the sandbox in place to poke at
//
// crm-homecare has a model of its own: no permission matrix at all. `authenticate` for staff, then
// `requireAdmin` (admin OR owner) for anything privileged — 69 route-level uses — and a client
// portal on a separate surface with its own portalAuth. The staff surface is binary: admin/owner run
// the office, caregivers deliver care.
//
// Two compatibility facts checked before this suite existed, worth keeping:
//
//   · The harness replaces src/middleware/auth.ts with a fixture built on the shared
//     createAuthMiddleware. homecare's is hand-written, but its requireAdmin is semantically
//     identical — role must be 'admin' or 'owner', else 403 — so the swap changes nothing.
//
//   · homecare's auth.ts ALSO exports `logAuthEvent`, which the fixture does not. Only
//     routes/auth.ts imports it, so a test here must NOT mount routes/auth.ts. Mount business route
//     files only. If you ever need the login routes, extend the fixture rather than working around
//     it here.
import { runSuite } from '../../harness/runSuite.ts'

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
process.exit(await runSuite({
  root: ROOT,
  suiteDir: ROOT + 'tests/homecare',
  template: 'crm-homecare',
  label: 'homecare',
  filter: process.argv[2] || '',
}))

// The dispensary behaviour suite. Same runner as salon and field service
// (tests/harness/runSuite.ts), different template — that is the whole difference.
//
//   bun tests/dispensary/harness/run.ts            # everything
//   bun tests/dispensary/harness/run.ts money      # only files whose name contains "money"
//   KEEP=1 bun tests/dispensary/harness/run.ts     # leave the sandbox in place to poke at
//
// Why this vertical needed one: salon and field service have had 696 assertions guarding them and
// produced almost no findings in the 2026-09-27 authorisation sweep. crm-dispensary had none, and
// produced nearly all of them — money routes open to every budtender, six public endpoints that
// answered 401 to the only callers they have, and an admin regression that shipped green because
// dispensary forks the permission matrix and the shared-matrix guard could not see it.
//
// The harness replaces exactly three files (db/index.ts → in-process PGlite, middleware/auth.ts →
// an x-test-user bridge, setup.ts → the tenant's own migrations). It does NOT replace
// middleware/permissions.ts, which is the point: dispensary's forked matrix — viewer < driver <
// budtender < manager < admin < owner — is the real one under test. Its auth.ts requireRole is
// byte-equivalent to the shared createAuthMiddleware the fixture is built on, so the swap changes
// nothing these tests care about.
import { runSuite } from '../../harness/runSuite.ts'

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
process.exit(await runSuite({
  root: ROOT,
  suiteDir: ROOT + 'tests/dispensary',
  template: 'crm-dispensary',
  label: 'dispensary',
  filter: process.argv[2] || '',
}))

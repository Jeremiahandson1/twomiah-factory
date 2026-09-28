// The crm-store behaviour suite. Same runner as salon, dispensary and field service
// (tests/harness/runSuite.ts), different template — that is the whole difference.
//
//   bun tests/store/harness/run.ts            # everything
//   bun tests/store/harness/run.ts loyalty    # only files whose name contains "loyalty"
//   KEEP=1 bun tests/store/harness/run.ts     # leave the sandbox in place to poke at
//
// Why this vertical needed one: crm-store had no behaviour suite at all, and it is the least like
// its siblings — single-tenant (no companyId anywhere), uuid keys, money in integer cents, and a
// guest checkout with no shopper login. Every assumption the other suites bake in is wrong here,
// which is exactly why it needs its own (see fixtures/middleware-auth.crm-store.ts).
import { runSuite } from '../../harness/runSuite.ts'

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
process.exit(await runSuite({
  root: ROOT,
  suiteDir: ROOT + 'tests/store',
  template: 'crm-store',
  label: 'store',
  filter: process.argv[2] || '',
}))

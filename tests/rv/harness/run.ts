// The crm-rv behaviour suite. Same runner as every other suite (tests/harness/runSuite.ts) — only the
// template differs. Created with no test files of its own: the shared contract test in
// tests/harness/contract.test.ts runs in every suite, so this vertical gets the two fleet-wide
// invariants (nothing readable unauthenticated, no 5xx from a well-formed request) from day one, and
// behaviour tests get added here as rounds find things.
//
//   bun tests/rv/harness/run.ts
import { runSuite } from '../../harness/runSuite.ts'

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
process.exit(await runSuite({
  root: ROOT,
  suiteDir: ROOT + 'tests/rv',
  template: 'crm-rv',
  label: 'rv',
  filter: process.argv[2] || '',
}))

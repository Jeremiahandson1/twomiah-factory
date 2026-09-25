// The salon behaviour suite. The runner lives in tests/harness/runSuite.ts — one implementation for
// every vertical, so a second suite cannot drift into testing the wrong template.
//
//   bun tests/salon/harness/run.ts          # everything
//   bun tests/salon/harness/run.ts t30      # only files whose name contains "t30"
//   KEEP=1 bun tests/salon/harness/run.ts   # leave the sandbox in place to poke at
import { runSuite } from '../../harness/runSuite.ts'

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
process.exit(await runSuite({
  root: ROOT,
  suiteDir: ROOT + 'tests/salon',
  template: 'crm-salon',
  label: 'salon',
  filter: process.argv[2] || '',
}))

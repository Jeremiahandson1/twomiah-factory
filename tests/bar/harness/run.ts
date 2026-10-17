// The crm-bar behaviour suite. Same runner as every other suite (tests/harness/runSuite.ts) — only the
// template differs. crm-bar is crm-basic's clone, so it starts with crm-basic's tests for the code it
// inherited (activity routes, commission gating, call tracking, the lead inbox, the write floor); the
// bar's own modules (menu, taps, the Tonight console, parties) add theirs beside them.
//
//   bun tests/bar/harness/run.ts
import { runSuite } from '../../harness/runSuite.ts'

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
process.exit(await runSuite({
  root: ROOT,
  suiteDir: ROOT + 'tests/bar',
  template: 'crm-bar',
  label: 'bar',
  filter: process.argv[2] || '',
}))

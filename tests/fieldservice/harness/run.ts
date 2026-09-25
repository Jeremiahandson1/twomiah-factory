// The field-service behaviour suite. Same runner as salon (tests/harness/runSuite.ts), different
// template — that is the whole difference, and the reason the runner is not copied.
//
//   bun tests/fieldservice/harness/run.ts        # everything
//   bun tests/fieldservice/harness/run.ts t26    # only files whose name contains "t26"
import { runSuite } from '../../harness/runSuite.ts'

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
process.exit(await runSuite({
  root: ROOT,
  suiteDir: ROOT + 'tests/fieldservice',
  template: 'crm-fieldservice',
  label: 'fieldservice',
  filter: process.argv[2] || '',
}))

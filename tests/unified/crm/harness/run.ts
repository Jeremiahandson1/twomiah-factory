// The adapted copies of base CRM suite files (see each file's header), run against the unified app with the same
// sandbox as the originals.
//
//   bun tests/unified/crm/harness/run.ts [filter]
import { fileURLToPath } from 'node:url'
import { runUnifiedSuite } from '../../harness/runUnifiedSuite.ts'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\\/g, '/')
process.exit(await runUnifiedSuite({
  root: ROOT,
  suiteDir: ROOT + 'tests/unified/crm',
  template: 'crm',
  vertical: 'contractor',
  label: 'crm-adapted',
  filter: process.argv[2] || '',
}))

// The adapted copies of template suite files (tests/unified/<suite>/*.test.ts — see each file's header), run against
// the unified app as the vertical each suite belongs to.
//
//   bun tests/unified/harness/adapted.ts [suite] [filter]
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { runUnifiedSuite } from './runUnifiedSuite.ts'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/')
/** suite directory → the template its files name, and the vertical the app runs as. */
const SUITES: Record<string, { template: string; vertical: string }> = {
  crm: { template: 'crm', vertical: 'contractor' },
  fieldservice: { template: 'crm-fieldservice', vertical: 'fieldservice' },
}
const only = process.argv[2]
let failed = 0
for (const [suite, s] of Object.entries(SUITES)) {
  if (only && suite !== only) continue
  if (!existsSync(ROOT + 'tests/unified/' + suite)) continue
  failed += await runUnifiedSuite({ root: ROOT, suiteDir: ROOT + 'tests/unified/' + suite, template: s.template, vertical: s.vertical, label: suite + '-adapted', filter: process.argv[3] || '' })
}
process.exit(failed ? 1 : 0)

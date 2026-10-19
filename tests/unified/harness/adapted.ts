// The adapted copies of template suite files (tests/unified/<suite>/*.test.ts — see each file's header), run against
// the unified app as the vertical each suite belongs to.
//
//   bun tests/unified/harness/adapted.ts [suite] [filter]
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { runUnifiedSuite } from './runUnifiedSuite.ts'
import { SALON_SANDBOX } from './salonSandbox.ts'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/')
/** suite directory → the template its files name, and the vertical the app runs as. */
const SUITES: Record<string, { template: string; vertical: string; sandboxFiles?: Record<string, string>; homecare?: boolean }> = {
  crm: { template: 'crm', vertical: 'contractor' },
  fieldservice: { template: 'crm-fieldservice', vertical: 'fieldservice' },
  basic: { template: 'crm-basic', vertical: 'basic' },
  landscaping: { template: 'crm-landscaping', vertical: 'landscaping' },
  restaurant: { template: 'crm-restaurant', vertical: 'restaurant' },
  vet: { template: 'crm-vet', vertical: 'vet' },
  bar: { template: 'crm-bar', vertical: 'bar' },
  salon: { template: 'crm-salon', vertical: 'salon', sandboxFiles: SALON_SANDBOX },
  homecare: { template: 'crm-homecare', vertical: 'homecare', homecare: true },
}
const only = process.argv[2]
let failed = 0
for (const [suite, s] of Object.entries(SUITES)) {
  if (only && suite !== only) continue
  if (!existsSync(ROOT + 'tests/unified/' + suite)) continue
  failed += await runUnifiedSuite({ root: ROOT, suiteDir: ROOT + 'tests/unified/' + suite, template: s.template, vertical: s.vertical, label: suite + '-adapted', filter: process.argv[3] || '', sandboxFiles: s.sandboxFiles, homecare: s.homecare })
}
process.exit(failed ? 1 : 0)

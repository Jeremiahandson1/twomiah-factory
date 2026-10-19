// The veterinary CRM's behaviour suite, run against the unified app as the vet vertical.
//
//   bun tests/unified/harness/vet.ts            # everything
//   bun tests/unified/harness/vet.ts visits     # only files whose name contains "visits"
import { fileURLToPath } from 'node:url'
import { runUnifiedSuite } from './runUnifiedSuite.ts'

// fileURLToPath, not .pathname: a space in the checkout's path arrives as %20 otherwise.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/')
process.exit(await runUnifiedSuite({
  root: ROOT,
  suiteDir: ROOT + 'tests/vet',
  template: 'crm-vet',
  vertical: 'vet',
  label: 'vet',
  filter: process.argv[2] || '',
  // The rules the tests assert where they live: a visit's date and its invoice's dates, the recall message's merge.
  routeModules: { 'visits.ts': 'server/crm/vet/visits.ts', 'reminders.ts': 'server/crm/vet/reminders.ts' },
}))

// The restaurant (private events) CRM's behaviour suite, run against the unified app as the restaurant vertical.
//
//   bun tests/unified/harness/restaurant.ts            # everything
//   bun tests/unified/harness/restaurant.ts t39        # only files whose name contains "t39"
import { fileURLToPath } from 'node:url'
import { runUnifiedSuite } from './runUnifiedSuite.ts'

// fileURLToPath, not .pathname: a space in the checkout's path arrives as %20 otherwise.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/')
process.exit(await runUnifiedSuite({
  root: ROOT,
  suiteDir: ROOT + 'tests/restaurant',
  template: 'crm-restaurant',
  vertical: 'restaurant',
  label: 'restaurant',
  filter: process.argv[2] || '',
}))

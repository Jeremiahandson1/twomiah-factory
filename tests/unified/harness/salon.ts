// The salon CRM's behaviour suite, run against the unified app as the salon vertical.
//
//   bun tests/unified/harness/salon.ts            # everything
//   bun tests/unified/harness/salon.ts loyalty    # only files whose name contains "loyalty"
import { fileURLToPath } from 'node:url'
import { runUnifiedSuite } from './runUnifiedSuite.ts'
import { SALON_SANDBOX } from './salonSandbox.ts'

// fileURLToPath, not .pathname: a space in the checkout's path arrives as %20 otherwise.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/')
process.exit(await runUnifiedSuite({
  root: ROOT,
  suiteDir: ROOT + 'tests/salon',
  template: 'crm-salon',
  vertical: 'salon',
  label: 'salon',
  filter: process.argv[2] || '',
  // The salon services and utils the tests import by the template's paths (server/crm/salon).
  sandboxFiles: SALON_SANDBOX,
}))

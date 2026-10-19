// Home care's behaviour suite (tests/homecare), run against the unified app as the homecare vertical, in the harness's
// home-care mode (runUnifiedSuite `homecare`: one agency per database, signed in by headers).
//
//   bun tests/unified/harness/homecare.ts            # everything
//   bun tests/unified/harness/homecare.ts billing    # only files whose name contains "billing"
import { fileURLToPath } from 'node:url'
import { runUnifiedSuite } from './runUnifiedSuite.ts'
import { HOMECARE_SANDBOX } from './homecareSandbox.ts'

// fileURLToPath, not .pathname: a space in the checkout's path arrives as %20 otherwise.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/')
process.exit(await runUnifiedSuite({
  root: ROOT,
  suiteDir: ROOT + 'tests/homecare',
  template: 'crm-homecare',
  vertical: 'homecare',
  label: 'homecare',
  filter: process.argv[2] || '',
  homecare: true,
  sandboxFiles: HOMECARE_SANDBOX,
}))

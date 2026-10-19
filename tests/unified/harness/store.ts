// The store's behaviour suite (tests/store), run against the unified app as the store vertical
// (docs/UNIFIED_STORE_PLAN.md).
//
//   bun tests/unified/harness/store.ts            # everything
//   bun tests/unified/harness/store.ts loyalty    # only files whose name contains "loyalty"
import { fileURLToPath } from 'node:url'
import { runUnifiedSuite } from './runUnifiedSuite.ts'
import { STORE_SANDBOX } from './storeSandbox.ts'

// fileURLToPath, not .pathname: a space in the checkout's path arrives as %20 otherwise.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/')
process.exit(await runUnifiedSuite({
  root: ROOT,
  suiteDir: ROOT + 'tests/store',
  template: 'crm-store',
  vertical: 'store',
  label: 'store',
  filter: process.argv[2] || '',
  sandboxFiles: STORE_SANDBOX,
  store: true,
}))

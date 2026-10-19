// Roofing's behaviour suite (tests/roof), run against the unified app as the roofing vertical (docs/UNIFIED_ROOF_PLAN.md).
//
//   bun tests/unified/harness/roof.ts            # everything
//   bun tests/unified/harness/roof.ts claims     # only files whose name contains "claims"
import { fileURLToPath } from 'node:url'
import { runUnifiedSuite } from './runUnifiedSuite.ts'
import { ROOF_SANDBOX } from './roofSandbox.ts'

// fileURLToPath, not .pathname: a space in the checkout's path arrives as %20 otherwise.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/')
process.exit(await runUnifiedSuite({
  root: ROOT,
  suiteDir: ROOT + 'tests/roof',
  template: 'crm-roof',
  vertical: 'roofing',
  label: 'roof',
  filter: process.argv[2] || '',
  sandboxFiles: ROOF_SANDBOX,
}))

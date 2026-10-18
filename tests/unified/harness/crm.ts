// The base CRM's behaviour suite, run against the unified app (apps/unified) as the contractor vertical.
//
//   bun tests/unified/harness/crm.ts            # everything
//   bun tests/unified/harness/crm.ts bills      # only files whose name contains "bills"
import { fileURLToPath } from 'node:url'
import { runUnifiedSuite } from './runUnifiedSuite.ts'

// fileURLToPath, not .pathname: a space in the checkout's path arrives as %20 otherwise.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/')
process.exit(await runUnifiedSuite({
  root: ROOT,
  suiteDir: ROOT + 'tests/crm',
  template: 'crm',
  vertical: 'contractor',
  label: 'crm',
  filter: process.argv[2] || '',
}))

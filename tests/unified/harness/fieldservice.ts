// The field-service CRM's behaviour suite, run against the unified app as the fieldservice vertical.
//
//   bun tests/unified/harness/fieldservice.ts            # everything
//   bun tests/unified/harness/fieldservice.ts bills      # only files whose name contains "bills"
import { fileURLToPath } from 'node:url'
import { runUnifiedSuite } from './runUnifiedSuite.ts'

// fileURLToPath, not .pathname: a space in the checkout's path arrives as %20 otherwise.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/')
process.exit(await runUnifiedSuite({
  root: ROOT,
  suiteDir: ROOT + 'tests/fieldservice',
  template: 'crm-fieldservice',
  vertical: 'fieldservice',
  label: 'fieldservice',
  filter: process.argv[2] || '',
}))
